function getKey(context) {
  return context.env.DEEPSEEK_API_KEY || '';
}

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
    signal: AbortSignal.timeout(25000)
  });
  if (!resp.ok) throw new Error('DeepSeek API error: ' + resp.status);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

function fallbackResult(product, category, site, sellingPoints) {
  const t = TPL[category] || TPL['其他'];
  const isTiktok = site.includes('TikTok') || site.includes('tiktok') || site.includes('东南亚');
  let points = [...t.points];
  if (sellingPoints) {
    const extra = sellingPoints.split(/[,，\n]/).filter(Boolean).slice(0, 2).map(s => s.trim());
    if (extra.length) points.splice(0, extra.length, ...extra);
  }
  if (isTiktok) {
    return { source: 'template', siteType: 'tiktok',
      tiktokTitle: product + '真实测评，看完再买 #好物推荐',
      script30s: '家人们！这个' + product + '真的绝了！' + points.slice(0,2).join('，') + '。点击小黄车，现在有活动！',
      script60s: '家人们今天给大家测评' + product + '。' + points.join(' ') + '现在直播间有活动，点击小黄车手慢无！',
      storyboard: [
        { time: '0-3s', shot: '特写产品+夸张表情', line: '这个' + product + '太绝了！' },
        { time: '3-15s', shot: '开箱展示', line: points.slice(0,2).join('，') },
        { time: '15-30s', shot: '使用演示', line: points.slice(2,4).join('，') },
        { time: '30-45s', shot: '细节特写', line: points[4] },
        { time: '45-60s', shot: '引导下单', line: '点击小黄车，现在有活动！' }
      ],
      hashtags: ['#好物推荐','#跨境好物','#开箱测评','#种草','#必买清单'],
      titles: [product + '真实测评', '被问爆的' + product, product + '值不值得买'],
      fivePoints: points, description: points.join(' ') };
  }
  return { source: 'template', siteType: 'amazon',
    amazonTitle: product + ' - ' + t.kw.split(' ')[0] + ' Premium Quality, ' + points[0].slice(0,30),
    bulletPoints: points.map((p,i) => ['✓','★','◆','●','▶'][i] + ' ' + p),
    description: '<h2>' + product + '</h2><p>' + points.join('</p><p>') + '</p>',
    searchTerms: t.kw,
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
    const apiKey = getKey(context);

    let aiResult;
    if (apiKey) {
      try {
        if (isTiktok) {
          const prompt = '你是跨境电商TikTok短视频运营专家。请为产品"' + product + '"（类目：' + category + '，站点：' + site + '，卖点：' + (sellingPoints || '无') + '）生成TikTok带货内容。严格按JSON返回（不要markdown）：{"tiktokTitle":"标题20字内","script30s":"30秒口播","script60s":"60秒口播","storyboard":[{"time":"0-3s","shot":"镜头","line":"台词"}],"hashtags":["#标签"]}';
          const content = await callDeepSeek(apiKey, [{role:'user',content:prompt}]);
          const jsonStr = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
          aiResult = JSON.parse(jsonStr);
          aiResult.source = 'deepseek'; aiResult.siteType = 'tiktok';
          aiResult.titles = [aiResult.tiktokTitle];
          aiResult.fivePoints = (TPL[category]||TPL['其他']).points;
          aiResult.description = aiResult.script60s;
        } else {
          const prompt = '你是跨境电商' + siteName + 'Listing优化专家。请为产品"' + product + '"（类目：' + category + '，卖点：' + (sellingPoints || '无') + '）生成Listing内容。严格按JSON返回（不要markdown）：{"amazonTitle":"标题150字符内","bulletPoints":["五点1","五点2","五点3","五点4","五点5"],"description":"HTML描述A+风格","searchTerms":"后台搜索词空格分隔"}';
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
  return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
  });
}
