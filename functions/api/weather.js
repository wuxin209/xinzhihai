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
  [/earthquake|地震/i, '地震'],
  [/tsunami|海啸/i, '海啸'],
  [/flood|洪水|水灾|内涝|积水|淹没|淹水|inundat/i, '水灾/洪水'],
  [/torrential|暴雨|heavy rain|deluge|downpour/i, '暴雨'],
  [/tornado|龙卷风/i, '气旋（龙卷风）'],
  [/typhoon|台风/i, '气旋（台风）'],
  [/hurricane|飓风/i, '气旋（飓风）'],
  [/cyclone|气旋|cyclonic/i, '气旋'],
  [/eruption|volcano|火山/i, '火山喷发'],
  [/drought|干旱/i, '干旱'],
  [/forest fire|bushfire|brushfire|森林火灾|林火/i, '森林火灾'],
  [/wildfire|山火|野火/i, '山火'],
  [/fire|火灾/i, '火灾'],
  [/storm|风暴/i, '风暴'],
  [/blizzard|暴雪/i, '暴雪'],
  [/landslide|山体滑坡|泥石流/i, '山体滑坡'],
  [/heatwave|热浪/i, '热浪'],
  [/monsoon|季风/i, '季风暴雨']
];
const DISASTER_QUERIES = [
  { flag: '🇺🇸', country: '美国', region: '美国', priority: 1, q: '美国 地震 洪水 飓风 山火 龙卷风', gq: 'US earthquake OR US flood OR US hurricane OR US wildfire OR US tornado' },
  { flag: '🇨🇦', country: '加拿大', region: '加拿大', priority: 2, q: '加拿大 洪水 山火 地震', gq: 'Canada flood OR Canada wildfire OR Canada earthquake' },
  { flag: '🇯🇵', country: '日本', region: '日本', priority: 3, q: '日本 地震 台风 海啸 暴雨', gq: 'Japan earthquake OR Japan typhoon OR Japan tsunami OR Japan heavy rain' },
  { flag: '🇦🇺', country: '澳大利亚', region: '澳大利亚', priority: 4, q: '澳大利亚 森林火灾 洪水 台风 干旱', gq: 'Australia bushfire OR Australia flood OR Australia cyclone OR Australia drought' },
  { flag: '🇹🇭', country: '泰国', region: '曼谷', priority: 5, q: '曼谷 水灾 洪水 暴雨', gq: 'Bangkok flood OR Bangkok flooding OR Bangkok heavy rain' },
  { flag: '🇹🇭', country: '泰国', region: '泰国', priority: 6, q: '泰国 洪水 暴雨 台风', gq: 'Thailand flood OR Thailand storm OR Thailand heavy rain' },
  { flag: '🇲🇾', country: '马来西亚', region: '马来西亚', priority: 7, q: '马来西亚 洪水 暴雨 山体滑坡', gq: 'Malaysia flood OR Malaysia landslide OR Malaysia heavy rain' },
  { flag: '🇰🇷', country: '韩国', region: '韩国', priority: 8, q: '韩国 暴雨 台风 洪水', gq: 'South Korea flood OR South Korea typhoon OR South Korea heavy rain' },
  { flag: '🇲🇽', country: '墨西哥', region: '墨西哥', priority: 9, q: '墨西哥 地震 飓风 洪水', gq: 'Mexico earthquake OR Mexico hurricane OR Mexico flood' }
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
const DISASTERS_CACHE_KEY = 'xzh-disasters-v1';
async function fetchDisasters() {
  // 缓存命中优先：上游偶发失败时返回最近 10 分钟成功结果（曼谷水灾等不丢）
  try {
    const cache = caches.default;
    if (cache) {
      const hit = await cache.match(DISASTERS_CACHE_KEY);
      if (hit && hit.ok) {
        const cached = await hit.json();
        if (Array.isArray(cached) && cached.length > 0) return cached;
      }
    }
  } catch (e) {}

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
  // 源1: Google News 中文（曼谷/泰国重试2次优先，其余1次；整体控制在8秒内）
  const fetchGoogle = async (item) => {
    const maxTry = (item.priority === 1 || item.priority === 2) ? 2 : 1;
    for (let attempt = 0; attempt < maxTry; attempt++) {
      try {
        const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(item.q + ' when:7d') + '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans';
        const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: timeoutSignal(5000) });
        if (resp.ok) {
          const arr = parseRss(await resp.text(), item, 2);
          if (arr.length > 0) return arr;
        }
      } catch (e) {}
      if (attempt < maxTry - 1) await new Promise((r) => setTimeout(r, 350));
    }
    return [];
  };
  // 整体硬截止 6.5s：9 组并行抓取，到点用已拿到部分，避免拖垮主天气接口
  const googleRound = await Promise.race([
    Promise.all([Promise.all(DISASTER_QUERIES.map((item) => fetchGoogle(item))), gdacsP]),
    new Promise((r) => setTimeout(r, 8000))
  ]);
  googleRound.forEach((arr) => results.push(...arr));
  // 源2: GDACS 全球灾害 RSS（按国家过滤兜底，与 Google 并行）
  const gdacsP = (async () => {
  try {
    const url = 'https://www.gdacs.org/xml/rss.xml';
    const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: timeoutSignal(5000) });
    if (resp.ok) {
      const xml = await resp.text();
      const gdacsCount = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const regionKeys = [
        ['united states', 'usa', '美国'], ['canada', '加拿大'], ['japan', '日本'],
        ['australia', '澳大利亚'], ['bangkok', '曼谷'], ['thailand', '泰国'],
        ['malaysia', '马来西亚'], ['south korea', 'korea', '韩国'], ['mexico', '墨西哥']
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
        const dispRegion = item.region === '泰国' ? '曼谷/泰国' : item.region;
        const rawTitle = title[0].toUpperCase() + title.slice(1);
        const dispTitle = item.region === '泰国' ? '泰国（曼谷）' + hit[1] + '：' + rawTitle : rawTitle;
        results.push({ flag: item.flag, country: item.country, region: dispRegion, type: hit[1], title: dispTitle, time, url: link, priority: item.priority });
        gdacsCount[idx]++;
      }
    }
  } catch (e) {}
  })();
  results.sort((a, b) => a.priority - b.priority);
  const seen = new Set();
  const out = results.filter((r) => { const k = r.region + r.title; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);

  // 写入缓存 10 分钟（曼谷水灾等重大灾害必须持续可见）
  if (out.length > 0) {
    try {
      const cache = caches.default;
      if (cache) {
        const resp = new Response(JSON.stringify(out), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=600' }
        });
        await cache.put(DISASTERS_CACHE_KEY, resp);
      }
    } catch (e) {}
  }
  return out;
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

