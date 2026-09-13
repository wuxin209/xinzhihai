// 市场早讯接口（区别于新闻资讯 /api/news）
// 定位：市场行情/爆品趋势/平台动态，三大固定平台版块：亚马逊 / TikTok / 酷胖(Coupang)，每天每个版块都必须有数据
// 数据源：① AMZ123 跨境快讯(/kx) + TT123 TikTok资讯(/t) 实时抓取 ② Google News RSS ③ 三平台人工精选兜底
let cacheData = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30分钟缓存

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// 每个平台每天的固定保底条数（合计约15）
const FLOOR = { '亚马逊': 6, 'TikTok': 6, '酷胖': 3 };
const PLATFORM_ORDER = ['亚马逊', 'TikTok', '酷胖'];

function timeoutSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, ms);
  return ctrl.signal;
}

// 三平台人工精选兜底（标题、摘要、平台、国家、标签）
const FALLBACK = {
  亚马逊: [
    { flag: '🇺🇸', country: '美国', title: '亚马逊假日旺季配送附加费10月15日起征，持续至次年1月14日', summary: '每年Q4旺季FBA都会加收假日配送附加费，与旺季月度仓储费(10-12月)是两套费用，定价和利润测算要提前把这两笔算进去，别等扣费才发现利润被吃掉。', tag: '平台政策' },
    { flag: '🇺🇸', country: '美国', title: '亚马逊11月更新商业责任险要求，超1万美元销售额须30天内投保', summary: '美国站销售额达到门槛的卖家须在30天内取得并维持有效商业综合责任险，旺季前务必核对保单是否合规，避免被限制销售权限。', tag: '合规预警' },
    { flag: '🇺🇸', country: '美国', title: '亚马逊BSA协议新规：未经书面同意禁止转让质押店铺', summary: '新规明确禁止卖家未经书面同意转让或质押协议项下全部或部分权利义务（含销售收入受偿权），买店卖店、店铺质押风险显著升高。', tag: '平台政策' },
    { flag: '🇺🇸', country: '美国', title: '亚马逊容量管理器可竞价额外FBA库容，旺季提前锁仓', summary: '畅销品可通过容量管理器按预留费用竞价申请额外空间，无需预付，产生销售后还可获绩效抵免，旺季库容紧张建议提前申请。', tag: '平台动态' },
    { flag: '🇯🇵', country: '日本', title: '亚马逊日本站Q4家居与保暖品类搜索量环比走高', summary: '日本站10月起保暖小家电、收纳、厨房用品进入上升通道，日本买家重评价和包装细节，备货注意JAN条码与PSE/PSC认证。', tag: '市场行情' },
    { flag: '🇺🇸', country: '美国', title: '亚马逊AWD智能卫星仓旺季不收额外仓储费，冗余库存可前置', summary: '超过4-6个月可售的冗余库存放AWD可避免FBA旺季仓储费和入库配置费，AWD自动补货不占FBA容量限制，适合旺季压货。', tag: '平台动态' },
    { flag: '🇺🇸', country: '美国', title: 'CPSC合规证书强制电子提交，受监管产品清关前备齐CPC', summary: '发往美国FBA的受监管产品，CPC合规证书须在清关时电子提交，婴童、磁力、电器类近期召回频繁，认证文件务必随货齐备。', tag: '合规预警' },
    { flag: '🇺🇸', country: '美国', title: '亚马逊黑五网一Z划算/秒杀固定费用约245美元/场，早鸟省50', summary: '黑五网一促销有固定活动费，早鸟截止日前提报每场省50美元，报活动前先用利润测算算清促销价是否还赚钱，别赔本冲量。', tag: '平台政策' }
  ],
  TikTok: [
    { flag: '🇹🇭', country: '泰国', title: 'TikTok Shop泰国站直播GMV高速增长，美妆3C家居领跑', summary: '泰国站直播电商转化持续走高，美妆、3C配件、家居小件表现突出，短视频+直播带货在东南亚渗透率快速提升，适合性价比轻小件。', tag: '市场行情' },
    { flag: '🇺🇸', country: '美国', title: 'TikTok Shop履约差店铺将被OVL限单，三级店铺限收30%订单', summary: '延迟履约率或商责取消率过高会触发OVL跨境限单，第三级店铺最多只接收近4周日均订单的30%，旺季要把延迟履约率压到4%以内、取消率压到2.5%以内。', tag: '平台政策' },
    { flag: '🇺🇸', country: '美国', title: 'TikTok Shop全托管黑五首次覆盖16国核心市场', summary: '黑五大促季全托管覆盖美英、欧盟12国、墨西哥、日本等16个市场，金九银十可提前备货申报，半托管与本土店也同步开放活动提报。', tag: '市场行情' },
    { flag: '🇯🇵', country: '日本', title: 'TikTok Shop日本站开放自主注册，美区内测砍价拼团直播', summary: '日本站卖家可自主注册入驻；美区向受邀商家内测砍价与拼团直播，观众可互动压价、邀人成团，互动型直播玩法正在扩容。', tag: '平台动态' },
    { flag: '🇹🇭', country: '泰国', title: '东南亚短视频带货爆单逻辑：强钩子前3秒+本地化达人口播', summary: '泰国、越南、印尼用户对价格敏感，前3秒抛痛点或价格钩子、用本地语言达人出镜转化率明显更高，纯AI配音素材过多容易被限流。', tag: '市场行情' },
    { flag: '🇺🇸', country: '美国', title: 'TikTok Shop美区达人联盟佣金比例普涨，内容种草成主要出单口', summary: '美区越来越多订单来自达人带货短视频而非搜索，设置有竞争力的联盟佣金、主动寄样建联腰部达人，是新店冷启动的关键路径。', tag: '市场行情' },
    { flag: '🇹🇭', country: '泰国', title: 'TikTok Shop东南亚COD占比仍高，退货率与拒收率要计入定价', summary: '泰国、印尼、越南货到付款比例高，拒收和退货成本不可忽视，定价时预留退货损耗，优先做轻小件、低客单冲动消费品。', tag: '市场行情' },
    { flag: '🇺🇸', country: '美国', title: 'TikTok Shop商品卡与搜索广告权重提升，货架电商化加速', summary: '除了短视频和直播，商品卡、商城搜索流量占比上升，标题埋词、主图点击率、商品评分成为货架场景的核心排名因子。', tag: '平台动态' }
  ],
  酷胖: [
    { flag: '🇰🇷', country: '韩国', title: 'Coupang火箭增长计划持续，中国新卖家前3个月佣金减半', summary: 'Coupang针对中国新卖家提供前3个月佣金减免50%、物流补贴和广告金支持，美妆、家居、小家电品类增长最快，新店红利期要抓紧铺品起量。', tag: '平台动态' },
    { flag: '🇰🇷', country: '韩国', title: 'Coupang酷澎火箭配送(Rocket)时效要求高，入仓时效决定曝光', summary: '酷胖把配送时效作为搜索权重核心，使用火箭配送/官方仓储的商品曝光更高，自发货要保证准时送达率，迟发会直接降权。', tag: '平台政策' },
    { flag: '🇰🇷', country: '韩国', title: '韩国KC认证是电器类上架硬门槛，缺证会被下架', summary: '卖电器、带电池、儿童产品到韩国基本要有KC认证（部分可自我宣告），上架前确认类目认证要求，避免listing被下架或清关被扣。', tag: '合规预警' },
    { flag: '🇰🇷', country: '韩国', title: 'Coupang C-ADS广告类似亚马逊SP，按点击付费是站内引流主力', summary: '酷胖智能广告C-ADS按点击付费，新手建议先开广泛词跑数据、再把高转化词转精准，韩国买家搜索词多为韩文，关键词要做本地化而非直译。', tag: '平台动态' },
    { flag: '🇰🇷', country: '韩国', title: 'Coupang酷涨券/限时促销是韩国站爆单利器，配合节日节奏', summary: 'Rocket Wow Discount等官方优惠券会在前台突出展示，配合11月11日빼빼로日、年末送礼季等韩国本土节日设置折扣，转化率提升明显。', tag: '市场行情' },
    { flag: '🇰🇷', country: '韩国', title: '韩国电商退货讲究快速响应，Coupang买家退款体验偏向买家', summary: '酷胖平台整体偏向买家，退货退款申请要快速处理，避免纠纷影响店铺评分；高客单产品上架前把退货损耗和韩国本地售后成本算进定价。', tag: '平台政策' },
    { flag: '🇰🇷', country: '韩国', title: '中国卖家发韩国可走威海仓专线，时效与成本兼顾', summary: '国内多地有发往韩国的海运快线和威海仓中转，3-5天可达，比国际快递便宜，做酷胖自发货或补货海外仓可优先对比专线渠道。', tag: '市场行情' },
    { flag: '🇰🇷', country: '韩国', title: '韩国买家重视详情页与评价，Naver风格详情更吃香', summary: '韩国消费者习惯看详细图文对比和真实评价，详情页建议参考Naver Smart Store风格，突出参数、尺寸、使用场景，并积极积累带图评价。', tag: '市场行情' }
  ]
};

