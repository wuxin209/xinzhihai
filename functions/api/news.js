// 跨境电商新闻/市场早讯接口
// 数据源优先级：① AMZ123 + TT123 实时抓取（用户指定）② Google News RSS ③ 人工精选兜底
let cacheData = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30分钟缓存

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function timeoutSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, ms);
  return ctrl.signal;
}

// 人工精选兜底新闻（2026年9月最新）
const FALLBACK_NEWS = [
  { flag: '🇺🇸', country: '美国', title: '亚马逊9月1日起欧洲五国FBA送达窗口期由14天缩短至7天', summary: '英国、德国、法国、意大利、西班牙站，使用非合作承运商的国际货件送达窗口期从14天压缩到7天，卖家在Send to Amazon建货件时须手动填写7天预计送达区间，早到可能被拒收排队、迟送影响绩效。', tag: '平台政策' },
  { flag: '🇪🇺', country: '欧盟', title: '泛欧计划9月3日起强制纳入荷兰站，比利时站2027年2月跟进', summary: '继续使用泛欧FBA的卖家必须将库存分发覆盖荷兰站，否则将影响泛欧资格；9月1日起通过PAN-EU入库及直发法国货件必须提供MRN+EORI。', tag: '合规预警' },
  { flag: '🇺🇸', country: '美国', title: '亚马逊11月2日更新商业责任险要求，超1万美元销售额须30天内投保', summary: '亚马逊发布公告更新商业综合责任险要求，美国站销售额达到门槛的卖家须在30天内取得并维持有效保险，旺季前务必核对保单是否合规。', tag: '合规预警' },
  { flag: '🇺🇸', country: '美国', title: 'TikTok Shop履约差店铺将被限单，OVL三级店铺限收日均30%订单', summary: '延迟履约率或商责取消率过高会触发OVL跨境限单，第三级店铺最多只能接收近4周日均订单的30%。旺季须把延迟履约率压到4%以内、取消率压到2.5%以内。', tag: '平台政策' },
  { flag: '🇯🇵', country: '日本', title: 'TikTok Shop日本站开放自主注册，美区内测砍价拼团直播', summary: '日本站卖家可自主注册入驻；美区9月10日向受邀大商家内测砍价与拼团直播，观众可互动压价、邀人成团。', tag: '平台动态' },
  { flag: '🇺🇸', country: '美国', title: '亚马逊BSA协议第18条已生效：未经书面同意禁止转让质押店铺', summary: '8月24日起新规明确禁止卖家未经书面同意转让或质押协议项下全部或部分权利义务（含销售收入受偿权），任何擅自转让、质押行为均属无效。', tag: '平台政策' },
  { flag: '🇺🇸', country: '美国', title: '亚马逊欧洲站锂电池新规：9月30日未通过TIC认证将下架', summary: '含锂电池的小家电（风扇、加湿器、洗地机等）必须通过指定TIC机构完成直接验证，未通过商品面临下架及FBA库存冻结。', tag: '合规预警' },
  { flag: '🇺🇸', country: '美国', title: 'TikTok Shop全托管加码黑五，首次覆盖16国核心市场', summary: '2026年黑五大促季全托管模式覆盖美、英、欧盟12国、墨西哥、日本共16个市场，金九银十旺季开启，卖家可提前备货申报。', tag: '市场行情' },
  { flag: '🇨🇳', country: '中国', title: '0110报关新规：境外收货人禁止填写Amazon/FBA仓名', summary: '多地报关行明确0110一般贸易报关单境外收货人不得直接填Amazon或FBA仓名，须提供真实境外购货方、购销合同及结算凭证，合规可走9810海外仓模式预退税。', tag: '海关要闻' },
  { flag: '🇰🇷', country: '韩国', title: 'Coupang火箭增长计划持续，中国新卖家前3个月佣金减半', summary: 'Coupang针对中国新卖家提供前3个月佣金减免50%、物流补贴和广告金支持，美妆、家居品类增长最快。', tag: '平台动态' },
  { flag: '🇹🇭', country: '泰国', title: 'TikTok Shop泰国站直播GMV同比增长180%', summary: '泰国站直播电商GMV同比增长180%，美妆、3C、家居品类表现突出，东南亚短视频带货转化率持续提升。', tag: '市场行情' },
  { flag: '🇨🇳', country: '中国', title: '商务部：上半年跨境电商进出口同比增长15.6%', summary: '2026年上半年我国跨境电商进出口总额达1.32万亿元，同比增长15.6%，出口占比超70%，东南亚和拉美市场增速最快。', tag: '海关要闻' },
  { flag: '🇪🇺', country: '欧盟', title: '欧盟取消150欧元低值包裹免税，FBM每件征3欧元', summary: '7月1日起欧盟正式取消150欧元以下低值进口包裹关税豁免，境外直发FBM订单按件征收3欧元费用，须使用指定承运商并提供有效IOSS编号。', tag: '政策法规' },
  { flag: '🇺🇸', country: '美国', title: 'CPSC合规证书7月8日起强制电子提交', summary: '所有发往美国FBA的受监管产品，CPC合规证书必须通过电子方式在清关时提交，近期婴儿秋千、磁力积木、迷你冰箱等多类产品被召回。', tag: '合规预警' },
  { flag: '🇺🇸', country: '美国', title: '亚马逊AWD智能卫星仓8月20日开放欧洲五国', summary: 'AWD以统一费率提供长期批量仓储，面向德法意西英开放，黑五网一圣诞前可有效缓解FBA库容紧张、降低旺季仓储成本。', tag: '平台动态' }
];

