// 新闻资讯接口（区别于市场早讯 /api/morning）
// 定位：最新跨境外贸/海关/目标国政策 + 行业要闻
// 数据源：① AMZ123 跨境早报(/zb) + TT123 TikTok资讯(/t) 为主
//       ② 雨果网、知无不言 偶尔少量补充（按日期轮换，不占大比例）
//       ③ Google News(海关/外贸) ④ 人工精选——固定保证海关/外贸/政策板块始终有
let cacheData = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function timeoutSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, ms);
  return ctrl.signal;
}

// 一年中的第几天（用于"偶尔"轮换 + 精选兜底轮换）
function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

// 人工精选：海关/外贸/目标国政策（固定保证板块，2026年9月）
const CUSTOMS_POLICY = [
  { flag: '🇨🇳', country: '中国', title: '海关总署：上半年跨境电商进出口同比增长15.6%', summary: '2026年上半年我国跨境电商进出口总额达1.32万亿元，同比增长15.6%，出口占比超70%，海关持续推进B2B出口监管改革和退换货中心建设。', tag: '海关要闻' },
  { flag: '🇨🇳', country: '中国', title: '0110报关新规：境外收货人禁止填写Amazon/FBA仓名', summary: '多地报关行明确0110一般贸易报关单境外收货人不得直接填Amazon或FBA仓名，须提供真实境外购货方、购销合同及结算凭证，合规可走9810海外仓模式预退税。', tag: '海关要闻' },
  { flag: '🇨🇳', country: '中国', title: '全国新增12个跨境电商退换货中心，退货时效缩至3天', summary: '海关推进跨境电商退换货中心建设，覆盖主要出口口岸，退货处理时效从7天缩短至3天，降低卖家退货成本。', tag: '海关要闻' },
  { flag: '🇺🇸', country: '美国', title: '美国第14411号行政令进口新规落地，CBP公布首批措施', summary: '亚马逊提醒卖家确认IOR进口商身份，美国海关已公布首批执行措施，涉及进口申报和清关合规，卖家需提前自查供应链与原产地。', tag: '政策法规' },
  { flag: '🇺🇸', country: '美国', title: '美方释放有限关税谈判信号，双边豁免总额或达600亿美元', summary: '中美贸易磋商出现缓和信号，部分品类关税豁免有望扩大，外贸卖家可持续关注豁免清单调整对自身品类的影响。', tag: '政策法规' },
  { flag: '🇪🇺', country: '欧盟', title: '欧盟取消150欧元低值包裹免税，FBM每件征3欧元', summary: '欧盟正式取消150欧元以下低值进口包裹关税豁免，境外直发FBM订单按件征收3欧元费用，须使用指定承运商并提供有效IOSS编号。', tag: '政策法规' },
  { flag: '🇹🇭', country: '泰国', title: '泰国税局向本土店发出对账通知，倒查3年收入', summary: '泰国税务部门要求本土店卖家核对近3年申报收入，东南亚税务合规趋严，做本土店的卖家须补齐账务和完税凭证。', tag: '政策法规' },
  { flag: '🇺🇸', country: '美国', title: 'CPSC合规证书强制电子提交，清关须随附CPC', summary: '所有发往美国FBA的受监管产品，CPC合规证书必须通过电子方式在清关时提交；婴儿秋千、磁力积木、迷你冰箱等多类产品近期被召回。', tag: '合规预警' },
  { flag: '🇪🇺', country: '欧盟', title: '泛欧计划强制纳入荷兰站，入库法国须提供MRN+EORI', summary: '继续使用泛欧FBA的卖家必须将库存分发覆盖荷兰站；通过PAN-EU入库及直发法国货件必须提供MRN+EORI，否则影响入库。', tag: '合规预警' },
  { flag: '🇺🇸', country: '美国', title: '亚马逊更新商业责任险要求，达1万美元销售额须投保', summary: '美国站销售额达到1万美元门槛的卖家须在30天内取得并维持有效商业综合责任险，旺季前务必核对保单是否合规。', tag: '合规预警' },
  { flag: '🇺🇸', country: '美国', title: '亚马逊BSA协议第18条生效：禁止擅自转让质押店铺', summary: '新规明确禁止卖家未经书面同意转让或质押协议项下权利义务（含销售收入受偿权），擅自转让、质押行为均属无效。', tag: '政策法规' },
  { flag: '🇨🇳', country: '中国', title: '深圳卖家集中收到出口收入未足额申报增值税提醒', summary: '税务部门要求相关卖家自查整改出口收入申报，跨境卖家须核对收汇、报关、申报三流一致，避免补税和滞纳金风险。', tag: '合规预警' }
];