function decodeEntities(s) {
  if (!s) return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '').trim();
}

// 平台归类：优先级 酷胖 > TikTok > 亚马逊；sourceName 提供初始倾向
function platformOf(title, sourceName, country) {
  const t = title || '';
  if (/Coupang|coupang|酷胖|酷澎|韩国|KC认证|Naver|首尔|釜山/.test(t)) return '酷胖';
  if (sourceName === 'TT123') {
    if (/Coupang|酷胖|酷澎|韩国/.test(t)) return '酷胖';
    return 'TikTok';
  }
  if (/TikTok|tiktok|抖音海外|短视频带货|达人联盟|东南亚|泰国|越南|印尼|马来|马来西亚|菲律宾|新加坡/.test(t)) return 'TikTok';
  if (/亚马逊|Amazon|amazon|FBA|FBM|BSA|泛欧|AWD|Prime|黑五|网一|listing|Listing|ASIN|贝索斯/.test(t)) return '亚马逊';
  if (country === '韩国') return '酷胖';
  if (country === 'TikTok' || country === '东南亚' || country === '日本' && /TikTok|tiktok/.test(t)) return 'TikTok';
  // AMZ123 来源默认亚马逊；其余默认亚马逊（早讯以跨境电商平台为主）
  return '亚马逊';
}

