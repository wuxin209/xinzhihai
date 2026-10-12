// 内容保鲜管道接口：一键自运行「抓取运营/AI技巧干货 → 分类 → 去重 → 选择性入库」
// 与旧版差异：不再以新闻为主，按关键词分类器筛选「运营技巧 / AI技巧」干货条目，
// 与已入库 content-tips.json 做标题归一化去重，新增条目写入 GitHub 私有仓 xinzhihai-data/content-tips.json
import { getGithubToken } from '../_config.js';

const OWNER = 'wuxin209';
const REPO = 'xinzhihai-data';
const PATH = 'content-tips.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Cache-Control': 'no-store'
};

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

function todayCN() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ===== 标题归一化（用于跨源去重）=====
function normTitle(t) {
  return String(t || '').toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '')
    .replace(/(19|20)\d{2}/g, '')   // 去年份
    .replace(/(周|月|日|期)[0-9]{1,2}/g, '') // 去周/月/日序号
    .slice(0, 40);
}

// ===== 关键词分类器：先排新闻特征，再判技巧类 =====
const NEWS_WORDS = ['大促', '定档', '旺季', '会员日', '新政', '政策', '法规', '海关', '认证', '关税', '峰会', '大会', '论坛', '报名', '榜单', '报告', '发布', '数据', '统计', '战报', '黑五', '网一', 'prime', '招商', '活动', '倒计时', '预告', '官宣', '获奖', '融资', '收购', '上市'];
const TIP_WORDS = ['技巧', '方法', '实操', '避坑', '攻略', '案例', '拆解', '复盘', '指南', '教程', '打法', '策略', '工具', '选品', '广告', 'listing', '优化', '爆单', '测评', '干货', '经验', '套路', '排查', '申诉', '关键词', '转化', '流量', 'seo', 'tiktok', '亚马逊', '跨境', 'shopee', '物流', '仓储', 'fba', '海外仓', '店铺', '运营', '直播', '短视频', '内容', '素材', '红人', '达人', '打法', '冷启动', '测款', '跟卖', 'review', '评论', '退货', '仓储费', '补货', '断货', '利润', '定价', 'roi', 'acos', 'ppc', '投流', '矩阵', '起号', '养号', '封号', '风控', '合规', '侵权', 'tro', '专利', '商标'];
const AI_WORDS = ['ai', '人工智能', 'chatgpt', 'gpt', 'deepseek', 'claude', 'midjourney', 'sd ', '提示词', 'prompt', '生成', '模型', '智能体', 'agent', '自动化', 'aigc', '数字人', '大模型', 'ai绘画', 'ai视频', 'ai文案', 'ai工具', 'ai效率', 'ai写作', 'ai设计', 'ai客服'];

function classifyTitle(title) {
  const t = String(title || '').toLowerCase();
  if (NEWS_WORDS.some((w) => t.includes(w))) return 'news';
  const isAi = AI_WORDS.some((w) => t.includes(w));
  const isTip = TIP_WORDS.some((w) => t.includes(w));
  if (isAi) return 'ai-tip';
  if (isTip) return 'op-tip';
  return 'news';
}

// ===== 抓取源解析 =====
function parseAmz123(html) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]*href="https?:\/\/www\.amz123\.com\/t\/[A-Za-z0-9]+"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const tm = tag.match(/title="([^"]+)"/) || tag.match(/data-sdk-resource-id="([^"]+)"/);
    let title = tm ? decodeEntities(tm[1]) : '';
    if (!title || title.length < 8 || seen.has(title)) continue;
    seen.add(title);
    const url = tag.match(/href="([^"]+)"/)[1];
    out.push({ title, source: 'AMZ123', url, date: todayCN() });
  }
  return out.slice(0, 18);
}

function parseTt123(html) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]*href="https?:\/\/www\.tt123\.com\/t\/[A-Za-z0-9]+"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const tm = tag.match(/title="([^"]+)"/);
    let title = tm ? decodeEntities(tm[1]) : '';
    if (!title || title.length < 8 || seen.has(title)) continue;
    seen.add(title);
    const url = tag.match(/href="([^"]+)"/)[1];
    out.push({ title, source: 'TT123', url, date: todayCN() });
  }
  return out.slice(0, 14);
}

