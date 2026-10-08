// 汇率接口：双源实时 + 交叉校验 + 短缓存 + 智能兜底
// 主源: open.er-api.com(市场中间价)  副源: currency-api.pages.dev(官方每日实时)
// 口径说明: 返回为市场中间价(1外币=?人民币)，实际结汇以银行现汇买入价为准(通常低0.1%-0.3%)
let cacheData = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10分钟

function timeoutSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, ms);
  return ctrl.signal;
}

// 陈旧硬编码兜底（仅在完全没有成功缓存时使用；已标注 stale，前端应提示）
const STALE_FALLBACK = { USD: 7.03, CAD: 5.19, AUD: 4.72, JPY: 0.0468, KRW: 0.0052, THB: 0.209 };

// 从 er-api 结构取数: { rates: { USD: 0.14 } } 表示 1 CNY = 0.14 USD
function fromErApi(d) {
  const r = d.rates;
  if (!r) throw new Error('er-api no rates');
  return { date: d.time_last_update_utc ? d.time_last_update_utc.slice(0, 10) : '', rates: { USD: r.USD, CAD: r.CAD, AUD: r.AUD, JPY: r.JPY, KRW: r.KRW, THB: r.THB } };
}

// 从 currency-api 结构取数: { date:'2026-10-08', cny: { usd: 0.14 } }
function fromCurrencyApi(d) {
  const c = d.cny;
  if (!c) throw new Error('currency-api no cny');
  return { date: d.date || '', rates: { USD: c.usd, CAD: c.cad, AUD: c.aud, JPY: c.jpy, KRW: c.krw, THB: c.thb } };
}

function build(rates, date) {
  const out = { source: 'live', date };
  // 1 CNY = X 外币 => 1 外币 = (1/X) CNY
  out.USD = +(1 / rates.USD).toFixed(4);
  out.CAD = +(1 / rates.CAD).toFixed(4);
  out.AUD = +(1 / rates.AUD).toFixed(4);
  out.JPY = +(1 / rates.JPY).toFixed(6);
  out.KRW = +(1 / rates.KRW).toFixed(6);
  out.THB = +(1 / rates.THB).toFixed(4);
  return out;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestGet() {
  if (cacheData && Date.now() - cacheTime < CACHE_TTL) {
    return json({ ...cacheData, cached: true });
  }
  const errors = [];
  let primary = null, secondary = null;
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/CNY', { signal: timeoutSignal(6000) });
    if (!resp.ok) throw new Error('er-api http ' + resp.status);
    primary = fromErApi(await resp.json());
  } catch (e) { errors.push('主源:' + e.message); }
  try {
    const resp = await fetch('https://latest.currency-api.pages.dev/v1/currencies/cny.json', { signal: timeoutSignal(6000) });
    if (!resp.ok) throw new Error('currency-api http ' + resp.status);
    secondary = fromCurrencyApi(await resp.json());
  } catch (e) { errors.push('副源:' + e.message); }

  let rates, date;
  if (primary) {
    rates = primary.rates; date = primary.date;
    if (secondary) {
      // 交叉校验：最大相对偏差
      let maxDev = 0;
      for (const k of ['USD', 'CAD', 'AUD', 'JPY', 'KRW', 'THB']) {
        if (!secondary.rates[k]) continue;
        const a = 1 / primary.rates[k], b = 1 / secondary.rates[k];
        maxDev = Math.max(maxDev, Math.abs(a - b) / a);
      }
      if (maxDev > 0.02) errors.push('两源偏差' + (maxDev * 100).toFixed(2) + '%(取主源)');
    }
  } else if (secondary) {
    rates = secondary.rates; date = secondary.date;
  } else {
    // 双源全挂：优先用上次成功缓存（即使过期），完全没有才用陈旧参考值
    if (cacheData) {
      return json({ ...cacheData, cached: false, stale: true, errors });
    }
    return json({ source: 'stale-fallback', date: '', ...STALE_FALLBACK, stale: true, errors, updated: new Date().toLocaleString('zh-CN') });
  }

  const result = build(rates, date);
  result.updated = new Date().toLocaleString('zh-CN');
  result.note = '市场中间价，实际结汇以银行现汇买入价为准（通常低0.1%-0.3%）';
  // 兼容前端期望的 {data:{rates:{...}}} 嵌套结构，同时保留扁平字段
  result.data = { rates: {} };
  for (const k of ['USD', 'CAD', 'THB', 'JPY', 'KRW', 'AUD']) if (result[k] !== undefined) result.data.rates[k] = result[k];
  if (errors.length) result.errors = errors;
  cacheData = result;
  cacheTime = Date.now();
  return json(result);
}
