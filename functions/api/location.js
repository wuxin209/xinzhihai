import { getAmapKey } from './_config.js';
export async function onRequestGet(context) {
  const AMAP_KEY = getAmapKey(context.env);
  try {
    const ip = context.request.headers.get('CF-Connecting-IP') ||
               context.request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || '';

    if (!AMAP_KEY || !ip || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return new Response(JSON.stringify({
        source: 'default', province: '福建省', city: '莆田市', adcode: '350300', location: '119.0078,25.4300'
      }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    // 缓存：IP 粒度 60 分钟（IP 定位结果长时间不变，避免每次 8-11s 慢请求）
    const ck = 'xzh-loc-v1-' + ip;
    try {
      const chit = await caches.default.match(ck);
      if (chit && chit.ok) {
        const cached = await chit.json();
        if (cached && cached.location) return new Response(JSON.stringify({ ...cached, cached: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
    } catch (e) {}

    const resp = await fetch('https://restapi.amap.com/v3/ip?key=' + AMAP_KEY + '&ip=' + ip, { signal: AbortSignal.timeout(6000) });
    const data = await resp.json();

    if (data.status === '1' && data.rectangle) {
      const coords = data.rectangle.split(';')[0].split(',');
      const body = {
        source: 'amap', province: data.province, city: data.city, adcode: data.adcode,
        location: coords[0] + ',' + coords[1]
      };
      try { await caches.default.put(ck, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })); } catch (e) {}
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    return new Response(JSON.stringify({
      source: 'default', province: '福建省', city: '莆田市', adcode: '350300', location: '119.0078,25.4300'
    }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({
      source: 'fallback', province: '福建省', city: '莆田市', adcode: '350300', location: '119.0078,25.4300'
    }), { headers: { 'Content-Type': 'application/json' } });
  }
}

// touch rebuild
