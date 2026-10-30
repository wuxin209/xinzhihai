// 汇率接口：三源实时 + 交叉校验 + 短缓存 + 智能兜底
// 主源A: 中国银行外汇牌价(现汇买入价) —— 结汇到手参考价，最接近收款平台(万里汇/连连等)实际提款汇率
// 主源B: open.er-api.com(市场中间价)   副源: currency-api.pages.dev(官方每日实时)
// 口径说明: USD 优先取「中国银行现汇买入价」(1美元结汇到手人民币)并标注来源；
//          收款平台结汇普遍参照银行牌价：万里汇通常与中行持平或略低，连连等压价平台明显更低。
//          其余币种优先中行牌价，缺失则回退市场中间价。
let cacheData = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10分钟

function timeoutSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, ms);
  return ctrl.signal;
}

// 陈旧硬编码兜底（仅在完全没有成功缓存时使用；已标注 stale，前端应提示）
const STALE_FALLBACK = { USD: 7.03, CAD: 5.19, AUD: 4.72, JPY: 0.0468, KRW: 0.0052, THB: 0.209, MYR: 0.60, MXN: 0.36 };

// ===== 源A：中国银行外汇牌价（现汇买入价，100外币兑人民币）=====
// 表结构: <tr data-currency='美元'><td>美元</td><td>668.2</td><td>668.2</td><td>671.01</td><td>671.01</td><td>673.13</td><td class=pjrq>时间</td><td>20:17:17</td></tr>
// 列: 货币名 | 现汇买入 | 现钞买入 | 现汇卖出 | 现钞卖出 | 中行折算 | 发布时间
const BOC_CURRENCY = { '美元': 'USD', '加拿大元': 'CAD', '澳大利亚元': 'AUD', '日元': 'JPY', '泰国铢': 'THB', '林吉特': 'MYR', '墨西哥比索': 'MXN' };

function fromBoc(html) {
  const out = { date: '', rates: {} };
  const timeMatch = html.match(/(\d{4})\/(\d{2})\/(\d{2})[^0-9]*(\d{2}:\d{2}:\d{2})/);
  if (timeMatch) out.date = `${timeMatch[1]}-${timeMatch[2]}-${timeMatch[3]} ${timeMatch[4]}`;
  const rowRe = /<tr\s+data-currency='([^']+)'>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const name = m[1];
    const code = BOC_CURRENCY[name];
    if (!code) continue;
    const tds = m[2].match(/<td[^>]*>([^<]*)<\/td>/g);
    if (!tds || tds.length < 2) continue;
    const buyRaw = tds[1].replace(/<[^>]+>/g, '').trim(); // 现汇买入价(第2列)
    if (!buyRaw) continue;
    const buy = parseFloat(buyRaw);
    if (isNaN(buy) || buy <= 0) continue;
    // 现汇买入价按 100 外币兑人民币，JPY 特殊（100日元）
    out.rates[code] = +(buy / 100).toFixed(6);
  }
  if (!out.rates.USD) throw new Error('boc no USD buy rate');
  return out;
}

// 从 er-api 结构取数: { rates: { USD: 0.14 } } 表示 1 CNY = 0.14 USD
function fromErApi(d) {
  const r = d.rates;
  if (!r) throw new Error('er-api no rates');
  return { date: d.time_last_update_utc ? d.time_last_update_utc.slice(0, 10) : '', rates: { USD: r.USD, CAD: r.CAD, AUD: r.AUD, JPY: r.JPY, KRW: r.KRW, THB: r.THB, MYR: r.MYR, MXN: r.MXN } };
}

// 从 currency-api 结构取数: { date:'2026-10-08', cny: { usd: 0.14 } }
function fromCurrencyApi(d) {
  const c = d.cny;
  if (!c) throw new Error('currency-api no cny');
  return { date: d.date || '', rates: { USD: c.usd, CAD: c.cad, AUD: c.aud, JPY: c.jpy, KRW: c.krw, THB: c.thb, MYR: c.myr, MXN: c.mxn } };
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
  out.MYR = +(1 / rates.MYR).toFixed(4);
  out.MXN = +(1 / rates.MXN).toFixed(4);
  return out;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=600' }
  });
}

