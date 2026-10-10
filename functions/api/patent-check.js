import { getVolcanoKey, getVolcanoEp } from './_config.js';
// 侵权风险排查接口：联网检索 Google Patents（主）+ Google News 商标/TRO 风险（补）
// 输入: { keywords: string[] | string, productName?: string }
// 输出: { risk, patents[], trademarkWarnings[], summary, disclaimer, note?, updated }
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DISCLAIMER = '本结果由公开数据自动检索生成，仅供参考，不构成法律意见。专利/商标检索存在遗漏可能，上架前请结合专业核实。';

const mem = new Map();

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'pc-' + h.toString(36);
}

async function fetchText(url, ms, extraHeaders) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json,text/xml,*/*', 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://patents.google.com/', ...(extraHeaders || {}) }, signal: ctrl.signal, redirect: 'follow' });
    return r.ok ? await r.text() : '';
  } catch { return ''; } finally { clearTimeout(t); }
}

// ============ 多源专利检索（并发，谁成功用谁） ============
// 源1: Google Patents XHR（并行多组查询 + 单组重试）
async function queryGooglePatents(kws) {
  const tries = [kws.join(' '), kws.slice(0, 2).join(' '), kws[0]];
  const attempt = async (tq) => {
    for (let retry = 0; retry < 1; retry++) { // 单次
      const url = `https://patents.google.com/xhr/query?url=q%3D${encodeURIComponent(tq).replace(/%20/g, '+')}%26country%3DUS%26num%3D10`;
      const txt = await fetchText(url, 4500);
      if (!txt) continue;
      try {
        const d = JSON.parse(txt);
        const res = (d && d.results && d.results.result) || [];
        const patents = res.map(x => {
          const p = (x && x.patent) || {};
          const num = p.publication_number || '';
          const title = p.title || '';
          return mkPatent(num, title, p.assignee || '', (p.grant_date || p.publication_date || '').slice(0, 10), kws);
        }).filter(p => p.patentNumber);
        if (patents.length) return patents;
      } catch { /* 继续 */ }
    }
    return [];
  };
  const groups = await Promise.all(tries.map(attempt));
  return groups.flat();
}

function mkPatent(num, title, assignee, date, kws) {
  const lower = (title || '').toLowerCase();
  return {
    patentNumber: String(num || '').trim(),
    title: title || '',
    assignee: assignee || '',
    grantDate: date || '',
    url: num ? `https://patents.google.com/patent/${num}/en` : '',
    titleHits: (kws || []).filter(k => lower.includes(k.toLowerCase())).length
  };
}

// 源2: DuckDuckGo HTML 搜索（标题内提取专利号）
async function queryDuckDuckGo(kws) {
  const q = encodeURIComponent(kws.slice(0, 2).join(' ') + ' patent US');
  const txt = await fetchText(`https://html.duckduckgo.com/html/?q=${q}`, 5500);
  if (!txt) return [];
  const out = [];
  const re = /result__a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(txt)) && out.length < 6) {
    const href = m[1] || '';
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    const numMatch = title.match(/US\s?(\d{6,8})/i);
    if (!numMatch) continue;
    const num = 'US' + numMatch[1];
    if (seen.has(num)) continue;
    seen.add(num);
    out.push(mkPatent(num, title.slice(0, 120), '', '', kws));
  }
  return out;
}

// 源3: PatentsView v2 API（USPTO 官方数据）
async function queryPatentsView(kws) {
  const q = encodeURIComponent(JSON.stringify({ patent_title: { contains: kws[0] } }));
  const f = encodeURIComponent(JSON.stringify(['patent_number', 'patent_title', 'patent_assignee', 'patent_date']));
  const o = encodeURIComponent(JSON.stringify({ size: 6 }));
  const txt = await fetchText(`https://search.patentsview.org/api/v1/patent/?q=${q}&f=${f}&o=${o}`, 7000);
  if (!txt) return [];
  try {
    const d = JSON.parse(txt);
    const list = (d && d.patents) || [];
    return list.map(p => mkPatent(p.patent_number, p.patent_title || p.patent_title?.text?.[0] || '', p.patent_assignee || '', p.patent_date || '', kws)).filter(p => p.patentNumber);
  } catch { return []; }
}

// 源4: FreePatentsOnline HTML（链接含 us-专利号）
async function queryFreePatents(kws) {
  const q = encodeURIComponent(kws.slice(0, 2).join(' '));
  const txt = await fetchText(`https://www.freepatentsonline.com/result.html?query_txt=${q}&submit=Search&patents=on`, 6000);
  if (!txt) return [];
  const out = [];
  const seen = new Set();
  const re = /href="\/patent\/us-(\d+)([^"]*)">([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(txt)) && out.length < 6) {
    const num = 'US' + m[1];
    if (seen.has(num)) continue;
    seen.add(num);
    out.push(mkPatent(num, m[3].replace(/<[^>]+>/g, '').trim().slice(0, 120), '', '', kws));
  }
  return out;
}

async function queryPatentsAll(kws) {
  // 仅保留 2 个可达源（Google Patents + DuckDuckGo），PatentsView/FreePatents 长期反爬已砍，控制并发 ≤6
  const [gp, ddg] = await Promise.all([
    queryGooglePatents(kws).catch(() => []),
    queryDuckDuckGo(kws).catch(() => [])
  ]);
  const merged = {};
  for (const p of [...gp, ...ddg]) {
    if (!p.patentNumber) continue;
    const k = p.patentNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (merged[k]) {
      if (!merged[k].title && p.title) merged[k].title = p.title;
      if (!merged[k].assignee && p.assignee) merged[k].assignee = p.assignee;
      if (!merged[k].grantDate && p.grantDate) merged[k].grantDate = p.grantDate;
      merged[k].titleHits = Math.max(merged[k].titleHits, p.titleHits);
    } else merged[k] = p;
  }
  const list = Object.values(merged).sort((a, b) => b.titleHits - a.titleHits).slice(0, 8);
  return list;
}

// Google News RSS 检索商标/侵权/TRO 风险提醒（标题必须含关键词才算相关，过滤噪音）
async function queryRiskNews(kws) {
  const q = encodeURIComponent(kws.slice(0, 2).join(' ') + ' (trademark OR infringement OR TRO OR lawsuit OR patent)');
  const txt = await fetchText(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, 5500);
  if (!txt) return [];
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(txt)) && out.length < 4) {
    const item = m[1];
    const t = (item.match(/<title>(.*?)<\/title>/) || [])[1] || '';
    const link = (item.match(/<link>(.*?)<\/link>/) || [])[1] || '';
    const title = t.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const lower = title.toLowerCase();
    const hit = kws.some(k => lower.includes(k.toLowerCase()));
    if (title && hit && lower !== '') out.push({ title, url: link });
  }
  return out;
}

