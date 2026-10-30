import { getAmapKey } from './_config.js';

// 真实馆子兜底池（高德实时抓取，福建五城各8家；仅在高德接口不可用时兜底，避免白屏）
const LOCAL_POOL = {
  '莆田': [
    { name: '七稻鲜现熬砂锅粥(龙桥店)', address: '城厢区龙桥街道荔城中大道2386号', tel: '', rating: '4.8', cost: '¥30-60' },
    { name: '塔斯汀中国汉堡(莆田市龙桥店)', address: '城厢区荔城中大道2424号', tel: '', rating: '4.6', cost: '¥20-40' },
    { name: '莆田卤面(荔城中大道店)', address: '城厢区荔城中大道2378号', tel: '', rating: '4.7', cost: '¥25-50' },
    { name: '小菜圣·豆浆炒(龙桥1店)', address: '城厢区明阳路与民心街交叉口西北60米', tel: '', rating: '4.5', cost: '¥15-30' },
    { name: '龙桥扁食荣老字号', address: '城厢区三信家园景阳路1609-95号', tel: '', rating: '4.7', cost: '¥10-25' },
    { name: '东海蔡记肥肠(花城大道店)', address: '城厢区景阳路26号', tel: '', rating: '4.4', cost: '¥20-45' },
    { name: '祖传西天尾麻铸扁食店(南门分店)', address: '城厢区荔城中大道2376号', tel: '', rating: '4.8', cost: '¥10-20' },
    { name: '蒲尚佳兴化卤面(龙桥店)', address: '城厢区龙桥街道明阳路193号', tel: '', rating: '4.6', cost: '¥25-50' }
  ],
  '仙游': [
    { name: '华莱士·全鸡汉堡(郊尾店)', address: '仙游县郊尾镇圣岭街309号', tel: '', rating: '4.5', cost: '¥15-35' },
    { name: '紫洋大肠炝', address: '仙游县紫洋社区居委会四房6号', tel: '', rating: '4.7', cost: '¥20-40' },
    { name: '连天捞海鲜牛肉捞锅(仙游总部培训店)', address: '仙游县盖尾镇石马村洋中央', tel: '', rating: '4.6', cost: '¥50-100' },
    { name: '杉尾正宗海蛎饼', address: '仙游县241县道', tel: '', rating: '4.4', cost: '¥5-15' },
    { name: '塔斯汀中国汉堡(仙游县郊尾店)', address: '仙游县郊尾镇凤凰百货一楼506号', tel: '', rating: '4.6', cost: '¥20-40' },
    { name: '田头店猪脚饭', address: '仙游县盖尾镇盖南村田头店桥下', tel: '', rating: '4.5', cost: '¥15-30' },
    { name: '伯清特色大肠炝(坝下店)', address: '仙游县榜头镇新村南路41号', tel: '', rating: '4.7', cost: '¥20-40' },
    { name: '赤饼忠', address: '仙游县榜头镇企业管理站东南门旁', tel: '', rating: '4.6', cost: '¥5-15' }
  ],
  '泉州': [
    { name: '麦当劳(泉州师范学院餐厅)', address: '丰泽区东海街道东海大街398号泉州师院学院第三餐厅4层', tel: '', rating: '4.5', cost: '¥20-45' },
    { name: '仟佰佳餐厅', address: '丰泽区东海市行政中心(府西路)E栋二楼', tel: '', rating: '4.6', cost: '¥30-60' },
    { name: '周麻婆·川菜小炒(泉州丰泽海星街店)', address: '丰泽区海星街62-66号', tel: '', rating: '4.5', cost: '¥40-80' },
    { name: '老嗲沙茶面', address: '丰泽区石壁小区3号楼106号', tel: '', rating: '4.7', cost: '¥20-40' },
    { name: '塔斯汀中国汉堡(泉州市东海海星店)', address: '丰泽区海星小区一期20栋14号店铺', tel: '', rating: '4.6', cost: '¥20-40' },
    { name: '不二斋(海星小区店)', address: '丰泽区海星街50号', tel: '', rating: '4.5', cost: '¥25-50' },
    { name: '功牛泉州牛肉小吃店(东海香缤店)', address: '丰泽区滨海街139号', tel: '', rating: '4.7', cost: '¥25-55' },
    { name: '阿牛泉牛馆(东海旗舰店)', address: '丰泽区金花广场大剧院负一层售票厅对面', tel: '', rating: '4.6', cost: '¥40-90' }
  ],
  '厦门': [
    { name: 'LONE STAR孤星汉堡', address: '思明区湖滨北路42-4号102室', tel: '', rating: '4.6', cost: '¥50-100' },
    { name: '㠭烎台式红烧牛肉面(滨北建兴路店)', address: '思明区建兴路91号102室', tel: '', rating: '4.7', cost: '¥30-60' },
    { name: 'BistroBotoru餐酒小馆', address: '思明区建业路22号-2商铺(建业路地铁站4号口步行240米)', tel: '', rating: '4.8', cost: '¥100-200' },
    { name: '东南兮donoxi', address: '思明区建兴小区建兴路81号101室', tel: '', rating: '4.7', cost: '¥40-80' },
    { name: '尊宝比萨(滨北店)', address: '思明区湖滨北路振兴新村29号之一(西门旁)', tel: '', rating: '4.6', cost: '¥40-80' },
    { name: '静香Dining(滨北店)', address: '思明区建业路14号(建业路地铁站4号口步行220米)', tel: '', rating: '4.8', cost: '¥80-160' },
    { name: 'Bagi&Yogi(特贸苑店)', address: '思明区官任路38号-5(建业路地铁站4号口步行320米)', tel: '', rating: '4.7', cost: '¥60-120' },
    { name: '遇龙闽粤菜(滨北颐豪店)', address: '思明区湖滨北路40-1号201室', tel: '', rating: '4.6', cost: '¥80-150' }
  ],
  '漳州': [
    { name: '阿蛤正宗洋老洲卤面', address: '芗城区大通北路和平里5号', tel: '', rating: '4.8', cost: '¥15-30' },
    { name: '麦当劳(漳州麦当劳胜利西路餐厅)', address: '芗城区胜利西路68号新玑广场一楼', tel: '', rating: '4.5', cost: '¥20-45' },
    { name: '章记美味鸡饭(通北店)', address: '芗城区大通北路北桥新村11幢8号', tel: '', rating: '4.6', cost: '¥20-40' },
    { name: '客家楼(大通北店)', address: '芗城区大通北路51号芝山小楼1-2层', tel: '', rating: '4.5', cost: '¥40-90' },
    { name: '满香舒·漳州小馆(学生街店)', address: '芗城区县后路(学生街)9-10号店面', tel: '', rating: '4.7', cost: '¥30-60' },
    { name: '塔斯汀中国汉堡(漳州市瑞京路店)', address: '芗城区瑞京路93-9号和93-10号店', tel: '', rating: '4.6', cost: '¥20-40' },
    { name: '阿芳卤面(瑞京花园店)', address: '芗城区建设路5号瑞京花园9幢16号', tel: '', rating: '4.7', cost: '¥15-30' },
    { name: '信华-元气99(大通北店)', address: '芗城区大通北路41-15至17号店', tel: '', rating: '4.5', cost: '¥30-60' }
  ]
};

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const city = url.searchParams.get('city') || '';
  const keyword = url.searchParams.get('keyword') || '美食';
  const radius = url.searchParams.get('radius') || '5000';
  const page = url.searchParams.get('page') || '1';
  const AMAP_KEY = getAmapKey(context.env);

  try {
    if (!AMAP_KEY) return new Response(JSON.stringify({ source: 'fallback', error: '地图API未配置', restaurants: [] }), { headers: { 'Content-Type': 'application/json' } });
    // 缓存：城市/坐标粒度 60 分钟（馆子数据变化不频繁，首访后可秒回）
    const ck = 'xzh-rest-v1-' + encodeURIComponent((lat && lng) ? (lat + ',' + lng + '|' + radius) : (city + '|' + keyword + '|' + page));
    try {
      const chit = await caches.default.match(ck);
      if (chit && chit.ok) {
        const cached = await chit.json();
        if (cached && cached.restaurants && cached.restaurants.length > 0) {
          return new Response(JSON.stringify({ ...cached, cached: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=3600' } });
        }
      }
    } catch (e) {}
    // 城市搜索分支：无坐标但有 city 时用高德关键字检索（定位失败场景也能用）
    if (!lat || !lng) {
      if (!city) return new Response(JSON.stringify({ error: '需要lat,lng或city' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      // 高德请求：失败重试一次，仍失败回退本地真实馆子池
      let data = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const apiUrl = 'https://restapi.amap.com/v3/place/text?key=' + AMAP_KEY +
            '&keywords=' + encodeURIComponent(keyword) +
            '&city=' + encodeURIComponent(city) + '&citylimit=true' +
            '&offset=20&page=' + page + '&extensions=base&output=JSON';
          const resp = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
          if (resp.ok) { data = await resp.json(); if (data.status === '1') break; }
        } catch (e) {}
        if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
      }
      if (!data || data.status !== '1') {
        // 高德不可用 → 本地真实馆子池兜底
        const pool = LOCAL_POOL[city];
        if (pool && pool.length) return new Response(JSON.stringify({ source: 'local-pool', city, count: pool.length, keyword, restaurants: pool }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=3600' } });
        return new Response(JSON.stringify({ source: 'fallback', error: (data && data.info) || '高德接口超时', restaurants: [] }), { headers: { 'Content-Type': 'application/json' } });
      }
      const restaurants = (data.pois || []).map(poi => ({
        name: poi.name,
        address: poi.address || (poi.pname||'') + (poi.cityname||'') + (poi.adname||''),
        tel: poi.tel || '',
        type: poi.type || '',
        distance: '',
        rating: '',
        cost: ''
      }));
      const body = { source: 'amap-city', city, count: restaurants.length, keyword, restaurants };
      try { await caches.default.put(ck, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })); } catch (e) {}
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=3600' }
      });
    }

    // 坐标分支：失败重试一次，仍失败返回明确提示（避免白屏）
    let data = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const apiUrl = 'https://restapi.amap.com/v3/place/around?key=' + AMAP_KEY +
          '&location=' + lng + ',' + lat + '&keywords=' + encodeURIComponent(keyword) +
          '&radius=' + radius + '&offset=20&page=' + page + '&extensions=base&sortrule=weight&output=JSON';
        const resp = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
        if (resp.ok) { data = await resp.json(); if (data.status === '1') break; }
      } catch (e) {}
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }

    if (!data || data.status !== '1') {
      return new Response(JSON.stringify({ source: 'fallback', error: (data && data.info) || '高德接口超时，请稍后重试', restaurants: [] }), { headers: { 'Content-Type': 'application/json' } });
    }

    const restaurants = (data.pois || []).map(poi => ({
      name: poi.name,
      address: poi.address || (poi.pname||'') + (poi.cityname||'') + (poi.adname||''),
      tel: poi.tel || '',
      type: poi.type || '',
      distance: poi.distance ? (poi.distance < 1000 ? poi.distance + 'm' : (poi.distance/1000).toFixed(1) + 'km') : '',
      rating: '',
      cost: ''
    }));
    const body = { source: 'amap', count: restaurants.length, keyword, restaurants };
    try { await caches.default.put(ck, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })); } catch (e) {}

    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=3600' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ source: 'fallback', error: e.message, restaurants: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
