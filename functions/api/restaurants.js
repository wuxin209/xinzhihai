import { getAmapKey } from './_config.js';
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const keyword = url.searchParams.get('keyword') || '美食';
  const radius = url.searchParams.get('radius') || '5000';
  const page = url.searchParams.get('page') || '1';
  const AMAP_KEY = getAmapKey(context.env);

  try {
    if (!AMAP_KEY) return new Response(JSON.stringify({ source: 'fallback', error: '地图API未配置', restaurants: [] }), { headers: { 'Content-Type': 'application/json' } });
    if (!lat || !lng) return new Response(JSON.stringify({ error: '需要lat,lng' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const apiUrl = 'https://restapi.amap.com/v3/place/around?key=' + AMAP_KEY +
      '&location=' + lng + ',' + lat + '&keywords=' + encodeURIComponent(keyword) +
      '&radius=' + radius + '&offset=20&page=' + page + '&extensions=base&sortrule=weight&output=JSON';
    const resp = await fetch(apiUrl, { signal: AbortSignal.timeout(15000) });
    const data = await resp.json();

    if (data.status !== '1') return new Response(JSON.stringify({ source: 'fallback', error: data.info, restaurants: [] }), { headers: { 'Content-Type': 'application/json' } });

    const restaurants = (data.pois || []).map(poi => ({
      name: poi.name,
      address: poi.address || (poi.pname||'') + (poi.cityname||'') + (poi.adname||''),
      tel: poi.tel || '',
      type: poi.type || '',
      distance: poi.distance ? (poi.distance < 1000 ? poi.distance + 'm' : (poi.distance/1000).toFixed(1) + 'km') : '',
      rating: '',
      cost: ''
    }));

    return new Response(JSON.stringify({ source: 'amap', count: restaurants.length, keyword, restaurants }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ source: 'fallback', error: e.message, restaurants: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