// ============ TRO 每日案件源（123tro.com 服务端直出） ============
const COURT_MAP = {
  ilnd: '伊利诺伊州北区地方法院', pawd: '宾夕法尼亚州西区法院', nysd: '纽约南区联邦法院',
  cacd: '加州中区法院', flsd: '佛罗里达南区法院', txnd: '德州北区法院', flmd: '佛罗里达中区法院',
  nyed: '纽约东区联邦法院', ilcd: '伊利诺伊州中区法院', nj: '新泽西州联邦法院', masd: '马萨诸塞州联邦法院'
};
function parseTRO(html) {
  const cases = [];
  const seen = new Set();
  const re = /"(\d{4}-cv-\d{3,5})"/g;
  let m;
  while ((m = re.exec(html))) {
    const cn = m[1];
    if (seen.has(cn)) continue;
    seen.add(cn);
    const win = html.slice(m.index, m.index + 520);
    const courtM = win.match(/"([^"]{2,16}地方法院[^"]*)"/);
    const courtIdM = win.match(/"(([a-z]{2,5})-1:\d{4}-cv-)/);
    const titleM = win.match(/"([^"]{3,200}? v\. [^"]{0,100}?)"/);
    const brandM = win.match(/"([^"]{2,34}?[\u4e00-\u9fff][^"]{0,34})"/);
    const dateM = win.match(/"(\d{4}-\d{2}-\d{2})"/);
    cases.push({
      caseNumber: cn,
      court: (courtM && courtM[1]) || (courtIdM && COURT_MAP[courtIdM[2]]) || '美国联邦法院',
      title: titleM ? titleM[1].slice(0, 150) : '',
      brand: brandM ? brandM[1].slice(0, 50) : '',
      date: dateM ? dateM[1] : '',
      url: 'http://www.123tro.com/'
    });
  }
  return cases;
}
async function queryTRO(kws) {
  // 单次抓取（≤9s），避免重试链拖慢整体；源通常 2-4s 返回
  const html = await fetchText('http://www.123tro.com/', 7000, { 'Referer': 'http://www.123tro.com/', 'Accept': 'text/html,*/*' });
  if (!html || html.includes('502 Bad Gateway')) return { ok: false, hits: [], total: 0, updated: '' };
  const cases = parseTRO(html);
  const hits = cases.filter(c => {
    const blob = (c.title + ' ' + c.brand + ' ' + c.caseNumber).toLowerCase();
    return kws.some(k => {
      const kl = k.toLowerCase().trim();
      return kl.length >= 3 && blob.includes(kl);
    });
  });
  // 页面内最新的案件日期（尽量找最大日期）
  let updated = '';
  for (const c of cases) if (c.date > updated) updated = c.date;
  return { ok: true, hits, total: cases.length, updated };
}

// ============ TRO 案件源2：SellerDefense API（2849+ 案件库，关键词直查） ============
async function querySellerDefenseCases(kws) {
  const out = { ok: true, hits: [], total: 0, updated: '' };
  // 前 2 个关键词并发直查（每词 ≤7s），命中即结构化案件
  const tasks = kws.slice(0, 2).filter(k => k.trim().length >= 3).map(async k => {
    const url = 'https://tro.sellerdefense.cn/api/cases/search?query=' + encodeURIComponent(k.trim()) + '&page=1&size=8';
    const txt = await fetchText(url, 6000, { 'Accept': 'application/json' });
    if (!txt) return [];
    try {
      const d = JSON.parse(txt);
      return (d && d.data && d.data.cases) || [];
    } catch { return []; }
  });
  const groups = await Promise.all(tasks);
  const seen = new Set();
  groups.flat().forEach(c => {
    const cn = (c && c.case_number) || '';
    if (!cn || seen.has(cn)) return;
    seen.add(cn);
    out.hits.push({
      caseNumber: cn,
      court: (c.court || '').slice(0, 60),
      title: (c.title || '').slice(0, 140),
      brand: (c.protection_brand || c.brand || '').slice(0, 50),
      date: c.filed_date || '',
      firm: c.plaintiff_law_firm || '',
      url: 'https://tro.sellerdefense.cn/'
    });
  });
  out.total = out.hits.length;
  const dm = groups.flat().map(c => c.filed_date || '').sort().pop();
  if (dm) out.updated = dm;
  return out;
}

// ============ TRO 历史品牌库（内置精选 + 运行时补充） ============
const BUILTIN_BRANDS = [
  // SellerDefense 品牌库文字版（律所代理品牌）
  'TOYOTA MOTOR CORPORATION','General Motors LLC','Adidas','The North Face','YETI','Goyard','OFF-WHITE','Kenzo','SPIN MASTER','IDEAVILLAGE PRODUCTS','COPPER FIT','Zippo','ORALDENT','MSM DESIGN AND ENGINEERING','RAZORBACKS','Polyblank Designs','PETS ROCK','FRIDA KAHLO','GIVENCHY','The Final Co','Marc Jacobs','Canada Goose','Bose','UGG','Calvin Klein','Swarovski','Entertainment One','Herschel Supply','Rimowa','Trias Holding','MCM','Eye Safety Systems','Monster Energy','Lululemon','Games Workshop','Popsockets','Fitness Anywhere','KENDRA SCOTT','LVMH','Sandisk','Estee Lauder','SUPREME','Christian Dior','PRL USA','Benefit Cosmetics','Versace','SUGARTOWN','Halo Acoustic Wear',
  // 常见 TRO/侵权高发品牌补充
  'Nirvana','NIRVANA 涅槃乐队','Monchhichi','Miffy','Bathmate','MAMAS & PAPAS','Fortnite','Motorhead','MOTORHEAD','Pokemon','POKEMON','Squishmallows','STANLEY','Harry Potter','MARVEL','LEGO','Disney','SONY','Nintendo','CHANEL','Louis Vuitton','LV','GUCCI','Rolex','Apple','Samsung','Snoopy','Peanuts','Sanrio','Hello Kitty','Care Bears','Doraemon','One Piece','Naruto','Dragon Ball','Hatsune Miku','Barbie','Transformers','BLOKEES','Super Mario','Minecraft','Roblox','Nike','Jordan','Crocs','Reebok','New Balance','Dr. Martens','Hunter','Hydro Flask','Cricut','Bunnies by the Bay','Van Cleef & Arpels','Tiffany','Cartier','Hermes','Dior','Fendi','Prada','Burberry','Ralph Lauren','Tommy Hilfiger','Under Armour','Gymshark','Tory Burch','Michael Kors','Skechers','Converse','Vans','Champion','Hanes','Fruit of the Loom','Rubik','Slime','Toyota','Honda','Ford','Jeep','Chrysler','Dodge','Chevrolet','Dyson','Dreame','Razer','Logitech','Sony PlayStation','Xbox','Nintendo Switch','Fisher-Price','Hasbro','Mattel','Monopoly','Uno','Play-Doh','Kinetic Sand','Cuphead','Among Us','Fall Guys','Animal Crossing','Zelda','Mario','Sonic','Street Fighter','Mortal Kombat','GTA','Elden Ring'
];
// ============ 团队中奖词库 + 侵权图库（金山文档运营待办事项接源固化） ============
// 来源：金山文档「运营待办事项」4 个 sheet（封店or律师函 中奖词库 / 封店or律所or机扫 中奖图记录 / 侵权图库 壹 / 侵权图库 贰）
// 命中即红色警示，优先级高于通用品牌库
const TEAM_DB = [
  // ---- 中奖词库 + 侵权图库 壹/贰：艺人、名人（英文名 + 中文名） ----
  { kw: 'marilyn monroe', src: '中奖词库', note: '玛丽莲·梦露' }, { kw: '梦露', src: '中奖词库', note: '玛丽莲·梦露' },
  { kw: 'ella fitzgerald', src: '中奖词库', note: '名字即文字商标' }, { kw: 'lil pump', src: '中奖词库', note: '利尔·庞普' },
  { kw: 'syd barrett', src: '中奖词库', note: 'Pink Floyd' }, { kw: 'johnny cash', src: '中奖词库', note: '约翰尼·卡什' },
  { kw: 'machine gun kelly', src: '中奖词库', note: '机关枪凯利' }, { kw: 'sahbabii', src: '中奖词库', note: '品牌' },
  { kw: 'luke combs', src: '中奖词库', note: '卢克·库姆斯' }, { kw: 'elvis presley', src: '中奖词库', note: '猫王' }, { kw: '猫王', src: '中奖词库', note: 'Elvis Presley' },
  { kw: 'scarlxrd', src: '中奖词库', note: '英国说唱歌手' }, { kw: 'kurt cobain', src: '中奖词库', note: '涅槃 Nirvana' }, { kw: 'nirvana', src: '中奖词库', note: '涅槃乐队' },
  { kw: 'lemmy kilmister', src: '中奖词库', note: 'Motorhead' }, { kw: 'motorhead', src: '中奖词库', note: '摩托头乐队' },
  { kw: "terry o'neill", src: '中奖词库', note: '摄影师' }, { kw: 'leann rimes', src: '中奖词库', note: '玛格丽特·黎安·莱姆斯' },
  { kw: 'linda ronstadt', src: '中奖词库', note: '琳达·朗丝黛' }, { kw: 'josh groban', src: '中奖词库', note: '乔诗·葛洛班' },
  { kw: 'michelle branch', src: '中奖词库', note: '蜜雪儿·布兰奇' }, { kw: 'adam lambert', src: '中奖词库', note: '亚当·兰伯特' },
  { kw: 'jake miller', src: '中奖词库', note: '杰克·米勒' }, { kw: 'tori amos', src: '中奖词库', note: '多莉艾莫丝' },
  { kw: 'brandy norwood', src: '中奖词库', note: '布兰迪·诺伍德' }, { kw: 'cher', src: '中奖词库', note: '雪儿' },
  { kw: 'craig david', src: '中奖词库', note: '克雷格·大卫' }, { kw: 'missy elliott', src: '中奖词库', note: '梅西·埃丽奥特' },
  { kw: 'david foster', src: '中奖词库', note: '戴维·佛斯特' }, { kw: 'faith hill', src: '中奖词库', note: '菲丝·希尔' },
  { kw: 'jewel', src: '中奖词库', note: '珠儿' }, { kw: 'pat metheny', src: '中奖词库', note: '派特·麦席尼' },
  { kw: 'alanis morissette', src: '中奖词库', note: '艾拉妮丝·莫莉塞特' }, { kw: 'renee olstead', src: '中奖词库', note: '芝妮·奥斯泰德' },
  { kw: 'ryan cabrera', src: '中奖词库', note: '瑞安·卡布雷拉' }, { kw: '2kbaby', src: '中奖词库' }, { kw: '88-keys', src: '中奖词库' },
  { kw: 'adam melchor', src: '中奖词库' }, { kw: 'ali gatie', src: '中奖词库' }, { kw: 'amy allen', src: '中奖词库' },
  { kw: 'andra day', src: '中奖词库' }, { kw: 'anitta', src: '中奖词库' }, { kw: 'anne-marie', src: '中奖词库' },
  { kw: 'ashnikko', src: '中奖词库' }, { kw: 'baka not nice', src: '中奖词库' }, { kw: 'bebe rexha', src: '中奖词库' },
  { kw: 'belle mt', src: '中奖词库' }, { kw: 'big homie ty', src: '中奖词库' }, { kw: 'bktherula', src: '中奖词库' },
  { kw: 'black fortune', src: '中奖词库' }, { kw: 'black noi$e', src: '中奖词库' }, { kw: 'brandy clark', src: '中奖词库' },
  { kw: 'griff', src: '中奖词库', note: 'Sarah Faith Griffiths' }, { kw: 'hobo johnson', src: '中奖词库' },
  { kw: 'idk', src: '中奖词库', note: '美国说唱歌手' }, { kw: 'isaiah rashad', src: '中奖词库' }, { kw: 'jojo', src: '中奖词库' },
  { kw: 'josh richards', src: '中奖词库' }, { kw: 'joshua bassett', src: '中奖词库' }, { kw: 'joshua redman', src: '中奖词库' },
  { kw: 'k.d. lang', src: '中奖词库' }, { kw: 'keedron bryant', src: '中奖词库' }, { kw: 'l devine', src: '中奖词库' },
  { kw: 'lianne la havas', src: '中奖词库' }, { kw: 'liam gallagher', src: '中奖词库' },
  { kw: 'billie eilish', src: '侵权图库', note: '比莉·艾利什' }, { kw: 'shawn mendes', src: '侵权图库', note: '肖恩·蒙德兹' },
  { kw: 'lady gaga', src: '侵权图库' }, { kw: 'whitney houston', src: '侵权图库', note: '惠特妮·休斯顿' },
  { kw: 'ariana grande', src: '侵权图库', note: '爱莉安娜·格兰德' }, { kw: 'selena gomez', src: '侵权图库', note: '赛琳娜·戈麦斯' },
  { kw: 'cardi b', src: '侵权图库', note: '卡迪B' }, { kw: 'janis joplin', src: '侵权图库' }, { kw: 'ashley mcbride', src: '侵权图库' },
  { kw: 'jisoo', src: '侵权图库', note: 'Blackpink 金智秀' }, { kw: 'blackpink', src: '侵权图库', note: '韩国女团' },
  { kw: 'juice wrld', src: '侵权图库' }, { kw: 'eminem', src: '侵权图库', note: '埃米纳姆' }, { kw: 'post malone', src: '侵权图库' },
  { kw: 'travis scott', src: '侵权图库' }, { kw: 'lil tjay', src: '侵权图库' }, { kw: 'tupac', src: '侵权图库', note: '2pac' },
  { kw: 'ed sheeran', src: '侵权图库', note: '艾德·希兰' }, { kw: 'eric church', src: '侵权图库' },
  { kw: 'bruce lee', src: '侵权图库', note: '李小龙' }, { kw: '李小龙', src: '侵权图库' }, { kw: 'asap rocky', src: '侵权图库' },
  { kw: 'bob marley', src: '侵权图库', note: '鲍勃·马利' }, { kw: 'lil nas x', src: '侵权图库' }, { kw: 'gil scott-heron', src: '侵权图库' },
  { kw: 'sean connery', src: '侵权图库', note: '肖恩·康纳利' }, { kw: 'pop smoke', src: '侵权图库' },
  { kw: 'nipsey hussle', src: '侵权图库' }, { kw: 'lil uzi vert', src: '侵权图库' }, { kw: 'the weeknd', src: '侵权图库', note: '威肯' },
  { kw: 'justin bieber', src: '侵权图库', note: '贾斯汀·比伯（欧洲也不要上）' },
  { kw: 'trump', src: '侵权图库', note: '特朗普（前美国总统）' }, { kw: 'ruth bader ginsburg', src: '侵权图库' },
  { kw: 'albert einstein', src: '侵权图库', note: '爱因斯坦' }, { kw: 'brendon urie', src: '侵权图库' },
  { kw: 'polo g', src: '侵权图库' }, { kw: 'mac miller', src: '侵权图库' }, { kw: 'frank ocean', src: '侵权图库' },
  { kw: 'lil peep', src: '侵权图库' }, { kw: 'wiz khalifa', src: '侵权图库' }, { kw: 'kate upton', src: '侵权图库' },
  { kw: 'kanye west', src: '侵权图库' }, { kw: 'king von', src: '侵权图库' }, { kw: 'brother sundance', src: '侵权图库' },
  { kw: 'bryce vine', src: '侵权图库' }, { kw: 'carlie hanson', src: '侵权图库' }, { kw: 'cavetown', src: '侵权图库' },
  { kw: 'chika', src: '侵权图库' }, { kw: 'cj', src: '侵权图库' }, { kw: 'conor oberst', src: '侵权图库' },
  { kw: 'conor matthews', src: '侵权图库' }, { kw: 'curly j', src: '侵权图库' }, { kw: 'dan auerbach', src: '侵权图库' },
  { kw: 'david guetta', src: '侵权图库' }, { kw: 'devendra banhart', src: '侵权图库' }, { kw: 'dua lipa', src: '侵权图库' },
  { kw: 'earl sweatshirt', src: '侵权图库' }, { kw: 'emmylou harris', src: '侵权图库' }, { kw: 'eric clapton', src: '侵权图库' },
  { kw: 'freddie gibbs', src: '侵权图库' }, { kw: 'gary clark jr', src: '侵权图库' }, { kw: 'gerard way', src: '侵权图库' },
  { kw: 'kobe bryant', src: '侵权图库', note: '科比' }, { kw: '科比', src: '侵权图库' }, { kw: 'ronaldo', src: '侵权图库', note: '罗纳尔多' },
  { kw: 'maradona', src: '侵权图库', note: '马拉多纳' }, { kw: 'harry kane', src: '侵权图库' },
  { kw: 'robert lewandowski', src: '侵权图库' }, { kw: 'wayne rooney', src: '侵权图库' },
  { kw: 'manuel neuer', src: '侵权图库' }, { kw: 'daniel ricciardo', src: '侵权图库' },
  { kw: 'lewis hamilton', src: '侵权图库' }, { kw: 'roman reigns', src: '侵权图库' }, { kw: 'becky lynch', src: '侵权图库' },
  { kw: 'muhammad ali', src: '侵权图库', note: '拳王阿里' }, { kw: 'mike tyson', src: '侵权图库', note: '迈克·泰森' },
  { kw: 'tyson fury', src: '侵权图库' }, { kw: 'john cena', src: '侵权图库' }, { kw: 'kareem abdul-jabbar', src: '侵权图库' },
  { kw: 'mookie betts', src: '侵权图库' }, { kw: 'desean jackson', src: '侵权图库' }, { kw: 'stan lee', src: '侵权图库', note: '斯坦李' },
  { kw: 'michael tomp settled', src: '侵权图库' }, { kw: 'eddie van halen', src: '侵权图库' }, { kw: 'fred durst', src: '侵权图库' },
  { kw: 'jimi hendrix', src: '侵权图库' }, { kw: 'frida kahlo', src: '侵权图库', note: '弗里达·卡罗' }, { kw: '弗里达', src: '侵权图库' },
  { kw: 'eugenia loli', src: '侵权图库', note: '拼贴艺术家' }, { kw: 'derek deyoung', src: '侵权图库' },
  { kw: 'josephine wall', src: '侵权图库' }, { kw: 'ernie barnes', src: '侵权图库', note: '复古画作' },
  { kw: 'dan munford', src: '侵权图库', note: '电影插画师' }, { kw: 'aja kusick', src: '侵权图库', note: '星空系列' },
  { kw: 'arnold friberg', src: '侵权图库' }, { kw: 'konstantin korobov', src: '侵权图库' },
  // ---- 乐队/乐团 ----
  { kw: 'goo goo dolls', src: '侵权图库', note: '咕咕玩偶' }, { kw: 'the head and the heart', src: '侵权图库' },
  { kw: 'kronos quartet', src: '侵权图库' }, { kw: 'lake street dive', src: '侵权图库' },
  { kw: 'lukas graham', src: '侵权图库' }, { kw: 'majid jordan', src: '侵权图库' },
  { kw: 'rammstein', src: '侵权图库' }, { kw: 'shoreline mafia', src: '侵权图库' }, { kw: 'foals', src: '侵权图库' },
  { kw: 'the black crowes', src: '侵权图库' }, { kw: 'ac/dc', src: '侵权图库' }, { kw: 'queen', src: '侵权图库', note: '皇后乐队' },
  { kw: 'pink floyd', src: '侵权图库', note: '平克·弗洛伊德' }, { kw: 'david gilmour', src: '侵权图库' },
  { kw: 'eagles', src: '侵权图库', note: '老鹰乐队' }, { kw: 'run-d.m.c.', src: '侵权图库' },
  { kw: 'linkin park', src: '侵权图库', note: '林肯公园' }, { kw: 'lynyrd skynyrd', src: '侵权图库' },
  { kw: 'iced earth', src: '侵权图库', note: '冰冻地球' }, { kw: 'slipknot', src: '侵权图库', note: '活结乐队' },
  { kw: 'trivium', src: '侵权图库' }, { kw: 'blink 182', src: '侵权图库' }, { kw: 'my chemical romance', src: '侵权图库' },
  { kw: 'green day', src: '侵权图库', note: '绿日' }, { kw: 'paramore', src: '侵权图库' },
  { kw: 'arctic monkeys', src: '侵权图库', note: '北极猴子' }, { kw: 'iron maiden', src: '侵权图库', note: '铁娘子乐队' },
  { kw: 'led zeppelin', src: '侵权图库', note: '齐柏林飞艇' }, { kw: 'def leppard', src: '侵权图库' },
  { kw: 'radiohead', src: '侵权图库', note: '电台司令' }, { kw: 'volbeat', src: '侵权图库' },
  { kw: 'bts', src: '侵权图库', note: '防弹少年团' }, { kw: 'abba', src: '侵权图库' }, { kw: 'soulfly', src: '侵权图库' },
  { kw: 'bon jovi', src: '侵权图库' }, { kw: "guns n' roses", src: '侵权图库' }, { kw: 'the beatles', src: '侵权图库', note: '甲壳虫' },
  { kw: 'counting crows', src: '侵权图库' }, { kw: 'gratitude', src: '侵权图库' }, { kw: 'the click five', src: '侵权图库' },
  { kw: 'r.e.m.', src: '侵权图库' }, { kw: 'red hot chili peppers', src: '侵权图库', note: '红辣椒' },
  { kw: 'third eye blind', src: '侵权图库' }, { kw: 'disturbed', src: '侵权图库' }, { kw: 'the used', src: '侵权图库' },
  { kw: 'garbage', src: '侵权图库' }, { kw: 'echosmith', src: '侵权图库' }, { kw: 'limp bizkit', src: '侵权图库' },
  { kw: 'pearl jam', src: '侵权图库', note: '珍珠酱' }, { kw: 'metallica', src: '侵权图库' }, { kw: 'gorillaz', src: '侵权图库' },
  // ---- 品牌/商标/服饰 ----
  { kw: 'taylormade', src: '中奖词库', note: '阿迪达斯高尔夫' }, { kw: 'cleveland golf', src: '中奖词库', note: '克利夫兰高尔夫' },
  { kw: 'monster energy', src: '中奖词库', note: '鬼爪' }, { kw: 'harley-davidson', src: '中奖词库', note: '哈雷·戴维森' },
  { kw: 'ray-ban', src: '中奖词库', note: '雷朋' }, { kw: 'oakley', src: '中奖词库', note: '欧克利' },
  { kw: 'costa del mar', src: '中奖词库', note: '眼镜' }, { kw: 'givenchy', src: '中奖词库', note: '纪梵希' },
  { kw: 'tiffany', src: '中奖词库', note: '蒂芙尼' }, { kw: 'dior', src: '中奖词库' }, { kw: 'loewe', src: '中奖词库', note: '罗意威' },
  { kw: 'marc jacobs', src: '中奖词库', note: '马克雅可布' }, { kw: 'goyard', src: '中奖词库', note: '高雅德' },
  { kw: 'kaws', src: '侵权图库', note: '街头艺术品牌（只要有KAWS全部删除）' }, { kw: 'audi', src: '侵权图库', note: '奥迪' },
  { kw: "jack daniel's", src: '侵权图库', note: '杰克丹尼尔' }, { kw: 'fox racing', src: '侵权图库', note: '狐狸头' },
  { kw: 'anne stokes', src: '侵权图库', note: '精灵独角兽品牌' }, { kw: 'art ask agency', src: '中奖词库', note: '精灵独角兽品牌权利人' },
  { kw: 'tmalstraw', src: '中奖词库', note: '折叠吸管' }, { kw: 'fnalstraw', src: '中奖词库', note: '折叠吸管' },
  { kw: 'nyan cat', src: '侵权图库', note: '彩虹猫' }, { kw: 'care bears', src: '侵权图库', note: '爱心熊' },
  { kw: 'sneaker match', src: '侵权图库', note: '联名定制潮牌' }, { kw: 'juventus', src: '侵权图库', note: '尤文图斯' },
  { kw: 'manchester united', src: '中奖词库', note: '曼联' }, { kw: 'liverpool', src: '中奖词库', note: '利物浦' },
  { kw: 'grumpy cat', src: '侵权图库', note: '不爽猫' }, { kw: 'sneaky cat', src: '侵权图库', note: '网红猫' },
  { kw: 'emoji', src: '侵权图库', note: 'Emoji表情包' }, { kw: 'triumph', src: '侵权图库', note: '凯旋摩托车' },
  // ---- 影视/动漫/游戏/漫威 ----
  { kw: 'harry potter', src: '侵权图库', note: '哈利波特（华纳）' }, { kw: 'marvel', src: '侵权图库', note: '漫威（所有角色都侵权）' },
  { kw: 'captain america', src: '侵权图库', note: '美国队长' }, { kw: 'iron man', src: '侵权图库', note: '钢铁侠' },
  { kw: 'thor', src: '侵权图库', note: '雷神' }, { kw: 'hulk', src: '侵权图库', note: '绿巨人' },
  { kw: 'black widow', src: '侵权图库', note: '黑寡妇' }, { kw: 'hawkeye', src: '侵权图库', note: '鹰眼' },
  { kw: 'deadpool', src: '侵权图库', note: '死侍' }, { kw: 'venom', src: '侵权图库', note: '毒液' },
  { kw: 'sentry', src: '侵权图库', note: '哨兵' }, { kw: 'magneto', src: '侵权图库', note: '万磁王' },
  { kw: 'wolverine', src: '侵权图库', note: '金刚狼' }, { kw: 'silver surfer', src: '侵权图库', note: '银影侠' },
  { kw: 'elektra', src: '侵权图库', note: '艾丽卡' }, { kw: 'war machine', src: '侵权图库', note: '战争机器' },
  { kw: 'gambit', src: '侵权图库', note: '牌皇' }, { kw: 'punisher', src: '侵权图库', note: '惩罚者' },
  { kw: 'winter soldier', src: '侵权图库', note: '冬日战士' }, { kw: 'nick fury', src: '侵权图库', note: '尼克弗瑞' },
  { kw: 'hercules', src: '侵权图库', note: '海格力斯' }, { kw: 'hope summers', src: '侵权图库' },
  { kw: 'iceman', src: '侵权图库', note: '冰人' }, { kw: 'rogue', src: '侵权图库', note: '小淘气' },
  { kw: 'guardians of the galaxy', src: '侵权图库', note: '银河护卫队' }, { kw: 'cyclops', src: '侵权图库', note: '镭射眼' },
  { kw: 'ghost rider', src: '侵权图库', note: '恶灵骑士' }, { kw: 'red skull', src: '侵权图库', note: '红骷髅' },
  { kw: 'daredevil', src: '侵权图库', note: '夜魔侠' }, { kw: 'nova', src: '侵权图库', note: '新星' },
  { kw: 'black panther', src: '侵权图库', note: '黑豹' }, { kw: 'colossus', src: '侵权图库', note: '钢力士' },
  { kw: 'x-23', src: '侵权图库' }, { kw: 'thanos', src: '侵权图库', note: '灭霸' }, { kw: 'namor', src: '侵权图库' },
  { kw: 'doctor octopus', src: '侵权图库', note: '章鱼博士' }, { kw: 'scarlet witch', src: '侵权图库', note: '绯红女巫' },
  { kw: 'human torch', src: '侵权图库', note: '霹雳火' }, { kw: 'ant-man', src: '侵权图库', note: '蚁人' },
  { kw: 'galactus', src: '侵权图库', note: '行星吞噬者' }, { kw: 'moon knight', src: '侵权图库', note: '月光骑士' },
  { kw: 'juggernaut', src: '侵权图库', note: '红坦克' }, { kw: 'beta ray bill', src: '侵权图库', note: '马面雷神' },
  { kw: 'blade', src: '侵权图库', note: '刀锋战士' }, { kw: 'luke cage', src: '侵权图库' }, { kw: 'iron fist', src: '侵权图库', note: '铁拳' },
  { kw: 'mystique', src: '侵权图库', note: '魔形女' }, { kw: 'captain britain', src: '侵权图库', note: '英国队长' },
  { kw: 'doctor doom', src: '侵权图库', note: '末日博士' }, { kw: 'vision', src: '侵权图库', note: '幻视' },
  { kw: 'she-hulk', src: '侵权图库', note: '女浩克' }, { kw: 'white queen', src: '侵权图库' },
  { kw: 'disney', src: '侵权图库', note: '迪士尼' }, { kw: 'mickey mouse', src: '侵权图库', note: '米奇老鼠' },
  { kw: 'minnie mouse', src: '侵权图库', note: '米妮老鼠' }, { kw: 'donald duck', src: '侵权图库', note: '唐老鸭' },
  { kw: 'goofy', src: '侵权图库', note: '高飞' }, { kw: 'paddington', src: '侵权图库', note: '帕丁顿熊' },
  { kw: 'hatsune miku', src: '侵权图库', note: '初音未来' }, { kw: 'squidward', src: '侵权图库', note: '章鱼哥' },
  { kw: 'peanuts', src: '侵权图库', note: '花生漫画' }, { kw: 'snoopy', src: '侵权图库', note: '史努比' },
  { kw: 'charlie brown', src: '侵权图库' }, { kw: 'miraculous ladybug', src: '中奖词库', note: '瓢虫少女' },
  { kw: 'the smurfs', src: '中奖词库', note: '蓝精灵' }, { kw: 'miraculous', src: '侵权图库' },
  { kw: 'naruto', src: '侵权图库', note: '火影忍者' }, { kw: 'doraemon', src: '侵权图库', note: '哆啦A梦' },
  { kw: 'one punch man', src: '侵权图库', note: '一拳超人' }, { kw: 'mob psycho 100', src: '侵权图库', note: '灵能百分百' },
  { kw: 'bleach', src: '侵权图库', note: '死神' }, { kw: 'the promised neverland', src: '侵权图库', note: '约定的梦幻岛' },
  { kw: 'south park', src: '侵权图库', note: '南方公园' }, { kw: 'ben 10', src: '侵权图库', note: '少年骇客' },
  { kw: 'sonic', src: '侵权图库', note: '刺猬索尼克' }, { kw: 'pokemon', src: '侵权图库', note: '宝可梦' },
  { kw: 'dragon ball', src: '侵权图库', note: '龙珠' }, { kw: 'inuyasha', src: '侵权图库', note: '犬夜叉' },
  { kw: 'one piece', src: '侵权图库', note: '海贼王' }, { kw: 'death note', src: '侵权图库', note: '死亡笔记' },
  { kw: 'totoro', src: '侵权图库', note: '龙猫（宫崎骏）' }, { kw: 'akira', src: '侵权图库', note: '阿基拉' },
  { kw: 'studio ghibli', src: '侵权图库', note: '吉卜力' }, { kw: 'star wars', src: '侵权图库', note: '星球大战' },
  { kw: 'boba fett', src: '侵权图库' }, { kw: 'alvin and the chipmunks', src: '侵权图库', note: '鼠来宝' },
  { kw: 'twilight', src: '侵权图库', note: '暮光之城' }, { kw: 'lord of the rings', src: '侵权图库', note: '指环王' },
  { kw: 'jaws', src: '侵权图库', note: '大白鲨' }, { kw: 'halloween', src: '侵权图库', note: '月光光心慌慌' },
  { kw: 'back to the future', src: '侵权图库', note: '回到未来' }, { kw: 'godzilla', src: '侵权图库', note: '哥斯拉' },
  { kw: 'e.t.', src: '侵权图库', note: '外星人' }, { kw: 'the expendables', src: '侵权图库', note: '敢死队' },
  { kw: 'scream', src: '侵权图库', note: '惊声尖叫' }, { kw: 'texas chainsaw', src: '侵权图库', note: '德州电锯杀人狂' },
  { kw: 'v for vendetta', src: '侵权图库', note: 'V字仇杀队' }, { kw: 'pacific rim', src: '侵权图库', note: '环太平洋' },
  { kw: 'ninja turtles', src: '侵权图库', note: '忍者神龟' }, { kw: 'jurassic park', src: '侵权图库', note: '侏罗纪公园' },
  { kw: 'minions', src: '侵权图库', note: '小黄人' }, { kw: 'transformers', src: '侵权图库', note: '变形金刚' },
  { kw: 'pulp fiction', src: '侵权图库', note: '低俗小说' }, { kw: 'suspiria', src: '侵权图库', note: '阴风阵阵' },
  { kw: 'beetlejuice', src: '侵权图库' }, { kw: 'friends', src: '侵权图库', note: '老友记' },
  { kw: 'stranger things', src: '侵权图库', note: '怪奇物语' }, { kw: 'cobra kai', src: '侵权图库' },
  { kw: 'vampire diaries', src: '侵权图库', note: '吸血鬼日记' }, { kw: 'walking dead', src: '侵权图库', note: '行尸走肉' },
  { kw: 'game of thrones', src: '侵权图库', note: '权力的游戏' }, { kw: 'money heist', src: '侵权图库', note: '纸钞屋' },
  { kw: 'peaky blinders', src: '侵权图库', note: '浴血黑帮' }, { kw: 'doctor who', src: '侵权图库', note: '神秘博士' },
  { kw: 'good omens', src: '侵权图库', note: '好兆头' }, { kw: 'breaking bad', src: '侵权图库', note: '绝命毒师' },
  { kw: 'hula hoop', src: '侵权图库', note: '呼啦圈（专利侵权）' },
  { kw: 'fortnite', src: '侵权图库', note: '堡垒之夜（美国封店）' }, { kw: 'cyberpunk 2077', src: '侵权图库', note: '赛博朋克' },
  { kw: 'bloodborne', src: '侵权图库', note: '血源诅咒' }, { kw: 'genshin impact', src: '侵权图库', note: '原神' },
  { kw: 'terraria', src: '侵权图库', note: '泰拉瑞亚' }, { kw: 'cd projekt', src: '侵权图库', note: '游戏公司' },
  { kw: 'ubisoft', src: '侵权图库', note: '育碧' }, { kw: 'mojang', src: '侵权图库' }, { kw: 'xbox game studios', src: '侵权图库' },
  { kw: 'supercell', src: '侵权图库' }, { kw: 'epic games', src: '侵权图库' }, { kw: 'psyonix', src: '侵权图库' },
  { kw: 'interplay', src: '侵权图库' }, { kw: 'krafton', src: '侵权图库' }, { kw: 'sega', src: '侵权图库', note: '世嘉' },
  { kw: 'fromsoftware', src: '侵权图库' }, { kw: 'mihoyo', src: '侵权图库', note: '米哈游' }, { kw: 're-logic', src: '侵权图库' },
  { kw: 'league of legends', src: '侵权图库', note: '英雄联盟' },
  // ---- 中奖图记录（作品/产品/艺术家 + ASIN） ----
  { kw: 'mermaid hanton', src: '中奖图记录', note: '人鱼汉顿 作者维权 danieleskridge.com' },
  { kw: 'danieleskridge', src: '中奖图记录', note: '作者维权官网' },
  { kw: 'white buffalo calf woman', src: '中奖图记录', note: 'Canvas Art' },
  { kw: 'cat bread clips', src: '中奖图记录', note: '猫面包夹' },
  { kw: 'guy buffet', src: '中奖图记录', note: 'Martini Print' },
  { kw: 'the world beyond the ice wall', src: '中奖图记录', note: 'Flat Earth Map' },
  { kw: 'poultry chicken breeds poster', src: '中奖图记录', note: '鸡品种海报' },
  { kw: 'human body meridians', src: '中奖图记录', note: '人体经络海报 ASIN:B0DT8PL5V5' },
  { kw: 'lakhdsfl', src: '中奖图记录', note: '品牌' },
  { kw: 'zukiy', src: '中奖图记录', note: 'The New Yorker Tennis Poster' },
  { kw: 'jerusalem at the center', src: '中奖图记录', note: '海报' },
  { kw: 'b0gwjvw7yx', src: '中奖图记录', note: 'Celebration Hurricanes' },
  { kw: 'b0g2r764rq', src: '中奖图记录', note: 'ZUKIY 纽约客海报' },
  { kw: 'b0dt8pl5v5', src: '中奖图记录', note: '人体经络海报' },
  { kw: 'ita realm poster', src: '中奖图记录' },
  { kw: 'japanese anime manga characters eyes poster', src: '中奖图记录', note: '动漫眼睛海报 被版权商盯上' },
  { kw: 'red drum', src: '中奖图记录', note: 'Terry Pratchetts Discworld' },
  { kw: 'hungyodon', src: '中奖图记录', note: '汽车遮阳板 BOF91BCZP2' },
  { kw: 'celebration hurricanes', src: '中奖图记录', note: '烟花玻璃杯 ASIN:B0GWJVW7YX' },
  // ---- 图库贰 附加常用风险提示 ----
  { kw: 'black light', src: '侵权图库', note: '黑光系列成套图' },
  { kw: 'vintage travel', src: '侵权图库', note: '复古旅游海报' },
  { kw: 'spacefrog', src: '侵权图库', note: '风格图片' },
  { kw: 'space needle', src: '侵权图库', note: '西雅图太空针塔' },
  { kw: 'grand canyon', src: '侵权图库', note: '大峡谷国家公园' },
  { kw: 'nice butt', src: '侵权图库', note: 'Purple Nice Butt Cat 系列' },
  { kw: 'new york city poster', src: '侵权图库', note: '纽约复古旅游海报' },
  { kw: 'propaganda', src: '侵权图库', note: '政治宣传类海报（违反受限）' },
  { kw: 'religious poster', src: '侵权图库', note: '科普/宗教类海报不要上' },
  { kw: 'motivational poster', src: '侵权图库', note: '励志海报（7 Life Rules 等）' },
  { kw: 'family tree', src: '侵权图库', note: '族谱海报' },
  { kw: 'retro french advertising', src: '侵权图库', note: '复古法国广告海报' },
  { kw: 'meridians', src: '侵权图库', note: '人体经络' },
  // ---- 图库贰 Life Rules 励志海报系列 原始词条（勿泛化删除） ----
  { kw: 'life rules', src: '侵权图库', note: 'Life Rules 励志海报系列（7 Life Rules 等）' },
  { kw: 'life rules inspirational posters', src: '侵权图库', note: 'Life Rules 励志海报原词条' },
  { kw: '7 life rules inspirational posters', src: '侵权图库', note: '7 Life Rules 励志海报' },
  { kw: '7 life rules', src: '侵权图库', note: '7 Life Rules 励志海报' },
  { kw: 'inspirational posters', src: '侵权图库', note: '励志海报通用词' },
  { kw: 'inspirational poster', src: '侵权图库', note: '励志海报通用词' },
  { kw: 'motivational posters', src: '侵权图库', note: '励志海报通用词' },
  { kw: 'title not found motivational', src: '侵权图库', note: '冰山激励短名海报' },
  { kw: 'propaganda posters', src: '侵权图库', note: '政治宣传类海报（违反受限商品政策）' },
  // ---- 金山文档 4 sheet 全量导入（2026-10-10，去重后新增）----
{ kw: "玛丽莲 梦露marilyn monroe", src: '中奖词库', note: "[律师函] 玛丽莲 梦露Marilyn Monroe" },
  { kw: "艾拉·费兹杰拉ella fitzgerald 美国歌手、演员", src: '中奖词库', note: "[律师函（她的名字即为文字商标）] 艾拉·费兹杰拉Ella Fitzgerald    美国歌手、演员" },
  { kw: "利尔·庞普 lil pum 美国说唱歌手", src: '中奖词库', note: "[律师函] 利尔·庞普 Lil Pum    美国说唱歌手" },
  { kw: "西德·巴勒特syd barrett 英国歌手、作曲者、吉他弹奏家、艺术家，因缔造了乐队平克·弗洛伊德（pink floyd）而著称", src: '中奖词库', note: "[律师函] 西德·巴勒特Syd Barrett    英国歌手、作曲者、吉他弹奏家、艺术家，因缔造了乐队平克·弗洛伊德（Pink Floyd）而著称" },
  { kw: "约翰尼·卡什 jonny cash 美国乡村歌手", src: '中奖词库', note: "[律师函] 约翰尼·卡什 Jonny Cash      美国乡村歌手" },
  { kw: "机关枪凯利machine gun kelly 美国说唱歌手、演员", src: '中奖词库', note: "[律师函] 机关枪凯利Machine Gun Kelly     美国说唱歌手、演员" },
  { kw: "saaheem m. valdery 美国黑人说唱歌手及其创立的品牌 sahbabii", src: '中奖词库', note: "[律师函] Saaheem M. Valdery  美国黑人说唱歌手及其创立的品牌   Sahbabii" },
  { kw: "卢克·库姆斯luke combs 美国乡村音乐歌手", src: '中奖词库', note: "[律师函] 卢克·库姆斯Luke Combs     美国乡村音乐歌手" },
  { kw: "埃尔维斯·普雷斯利elvis presley (猫王） 歌手、演员", src: '中奖词库', note: "[律师函] 埃尔维斯·普雷斯利Elvis Presley   (猫王）    歌手、演员" },
  { kw: "scarlxrd面具嘶吼哥marius listhrop aka scarlxrd 英国说唱歌手", src: '中奖词库', note: "[律师函] Scarlxrd面具嘶吼哥Marius Listhrop AKA Scarlxrd   英国说唱歌手" },
  { kw: "科特·柯本kurt cobain 美国歌手，涅槃乐队nirvana乐队的主唱兼吉他手", src: '中奖词库', note: "[律师函] 科特·柯本Kurt Cobain    美国歌手，涅槃乐队Nirvana乐队的主唱兼吉他手" },
  { kw: "莱米·凯尔密斯特lemmy kilmister 摩托头乐队motorhead 主唱", src: '中奖词库', note: "[律师函] 莱米·凯尔密斯特Lemmy Kilmister    摩托头乐队Motorhead 主唱" },
  { kw: "terry o’neill terry o’neill cbe 是世界上收藏最多的摄影师之一，其作品挂在世界各地的国家美术馆和私人收藏中。从总统到流行歌星，他拍摄了六十多年的名人前线。", src: '中奖词库', note: "[律师函] TERRY O’NEILL Terry O’Neill CBE 是世界上收藏最多的摄影师之一，其作品挂在世界各地的国家美术馆和私人收藏中。从总统到流行歌星，他拍摄了六十多年的名人前线。" },
  { kw: "margaret leann rimes玛格丽特·黎安·莱姆斯 美国歌手", src: '中奖词库', note: "[侵权、律师函] Margaret LeAnn Rimes玛格丽特·黎安·莱姆斯 美国歌手" },
  { kw: "linda ronstadt琳达·朗丝黛 美国歌手", src: '中奖词库', note: "[侵权、律师函] Linda Ronstadt琳达·朗丝黛 美国歌手" },
  { kw: "josh groban乔诗·葛洛班 美国古典跨界歌手、演员", src: '中奖词库', note: "[侵权、律师函] Josh Groban乔诗·葛洛班  美国古典跨界歌手、演员" },
  { kw: "michelle branch蜜雪儿·布兰奇 美国音乐人", src: '中奖词库', note: "[侵权、律师函] Michelle Branch蜜雪儿·布兰奇 美国音乐人" },
  { kw: "adam mitchel anselm lambert亚当·兰伯特 美国流行乐男歌手", src: '中奖词库', note: "[侵权、律师函] Adam Mitchel Anselm Lambert亚当·兰伯特  美国流行乐男歌手" },
  { kw: "jake miller杰克·米勒 美国歌手", src: '中奖词库', note: "[侵权、律师函] Jake Miller杰克·米勒 美国歌手" },
  { kw: "tori amos多莉艾莫丝 美国歌手", src: '中奖词库', note: "[侵权、律师函] Tori Amos多莉艾莫丝 美国歌手" },
  { kw: "brandy norwood布兰迪·诺伍德 美国女歌手", src: '中奖词库', note: "[侵权、律师函] Brandy Norwood布兰迪·诺伍德 美国女歌手" },
  { kw: "cher雪儿 美国女歌手", src: '中奖词库', note: "[侵权、律师函] CHER雪儿 美国女歌手" },
  { kw: "craig david克雷格·大卫 英国男歌手", src: '中奖词库', note: "[侵权、律师函] Craig David克雷格·大卫 英国男歌手" },
  { kw: "missy elliott梅西·埃丽奥特 美国嘻哈女艺人", src: '中奖词库', note: "[侵权、律师函] Missy Elliott梅西·埃丽奥特 美国嘻哈女艺人" },
  { kw: "david foster戴维·佛斯特 加拿大艺人", src: '中奖词库', note: "[侵权、律师函] David Foster戴维·佛斯特 加拿大艺人" },
  { kw: "faith hill菲丝·希尔 美国女歌手，演员", src: '中奖词库', note: "[侵权、律师函] Faith Hill菲丝·希尔 美国女歌手，演员" },
  { kw: "jewel珠儿 美国女歌手", src: '中奖词库', note: "[侵权、律师函] Jewel珠儿 美国女歌手" },
  { kw: "pat metheny派特·麦席尼 美国吉他手", src: '中奖词库', note: "[侵权、律师函] Pat Metheny派特·麦席尼  美国吉他手" },
  { kw: "alanis morissette艾拉妮丝·莫莉塞特 加拿大女歌手", src: '中奖词库', note: "[侵权、律师函] Alanis Morissette艾拉妮丝·莫莉塞特 加拿大女歌手" },
  { kw: "renee olstead蕾妮·奥斯泰德 美国歌手、演员", src: '中奖词库', note: "[侵权、律师函] Renee Olstead蕾妮·奥斯泰德  美国歌手、演员" },
  { kw: "ryan cabrera瑞安· 卡布雷拉 美国歌手", src: '中奖词库', note: "[侵权、律师函] Ryan Cabrera瑞安· 卡布雷拉 美国歌手" },
  { kw: "2kbaby 音乐家", src: '中奖词库', note: "[侵权、律师函] 2KBABY   音乐家" },
  { kw: "88-keys(艺名） 查尔斯·米索迪·恩贾帕charles misodi njapa 美国唱片制作人和说唱歌手", src: '中奖词库', note: "[侵权、律师函] 88-KEYS(艺名） 查尔斯·米索迪·恩贾帕Charles Misodi Njapa  美国唱片制作人和说唱歌手" },
  { kw: "adam melchor亚当·梅尔科尔 歌手", src: '中奖词库', note: "[侵权、律师函] Adam Melchor亚当·梅尔科尔 歌手" },
  { kw: "ali gatie 加拿大歌手", src: '中奖词库', note: "[侵权、律师函] Ali Gatie  加拿大歌手" },
  { kw: "amy allen艾米·艾伦 美国歌手", src: '中奖词库', note: "[侵权、律师函] Amy Allen艾米·艾伦 美国歌手" },
  { kw: "andra day安德拉·戴 美国歌手", src: '中奖词库', note: "[侵权、律师函] Andra Day安德拉·戴 美国歌手" },
  { kw: "anitta安妮塔 巴西歌手", src: '中奖词库', note: "[侵权、律师函] Anitta安妮塔 巴西歌手" },
  { kw: "anne-marie阿内-玛丽 英国流行乐女歌手、词曲作者", src: '中奖词库', note: "[侵权、律师函] Anne-Marie阿内-玛丽 英国流行乐女歌手、词曲作者" },
  { kw: "ashnikko 美国歌手", src: '中奖词库', note: "[侵权、律师函] Ashnikko  美国歌手" },
  { kw: "baka not nice 加拿大说唱歌手", src: '中奖词库', note: "[侵权、律师函] Baka Not Nice 加拿大说唱歌手" },
  { kw: "bebe rexha碧碧·雷克萨 美国歌手", src: '中奖词库', note: "[侵权、律师函] Bebe Rexha碧碧·雷克萨  美国歌手" },
  { kw: "belle mt. 英国歌手", src: '中奖词库', note: "[侵权、律师函] Belle Mt. 英国歌手" },
  { kw: "big homie ty.ni 美国嘻哈歌手", src: '中奖词库', note: "[侵权、律师函] Big Homie Ty.Ni  美国嘻哈歌手" },
  { kw: "bktherula 美国嘻哈歌手", src: '中奖词库', note: "[侵权、律师函] Bktherula 美国嘻哈歌手" },
  { kw: "black fortune 美国嘻哈歌手", src: '中奖词库', note: "[侵权、律师函] black fortune 美国嘻哈歌手" },
  { kw: "black noi$e 美国音乐人", src: '中奖词库', note: "[侵权、律师函] Black Noi$e 美国音乐人" },
  { kw: "brandy clark布兰迪·克拉克 美国乡村音乐创作歌手", src: '中奖词库', note: "[侵权、律师函] Brandy Clark布兰迪·克拉克  美国乡村音乐创作歌手" },
  { kw: "bren joy 美国歌手", src: '中奖词库', note: "[侵权、律师函] bren joy 美国歌手" },
  { kw: "brother sundance 美国歌手", src: '中奖词库', note: "[侵权、律师函] Brother Sundance 美国歌手" },
  { kw: "bryce vine布萊斯·範涅 美国饶舌歌手", src: '中奖词库', note: "[侵权、律师函] Bryce Vine布萊斯·範涅 美国饶舌歌手" },
  { kw: "carlie hanson卡莉·漢森 美国歌手", src: '中奖词库', note: "[侵权、律师函] Carlie Hanson卡莉·漢森 美国歌手" },
  { kw: "cavetown 原名robin daniel skinner 英国创作歌手", src: '中奖词库', note: "[侵权、律师函] Cavetown 原名Robin Daniel Skinner 英国创作歌手" },
  { kw: "chika 全名：jane chika oranika 美国说唱歌手", src: '中奖词库', note: "[侵权、律师函] CHIKA 全名：Jane Chika Oranika 美国说唱歌手" },
  { kw: "christian akridge克里斯蒂安·阿克里奇", src: '中奖词库', note: "[侵权、律师函] Christian Akridge克里斯蒂安·阿克里奇" },
  { kw: "cj 原名christopher daniel soriano, jr. 美国说唱歌手", src: '中奖词库', note: "[侵权、律师函] CJ 原名Christopher Daniel Soriano, Jr. 美国说唱歌手" },
  { kw: "cmten 歌手", src: '中奖词库', note: "[侵权、律师函] CMTEN 歌手" },
  { kw: "conor oberst康納·奧博斯特 美國歌手", src: '中奖词库', note: "[侵权、律师函] Conor Oberst康納·奧博斯特 美國歌手" },
  { kw: "conor matthews康诺·马修 美国歌手", src: '中奖词库', note: "[侵权、律师函] Conor Matthews康诺·马修 美国歌手" },
  { kw: "curly j 美国说唱歌手", src: '中奖词库', note: "[侵权、律师函] Curly J 美国说唱歌手" },
  { kw: "dan auerbach丹·奧尔巴赫 美国音乐家", src: '中奖词库', note: "[侵权、律师函] Dan Auerbach丹·奧尔巴赫 美国音乐家" },
  { kw: "david auerbach大卫·奧尔巴赫 美国作家", src: '中奖词库', note: "[侵权、律师函] David Auerbach大卫·奧尔巴赫 美国作家" },
  { kw: "david guetta大卫·库塔 法国dj", src: '中奖词库', note: "[侵权、律师函] David Guetta大卫·库塔 法国DJ" },
  { kw: "david sabastian大卫·薩巴斯蒂安 美国艺术家", src: '中奖词库', note: "[侵权、律师函] David Sabastian大卫·薩巴斯蒂安 美国艺术家" },
  { kw: "devendra banhart德凡德拉·班哈特 美国音乐人", src: '中奖词库', note: "[侵权、律师函] Devendra Banhart德凡德拉·班哈特   美国音乐人" },
  { kw: "dijon 歌手", src: '中奖词库', note: "[侵权、律师函] Dijon 歌手" },
  { kw: "dua lipa杜阿·利帕", src: '中奖词库', note: "[侵权、律师函] Dua Lipa杜阿·利帕" },
  { kw: "earl sweatshirt運動衫小霸王 美国饶舌歌手", src: '中奖词库', note: "[侵权、律师函] Earl Sweatshirt運動衫小霸王 美国饶舌歌手" },
  { kw: "emily weisband 埃米莉·魏斯本德", src: '中奖词库', note: "[侵权、律师函] Emily Weisband 埃米莉·魏斯本德" },
  { kw: "emmylou harris愛美蘿·哈里斯 美國歌手", src: '中奖词库', note: "[侵权、律师函] Emmylou Harris愛美蘿·哈里斯 美國歌手" },
  { kw: "eric clapton艾瑞克·克萊普頓 英国音乐家", src: '中奖词库', note: "[侵权、律师函] Eric Clapton艾瑞克·克萊普頓 英国音乐家" },
  { kw: "erica banks艾瑞卡·班克斯 美国饶舌歌手", src: '中奖词库', note: "[侵权、律师函] Erica Banks艾瑞卡·班克斯 美国饶舌歌手" },
  { kw: "ethan gruska伊森·格魯斯卡 歌手", src: '中奖词库', note: "[侵权、律师函] Ethan Gruska伊森·格魯斯卡 歌手" },
  { kw: "freddie gibbs弗雷迪·吉布斯 美国饶舌歌手", src: '中奖词库', note: "[侵权、律师函] Freddie Gibbs弗雷迪·吉布斯 美国饶舌歌手" },
  { kw: "gary clark jr.小格里·克拉克 美国音乐家", src: '中奖词库', note: "[侵权、律师函] Gary Clark Jr.小格里·克拉克  美国音乐家" },
  { kw: "gerard way杰洛德·威 美国歌手", src: '中奖词库', note: "[侵权、律师函] Gerard Way杰洛德·威 美国歌手" },
  { kw: "griff 原名sarah faith griffiths 英国创作歌手", src: '中奖词库', note: "[侵权、律师函] Griff 原名Sarah Faith Griffiths 英国创作歌手" },
  { kw: "hobo johnson 是hobo johnson和lovemakers的主唱", src: '中奖词库', note: "[侵权、律师函] Hobo Johnson 是Hobo Johnson和LoveMakers的主唱" },
  { kw: "idk 美国说唱歌手", src: '中奖词库', note: "[侵权、律师函] IDK 美国说唱歌手" },
  { kw: "isaiah rashad以赛亚·拉沙德 美国饶舌歌手", src: '中奖词库', note: "[侵权、律师函] Isaiah Rashad以赛亚·拉沙德 美国饶舌歌手" },
  { kw: "iv4 歌手", src: '中奖词库', note: "[侵权、律师函] IV4 歌手" },
  { kw: "jennifer diane lewis珍妮·刘易斯 美国歌手", src: '中奖词库', note: "[侵权、律师函] Jennifer Diane Lewis珍妮·刘易斯 美国歌手" },
  { kw: "john-robert 音乐艺术家", src: '中奖词库', note: "[侵权、律师函] John-Robert  音乐艺术家" },
  { kw: "jojo 原名joanna noëlle blagden levesque 美国r&b和流行音乐歌手", src: '中奖词库', note: "[侵权、律师函] JoJo 原名Joanna Noëlle Blagden Levesque 美国R&B和流行音乐歌手" },
  { kw: "josh richards 加拿大媒体的影业者", src: '中奖词库', note: "[侵权、律师函] Josh Richards 加拿大媒体的影业者" },
  { kw: "joshua bassett約書亞·巴賽特 美国创作歌手及演员", src: '中奖词库', note: "[侵权、律师函] Joshua bassett約書亞·巴賽特 美国创作歌手及演员" },
  { kw: "joshua redman約書亞·雷德曼 美國爵士薩克斯管演奏家和作曲家", src: '中奖词库', note: "[侵权、律师函] joshua redman約書亞·雷德曼  美國爵士薩克斯管演奏家和作曲家" },
  { kw: "joshua speers喬舒亞·施佩爾斯 歌手", src: '中奖词库', note: "[侵权、律师函] Joshua Speers喬舒亞·施佩爾斯  歌手" },
  { kw: "kathleen 歌手", src: '中奖词库', note: "[侵权、律师函] kathleen 歌手" },
  { kw: "k.d. lang 創作型歌手", src: '中奖词库', note: "[侵权、律师函] k.d. lang 創作型歌手" },
  { kw: "keedron bryant 美国歌手", src: '中奖词库', note: "[侵权、律师函] Keedron Bryant  美国歌手" },
  { kw: "khushi 歌手", src: '中奖词库', note: "[侵权、律师函] Khushi 歌手" },
  { kw: "l devine 英国歌手", src: '中奖词库', note: "[侵权、律师函] L Devine 英国歌手" },
  { kw: "lianne la havas麗昂妮·拉·哈瓦斯 英國創作歌手", src: '中奖词库', note: "[侵权、律师函] Lianne La Havas麗昂妮·拉·哈瓦斯 英國創作歌手" },
  { kw: "lewis blissett 音乐艺术家", src: '中奖词库', note: "[侵权、律师函] Lewis Blissett 音乐艺术家" },
  { kw: "liam gallagher連恩·蓋勒格 英国音乐家", src: '中奖词库', note: "[侵权、律师函] Liam Gallagher連恩·蓋勒格 英国音乐家" },
  { kw: "lil zay osama 美国说唱歌手", src: '中奖词库', note: "[侵权、律师函] Lil Zay Osama 美国说唱歌手" },
  { kw: "love mansuy 歌手", src: '中奖词库', note: "[侵权、律师函] Love Mansuy 歌手" },
  { kw: "madeline the person 歌手", src: '中奖词库', note: "[侵权、律师函] Madeline The Person  歌手" },
  { kw: "malia civetz 瑪麗亞·西維茨 歌手", src: '中奖词库', note: "[侵权、律师函] Malia Civetz 瑪麗亞·西維茨 歌手" },
  { kw: "counting crows 摇滚乐队", src: '中奖词库', note: "[律师函] Counting Crows      摇滚乐队" },
  { kw: "the black crowes 黑乌鸦乐队", src: '中奖词库', note: "[律师函] THE BLACK CROWES    黑乌鸦乐队" },
  { kw: "涅槃乐队nirvana 美国摇滚乐队", src: '中奖词库', note: "[侵权、律师函] 涅槃乐队Nirvana          美国摇滚乐队" },
  { kw: "大卫·吉尔摩david gilmour 是pink floyd乐队的吉他手兼主唱", src: '中奖词库', note: "[律师函] 大卫·吉尔摩David gilmour  是Pink Floyd乐队的吉他手兼主唱" },
  { kw: "run-d.m.c. 美国著名黑人说唱乐队", src: '中奖词库', note: "[律师函] Run-D.M.C.   美国著名黑人说唱乐队" },
  { kw: "lynyrd skynyrd 美国摇滚乐队", src: '中奖词库', note: "[律师函] Lynyrd Skynyrd    美国摇滚乐队" },
  { kw: "冰冻地球乐队iced earth 美国摇滚乐队", src: '中奖词库', note: "[律师函] 冰冻地球乐队Iced Earth   美国摇滚乐队" },
  { kw: "平克·弗洛伊德pink floyd 英国摇滚乐队", src: '中奖词库', note: "[律师函] 平克·弗洛伊德Pink Floyd       英国摇滚乐队" },
  { kw: "铁娘子乐队iron maiden 英国著名重金属乐队", src: '中奖词库', note: "[律师函] 铁娘子乐队Iron Maiden   英国著名重金属乐队" },
  { kw: "齐柏林飞艇乐队 led zeppelin 英国乐队", src: '中奖词库', note: "[律师函] 齐柏林飞艇乐队 LED ZEPPELIN   英国乐队" },
  { kw: "gratitude感恩乐团 美国摇滚乐队", src: '中奖词库', note: "[侵权、律师函] Gratitude感恩乐团 美国摇滚乐队" },
  { kw: "fort minor黑暗堡垒 美国嘻哈乐队", src: '中奖词库', note: "[侵权、律师函] Fort Minor黑暗堡垒 美国嘻哈乐队" },
  { kw: "the click five5次方合唱团 美国乐团", src: '中奖词库', note: "[侵权、律师函] The Click Five5次方合唱团  美国乐团" },
  { kw: "r.e.m.乐队rem,又译为快转眼球乐队 美国摇滚乐队", src: '中奖词库', note: "[侵权、律师函] R.E.M.乐队rem,又译为快转眼球乐队 美国摇滚乐队" },
  { kw: "red hot chili peppers红辣椒乐队 美国摇滚乐队", src: '中奖词库', note: "[侵权、律师函] Red Hot Chili Peppers红辣椒乐队 美国摇滚乐队" },
  { kw: "third eye blind心灵蒙蔽合唱团 美国摇滚乐团", src: '中奖词库', note: "[侵权、律师函] Third Eye Blind心灵蒙蔽合唱团 美国摇滚乐团" },
  { kw: "disturbed骚动乐团 美国摇滚乐团", src: '中奖词库', note: "[侵权、律师函] Disturbed骚动乐团 美国摇滚乐团" },
  { kw: "the used二手货 美国摇滚乐队", src: '中奖词库', note: "[侵权、律师函] The Used二手货 美国摇滚乐队" },
  { kw: "garbage垃圾合唱团", src: '中奖词库', note: "[侵权、律师函] Garbage垃圾合唱团" },
  { kw: "echosmith回声史密斯 美国流行乐队", src: '中奖词库', note: "[侵权、律师函] Echosmith回声史密斯 美国流行乐队" },
  { kw: "atlas genius 另类摇滚乐队", src: '中奖词库', note: "[侵权、律师函] Atlas Genius 另类摇滚乐队" },
  { kw: "the corrs可儿家族合唱团", src: '中奖词库', note: "[侵权、律师函] The Corrs可儿家族合唱团" },
  { kw: "dream theater梦剧院乐队 美国金属乐队", src: '中奖词库', note: "[侵权、律师函] Dream Theater梦剧院乐队 美国金属乐队" },
  { kw: "bloodsimple血性汉子乐团 美国重金属乐队", src: '中奖词库', note: "[侵权、律师函] Bloodsimple血性汉子乐团 美国重金属乐队" },
  { kw: "99 neighbors 美国音乐团体", src: '中奖词库', note: "[侵权、律师函] 99 Neighbors 美国音乐团体" },
  { kw: "avenged sevenfold七倍报应乐队", src: '中奖词库', note: "[侵权、律师函] Avenged Sevenfold七倍报应乐队" },
  { kw: "biffy clyro比费克利罗乐团 苏格兰摇滚乐队", src: '中奖词库', note: "[侵权、律师函] Biffy Clyro比费克利罗乐团 苏格兰摇滚乐队" },
  { kw: "the black keys黑键乐队 美国乐队", src: '中奖词库', note: "[侵权、律师函] The Black Keys黑键乐队 美国乐队" },
  { kw: "dead sara 美国硬摇滚乐队", src: '中奖词库', note: "[侵权、律师函] Dead Sara  美国硬摇滚乐队" },
  { kw: "deftones盲音合唱团 美国乐队", src: '中奖词库', note: "[侵权、律师函] Deftones盲音合唱团  美国乐队" },
  { kw: "dvsn 加拿大的r＆b二重奏組", src: '中奖词库', note: "[侵权、律师函] Dvsn 加拿大的R＆B二重奏組" },
  { kw: "the flaming lips烈焰红唇合唱团 美国乐队", src: '中奖词库', note: "[侵权、律师函] The Flaming Lips烈焰红唇合唱团 美国乐队" },
  { kw: "foals乐队 英国摇滚乐队", src: '中奖词库', note: "[侵权、律师函] Foals乐队   英国摇滚乐队" },
  { kw: "goo goo dolls咕咕玩偶 美国摇滚乐团", src: '中奖词库', note: "[侵权、律师函] Goo Goo Dolls咕咕玩偶 美国摇滚乐团" },
  { kw: "the head and the heart 美国独立民谣团体", src: '中奖词库', note: "[侵权、律师函] The Head and the Heart  美国独立民谣团体" },
  { kw: "kronos quartet克洛諾斯四重奏 美國弦樂四重奏", src: '中奖词库', note: "[侵权、律师函] kronos quartet克洛諾斯四重奏  美國弦樂四重奏" },
  { kw: "lake street dive湖街潛水樂團", src: '中奖词库', note: "[侵权、律师函] Lake Street Dive湖街潛水樂團" },
  { kw: "lukas graham 丹麦乐团", src: '中奖词库', note: "[侵权、律师函] Lukas Graham   丹麦乐团" },
  { kw: "majid jordan馬吉德·喬丹 加拿大的r＆b二重奏組", src: '中奖词库', note: "[侵权、律师函] Majid Jordan馬吉德·喬丹   加拿大的R＆B二重奏組" },
  { kw: "拳王阿里muhammad ali", src: '中奖词库', note: "[律师函] 拳王阿里Muhammad Ali" },
  { kw: "彩虹猫nyan cat 街机游戏", src: '中奖词库', note: "[律师函] 彩虹猫NYAN CAT       街机游戏" },
  { kw: "爱心熊care bears", src: '中奖词库', note: "[律师函] 爱心熊care bears" },
  { kw: "蓝精灵the smurfs", src: '中奖词库', note: "[律师函] 蓝精灵The Smurfs" },
  { kw: "瓢虫少女 miraculous ladybug 法，日，韩，美共同制作的动画系列", src: '中奖词库', note: "[律师函] 瓢虫少女 Miraculous Ladybug        法，日，韩，美共同制作的动画系列" },
  { kw: "花生漫画 peanuts 花生漫画角色名 charlie brown,snoopy,woodstock,pigpen,peppermint patty,linus,sally,schroeder,franklin,marcie", src: '中奖词库', note: "[律师函] 花生漫画 PEANUTS 花生漫画角色名 charlie Brown,snoopy,woodstock,pigpen,peppermint patty,linus,sally,schroeder,franklin,marcie" },
  { kw: "拼贴艺术家eugenia loli 超现实主义复古拼贴艺术", src: '中奖词库', note: "[律师函] 拼贴艺术家Eugenia Loli 超现实主义复古拼贴艺术" },
  { kw: "弗里达·卡罗 frida kahlo 知名墨西哥女画家", src: '中奖词库', note: "[律师函] 弗里达·卡罗 Frida Kahlo  知名墨西哥女画家" },
  { kw: "曼彻斯特联足球俱乐部 manchester united f.c", src: '中奖词库', note: "[律师函] 曼彻斯特联足球俱乐部 Manchester United F.C" },
  { kw: "liverpool 利物浦足球俱乐部", src: '中奖词库', note: "[律师函] Liverpool   利物浦足球俱乐部" },
  { kw: "art ask agency 精灵独角兽品牌权利人 及其公司代理的其他品牌都不行", src: '中奖词库', note: "[律师函] Art Ask Agency    精灵独角兽品牌权利人  及其公司代理的其他品牌都不行" },
  { kw: "泰勒梅taylormade golf 阿迪达斯高尔夫球有限公司", src: '中奖词库', note: "[律师函] 泰勒梅Taylormade golf      阿迪达斯高尔夫球有限公司" },
  { kw: "克利夫兰cleveland golf 高尔夫品牌公司", src: '中奖词库', note: "[律师函] 克利夫兰Cleveland Golf     高尔夫品牌公司" },
  { kw: "折叠吸管finalstraw", src: '中奖词库', note: "[律师函] 折叠吸管finalstraw" },
  { kw: "鬼爪monster energy", src: '中奖词库', note: "[律师函] 鬼爪monster energy" },
  { kw: "哈雷·戴维森harley-davidson 世界顶级休闲摩托车品牌", src: '中奖词库', note: "[律师函] 哈雷·戴维森Harley-Davidson      世界顶级休闲摩托车品牌" },
  { kw: "雷朋欧克利 rayban-oakley", src: '中奖词库', note: "[律师函] 雷朋欧克利 rayban-oakley" },
  { kw: "costa del mar 眼镜", src: '中奖词库', note: "[律师函] Costa del mar 眼镜" },
  { kw: "纪梵希 givenchy", src: '中奖词库', note: "[律师函] 纪梵希 Givenchy" },
  { kw: "罗意威 loewe", src: '中奖词库', note: "[律师函] 罗意威  LOEWE" },
  { kw: "moncler (蒙口）萌可睐", src: '中奖词库', note: "[律师函] Moncler (蒙口）萌可睐" },
  { kw: "马克雅可布marc jacobs", src: '中奖词库', note: "[律师函] 马克雅可布Marc Jacobs" },
  { kw: "高雅德goyard 法国家族制箱商", src: '中奖词库', note: "[律师函] 高雅德Goyard                      法国家族制箱商" },
  { kw: "sneaker match 服饰潮牌,专门出售与各大知名品牌的联名定制款服饰", src: '中奖词库', note: "[律师函] Sneaker Match  服饰潮牌,专门出售与各大知名品牌的联名定制款服饰" },
  { kw: "狐狸头 fox racing/ fox head 一家私人体育用品公司", src: '中奖词库', note: "[律师函] 狐狸头 fox racing/ Fox Head   一家私人体育用品公司" },
  { kw: "巴塔哥尼亚 patagonia 美国的户外品牌", src: '中奖词库', note: "[律师函] 巴塔哥尼亚 Patagonia     美国的户外品牌" },
  { kw: "audi 奥迪", src: '中奖词库', note: "[律师函] Audi 奥迪" },
  { kw: "杰克丹尼尔 jack daniel’s", src: '中奖词库', note: "[律师函] 杰克丹尼尔 JACK DANIEL’S" },
  { kw: "nike的广告语\"just do it\"这几个字也不能出现在图中", src: '中奖词库', note: "[律师函] Nike的广告语\"just do it\"这几个字也不能出现在图中" },
  { kw: "king von金·馮 美国嘻哈歌手", src: '中奖词库', note: "[封店] King Von金·馮 美国嘻哈歌手" },
  { kw: "naruto火影忍者 日本漫画家岸本齐史创作的少年漫画", src: '中奖词库', note: "[侵权、封店] NARUTO火影忍者  日本漫画家岸本齐史创作的少年漫画" },
  { kw: "德雷克drake 音乐人创立的 ovo 音乐团体、街头品牌美国", src: '中奖词库', note: "[封店] 德雷克Drake    音乐人创立的 OVO      音乐团体、街头品牌美国" },
  { kw: "极速风流 rush 美国环球影业美国", src: '中奖词库', note: "[封店] 极速风流 Rush  美国环球影业美国" },
  { kw: "尼普西·哈塞尔 nipsey hussle 美国说唱歌手美国", src: '中奖词库', note: "[封店] 尼普西·哈塞尔 Nipsey Hussle    美国说唱歌手美国" },
  { kw: "韦恩·鲁尼 wayne rooney 英格兰足球运动员美国", src: '中奖词库', note: "[封店] 韦恩·鲁尼 Wayne Rooney    英格兰足球运动员美国" },
  { kw: "丹尼尔·里卡多 daniel ricciardo 澳大利亚一级方程式车手美国", src: '中奖词库', note: "[封店] 丹尼尔·里卡多 Daniel Ricciardo   澳大利亚一级方程式车手美国" },
  { kw: "lewis hamilton 刘易斯·汉密尔顿 f1史上第一位黑人车手美国", src: '中奖词库', note: "[封店] Lewis Hamilton  刘易斯·汉密尔顿    F1史上第一位黑人车手美国" },
  { kw: "妮琪·米娜nicki minaj 美国说唱乐女歌手美国", src: '中奖词库', note: "[封店] 妮琪·米娜Nicki Minaj       美国说唱乐女歌手美国" },
  { kw: "trip acid美国", src: '中奖词库', note: "[封店] trip acid美国" },
  { kw: "耶稣 jesus 基督教创始人美国", src: '中奖词库', note: "[封店] 耶稣 Jesus    基督教创始人美国" },
  { kw: "7 life rules inspirational /motivational posters 7条生活准则励志海报美国", src: '中奖词库', note: "[封店] 7 Life Rules inspirational /Motivational  posters  7条生活准则励志海报美国" },
  { kw: "sneaky cat 鬼猫 网红猫美国", src: '中奖词库', note: "[封店] Sneaky Cat 鬼猫         网红猫美国" },
  { kw: "赛博朋克2077 cyberpunk 2077 动作角色类游戏美国", src: '中奖词库', note: "[封店] 赛博朋克2077 Cyberpunk 2077  动作角色类游戏美国" },
  { kw: "斯坦·李 stan lee 漫画创作者、演员、编剧美国", src: '中奖词库', note: "[封店] 斯坦·李 Stan Lee       漫画创作者、演员、编剧美国" },
  { kw: "gorillaz 英国虚拟乐队美国", src: '中奖词库', note: "[封店] Gorillaz         英国虚拟乐队美国" },
  { kw: "kaws 街头艺术品牌 只要有kaws全部删除美国", src: '中奖词库', note: "[封店] Kaws 街头艺术品牌  只要有KAWS全部删除美国" },
  { kw: "ronaldo c罗美国", src: '中奖词库', note: "[封店] RoNaldo   C罗美国" },
  { kw: "尤文图斯足球俱乐部 juventus f.c.美国", src: '中奖词库', note: "[封店] 尤文图斯足球俱乐部 Juventus F.C.美国" },
  { kw: "fortnite midas 堡垒之夜点金手美国", src: '中奖词库', note: "[封店] Fortnite Midas 堡垒之夜点金手美国" },
  { kw: "eddie van halen 美国著名重金属乐队美国", src: '中奖词库', note: "[封店] Eddie Van Halen  美国著名重金属乐队美国" },
  { kw: "v字仇杀队美国", src: '中奖词库', note: "[封店] V字仇杀队美国" },
  { kw: "abba 是瑞典的流行组合乐队美国", src: '中奖词库', note: "[封店] ABBA  是瑞典的流行组合乐队美国" },
  { kw: "阿尔伯特·爱因斯坦albert einstein 现代物理学家美国", src: '中奖词库', note: "[封店] 阿尔伯特·爱因斯坦Albert Einstein  现代物理学家美国" },
  { kw: "michael tompsett 艺术家 创作类型：城市天际线和地图艺术美国", src: '中奖词库', note: "[封店] Michael tompsett  艺术家  创作类型：城市天际线和地图艺术美国" },
  { kw: "limp bizki 软饼干 美国摇滚乐队美国", src: '中奖词库', note: "[封店] Limp Bizki  软饼干    美国摇滚乐队美国" },
  { kw: "fred durst 弗里德·杜斯特美国", src: '中奖词库', note: "[封店] Fred Durst 弗里德·杜斯特美国" },
  { kw: "福特尼特又名堡垒之夜 (fortnite)-射击游戏美国", src: '中奖词库', note: "[封店] 福特尼特又名堡垒之夜 (Fortnite)-射击游戏美国" },
  { kw: "travis scott-歌手美国", src: '中奖词库', note: "[封店] Travis Scott-歌手美国" },
  { kw: "比莉·艾利什billie eilish-歌手美国", src: '中奖词库', note: "[封店] 比莉·艾利什Billie eilish-歌手美国" },
  { kw: "pearl jam 珍珠酱乐队 美国的摇滚乐队美国", src: '中奖词库', note: "[封店] pearl jam   珍珠酱乐队   美国的摇滚乐队美国" },
  { kw: "眼镜蛇 cobra kai 2018年美国电视剧美国", src: '中奖词库', note: "[封店] 眼镜蛇 Cobra Kai   2018年美国电视剧美国" },
  { kw: "好兆头good omens 出品公司亚马逊影业、bbc 奇幻喜剧", src: '中奖词库', note: "[封店] 好兆头Good Omens  出品公司亚马逊影业、BBC 奇幻喜剧" },
  { kw: "chrysler", src: '中奖词库', note: "[律师函] chrysler" },
  { kw: "manchesterunited-old trafford stadium biueprint poster", src: '中奖词库', note: "[律师函] ManchesterUnited-Old Trafford Stadium Biueprint Poster" },
  { kw: "christmas poster art print christmas", src: '中奖词库', note: "[律师函] Christmas Poster Art Print Christmas" },
  { kw: "christmas poster art print christma", src: '中奖词库', note: "[律师函] Christmas Poster Art Print Christma" },
  { kw: "vintage bordeaux wine", src: '中奖词库', note: "[律师函] Vintage Bordeaux Wine" },
  { kw: "making of a great martini guy buffet the making of perfect martini print", src: '中奖词库', note: "[律师函] Making of a Great Martini Guy Buffet The Making Of Perfect Martini Print" },
  { kw: "american indian art canvas poster", src: '中奖词库', note: "[律师函] American Indian Art Canvas Poster" },
  { kw: "the mended drum， terry pratchett's discworld", src: '中奖词库', note: "[封店] The Mended Drum， Terry Pratchett's Discworld" },
  { kw: "white buffalo calf woman canvas art", src: '中奖词库', note: "[律师函] White Buffalo Calf Woman Canvas Art" },
  { kw: "hand drawn vintage poster of map of major battles of the american revolutionary war", src: '中奖词库', note: "[封店] Hand Drawn Vintage Poster of Map of Major Battles of The American Revolutionary War" },
  { kw: "squid instant noodle fork octopus fun creative funny tableware instant noodle fork 4 piece", src: '中奖词库', note: "[封店] Squid instant noodle fork Octopus fun creative funny tableware instant noodle fork 4 piece" },
  { kw: "cat litter scoop cat poop picker comes with garbage bag set detachable cleaning pet supplies", src: '中奖词库', note: "[封店] Cat Litter Scoop cat Poop Picker Comes with Garbage Bag Set Detachable Cleaning pet Supplies" },
  { kw: "cat bread clips, fun cat bread ties, 3d cat butt funny, cute cat snack clips, kitchen toaster theme gifts", src: '中奖词库', note: "[封店] Cat Bread Clips, Fun cat Bread Ties, 3D cat Butt Funny, Cute cat Snack Clips, Kitchen Toaster Theme Gifts" },
  { kw: "freshwater gamefishes of virginia poster, virginia fishes poster, fishes of virginia poster", src: '中奖词库', note: "[律师函] Freshwater Gamefishes of Virginia Poster, Virginia Fishes Poster, Fishes of Virginia Poster" },
  { kw: "knives culinary poster food & cooking illustrations art print poster", src: '中奖词库', note: "[律师函] Knives Culinary Poster Food & Cooking Illustrations Art Print Poster" },
  { kw: "the new yorker tennis court cover - nyc wall art poster", src: '中奖词库', note: "[封店] The New Yorker Tennis Court Cover - Nyc Wall Art Poster" },
  { kw: "tate mcrae so close to what posters & prints on canvas wall art poster for room decor", src: '中奖词库', note: "[封店] Tate McRae So Close To What Posters & Prints on Canvas Wall Art Poster for Room Decor" },
  { kw: "保加利亚职业艺术家，主体：ivaylo nikolaev nikolov，笔名inikolov", src: '中奖词库', note: "[律师函] 保加利亚职业艺术家，主体：Ivaylo Nikolaev Nikolov，笔名INikolov" },
  { kw: "该产品版权是乐队专辑", src: '中奖图记录', note: "产品:Nirvana | 原因:否 | 来源:客户措施：出售补损" },
  { kw: "汽车品牌 chrysler", src: '中奖图记录', note: "产品:chrysler | 原因:否 | 来源:客户措施：注销执照弃店" },
  { kw: "足球俱乐部manchester", src: '中奖图记录', note: "产品:ManchesterUnited-Old Trafford Stadium Biueprint Poster | 原因:否 | 来源:客户措施：注销执照弃店" },
  { kw: "中标原因：artem coin退出的nft", src: '中奖图记录', note: "产品:Christmas Poster Art Print Christmas | 原因:否 | 来源:客户措施：关闭美站转战日站补损" },
  { kw: "尼基.波姆 nicky boehme 画家维权", src: '中奖图记录', note: "产品:Christmas Poster Art Print Christma | 原因:✔ | 来源:客户措施：1000刀和解" },
  { kw: "2025-cv-11003", src: '中奖图记录', note: "产品:Vintage Bordeaux Wine | 原因:✔ | 来源:客户措施：关闭美站转战澳站补损 | 措施:客户措施：1000刀和解" },
  { kw: "guy buffet 画家维权", src: '中奖图记录', note: "产品:Making of a Great Martini Guy Buffet The Making Of Perfect Martini Print | 原因:✔ | 来源:客户措施：1000刀和解 | 措施:B客户措施：出售3400RMB" },
  { kw: "martin grelle 画家维权", src: '中奖图记录', note: "产品:American Indian Art Canvas Poster | 原因:否 | 来源:客户措施：出售4300RMB" },
  { kw: "排名80-90w", src: '中奖图记录', note: "产品:Japanese Anime Manga Characters Eyes Poster | 原因:否 | 来源:客户措施：出售4100RMB" },
  { kw: "5月份被版权商盯上", src: '中奖图记录', note: "产品:Japanese Anime Manga Characters Eyes Poster | 原因:否 | 来源:客户措施：出售4100RMB" },
  { kw: "机扫", src: '中奖图记录', note: "产品:Terra Infinita Flat Earth Map Terra Infinita Realm Poster | 原因:否 | 来源:封店图" },
  { kw: "系统认为违反知识产权", src: '中奖图记录', note: "产品:Terra Infinita Flat Earth Map Terra Infinita Realm Poster | 原因:否 | 来源:封店图" },
  { kw: "美站 发明专利侵权 非外观侵权 专利号12256843", src: '中奖图记录', note: "产品:Candy-Shaped knobs, Kitchen Cabinet Handle Protectors, Decorative Covers (Pack of 6) | 原因:否" },
  { kw: "discworld/david wyatt 小说版权 74568064", src: '中奖图记录', note: "产品:The Mended Drum， Terry Pratchett's Discworld | 原因:否 | 来源:封店图，损失近700刀，01.06POA尝试失败" },
  { kw: "人鱼汉顿/mermaid hanton /人魚のハントンです", src: '中奖图记录', note: "产品:B0F91BCZP2 Hungyodon Car Sunshade, FrontSunshade, Light Cars, Suction Cups,UV Protection, Car Windows, UV Protection | 原因:否 | 来源:封店品，损失近5w日元" },
  { kw: "作者维权", src: '中奖图记录', note: "产品:White Buffalo Calf Woman Canvas Art | 原因:否 | 来源:客户措施：观察美站转战加站补损" },
  { kw: "官网作品名完全一致：https://danieleskridge.com/shop/prints", src: '中奖图记录', note: "产品:White Buffalo Calf Woman Canvas Art | 原因:否 | 来源:客户措施：观察美站转战加站补损" },
  { kw: "系统认为违反知识产权 asin:b0dsm6k39j", src: '中奖图记录', note: "产品:Hand Drawn Vintage Poster of Map of Major Battles of The American Revolutionary War | 原因:否 | 来源:机扫品，损失303美金" },
  { kw: "系统认为违反知识产权 asin:b0ft7c3k27", src: '中奖图记录', note: "产品:Squid instant noodle fork Octopus fun creative funny tableware instant noodle fork 4 piece | 原因:否 | 来源:机扫品，损失303美金" },
  { kw: "系统认为违反知识产权 asin:b0fmwd8m5y", src: '中奖图记录', note: "产品:Cat Litter Scoop cat Poop Picker Comes with Garbage Bag Set Detachable Cleaning pet Supplies | 原因:否 | 来源:机扫品，损失303美金" },
  { kw: "系统认为违反知识产权 asin:b0fkmwgtdv", src: '中奖图记录', note: "产品:Cat Bread Clips, Fun cat Bread Ties, 3D cat Butt Funny, Cute cat Snack Clips, Kitchen Toaster Theme Gifts | 原因:否 | 来源:机扫品，损失303美金" },
  { kw: "系统认为违反知识产权 asin:b0dnmd88fg", src: '中奖图记录', note: "产品:Freshwater Gamefishes of Virginia Poster, Virginia Fishes Poster, Fishes of Virginia Poster | 原因:否 | 来源:机扫品，损失303美金" },
  { kw: "tro", src: '中奖图记录', note: "产品:Knives Culinary Poster Food & Cooking Illustrations Art Print Poster | 原因:否 | 来源:TRO，损失1100刀，出售2500补损！" },
  { kw: "26-cv-01020", src: '中奖图记录', note: "产品:Knives Culinary Poster Food & Cooking Illustrations Art Print Poster | 原因:否 | 来源:TRO，损失1100刀，出售2500补损！" },
  { kw: "26-cv-00836", src: '中奖图记录', note: "产品:Poultry Chicken Breeds Poster | 原因:否 | 来源:幸运没事" },
  { kw: "26-cv-1646", src: '中奖图记录', note: "产品:Konstantin Korobov Yarrow Art Poster | 原因:否 | 来源:幸运没事" },
  { kw: "26-cv-4966", src: '中奖图记录', note: "产品:Martini | 原因:否 | 来源:TRO，300美金余额，目测来得及提现！" },
  { kw: "系统认为违反知识产权 asin:b0gwjvw7yx", src: '中奖图记录', note: "产品:B0GWJVW7YX Set of 3 CelebrationHurricanes, Etched Firework StarburstGlass Pedestals with Warm White LED Lights, Patriotic Starry Sky Lamp for | 原因:否 | 来源:机扫封店！" },
  { kw: "系统认为违反知识产权 asin:b0g2r764rq", src: '中奖图记录', note: "产品:B0G2R764RQ ZUKIY The New Yorker Tennis Court Cover - Nyc Wall Art Poster | 原因:否 | 来源:机扫封店！" },
  { kw: "系统认为违反知识产权 asin:b0dzcmgyvn", src: '中奖图记录', note: "产品:B0DZCMGYVN Tate McRae So Close To What Posters & Prints on Canvas Wall Art Poster for Room Decor | 原因:否 | 来源:机扫封店！" },
  { kw: "26-cv-1847", src: '中奖图记录', note: "产品:Jerusalem at The Center Christ Overlooks The Entire World, Surrounded by Angels-A Medieval World Map | 原因:否 | 来源:流氓律所盯上，余额340刀目前还能提现！" },
  { kw: "系统认为违反知识产权 asin:b0dt8pl5v5", src: '中奖图记录', note: "产品:Human Body Meridians, Acupuncture Poster Pressure Points Wall Decor, Chinese Medicine Poster, Body Lifelines Chart | 原因:否 | 来源:机扫封店，余额220刀！" },
  { kw: "比莉·艾利什billie eilish-歌手", src: '侵权图库壹', note: "[美国欧洲【必抓】] 比莉·艾利什Billie eilish-歌手" },
  { kw: "德拉科·马尔福queen draco malfoy tom felton-演员", src: '侵权图库壹', note: "[阿武整理] 德拉科·马尔福Queen Draco Malfoy Tom Felton-演员" },
  { kw: "朱斯·沃尔德 juice wrld-歌手", src: '侵权图库壹', note: "[阿武整理-【美国侵权】] 朱斯·沃尔德 Juice Wrld-歌手" },
  { kw: "埃米纳姆 eminem-说唱男歌手", src: '侵权图库壹', note: "[阿武整理] 埃米纳姆 Eminem-说唱男歌手" },
  { kw: "《赛博朋克2077》cyberpunk 2077 jacket gaming-游戏", src: '侵权图库壹', note: "[必抓（封店）] 《赛博朋克2077》Cyberpunk 2077 Jacket Gaming-游戏" },
  { kw: "波兹·马龙 post malone-歌手", src: '侵权图库壹', note: "[阿武整理-【美国侵权】] 波兹·马龙 Post Malone-歌手" },
  { kw: "美人鱼画painting of mermaid", src: '侵权图库壹', note: "[阿武] 美人鱼画Painting of Mermaid" },
  { kw: "2pac tupac shakur-说唱歌手", src: '侵权图库壹', note: "[必抓（封店）] 2pac Tupac Shakur-说唱歌手" },
  { kw: "艾德·希兰 ed sheeran-创作歌手", src: '侵权图库壹', note: "[阿武] 艾德·希兰 Ed Sheeran-创作歌手" },
  { kw: "travis scott-歌手", src: '侵权图库壹', note: "[美国欧洲【必抓】] Travis Scott-歌手" },
  { kw: "福特尼特又名堡垒之夜 (fortnite)-射击游戏", src: '侵权图库壹', note: "[必抓] 福特尼特又名堡垒之夜 (Fortnite)-射击游戏" },
  { kw: "《龙珠》dragonballdragon ball）如果有的话标题没有这个英文就没事", src: '侵权图库壹', note: "[（美国侵权）] 《龙珠》DragonballDragon Ball）如果有的话标题没有这个英文就没事" },
  { kw: "fred durst - limp bizki弗里德·杜斯特，美国演员、制片人、导演", src: '侵权图库壹', note: "[阿武整理-【必抓】] Fred Durst - Limp Bizki弗里德·杜斯特，美国演员、制片人、导演" },
  { kw: "asap rocky-美国饶舌歌手", src: '侵权图库壹', note: "[阿武] ASAP Rocky-美国饶舌歌手" },
  { kw: "《哈利·波特》harry potter", src: '侵权图库壹', note: "[必抓] 《哈利·波特》Harry Potter" },
  { kw: "forza horizon-极限竞速：地平线-竞速游戏", src: '侵权图库壹', note: "[必抓] Forza Horizon-极限竞速：地平线-竞速游戏" },
  { kw: "肖恩·蒙德兹（shawn mendes）-加拿大男歌手", src: '侵权图库壹', note: "[阿武] 肖恩·蒙德兹（Shawn Mendes）-加拿大男歌手" },
  { kw: "michael tompsett", src: '侵权图库壹', note: "[【必抓】] Michael tompsett" },
  { kw: "爱莉安娜·格兰德（ariana grande）-美国女歌手、演员", src: '侵权图库壹', note: "[美国欧洲] 爱莉安娜·格兰德（Ariana Grande）-美国女歌手、演员" },
  { kw: "品牌类侵权，比如阿迪达斯，耐克。足球球星衣服上面认真注意有没有汽车公司标志", src: '侵权图库壹', note: "[阿武] 品牌类侵权，比如阿迪达斯，耐克。足球球星衣服上面认真注意有没有汽车公司标志" },
  { kw: "篮球类的图片注意他们的鞋子品牌和图片上面有nba图像，标题不能带nba", src: '侵权图库壹', note: "[阿武] 篮球类的图片注意他们的鞋子品牌和图片上面有NBA图像，标题不能带NBA" },
  { kw: "汽车类标题不能带车的品牌名字：比如奥迪，奔驰，宝马 最好车的标志看不清楚的图片可以上，看的很清楚最好不要上", src: '侵权图库壹', note: "[阿武] 汽车类标题不能带车的品牌名字：比如奥迪，奔驰，宝马 最好车的标志看不清楚的图片可以上，看的很清楚最好不要上" },
  { kw: "星球大战", src: '侵权图库壹', note: "[（美国侵权）欧洲暂时不清楚|阿武] 星球大战" },
  { kw: "橄榄球找几张好看的就行", src: '侵权图库壹', note: "[阿武] 橄榄球找几张好看的就行" },
  { kw: "黄色图片露点的别的上", src: '侵权图库壹', note: "[阿武] 黄色图片露点的别的上" },
  { kw: "【漫威侵权】--以下为旗下英雄人物", src: '侵权图库壹', note: "[阿武] 【漫威侵权】--以下为旗下英雄人物" },
  { kw: "美国队长（captain america）", src: '侵权图库壹', note: "[阿武] 美国队长（Captain America）" },
  { kw: "钢铁侠 （iron man）", src: '侵权图库壹', note: "[阿武] 钢铁侠 （Iron Man）" },
  { kw: "雷神 （thor）", src: '侵权图库壹', note: "[阿武] 雷神  （Thor）" },
  { kw: "绿巨人（hulk）", src: '侵权图库壹', note: "[阿武] 绿巨人（Hulk）" },
  { kw: "黑寡妇 （black widow）", src: '侵权图库壹', note: "[阿武] 黑寡妇 （Black Widow）" },
  { kw: "鹰眼 （hawkeye）", src: '侵权图库壹', note: "[阿武] 鹰眼  （Hawkeye）" },
  { kw: "死侍 （deadpool）", src: '侵权图库壹', note: "[阿武] 死侍  （Deadpool）" },
  { kw: "毒液 （venom）", src: '侵权图库壹', note: "[阿武] 毒液  （Venom）" },
  { kw: "哨兵 （sentry）", src: '侵权图库壹', note: "[阿武] 哨兵  （Sentry）" },
  { kw: "白皇后 （white queen）", src: '侵权图库壹', note: "[阿武] 白皇后 （White Queen）" },
  { kw: "万磁王 （magneto）", src: '侵权图库壹', note: "[阿武] 万磁王  （Magneto）" },
  { kw: "金刚狼 （wolverine）", src: '侵权图库壹', note: "[阿武] 金刚狼  （Wolverine）" },
  { kw: "镭射眼 (cyclops)", src: '侵权图库壹', note: "[阿武] 镭射眼  (Cyclops)" },
  { kw: "恶灵骑士 （ghost rider）", src: '侵权图库壹', note: "[阿武] 恶灵骑士 （Ghost Rider）" },
  { kw: "银影侠 （silver surfer）", src: '侵权图库壹', note: "[阿武] 银影侠  （Silver Surfer）" },
  { kw: "艾丽卡 (elektra)", src: '侵权图库壹', note: "[阿武] 艾丽卡  (Elektra)" },
  { kw: "战争机器 （war machine）", src: '侵权图库壹', note: "[阿武] 战争机器  （War Machine）" },
  { kw: "牌皇 (gambit)", src: '侵权图库壹', note: "[阿武] 牌皇  (Gambit)" },
  { kw: "红骷髅 （red skull）", src: '侵权图库壹', note: "[阿武] 红骷髅 （Red Skull）" },
  { kw: "红浩克 (red hulk)", src: '侵权图库壹', note: "[阿武] 红浩克  (Red Hulk)" },
  { kw: "夜魔侠 (daredevil)", src: '侵权图库壹', note: "[阿武] 夜魔侠  (Daredevil)" },
  { kw: "新星 （nova）", src: '侵权图库壹', note: "[阿武] 新星  （Nova）" },
  { kw: "惩罚者 （punisher）", src: '侵权图库壹', note: "[阿武] 惩罚者  （Punisher）" },
  { kw: "巴基·巴恩斯【冬日战士】 （winter soldier）", src: '侵权图库壹', note: "[阿武] 巴基·巴恩斯【冬日战士】 （Winter Soldier）" },
  { kw: "尼克 弗瑞（nickfury）", src: '侵权图库壹', note: "[阿武] 尼克 弗瑞（NickFury）" },
  { kw: "屠杀（carnage）", src: '侵权图库壹', note: "[阿武] 屠杀（Carnage）" },
  { kw: "黑豹(black panther)", src: '侵权图库壹', note: "[阿武] 黑豹(Black Panther)" },
  { kw: "钢力士（colossus）", src: '侵权图库壹', note: "[阿武] 钢力士（Colossus）" },
  { kw: "x-23（laura kinney）", src: '侵权图库壹', note: "[阿武] X-23（Laura Kinney）" },
  { kw: "灭霸（thanos）", src: '侵权图库壹', note: "[阿武] 灭霸（Thanos）" },
  { kw: "那摩(namor)", src: '侵权图库壹', note: "[阿武] 那摩(Namor)" },
  { kw: "章鱼博士(doctor octopus)", src: '侵权图库壹', note: "[阿武] 章鱼博士(Doctor Octopus)" },
  { kw: "绯红女巫（scarlet witch）.", src: '侵权图库壹', note: "[阿武] 绯红女巫（Scarlet Witch）." },
  { kw: "霹雳火（human torch）", src: '侵权图库壹', note: "[阿武] 霹雳火（Human Torch）" },
  { kw: "蚁人（ant-man）", src: '侵权图库壹', note: "[阿武] 蚁人（Ant-Man）" },
  { kw: "行星吞噬者（galactus）", src: '侵权图库壹', note: "[阿武] 行星吞噬者（Galactus）" },
  { kw: "月光骑士（moon knight）", src: '侵权图库壹', note: "[阿武] 月光骑士（Moon Knight）" },
  { kw: "红坦克（juggernaut）", src: '侵权图库壹', note: "[阿武] 红坦克（Juggernaut）" },
  { kw: "马面雷神（beta ray bill）", src: '侵权图库壹', note: "[阿武] 马面雷神（Beta Ray Bill）" },
  { kw: "萨卡 海格力斯（heracles）", src: '侵权图库壹', note: "[阿武] 萨卡 海格力斯（Heracles）" },
  { kw: "霍普·萨默斯（hope summers）", src: '侵权图库壹', note: "[阿武] 霍普·萨默斯（Hope Summers）" },
  { kw: "吞星之女 伽娜塔（gali）", src: '侵权图库壹', note: "[阿武] 吞星之女 伽娜塔（Gali）" },
  { kw: "刀锋战士(blade)", src: '侵权图库壹', note: "[阿武] 刀锋战士(Blade)" },
  { kw: "神力侠 卢克凯奇(luke cage)", src: '侵权图库壹', note: "[阿武] 神力侠 卢克凯奇(Luke Cage)" },
  { kw: "铁拳（iron fist）", src: '侵权图库壹', note: "[阿武] 铁拳（Iron Fist）" },
  { kw: "魔形女（mystique）", src: '侵权图库壹', note: "[阿武] 魔形女（Mystique）" },
  { kw: "英国队长（captain britain）", src: '侵权图库壹', note: "[阿武] 英国队长（Captain Britain）" },
  { kw: "冰人（iceman）", src: '侵权图库壹', note: "[阿武] 冰人（Iceman）" },
  { kw: "小淘气【罗刹女】（rogue）", src: '侵权图库壹', note: "[阿武] 小淘气【罗刹女】（Rogue）" },
  { kw: "毁灭博士（doctor doom）", src: '侵权图库壹', note: "[阿武] 毁灭博士（Doctor Doom）" },
  { kw: "幻视（vision）", src: '侵权图库壹', note: "[阿武] 幻视（Vision）" },
  { kw: "女浩克（she-hulk）", src: '侵权图库壹', note: "[阿武] 女浩克（She-Hulk）" },
  { kw: "银河护卫队（guardians of the galaxy）", src: '侵权图库壹', note: "[阿武] 银河护卫队（Guardians of the Galaxy）" },
  { kw: "【迪士尼侵权】--以下为旗下卡通人物", src: '侵权图库壹', note: "[阿武] 【迪士尼侵权】--以下为旗下卡通人物" },
  { kw: "米妮老鼠（英文名称：minnie mouse )", src: '侵权图库壹', note: "[阿武] 米妮老鼠（英文名称：Minnie Mouse )" },
  { kw: "米奇老鼠（英文名称：mickey mouse）", src: '侵权图库壹', note: "[阿武] 米奇老鼠（英文名称：Mickey Mouse）" },
  { kw: "唐老鸭", src: '侵权图库壹', note: "[阿武] 唐老鸭" },
  { kw: "高飞-goofy", src: '侵权图库壹', note: "[阿武] 高飞-goofy" },
  { kw: "消消", src: '侵权图库壹', note: "[阿武] 消消" },
  { kw: "消乐等等还有其他卡通，自己去查", src: '侵权图库壹', note: "[阿武] 消乐等等还有其他卡通，自己去查" },
  { kw: "任天堂侵权", src: '侵权图库壹', note: "[阿武] 任天堂侵权" },
  { kw: "漫威旗下所有超级英雄（电影剧照）----可以针对性选其人物的生活照", src: '侵权图库壹', note: "[李少忠] 漫威旗下所有超级英雄（电影剧照）----可以针对性选其人物的生活照" },
  { kw: "nba标题 （找图的时候也要把nba的标志抠掉）可以更换成：basketball player 之类的别称", src: '侵权图库壹', note: "[李少忠] NBA标题 （找图的时候也要把NBA的标志抠掉）可以更换成：Basketball player 之类的别称" },
  { kw: "哈利波特（电影剧照）", src: '侵权图库壹', note: "[必抓] 哈利波特（电影剧照）" },
  { kw: "甲壳虫乐队（音乐海报）", src: '侵权图库壹', note: "[美国] 甲壳虫乐队（音乐海报）" },
  { kw: "weeknd（加拿大歌手）", src: '侵权图库壹', note: "[美国] Weeknd（加拿大歌手）" },
  { kw: "变形金刚（电影海报）", src: '侵权图库壹', note: "[李少忠] 变形金刚（电影海报）" },
  { kw: "吃鸡游戏（游戏海报）", src: '侵权图库壹', note: "[李少忠] 吃鸡游戏（游戏海报）" },
  { kw: "emoji表情包", src: '侵权图库壹', note: "[李少忠] emoji表情包" },
  { kw: "英雄联盟（游戏海报）", src: '侵权图库壹', note: "[李少忠] 英雄联盟（游戏海报）" },
  { kw: "阿迪 耐克 kappa 照片里面有出现商标的。尽量抠掉或者涂掉", src: '侵权图库壹', note: "[李少忠] 阿迪 耐克 kappa 照片里面有出现商标的。尽量抠掉或者涂掉" },
  { kw: "贾斯汀·比伯 justin bieber（歌手）（欧洲也不要上）", src: '侵权图库壹', note: "[美国欧洲] 贾斯汀·比伯 Justin Bieber（歌手）（欧洲也不要上）" },
  { kw: "astroworld（歌手）- travis scott 全新专辑《astroworld》", src: '侵权图库壹', note: "[林航] astroworld（歌手）- Travis Scott 全新专辑《Astroworld》" },
  { kw: "这种类型的世界地图", src: '侵权图库壹', note: "[余志勇] 这种类型的世界地图" },
  { kw: "这种类型的", src: '侵权图库壹', note: "[余志勇] 这种类型的" },
  { kw: "bob orsillo artist", src: '侵权图库壹', note: "[美国] bob orsillo artist" },
  { kw: "阿琪雅纳·卡玛瑞克akiane kramarik -是当今世界公认的\"天才\"画家兼诗人", src: '侵权图库壹', note: "[美国欧洲（抓图）] 阿琪雅纳·卡玛瑞克Akiane kramarik -是当今世界公认的\"天才\"画家兼诗人" },
  { kw: "阿尔伯特·爱因斯坦(德语/英语:albert einstein", src: '侵权图库壹', note: "[美国抓] 阿尔伯特·爱因斯坦(德语/英语:Albert Einstein" },
  { kw: "abba 是瑞典的流行组合乐队，成立于1972年。", src: '侵权图库壹', note: "[封店] ABBA  是瑞典的流行组合乐队，成立于1972年。" },
  { kw: "足球罗纳尔多", src: '侵权图库壹', note: "足球罗纳尔多" },
  { kw: "v字仇杀队。抓！", src: '侵权图库壹', note: "[美国抓！美国] V字仇杀队。抓！" },
  { kw: "不爽猫", src: '侵权图库壹', note: "[必抓] 不爽猫" },
  { kw: "《灵异妙探》（英语：psych）是一部美国侦探/罪案电视剧作品", src: '侵权图库壹', note: "《灵异妙探》（英语：Psych）是一部美国侦探/罪案电视剧作品" },
  { kw: "eddie van halen 职业：唱作人、制作人、演奏家 生卒：1955年1月26日-2020年10月7日", src: '侵权图库壹', note: "[美国封店] Eddie Van Halen 职业：唱作人、制作人、演奏家 生卒：1955年1月26日-2020年10月7日" },
  { kw: "fortnite midas", src: '侵权图库壹', note: "[必抓] Fortnite Midas" },
  { kw: "nirvana (美国摇滚乐队)", src: '侵权图库壹', note: "Nirvana   (美国摇滚乐队)" },
  { kw: "欧洲和美国，只要有kaws全部删除，开始封店了", src: '侵权图库壹', note: "[必抓] 欧洲和美国，只要有KAWS全部删除，开始封店了" },
  { kw: "marshmello侵权棉花糖 （美国dj、电音制作人marshmello）", src: '侵权图库壹', note: "[美国] Marshmello侵权棉花糖 （美国DJ、电音制作人Marshmello）" },
  { kw: "gorillaz英国虚拟乐队", src: '侵权图库壹', note: "[封店] Gorillaz英国虚拟乐队" },
  { kw: "侵权 ro naldo juventus", src: '侵权图库壹', note: "[必抓] 侵权 Ro Naldo Juventus" },
  { kw: "anime guy with mask male", src: '侵权图库壹', note: "[欧洲] Anime Guy with Mask male" },
  { kw: "brawl stars 《荒野乱斗》", src: '侵权图库壹', note: "[欧洲侵权|欧洲] Brawl Stars   《荒野乱斗》" },
  { kw: "tokyo ghoul 电视动画《东京食尸鬼》尸和鬼抓", src: '侵权图库壹', note: "[美国] tokyo ghoul 电视动画《东京食尸鬼》尸和鬼抓" },
  { kw: "minecraft 我的世界-欧洲侵权", src: '侵权图库壹', note: "[欧洲] Minecraft 我的世界-欧洲侵权" },
  { kw: "blacklight", src: '侵权图库壹', note: "[美国] Blacklight" },
  { kw: "jackie chan 成龙欧洲抓", src: '侵权图库壹', note: "Jackie Chan 成龙欧洲抓" },
  { kw: "stoned to the bone（blacklight）", src: '侵权图库壹', note: "[美国抓] stoned to the bone（blacklight）" },
  { kw: "xxxtentacion xxtentacion 已故说唱歌手 两个x 三个x 都 侵权", src: '侵权图库壹', note: "[美国] xxxtentacion xxtentacion 已故说唱歌手 两个X 三个X 都 侵权" },
  { kw: "indigo desert night", src: '侵权图库壹', note: "[美国] Indigo Desert Night" },
  { kw: "grateful dead", src: '侵权图库壹', note: "[美国] Grateful Dead" },
  { kw: "randy rhoads", src: '侵权图库壹', note: "[美国] Randy Rhoads" },
  { kw: "assassin's creed 刺客信条", src: '侵权图库壹', note: "[美国] Assassin's Creed 刺客信条" },
  { kw: "zelda", src: '侵权图库壹', note: "[美国] Zelda" },
  { kw: "harry styles", src: '侵权图库壹', note: "[美国欧洲] Harry styles" },
  { kw: "ellie lefevre", src: '侵权图库壹', note: "[美国] Ellie Lefevre" },
  { kw: "zombie cop 僵尸", src: '侵权图库壹', note: "[美国] Zombie cop 僵尸" },
  { kw: "sneaky cat 鬼猫", src: '侵权图库壹', note: "[美国（封店）] Sneaky Cat 鬼猫" },
  { kw: "gil scott-heronmakaya mccraven", src: '侵权图库壹', note: "[美国] Gil Scott-HeronMakaya McCraven" },
  { kw: "fall guys", src: '侵权图库壹', note: "[美国] Fall Guys" },
  { kw: "kobe 科比", src: '侵权图库壹', note: "[美国] kobe 科比" },
  { kw: "pop smoke 波普·斯莫克-歌手", src: '侵权图库壹', note: "[美国] Pop Smoke 波普·斯莫克-歌手" },
  { kw: "hunter x hunter 全职猎人", src: '侵权图库壹', note: "[美国] Hunter X Hunter 全职猎人" },
  { kw: "naruto eyes火影忍者眼睛", src: '侵权图库壹', note: "[美国] Naruto eyes火影忍者眼睛" },
  { kw: "friends，breakfast club", src: '侵权图库壹', note: "[欧洲] friends，breakfast Club" },
  { kw: "red dead redemption荒野大镖客", src: '侵权图库壹', note: "[美国欧洲] Red Dead Redemption荒野大镖客" },
  { kw: "鲁斯·巴德·金斯伯格ruth bud ginsberg", src: '侵权图库壹', note: "[美国] 鲁斯·巴德·金斯伯格Ruth Bud Ginsberg" },
  { kw: "masked villain蒙面的神秘小人", src: '侵权图库壹', note: "[欧洲] Masked Villain蒙面的神秘小人" },
  { kw: "铁娘子乐队（iron maiden）", src: '侵权图库壹', note: "铁娘子乐队（Iron Maiden）" },
  { kw: "volbeat 成立于2001年，是一支丹麦哥本哈根摇滚乐队。", src: '侵权图库壹', note: "Volbeat 成立于2001年，是一支丹麦哥本哈根摇滚乐队。" },
  { kw: "david gilmour --- pink floyd乐队的吉他手兼主唱。", src: '侵权图库壹', note: "[律师函] David gilmour --- Pink Floyd乐队的吉他手兼主唱。" },
  { kw: "def leppard（威豹乐队）1977年在英国硬摇滚乐队", src: '侵权图库壹', note: "Def Leppard（威豹乐队）1977年在英国硬摇滚乐队" },
  { kw: "eagles 老鹰乐队", src: '侵权图库壹', note: "Eagles 老鹰乐队" },
  { kw: "the breakfast club早餐俱乐部欧洲查", src: '侵权图库壹', note: "The Breakfast Club早餐俱乐部欧洲查" },
  { kw: "lil nas x 说唱歌手 利尔·纳斯·x", src: '侵权图库壹', note: "Lil Nas X 说唱歌手 利尔·纳斯·X" },
  { kw: "艺人： makaya mccraven 音乐人", src: '侵权图库壹', note: "艺人： MAKAYA McCRAVEN 音乐人" },
  { kw: "gil scott-heron黑人说唱之父", src: '侵权图库壹', note: "Gil Scott-Heron黑人说唱之父" },
  { kw: "sean connery肖恩·康纳利-演员", src: '侵权图库壹', note: "[欧洲查] Sean Connery肖恩·康纳利-演员" },
  { kw: "30 这个数字", src: '侵权图库壹', note: "30 这个数字" },
  { kw: "zelda塞尔达传说", src: '侵权图库壹', note: "[美国抓] Zelda塞尔达传说" },
  { kw: "pink floyd 平克·弗洛伊德（pink floyd），英国摇滚乐队", src: '侵权图库壹', note: "[必死，律师函，删除也没用] Pink Floyd 平克·弗洛伊德（Pink Floyd），英国摇滚乐队" },
  { kw: "led zeppelin 齐柏林飞艇乐队", src: '侵权图库壹', note: "[建议下架] LED ZEPPELIN 齐柏林飞艇乐队" },
  { kw: "how to train your dragon驯龙高手", src: '侵权图库壹', note: "[建议下架] How to Train Your Dragon驯龙高手" },
  { kw: "rick and morty 美国动画", src: '侵权图库壹', note: "Rick and Morty 美国动画" },
  { kw: "pokemon 《宝可梦》（曾译名《精灵宝可梦》", src: '侵权图库壹', note: "pokemon 《宝可梦》（曾译名《精灵宝可梦》" },
  { kw: "专辑封面侵权，美国 欧洲都侵权，包含album 这个词的sku全删", src: '侵权图库壹', note: "专辑封面侵权，美国 欧洲都侵权，包含Album 这个词的SKU全删" },
  { kw: "johnny cash 约翰尼·卡什 职业：歌手 生卒：1932年2月26日-2003年9月12日", src: '侵权图库壹', note: "Johnny Cash 约翰尼·卡什 职业：歌手 生卒：1932年2月26日-2003年9月12日" },
  { kw: "潜在的商标滥用 (bob marley)", src: '侵权图库壹', note: "潜在的商标滥用 (Bob Marley)" },
  { kw: "尸和鬼这两个字抓", src: '侵权图库壹', note: "尸和鬼这两个字抓" },
  { kw: "忍者神龟teenage mutant ninja turtles", src: '侵权图库壹', note: "[美国] 忍者神龟Teenage Mutant Ninja Turtles" },
  { kw: "peaky blinders 或者tommy shelby", src: '侵权图库壹', note: "[必抓] Peaky Blinders 或者Tommy Shelby" },
  { kw: "linkin park 林肯公园", src: '侵权图库壹', note: "[美国] Linkin Park 林肯公园" },
  { kw: "hedwig", src: '侵权图库壹', note: "[美国] Hedwig" },
  { kw: "diego armando maradona美国站侵权", src: '侵权图库壹', note: "[美国] Diego Armando Maradona美国站侵权" },
  { kw: "情趣（love）", src: '侵权图库壹', note: "[美国] 情趣（Love）" },
  { kw: "michael jackson迈克杰克逊", src: '侵权图库壹', note: "[美国] Michael Jackson迈克杰克逊" },
  { kw: "科比·布莱恩特 kobe bryant", src: '侵权图库壹', note: "[美国] 科比·布莱恩特 Kobe Bryant" },
  { kw: "jesus", src: '侵权图库壹', note: "[美国封店] Jesus" },
  { kw: "詹姆斯james", src: '侵权图库壹', note: "[美国] 詹姆斯James" },
  { kw: "trip acid", src: '侵权图库壹', note: "[美国封店] trip acid" },
  { kw: "妮姬·米娜 (nicki minaj)", src: '侵权图库壹', note: "[美国封店] 妮姬·米娜 (Nicki Minaj)" },
  { kw: "表情包", src: '侵权图库壹', note: "[必抓] 表情包" },
  { kw: "bruce lee李小龙", src: '侵权图库壹', note: "[美国] Bruce Lee李小龙" },
  { kw: "特朗普trump", src: '侵权图库壹', note: "[美国] 特朗普Trump" },
  { kw: "trivium混种魔兽", src: '侵权图库壹', note: "[欧洲] trivium混种魔兽" },
  { kw: "beyoncé (碧昂絲)", src: '侵权图库壹', note: "[欧洲] Beyoncé (碧昂絲)" },
  { kw: "现代非洲", src: '侵权图库壹', note: "现代非洲" },
  { kw: "lewandowski", src: '侵权图库壹', note: "[欧洲] Lewandowski" },
  { kw: "lewis hamilton 刘易斯·汉密尔顿", src: '侵权图库壹', note: "[欧洲封店] Lewis Hamilton 刘易斯·汉密尔顿" },
  { kw: "丹尼尔·里卡多 (daniel ricciardo)", src: '侵权图库壹', note: "[欧洲封店] 丹尼尔·里卡多 (Daniel Ricciardo)" },
  { kw: "韦恩·鲁尼 (wayne rooney)", src: '侵权图库壹', note: "[欧洲封店] 韦恩·鲁尼 (Wayne Rooney)" },
  { kw: "活死人之夜 (night of the living dead)", src: '侵权图库壹', note: "[美国] 活死人之夜 (Night of the Living Dead)" },
  { kw: "big k.r.i.t", src: '侵权图库壹', note: "[美国] Big K.R.I.T" },
  { kw: "凯恩", src: '侵权图库壹', note: "[欧洲侵权] 凯恩" },
  { kw: "brendon", src: '侵权图库壹', note: "[美国侵权] Brendon" },
  { kw: "team 7专业设计团队", src: '侵权图库壹', note: "[知识产权投诉] Team 7专业设计团队" },
  { kw: "和平巴士", src: '侵权图库壹', note: "[知识产权投诉] 和平巴士" },
  { kw: "棒球 橄榄球 篮球 足球 运动竞技类，队标或者赞助删，能扣一定要抠掉会抓", src: '侵权图库壹', note: "[图片滥用商标] 棒球 橄榄球 篮球 足球 运动竞技类，队标或者赞助删，能扣一定要抠掉会抓" },
  { kw: "mushroom man", src: '侵权图库壹', note: "mushroom man" },
  { kw: "weeknd", src: '侵权图库壹', note: "[美国封店] Weeknd" },
  { kw: "keith haring 基思·哈林画家", src: '侵权图库壹', note: "[美国封店] Keith Haring 基思·哈林画家" },
  { kw: "玛丽莲 梦露抓图", src: '侵权图库壹', note: "玛丽莲 梦露抓图" },
  { kw: "indigo mountains", src: '侵权图库壹', note: "[美国抓名，侵权] Indigo Mountains" },
  { kw: "trippy posters for stoners", src: '侵权图库壹', note: "[美国表情必抓] trippy posters for stoners" },
  { kw: "dragon美国有关龙的都抓，不管是图是名都不行", src: '侵权图库壹', note: "Dragon美国有关龙的都抓，不管是图是名都不行" },
  { kw: "taylor swift", src: '侵权图库壹', note: "[美国抓] Taylor Swift" },
  { kw: "black light 主抓黑光 黑光是购买的品牌名", src: '侵权图库壹', note: "[美国抓] Black Light 主抓黑光 黑光是购买的品牌名" },
  { kw: "drake ovo", src: '侵权图库壹', note: "[美国侵权] Drake OVO" },
  { kw: "retro poster dancing couple by ernie barnes", src: '侵权图库壹', note: "[美国侵权] Retro Poster Dancing Couple by Ernie Barnes" },
  { kw: "corey slipknot", src: '侵权图库壹', note: "[侵权] Corey Slipknot" },
  { kw: "josephine wall spirit of flight", src: '侵权图库壹', note: "[侵权] josephine wall spirit of flight" },
  { kw: "jared leto joker", src: '侵权图库壹', note: "[侵权] jared leto joker" },
  { kw: "tom felton draco malfoy canvas", src: '侵权图库壹', note: "[侵权] Tom Felton Draco Malfoy Canvas" },
  { kw: "scarlet glow glow这是一个医疗公司的品牌名称", src: '侵权图库壹', note: "[美国侵权] Scarlet Glow Glow这是一个医疗公司的品牌名称" },
  { kw: "cowboy bebop", src: '侵权图库壹', note: "[美国侵权] Cowboy Bebop" },
  { kw: "randy rhoads les paul", src: '侵权图库壹', note: "[美国抓] randy rhoads les paul" },
  { kw: "ashley mcbryde", src: '侵权图库壹', note: "[美国侵权] Ashley McBryde" },
  { kw: "sexy mushrooms 蘑菇类动漫也抓", src: '侵权图库壹', note: "[美国侵权] Sexy Mushrooms 蘑菇类动漫也抓" },
  { kw: "fuck the police", src: '侵权图库壹', note: "[违反受限商品政策] Fuck the police" },
  { kw: "a dalek from doctor who", src: '侵权图库壹', note: "[欧洲侵权] A Dalek from Doctor Who" },
  { kw: "magic mushroom", src: '侵权图库壹', note: "[美国欧洲抓] Magic Mushroom" },
  { kw: "cardi b poster", src: '侵权图库壹', note: "[美国侵权] Cardi b Poster" },
  { kw: "tupac amaru shakur 2pac makaveli", src: '侵权图库壹', note: "[必抓（封店）] Tupac Amaru Shakur 2Pac Makaveli" },
  { kw: "alan walker", src: '侵权图库壹', note: "[美国侵权必抓] Alan Walker" },
  { kw: "melanie martinez pink", src: '侵权图库壹', note: "[美国侵权] Melanie Martinez Pink" },
  { kw: "melanie martinez商标侵权", src: '侵权图库壹', note: "[美国侵权] Melanie Martinez商标侵权" },
  { kw: "黑天鹅 black swan", src: '侵权图库壹', note: "[美国欧洲版权侵权] 黑天鹅 black swan" },
  { kw: "godzilla vs kong", src: '侵权图库壹', note: "[美国侵权] Godzilla Vs Kong" },
  { kw: "lemmy killmister", src: '侵权图库壹', note: "[美国侵权] Lemmy Killmister" },
  { kw: "pittsburgh steelers devin bush", src: '侵权图库壹', note: "[美国涉嫌侵权] Pittsburgh Steelers Devin Bush" },
  { kw: "spongebob squarepants tv cartoon poster", src: '侵权图库壹', note: "[美国站 侵权] Spongebob Squarepants TV Cartoon Poster" },
  { kw: "muscular system an", src: '侵权图库壹', note: "[美国知识产权投诉，版权] Muscular System an" },
  { kw: "harley-davidson 摩托车品牌", src: '侵权图库壹', note: "[律师函。会立即冻结资金] Harley-Davidson 摩托车品牌" },
  { kw: "van goghs cats 鬼猫和明星猫王抓 和猫有关也不要上", src: '侵权图库壹', note: "[美国侵权] Van Goghs Cats 鬼猫和明星猫王抓 和猫有关也不要上" },
  { kw: "paddington 帕丁顿熊", src: '侵权图库壹', note: "[美国 知识产权投诉] Paddington 帕丁顿熊" },
  { kw: "travis scott astroworld festival poster", src: '侵权图库壹', note: "[美国商标侵权] Travis Scott Astroworld Festival Poster" },
  { kw: "bold and brash squidward", src: '侵权图库壹', note: "[美国侵权] Bold and Brash Squidward" },
  { kw: "arctic monkeys 北极猴", src: '侵权图库壹', note: "[美国侵权] arctic monkeys 北极猴" },
  { kw: "sugar skull girl with bird sugar涉及品牌名称侵权", src: '侵权图库壹', note: "[欧洲品牌侵权] Sugar Skull Girl with Bird Sugar涉及品牌名称侵权" },
  { kw: "power rangers team", src: '侵权图库壹', note: "[美国侵权] Power Rangers Team" },
  { kw: "chromatica lady gaga album 专辑侵权", src: '侵权图库壹', note: "[美国侵权] Chromatica Lady Gaga Album 专辑侵权" },
  { kw: "david gilmour 大卫·吉尔莫", src: '侵权图库壹', note: "[律师函] David Gilmour 大卫·吉尔莫" },
  { kw: "title not found", src: '侵权图库壹', note: "[美国侵权] Title Not Found" },
  { kw: "the prayer at valley forge george washington arnold friberg", src: '侵权图库壹', note: "[美国侵权] The Prayer At Valley Forge George Washington Arnold Friberg" },
  { kw: "pink floyd back catalogue", src: '侵权图库壹', note: "[律师函] pink floyd back catalogue" },
  { kw: "gentleman jack", src: '侵权图库壹', note: "[美国侵权10条抓] Gentleman Jack" },
  { kw: "nirvana concert posters", src: '侵权图库壹', note: "[美国律师函] Nirvana Concert Posters" },
  { kw: "faze clan esports", src: '侵权图库壹', note: "[美国警告] FaZe Clan Esports" },
  { kw: "bulma dragon ball artwork", src: '侵权图库壹', note: "[美国侵权] Bulma Dragon Ball Artwork" },
  { kw: "trippie redd", src: '侵权图库壹', note: "[美国侵权] Trippie Redd" },
  { kw: "wonder shawn", src: '侵权图库壹', note: "[美国侵权] Wonder Shawn" },
  { kw: "monster single", src: '侵权图库壹', note: "[美国侵权] Monster Single" },
  { kw: "drop dead fred", src: '侵权图库壹', note: "[美国侵权] Drop Dead Fred" },
  { kw: "trippie redd neon green poster", src: '侵权图库壹', note: "[美国侵权] Trippie Redd Neon Green Poster" },
  { kw: "elegant flight ii", src: '侵权图库壹', note: "[美国侵权] Elegant Flight II" },
  { kw: "peacock vista", src: '侵权图库壹', note: "[美国 知识产权投诉] Peacock Vista" },
  { kw: "amber dusk", src: '侵权图库壹', note: "[美国侵权] Amber Dusk" },
  { kw: "travel posters retro city", src: '侵权图库壹', note: "[美国 知识产权投诉] travel posters Retro city" },
  { kw: "potential trademark misuse (jimi hendrix）潜在的商标滥用(吉米·亨德里克斯)", src: '侵权图库壹', note: "Potential Trademark Misuse (Jimi Hendrix）潜在的商标滥用(吉米·亨德里克斯)" },
  { kw: "underwater dreamvi", src: '侵权图库壹', note: "[美国侵权] Underwater DreamVI" },
  { kw: "light beneath evening mist 这类风格图都抓", src: '侵权图库壹', note: "[美国侵权] Light Beneath Evening Mist 这类风格图都抓" },
  { kw: "dia de los muertos marionette", src: '侵权图库壹', note: "[封号] Dia De Los Muertos Marionette" },
  { kw: "the wolf moon has no locked black light", src: '侵权图库壹', note: "[美国侵权] The Wolf moon has no locked black light" },
  { kw: "fortnite涉嫌 侵权", src: '侵权图库壹', note: "[欧洲] Fortnite涉嫌 侵权" },
  { kw: "vintage music poster pearl jam poster rock poster", src: '侵权图库壹', note: "[知识产权投诉] Vintage Music Poster Pearl Jam Poster Rock Poster" },
  { kw: "dia de los muerto", src: '侵权图库壹', note: "[美国 欧洲 封店] Dia De Los Muerto" },
  { kw: "crystal island", src: '侵权图库壹', note: "[美国，知识产权投诉] Crystal Island" },
  { kw: "megan fox", src: '侵权图库壹', note: "[美国侵权] Megan fox" },
  { kw: "muhammad ali pink floyd", src: '侵权图库壹', note: "[律师函] Muhammad Ali Pink Floyd" },
  { kw: "john wick", src: '侵权图库壹', note: "[美国 知识产权投诉] John Wick" },
  { kw: "paddington 2", src: '侵权图库壹', note: "[美国 加拿大 知识产权投诉] Paddington 2" },
  { kw: "the wizard of oz", src: '侵权图库壹', note: "[美国 知识产权投诉] The Wizard of Oz" },
  { kw: "vintage beach poster-laguna beach", src: '侵权图库壹', note: "[美国 知识产权投诉] Vintage Beach Poster-Laguna Beach" },
  { kw: "vintage car poster luxury convertible", src: '侵权图库壹', note: "[美国 知识产权投诉] vintage car poster Luxury convertible" },
  { kw: "vintage tourism landscape michigan,lake poster", src: '侵权图库壹', note: "[美国 知识产权投诉] Vintage Tourism Landscape Michigan,Lake Poster" },
  { kw: "willy's wonderland", src: '侵权图库壹', note: "[美国 知识产权投诉] Willy's Wonderland" },
  { kw: "欧洲 有关猩猩建议下架", src: '侵权图库壹', note: "欧洲 有关猩猩建议下架" },
  { kw: "复古类的海报 建议下架", src: '侵权图库壹', note: "复古类的海报 建议下架" },
  { kw: "black（黑色的）这个字侵权和严重和龙字差不多", src: '侵权图库壹', note: "Black（黑色的）这个字侵权和严重和龙字差不多" },
  { kw: "anime poster neon genesis evangelion cyberpunk", src: '侵权图库壹', note: "[加拿大侵权] Anime Poster Neon Genesis Evangelion Cyberpunk" },
  { kw: "singer madonna", src: '侵权图库壹', note: "[美国涉嫌侵权] Singer Madonna" },
  { kw: "face piercing chart canvas art", src: '侵权图库壹', note: "[侵权] Face Piercing Chart Canvas Art" },
  { kw: "juice wrld rapper art brush", src: '侵权图库壹', note: "[美国抓] Juice wrld rapper art brush" },
  { kw: "black swan这个是品牌名，美欧都抓", src: '侵权图库壹', note: "Black Swan这个是品牌名，美欧都抓" },
  { kw: "火影忍者", src: '侵权图库壹', note: "[美国 知识产权投诉 抓这张图] 火影忍者" },
  { kw: "fullmetal alchemist", src: '侵权图库壹', note: "[欧洲 涉嫌侵权] Fullmetal Alchemist" },
  { kw: "neil young poster vintage music poster rock singer poster", src: '侵权图库壹', note: "[美国侵权] neil young poster vintage music poster rock singer poster" },
  { kw: "art ask agency这个关键词千万别上 anne stokes也远离 dan mumford grateful dead", src: '侵权图库壹', note: "[律师函] Art Ask Agency这个关键词千万别上 Anne Stokes也远离 Dan Mumford Grateful Dead" },
  { kw: "vintage posters cacti succulent", src: '侵权图库壹', note: "[侵权] vintage posters cacti succulent" },
  { kw: "britney spears star poster", src: '侵权图库壹', note: "[美国侵权] Britney Spears Star Poster" },
  { kw: "trippie redd trippy", src: '侵权图库壹', note: "[美国侵权] Trippie Redd trippy" },
  { kw: "enno vatti 100 movies scratch off 实时排行榜的是有版权的不要上一样的", src: '侵权图库壹', note: "[侵权] Enno Vatti 100 Movies Scratch Off 实时排行榜的是有版权的不要上一样的" },
  { kw: "dinner with fred", src: '侵权图库壹', note: "[美国侵权] Dinner with Fred" },
  { kw: "green day 绿日乐队(greenday),美国著名朋克乐队,又称朋克教父", src: '侵权图库壹', note: "[美国-侵权封店] Green Day 绿日乐队(GreenDay),美国著名朋克乐队,又称朋克教父" },
  { kw: "scarlxrd rapper marius listhrop", src: '侵权图库壹', note: "[律师函] scarlxrd rapper Marius Listhrop" },
  { kw: "bread barbershop", src: '侵权图库壹', note: "[美国侵权] Bread Barbershop" },
  { kw: "trainspotting", src: '侵权图库壹', note: "[美国侵权] Trainspotting" },
  { kw: "sugar skull queen and crown", src: '侵权图库壹', note: "[侵权] Sugar Skull Queen and Crown" },
  { kw: "pink freud", src: '侵权图库壹', note: "[律师函] Pink Freud" },
  { kw: "christ-ez cr7 cristiano ronaldo juventus fc sports soccer poster", src: '侵权图库壹', note: "[美国侵犯知识产权] Christ-EZ CR7 Cristiano Ronaldo Juventus FC Sports Soccer Poster" },
  { kw: "spartans halo", src: '侵权图库壹', note: "[美国侵权] Spartans Halo" },
  { kw: "美国乡村音乐歌手卢克 luke combs", src: '侵权图库壹', note: "[律师函] 美国乡村音乐歌手卢克 LUKE COMBS" },
  { kw: "iron maiden 英国乐队 铁娘子", src: '侵权图库壹', note: "[律师函] IRON MAIDEN 英国乐队 铁娘子" },
  { kw: "paw patrol 汪汪队立大功", src: '侵权图库壹', note: "[涉嫌侵犯知识产权] Paw Patrol 汪汪队立大功" },
  { kw: "blackpink jennie", src: '侵权图库壹', note: "[美国侵权] Blackpink Jennie" },
  { kw: "charlie mackesy", src: '侵权图库壹', note: "[欧洲站侵权封店] Charlie Mackesy" },
  { kw: "killing stalking sangwoo", src: '侵权图库壹', note: "[美国版权侵权] Killing Stalking Sangwoo" },
  { kw: "haikyuu", src: '侵权图库壹', note: "[美国版权侵权] Haikyuu" },
  { kw: "sports fitness inspirational gym decoration posters hustle for the muscle", src: '侵权图库壹', note: "[美国侵权] Sports fitness inspirational gym decoration Posters Hustle For The Muscle" },
  { kw: "twenty one pilots", src: '侵权图库壹', note: "[美国侵权] Twenty One Pilots" },
  { kw: "hayley williams", src: '侵权图库壹', note: "[美国侵权] Hayley Williams" },
  { kw: "bleach kurosaki ichigo", src: '侵权图库壹', note: "[美国侵权举报] Bleach Kurosaki Ichigo" },
  { kw: "bod marley", src: '侵权图库壹', note: "[商标侵权 封店] bod marley" },
  { kw: "axl rose and slash", src: '侵权图库壹', note: "[知识产权投诉 美国] Axl Rose and Slash" },
  { kw: "red dead redemption", src: '侵权图库壹', note: "[意大利] Red Dead Redemption" },
  { kw: "aventador 兰博基尼", src: '侵权图库壹', note: "[律师函] Aventador 兰博基尼" },
  { kw: "the expendables poster", src: '侵权图库壹', note: "[律师函] The Expendables Poster" },
  { kw: "audrey hepburn 奥黛丽 赫本 marilyn monroe 玛丽莲 梦露", src: '侵权图库壹', note: "[侵权] Audrey Hepburn 奥黛丽 赫本 Marilyn Monroe 玛丽莲 梦露" },
  { kw: "family tree art poster", src: '侵权图库壹', note: "[美国] Family Tree Art Poster" },
  { kw: "three monkeys", src: '侵权图库壹', note: "[美国] Three monkeys" },
  { kw: "motivational poster 7 rules of life", src: '侵权图库壹', note: "Motivational Poster 7 Rules of Life" },
  { kw: "rush", src: '侵权图库壹', note: "[判定售假封店] rush" },
  { kw: "bike hard", src: '侵权图库壹', note: "[加拿大] Bike Hard" },
  { kw: "rocket league", src: '侵权图库壹', note: "[美国侵权] Rocket League" },
  { kw: "purple nice butt cat", src: '侵权图库壹', note: "[美国侵权] Purple Nice Butt Cat" },
  { kw: "metallica concert", src: '侵权图库壹', note: "[律师函] Metallica concert" },
  { kw: "blackpink jisoo", src: '侵权图库壹', note: "[美国侵权] Blackpink JISOO" },
  { kw: "luke bryan", src: '侵权图库壹', note: "[美国侵权] Luke Bryan" },
  { kw: "ben10 、halley 、emoji 、the smurfs; blue demon; blue fairy 、cwc 、pj 、locomotive 、pink floyd、grumpy cat", src: '侵权图库壹', note: "[会吃律师函] ben10 、Halley 、Emoji 、The Smurfs; Blue Demon; Blue Fairy 、CWC 、PJ 、locomotive 、pink floyd、Grumpy Cat" },
  { kw: "manuel", src: '侵权图库壹', note: "[美国侵权] Manuel" },
  { kw: "beyblade", src: '侵权图库壹', note: "[涉嫌滥用商标徽标] beyblade" },
  { kw: "the optimist city", src: '侵权图库壹', note: "[美国侵权] The optimist City" },
  { kw: "vivid biology unravelling brains neuroscience", src: '侵权图库壹', note: "[欧洲侵权] Vivid Biology Unravelling brains neuroscience" },
  { kw: "alex grey love", src: '侵权图库壹', note: "[美国侵权] Alex Grey Love" },
  { kw: "starry night black cat", src: '侵权图库壹', note: "[美国侵权] Starry Night Black Cat" },
  { kw: "amongus", src: '侵权图库壹', note: "[美国欧洲] amongus" },
  { kw: "rapper lemmy the motorhead", src: '侵权图库壹', note: "[美国侵权] Rapper Lemmy The Motorhead" },
  { kw: "wwe roman reigns", src: '侵权图库壹', note: "[美国侵权] WWE Roman Reigns" },
  { kw: "national park poster 2021 foundation wall calendar", src: '侵权图库壹', note: "[美国侵权] National Park poster 2021 Foundation Wall Calendar" },
  { kw: "alvin and chipmunks", src: '侵权图库壹', note: "[美国侵权] Alvin and Chipmunks" },
  { kw: "keith haring lucky strike", src: '侵权图库壹', note: "[美国侵权] Keith Haring lucky strike" },
  { kw: "minions minion minionss", src: '侵权图库壹', note: "[美国 涉嫌侵犯知识产权] Minions Minion MINIONSS" },
  { kw: "nirvana nirvana concert", src: '侵权图库壹', note: "[律师函] Nirvana Nirvana Concert" },
  { kw: "bunny blowing bubble gum", src: '侵权图库壹', note: "[封店] Bunny Blowing Bubble Gum" },
  { kw: "boba-fett-in-bathroom", src: '侵权图库壹', note: "[美国 抓图] Boba-Fett-in-Bathroom" },
  { kw: "bruno mars", src: '侵权图库壹', note: "[美国侵权] Bruno Mars" },
  { kw: "new york city", src: '侵权图库壹', note: "[美国侵权] New York City" },
  { kw: "paramore rock band", src: '侵权图库壹', note: "[商标侵权] Paramore Rock Band" },
  { kw: "i am the liquor", src: '侵权图库壹', note: "[侵权] i am the liquor" },
  { kw: "national park grand canyon", src: '侵权图库壹', note: "[侵权 封店] national park grand canyon" },
  { kw: "pink power ranger", src: '侵权图库壹', note: "[英国侵权] Pink Power Ranger" },
  { kw: "a day to remember", src: '侵权图库壹', note: "[美国侵权] A Day To Remember" },
  { kw: "clash of clans", src: '侵权图库壹', note: "[美国侵权] clash of clans" },
  { kw: "kareem abdul-jabbar 卡里姆·阿布杜尔-贾巴尔", src: '侵权图库壹', note: "[文字、图案Logo是侵权雷点] Kareem Abdul-Jabbar 卡里姆·阿布杜尔-贾巴尔" },
  { kw: "snoopy peanuts", src: '侵权图库壹', note: "[律师函] Snoopy Peanuts" },
  { kw: "pearl jam music poster", src: '侵权图库壹', note: "[知识产权 封店] Pearl Jam music poster" },
  { kw: "saaheem m. valdery sahbabii", src: '侵权图库壹', note: "[律师函] Saaheem M. Valdery Sahbabii" },
  { kw: "beastars", src: '侵权图库壹', note: "[美国侵权] BEASTARS" },
  { kw: "brazil", src: '侵权图库壹', note: "[涉嫌侵犯知识产权 西班牙] BRAZIL" },
  { kw: "superstars of ed sheeran", src: '侵权图库壹', note: "[美国 涉嫌侵犯知识产权] Superstars of Ed Sheeran" },
  { kw: "seattle space needle", src: '侵权图库壹', note: "[侵权10条 封店] Seattle Space Needle" },
  { kw: "travel poster los angeles california", src: '侵权图库壹', note: "[侵权10条 封店] Travel Poster Los Angeles California" },
  { kw: "cavallini decorative wrap", src: '侵权图库壹', note: "[知识产权投诉] Cavallini Decorative Wrap" },
  { kw: "fallout辐射系列（1-4）游戏海报", src: '侵权图库壹', note: "[侵权] Fallout辐射系列（1-4）游戏海报" },
  { kw: "suspiria亚马逊旗下电影", src: '侵权图库壹', note: "[侵权] suspiria亚马逊旗下电影" },
  { kw: "jojo siwa", src: '侵权图库壹', note: "[侵权封店美国] Jojo siwa" },
  { kw: "eugenia loli 尤金妮亚", src: '侵权图库壹', note: "[律师函] eugenia loli 尤金妮亚" },
  { kw: "jonny cash", src: '侵权图库壹', note: "[律师函] Jonny Cash" },
  { kw: "death note anime poster yagami light", src: '侵权图库壹', note: "[美国侵权] DEATH NOTE anime poster Yagami Light" },
  { kw: "anime tv series good omens neil gaiman tv series", src: '侵权图库壹', note: "[欧洲侵权] Anime TV Series Good Omens Neil Gaiman TV Series" },
  { kw: "super saiya vegeta wukong", src: '侵权图库壹', note: "[美国侵权] Super Saiya Vegeta wukong" },
  { kw: "snoop doggy dogg calvin broadus 会关联史努比", src: '侵权图库壹', note: "[律师函] Snoop Doggy Dogg Calvin Broadus 会关联史努比" },
  { kw: "palace learning dumbbell workout exercise poster", src: '侵权图库壹', note: "[美国侵权] Palace Learning Dumbbell Workout Exercise Poster" },
  { kw: "joan jett", src: '侵权图库壹', note: "[美国侵权] Joan Jett" },
  { kw: "roger waters the final cut the division bell nick mason syd barrett rogersydbarrett pink floyd's wall平克弗洛伊德成员和专辑", src: '侵权图库壹', note: "[律师函] Roger Waters The final cut The Division Bell Nick Mason Syd Barrett RogersydBarrett Pink Floyd's Wall平克弗洛伊德成员和专辑" },
  { kw: "the world beyond the ice wall flat earth map beyond extra terrestrial antarctica territory", src: '侵权图库壹', note: "[平克弗洛伊德成员和专辑，律师函] The World Beyond The Ice Wall Flat Earth Map Beyond Extra Terrestrial Antarctica Territory" },
  { kw: "flat earth map terra infinita realm poster", src: '侵权图库壹', note: "[Terra Infinita] Flat Earth Map Terra Infinita Realm Poster" },
  { kw: "flat earth map terra infinita realm poster lands beyond the ice wall art poster", src: '侵权图库壹', note: "[Terra Infinita] Flat Earth Map Terra Infinita Realm Poster Lands Beyond The Ice Wall Art Poster" },
  { kw: "维权品牌：stefan georgiev petrunov 版权", src: '侵权图库壹', note: "维权品牌：Stefan Georgiev Petrunov 版权" },
  { kw: "维权品牌：caglayan kaya goksoy 版权", src: '侵权图库壹', note: "维权品牌：Caglayan Kaya Goksoy 版权" },
  { kw: "维权品牌：rachael taylor 版权", src: '侵权图库壹', note: "维权品牌：Rachael Taylor 版权" },
  { kw: "维权品牌：heather myers 版权", src: '侵权图库壹', note: "维权品牌：Heather Myers 版权" },
  { kw: "维权品牌：susan florence comish 版权", src: '侵权图库壹', note: "维权品牌：Susan Florence Comish 版权" },
  { kw: "维权品牌：mark marko 蘑菇版权", src: '侵权图库壹', note: "维权品牌：Mark Marko 蘑菇版权" },
  { kw: "维权品牌：poppy playtime 波比的游戏时间，维权类型: 角色，商标形象版权", src: '侵权图库壹', note: "维权品牌：Poppy Playtime 波比的游戏时间，维权类型: 角色，商标形象版权" },
  { kw: "维权品牌：jensen tabangcura 版权", src: '侵权图库壹', note: "维权品牌：Jensen Tabangcura 版权" },
  { kw: "维权品牌：desmond noel brophy 版权", src: '侵权图库壹', note: "维权品牌：Desmond Noel Brophy 版权" },
  { kw: "维权品牌：beth hoselton-gray 版权", src: '侵权图库壹', note: "维权品牌：Beth Hoselton-Gray 版权" },
  { kw: "维权品牌：care bears 爱心熊", src: '侵权图库壹', note: "维权品牌：Care Bears 爱心熊" },
  { kw: "维权品牌：andrew deming 版权", src: '侵权图库壹', note: "维权品牌：Andrew Deming 版权" },
  { kw: "维权品牌：andrew dobell 版权", src: '侵权图库壹', note: "维权品牌：Andrew Dobell 版权" },
  { kw: "维权品牌：gabby leithsceal 头骨发夹", src: '侵权图库壹', note: "维权品牌：Gabby Leithsceal 头骨发夹" },
  { kw: "维权品牌：lawrence hersberger 版权", src: '侵权图库壹', note: "维权品牌：Lawrence Hersberger 版权" },
  { kw: "维权品牌：gerald j. lofaro 版权画", src: '侵权图库壹', note: "维权品牌：Gerald J. Lofaro 版权画" },
  { kw: "维权品牌：joseph murray hautman 版权画", src: '侵权图库壹', note: "维权品牌：Joseph Murray Hautman 版权画" },
  { kw: "维权品牌：billy zebulon norrby 女飞行员版权", src: '侵权图库壹', note: "维权品牌：Billy Zebulon Norrby 女飞行员版权" },
  { kw: "原告：hong kong leyuzhen technology co. limited", src: '侵权图库壹', note: "原告：Hong Kong Leyuzhen Technology Co. Limited" },
  { kw: "比莉·艾利什billie eilish 美国女歌手", src: '侵权图库贰', note: "[侵权] 比莉·艾利什Billie eilish   美国女歌手" },
  { kw: "布兰妮·斯皮尔斯britney spears", src: '侵权图库贰', note: "[侵权] 布兰妮·斯皮尔斯Britney Spears" },
  { kw: "妮琪·米娜nicki minaj 美国说唱乐女歌手", src: '侵权图库贰', note: "[侵权] 妮琪·米娜Nicki Minaj       美国说唱乐女歌手" },
  { kw: "梅根·赛恩 megan thee stallion 美国说唱女王", src: '侵权图库贰', note: "[侵权] 梅根·赛恩  Megan Thee Stallion   美国说唱女王" },
  { kw: "梅兰妮·马丁内兹melanie martinez 美国女歌手、词曲作者", src: '侵权图库贰', note: "[侵权] 梅兰妮·马丁内兹Melanie Martinez    美国女歌手、词曲作者" },
  { kw: "海莉·妮可·威廉姆斯hayley williams 美国歌手，流行朋克乐队帕拉摩尔主唱", src: '侵权图库贰', note: "[侵权] 海莉·妮可·威廉姆斯Hayley Williams     美国歌手，流行朋克乐队帕拉摩尔主唱" },
  { kw: "奥黛丽赫本 audrey hepburn", src: '侵权图库贰', note: "[侵权] 奥黛丽赫本     Audrey Hepburn" },
  { kw: "lady gaga 美国女歌手", src: '侵权图库贰', note: "[侵权] Lady Gaga   美国女歌手" },
  { kw: "惠特妮·休斯顿 whitney houston 美国女歌手", src: '侵权图库贰', note: "[侵权] 惠特妮·休斯顿 Whitney Houston   美国女歌手" },
  { kw: "爱莉安娜·格兰德ariana grande 美国女歌手、演员", src: '侵权图库贰', note: "[侵权] 爱莉安娜·格兰德Ariana Grande   美国女歌手、演员" },
  { kw: "赛琳娜·戈麦斯selena gomez 美国女演员、歌手", src: '侵权图库贰', note: "[侵权] 赛琳娜·戈麦斯Selena gomez    美国女演员、歌手" },
  { kw: "卡迪·b cardi b poster 美国说唱歌手 的海报", src: '侵权图库贰', note: "[侵权] 卡迪·B Cardi b    poster       美国说唱歌手   的海报" },
  { kw: "詹尼斯·乔普林janis joplin 美国摇滚女歌手", src: '侵权图库贰', note: "[侵权] 詹尼斯·乔普林Janis Joplin   美国摇滚女歌手" },
  { kw: "ellie lefevre 女演员", src: '侵权图库贰', note: "[侵权] Ellie Lefevre    女演员" },
  { kw: "ashley mcbryde 女演员（参演野玫瑰）", src: '侵权图库贰', note: "[侵权] Ashley McBryde   女演员（参演野玫瑰）" },
  { kw: "blackpink jisoo 金智秀", src: '侵权图库贰', note: "[侵权] Blackpink JISOO     金智秀" },
  { kw: "朱斯·沃尔德 juice wrld 美国嘻哈男歌手", src: '侵权图库贰', note: "[侵权] 朱斯·沃尔德 Juice Wrld    美国嘻哈男歌手" },
  { kw: "埃米纳姆 eminem 美国说唱男歌手", src: '侵权图库贰', note: "[侵权] 埃米纳姆 Eminem     美国说唱男歌手" },
  { kw: "波兹·马龙 post malone 美国男歌手", src: '侵权图库贰', note: "[侵权] 波兹·马龙 Post Malone  美国男歌手" },
  { kw: "特拉维斯·斯科特travis scott 美国说唱歌手", src: '侵权图库贰', note: "[侵权] 特拉维斯·斯科特Travis Scott  美国说唱歌手" },
  { kw: "lil tjay 美国说唱歌手", src: '侵权图库贰', note: "lil tjay      美国说唱歌手" },
  { kw: "图派克2pac tupac shakur 美国说唱歌手", src: '侵权图库贰', note: "[侵权] 图派克2pac Tupac Shakur  美国说唱歌手" },
  { kw: "艾德·希兰 ed sheeran 英国流行乐男歌手", src: '侵权图库贰', note: "[侵权] 艾德·希兰 Ed Sheeran   英国流行乐男歌手" },
  { kw: "eric church 美国创作型歌手", src: '侵权图库贰', note: "[侵权] Eric Church     美国创作型歌手" },
  { kw: "李小龙bruce lee 国际巨星", src: '侵权图库贰', note: "[侵权] 李小龙Bruce Lee      国际巨星" },
  { kw: "asap rocky 美国饶舌歌手", src: '侵权图库贰', note: "[侵权] ASAP Rocky  美国饶舌歌手" },
  { kw: "肖恩·蒙德兹shawn mendes 加拿大男歌手", src: '侵权图库贰', note: "[侵权] 肖恩·蒙德兹Shawn Mendes   加拿大男歌手" },
  { kw: "鲍勃·马利bob marley 牙买加唱作歌手，雷鬼乐的鼻祖", src: '侵权图库贰', note: "[潜在侵权] 鲍勃·马利Bob Marley   牙买加唱作歌手，雷鬼乐的鼻祖" },
  { kw: "利尔·纳斯·x（lil nas x） 美国说唱歌手", src: '侵权图库贰', note: "[侵权] 利尔·纳斯·X（Lil Nas X）    美国说唱歌手" },
  { kw: "makaya mccraven 国爵士鼓手和乐队指挥", src: '侵权图库贰', note: "[侵权] MAKAYA McCRAVEN     国爵士鼓手和乐队指挥" },
  { kw: "gil scott-heron 黑人说唱之父", src: '侵权图库贰', note: "[侵权] Gil Scott-Heron       黑人说唱之父" },
  { kw: "肖恩·康纳利sean connery 英国演员、制片人", src: '侵权图库贰', note: "[侵权] 肖恩·康纳利Sean Connery   英国演员、制片人" },
  { kw: "john wick 演员", src: '侵权图库贰', note: "John Wick    演员" },
  { kw: "波普·斯莫克 pop smoke 美国说唱歌手", src: '侵权图库贰', note: "[侵权] 波普·斯莫克 Pop Smoke        美国说唱歌手" },
  { kw: "尼普西·哈塞尔 nipsey hussle 美国说唱歌手", src: '侵权图库贰', note: "[侵权] 尼普西·哈塞尔 Nipsey Hussle    美国说唱歌手" },
  { kw: "利尔·乌兹·弗特 lil uzi vert 美国说唱歌手", src: '侵权图库贰', note: "[侵权] 利尔·乌兹·弗特 lil uzi vert    美国说唱歌手" },
  { kw: "威肯the weeknd 加拿大创作型歌手", src: '侵权图库贰', note: "[侵权] 威肯The Weeknd    加拿大创作型歌手" },
  { kw: "贾斯汀·比伯 justin bieber 加拿大男歌手（欧洲也不要上）", src: '侵权图库贰', note: "[侵权] 贾斯汀·比伯 Justin Bieber     加拿大男歌手（欧洲也不要上）" },
  { kw: "迈克杰克逊michael jackson", src: '侵权图库贰', note: "[侵权] 迈克杰克逊Michael Jackson" },
  { kw: "碧昂丝beyoncé 美国女歌手、演员", src: '侵权图库贰', note: "[侵权] 碧昂丝Beyoncé    美国女歌手、演员" },
  { kw: "big k.r.i.t 本名justin scott 美国说唱歌手、制作人", src: '侵权图库贰', note: "[侵权] Big K.R.I.T   本名Justin Scott   美国说唱歌手、制作人" },
  { kw: "lil baby 美国饶舌歌手、歌手与词曲作家", src: '侵权图库贰', note: "[侵权] Lil Baby 美国饶舌歌手、歌手与词曲作家" },
  { kw: "查斯特·贝宁顿chester bennington 美国男歌手、演员", src: '侵权图库贰', note: "[侵权] 查斯特·贝宁顿Chester Bennington   美国男歌手、演员" },
  { kw: "艾克索·罗斯axl rose 美国摇滚男歌手", src: '侵权图库贰', note: "[侵权] 艾克索·罗斯Axl Rose   美国摇滚男歌手" },
  { kw: "大卫·鲍伊 david bowie 英国布里克斯顿，英国摇滚歌手、演员", src: '侵权图库贰', note: "大卫·鲍伊 David Bowie   英国布里克斯顿，英国摇滚歌手、演员" },
  { kw: "bad bunny 美国男歌手", src: '侵权图库贰', note: "Bad Bunny    美国男歌手" },
  { kw: "trippie redd 美国说唱歌手", src: '侵权图库贰', note: "[侵权] Trippie Redd         美国说唱歌手" },
  { kw: "棉花糖marshmello 美国dj、电音制作人marshmello", src: '侵权图库贰', note: "[侵权] 棉花糖Marshmello     美国DJ、电音制作人Marshmello" },
  { kw: "史蒂维·雷·沃恩stevie ray vaughan", src: '侵权图库贰', note: "史蒂维·雷·沃恩Stevie Ray Vaughan" },
  { kw: "哈里·斯泰尔斯harry styles 英国男歌手、演员", src: '侵权图库贰', note: "[侵权] 哈里·斯泰尔斯Harry Styles       英国男歌手、演员" },
  { kw: "杰塞·德怀恩·奥弗洛xxxtentacion xxtentacion 已故说唱歌手 两个x三个x 都侵权", src: '侵权图库贰', note: "[侵权] 杰塞·德怀恩·奥弗洛xxxtentacion xxtentacion 已故说唱歌手 两个X三个X 都侵权" },
  { kw: "jackie chan 成龙 中国男演员", src: '侵权图库贰', note: "[侵权] Jackie Chan 成龙    中国男演员" },
  { kw: "斯坦·李 stan lee 漫画创作者、演员、编剧", src: '侵权图库贰', note: "[侵权] 斯坦·李 Stan Lee       漫画创作者、演员、编剧" },
  { kw: "艾迪·范·海伦eddie van halen 美国著名重金属乐队van halen吉他手唱作人、演奏家", src: '侵权图库贰', note: "[侵权] 艾迪·范·海伦Eddie Van Halen    美国著名重金属乐队Van Halen吉他手唱作人、演奏家" },
  { kw: "德拉科·马尔福（角色）draco malfoy 由汤姆·费尔顿tom felton（演员）扮演", src: '侵权图库贰', note: "[侵权] 德拉科·马尔福（角色）Draco Malfoy 由汤姆·费尔顿Tom Felton（演员）扮演" },
  { kw: "弗里德·杜斯特fred durst 美国演员、制片人、导演", src: '侵权图库贰', note: "[侵权] 弗里德·杜斯特Fred Durst     美国演员、制片人、导演" },
  { kw: "阿琪雅纳·卡玛瑞克akiane kramarik 当今世界公认的\"天才\"画家兼诗人", src: '侵权图库贰', note: "[侵权] 阿琪雅纳·卡玛瑞克Akiane kramarik    当今世界公认的\"天才\"画家兼诗人" },
  { kw: "卢克·布莱恩luke bryan 美国乡村创作歌手", src: '侵权图库贰', note: "[侵权] 卢克·布莱恩Luke Bryan     美国乡村创作歌手" },
  { kw: "布鲁诺·马尔斯 bruno mars 美国男歌手", src: '侵权图库贰', note: "[侵权] 布鲁诺·马尔斯 Bruno Mars    美国男歌手" },
  { kw: "randy rhoads 美国加利福尼亚吉他手", src: '侵权图库贰', note: "[侵权] Randy Rhoads      美国加利福尼亚吉他手" },
  { kw: "特朗普trump 前美国总统", src: '侵权图库贰', note: "[侵权] 特朗普Trump    前美国总统" },
  { kw: "鲁斯·巴德·金斯伯格ruth bader ginsberg 美国法学家，女权主义者，美国联邦最高法院历史上第二位女性大法官", src: '侵权图库贰', note: "[侵权] 鲁斯·巴德·金斯伯格Ruth Bader Ginsberg    美国法学家，女权主义者，美国联邦最高法院历史上第二位女性大法官" },
  { kw: "阿尔伯特·爱因斯坦albert einstein 现代物理学家", src: '侵权图库贰', note: "[侵权] 阿尔伯特·爱因斯坦Albert Einstein   现代物理学家" },
  { kw: "布伦登·尤里brendon boyd urie 美国乐队panic! at the disco主唱", src: '侵权图库贰', note: "[侵权] 布伦登·尤里Brendon Boyd Urie   美国乐队Panic! at the Disco主唱" },
  { kw: "polo g 美国说唱歌手", src: '侵权图库贰', note: "[侵权] Polo G     美国说唱歌手" },
  { kw: "迈克·米勒mac miller 美国犹太裔说唱歌手", src: '侵权图库贰', note: "[侵权] 迈克·米勒Mac Miller      美国犹太裔说唱歌手" },
  { kw: "弗兰克·奥申 frank ocean 全美国歌手、词曲作者", src: '侵权图库贰', note: "[侵权] 弗兰克·奥申  Frank Ocean  全美国歌手、词曲作者" },
  { kw: "利尔·皮普lil peep 美国说唱歌手", src: '侵权图库贰', note: "[侵权] 利尔·皮普Lil Peep      美国说唱歌手" },
  { kw: "terry o'neill terry o'neill cbe 是世界上收藏最多的摄影师之一，其作品挂在世界各地的国家美术馆和私人收藏中。从总统到流行歌星，他拍摄了六十多年的名人前线。", src: '侵权图库贰', note: "[律师函] TERRY O'NEILL Terry O'Neill CBE 是世界上收藏最多的摄影师之一，其作品挂在世界各地的国家美术馆和私人收藏中。从总统到流行歌星，他拍摄了六十多年的名人前线。" },
  { kw: "anime guy with maskmale(一位戴着面具的舞者） maskmale的漫画版", src: '侵权图库贰', note: "[侵权] Anime Guy with Maskmale(一位戴着面具的舞者）    Maskmale的漫画版" },
  { kw: "jojo siwa 美国童星", src: '侵权图库贰', note: "[侵权] Jojo siwa    美国童星" },
  { kw: "罗伯特·舒曼（robert schumann） 德国作曲家", src: '侵权图库贰', note: "[侵权] 罗伯特·舒曼（Robert Schumann） 德国作曲家" },
  { kw: "wiz khalifa维兹·卡利法 美国说唱歌手", src: '侵权图库贰', note: "[涉嫌侵权] Wiz Khalifa维兹·卡利法 美国说唱歌手" },
  { kw: "kate upton凯特·阿普顿 美国模特、演员", src: '侵权图库贰', note: "[侵权] Kate Upton凯特·阿普顿 美国模特、演员" },
  { kw: "kanye omari west 坎耶·维斯特 美国说唱男歌手", src: '侵权图库贰', note: "[侵权] Kanye Omari West 坎耶·维斯特 美国说唱男歌手" },
  { kw: "hobo johnson ：是hobo johnson和lovemakers的主唱", src: '侵权图库贰', note: "[侵权、律师函] Hobo Johnson ：是Hobo Johnson和LoveMakers的主唱" },
  { kw: "chance the rapper 美国饶舌歌手", src: '侵权图库贰', note: "[侵权] chance the rapper 美国饶舌歌手" },
  { kw: "乐队&组合", src: '侵权图库贰', note: "乐队&组合" },
  { kw: "grateful dead 感恩至死 美国摇滚乐队", src: '侵权图库贰', note: "[侵权] Grateful Dead 感恩至死          美国摇滚乐队" },
  { kw: "二十一名飞行员twenty one pilots 美国另类摇滚乐队", src: '侵权图库贰', note: "[侵权] 二十一名飞行员Twenty One Pilots      美国另类摇滚乐队" },
  { kw: "ac/dc乐队", src: '侵权图库贰', note: "AC/DC乐队" },
  { kw: "皇后乐队", src: '侵权图库贰', note: "皇后乐队" },
  { kw: "老鹰乐队eagles 美国70年代摇滚乐团", src: '侵权图库贰', note: "[侵权] 老鹰乐队Eagles    美国70年代摇滚乐团" },
  { kw: "林肯公园 linkin park 美国摇滚乐队", src: '侵权图库贰', note: "[侵权] 林肯公园 Linkin Park   美国摇滚乐队" },
  { kw: "活结乐队slipknot 美国新金属乐队", src: '侵权图库贰', note: "[侵权] 活结乐队Slipknot  美国新金属乐队" },
  { kw: "混种魔兽trivium 美国重金属乐队", src: '侵权图库贰', note: "[侵权] 混种魔兽Trivium     美国重金属乐队" },
  { kw: "blink 182 美国比较年轻一代的朋克乐队", src: '侵权图库贰', note: "[侵权] Blink 182   美国比较年轻一代的朋克乐队" },
  { kw: "我的化学浪漫my chemical romance 美国著名朋克乐队", src: '侵权图库贰', note: "[侵权] 我的化学浪漫My Chemical Romance     美国著名朋克乐队" },
  { kw: "绿日 green day 美国朋克乐队", src: '侵权图库贰', note: "[侵权] 绿日 Green Day    美国朋克乐队" },
  { kw: "paramore rock band 朋克乐队", src: '侵权图库贰', note: "[侵权] Paramore Rock Band     朋克乐队" },
  { kw: "北极猴子arctic monkeys 英国摇滚乐队", src: '侵权图库贰', note: "[侵权] 北极猴子arctic monkeys   英国摇滚乐队" },
  { kw: "威豹乐队def leppard 1977年英国硬摇滚乐队", src: '侵权图库贰', note: "[侵权] 威豹乐队Def Leppard   1977年英国硬摇滚乐队" },
  { kw: "电台司令 radiohead 英国摇滚乐队", src: '侵权图库贰', note: "[侵权] 电台司令 Radiohead     英国摇滚乐队" },
  { kw: "blackpink 韩国女子演唱组合", src: '侵权图库贰', note: "[侵权] Blackpink  韩国女子演唱组合" },
  { kw: "volbeat 成立于2001年的丹麦哥本哈根摇滚乐队", src: '侵权图库贰', note: "[侵权] Volbeat    成立于2001年的丹麦哥本哈根摇滚乐队" },
  { kw: "bts 防弹少年团 韩国男子演唱组合", src: '侵权图库贰', note: "[侵权] BTS 防弹少年团  韩国男子演唱组合" },
  { kw: "皇后乐队 queen 英国摇滚乐队", src: '侵权图库贰', note: "[侵权] 皇后乐队  Queen     英国摇滚乐队" },
  { kw: "soulfly 飞灵乐队 美国重金属乐队", src: '侵权图库贰', note: "[侵权] Soulfly 飞灵乐队    美国重金属乐队" },
  { kw: "jimi hendrix吉米·亨德里克斯 吉米·亨德里克斯体验乐队主音吉他手兼主唱", src: '侵权图库贰', note: "[侵权] jimi hendrix吉米·亨德里克斯  吉米·亨德里克斯体验乐队主音吉他手兼主唱" },
  { kw: "bon jovi邦乔维 美国硬摇滚乐队", src: '侵权图库贰', note: "[侵权] Bon Jovi邦乔维 美国硬摇滚乐队" },
  { kw: "guns n' roses/gnr枪与玫瑰乐队 英国重金属摇滚乐队", src: '侵权图库贰', note: "[涉嫌侵权] Guns N' Roses/GNR枪与玫瑰乐队 英国重金属摇滚乐队" },
  { kw: "black sabbath黑色安息日乐队 英国重金属摇滚乐队", src: '侵权图库贰', note: "[涉嫌侵权] Black Sabbath黑色安息日乐队 英国重金属摇滚乐队" },
  { kw: "alice in chains爱丽丝囚徒乐队 摇滚乐队", src: '侵权图库贰', note: "[涉嫌侵权] Alice In Chains爱丽丝囚徒乐队  摇滚乐队" },
  { kw: "rammstein band modern乐队", src: '侵权图库贰', note: "[英国站侵权] Rammstein Band Modern乐队" },
  { kw: "shoreline mafia 美国乐团", src: '侵权图库贰', note: "[侵权] Shoreline Mafia   美国乐团" },
  { kw: "运动员", src: '侵权图库贰', note: "运动员" },
  { kw: "罗纳尔多ronaldo luiz nazario de lima 足球运动员", src: '侵权图库贰', note: "[侵权] 罗纳尔多Ronaldo Luiz Nazario De Lima   足球运动员" },
  { kw: "ronaldo c罗", src: '侵权图库贰', note: "[侵权] RoNaldo   C罗" },
  { kw: "迭戈·阿曼多·马拉多纳diego armando maradona 阿根廷球星", src: '侵权图库贰', note: "[侵权] 迭戈·阿曼多·马拉多纳Diego Armando Maradona     阿根廷球星" },
  { kw: "哈里·凯恩harry kane 英格兰足球运动员", src: '侵权图库贰', note: "[侵权] 哈里·凯恩Harry Kane  英格兰足球运动员" },
  { kw: "罗伯特·莱万多夫斯基robert lewandowski 波兰足球运动员", src: '侵权图库贰', note: "[侵权] 罗伯特·莱万多夫斯基Robert Lewandowski    波兰足球运动员" },
  { kw: "韦恩·鲁尼 wayne rooney 英格兰足球运动员", src: '侵权图库贰', note: "[侵权] 韦恩·鲁尼 Wayne Rooney    英格兰足球运动员" },
  { kw: "卢里克.吉斯拉松rurik gislason 冰岛足球运动员", src: '侵权图库贰', note: "卢里克.吉斯拉松Rurik Gislason         冰岛足球运动员" },
  { kw: "曼努埃尔·诺伊尔 manuel 德国足球运动员", src: '侵权图库贰', note: "[侵权] 曼努埃尔·诺伊尔 Manuel   德国足球运动员" },
  { kw: "丹尼尔·里卡多 daniel ricciardo 澳大利亚一级方程式车手", src: '侵权图库贰', note: "[侵权] 丹尼尔·里卡多 Daniel Ricciardo   澳大利亚一级方程式车手" },
  { kw: "lewis hamilton 刘易斯·汉密尔顿 f1史上第一位黑人车手", src: '侵权图库贰', note: "[侵权] Lewis Hamilton  刘易斯·汉密尔顿    F1史上第一位黑人车手" },
  { kw: "罗曼·雷恩roman reigns 现任wwe环球冠军", src: '侵权图库贰', note: "[侵权] 罗曼·雷恩Roman Reigns      现任WWE环球冠军" },
  { kw: "贝基·林奇becky lynch 首任wwe smackdown女子冠军", src: '侵权图库贰', note: "[侵权] 贝基·林奇Becky Lynch  首任WWE SmackDown女子冠军" },
  { kw: "迈克·泰森 mike tyson，美国重量级拳击职业运动员，演员", src: '侵权图库贰', note: "迈克·泰森 Mike Tyson，美国重量级拳击职业运动员，演员" },
  { kw: "泰森·富里 tyson fury 英国职业拳击运动员", src: '侵权图库贰', note: "[侵权] 泰森·富里 Tyson Fury     英国职业拳击运动员" },
  { kw: "约翰·塞纳 john cena 美国职业摔角运动员", src: '侵权图库贰', note: "[欧洲] 约翰·塞纳 John Cena    美国职业摔角运动员" },
  { kw: "卡里姆·阿布杜尔-贾巴尔 kareem abdul-jabbar 前美国职业篮球运动员", src: '侵权图库贰', note: "[侵权（文字、图案Logo是侵权雷点）] 卡里姆·阿布杜尔-贾巴尔 Kareem Abdul-Jabbar  前美国职业篮球运动员" },
  { kw: "穆奇-贝茨mookie betts 美国棒球运动员", src: '侵权图库贰', note: "[侵权] 穆奇-贝茨Mookie Betts    美国棒球运动员" },
  { kw: "匹兹堡钢人队pittsburgh steelers 美式橄榄球队 devin bush德文布什 橄榄球运动员", src: '侵权图库贰', note: "[涉嫌侵权] 匹兹堡钢人队Pittsburgh Steelers 美式橄榄球队 Devin Bush德文布什 橄榄球运动员" },
  { kw: "德西·杰克逊 desean jackson 美国橄榄球运动员", src: '侵权图库贰', note: "[侵权] 德西·杰克逊 Desean Jackson   美国橄榄球运动员" },
  { kw: "卡罗来纳黑豹（carolina panthers） 职业美式橄榄球球队", src: '侵权图库贰', note: "[侵权] 卡罗来纳黑豹（Carolina Panthers） 职业美式橄榄球球队" },
  { kw: "游戏类", src: '侵权图库贰', note: "游戏类" },
  { kw: "网游类题材的都不要去碰", src: '侵权图库贰', note: "网游类题材的都不要去碰" },
  { kw: "赛博朋克2077 cyberpunk 2077 动作角色类游戏", src: '侵权图库贰', note: "[侵权] 赛博朋克2077 Cyberpunk 2077  动作角色类游戏" },
  { kw: "刺客信条assassin's creed 冒险类游戏 开发商：育碧蒙特利尔工作室", src: '侵权图库贰', note: "[侵权] 刺客信条Assassin's Creed 冒险类游戏 开发商：育碧蒙特利尔工作室" },
  { kw: "我的世界minecraft 建造类游戏", src: '侵权图库贰', note: "[侵权] 我的世界Minecraft 建造类游戏" },
  { kw: "极限竞速：地平线forza horizon 竞速游戏", src: '侵权图库贰', note: "[侵权] 极限竞速：地平线Forza Horizon 竞速游戏" },
  { kw: "荒野乱斗brawl stars 实时对战手游", src: '侵权图库贰', note: "[侵权] 荒野乱斗Brawl Stars 实时对战手游" },
  { kw: "福特尼特又名堡垒之夜 fortnite 射击游戏", src: '侵权图库贰', note: "[侵权] 福特尼特又名堡垒之夜 Fortnite 射击游戏" },
  { kw: "fortnite midas 堡垒之夜点金手", src: '侵权图库贰', note: "[侵权] Fortnite Midas 堡垒之夜点金手" },
  { kw: "fortnite 堡垒之夜", src: '侵权图库贰', note: "[涉嫌侵权] Fortnite 堡垒之夜" },
  { kw: "火箭联盟rocket league 网络游戏", src: '侵权图库贰', note: "[侵权] 火箭联盟Rocket League 网络游戏" },
  { kw: "英雄联盟league of legends 游戏海报", src: '侵权图库贰', note: "[侵权] 英雄联盟League of Legends 游戏海报" },
  { kw: "spartans halo 光晕 微软旗下射击游戏", src: '侵权图库贰', note: "[侵权] Spartans Halo 光晕 微软旗下射击游戏" },
  { kw: "部落冲突 clash of clans 塔防类的策略手游", src: '侵权图库贰', note: "[侵权] 部落冲突 Clash of Clans 塔防类的策略手游" },
  { kw: "辐射系列（1-4）fallout 角色扮演游戏", src: '侵权图库贰', note: "[侵权] 辐射系列（1-4）Fallout 角色扮演游戏" },
  { kw: "吃鸡游戏key game 游戏海报", src: '侵权图库贰', note: "[侵权] 吃鸡游戏KEY GAME 游戏海报" },
  { kw: "刺猬索尼克 sonic the hedgehog 世嘉旗下一款电玩游戏/卡通动漫系列", src: '侵权图库贰', note: "[涉嫌侵权] 刺猬索尼克 Sonic the Hedgehog 世嘉旗下一款电玩游戏/卡通动漫系列" },
  { kw: "friday night funkin 音乐游戏", src: '侵权图库贰', note: "Friday Night Funkin 音乐游戏" },
  { kw: "玩具熊的五夜后宫five nights at freddy's 模拟、恐怖、惊悚游戏", src: '侵权图库贰', note: "[侵权] 玩具熊的五夜后宫Five Nights at Freddy's 模拟、恐怖、惊悚游戏" },
  { kw: "糖豆人fall guys 闯关综艺游戏", src: '侵权图库贰', note: "[侵权] 糖豆人Fall Guys 闯关综艺游戏" },
  { kw: "塞尔达传说zelda 任天堂旗下游戏", src: '侵权图库贰', note: "[侵权] 塞尔达传说Zelda 任天堂旗下游戏" },
  { kw: "amongus 任天堂旗下 策略休闲游戏", src: '侵权图库贰', note: "[侵权] Amongus 任天堂旗下 策略休闲游戏" },
  { kw: "nintendo 任天堂旗下侵权 the legend of zelda、pokemon、mario", src: '侵权图库贰', note: "[侵权] Nintendo 任天堂旗下侵权 The Legend of Zelda、Pokemon、Mario" },
  { kw: "血源诅咒bloodborne 由fromsoftware开发的arpg游戏", src: '侵权图库贰', note: "[侵权] 血源诅咒Bloodborne 由FromSoftware开发的ARPG游戏" },
  { kw: "血源诅咒的衍生人物doll maria", src: '侵权图库贰', note: "[侵权] 血源诅咒的衍生人物doll maria" },
  { kw: "genshin impact原神 米哈游制作发行", src: '侵权图库贰', note: "[侵权] genshin impact原神 米哈游制作发行" },
  { kw: "terraria泰拉瑞亚 由re-logic公司开发的沙盒游戏", src: '侵权图库贰', note: "[侵权] Terraria泰拉瑞亚 由Re-Logic公司开发的沙盒游戏" },
  { kw: "cd projekt、ubisoft育碧、mojang studios、xbox game studios（原名微软工作室）、telltale games、supercell超级细胞、epic games、psyonix、interplay娱乐、krafton、sega世嘉、scott cawthon、devolver digital、任天堂、fromsoftware、米哈游、re-logic，这些公司出品的游戏都不要上", src: '侵权图库贰', note: "CD Projekt、Ubisoft育碧、Mojang Studios、Xbox Game Studios（原名微软工作室）、Telltale Games、Supercell超级细胞、Epic Games、Psyonix、Interplay娱乐、Krafton、SEGA世嘉、Scott Cawthon、Devolver Digital、任天堂、FromSoftware、米哈游、Re-Logic，这些公司出品的游戏都不要上" },
  { kw: "动画/动漫类", src: '侵权图库贰', note: "动画/动漫类" },
  { kw: "doraemon哆啦a梦", src: '侵权图库贰', note: "[侵权] Doraemon哆啦A梦" },
  { kw: "一拳超人 one punch-man one的作品", src: '侵权图库贰', note: "[侵权] 一拳超人 ONE PUNCH-MAN one的作品" },
  { kw: "灵能百分百 mob psycho 100 one的作品", src: '侵权图库贰', note: "[侵权] 灵能百分百 Mob Psycho 100 one的作品" },
  { kw: "魔界的大叔 one的作品", src: '侵权图库贰', note: "[侵权] 魔界的大叔 one的作品" },
  { kw: "太阳侠 one的作品", src: '侵权图库贰', note: "[侵权] 太阳侠 one的作品" },
  { kw: "地球怪兽 one的作品", src: '侵权图库贰', note: "[侵权] 地球怪兽 one的作品" },
  { kw: "弹丸天使后援会 one的作品", src: '侵权图库贰', note: "[侵权] 弹丸天使后援会 one的作品" },
  { kw: "动物新世代 trigger制作", src: '侵权图库贰', note: "[侵权] 动物新世代 TRIGGER制作" },
  { kw: "动物狂想曲 beastars制作", src: '侵权图库贰', note: "[侵权] 动物狂想曲 BEASTARS制作" },
  { kw: "蟑螂克星 one的作品", src: '侵权图库贰', note: "[侵权] 蟑螂克星 one的作品" },
  { kw: "怒涛的勇者们 one的作品", src: '侵权图库贰', note: "[侵权] 怒涛的勇者们 one的作品" },
  { kw: "bleach死神 one的作品", src: '侵权图库贰', note: "[侵权] BLEACH死神 one的作品" },
  { kw: "约定的梦幻岛 the promised neverland", src: '侵权图库贰', note: "[侵权] 约定的梦幻岛 The Promised Neverland" },
  { kw: "南方公园 south park 美国成人动画", src: '侵权图库贰', note: "[侵权] 南方公园 South Park 美国成人动画" },
  { kw: "少年骇客ben 10 美国科幻动画片", src: '侵权图库贰', note: "[侵权] 少年骇客Ben 10 美国科幻动画片" },
  { kw: "刺猬索尼克 sonic the hedgehog 世嘉旗卡通动漫系列", src: '侵权图库贰', note: "[涉嫌侵权] 刺猬索尼克 Sonic the Hedgehog 世嘉旗卡通动漫系列" },
  { kw: "宝可梦pokemon （曾译名《精灵宝可梦》）", src: '侵权图库贰', note: "[侵权] 宝可梦pokemon （曾译名《精灵宝可梦》）" },
  { kw: "龙珠 dragonball", src: '侵权图库贰', note: "[侵权] 龙珠 Dragonball" },
  { kw: "犬夜叉inuyasha", src: '侵权图库贰', note: "[侵权] 犬夜叉Inuyasha" },
  { kw: "面包理发店bread barbershop 韩国动画", src: '侵权图库贰', note: "[侵权] 面包理发店Bread Barbershop 韩国动画" },
  { kw: "海绵宝宝 spongebob squarepants 美国喜剧动画", src: '侵权图库贰', note: "[侵权] 海绵宝宝 SpongeBob SquarePants 美国喜剧动画" },
  { kw: "粉红豹 pink panther 美国卡通人物", src: '侵权图库贰', note: "[侵权] 粉红豹 Pink Panther 美国卡通人物" },
  { kw: "小黄人minions", src: '侵权图库贰', note: "[侵权] 小黄人Minions" },
  { kw: "忍者神龟teenage mutant ninja turtles tmnt", src: '侵权图库贰', note: "[侵权] 忍者神龟Teenage Mutant Ninja Turtles TMNT" },
  { kw: "鬼妈妈 2009年出品的美国停格惊悚奇幻动画电影", src: '侵权图库贰', note: "鬼妈妈 2009年出品的美国停格惊悚奇幻动画电影" },
  { kw: "瑞克和莫蒂 rick and morty 美国动画", src: '侵权图库贰', note: "[侵权] 瑞克和莫蒂 Rick and Morty 美国动画" },
  { kw: "战斗陀螺beyblade 陀螺玩具及其衍生acg作品系列", src: '侵权图库贰', note: "[侵权] 战斗陀螺beyblade 陀螺玩具及其衍生ACG作品系列" },
  { kw: "星际牛仔cowboy bebop 日本sunrise动画公司的原创动画", src: '侵权图库贰', note: "[侵权] 星际牛仔Cowboy Bebop 日本sunrise动画公司的原创动画" },
  { kw: "排球少年 haikyuu!! 日本漫画家古馆春一创作的少年漫画作品", src: '侵权图库贰', note: "[侵权] 排球少年 Haikyuu!! 日本漫画家古馆春一创作的少年漫画作品" },
  { kw: "诡辩学派、四谷前辈的怪谈 日本漫画家古馆春一创作", src: '侵权图库贰', note: "[侵权] 诡辩学派、四谷前辈的怪谈 日本漫画家古馆春一创作" },
  { kw: "动物狂想曲 beastars 女漫画家板垣巴留的长篇连载漫画", src: '侵权图库贰', note: "[侵权] 动物狂想曲 BEASTARS 女漫画家板垣巴留的长篇连载漫画" },
  { kw: "高桥留美子的漫画作品侵权，以下为高桥留美子的代表作品。福星小子 urusei yatsura 相聚一刻 maison ikkoku 乱马1/2 ranma 1/2 犬夜叉 inuyasha 境界之轮回 kyokai no rinne 人鱼之森 ningyo no mori 一磅的福音 one pound gospel", src: '侵权图库贰', note: "高桥留美子的漫画作品侵权，以下为高桥留美子的代表作品。福星小子 Urusei Yatsura 相聚一刻 Maison Ikkoku 乱马1/2 Ranma 1/2 犬夜叉 Inuyasha 境界之轮回 Kyokai no Rinne 人鱼之森 Ningyo No Mori 一磅的福音 One Pound Gospel" },
  { kw: "高屋奈月，日本少女漫画作家，其作品侵权，以下为高屋奈月的作品。水果篮子 fruits basket 梦想一世情 羽翼天使 我是你的天使 星歌奇缘 莉泽罗黛与魔女之森", src: '侵权图库贰', note: "高屋奈月，日本少女漫画作家，其作品侵权，以下为高屋奈月的作品。水果篮子 Fruits Basket 梦想一世情 羽翼天使 我是你的天使 星歌奇缘 莉泽罗黛与魔女之森" },
  { kw: "龙猫 宫崎骏执导动画电影", src: '侵权图库贰', note: "[日本站侵权] 龙猫 宫崎骏执导动画电影" },
  { kw: "akira阿基拉 东宝株式会社出品科幻动画电影", src: '侵权图库贰', note: "[侵权] Akira阿基拉 东宝株式会社出品科幻动画电影" },
  { kw: "米妮老鼠 minnie mouse", src: '侵权图库贰', note: "[侵权] 米妮老鼠 Minnie Mouse" },
  { kw: "米奇老鼠 mickey mouse", src: '侵权图库贰', note: "[侵权] 米奇老鼠 Mickey Mouse" },
  { kw: "唐老鸭\"don\"donald fauntleroy duck", src: '侵权图库贰', note: "[侵权] 唐老鸭\"Don\"Donald Fauntleroy Duck" },
  { kw: "高飞 goofy", src: '侵权图库贰', note: "[侵权] 高飞 goofy" },
  { kw: "帕丁顿熊paddington 英国儿童文学经典形象", src: '侵权图库贰', note: "[美国 知识产权投诉] 帕丁顿熊Paddington 英国儿童文学经典形象" },
  { kw: "gorillaz 英国虚拟乐队", src: '侵权图库贰', note: "[侵权] Gorillaz 英国虚拟乐队" },
  { kw: "初音未来hatsune miku 日本虚拟偶像", src: '侵权图库贰', note: "[侵权] 初音未来Hatsune Miku 日本虚拟偶像" },
  { kw: "bold and brash squidward（章鱼）", src: '侵权图库贰', note: "[侵权] Bold and Brash Squidward（章鱼）" },
  { kw: "艺术类", src: '侵权图库贰', note: "艺术类" },
  { kw: "找图的时候避免找那种一个公司设计的成套的图片，比如 已知的 黑光 black light、复古旅游 vintage travel 等等，以及spacefrog风格的图片 找到后可以先咨询技术人员是否存在侵权风险再去上架。", src: '侵权图库贰', note: "找图的时候避免找那种一个公司设计的成套的图片，比如 已知的 黑光 black light、复古旅游 Vintage travel 等等，以及spacefrog风格的图片 找到后可以先咨询技术人员是否存在侵权风险再去上架。" },
  { kw: "美国插画家 aja kusick 星空梵高艺术绘画系列", src: '侵权图库贰', note: "[侵权] 美国插画家 Aja Kusick 星空梵高艺术绘画系列" },
  { kw: "ernie barnes画家 复古画作 retro poster dancing couple by ernie barnes", src: '侵权图库贰', note: "[侵权] Ernie Barnes画家 复古画作 Retro Poster Dancing Couple by Ernie Barnes" },
  { kw: "dan mumford 电影插画师 他的画不行", src: '侵权图库贰', note: "[侵权] Dan Mumford 电影插画师 他的画不行" },
  { kw: "seattle space needle 西雅图的太空针塔复古旅游海报", src: '侵权图库贰', note: "[侵权] Seattle Space Needle 西雅图的太空针塔复古旅游海报" },
  { kw: "纽约市 new york city 复古旅游海报", src: '侵权图库贰', note: "[侵权] 纽约市 New York City 复古旅游海报" },
  { kw: "travel poster los angeles california 加利福利亚洲复古旅游海报", src: '侵权图库贰', note: "[侵权] Travel Poster Los Angeles California 加利福利亚洲复古旅游海报" },
  { kw: "大峡谷国家公园 grand canyon national park 复古海报", src: '侵权图库贰', note: "[侵权] 大峡谷国家公园 Grand Canyon National Park 复古海报" },
  { kw: "national park poster 2021 foundation wall calendar 2021年国家公园海报挂历", src: '侵权图库贰', note: "[侵权] National Park poster 2021 Foundation Wall Calendar 2021年国家公园海报挂历" },
  { kw: "巴西 brazil 复古旅游海报", src: '侵权图库贰', note: "[侵权] 巴西 BRAZIL 复古旅游海报" },
  { kw: "purple nice butt cat nice butt这个系列的复古海报都不行", src: '侵权图库贰', note: "[侵权] Purple Nice Butt Cat Nice Butt这个系列的复古海报都不行" },
  { kw: "i am the liquor 我是酒复古海报", src: '侵权图库贰', note: "[侵权] I am the liquor 我是酒复古海报" },
  { kw: "a day to remember （简称adtr） 美国摇滚乐队 复古风格海报", src: '侵权图库贰', note: "[侵权] A Day To Remember （简称ADTR） 美国摇滚乐队 复古风格海报" },
  { kw: "复古海报", src: '侵权图库贰', note: "[侵权] 复古海报" },
  { kw: "植物科普海报cavallini decorative wrap", src: '侵权图库贰', note: "[侵权] 植物科普海报Cavallini Decorative Wrap" },
  { kw: "多肉植物海报vintage posters cacti succulent", src: '侵权图库贰', note: "[侵权] 多肉植物海报vintage posters cacti succulent" },
  { kw: "dia de los muertos marionette 亡灵节（墨西哥清明节）形象海报", src: '侵权图库贰', note: "[侵权] Dia De Los Muertos marionette 亡灵节（墨西哥清明节）形象海报" },
  { kw: "michael tompsett 艺术家 创作类型：城市天际线和地图艺术", src: '侵权图库贰', note: "[侵权] Michael tompsett 艺术家 创作类型：城市天际线和地图艺术" },
  { kw: "the optimist rose tinted glasses by laura graves（劳拉·格雷夫斯）", src: '侵权图库贰', note: "[侵权] The Optimist Rose Tinted Glasses by Laura Graves（劳拉·格雷夫斯）" },
  { kw: "艺术家keith haring 的画作", src: '侵权图库贰', note: "[侵权] 艺术家Keith Haring 的画作" },
  { kw: "evening mist 这种风格的风景图都有抓", src: '侵权图库贰', note: "[侵权] Evening Mist 这种风格的风景图都有抓" },
  { kw: "美国职业画家 thomas kinkade 的画", src: '侵权图库贰', note: "[侵权] 美国职业画家 Thomas Kinkade 的画" },
  { kw: "凯斯·哈林keith haring 美国街头绘画艺术家的作品", src: '侵权图库贰', note: "[侵权] 凯斯·哈林Keith Haring 美国街头绘画艺术家的作品" },
  { kw: "bob orsillo 这个artist（艺术家） 疯狂王牌", src: '侵权图库贰', note: "[侵权] Bob Orsillo 这个artist（艺术家） 疯狂王牌" },
  { kw: "bike hard 自行车艺术", src: '侵权图库贰', note: "[侵权] Bike Hard 自行车艺术" },
  { kw: "https://baijiahao.baidu.com/s?id=1595360050147855944&wfr=spider&for=pc 黑光海报科普链接", src: '侵权图库贰', note: "https://baijiahao.baidu.com/s?id=1595360050147855944&wfr=spider&for=pc 黑光海报科普链接" },
  { kw: "mushroom man 黑光海报", src: '侵权图库贰', note: "[侵权] mushroom man 黑光海报" },
  { kw: "stoned to the bone blacklight 骷髅头黑光海报", src: '侵权图库贰', note: "[侵权] Stoned to The Bone Blacklight 骷髅头黑光海报" },
  { kw: "blacklight 黑光海报", src: '侵权图库贰', note: "[侵权] Blacklight 黑光海报" },
  { kw: "和平巴士黑光海报", src: '侵权图库贰', note: "[侵权] 和平巴士黑光海报" },
  { kw: "画家alex grey 的 oceans of love bliss", src: '侵权图库贰', note: "[侵权] 画家Alex Grey 的 Oceans of Love Bliss" },
  { kw: "英国艺术家josephine wall spirit of flight", src: '侵权图库贰', note: "[侵权] 英国艺术家Josephine Wall spirit of flight" },
  { kw: "woman art nouveau 新艺术女性", src: '侵权图库贰', note: "[侵权] woman art nouveau 新艺术女性" },
  { kw: "indigo desert night 静谧沙漠之夜", src: '侵权图库贰', note: "[侵权] Indigo Desert Night 静谧沙漠之夜" },
  { kw: "vivid biology unravelling brains neuroscience 这种风格诠释大脑神经的海报", src: '侵权图库贰', note: "[侵权] Vivid Biology Unravelling brains neuroscience 这种风格诠释大脑神经的海报" },
  { kw: "sugar skull girl with bird 巫女和鸟", src: '侵权图库贰', note: "[侵权] Sugar Skull Girl with Bird 巫女和鸟" },
  { kw: "the prayer at valley forge george washington arnold friberg（阿诺德·弗里伯格这个画家的不行）", src: '侵权图库贰', note: "[侵权] The Prayer At Valley Forge George Washington Arnold Friberg（阿诺德·弗里伯格这个画家的不行）" },
  { kw: "家庭树（族谱）family tree art poster", src: '侵权图库贰', note: "[侵权] 家庭树（族谱）Family Tree Art Poster" },
  { kw: "复古法国广告海报 intage french advertising poste", src: '侵权图库贰', note: "[侵权] 复古法国广告海报 intage French Advertising Poste" },
  { kw: "美国艺术家derek deyoung德里克·德扬的作品和文字商标\"deyoung\"不能用", src: '侵权图库贰', note: "[侵权] 美国艺术家Derek DeYoung德里克·德扬的作品和文字商标\"DEYOUNG\"不能用" },
  { kw: "品牌、logo类", src: '侵权图库贰', note: "品牌、logo类" },
  { kw: "尤文图斯足球俱乐部 juventus f.c.", src: '侵权图库贰', note: "[侵权] 尤文图斯足球俱乐部 Juventus F.C." },
  { kw: "精灵独角兽品牌 anne stokes", src: '侵权图库贰', note: "[侵权] 精灵独角兽品牌 Anne Stokes" },
  { kw: "德雷克drake 音乐人创立的 ovo 音乐团体、街头品牌", src: '侵权图库贰', note: "[侵权] 德雷克Drake 音乐人创立的 OVO 音乐团体、街头品牌" },
  { kw: "kaws 街头艺术品牌 只要有kaws全部删除", src: '侵权图库贰', note: "[侵权] Kaws 街头艺术品牌 只要有KAWS全部删除" },
  { kw: "杰克丹尼尔 jack daniel's", src: '侵权图库贰', note: "[律师函] 杰克丹尼尔 JACK DANIEL'S" },
  { kw: "stone island 休闲装品牌", src: '侵权图库贰', note: "Stone Island 休闲装品牌" },
  { kw: "阿迪 耐克 kappa 照片里面有出现商标的，尽量抠掉或者涂掉", src: '侵权图库贰', note: "[侵权] 阿迪 耐克 kappa 照片里面有出现商标的，尽量抠掉或者涂掉" },
  { kw: "汽车类标题不能带车的品牌名字：比如奥迪，奔驰，宝马 最好车的标志看不清楚的图片可以上，看的很清楚最好不要上！！兰博基尼等德系欧洲的跑车都不要上，gtr不要上！！", src: '侵权图库贰', note: "[侵权] 汽车类标题不能带车的品牌名字：比如奥迪，奔驰，宝马 最好车的标志看不清楚的图片可以上，看的很清楚最好不要上！！兰博基尼等德系欧洲的跑车都不要上，GTR不要上！！" },
  { kw: "thrasher 滑板杂志品牌", src: '侵权图库贰', note: "[侵权] thrasher 滑板杂志品牌" },
  { kw: "triumph凯旋摩托车 英国的一家摩托车制造公司", src: '侵权图库贰', note: "[侵权] Triumph凯旋摩托车 英国的一家摩托车制造公司" },
  { kw: "电影类", src: '侵权图库贰', note: "电影类" },
  { kw: "迪士尼、漫威、亚马逊、dc、派拉蒙、传奇影业这几家公司出品发行的电影都不行！！！某部电影不确定的时候先自己百度查一下是不是这几家公司的！！！", src: '侵权图库贰', note: "迪士尼、漫威、亚马逊、DC、派拉蒙、传奇影业这几家公司出品发行的电影都不行！！！某部电影不确定的时候先自己百度查一下是不是这几家公司的！！！" },
  { kw: "e.t.外星人 e.t. the extra-terrestrial", src: '侵权图库贰', note: "[侵权] E.T.外星人 E.T. the Extra-Terrestrial" },
  { kw: "敢死队 the expendables", src: '侵权图库贰', note: "[律师函] 敢死队 The Expendables" },
  { kw: "惊声尖叫scream 美国恐怖片", src: '侵权图库贰', note: "[侵权] 惊声尖叫Scream 美国恐怖片" },
  { kw: "德州电锯杀人狂the texas chainsaw massacre 美国恐怖片", src: '侵权图库贰', note: "[侵权] 德州电锯杀人狂The Texas Chainsaw Massacre 美国恐怖片" },
  { kw: "v字仇杀队 v for vendetta 华纳兄弟公司", src: '侵权图库贰', note: "[侵权] V字仇杀队 V for Vendetta 华纳兄弟公司" },
  { kw: "哥斯拉大战金刚 godzilla vs kong 出品公司传奇影业 发行公司华纳兄弟电影公司", src: '侵权图库贰', note: "[侵权] 哥斯拉大战金刚 Godzilla Vs Kong 出品公司传奇影业 发行公司华纳兄弟电影公司" },
  { kw: "环太平洋 pacific rim 传奇影业、华纳兄弟", src: '侵权图库贰', note: "[律师函] 环太平洋 PACIFIC RIM 传奇影业、华纳兄弟" },
  { kw: "忍者神龟teenage mutant ninja turtles 华纳兄弟", src: '侵权图库贰', note: "[侵权] 忍者神龟Teenage Mutant Ninja Turtles 华纳兄弟" },
  { kw: "哈利·波特 harry potter 华纳兄弟", src: '侵权图库贰', note: "[侵权] 哈利·波特 Harry Potter 华纳兄弟" },
  { kw: "侏罗纪公园 jurassic park 美国环球影业", src: '侵权图库贰', note: "[侵权] 侏罗纪公园 Jurassic Park 美国环球影业" },
  { kw: "极速风流 rush 美国环球影业", src: '侵权图库贰', note: "[侵权] 极速风流 Rush 美国环球影业" },
  { kw: "小黄人minions 美国环球影业", src: '侵权图库贰', note: "[侵权] 小黄人Minions 美国环球影业" },
  { kw: "活死人之夜 night of the living dead 美国环球影业", src: '侵权图库贰', note: "[侵权] 活死人之夜 Night of the Living Dead 美国环球影业" },
  { kw: "早餐俱乐部the breakfast club 1985年 美国环球影业", src: '侵权图库贰', note: "[侵权] 早餐俱乐部The Breakfast Club 1985年 美国环球影业" },
  { kw: "驯龙高手 how to train your dragon 梦工厂 派拉蒙影业公司", src: '侵权图库贰', note: "[侵权] 驯龙高手 How to Train Your Dragon 梦工厂 派拉蒙影业公司" },
  { kw: "变形金刚transformer 派拉蒙影业公司 梦工厂", src: '侵权图库贰', note: "[侵权] 变形金刚Transformer 派拉蒙影业公司 梦工厂" },
  { kw: "la boca 大都会metropolis 德国电影 派拉蒙影业、乌发电影公司", src: '侵权图库贰', note: "[侵权] La Boca 大都会Metropolis 德国电影 派拉蒙影业、乌发电影公司" },
  { kw: "低俗小说 pulp fiction 美国电影 米拉麦克斯影业公司等", src: '侵权图库贰', note: "[侵权] 低俗小说 Pulp Fiction 美国电影 米拉麦克斯影业公司等" },
  { kw: "僵尸警察zombie cop 美国电影", src: '侵权图库贰', note: "[侵权] 僵尸警察Zombie cop 美国电影" },
  { kw: "pink power ranger 超凡战队(科幻、动作、冒险片 )粉衣战士", src: '侵权图库贰', note: "[侵权] Pink Power Ranger 超凡战队(科幻、动作、冒险片 )粉衣战士" },
  { kw: "猜火车trainspotting 英国电影", src: '侵权图库贰', note: "[侵权] 猜火车Trainspotting 英国电影" },
  { kw: "阴风阵阵 suspiria 恐怖片", src: '侵权图库贰', note: "[侵权] 阴风阵阵 suspiria 恐怖片" },
  { kw: "星球大战star wars 出品公司卢卡斯影业公司 发行公司20世纪福克斯公司、迪士尼电影公司", src: '侵权图库贰', note: "[侵权] 星球大战Star Wars 出品公司卢卡斯影业公司 发行公司20世纪福克斯公司、迪士尼电影公司" },
  { kw: "boba-fett（星球大战中的角色）-in-bathroom（上厕所）", src: '侵权图库贰', note: "[侵权] Boba-Fett（星球大战中的角色）-in-Bathroom（上厕所）" },
  { kw: "鼠来宝 alvin and the chipmunks 出品公司、发行公司20世纪福克斯", src: '侵权图库贰', note: "[侵权] 鼠来宝 Alvin and the Chipmunks 出品公司、发行公司20世纪福克斯" },
  { kw: "蓝精灵the smurfs 索尼动画，哥伦比亚影片公司", src: '侵权图库贰', note: "[律师函] 蓝精灵The Smurfs 索尼动画，哥伦比亚影片公司" },
  { kw: "暮光之城 the twilight saga", src: '侵权图库贰', note: "暮光之城 The twilight saga" },
  { kw: "魔戒/指环王 the lord of the rings", src: '侵权图库贰', note: "[侵权] 魔戒/指环王 The Lord of the Rings" },
  { kw: "警网铁金刚 bullitt 美国动作片", src: '侵权图库贰', note: "[侵权] 警网铁金刚 Bullitt 美国动作片" },
  { kw: "荒野大镖客red dead redemption", src: '侵权图库贰', note: "[侵权] 荒野大镖客Red Dead Redemption" },
  { kw: "大白鲨 jaws 美国惊悚电影 环球影业出品", src: '侵权图库贰', note: "[侵权] 大白鲨 jaws 美国惊悚电影 环球影业出品" },
  { kw: "月光光心慌慌 halloween 美国惊悚电影", src: '侵权图库贰', note: "[侵权] 月光光心慌慌 halloween 美国惊悚电影" },
  { kw: "回到未来back to the future 美国环球影业", src: '侵权图库贰', note: "[侵权] 回到未来Back To The Future 美国环球影业" },
  { kw: "godzilla 新·哥斯拉 日本东宝公司出品电影美国", src: '侵权图库贰', note: "[律师函] GODZILLA 新·哥斯拉 日本东宝公司出品电影美国" },
  { kw: "【漫威所有都侵权】--以下为旗下英雄人物，演员生活照也不行，切记！！！", src: '侵权图库贰', note: "【漫威所有都侵权】--以下为旗下英雄人物，演员生活照也不行，切记！！！" },
  { kw: "音乐类", src: '侵权图库贰', note: "音乐类" },
  { kw: "travis scott 全新专辑《astroworld》", src: '侵权图库贰', note: "Travis Scott 全新专辑《Astroworld》" },
  { kw: "<i'm new here> 音乐专辑 歌手：gil scott-heron、makaya mccraven", src: '侵权图库贰', note: "[侵权] <I'm New Here> 音乐专辑 歌手：Gil Scott-Heron、Makaya McCraven" },
  { kw: "pearl jam music poster珍珠果酱乐队音乐海报", src: '侵权图库贰', note: "[侵权] Pearl Jam music poster珍珠果酱乐队音乐海报" },
  { kw: "metallica concert 金属乐队metallica演唱会海报", src: '侵权图库贰', note: "[律师函] Metallica concert 金属乐队Metallica演唱会海报" },
  { kw: "特拉维斯·斯科特travis scott 创办的 astroworld festival巡回演出", src: '侵权图库贰', note: "[侵权] 特拉维斯·斯科特Travis Scott 创办的 Astroworld Festival巡回演出" },
  { kw: "pink freud 平克·弗洛伊德英国摇滚乐队的专辑 《 animals》", src: '侵权图库贰', note: "[律师函] Pink Freud 平克·弗洛伊德英国摇滚乐队的专辑 《 Animals》" },
  { kw: "韩国音乐剧 hedwig", src: '侵权图库贰', note: "[侵权] 韩国音乐剧 Hedwig" },
  { kw: "甲壳虫乐队the beatles 音乐海报", src: '侵权图库贰', note: "[律师函] 甲壳虫乐队The Beatles 音乐海报" },
  { kw: "beetlejuice soundtrack 《阴间大法师》原声带 丹尼·艾夫曼和哈里·贝拉的音乐专辑", src: '侵权图库贰', note: "Beetlejuice soundtrack 《阴间大法师》原声带 丹尼·艾夫曼和哈里·贝拉的音乐专辑" },
  { kw: "美剧、英剧等电视类", src: '侵权图库贰', note: "美剧、英剧等电视类" },
  { kw: "老友记friends 美剧", src: '侵权图库贰', note: "[侵权] 老友记friends 美剧" },
  { kw: "灵异妙探psych 美国侦探/罪案剧", src: '侵权图库贰', note: "[侵权] 灵异妙探Psych 美国侦探/罪案剧" },
  { kw: "怪奇物语 stranger things 美国科幻惊悚的美剧", src: '侵权图库贰', note: "[侵权] 怪奇物语 Stranger Things 美国科幻惊悚的美剧" },
  { kw: "眼镜蛇 cobra kai 2018年美国电视剧", src: '侵权图库贰', note: "[侵权] 眼镜蛇 Cobra Kai 2018年美国电视剧" },
  { kw: "吸血鬼日记 the vampire diaries 美剧", src: '侵权图库贰', note: "[侵权] 吸血鬼日记 The Vampire Diaries 美剧" },
  { kw: "行尸走肉 the walking dead", src: '侵权图库贰', note: "[侵权] 行尸走肉 The Walking Dead" },
  { kw: "权力的游戏（冰与火之歌） game of thrones", src: '侵权图库贰', note: "[侵权] 权力的游戏（冰与火之歌） Game of Thrones" },
  { kw: "绅士杰克gentleman jack 英剧", src: '侵权图库贰', note: "[侵权] 绅士杰克Gentleman Jack 英剧" },
  { kw: "纸钞屋money heist 西班牙犯罪类电视剧", src: '侵权图库贰', note: "[侵权] 纸钞屋Money Heist 西班牙犯罪类电视剧" },
  { kw: "神秘博士doctor who 英国bbc出品的科幻剧", src: '侵权图库贰', note: "[侵权] 神秘博士Doctor Who 英国BBC出品的科幻剧" },
  { kw: "浴血黑帮peaky blinders 英剧 以及主角tommy shelby", src: '侵权图库贰', note: "[侵权] 浴血黑帮Peaky Blinders 英剧 以及主角Tommy Shelby" },
  { kw: "绝命毒师breaking bad 美剧", src: '侵权图库贰', note: "[侵权] 绝命毒师Breaking Bad 美剧" },
  { kw: "其他类别", src: '侵权图库贰', note: "其他类别" },
  { kw: "哗啦圈hula hoop 专利侵权 图上别有呼啦圈", src: '侵权图库贰', note: "[律师函] 哗啦圈hula hoop 专利侵权 图上别有呼啦圈" },
  { kw: "科普类海报一律不要上", src: '侵权图库贰', note: "[侵权] 科普类海报一律不要上" },
  { kw: "propaganda 政治宣传类的海报", src: '侵权图库贰', note: "[违反受限商品政策] Propaganda 政治宣传类的海报" },
  { kw: "title not found motivational 这张冰山激励短句", src: '侵权图库贰', note: "[侵权] Title Not Found motivational 这张冰山激励短句" },
  { kw: "7 life rules inspirational /motivational posters 7条生活准则励志海报", src: '侵权图库贰', note: "[侵权] 7 Life Rules inspirational /Motivational posters 7条生活准则励志海报" },
  { kw: "不爽猫grumpy cat 又名暴躁猫 网红猫", src: '侵权图库贰', note: "[侵权] 不爽猫Grumpy Cat 又名暴躁猫 网红猫" },
  { kw: "sneaky cat 鬼猫 网红猫", src: '侵权图库贰', note: "[侵权] Sneaky Cat 鬼猫 网红猫" },
  { kw: "bunny blowing bubble gum 吹泡泡糖的兔子", src: '侵权图库贰', note: "[侵权] Bunny Blowing Bubble Gum 吹泡泡糖的兔子" },
  { kw: "three monkeys 三只叫horen zien zwijgen的猩猩的海报", src: '侵权图库贰', note: "[侵权] Three monkeys 三只叫Horen Zien Zwijgen的猩猩的海报" },
  { kw: "ufc联盟 终极格斗冠军赛", src: '侵权图库贰', note: "[律师函] UFC联盟 终极格斗冠军赛" },
  { kw: "蒙面恶棍masked villain 这种形象的海报", src: '侵权图库贰', note: "[侵权] 蒙面恶棍Masked Villain 这种形象的海报" },
  { kw: "boy mole horse fox （书）", src: '侵权图库贰', note: "[侵权] Boy Mole Horse Fox （书）" },
  { kw: "图书team 7", src: '侵权图库贰', note: "[侵权] 图书Team 7" },
  { kw: "情趣（love） 这张图不行", src: '侵权图库贰', note: "[侵权] 情趣（Love） 这张图不行" },
  { kw: "halley ; blue demon; blue fairy 、cwc 、pj 、locomotive 、pink floyd、grumpy cat 这些不行", src: '侵权图库贰', note: "[律师函] Halley ; Blue Demon; Blue Fairy 、CWC 、PJ 、locomotive 、pink floyd、Grumpy Cat 这些不行" },
  { kw: "sakura ，sky 别出现在命名里", src: '侵权图库贰', note: "Sakura ，Sky 别出现在命名里" },
  { kw: "30 这个数字命名里不要出现", src: '侵权图库贰', note: "30 这个数字命名里不要出现" },
  { kw: "death note 死亡笔记", src: '侵权图库贰', note: "Death Note 死亡笔记" },
  { kw: "科普教育不能上", src: '侵权图库贰', note: "科普教育不能上" },
  { kw: "日本站的色情图片不要上，艺术类的也不行", src: '侵权图库贰', note: "[侵权] 日本站的色情图片不要上，艺术类的也不行" },
  { kw: "动漫二次创作", src: '侵权图库贰', note: "动漫二次创作" },
  { kw: "tumblr账号为kkkktmon二次创作的动漫作品不要上", src: '侵权图库贰', note: "[涉嫌侵权] tumblr账号为kkkktmon二次创作的动漫作品不要上" },
  { kw: "敢死队expendabies", src: '侵权图库贰', note: "[律师函] 敢死队Expendabies" },
  { kw: "motorhead 摩托头乐队", src: '侵权图库贰', note: "[律师函] motorhead 摩托头乐队" },
  { kw: "iced earth 冰冻地球乐队", src: '侵权图库贰', note: "[律师函] Iced Earth 冰冻地球乐队" },
  { kw: "平克佛洛依德pink floyd / pink freud 英国摇滚乐队", src: '侵权图库贰', note: "[律师函] 平克佛洛依德pink floyd / Pink Freud 英国摇滚乐队" },
  { kw: "大卫·吉尔摩david gilmour --- pink floyd乐队的吉他手兼主唱", src: '侵权图库贰', note: "[律师函] 大卫·吉尔摩David gilmour --- Pink Floyd乐队的吉他手兼主唱" },
  { kw: "lemmy kilmister 摩托头乐队主唱莱米", src: '侵权图库贰', note: "[律师函] Lemmy Kilmister 摩托头乐队主唱莱米" },
  { kw: "chester bennington查斯特·贝宁顿 乐队林肯公园主唱", src: '侵权图库贰', note: "[律师函] Chester Bennington查斯特·贝宁顿 乐队林肯公园主唱" },
  { kw: "nirvana 涅槃乐队", src: '侵权图库贰', note: "[律师函] Nirvana 涅槃乐队" },
  { kw: "科特·柯本kurt donald cobain 美国歌手，涅槃乐队nirvana乐队的主唱兼吉他手", src: '侵权图库贰', note: "[律师函] 科特·柯本Kurt Donald Cobain 美国歌手，涅槃乐队Nirvana乐队的主唱兼吉他手" },
  { kw: "哈雷 harley-davidson 摩托车品牌", src: '侵权图库贰', note: "[律师函] 哈雷 Harley-Davidson 摩托车品牌" },
  { kw: "雷朋 rayban", src: '侵权图库贰', note: "[律师函] 雷朋 rayban" },
  { kw: "oakley 奥克利", src: '侵权图库贰', note: "[律师函] Oakley 奥克利" },
  { kw: "耐克nike", src: '侵权图库贰', note: "[律师函] 耐克nike" },
  { kw: "匡威converse", src: '侵权图库贰', note: "[律师函] 匡威converse" },
  { kw: "迪奥 dior", src: '侵权图库贰', note: "[律师函] 迪奥 dior" },
  { kw: "tiffany蒂芙尼", src: '侵权图库贰', note: "[律师函] Tiffany蒂芙尼" },
  { kw: "不爽猫 grumpy cat", src: '侵权图库贰', note: "[律师函] 不爽猫 Grumpy cat" },
  { kw: "snoopy 史努比", src: '侵权图库贰', note: "[律师函] Snoopy 史努比" },
  { kw: "蓝精灵 the smurfs", src: '侵权图库贰', note: "[律师函] 蓝精灵 the smurfs" },
  { kw: "彩虹猫nyan cat", src: '侵权图库贰', note: "[律师函] 彩虹猫nyan cat" },
  { kw: "godzilla 新·哥斯拉 日本东宝公司出品电影", src: '侵权图库贰', note: "[律师函] GODZILLA 新·哥斯拉 日本东宝公司出品电影" },
  { kw: "margaret leann rimes玛格丽特·黎安·莱姆斯 美国歌手美国", src: '侵权图库贰', note: "[律师函] Margaret LeAnn Rimes玛格丽特·黎安·莱姆斯 美国歌手美国" },
  { kw: "r.e.m.乐队,又译为快转眼球乐队 美国摇滚乐队", src: '侵权图库贰', note: "[律师函] R.E.M.乐队,又译为快转眼球乐队 美国摇滚乐队" },
  { kw: "潮牌及常见品牌律师函", src: '侵权图库贰', note: "潮牌及常见品牌律师函" },
  { kw: "这些全收律师函", src: '侵权图库贰', note: "这些全收律师函" }
];

function queryTeamDb(kws) {
  // 匹配优先级：整体输入词优先（可命中 Life Rules 等长尾原词）→ 无命中才回退长分词(≥4)，避免短词噪音误报
  const raw = kws.join(' ').toLowerCase().trim();
  const parts = kws.map(k => k.toLowerCase().trim()).filter(k => k.length >= 4);
  const collect = (list) => {
    const hits = [];
    for (const item of TEAM_DB) {
      const kw = item.kw.toLowerCase();
      const hit = list.find(k => kw.includes(k) || k.includes(kw));
      if (hit && hits.length < 10) hits.push({ kw: item.kw, src: item.src, note: item.note || '', hit });
    }
    return hits;
  };
  if (raw.length >= 2) {
    const hits = collect([raw]);
    if (hits.length) return hits;
  }
  return collect(parts);
}

const libCache = { t: 0, data: null }; // 12 小时缓存
async function fetchBrandLibraries() {
  if (libCache.data && Date.now() - libCache.t < 12 * 3600 * 1000) return libCache.data;
  // 运行时尝试补充文字版品牌库（失败降级为内置清单，零风险）
  const html = await fetchText('https://sellerdefense.cn/brands-text/', 5000, { 'Accept': 'text/html,*/*' });
  const brands = [...BUILTIN_BRANDS];
  if (html) {
    const re = /\b([A-Z][A-Za-z0-9 &'\u0027\.\-]{2,45})\b/g;
    let m; const seen = new Set(brands.map(b => b.toUpperCase()));
    while ((m = re.exec(html))) {
      const b = m[1].trim();
      const nb = b.toUpperCase();
      if (b.length >= 3 && !seen.has(nb) && !/^[A-Z\s]{1,4}$/.test(nb)) { seen.add(nb); brands.push(b); }
    }
  }
  libCache.t = Date.now(); libCache.data = [{ lib: 'SellerDefense', url: 'https://sellerdefense.cn/brands-text/', brands: brands.slice(0, 500) }];
  return libCache.data;
}

function normBrand(b) { return b.toUpperCase().replace(/[^A-Z0-9]/g, ''); }
async function queryBrandLibraries(kws) {
  const groups = await fetchBrandLibraries();
  const klist = kws.map(normBrand).filter(n => n.length >= 3);
  const hits = [];
  groups.forEach(g => {
    g.brands.forEach(b => {
      const nb = normBrand(b);
      if (nb.length < 4) return;
      const hit = klist.find(k => nb.includes(k) || k.includes(nb));
      if (hit && hits.length < 8) hits.push({ library: g.lib, brand: b, url: g.url });
    });
  });
  return { checked: true, total: groups.reduce((s, g) => s + g.brands.length, 0), hits };
}

function pickRisk(patents) {
  const strong = patents.filter(p => p.titleHits >= 2);
  const some = patents.filter(p => p.titleHits >= 1);
  const listNum = (arr) => arr.slice(0, 2).map(p => p.patentNumber + (p.title ? '《' + p.title.slice(0, 24) + '》' : '')).join('、');
  if (strong.length >= 2 || patents.length >= 3) return { level: 'high', label: '高风险', reason: `检索到 ${patents.length} 件相关专利（${listNum(strong.length ? strong : patents)}），其中 ${strong.length} 件高度相关，建议改款或进一步核实后再上架` };
  if (strong.length === 1 || some.length >= 1) return { level: 'medium', label: '中风险', reason: `检索到 ${patents.length} 件相关专利（${listNum(some)}），建议人工核实权利要求与您的产品差异` };
  return { level: 'low', label: '低风险', reason: '未检索到高度相关的已授权专利，仍建议人工复核' };
}

// A 方案：人工检索链接生成（100% 稳定，零联网依赖）
function buildSearchLinks(kws) {
  // 精简输出：不再展示大量网页跳转链接，统一提示自行网络搜索或运营表排查
  return [];
}

// ============ 通用排查（GET/POST 共用） ============
async function runCheck(keywords) {
  // 第一轮并发：专利(3) + 资讯(1) + TRO两源(2)，均 ≤6 subrequest
  const [patents, news, tro, sdCases] = await Promise.all([queryPatentsAll(keywords), queryRiskNews(keywords), queryTRO(keywords), querySellerDefenseCases(keywords)]);
  // 第二轮：品牌库（12h 缓存，首抓 4 页）
  const brandLib = await queryBrandLibraries(keywords);
  const troHits = [...(tro.hits || []), ...(sdCases.hits || [])];
  // 团队中奖词库/侵权图库命中（金山文档接源，红色警示）
  const teamHits = queryTeamDb(keywords);
  let risk;
  if (troHits.length) {
    risk = { level: 'high', label: '⚠️ TRO 起诉风险', reason: `最新美国 TRO 案件（123tro + SellerDefense）中 ${troHits.length} 条涉及您输入的关键词（品牌/品类），强烈建议先查明原告与涉案产品，立即改款或下架，切勿盲目备货` };
  } else if (teamHits.length) {
    const t0 = teamHits[0];
    risk = { level: 'high', label: '⚠️ 团队中奖词库/侵权图库命中', reason: `“${t0.kw}${t0.note ? '（' + t0.note + '）' : ''}”命中团队内部词库（来源：${t0.src}，金山文档运营待办事项），该名称/品牌/作品曾触发律师函或侵权/TRO 维权，请立即核实产品图片与文案，避免上架关联仿冒品` };
  } else if (brandLib.hits.length) {
    risk = { level: 'high', label: '⚠️ 历史 TRO 代理品牌', reason: `“${brandLib.hits[0].brand}”出现在 SellerDefense 历史代理品牌库（${brandLib.hits.map(h => h.library).join('/')}）中，该品牌受商标保护、曾发起 TRO 维权，请核实产品是否与其冲突，避免上架仿冒/侵权产品` };
  } else if (patents.length) {
    risk = pickRisk(patents);
  } else {
    risk = { level: 'manual', label: '未记录到风险', reason: '已核查最新美国 TRO 案件（123tro + SellerDefense）、历史代理品牌库与专利库，均未记录到相关侵权风险。建议自行网络搜索该产品关键词，或对照团队运营表排查复核后再上架' };
  }
  return {
    risk: risk.level,
    riskLabel: risk.label,
    riskReason: risk.reason,
    patents,
    trademarkWarnings: news,
    tro: tro.ok ? { checked: true, total: tro.total, hits: tro.hits.slice(0, 8), updated: tro.updated || '' } : { checked: false, total: 0, hits: [], updated: '' },
    sellerDefense: sdCases.ok ? { checked: true, total: sdCases.total, hits: sdCases.hits.slice(0, 6), updated: sdCases.updated || '' } : { checked: false, total: 0, hits: [], updated: '' },
    brandLibrary: brandLib,
    teamDb: { checked: true, total: TEAM_DB.length, hits: teamHits },
    searchLinks: buildSearchLinks(keywords),
    keywords,
    summary: [
      troHits.length ? `TRO 双源共命中 ${troHits.length} 条（123tro ${tro.hits.length} 条 / SellerDefense ${sdCases.hits.length} 条）` : `已核查 TRO 案件：123tro ${tro.total || 0} 条 + SellerDefense ${sdCases.total || 0} 条，均未命中`,
      teamHits.length ? `团队中奖词库/侵权图库命中 ${teamHits.length} 条（总词库 ${TEAM_DB.length} 条）` : `团队中奖词库/侵权图库（${TEAM_DB.length} 条）未命中`,
      brandLib.hits.length ? `历史代理品牌库命中 ${brandLib.hits.length} 个品牌` : '历史代理品牌库（内置+文字版）未命中',
      `侵权/TRO 资讯 ${news.length} 条`,
      patents.length ? `自动检索专利 ${patents.length} 件` : '自动专利检索暂不可用',
      '建议自行网络搜索或运营表排查复核'
    ].join('；'),
    disclaimer: DISCLAIMER,
    updated: new Date().toLocaleString('zh-CN')
  };
}

// ============ 火山视觉识别（图片 → 产品关键词） ============
async function visionIdentify(image, env) {
  const key = getVolcanoKey(env);
  const ep = getVolcanoEp(env);
  if (!key || !ep) return { ok: false, error: '火山视觉未配置' };
  let imgData = image;
  if (/^data:image\//.test(image)) imgData = image;
  else if (/^https?:\/\//i.test(image)) imgData = image;
  else return { ok: false, error: '图片格式不支持' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ep,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imgData } },
            { type: 'text', text: '你是跨境电商选品专家。识别图中产品，输出：1) 2~4个英文关键词（逗号分隔，用于专利和TRO侵权排查，例如 "phone case, silicone"）；2) 一句简短中文产品描述。严格按JSON格式输出：{"keywords":"英文关键词","description":"中文描述"}' }
          ]
        }],
        max_tokens: 200
      }),
      signal: ctrl.signal
    });
    const d = await r.json();
    if (!r.ok) return { ok: false, error: (d.error && d.error.message) || 'HTTP ' + r.status };
    const content = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    const m = content.match(/\{[\s\S]*?\}/);
    if (m) {
      try {
        const j = JSON.parse(m[0]);
        return { ok: true, keywords: String(j.keywords || ''), description: String(j.description || '').slice(0, 120), raw: content };
      } catch { /* 继续走兜底 */ }
    }
    return { ok: true, keywords: '', description: content.slice(0, 120), raw: content };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally { clearTimeout(t); }
}

