// 内容保鲜管道接口：抓取跨境行业最新干货候选（标题+来源+链接）
// 定位：供前端「内容保鲜」面板抓取 → 与本地技巧库去重 → 人工审核入库
// 数据源：AMZ123 早报/资讯列表 + TT123 TikTok资讯 + 雨果网（按稳定性降级）
let cacheData = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function timeoutSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, ms);
  return ctrl.signal;
}

function decodeEntities(s) {
  if (!s) return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '').trim();
}

function todayCN() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// AMZ123 资讯列表解析（/t/xxx 详情页链接）
function parseAmz123(html) {
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
    const url = tag.match(/href="([^"]+)"/)[1];
    out.push({ title, source: 'AMZ123', url, date: todayCN() });
  }
  return out.slice(0, 12);
}

// TT123 标题解析（/t/xxx 链接）
function parseTt123(html) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]*href="https?:\/\/www\.tt123\.com\/t\/[A-Za-z0-9]+"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const tm = tag.match(/title="([^"]+)"/);
    let title = tm ? decodeEntities(tm[1]) : '';
    if (!title || title.length < 8 || seen.has(title)) continue;
    seen.add(title);
    const url = tag.match(/href="([^"]+)"/)[1];
    out.push({ title, source: 'TT123', url, date: todayCN() });
  }
  return out.slice(0, 10);
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const resp = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=600' }
  });

  if (cacheData && Date.now() - cacheTime < CACHE_TTL) {
    return resp({ ...cacheData, cached: true });
  }

  const results = [];
  const seenTitles = new Set();
  const push = (list) => {
    for (const it of list) {
      if (seenTitles.has(it.title)) continue;
      seenTitles.add(it.title);
      results.push(it);
    }
  };

  // 并行抓两个源，各自独立超时降级
  const jobs = [
    { name: 'amz123', fn: async () => {
      const r = await fetch('https://www.amz123.com/zb', { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: timeoutSignal(10000) });
      if (!r.ok) throw new Error('amz123 ' + r.status);
      return parseAmz123(await r.text());
    } },
    { name: 'tt123', fn: async () => {
      const r = await fetch('https://www.tt123.com/', { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: timeoutSignal(10000) });
      if (!r.ok) throw new Error('tt123 ' + r.status);
      return parseTt123(await r.text());
    } }
  ];

  await Promise.allSettled(jobs.map((j) => j.fn().then((list) => push(list))));

  if (results.length === 0) {
    return resp({ ok: false, error: '本次抓取失败请稍后重试', items: [] }, 502);
  }

  cacheData = { ok: true, items: results, fetchedAt: new Date().toISOString() };
  cacheTime = Date.now();
  return resp(cacheData);
}
