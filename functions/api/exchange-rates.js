let cacheData = null;
let cacheTime = 0;
const CACHE_TTL = 3600000;

export async function onRequestGet() {
  try {
    if (cacheData && Date.now() - cacheTime < CACHE_TTL) {
      return new Response(JSON.stringify({ ...cacheData, cached: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    const resp = await fetch('https://open.er-api.com/v6/latest/CNY');
    const data = await resp.json();
    const r = data.rates;
    const result = {
      source: 'live',
      USD: +(1 / r.USD).toFixed(4),
      AUD: +(1 / r.AUD).toFixed(4),
      JPY: +(1 / r.JPY).toFixed(6),
      KRW: +(1 / r.KRW).toFixed(6),
      THB: +(1 / r.THB).toFixed(4),
      updated: new Date().toLocaleString('zh-CN')
    };
    cacheData = result;
    cacheTime = Date.now();
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ source: 'fallback', USD: 6.79, AUD: 4.78, JPY: 0.0425, KRW: 0.0048, THB: 0.204, error: e.message }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
