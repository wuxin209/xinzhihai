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

async function fetchText(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json,text/xml,*/*' }, signal: ctrl.signal, redirect: 'follow' });
    return r.ok ? await r.text() : '';
  } catch { return ''; } finally { clearTimeout(t); }
}

// Google Patents XHR 检索 → 结构化专利清单
async function queryGooglePatents(kws, debug) {
  const results = [];
  const debugRaw = [];
  // 多组查询策略，任一命中即返回：完整词组 → 核心词
  const tries = [
    kws.join('+'),
    kws.slice(0, 2).join('+'),
    kws[0]
  ];
  for (const tq of tries) {
    const url = `https://patents.google.com/xhr/query?url=q%3D${tq}%26country%3DUS%26num%3D10`;
    const txt = await fetchText(url, 6000);
    if (debug && txt) debugRaw.push(txt.slice(0, 400));
    if (!txt) continue;
    try {
      const d = JSON.parse(txt);
      const res = (d && d.results && d.results.result) || [];
      const patents = res.map(x => {
        const p = (x && x.patent) || {};
        const num = p.publication_number || '';
        const title = p.title || '';
        const score = x.score || 0;
        const lower = title.toLowerCase();
        const hits = kws.filter(k => lower.includes(k.toLowerCase())).length;
        return {
          patentNumber: num,
          title,
          assignee: p.assignee || '',
          grantDate: (p.grant_date || p.publication_date || '').slice(0, 10),
          url: num ? `https://patents.google.com/patent/${num}/en` : '',
          score,
          titleHits: hits
        };
      }).filter(p => p.patentNumber);
      if (patents.length) results.push(...patents);
    } catch { /* 单组失败继续下一组 */ }
  }
  return { ok: results.length > 0, patents: results, debugRaw };
}

// Google News RSS 检索商标/侵权/TRO 风险提醒（标题必须含关键词才算相关，过滤噪音）
async function queryRiskNews(kws) {
  const q = encodeURIComponent(kws.slice(0, 2).join(' ') + ' (trademark OR infringement OR TRO OR lawsuit OR patent)');
  const txt = await fetchText(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, 6000);
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

function pickRisk(patents) {
  const strong = patents.filter(p => p.titleHits >= 2);
  const some = patents.filter(p => p.titleHits >= 1);
  if (strong.length >= 2 || patents.length >= 3) return { level: 'high', label: '高风险', reason: `检索到 ${patents.length} 件相关专利，其中 ${strong.length} 件高度相关，建议改款或进一步核实后再上架` };
  if (strong.length === 1 || some.length >= 1) return { level: 'medium', label: '中风险', reason: `检索到 ${patents.length} 件相关专利，建议人工核实权利要求与您的产品差异` };
  return { level: 'low', label: '低风险', reason: '未检索到高度相关的已授权专利，仍建议人工复核' };
}

export async function onRequestGet(ctx) {
  try {
    const url = new URL(ctx.request.url);
    const raw = url.searchParams.get('keywords') || url.searchParams.get('q') || '';
    const keywords = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
    if (!keywords.length) {
      return new Response(JSON.stringify({ risk: 'empty', patents: [], trademarkWarnings: [], summary: '请输入产品英文关键词（逗号分隔，1~3 个），例如：water bottle, cap', disclaimer: DISCLAIMER, updated: new Date().toLocaleString('zh-CN') }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    const cacheKey = hashStr(keywords.join('|'));
    const hit = mem.get(cacheKey);
    if (hit && Date.now() - hit.t < 6 * 3600 * 1000) return new Response(JSON.stringify({ ...hit.data, cached: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

    const debug = url.searchParams.get('debug') === '1';
  const [gp, news] = await Promise.all([queryGooglePatents(keywords, debug), queryRiskNews(keywords)]);
    const risk = gp.ok ? pickRisk(gp.patents) : { level: 'unknown', label: '无法判断', reason: '专利联网检索未成功（网络或接口临时不可用），建议稍后重试或人工核实' };
    const data = {
      risk: risk.level,
      riskLabel: risk.label,
      riskReason: risk.reason,
      patents: gp.patents.slice(0, 8),
      trademarkWarnings: news,
      keywords,
      summary: gp.ok
        ? `共检索到 ${gp.patents.length} 件相关美国专利，${news.length} 条商标/侵权相关资讯`
        : '专利检索未完成',
      debugRaw: debug ? gp.debugRaw : undefined,
      disclaimer: DISCLAIMER,
      updated: new Date().toLocaleString('zh-CN')
    };
    mem.set(cacheKey, { t: Date.now(), data });
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({ risk: 'error', patents: [], trademarkWarnings: [], summary: '排查服务异常：' + String(e && e.message || e), disclaimer: DISCLAIMER, updated: new Date().toLocaleString('zh-CN') }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
