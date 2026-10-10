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
  { kw: 'propaganda posters', src: '侵权图库', note: '政治宣传类海报（违反受限商品政策）' }
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
