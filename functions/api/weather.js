import { getAmapKey } from './_config.js';
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
// 目标国重大灾害预警：曼谷/泰国置顶优先，其余按目标国排序
const DISASTER_WORDS = [
  [/flood|洪水|水灾|内涝|积水|淹没|淹水|inundat/i, '水灾/洪水'],
  [/earthquake|地震/i, '地震'],
  [/typhoon|台风/i, '台风'],
  [/hurricane|飓风/i, '飓风'],
  [/wildfire|山火|野火/i, '山火'],
  [/blizzard|暴雪/i, '暴雪'],
  [/drought|干旱/i, '干旱'],
  [/storm|风暴/i, '风暴'],
  [/landslide|山体滑坡|泥石流/i, '山体滑坡'],
  [/tsunami|海啸/i, '海啸'],
  [/eruption|火山/i, '火山喷发'],
  [/heatwave|热浪/i, '热浪'],
  [/monsoon|季风/i, '季风暴雨']
];
const DISASTER_QUERIES = [
  { flag: '🇹🇭', country: '泰国', region: '曼谷', priority: 1, q: '曼谷 水灾', gq: 'Bangkok flood OR Bangkok flooding OR Bangkok inundation' },
  { flag: '🇹🇭', country: '泰国', region: '泰国', priority: 2, q: '泰国 洪水', gq: 'Thailand flood OR Thailand storm' },
  { flag: '🇯🇵', country: '日本', region: '日本', priority: 3, q: '日本 地震 台风', gq: 'Japan earthquake OR Japan typhoon' },
  { flag: '🇺🇸', country: '美国', region: '美国', priority: 4, q: '美国 飓风 山火', gq: 'US hurricane OR US wildfire' },
  { flag: '🇨🇦', country: '加拿大', region: '加拿大', priority: 5, q: '加拿大 山火', gq: 'Canada wildfire OR Canada flood' },
  { flag: '🇰🇷', country: '韩国', region: '韩国', priority: 6, q: '韩国 台风 暴雨', gq: 'South Korea typhoon OR South Korea flood' }
];
function pushHit(results, item, title, url, pd) {
  const hit = DISASTER_WORDS.find(([re]) => re.test(title));
  if (!hit) return false;
  let time = '';
  if (pd) {
    const t = new Date(pd);
    if (!isNaN(t)) time = t.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  results.push({ flag: item.flag, country: item.country, region: item.region, type: hit[1], title, time, url: url || '', priority: item.priority });
  return true;
}
async function fetchDisasters() {
  const results = [];
  const parseRss = (xml, item, cap) => {
    const arr = [];
    for (const m of [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12)) {
      if (arr.length >= cap) break;
      const title = decodeEntities(((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim());
      const link = ((m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
      const pd = ((m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
      if (title.length < 6) continue;
      const hit = DISASTER_WORDS.find(([re]) => re.test(title));
      if (!hit) continue;
      let time = '';
      if (pd) { const t = new Date(pd); if (!isNaN(t)) time = t.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
      arr.push({ flag: item.flag, country: item.country, region: item.region, type: hit[1], title, time, url: link, priority: item.priority });
    }
    return arr;
  };
  // 源1: Google News 中文（每地区重试3次，曼谷/泰国命中率优先）
  const fetchGoogle = async (item) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(item.q + ' when:7d') + '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans';
        const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: timeoutSignal(6000) });
        if (resp.ok) {
          const arr = parseRss(await resp.text(), item, 2);
          if (arr.length > 0) return arr;
        }
      } catch (e) {}
      if (attempt < 2) await new Promise((r) => setTimeout(r, 450));
    }
    return [];
  };
  const googleRound = await Promise.all(DISASTER_QUERIES.map((item) => fetchGoogle(item)));
  googleRound.forEach((arr) => results.push(...arr));
  // 源2: GDACS 全球灾害 RSS（按国家过滤兜底）
  try {
    const url = 'https://www.gdacs.org/xml/rss.xml';
    const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: timeoutSignal(6500) });
    if (resp.ok) {
      const xml = await resp.text();
      const gdacsCount = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const regionKeys = [
        ['bangkok', '曼谷'], ['thailand', '泰国'], ['japan', '日本'],
        ['united states', 'usa', '美国'], ['canada', '加拿大'], ['south korea', 'korea', '韩国']
      ];
      for (const m of [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 30)) {
        const title = decodeEntities(((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim()).toLowerCase();
        if (title.length < 8) continue;
        let idx = -1;
        for (let i = 0; i < regionKeys.length; i++) {
          if (regionKeys[i].some((k) => title.includes(k))) { idx = i; break; }
        }
        if (idx < 0 || gdacsCount[idx] >= 2) continue;
        const item = DISASTER_QUERIES[idx];
        if (results.some((r) => r.region === item.region)) continue; // Google 已覆盖则跳过
        const hit = DISASTER_WORDS.find(([re]) => re.test(title));
        if (!hit) continue;
        const link = ((m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
        const pd = ((m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
        let time = '';
        if (pd) { const t = new Date(pd); if (!isNaN(t)) time = t.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
        results.push({ flag: item.flag, country: item.country, region: item.region, type: hit[1], title: title[0].toUpperCase() + title.slice(1), time, url: link, priority: item.priority });
        gdacsCount[idx]++;
      }
    }
  } catch (e) {}
  results.sort((a, b) => a.priority - b.priority);
  const seen = new Set();
  return results.filter((r) => { const k = r.region + r.title; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
}
async function fetchOpenMeteo() {
  const lat = 25.43, lon = 119.01;
  const resp = await fetch(
    'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max' +
    '&current=temperature_2m,weather_code,wind_speed_10m&timezone=Asia/Shanghai&forecast_days=7'
  );
  const data = await resp.json();
  const wmo = {0:'晴',1:'大部晴',2:'多云',3:'阴',45:'雾',48:'雾凇',51:'小毛毛雨',53:'毛毛雨',55:'大毛毛雨',61:'小雨',63:'中雨',65:'大雨',71:'小雪',73:'中雪',75:'大雪',80:'阵雨',81:'强阵雨',82:'暴雨',95:'雷暴',96:'雷暴冰雹',99:'强雷暴'};
  const days = ['周日','周一','周二','周三','周四','周五','周六'];
  const weather = data.daily.time.map((date, i) => {
    const d = new Date(date);
    return {
      date: (d.getMonth()+1) + '.' + String(d.getDate()).padStart(2,'0'),
      day: i === 0 ? '今天' : days[d.getDay()],
      weather: wmo[data.daily.weather_code[i]] || '未知',
      high: Math.round(data.daily.temperature_2m_max[i]),
      low: Math.round(data.daily.temperature_2m_min[i]),
      wind: Math.round(data.daily.wind_speed_10m_max[i]),
      rain: data.daily.precipitation_probability_max[i] || 0
    };
  });
  const current = { temp: Math.round(data.current.temperature_2m), weather: wmo[data.current.weather_code] || '未知', wind: Math.round(data.current.wind_speed_10m) };
  return { current, weather };
}

export async function onRequestGet(context) {
  try {
    let weatherData;
    try {
      weatherData = await fetchOpenMeteo();
    } catch (e) {
      const amapKey = getAmapKey(context.env);
      if (amapKey) {
        const resp = await fetch('https://restapi.amap.com/v3/weather/weatherInfo?key=' + amapKey + '&city=350300&extensions=all', { signal: AbortSignal.timeout(8000) });
        const amap = await resp.json();
        if (amap.status === '1' && amap.forecasts?.[0]) {
          const casts = amap.forecasts[0].casts;
          const wmap = {'晴':'晴','多云':'多云','阴':'阴','小雨':'小雨','中雨':'中雨','大雨':'大雨','雷阵雨':'雷暴'};
          const days = ['周日','周一','周二','周三','周四','周五','周六'];
          weatherData = {
            current: { temp: parseInt(casts[0].daytemp), weather: wmap[casts[0].dayweather] || casts[0].dayweather, wind: 0 },
            weather: casts.slice(0,7).map((c,i) => {
              const d = new Date(c.date);
              return { date: (d.getMonth()+1)+'.'+String(d.getDate()).padStart(2,'0'), day: i===0?'今天':days[d.getDay()],
                weather: wmap[c.dayweather]||c.dayweather, high: parseInt(c.daytemp), low: parseInt(c.nighttemp), wind: 0, rain: 0 };
            })
          };
        } else throw e;
      } else throw e;
    }

    const t = weatherData.current.temp;
    const outfit = t >= 33 ? '短袖短裤+透气运动鞋' : t >= 28 ? '短袖+薄长裤+帆布鞋' : t >= 22 ? '短袖+薄外套+休闲裤' : t >= 15 ? '长袖+薄夹克+牛仔裤' : t >= 8 ? '毛衣+厚外套+休闲裤' : '羽绒服+保暖内衣+加绒裤';
    const notes = [];
    const w = weatherData.current.weather;
    if (w.includes('雨') || w.includes('雷暴')) notes.push('有雨，记得带伞');
    if (t >= 35) notes.push('高温预警，注意防暑');
    if (weatherData.weather[0].rain >= 60) notes.push('今天降水概率' + weatherData.weather[0].rain + '%，出门带伞');
    if (weatherData.current.wind >= 30) notes.push('大风天气，注意安全');
    if (notes.length === 0) notes.push('天气不错，适合外出');

    // 目标国重大灾害预警（曼谷/泰国置顶；失败不影响主天气数据）
    let disasters = [];
    let dlog = null;
    try {
      const u = new URL(context.request.url);
      const debug = u.searchParams.get('debug') === '1';
      disasters = await fetchDisasters(debug);
      dlog = debug ? globalThis.__dlog || [] : null;
    } catch (e) {}

    return new Response(JSON.stringify({
      source: 'live', ...weatherData, outfit, notes, disasters, dlog,
      updated: new Date().toLocaleString('zh-CN')
    }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({ source: 'fallback', error: e.message }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