// 行业/平台动态精选兜底
const FALLBACK_NEWS = [
  { flag: '🇺🇸', country: '美国', title: '亚马逊9月新规落地：2026黑五网一入仓全面提前', summary: '亚马逊黑五网一FBA入仓截止时间提前，Q4旺季备货节奏整体前移，卖家须提前安排头程发货。', tag: '平台政策' },
  { flag: '🇰🇷', country: '韩国', title: 'Coupang火箭增长计划持续，中国新卖家前3个月佣金减半', summary: 'Coupang针对中国新卖家提供前3个月佣金减免50%、物流补贴和广告金支持，美妆、家居品类增长最快。', tag: '平台动态' },
  { flag: '🇺🇸', country: '美国', title: '亚马逊欧洲站锂电池新规：未通过TIC认证将下架', summary: '含锂电池的小家电必须通过指定TIC机构完成直接验证，未通过商品面临下架及FBA库存冻结。', tag: '合规预警' }
];

function decodeEntities(s) {
  if (!s) return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '').trim();
}

// AMZ123 / TT123 文章列表解析（/t/xxx 链接）
function parseNav(html, sourceName, host) {
  const out = [];
  const seen = new Set();
  const re = new RegExp('<a[^>]*href="https?://www\\.' + host + '\\.com/t/[A-Za-z0-9]+"[^>]*>', 'g');
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const tm = tag.match(/title="([^"]+)"/) || tag.match(/data-sdk-resource-id="([^"]+)"/);
    let title = tm ? decodeEntities(tm[1]) : '';
    if (!title || title.length < 8 || seen.has(title)) continue;
    seen.add(title);
    out.push({ title, source: sourceName });
  }
  return out;
}

// 雨果网解析
function parseCifnews(html) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]*href="https?:\/\/www\.cifnews\.com\/article\/\d+"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tm = m[0].match(/data-fetch-title="([^"]+)"/);
    let title = tm ? decodeEntities(tm[1]) : '';
    if (!title || title.length < 8 || seen.has(title)) continue;
    seen.add(title);
    out.push({ title, source: '雨果网' });
  }
  return out;
}

// 知无不言论坛最新话题解析
function parseWeAreSellers(html) {
  const out = [];
  const seen = new Set();
  const re = /href="https:\/\/www\.wearesellers\.com\/question\/\d+"[^>]*>([^<]{8,60})/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let title = decodeEntities(m[1]).replace(/^#.*?#/g, '').trim();
    if (!title || title.length < 8 || seen.has(title)) continue;
    seen.add(title);
    out.push({ title, source: '知无不言' });
  }
  return out;
}

function classify(title) {
  const map = [
    [/海关|报关|出口|进口|总署|清关|关税|收汇|增值税|退税|9810|9710|0110|进出口|外贸|商务部|CBP|原产地/, ['🇨🇳', '中国', '海关要闻']],
    [/CPSC|召回|认证|合规|CE|FCC|UL|锂电池|TIC|责任险|EORI|IOSS|VAT|侵权|起诉|维权|涉诉|被告|税局|倒查|申报/, ['🇺🇸', '合规', '合规预警']],
    [/政策|法规|行政令|豁免|新规|法案|禁令|制裁|管制|立法|监管|查处|约谈/, ['🌐', '政策', '政策法规']],
    [/TikTok|tiktok/, ['🇹🇭', 'TikTok', '平台动态']],
    [/Coupang|酷胖|韩国/, ['🇰🇷', '韩国', '平台动态']],
    [/日本|乐天/, ['🇯🇵', '日本', '市场行情']],
    [/泰国|越南|东南亚|印尼|Ozon|俄罗斯/, ['🇹🇭', '海外', '市场行情']],
    [/欧盟|欧洲|德国|法国|英国|意大利|西班牙|荷兰|eBay/, ['🇪🇺', '欧盟', '平台政策']],
    [/亚马逊|Amazon|FBA|FBM|BSA|泛欧|AWD|Prime|黑五|网一/, ['🇺🇸', '美国', '平台政策']]
  ];
  for (const [re, v] of map) if (re.test(title)) return { flag: v[0], country: v[1], tag: v[2] };
  return { flag: '🌐', country: '跨境', tag: '行业资讯' };
}

