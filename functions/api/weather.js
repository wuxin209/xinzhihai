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
  const googleRound = await Promise.all(DISASTER_QUERIES.map((item) => fetchGoogle(item)));
  googleRound.forEach((arr) => results.push(...arr));
  // 源2: GDACS 全球灾害 RSS（按国家过滤兜底）
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
  const list = (await Promise.all(jobs)).filter(Boolean);
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
      hot: { A: '短袖T恤+冰丝短裤+透气运动鞋+防晒帽', B: '宽松衬衫+棉麻长裤+帆布鞋+墨镜', C: '速干背心+五分裤+洞洞鞋+冰袖' },
      warm: { A: '短袖+薄长裤+帆布鞋', B: 'T恤+牛仔短裤+小白鞋+防晒衣', C: 'polo衫+休闲裤+乐福鞋' },
      mild: { A: '长袖+薄外套+休闲裤', B: '衬衫+针织开衫+牛仔裤', C: '卫衣+休闲裤+运动鞋' },
      cool: { A: '长袖+薄夹克+牛仔裤', B: '针织衫+风衣+休闲裤', C: '卫衣+工装裤+板鞋' },
      chilly: { A: '毛衣+厚外套+休闲裤', B: '打底衫+羽绒马甲+加绒裤', C: '厚卫衣+棉服+运动鞋' },
      cold: { A: '羽绒服+保暖内衣+加绒裤', B: '大衣+高领毛衣+雪地靴', C: '棉服+羊毛衫+加厚休闲裤' }
    };
    const outfitBase = OUTFITS[tempBand] || OUTFITS.mild;
    const outfitABC = { A: outfitBase.A, B: outfitBase.B, C: outfitBase.C };
    const outfit = outfitABC.A;
    const notes = [];
    const w = weatherData.current.weather;
    const nDate = new Date();
    const doyN = Math.floor((nDate - new Date(nDate.getFullYear(), 0, 0)) / 86400000);
    const pickPool = (pool) => pool[doyN % pool.length];
    const sunnyPool = ['晴空万里，适合安排外出验货或拍摄产品实拍图', '阳光正好，适合拍摄白底主图，光线充足', '天气晴朗，户外作业注意补水和防晒', '晴好天气，适合整理仓库、盘点和发货'];
    const cloudyPool = ['多云天气，体感舒适，适合外出办事', '云量较多，光线柔和适合拍细节图', '多云间晴，适合安排拜访或仓库整理'];
    const rainyPool = ['有雨，记得带伞，货件包装务必加防潮袋', '雨天路滑，发货包裹注意防潮防湿', '降雨天气，外出携带雨具，仓库门窗关好'];
    const windyPool = ['风力较大，注意高空坠物，打包发货加固处理', '风大，露天装卸货注意安全'];
    const snowyPool = ['降雪天气，注意保暖，路面湿滑出行小心', '下雪天，货件注意防冻，出行防滑'];
    if (w.includes('雨') || w.includes('雷暴') || w.includes('暴雨')) notes.push(pickPool(rainyPool));
    else if (w.includes('雪')) notes.push(pickPool(snowyPool));
    else if (w.includes('晴')) notes.push(pickPool(sunnyPool));
    else if (w.includes('云') || w.includes('阴') || w.includes('雾')) notes.push(pickPool(cloudyPool));
    else notes.push(pickPool(sunnyPool));
    if (t >= 35) notes.push('高温预警，注意防暑，避免长时间户外作业');
    else if (t <= 5) notes.push('低温天气，注意保暖，货件注意防冻');
    if (weatherData.weather[0].rain >= 60) notes.push('今日降水概率 ' + weatherData.weather[0].rain + '%，发货包裹务必加防潮措施');
    if (weatherData.current.wind >= 30) notes.push('大风天气，注意安全，户外作业加固');
    const miscPool = ['跨境电商日报记得抽空看，行情都在里面', '旺季在即，备货计划今天抽时间过一遍', '新品上架前记得跑一遍侵权风险排查', '今日汇率已更新，报价前先看利润测算', '发货前核对FBA箱规，避免超长超重', '今日待办按时完成，保持连续打卡'];
    notes.push(miscPool[(doyN * 3 + 1) % miscPool.length]);
    const seenN = new Set();
    const notesOut = notes.filter(n2 => { const k2 = n2.slice(0, 10); if (seenN.has(k2)) return false; seenN.add(k2); return true; }).slice(0, 4);
    const notesFinal = notesOut;

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