// ===== GitHub 读写 content-tips.json =====
async function readTips(env) {
  const token = getGithubToken(env);
  try {
    const resp = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' }
    });
    if (!resp.ok) {
      // 文件尚不存在则视为空库
      if (resp.status === 404) return { items: [], sha: null };
      return { items: [], sha: null, error: 'HTTP ' + resp.status };
    }
    const data = await resp.json();
    const content = JSON.parse(atob(data.content));
    return { items: Array.isArray(content.items) ? content.items : [], sha: data.sha };
  } catch (e) {
    return { items: [], sha: null, error: e.message };
  }
}

async function writeTips(env, items, sha) {
  const token = getGithubToken(env);
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify({ items }, null, 2))));
  let curSha = sha;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'PUT',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'xinzhihai-pages' },
        body: JSON.stringify({ message: `保鲜入库 ${new Date().toISOString()}`, content, sha: curSha })
      });
      if (resp.ok) return true;
      let errBody = {};
      try { errBody = await resp.json(); } catch (_) {}
      if (resp.status === 409 || (errBody.message || '').toLowerCase().includes('sha')) {
        const latest = await readTips(env);
        if (latest.sha) curSha = latest.sha;
      }
      const retryable = resp.status >= 500 || (resp.status === 403 && /timed out|rule/i.test(errBody.message || ''));
      if (!retryable) return false;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return false;
}

function cors(respInit) {
  return Object.assign({}, respInit, { headers: Object.assign({}, CORS, respInit.headers || {}) });
}

// GET：查看当前已入库保鲜内容（供面板展示最近条目）
export async function onRequestGet(context) {
  const { env } = context;
  const { items } = await readTips(env);
  const recent = items.slice(0, 30);
  return new Response(JSON.stringify({ ok: true, total: items.length, items: recent, fetchedAt: new Date().toISOString() }), cors({}));
}

// POST：一键自运行「抓取 → 分类 → 去重 → 入库」（前端直接 POST /api/content/fresh 触发）
export async function onRequestPost(context) {
  const { env } = context;

  // 1) 抓取候选（并行双源，各自 6s 超时，整体限时兜底）
  const raw = [];
  const seenRaw = new Set();
  const push = (list) => {
    for (const it of list) {
      const key = normTitle(it.title);
      if (!key || seenRaw.has(key)) continue;
      seenRaw.add(key);
      raw.push(it);
    }
  };
  const jobs = [
    { name: 'amz123', fn: async () => {
      const r = await fetch('https://www.amz123.com/zb', { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: timeoutSignal(6000) });
      if (!r.ok) throw new Error('amz123 ' + r.status);
      return parseAmz123(await r.text());
    } },
    { name: 'tt123', fn: async () => {
      const r = await fetch('https://www.tt123.com/', { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: timeoutSignal(6000) });
      if (!r.ok) throw new Error('tt123 ' + r.status);
      return parseTt123(await r.text());
    } }
  ];
  const settled = await Promise.allSettled(jobs.map((j) => j.fn().then((list) => push(list))));
  const failed = [];
  settled.forEach((s, i) => { if (s.status === 'rejected') failed.push(jobs[i].name); });

  if (raw.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: '本次抓取失败，请稍后重试', items: [], failed }), cors({ status: 502 }));
  }

  // 2) 分类：只保留 运营技巧/ai技巧 干货
  const tips = raw.map((it) => ({ ...it, kind: classifyTitle(it.title) }))
    .filter((it) => it.kind !== 'news');

  // 3) 去重：与已入库库对比（标题归一化指纹）
  const { items, sha } = await readTips(env);
  const known = new Set(items.map((it) => it.normKey || normTitle(it.title)));
  const fresh = [];
  const skipped = [];
  for (const it of tips) {
    const key = normTitle(it.title);
    if (known.has(key)) { skipped.push(it.title); continue; }
    known.add(key);
    fresh.push({
      title: it.title,
      category: it.kind === 'ai-tip' ? 'AI技巧' : '运营技巧',
      summary: '',
      source: it.source,
      url: it.url,
      date: it.date,
      normKey: key,
      addedAt: new Date().toISOString()
    });
  }

  let saved = false;
  if (fresh.length > 0) {
    const merged = fresh.concat(items).slice(0, 400); // 库上限400条，最新在前
    saved = await writeTips(env, merged, sha);
  }

  return new Response(JSON.stringify({
    ok: true,
    fetched: raw.length,
    classified: tips.length,
    added: fresh.length,
    skipped: skipped.length,
    saved,
    items: fresh.slice(0, 20),
    failed,
    fetchedAt: new Date().toISOString()
  }), cors({}));
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
