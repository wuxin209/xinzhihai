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
    for (let retry = 0; retry < 1; retry++) {
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

// ============ TRO 案件源2：SellerDefense（WordPress 案件文章列表） ============
const sdCache = { t: 0, data: null }; // 10 分钟缓存
async function querySellerDefenseCases(kws) {
  if (sdCache.data && Date.now() - sdCache.t < 10 * 60 * 1000) return sdCache.data;
  // 单次抓取（≤7s），失败快速降级，绝不拖慢整体
  const html = await fetchText('https://sellerdefense.cn/tro-sellerdefense/', 6000, { 'Accept': 'text/html,*/*' });
  const out = { ok: !!html, hits: [], total: 0, updated: '' };
  if (!html) { sdCache.t = Date.now(); sdCache.data = out; return out; }
  // 提取案件文章（标题+链接），过滤导航/工具页
  const items = [];
  const seen = new Set();
  const re = /href="(https:\/\/sellerdefense\.cn\/[^"]+)"[^>]*>\s*([^<]{6,80})<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1]; const t = m[2].trim();
    if (seen.has(url) || /category\/|trademark|settlement|lawfirm|summary|feed|respond|comment/.test(url)) continue;
    if (!/案件|被告|原告|维权|避雷|曝光|起诉|冻结|专利|版权|商标|TRO/i.test(t)) continue;
    seen.add(url);
    items.push({ title: t.slice(0, 90), url });
  }
  out.total = items.length;
  // 关键词匹配标题（品牌/品类名）
  const matched = items.filter(it => {
    const lower = it.title.toLowerCase();
    return kws.some(k => { const kl = k.toLowerCase().trim(); return kl.length >= 3 && lower.includes(kl); });
  });
  out.hits = matched.slice(0, 6).map(it => ({ caseNumber: '', court: '', brand: it.title.split('！')[0].replace(/^(被告名单|原告案件\+?1|案件曝光|纽约州案件|宾夕法尼亚州发案|国人原告)[^!]{0,12}/, '').trim(), title: it.title, date: '', url: it.url }));
  // 并发抓命中前 2 篇详情补案件号（每篇 ≤6s，命中才抓）
  if (out.hits.length) {
    const tops = out.hits.slice(0, 2);
    const details = await Promise.all(tops.map(async it => {
      const d = await fetchText(it.url, 5000, { 'Accept': 'text/html,*/*' });
      if (!d) return null;
      const cn = (d.match(/\b(\d{2}-cv-\d{3,6})\b/i) || [])[1] || '';
      const courtM = d.match(/原告品牌：([^<]{2,40})/) || d.match(/原告[^<]{0,8}品牌[^<]{0,40}/);
      return { cn, brand: (courtM && courtM[1]) ? courtM[1].slice(0, 40) : it.brand };
    }));
    details.forEach((d, i) => { if (d && d.cn) out.hits[i].caseNumber = d.cn; if (d && d.brand) out.hits[i].brand = d.brand; });
  }
  // 列表页最近的日期（归档链接里的最新日期）
  const dm = html.match(/\/2026\/(\d{2})\/(\d{2})\//);
  if (dm) out.updated = '2026-' + dm[1] + '-' + dm[2];
  sdCache.t = Date.now(); sdCache.data = out;
  return out;
}