// 从 AMZ123 / TT123 列表页 HTML 提取文章标题
function parseNavSite(html, sourceName) {
  const out = [];
  const seen = new Set();
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
  if (sourceName === 'TT123') {
    if (/泰国|越南|印尼|东南亚|马来|菲律宾/.test(title)) return { flag: '🇹🇭', country: '东南亚', tag: '市场行情' };
    if (/日本|乐天/.test(title)) return { flag: '🇯🇵', country: '日本', tag: '市场行情' };
    if (/韩国|Coupang|酷胖|酷澎/.test(title)) return { flag: '🇰🇷', country: '韩国', tag: '市场行情' };
    if (/英国|德国|法国|欧洲|欧盟/.test(title)) return { flag: '🇪🇺', country: '欧美', tag: '市场行情' };
    return { flag: '🇺🇸', country: 'TikTok', tag: '平台动态' };
  }
  const map = [
    [/海关|报关|出口|关税|总署/, ['🇨🇳', '中国', '海关要闻']],
    [/CPSC|召回|认证|合规|CE|FCC|UL|锂电池|TIC|责任险|EORI|IOSS|VAT|KC/, ['🇺🇸', '合规', '合规预警']],
    [/TikTok|tiktok|抖音海外/, ['🇹🇭', 'TikTok', '平台动态']],
    [/Coupang|酷胖|酷澎|韩国/, ['🇰🇷', '韩国', '平台动态']],
    [/日本|乐天/, ['🇯🇵', '日本', '市场行情']],
    [/泰国|越南|东南亚|印尼/, ['🇹🇭', '东南亚', '市场行情']],
    [/欧盟|欧洲|德国|法国|英国|意大利|西班牙|荷兰/, ['🇪🇺', '欧盟', '平台政策']],
    [/亚马逊|Amazon|FBA|FBM|BSA|泛欧|AWD/, ['🇺🇸', '美国', '平台政策']]
  ];
  for (const [re, v] of map) if (re.test(title)) return { flag: v[0], country: v[1], tag: v[2] };
  return { flag: '🌐', country: '跨境', tag: '市场行情' };
}

async function fetchNavSite(url, sourceName, limit) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: timeoutSignal(5500) });
  if (!resp.ok) throw new Error(sourceName + ' HTTP ' + resp.status);
  const html = await resp.text();
  return parseNavSite(html, sourceName).slice(0, limit).map(it => {
    const c = classify(it.title, sourceName);
    const platform = platformOf(it.title, sourceName, c.country);
    return { flag: c.flag, country: c.country, title: it.title, summary: it.title + '（来源：' + sourceName + '）', tag: c.tag, time: '今日', origin: sourceName, platform };
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
  // 三个平台分别查询，保证酷胖也有联网补充
  const queries = ['亚马逊卖家', 'TikTok Shop 跨境', 'Coupang 酷胖 韩国电商'];
  const seen = new Set();
  const out = [];
  await Promise.all(queries.map(async (q) => {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
      const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: timeoutSignal(5000) });
      if (!resp.ok) return;
      const items = parseGoogleRss(await resp.text()).slice(0, 4);
      for (const it of items) {
        const key = it.title.slice(0, 18);
        if (seen.has(key)) continue;
        seen.add(key);
        const c = classify(it.title, '');
        const platform = platformOf(it.title, '', c.country);
        out.push({ flag: c.flag, country: c.country, title: it.title, summary: it.summary, tag: c.tag, time: it.time, origin: 'GoogleNews', platform });
      }
    } catch (e) {}
  }));
  return out;
}

