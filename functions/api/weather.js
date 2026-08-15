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
      const amapKey = context.env.AMAP_KEY || '';
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

    return new Response(JSON.stringify({
      source: 'live', ...weatherData, outfit, notes,
      updated: new Date().toLocaleString('zh-CN')
    }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({ source: 'fallback', error: e.message }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