function decodeEntities(s) {
  if (!s) return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '').trim();
}

// 从 AMZ123 / TT123 列表页 HTML 提取文章标题
function parseNavSite(html, sourceName) {
  const out = [];
  const seen = new Set();
  // 匹配 /t/xxx 文章链接块，提取 title 或 data-sdk-resource-id
  const re = /<a[^>]*href="https?:\/\/www\.(?:amz123|tt123)\.com\/t\/[A-Za-z0-9]+"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    let title = '';
    const tm = tag.match(/title="([^"]+)"/) || tag.match(/data-sdk-resource-id="([^"]+)"/);
    if (tm) title = decodeEntities(tm[1]);
    if (!title || title.length < 8) continue;
    if (seen.has(title)) continue;
    seen.add(title);
    out.push({ title, source: sourceName });
  }
  return out;
}

function classify(title, sourceName) {
  // TT123 来源默认 TikTok 类
  if (sourceName === 'TT123') {
    if (/泰国|越南|印尼|东南亚|马来|菲律宾/.test(title)) return { flag: '🇹🇭', country: '东南亚', tag: '市场行情' };
    if (/日本|乐天/.test(title)) return { flag: '🇯🇵', country: '日本', tag: '市场行情' };
    if (/韩国|Coupang|酷胖/.test(title)) return { flag: '🇰🇷', country: '韩国', tag: '市场行情' };
    if (/英国|德国|法国|欧洲|欧盟/.test(title)) return { flag: '🇪🇺', country: '欧美', tag: '市场行情' };
    return { flag: '🇺🇸', country: 'TikTok', tag: '平台动态' };
  }
  const map = [
    [/海关|报关|出口|关税|总署/, ['🇨🇳', '中国', '海关要闻']],
    [/CPSC|召回|认证|合规|CE|FCC|UL|锂电池|TIC|责任险|EORI|IOSS|VAT/, ['🇺🇸', '合规', '合规预警']],
    [/TikTok|tiktok|抖音海外/, ['🇹🇭', 'TikTok', '平台动态']],
    [/Coupang|酷胖|韩国/, ['🇰🇷', '韩国', '平台动态']],
    [/日本|乐天/, ['🇯🇵', '日本', '市场行情']],
    [/泰国|越南|东南亚|印尼/, ['🇹🇭', '东南亚', '市场行情']],
    [/欧盟|欧洲|德国|法国|英国|意大利|西班牙|荷兰/, ['🇪🇺', '欧盟', '平台政策']],
    [/亚马逊|Amazon|FBA|FBM|BSA|泛欧|AWD/, ['🇺🇸', '美国', '平台政策']]
  ];
  for (const [re, v] of map) if (re.test(title)) return { flag: v[0], country: v[1], tag: v[2] };
  return { flag: '🌐', country: '跨境', tag: '市场行情' };
}

