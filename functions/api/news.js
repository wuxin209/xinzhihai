// 新闻资讯接口（区别于市场早讯 /api/morning）
// 定位：最新跨境行业新闻 + 海关/外贸/合规要闻
// 数据源：① AMZ123 跨境早报 ② 雨果网 cifnews ③ Google News(海关/外贸) ④ 人工精选兜底
let cacheData = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function timeoutSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, ms);
  return ctrl.signal;
}

// 人工精选兜底（含海关/合规/行业，2026年9月）
const FALLBACK_NEWS = [
  { flag: '🇨🇳', country: '中国', title: '海关总署：上半年跨境电商进出口同比增长15.6%', summary: '2026年上半年我国跨境电商进出口总额达1.32万亿元，同比增长15.6%，出口占比超70%，海关持续推进B2B出口监管改革和退换货中心建设。', tag: '海关要闻' },
  { flag: '🇨🇳', country: '中国', title: '0110报关新规：境外收货人禁止填写Amazon/FBA仓名', summary: '多地报关行明确0110一般贸易报关单境外收货人不得直接填Amazon或FBA仓名，须提供真实境外购货方、购销合同及结算凭证，合规可走9810海外仓模式预退税。', tag: '海关要闻' },
  { flag: '🇨🇳', country: '中国', title: '深圳卖家集中收到出口收入未足额申报增值税短信提醒', summary: '税务部门要求相关卖家10日内自查整改出口收入申报，跨境卖家须核对收汇、报关、申报三流一致，避免补税和滞纳金风险。', tag: '合规预警' },
  { flag: '🇺🇸', country: '美国', title: '亚马逊9月新规落地：2026黑五网一入仓全面提前', summary: '亚马逊黑五网一FBA入仓截止时间提前，Q4旺季备货节奏整体前移，卖家须提前安排头程发货，避免错过入仓窗口期影响旺季销售。', tag: '平台政策' },
  { flag: '🇺🇸', country: '美国', title: '亚马逊BSA协议第18条已生效：未经书面同意禁止转让质押店铺', summary: '新规明确禁止卖家未经书面同意转让或质押协议项下权利义务（含销售收入受偿权），擅自转让、质押行为均属无效，店铺买卖灰色操作被封堵。', tag: '平台政策' },
  { flag: '🇪🇺', country: '欧盟', title: '欧盟取消150欧元低值包裹免税，FBM每件征3欧元', summary: '欧盟正式取消150欧元以下低值进口包裹关税豁免，境外直发FBM订单按件征收3欧元费用，须使用指定承运商并提供有效IOSS编号。', tag: '政策法规' },
  { flag: '🇪🇺', country: '欧盟', title: '泛欧计划9月3日起强制纳入荷兰站，比利时站2027年跟进', summary: '继续使用泛欧FBA的卖家必须将库存分发覆盖荷兰站，否则影响泛欧资格；9月1日起通过PAN-EU入库及直发法国货件必须提供MRN+EORI。', tag: '合规预警' },
  { flag: '🇺🇸', country: '美国', title: 'CPSC合规证书7月8日起强制电子提交', summary: '所有发往美国FBA的受监管产品，CPC合规证书必须通过电子方式在清关时提交；近期婴儿秋千、磁力积木、迷你冰箱等多类产品被召回。', tag: '合规预警' },
  { flag: '🇺🇸', country: '美国', title: '亚马逊11月2日更新商业责任险要求', summary: '美国站销售额达到1万美元门槛的卖家须在30天内取得并维持有效商业综合责任险，旺季前务必核对保单是否合规。', tag: '合规预警' },
  { flag: '🇺🇸', country: '美国', title: '美国第14411号行政令进口新规落地，CBP公布首批措施', summary: '亚马逊提醒卖家确认IOR进口商身份，美国海关已公布首批执行措施，涉及进口申报和清关合规，卖家需提前自查供应链。', tag: '政策法规' },
  { flag: '🇰🇷', country: '韩国', title: 'Coupang火箭增长计划持续，中国新卖家前3个月佣金减半', summary: 'Coupang针对中国新卖家提供前3个月佣金减免50%、物流补贴和广告金支持，美妆、家居品类增长最快。', tag: '平台动态' },
  { flag: '🇹🇭', country: '泰国', title: '泰国税局向本土店发出对账通知，倒查3年收入', summary: '泰国税务部门要求本土店卖家核对近3年申报收入，东南亚税务合规趋严，做本土店的卖家须补齐账务和完税凭证。', tag: '政策法规' },
  { flag: '🇺🇸', country: '美国', title: '亚马逊欧洲站锂电池新规：9月30日未通过TIC认证将下架', summary: '含锂电池的小家电必须通过指定TIC机构完成直接验证，未通过商品面临下架及FBA库存冻结。', tag: '合规预警' },
  { flag: '🇨🇳', country: '中国', title: '全国新增12个跨境电商退换货中心，退货时效缩至3天', summary: '海关推进跨境电商退换货中心建设，覆盖主要出口口岸，退货处理时效从7天缩短至3天，降低卖家退货成本。', tag: '海关要闻' },
  { flag: '🇺🇸', country: '美国', title: '美方释放有限关税谈判信号，双边豁免总额或达600亿美元', summary: '中美贸易磋商出现缓和信号，部分品类关税豁免有望扩大，外贸卖家可持续关注豁免清单调整对自身品类的影响。', tag: '政策法规' }
];