async function fetchText(url, ms = 9000) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: timeoutSignal(ms) });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return await resp.text();
}

function toItem(it) {
  const c = classify(it.title);
  return { flag: c.flag, country: c.country, title: it.title, summary: it.title + '（来源：' + it.source + '）', tag: c.tag, time: '今日', origin: it.source };
}

function parseGoogleRss(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const b of blocks) {
    const titleM = b.match(/<title>([\s\S]*?)<\/title>/);
    if (!titleM) continue;
    let title = decodeEntities(titleM[1]).replace(/\s*[-–—]\s*[^-–—]+$/, '').trim();
    if (title.length < 8) continue;
    items.push({ title, source: 'GoogleNews' });
  }
  return items;
}

async function fetchGoogleNews() {
  const queries = ['海关 跨境电商', '外贸 进出口 政策', '跨境电商 合规'];
  const seen = new Set();
  const out = [];
  await Promise.all(queries.map(async (q) => {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:5d')}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
      const xml = await fetchText(url, 5200);
      for (const it of parseGoogleRss(xml).slice(0, 3)) {
        const key = it.title.slice(0, 16);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
      }
    } catch (e) {}
  }));
  return out;
}

// 按标签轮转交错，分类均匀分布；海关/政策类适度靠前
function balanceByTag(items) {
  const priority = { '海关要闻': 0, '政策法规': 1, '合规预警': 2 };
  const buckets = new Map();
  for (const it of items) {
    const k = it.tag || '其他';
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(it);
  }
  const keys = [...buckets.keys()].sort((a, b) => (priority[a] ?? 9) - (priority[b] ?? 9));
  const queues = keys.map(k => buckets.get(k).slice());
  const out = [];
  let added = true;
  while (added) {
    added = false;
    for (const q of queues) {
      if (q.length) { out.push(q.shift()); added = true; }
    }
  }
  return out;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(n => {
    const k = (n.title || '').replace(/[\s\p{P}]/gu, '').slice(0, 18);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const NEWS_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const EDGE_CACHE_KEY = 'https://xinzhihai.internal/cache/api-news';

// 所有源并行抓取（每个源各自超时封顶），到点用已抓到的部分，绝不串行累加耗时
async function collectAll(doy) {
  const sources = [];
  const tasks = [
    fetchText('https://www.amz123.com/zb', 5600).then(h => parseNav(h, 'AMZ123早报', 'amz123').slice(0, 8)).catch(() => []),
    fetchText('https://www.tt123.com/t/', 5600).then(h => parseNav(h, 'TT123', 'tt123').slice(0, 5)).catch(() => []),
    (doy % 3 === 1
      ? fetchText('https://www.cifnews.com', 5600).then(h => parseCifnews(h).slice(0, 1)).catch(() => [])
      : Promise.resolve([])),
    (doy % 2 === 0
      ? fetchText('https://www.wearesellers.com/m', 5600).then(h => {
          const all = parseWeAreSellers(h);
          return all.slice(doy % Math.max(1, all.length), (doy % Math.max(1, all.length)) + 1);
        }).catch(() => [])
      : Promise.resolve([])),
    fetchGoogleNews().catch(() => [])
  ];
  let settled;
  try {
    // 每个源各自 5.6s 封顶（见 fetchText / fetchGoogleNews），并行后整体不超过约 5.6s
    settled = await Promise.allSettled(tasks);
  } catch (e) {
    settled = tasks.map(() => ({ status: 'fulfilled', value: [] }));
  }
  const val = i => {
    const r = settled[i];
    return (r && r.status === 'fulfilled' && Array.isArray(r.value)) ? r.value : [];
  };
  const zb = val(0), tt = val(1), cif = val(2), was = val(3), g = val(4);
  if (zb.length) sources.push('AMZ123早报');
  if (tt.length) sources.push('TT123');
  if (cif.length) sources.push('雨果网');
  if (was.length) sources.push('知无不言');
  if (g.length) sources.push('GoogleNews');
  const pool = dedupe([...zb.map(toItem), ...tt.map(toItem), ...cif.map(toItem), ...was.map(toItem), ...g.map(toItem)]);
  return { pool, sources };
}

export async function onRequestGet() {
  // ① 实例内内存缓存
  if (cacheData && Date.now() - cacheTime < CACHE_TTL) {
    return new Response(JSON.stringify({ ...cacheData, cached: true }), { headers: NEWS_HEADERS });
  }
  // ② 跨 isolate 的边缘缓存，避免每个冷实例都重新抓 10 秒+
  try {
    const hit = await caches.default.match(EDGE_CACHE_KEY);
    if (hit) {
      const j = await hit.json();
      if (j && j.__t && Date.now() - j.__t < CACHE_TTL) {
        cacheData = j; cacheTime = j.__t;
        const { __t, ...pub } = j;
        return new Response(JSON.stringify({ ...pub, cached: true }), { headers: NEWS_HEADERS });
      }
    }
  } catch (e) {}

  const doy = dayOfYear();
  let pool = [], sources = [];
  try {
    const r = await collectAll(doy);
    pool = r.pool; sources = r.sources;
  } catch (e) { pool = []; sources = []; }

  const isPolicy = t => ['海关要闻', '政策法规', '合规预警'].includes(t);
  const TOTAL = 15, POLICY_MIN = 4;

  // ④ 固定保证：先拆出实时政策类，不足 4 条用精选海关/政策池按日期轮换补齐（预留专属坑位，不被其他新闻挤掉）
  const livePolicy = pool.filter(n => isPolicy(n.tag));
  const liveOther = pool.filter(n => !isPolicy(n.tag));
  const policyBlock = [...livePolicy];
  const existP = new Set(policyBlock.map(n => n.title.slice(0, 12)));
  const rotated = CUSTOMS_POLICY.map((x, i) => CUSTOMS_POLICY[(i + doy) % CUSTOMS_POLICY.length]);
  for (const f of rotated) {
    if (policyBlock.length >= POLICY_MIN) break;
    if (existP.has(f.title.slice(0, 12))) continue;
    policyBlock.push({ ...f, time: '近期' });
    existP.add(f.title.slice(0, 12));
  }

  // ⑤ 其余坑位用实时行业/平台新闻填充，不足再用行业兜底
  const otherSlots = TOTAL - policyBlock.length;
  const otherBlock = liveOther.slice(0, otherSlots);
  if (otherBlock.length < otherSlots) {
    const existO = new Set([...policyBlock, ...otherBlock].map(n => n.title.slice(0, 12)));
    for (const f of FALLBACK_NEWS) {
      if (otherBlock.length >= otherSlots) break;
      if (!existO.has(f.title.slice(0, 12))) otherBlock.push({ ...f, time: '近期' });
    }
  }

  let news = balanceByTag(dedupe([...policyBlock, ...otherBlock])).slice(0, TOTAL);
  const source = sources.length ? 'live:' + sources.join('+') : 'curated';
  const result = { source, count: news.length, news, items: news, updated: new Date().toLocaleString('zh-CN'), __t: Date.now() };
  cacheData = result; cacheTime = Date.now();
  // 写跨 isolate 边缘缓存（容错，失败不影响返回）
  try { caches.default.put(EDGE_CACHE_KEY, new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })); } catch (e) {}
  const { __t, ...pub } = result;
  return new Response(JSON.stringify(pub), { headers: NEWS_HEADERS });
}
