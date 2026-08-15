export async function onRequestGet(context) {
  const AMAP_KEY = context.env.AMAP_KEY || '';
  try {
    const ip = context.request.headers.get('CF-Connecting-IP') ||
               context.request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || '';

    if (!AMAP_KEY || !ip || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return new Response(JSON.stringify({
        source: 'default', province: '福建省', city: '莆田市', adcode: '350300', location: '119.0078,25.4300'
      }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    const resp = await fetch('https://restapi.amap.com/v3/ip?key=' + AMAP_KEY + '&ip=' + ip, { signal: AbortSignal.timeout(8000) });
    const data = await resp.json();

    if (data.status === '1' && data.rectangle) {
      const coords = data.rectangle.split(';')[0].split(',');
      return new Response(JSON.stringify({
        source: 'amap', province: data.province, city: data.city, adcode: data.adcode,
        location: coords[0] + ',' + coords[1]
      }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
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