const TARGET_CITIES = [
  { country: '美国', city: '纽约', lat: 40.7128, lon: -74.006 },
  { country: '加拿大', city: '多伦多', lat: 43.6532, lon: -79.3832 },
  { country: '泰国', city: '曼谷', lat: 13.7563, lon: 100.5018 },
  { country: '日本', city: '东京', lat: 35.6762, lon: 139.6503 },
  { country: '韩国', city: '首尔', lat: 37.5665, lon: 126.978 },
  { country: '澳大利亚', city: '悉尼', lat: -33.8688, lon: 151.2093 },
  { country: '墨西哥', city: '墨西哥城', lat: 19.4326, lon: -99.1332 }
];

async function fetchCountryWeather() {
  const jobs = TARGET_CITIES.map(async (c) => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current_weather=true&timezone=auto`;
      const resp = await fetch(url, { signal: timeoutSignal(5000) });
      if (!resp.ok) return null;
      const d = await resp.json();
      const cur = d.current_weather;
      if (!cur) return null;
      const wmo = {
        0: '晴', 1: '晴间多云', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
        51: '毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪',
        80: '阵雨', 95: '雷暴', 96: '雷暴伴冰雹'
      };
      return {
        country: c.country, city: c.city,
        temp: Math.round(cur.temperature),
        weather: wmo[cur.weathercode] || ('码' + cur.weathercode),
        wind: Math.round(cur.windspeed),
        time: (cur.time || '').slice(11, 16)
      };
    } catch (e) { return null; }
  });
  // 整体硬截止 4.5s：7 国并行，到点用已拿到部分
  const list = (await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 4500))])).filter(Boolean);
  return list;
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
    const tempBand = t >= 33 ? 'hot' : t >= 28 ? 'warm' : t >= 22 ? 'mild' : t >= 15 ? 'cool' : t >= 8 ? 'chilly' : 'cold';
    const OUTFITS = {
      hot: { A: '短袖T恤(白/浅灰)+冰丝短裤(卡其)+透气运动鞋+防晒帽', B: '宽松衬衫(浅蓝)+棉麻长裤(米白)+帆布鞋+墨镜', C: '速干背心(薄荷绿)+五分裤(深灰)+洞洞鞋+冰袖' },
      warm: { A: '短袖(白)+薄长裤(浅卡其)+帆布鞋', B: 'T恤(藏青)+牛仔短裤(蓝)+小白鞋+防晒衣(浅粉)', C: 'polo衫(墨绿)+休闲裤(灰)+乐福鞋' },
      mild: { A: '长袖(浅杏)+薄外套(灰蓝)+休闲裤(黑)', B: '衬衫(白)+针织开衫(燕麦色)+牛仔裤(蓝)', C: '卫衣(雾霾蓝)+休闲裤(卡其)+运动鞋' },
      cool: { A: '长袖(白)+薄夹克(军绿)+牛仔裤(深蓝)', B: '针织衫(米色)+风衣(驼色)+休闲裤(黑)', C: '卫衣(酒红)+工装裤(军绿)+板鞋' },
      chilly: { A: '毛衣(浅灰)+厚外套(藏青)+休闲裤(黑)', B: '打底衫(黑)+羽绒马甲(卡其)+加绒裤(深灰)', C: '厚卫衣(姜黄)+棉服(灰)+运动鞋' },
      cold: { A: '羽绒服(黑)+保暖内衣(白)+加绒裤(深灰)', B: '大衣(驼色)+高领毛衣(米白)+雪地靴(棕)', C: '棉服(军绿)+羊毛衫(酒红)+加厚休闲裤(黑)' }
    };
    const outfitBase = OUTFITS[tempBand] || OUTFITS.mild;
    const outfitABC = { A: outfitBase.A, B: outfitBase.B, C: outfitBase.C };
    const outfit = outfitABC.A;
    const notes = [
      '紫外线较强，外出请做好防晒措施',
      '多喝水补充水分，避免中暑',
      '避免长时间户外暴晒，正午尽量减少外出',
      '天气多变，包里揣把折叠伞总没错',
      '天气影响物流时效，发货前请与货代确认时效'
    ];
    const w = weatherData.current.weather;
    const nDate = new Date();
    const doyN = Math.floor((nDate - new Date(nDate.getFullYear(), 0, 0)) / 86400000);
    // 首条按当日天气微调措辞（晴/雨/风/低温分支），其余4条固定
    const firstByWeather = w.includes('雨') || w.includes('雷暴') || w.includes('暴雨') ? '今日有雨，外出带伞，货件包装务必防潮' : w.includes('雪') ? '今日降雪，注意保暖，货件防冻' : w.includes('晴') ? '今日晴朗，紫外线较强，外出请做好防晒措施' : w.includes('风') ? '今日风力较大，户外作业注意安全加固' : '今日天气平稳，紫外线较强，外出请做好防晒措施';
    const notesFinal = [firstByWeather, ...notes.slice(1)];

    // 目标国重大灾害预警（曼谷/泰国置顶；失败不影响主天气数据）
    let disasters = [];
    let dlog = null;
    try {
      const u = new URL(context.request.url);
      const debug = u.searchParams.get('debug') === '1';
      disasters = await fetchDisasters(debug);
      dlog = debug ? globalThis.__dlog || [] : null;
    } catch (e) {}

    // 目标国当前天气（美/加/泰/日/韩/澳/墨，open-meteo 并行，失败不影响主数据）
    let countryWeather = [];
    try { countryWeather = await fetchCountryWeather(); } catch (e) {}

    return new Response(JSON.stringify({
      source: 'live', ...weatherData, outfit, outfitABC, notes: notesFinal, disasters, dlog, countryWeather,
      updated: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' (北京时间)'
    }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({ source: 'fallback', error: e.message }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