function decodeEntities(s) {
  if (!s) return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '').trim();
}

// AMZ123 早报列表解析
function parseAmz(html, sourceName) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]*href="https?:\/\/www\.amz123\.com\/t\/[A-Za-z0-9]+"[^>]*>/g;
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
    const tag = m[0];
    const tm = tag.match(/data-fetch-title="([^"]+)"/);
    let title = tm ? decodeEntities(tm[1]) : '';
    if (!title || title.length < 8 || seen.has(title)) continue;
    seen.add(title);
    out.push({ title, source: '雨果网' });
  }
  return out;
}

function classify(title) {
  const map = [
    [/海关|报关|出口|进口|总署|清关|关税|收汇|增值税|退税|9810|9710|0110/, ['🇨🇳', '中国', '海关要闻']],
    [/CPSC|召回|认证|合规|CE|FCC|UL|锂电池|TIC|责任险|EORI|IOSS|VAT|侵权|起诉|维权|涉诉|被告/, ['🇺🇸', '合规', '合规预警']],
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
  const queries = ['海关 跨境电商', '跨境电商', '外贸 进出口'];
  const seen = new Set();
  const out = [];
  await Promise.all(queries.map(async (q) => {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:5d')}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
      const xml = await fetchText(url, 7000);
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

// 按标签(分类)做轮转交错，保证不同分类均匀分布，避免同一分类扎堆
function balanceByTag(items) {
  const buckets = new Map();
  for (const it of items) {
    const k = it.tag || '其他';
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(it);
  }
  const queues = [...buckets.values()].map(q => q.slice());
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

export async function onRequestGet() {
  if (cacheData && Date.now() - cacheTime < CACHE_TTL) {
    return new Response(JSON.stringify({ ...cacheData, cached: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // ① AMZ123 跨境早报 + ② 雨果网（并行）
  const [zb, cif] = await Promise.all([
    fetchText('https://www.amz123.com/zb').then(h => parseAmz(h, 'AMZ123早报').slice(0, 7)).catch(() => []),
    fetchText('https://www.cifnews.com').then(h => parseCifnews(h).slice(0, 6)).catch(() => [])
  ]);

  let news = [...zb.map(toItem), ...cif.map(toItem)];
  const sources = [];
  if (zb.length) sources.push('AMZ123早报');
  if (cif.length) sources.push('雨果网');

  // ③ Google News 补充海关/外贸
  if (news.length < 12) {
    const g = await fetchGoogleNews().catch(() => []);
    if (g.length) sources.push('GoogleNews');
    const exist = new Set(news.map(n => n.title.slice(0, 14)));
    for (const it of g) { if (news.length >= 15) break; if (!exist.has(it.title.slice(0, 14))) news.push(toItem(it)); }
  }

  // ④ 兜底：海关要闻优先补入
  let source = sources.length ? 'live:' + sources.join('+') : 'curated';
  if (news.length < 10) {
    source = sources.length ? 'mixed:' + sources.join('+') : 'curated';
    const existTitles = new Set(news.map(n => n.title.slice(0, 12)));
    const ordered = [...FALLBACK_NEWS.filter(f => f.tag === '海关要闻'), ...FALLBACK_NEWS.filter(f => f.tag !== '海关要闻')];
    for (const f of ordered) {
      if (news.length >= 15) break;
      if (!existTitles.has(f.title.slice(0, 12))) news.push({ ...f, time: '近期' });
    }
  }
  news = balanceByTag(news).slice(0, 15);
  const result = { source, count: news.length, news, items: news, updated: new Date().toLocaleString('zh-CN') };
  if (zb.length || cif.length) { cacheData = result; cacheTime = Date.now(); }
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
