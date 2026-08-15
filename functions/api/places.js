// 高德地图周边搜索API
// 需要在Cloudflare Pages环境变量中配置 AMAP_KEY
const FALLBACK_PLACES = {
  '美食': [
    { name: '来古扁食', address: '莆田市仙游县', distance: '1.2km', type: '小吃快餐', rating: '4.6' },
    { name: '紫洋阿湖大肠炝', address: '莆田市仙游县', distance: '2.5km', type: '小吃快餐', rating: '4.5' },
    { name: '田头店猪脚汤', address: '莆田市仙游县', distance: '3.1km', type: '家常菜', rating: '4.7' },
    { name: '碼頭海鲜广场', address: '莆田市仙游县', distance: '4.0km', type: '海鲜', rating: '4.4' },
    { name: '重庆兄弟烤鱼', address: '莆田市仙游县', distance: '1.8km', type: '川菜', rating: '4.3' },
    { name: '上岸果木烤牛扒', address: '莆田市仙游县', distance: '2.2km', type: '西餐', rating: '4.5' }
  ],
  '健身': [
    { name: '金仕堡健身', address: '莆田市仙游县', distance: '1.5km', type: '健身房', rating: '4.2' },
    { name: '锐健私教工作室', address: '莆田市仙游县', distance: '2.0km', type: '私教', rating: '4.6' },
    { name: '仙游羽毛球馆', address: '莆田市仙游县', distance: '3.5km', type: '羽毛球', rating: '4.3' }
  ]
};

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const keyword = url.searchParams.get('keyword') || '美食';
  const location = url.searchParams.get('location') || '';

  const amapKey = context.env && context.env.AMAP_KEY;

  if (!amapKey || !location) {
    // 降级到预置数据
    const fallback = FALLBACK_PLACES[keyword] || FALLBACK_PLACES['美食'];
    return new Response(JSON.stringify({
      source: 'fallback',
      places: fallback,
      message: amapKey ? '未获取定位，显示推荐数据' : '未配置地图Key，显示推荐数据'
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    // 调用高德地图周边搜索API
    const [lng, lat] = location.split(',');
    const apiUrl = `https://restapi.amap.com/v3/place/around?key=${amapKey}&location=${lng},${lat}&keywords=${encodeURIComponent(keyword)}&radius=5000&offset=20&page=1&extensions=base&sortrule=weight`;
    const resp = await fetch(apiUrl);
    const data = await resp.json();

    if (data.status === '1' && data.pois) {
      const places = data.pois
        .filter(p => p.name && p.address)
        .map(p => ({
          name: p.name,
          address: p.address || (p.pname + p.cityname + p.adname),
          distance: p.distance ? (p.distance / 1000).toFixed(1) + 'km' : '未知',
          type: p.type ? p.type.split(';')[0] : keyword,
          rating: p.biz_ext && p.biz_ext.rating ? p.biz_ext.rating : '暂无'
        }))
        .filter(p => p.name && p.name.length > 1)
        .slice(0, 15);

      return new Response(JSON.stringify({ source: 'live', count: places.length, places }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    throw new Error('地图API返回异常');
  } catch (e) {
    const fallback = FALLBACK_PLACES[keyword] || FALLBACK_PLACES['美食'];
    return new Response(JSON.stringify({ source: 'fallback', places: fallback, error: e.message }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
