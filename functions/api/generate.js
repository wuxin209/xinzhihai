import { getDeepSeekKey } from './_config.js';

const TPL = {
  '家居': { kw: '家居收纳 厨房神器 居家好物', points: ['材质厚实做工精细，质感满满','安装简单5分钟搞定','实用又好看，朋友来都问链接','性价比超高，同价位首选','细节到位设计贴心'] },
  '3C': { kw: '电子产品 数码配件 充电线 手机壳', points: ['性能强劲日常使用丝滑流畅','续航持久一天一充无压力','做工精致手感一流','性价比高同价位首选','售后有保障放心买'] },
  '美妆': { kw: '护肤品 化妆品 美妆工具 面膜', points: ['质地清爽不油腻吸收快','成分安全温和敏感肌可用','效果肉眼可见','包装精致送人自用两相宜','性价比高学生党也能冲'] },
  '服饰': { kw: '女装 男装 休闲服饰 运动装', points: ['面料舒适透气不闷汗','版型显瘦遮肉','百搭款怎么穿都好看','做工精细没有多余线头','尺码标准不踩雷'] },
  '母婴': { kw: '婴儿用品 母婴 宝宝玩具 儿童', points: ['材质安全食品级','设计贴心宝妈操作方便','实用性强每天都在用','易清洗好打理','性价比高养娃省钱'] },
  '运动': { kw: '运动健身 瑜伽 户外 跑步装备', points: ['专业级品质运动表现提升','舒适度高长时间不累','耐用性强用半年如新','设计科学保护关节','性价比高比办卡划算'] },
  '食品': { kw: '零食 特产 美食 休闲食品', points: ['真材实料味道正宗','配料干净无添加','独立包装方便携带','价格实惠比超市便宜','全家都爱吃已回购'] },
  '其他': { kw: '日用品 生活好物 创意礼品', points: ['品质超出预期','实用性强日常必备','设计合理使用方便','做工精细细节到位','价格合理值得入手'] }
};

async function callDeepSeek(apiKey, messages) {
  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.7, max_tokens: 2000 }),
    signal: AbortSignal.timeout(20000)
  });
  if (!resp.ok) throw new Error('DeepSeek error: ' + resp.status);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

