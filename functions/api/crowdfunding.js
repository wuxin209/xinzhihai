// Cloudflare Pages Function: GET /api/crowdfunding/hot?limit=6
// 潜力线索：抓取 Kickstarter / Indiegogo 热门众筹，失败降级精选池兜底
// 返回 { list: [...], updatedAt, source: 'live' | 'pool' }

// 精选池兜底：真实历史爆款众筹项目（定性参考/找灵感用，非实时数据）
const POOL_DATE = '2026-10-13T00:00:00+08:00';
const POOL = [
  {
    name: 'Pebble Time 智能手表',
    platform: 'Kickstarter',
    category: '智能硬件',
    innovation: '电子墨水屏 + 7天续航，把智能手表做回"手表"的极简路线',
    backers: 78234,
    progress: '1400%',
    url: 'https://www.kickstarter.com/projects/getpebble/pebble-time-awesome-smartwatch-no-compromises',
  },
  {
    name: 'Exploding Kittens 爆炸猫卡牌',
    platform: 'Kickstarter',
    category: '桌游玩具',
    innovation: '俄罗斯轮盘式卡牌玩法，把"抽牌即淘汰"做成派对爆款',
    backers: 219382,
    progress: '878%',
    url: 'https://www.kickstarter.com/projects/explodingkittens/exploding-kittens',
  },
  {
    name: 'Coolest Cooler 酷凉保温箱',
    platform: 'Kickstarter',
    category: '户外出行',
    innovation: '保温箱 + 搅拌机 + 蓝牙音箱 + USB充电一体，重新定义户外聚会',
    backers: 62420,
    progress: '2648%',
    url: 'https://www.kickstarter.com/projects/ryangrepper/coolest-cooler-21st-century-cooler-thats-actually',
  },
  {
    name: 'Anova Precision Cooker 低温慢煮机',
    platform: 'Kickstarter',
    category: '厨房电器',
    innovation: '精准控温 sous vide，让"真空低温慢煮"从餐厅走进家庭厨房',
    backers: 18325,
    progress: '365%',
    url: 'https://www.kickstarter.com/projects/anovaculinary/anova-precision-cooker',
  },
  {
    name: 'Fidget Cube 解压魔方',
    platform: 'Kickstarter',
    category: '减压玩具',
    innovation: '把"手痒"做成产品：7面不同手感，专注办公/焦虑人群',
    backers: 154926,
    progress: '1286%',
    url: 'https://www.kickstarter.com/projects/antsy-labs/fidget-cube-a-virtually-indestructible-fidget-toy',
  },
  {
    name: 'Flow Hive 免打扰蜂巢',
    platform: 'Indiegogo',
    category: '农业家居',
    innovation: '侧面取蜜设计，不用开箱惊扰蜜蜂，把养蜂变成阳台可做的事',
    backers: 37422,
    progress: '1325%',
    url: 'https://www.indiegogo.com/projects/flow-hive-honey-on-tap-without-beekeeping',
  },
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

async function tryFetch(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
      signal: ctrl.signal,
    });
    return res.ok ? await res.text() : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 尝试解析 Kickstarter 热门页里的项目卡（标题 + 支持人数）
function parseKickstarter(html) {
  const out = [];
  const re = /data-project-name="([^"]+)"[\s\S]{0,2000}?data-backers-count="([^"]+)"[\s\S]{0,3000}?data-pledged-amount="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null && out.length < 6) {
    out.push({
      name: m[1].trim(),
      platform: 'Kickstarter',
      category: '众筹新品',
      innovation: '实时抓取项目，点开链接查看详情',
      backers: parseInt(m[2], 10) || 0,
      progress: '—',
      url: 'https://www.kickstarter.com',
    });
  }
  return out;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '6', 10) || 6, 6);

  // 1) 尝试实时抓取（Kickstarter + Indiegogo 热门页）
  const [ks, igg] = await Promise.allSettled([
    tryFetch('https://www.kickstarter.com/discover/most-funded'),
    tryFetch('https://www.indiegogo.com/explore'),
  ]);
  let live = [];
  if (ks.status === 'fulfilled' && ks.value) {
    live = live.concat(parseKickstarter(ks.value));
  }
  if (live.length === 0 && igg.status === 'fulfilled' && igg.value && igg.value.length > 5000) {
    live.push({
      name: 'Indiegogo 热门众筹（实时抓取）',
      platform: 'Indiegogo',
      category: '众筹新品',
      innovation: '点开链接查看当前热门项目详情',
      backers: 0,
      progress: '—',
      url: 'https://www.indiegogo.com/explore',
    });
  }

  if (live.length >= 3) {
    return json({ list: live.slice(0, limit), updatedAt: new Date().toISOString(), source: 'live' });
  }

  // 2) 抓取失败 → 精选池兜底
  return json({
    list: POOL.slice(0, limit).map((p) => ({ ...p })),
    updatedAt: POOL_DATE,
    source: 'pool',
  });
}