export async function onRequestGet() {
  if (cacheData && Date.now() - cacheTime < CACHE_TTL) {
    return json({ ...cacheData, cached: true });
  }
  const errors = [];
  let boc = null, primary = null, secondary = null;
  // 源A：中行牌价（现汇买入价=结汇到手参考）
  try {
    const resp = await fetch('https://www.boc.cn/sourcedb/whpj/', { signal: timeoutSignal(8000) });
    if (!resp.ok) throw new Error('boc http ' + resp.status);
    const html = await resp.text();
    boc = fromBoc(html);
  } catch (e) { errors.push('中行牌价:' + e.message); }
  // 源B：市场中间价
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/CNY', { signal: timeoutSignal(6000) });
    if (!resp.ok) throw new Error('er-api http ' + resp.status);
    primary = fromErApi(await resp.json());
  } catch (e) { errors.push('er-api:' + e.message); }
  try {
    const resp = await fetch('https://latest.currency-api.pages.dev/v1/currencies/cny.json', { signal: timeoutSignal(6000) });
    if (!resp.ok) throw new Error('currency-api http ' + resp.status);
    secondary = fromCurrencyApi(await resp.json());
  } catch (e) { errors.push('currency-api:' + e.message); }

  const result = { source: 'live', date: '' };
  const usedSource = { USD: 'er-api', CAD: 'er-api', AUD: 'er-api', JPY: 'er-api', THB: 'er-api', MYR: 'er-api', MXN: 'er-api' };

  // 中间价数据（备用/回退）
  let mid = null;
  if (primary) {
    mid = primary.rates;
    result.date = primary.date;
    if (secondary) {
      let maxDev = 0;
      for (const k of ['USD', 'CAD', 'AUD', 'JPY', 'KRW', 'THB', 'MYR', 'MXN']) {
        if (!secondary.rates[k]) continue;
        const a = 1 / primary.rates[k], b = 1 / secondary.rates[k];
        maxDev = Math.max(maxDev, Math.abs(a - b) / a);
      }
      if (maxDev > 0.02) errors.push('两源偏差' + (maxDev * 100).toFixed(2) + '%(取主源)');
    }
  } else if (secondary) {
    mid = secondary.rates;
    result.date = secondary.date;
  }

  if (!mid && !boc) {
    // 全挂：优先用上次成功缓存（即使过期），完全没有才用陈旧参考值
    if (cacheData) {
      return json({ ...cacheData, cached: false, stale: true, errors });
    }
    return json({ source: 'stale-fallback', date: '', ...STALE_FALLBACK, stale: true, errors, updated: new Date().toLocaleString('zh-CN') });
  }

  // 逐币种取值：中行现汇买入价优先（结汇到手），缺失回退市场中间价
  const codes = ['USD', 'CAD', 'AUD', 'JPY', 'KRW', 'THB', 'MYR', 'MXN'];
  for (const code of codes) {
    if (boc && boc.rates[code] !== undefined) {
      // boc.rates[code] 已是 1外币=?人民币（现汇买入价）
      result[code] = +(boc.rates[code]).toFixed(code === 'JPY' || code === 'KRW' ? 6 : 4);
      usedSource[code] = '中国银行现汇买入价';
    } else if (mid && mid[code]) {
      result[code] = +(1 / mid[code]).toFixed(code === 'JPY' || code === 'KRW' ? 6 : 4);
      usedSource[code] = '市场中间价';
    }
  }

  result.updated = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' (北京时间)';
  result.usdSource = usedSource.USD; // 前端可展示美元汇率来源
  result.sources = usedSource;
  result.note = 'USD 取「中国银行现汇买入价」(结汇到手参考)：收款平台(如万里汇)通常与中行持平或略低，连连等压价平台明显更低；其余币种优先中行牌价，缺失为市场中间价';
  // 兼容前端期望的 {data:{rates:{...}}} 嵌套结构，同时保留扁平字段
  result.data = { rates: {} };
  for (const k of ['USD', 'CAD', 'THB', 'JPY', 'KRW', 'AUD', 'MYR', 'MXN']) if (result[k] !== undefined) result.data.rates[k] = result[k];
  if (errors.length) result.errors = errors;
  cacheData = result;
  cacheTime = Date.now();
  return json(result);
}