async function fetchNavSite(url, sourceName, limit) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: timeoutSignal(9000) });
  if (!resp.ok) throw new Error(sourceName + ' HTTP ' + resp.status);
  const html = await resp.text();
  return parseNavSite(html, sourceName).slice(0, limit).map(it => {
    const c = classify(it.title, sourceName);
    return { flag: c.flag, country: c.country, title: it.title, summary: it.title + '（来源：' + sourceName + '）', tag: c.tag, time: '今日', origin: sourceName };
  });
}

function parseGoogleRss(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const b of blocks) {
    const titleM = b.match(/<title>([\s\S]*?)<\/title>/);
    const descM = b.match(/<description>([\s\S]*?)<\/description>/);
    const pubM = b.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    if (!titleM) continue;
    let title = decodeEntities(titleM[1]).replace(/\s*[-–—]\s*[^-–—]+$/, '').trim();
    const summary = descM ? decodeEntities(descM[1]).slice(0, 120) : title;
    let time = '最新';
    if (pubM) {
      const diff = (Date.now() - new Date(pubM[1]).getTime()) / 3600000;
      if (!isNaN(diff)) {
        if (diff < 1) time = '刚刚';
        else if (diff < 24) time = Math.floor(diff) + '小时前';
        else time = Math.floor(diff / 24) + '天前';
      }
    }
    items.push({ title, summary: summary || title, time });
  }
  return items;
}

async function fetchGoogleNews() {
  const queries = ['亚马逊卖家', '跨境电商', 'TikTok Shop'];
  const seen = new Set();
  const out = [];
  await Promise.all(queries.map(async (q) => {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:3d')}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
      const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: timeoutSignal(8000) });
      if (!resp.ok) return;
      const items = parseGoogleRss(await resp.text()).slice(0, 3);
      for (const it of items) {
        const key = it.title.slice(0, 18);
        if (seen.has(key)) continue;
        seen.add(key);
        const c = classify(it.title, '');
        out.push({ flag: c.flag, country: c.country, title: it.title, summary: it.summary, tag: c.tag, time: it.time, origin: 'GoogleNews' });
      }
    } catch (e) {}
  }));
  return out;
}

export async function onRequestGet() {
  if (cacheData && Date.now() - cacheTime < CACHE_TTL) {
    return new Response(JSON.stringify({ ...cacheData, cached: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // ① 优先抓取 AMZ123 + TT123（并行）
  const [amz, tt] = await Promise.all([
    fetchNavSite('https://www.amz123.com/kx', 'AMZ123', 8).catch(() => []),
    fetchNavSite('https://www.tt123.com/t/', 'TT123', 7).catch(() => [])
  ]);
  let news = [...amz, ...tt];
  const sources = [];
  if (amz.length) sources.push('AMZ123');
  if (tt.length) sources.push('TT123');

  // ② 不足时补 Google News
  if (news.length < 10) {
    const g = await fetchGoogleNews().catch(() => []);
    if (g.length) sources.push('GoogleNews');
    const exist = new Set(news.map(n => n.title.slice(0, 14)));
    for (const it of g) { if (news.length >= 15) break; if (!exist.has(it.title.slice(0, 14))) news.push(it); }
  }

  // ③ 仍不足用精选兜底
  let source = sources.length ? 'live:' + sources.join('+') : 'curated';
  if (news.length < 8) {
    source = sources.length ? 'mixed:' + sources.join('+') : 'curated';
    const existTitles = new Set(news.map(n => n.title.slice(0, 12)));
    for (const f of FALLBACK_NEWS) {
      if (news.length >= 15) break;
      if (!existTitles.has(f.title.slice(0, 12))) news.push({ ...f, time: '近期' });
    }
  }
  news = news.slice(0, 15);
  const result = { source, count: news.length, news, items: news, updated: new Date().toLocaleString('zh-CN') };
  if (amz.length || tt.length) { cacheData = result; cacheTime = Date.now(); }
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