// ============ TRO 历史品牌库（SellerDefense 四大律所品牌列表） ============
const LIB_URLS = [
  ['KEITH', 'https://sellerdefense.cn/keith-trademark-201905/'],
  ['GBC', 'https://sellerdefense.cn/gbc-trademark-201905/'],
  ['EPS', 'https://sellerdefense.cn/eps-trademark-201906/'],
  ['DAVID', 'https://sellerdefense.cn/david-201906/']
];
const libCache = { t: 0, data: null }; // 12 小时缓存
async function fetchBrandLibraries() {
  if (libCache.data && Date.now() - libCache.t < 12 * 3600 * 1000) return libCache.data;
  const groups = await Promise.all(LIB_URLS.map(async ([lib, url]) => {
    // 单次抓取（≤8s），失败则该库为空，12h 后重试
    const html = await fetchText(url, 6000, { 'Accept': 'text/html,*/*' });
    const brands = [];
    if (html) {
      // 格式1: **1） Ray-Ban & Oakley** / **1）Monchhichi 蒙奇奇**
      let re = /\*\*\s*\d+[）)]\s*([A-Z][A-Za-z0-9 &'\u0027\.\-]{2,50})(?:[\u4e00-\u9fff][^*]{0,40})?\*\*/g;
      let mm; const seen = new Set();
      while ((mm = re.exec(html))) { const b = mm[1].trim(); if (b.length >= 3 && !seen.has(b)) { seen.add(b); brands.push(b); } }
      // 格式2: 1）**Monchhichi 蒙奇奇**
      re = /\d+[）)]\s*\*\*([A-Z][A-Za-z0-9 &'\u0027\.\-]{2,50})(?:[\u4e00-\u9fff][^*]{0,40})?\*\*/g;
      while ((mm = re.exec(html))) { const b = mm[1].trim(); if (b.length >= 3 && !seen.has(b)) { seen.add(b); brands.push(b); } }
    }
    return { lib, url, brands: brands.slice(0, 400) };
  }));
  libCache.t = Date.now(); libCache.data = groups;
  return groups;
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
  if (strong.length >= 2 || patents.length >= 3) return { level: 'high', label: '高风险', reason: `检索到 ${patents.length} 件相关专利，其中 ${strong.length} 件高度相关，建议改款或进一步核实后再上架` };
  if (strong.length === 1 || some.length >= 1) return { level: 'medium', label: '中风险', reason: `检索到 ${patents.length} 件相关专利，建议人工核实权利要求与您的产品差异` };
  return { level: 'low', label: '低风险', reason: '未检索到高度相关的已授权专利，仍建议人工复核' };
}

// A 方案：人工检索链接生成（100% 稳定，零联网依赖）
function buildSearchLinks(kws) {
  const q = kws.slice(0, 2).join(' ');
  const qq = encodeURIComponent('"' + q + '"');
  const qz = encodeURIComponent(q + ' patent OR trademark OR infringement');
  return [
    { label: 'Google Patents · 美国专利', url: `https://patents.google.com/?q=${qq}&country=US&language=ENGLISH` },
    { label: 'Google Patents · 全球专利', url: `https://patents.google.com/?q=${qq}` },
    { label: 'USPTO · 美国商标查询', url: 'https://tmsearch.uspto.gov/' },
    { label: 'Google · 专利/侵权综合搜索', url: `https://www.google.com/search?q=${qz}` },
    { label: '亚马逊 · 品牌注册与侵权举报指引', url: 'https://www.amazon.com/gp/help/customer/display.html?nodeId=202075700' }
  ];
}

// ============ 通用排查（GET/POST 共用） ============
async function runCheck(keywords) {
  // 第一轮并发：专利(3) + 资讯(1) + TRO两源(2)，均 ≤6 subrequest
  const [patents, news, tro, sdCases] = await Promise.all([queryPatentsAll(keywords), queryRiskNews(keywords), queryTRO(keywords), querySellerDefenseCases(keywords)]);
  // 第二轮：品牌库（12h 缓存，首抓 4 页）
  const brandLib = await queryBrandLibraries(keywords);
  const troHits = [...(tro.hits || []), ...(sdCases.hits || [])];
  let risk;
  if (troHits.length) {
    risk = { level: 'high', label: '⚠️ TRO 起诉风险', reason: `最新美国 TRO 案件（123tro + SellerDefense）中 ${troHits.length} 条涉及您输入的关键词（品牌/品类），强烈建议先查明原告与涉案产品，立即改款或下架，切勿盲目备货` };
  } else if (brandLib.hits.length) {
    risk = { level: 'high', label: '⚠️ 历史 TRO 代理品牌', reason: `“${brandLib.hits[0].brand}”出现在 SellerDefense 历史代理品牌库（${brandLib.hits.map(h => h.library).join('/')}）中，该品牌受商标保护、曾发起 TRO 维权，请核实产品是否与其冲突，避免上架仿冒/侵权产品` };
  } else if (patents.length) {
    risk = pickRisk(patents);
  } else {
    risk = { level: 'manual', label: '建议人工核实', reason: '已核查最新美国 TRO 案件（123tro + SellerDefense，未命中）与历史代理品牌库（未命中）与专利库（自动检索暂不可用）。为你生成一键检索链接，点开核实该产品是否有已授权专利/商标（专利号等以官方页面显示为准）' };
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
    searchLinks: buildSearchLinks(keywords),
    keywords,
    summary: [
      troHits.length ? `TRO 双源共命中 ${troHits.length} 条（123tro ${tro.hits.length} 条 / SellerDefense ${sdCases.hits.length} 条）` : `已核查 TRO 案件：123tro ${tro.total || 0} 条 + SellerDefense ${sdCases.total || 0} 条，均未命中`,
      brandLib.hits.length ? `历史代理品牌库命中 ${brandLib.hits.length} 个品牌` : '历史代理品牌库（Keith/GBC/EPS/David）未命中',
      `侵权/TRO 资讯 ${news.length} 条`,
      patents.length ? `自动检索专利 ${patents.length} 件` : '自动专利检索暂不可用',
      '已生成人工核实链接'
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