// 三平台轮转交错：亚马逊 → TikTok → 酷胖 → 亚马逊 ……，保证"全部"视图三平台都持续出现，且数量向保底看齐
function roundRobinByPlatform(buckets, total) {
  const out = [];
  const queues = {};
  for (const p of PLATFORM_ORDER) queues[p] = [...(buckets[p] || [])];
  let guard = 0;
  while (out.length < total && guard++ < 60) {
    let progressed = false;
    for (const p of PLATFORM_ORDER) {
      if (out.length >= total) break;
      if (queues[p].length) { out.push(queues[p].shift()); progressed = true; }
    }
    if (!progressed) break;
  }
  return out;
}

export async function onRequestGet() {
  if (cacheData && Date.now() - cacheTime < CACHE_TTL) {
    return new Response(JSON.stringify({ ...cacheData, cached: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // ① 三源并行 + 6s 硬墙：到点用已抓到的，未返回的源放弃，绝不串行累加耗时
  const got = { amz: [], tt: [], g: [] };
  const jobs = [
    fetchNavSite('https://www.amz123.com/kx', 'AMZ123', 11).then(v => { got.amz = Array.isArray(v) ? v : []; }).catch(() => {}),
    fetchNavSite('https://www.tt123.com/t/', 'TT123', 13).then(v => { got.tt = Array.isArray(v) ? v : []; }).catch(() => {}),
    fetchGoogleNews().then(v => { got.g = Array.isArray(v) ? v : []; }).catch(() => {})
  ];
  await Promise.race([Promise.all(jobs), new Promise(res => setTimeout(res, 6000))]);
  const amz = got.amz, tt = got.tt, g = got.g;
  let news = [...amz, ...tt];

  // 跨来源标题去重（姐妹站会发同文）
  const seenTitle = new Set();
  news = news.filter(n => {
    const k = (n.title || '').replace(/[\s\p{P}]/gu, '').slice(0, 18);
    if (!k || seenTitle.has(k)) return false;
    seenTitle.add(k);
    return true;
  });

  const sources = [];
  if (amz.length) sources.push('AMZ123');
  if (tt.length) sources.push('TT123');

  // ② Google News 补充（含 Coupang 查询）
  if (g.length) sources.push('GoogleNews');
  const gExist = new Set(news.map(n => (n.title || '').slice(0, 14)));
  for (const it of g) { if (news.length >= 24) break; if (!gExist.has(it.title.slice(0, 14))) news.push(it); }

  // ③ 按平台分桶
  const buckets = { '亚马逊': [], 'TikTok': [], '酷胖': [] };
  for (const it of news) {
    const p = it.platform || platformOf(it.title, it.origin, it.country);
    it.platform = p;
    buckets[p].push(it);
  }

  // ④ 每个平台不足保底条数，用各自精选兜底池补齐（按"一年第几天"轮转，保证每天换不同兜底）
  const now = new Date();
  const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const usedFallbackKey = new Set(news.map(n => (n.title || '').slice(0, 12)));
  for (const p of PLATFORM_ORDER) {
    const pool = FALLBACK[p] || [];
    // 轮转起点，避免每天都从第一条开始
    const rotated = pool.map((_, i) => pool[(i + doy) % pool.length]);
    let pi = 0;
    while (buckets[p].length < FLOOR[p] && pi < rotated.length * 2) {
      const f = rotated[pi % rotated.length]; pi++;
      const key = f.title.slice(0, 12);
      if (usedFallbackKey.has(key)) continue;
      usedFallbackKey.add(key);
      buckets[p].push({ ...f, time: '近期', origin: 'curated', platform: p });
    }
  }

  // ⑤ 三平台轮排交错，总数控制在15（亚马逊6/TikTok6/酷胖3 左右，实时多的平台可略多但三平台都不为0）
  let merged = roundRobinByPlatform(buckets, 15);

  // 安全兜底：极端情况下若某平台仍为0（理论上不会，因为FALLBACK保底），强制再补
  const finalCount = { '亚马逊': 0, 'TikTok': 0, '酷胖': 0 };
  merged.forEach(it => { finalCount[it.platform] = (finalCount[it.platform] || 0) + 1; });
  for (const p of PLATFORM_ORDER) {
    if (finalCount[p] === 0 && (FALLBACK[p] || []).length) {
      merged.push({ ...FALLBACK[p][doy % FALLBACK[p].length], time: '近期', origin: 'curated', platform: p });
    }
  }

  const liveCount = news.length;
  const source = sources.length ? 'live:' + sources.join('+') + '+curated-floor' : 'curated';
  const result = {
    source, liveCount, platformCount: finalCount,
    count: merged.length, news: merged, items: merged,
    updated: now.toLocaleString('zh-CN')
  };
  if (amz.length || tt.length || g.length) { cacheData = result; cacheTime = Date.now(); }
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