export async function onRequestGet(ctx) {
  try {
    const url = new URL(ctx.request.url);
    const raw = url.searchParams.get('keywords') || url.searchParams.get('q') || '';
    const keywords = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
    if (!keywords.length) {
      return new Response(JSON.stringify({ risk: 'empty', patents: [], trademarkWarnings: [], searchLinks: [], summary: '请输入产品英文关键词（逗号分隔，1~3 个），例如：water bottle, cap', disclaimer: DISCLAIMER, updated: new Date().toLocaleString('zh-CN') }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    const cacheKey = hashStr(keywords.join('|'));
    const hit = mem.get(cacheKey);
    if (hit && Date.now() - hit.t < 6 * 3600 * 1000) return new Response(JSON.stringify({ ...hit.data, cached: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

    const data = await runCheck(keywords);
    mem.set(cacheKey, { t: Date.now(), data });
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({ risk: 'error', patents: [], trademarkWarnings: [], searchLinks: [], summary: '排查服务异常：' + String(e && e.message || e), disclaimer: DISCLAIMER, updated: new Date().toLocaleString('zh-CN') }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}

// OPTIONS 预检（跨域 POST 必需）
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}

// POST：支持上传产品图片（base64 dataURL 或公网 URL）+ 可选关键词 → 视觉识别 → 自动排查
export async function onRequestPost(ctx) {
  try {
    const body = await ctx.request.json().catch(() => null);
    const image = (body && (body.image || body.imageUrl || '')) || '';
    const rawKw = (body && (body.keywords || '')) || '';
    if (!image && !rawKw) {
      return new Response(JSON.stringify({ risk: 'empty', patents: [], trademarkWarnings: [], searchLinks: [], summary: '请上传产品图片或输入产品英文关键词', disclaimer: DISCLAIMER, updated: new Date().toLocaleString('zh-CN') }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    let vision = null;
    let keywords = rawKw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
    if (image) {
      vision = await visionIdentify(image, ctx.env);
      if (vision.ok && vision.keywords) {
        const vk = String(vision.keywords).split(/[,，、;；]/).map(s => s.trim()).filter(Boolean).slice(0, 3);
        keywords = Array.from(new Set([...keywords, ...vk])).slice(0, 3);
      }
    }
    if (!keywords.length) {
      return new Response(JSON.stringify({ risk: 'empty', patents: [], trademarkWarnings: [], searchLinks: [], vision: vision || null, summary: (vision && vision.error) ? '图片识别失败：' + vision.error : '未能识别出产品关键词，请尝试输入英文关键词', disclaimer: DISCLAIMER, updated: new Date().toLocaleString('zh-CN') }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    const data = await runCheck(keywords);
    data.vision = vision ? { ok: vision.ok, keywords: vision.ok ? keywords : [], description: vision.description || '', error: vision.error || '' } : null;
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({ risk: 'error', patents: [], trademarkWarnings: [], searchLinks: [], summary: '排查服务异常：' + String(e && e.message || e), disclaimer: DISCLAIMER, updated: new Date().toLocaleString('zh-CN') }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