function fallbackResult(product, category, site, sellingPoints) {
  const t = TPL[category] || TPL['其他'];
  const isTiktok = site.includes('TikTok') || site.includes('tiktok') || site.includes('东南亚');
  let points = [...t.points];
  if (sellingPoints) {
    const extra = sellingPoints.split(/[,，\n]/).filter(Boolean).map(s => s.trim()).filter(Boolean);
    if (extra.length) points = [...extra.slice(0, 4), ...points.filter(p => !extra.includes(p))].slice(0, 5);
  }
  if (isTiktok) {
    const p1 = points[0] || '', p2 = points[1] || '', p3 = points[2] || '', p4 = points[3] || '', p5 = points[4] || '';
    return { source: 'template', siteType: 'tiktok',
      tiktokTitle: product + '值不值？' + p1.slice(0, 8) + '，看完再决定',
      script30s: '别急着买' + product + '，先说重点：' + p1 + '；' + p2 + '。这个价格能拿到这样的品质，' + product + '可以闭眼入，小黄车已挂。',
      script60s: '今天讲清楚' + product + '值不值得买。第一，' + p1 + '；第二，' + p2 + '；第三，' + p3 + '。如果你是' + (category === '家居' ? '在租房/刚装修' : category === '3C' ? '数码党/通勤族' : category === '美妆' ? '学生党/上班族' : category === '服饰' ? '日常通勤/约会' : category === '母婴' ? '宝妈/新手爸妈' : category === '运动' ? '健身/户外爱好者' : '注重性价比') + '，这个' + product + '就是为你准备的。现在下单有活动，小黄车直接拍。',
      storyboard: [
        { time: '0-3s', shot: '产品正面特写+口播开场', line: '别急着买' + product + '，先说重点。' },
        { time: '3-15s', shot: '产品/细节实拍，配合展示', line: p1 + '。' + p2 + '。' },
        { time: '15-30s', shot: '上手使用/场景演示', line: p3 + '，用起来是这样。' },
        { time: '30-45s', shot: '对比/细节放大展示', line: p4 + '。' + p5 + '。' },
        { time: '45-60s', shot: '价格+优惠收尾，指向小黄车', line: '现在下单有活动，小黄车直接拍。' }
      ],
      hashtags: ['#' + (category === '3C' ? '数码好物' : category === '美妆' ? '美妆测评' : category === '服饰' ? '穿搭好物' : category === '母婴' ? '母婴好物' : category === '运动' ? '健身好物' : '居家好物'), '#开箱测评', '#好物推荐', '#种草', '#跨境好物'],
      titles: [product + '值不值得买', product + '真实测评', '被问爆的' + product],
      fivePoints: points, description: points.join('；') };
  }
  return { source: 'template', siteType: 'amazon',
    amazonTitle: product + ' - ' + t.kw.split(' ')[0] + ' Premium Quality, ' + points[0].slice(0,30),
    bulletPoints: points.map((p,i) => ['✓','★','◆','●','▶'][i] + ' ' + p),
    description: '<h2>' + product + '</h2><p>' + points.join('</p><p>') + '</p>',
    searchTerms: (t.kw.split(' ')[0] + ' ' + product.split(' ')[0] + ' ' + t.kw.split(' ').slice(1).join(' ')).trim(),
    titles: [product + ' - Premium ' + t.kw.split(' ')[0], 'Best ' + product + ' ' + new Date().getFullYear()],
    fivePoints: points,
    script30s: 'Introducing ' + product + '. ' + points.slice(0,2).join(' '),
    script60s: 'Today let\'s review ' + product + '. ' + points.join(' '),
    storyboard: [
      { time: '0-3s', shot: '产品主图', line: product + ' - Premium Quality' },
      { time: '3-15s', shot: '细节展示', line: points.slice(0,2).join(' ') },
      { time: '15-30s', shot: '使用场景', line: points.slice(2,4).join(' ') },
      { time: '30-45s', shot: '包装展示', line: points[4] },
      { time: '45-60s', shot: '购买引导', line: 'Search ' + product + ' on Amazon!' }
    ] };
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { product = '这款产品', category = '其他', site = '亚马逊美国站', sellingPoints = '' } = body;
    const isTiktok = site.includes('TikTok') || site.includes('tiktok') || site.includes('东南亚');
    const isCoupang = site.includes('酷胖') || site.includes('Coupang');
    const siteName = isCoupang ? 'Coupang' : isTiktok ? 'TikTok Shop' : 'Amazon';
    const apiKey = getDeepSeekKey(context.env);

    let aiResult;
    if (apiKey) {
      try {
        if (isTiktok) {
          const prompt = '你是跨境电商TikTok短视频运营专家。为产品"' + product + '"（类目：' + category + '，站点：' + site + '，核心卖点：' + (sellingPoints || '无') + '）创作带货脚本。硬性要求：1) 口播必须全程紧扣产品本身：开头3秒用产品名+痛点钩子，中段自然说出2-3个具体卖点（优先用提供的卖点原话，没有则按品类常识展开），结尾用价格/优惠/小黄车引导转化，禁止"家人们真的绝了""太好用了"这类空泛套话；2) storyboard 每段shot写具体拍摄画面（产品特写/使用场景/对比演示），line必须是能直接念的完整台词；3) 标题20字内要带产品名或品类词。严格按JSON返回（不要markdown）：{"tiktokTitle":"标题","script30s":"30秒口播","script60s":"60秒口播","storyboard":[{"time":"0-3s","shot":"画面","line":"台词"},{"time":"3-15s","shot":"画面","line":"台词"},{"time":"15-30s","shot":"画面","line":"台词"},{"time":"30-45s","shot":"画面","line":"台词"},{"time":"45-60s","shot":"画面","line":"台词"}],"hashtags":["#标签"]}';
          const content = await callDeepSeek(apiKey, [{role:'user',content:prompt}]);
          const jsonStr = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
          aiResult = JSON.parse(jsonStr);
          aiResult.source = 'deepseek'; aiResult.siteType = 'tiktok';
          aiResult.titles = [aiResult.tiktokTitle];
          aiResult.fivePoints = (TPL[category]||TPL['其他']).points;
          aiResult.description = aiResult.script60s;
        } else {
          const prompt = '你是跨境电商' + siteName + ' Listing优化专家。为产品"' + product + '"（类目：' + category + '，核心卖点：' + (sellingPoints || '无') + '）生成Listing。硬性要求：1) 标题必须埋入"品类词+核心卖点词+适用人群/场景"，150字符内，读起来自然不堆砌；2) bulletPoints 每条必须具体可感知（材质/尺寸/功能/使用场景/效果），优先把提供的卖点原话改写成英文表达，禁止空泛形容词堆砌；3) searchTerms 填后台搜索词：品类词+卖点词+同义词+场景词，空格分隔，不含品牌名；4) description 用HTML段落（A+风格），把卖点和场景写成交付给顾客的完整介绍。严格按JSON返回（不要markdown）：{"amazonTitle":"标题","bulletPoints":["五点1","五点2","五点3","五点4","五点5"],"description":"HTML描述","searchTerms":"后台搜索词"}';
          const content = await callDeepSeek(apiKey, [{role:'user',content:prompt}]);
          const jsonStr = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
          aiResult = JSON.parse(jsonStr);
          aiResult.source = 'deepseek'; aiResult.siteType = 'amazon';
          aiResult.titles = [aiResult.amazonTitle];
          aiResult.fivePoints = aiResult.bulletPoints;
          aiResult.script30s = 'Introducing ' + product + '. ' + (aiResult.bulletPoints?.slice(0,2).join(' ') || '');
          aiResult.script60s = (aiResult.description||'').replace(/<[^>]+>/g,'').slice(0,200);
          aiResult.storyboard = [
            { time: '0-3s', shot: '产品主图', line: product + ' - Premium Quality' },
            { time: '3-15s', shot: '细节展示', line: (aiResult.bulletPoints?.[0]||'').slice(0,60) },
            { time: '15-30s', shot: '使用场景', line: (aiResult.bulletPoints?.[1]||'').slice(0,60) },
            { time: '30-45s', shot: '包装展示', line: (aiResult.bulletPoints?.[2]||'').slice(0,60) },
            { time: '45-60s', shot: '购买引导', line: 'Search ' + product + ' on ' + siteName + '!' }
          ];
        }
      } catch (aiErr) {
        aiResult = fallbackResult(product, category, site, sellingPoints);
      }
    } else {
      aiResult = fallbackResult(product, category, site, sellingPoints);
    }
    return new Response(JSON.stringify(aiResult), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    const body = await context.request.json().catch(() => ({}));
    return new Response(JSON.stringify(fallbackResult(body.product, body.category, body.site, body.sellingPoints)), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
export async function onRequestOptions() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
