const TPL = {
  '家居': {
    amazon: { kw: '家居收纳 厨房神器 居家好物', points: ['材质厚实做工精细，质感满满，用十年都不变形','安装简单5分钟搞定，免打孔不伤墙','实用又好看，朋友来都问链接','性价比超高，同价位找不到对手','细节到位设计贴心，每个角落都考虑到'] },
    tiktok: { hooks: ['你家是不是也缺一个这样的{product}？','别再乱买了，{product}选这款就对了','租房党必看！这个{product}太绝了'], tags: ['#家居好物','#租房改造','#生活神器','#居家必备','#好物分享'] }
  },
  '3C': {
    amazon: { kw: '电子产品 数码配件 充电线 手机壳', points: ['性能强劲日常使用丝滑流畅，不卡顿不闪退','续航持久一天一充无压力，出差旅行必备','做工精致手感一流，细节见品质','性价比高同价位首选，比大牌便宜一半','售后有保障，30天无理由退换'] },
    tiktok: { hooks: ['{product}到底值不值得买？今天实测告诉你','用了一个月{product}，说几句真心话','别被参数骗了，{product}真实体验分享'], tags: ['#3C数码','#好物测评','#科技好物','#数码分享','#开箱'] }
  },
  '美妆': {
    amazon: { kw: '护肤品 化妆品 美妆工具 面膜', points: ['质地清爽不油腻，吸收快不搓泥','成分安全温和，敏感肌也能用','效果肉眼可见，坚持28天有惊喜','包装精致送人自用两相宜','性价比高学生党也能冲'] },
    tiktok: { hooks: ['姐妹们这个{product}我真的按头安利','无广实测！{product}到底值不值得买','用空三瓶{product}，来说句公道话'], tags: ['#美妆分享','#护肤好物','#无广测评','#变美日记','#好物推荐'] }
  },
  '服饰': {
    amazon: { kw: '女装 男装 休闲服饰 运动装', points: ['面料舒适透气，夏天穿不闷汗','版型显瘦遮肉，微胖姐妹放心冲','百搭款怎么穿都好看，一件搭五套','做工精细没有多余线头，走线工整','尺码标准按推荐码买不踩雷'] },
    tiktok: { hooks: ['这件{product}穿上同事都问链接','微胖女生的福音！{product}太显瘦了','平价穿出高级感，{product}绝了'], tags: ['#穿搭分享','#显瘦穿搭','#平价好物','#每日穿搭','#OOTD'] }
  },
  '母婴': {
    amazon: { kw: '婴儿用品 母婴 宝宝玩具 儿童', points: ['材质安全食品级，宝宝啃咬也放心','设计贴心宝妈操作方便，单手可开','实用性强每天都在用，带娃神器','易清洗好打理，开水烫不变形','性价比高养娃省钱利器'] },
    tiktok: { hooks: ['宝妈们这个{product}真的早买早享受','带娃两年，{product}是我买过最实用的','别再交智商税了，{product}才是真神器'], tags: ['#母婴好物','#带娃日常','#宝妈分享','#育儿神器','#新手妈妈'] }
  },
  '运动': {
    amazon: { kw: '运动健身 瑜伽 户外 跑步装备', points: ['专业级品质运动表现提升明显','舒适度高长时间使用不累不闷','耐用性强用了半年还跟新的一样','设计科学保护关节预防受伤','性价比高比健身房办卡划算多了'] },
    tiktok: { hooks: ['运动党集合！这个{product}真的香','教练让我买的{product}，果然没骗我','用了三个月{product}，说说真实感受'], tags: ['#运动健身','#健身好物','#居家健身','#运动装备','#减脂'] }
  },
  '食品': {
    amazon: { kw: '零食 特产 美食 休闲食品', points: ['真材实料味道正宗，老师傅手艺','配料干净无添加，老人小孩放心吃','独立包装方便携带，随拆随吃','价格实惠比超市便宜一半','全家都爱吃已回购N次'] },
    tiktok: { hooks: ['这个{product}我能吃一辈子','别买！我怕你吃了停不下来','全网吹爆的{product}，真有那么好吃？'], tags: ['#美食分享','#零食推荐','#吃货日常','#好物分享','#开箱测评'] }
  },
  '其他': {
    amazon: { kw: '日用品 生活好物 创意礼品', points: ['品质超出预期物超所值','实用性强日常必备','设计合理使用方便','做工精细细节到位','价格合理值得入手'] },
    tiktok: { hooks: ['这个{product}真的被低估了','用了两周{product}，来说说感受','{product}开箱：这个价位绝了'], tags: ['#好物分享','#生活好物','#开箱','#种草','#推荐'] }
  }
};

const AMAZON_SITES = ['亚马逊美国', '亚马逊澳洲', '亚马逊日本', '韩国酷胖', 'Coupang'];

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { product = '这款产品', category = '其他', site = '亚马逊美国', sellingPoints = '' } = body;
    const t = TPL[category] || TPL['其他'];
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const isAmazon = AMAZON_SITES.some(s => site.includes(s.replace('亚马逊','')) || site.includes(s));
    const isTiktok = site.includes('TikTok') || site.includes('tiktok') || site.includes('东南亚');

    let extraPoints = [];
    if (sellingPoints) {
      extraPoints = sellingPoints.split(/[,，\n]/).filter(Boolean).slice(0, 2).map(s => s.trim());
    }

    let result;
    if (isTiktok) {
      // TikTok风格
      const hook = pick(t.tiktok.hooks).replace(/{product}/g, product);
      const points = extraPoints.length > 0 ? extraPoints : t.amazon.points.slice(0, 3);
      result = {
        source: 'template',
        siteType: 'tiktok',
        tiktokTitle: `${hook.replace('？','').replace('！','')} #好物推荐`,
        script30s: `${hook} 今天给大家推荐${product}，${points.join('，')}。现在点击小黄车，价格很美丽，赶紧冲！`,
        script60s: `${hook} 大家好，今天给大家详细测评${product}。第一，${t.amazon.points[0]}；第二，${t.amazon.points[1]}；第三，${t.amazon.points[2]}。我自己用了一段时间，真的觉得很值。${extraPoints.length ? '特别是' + extraPoints.join('，') + '。' : ''}现在直播间有活动，点击下方小黄车，手慢无！`,
        storyboard: [
          { time: '0-3s', shot: '特写产品+夸张表情钩子', line: hook, subtitle: hook },
          { time: '3-10s', shot: '开箱/产品展示', line: `就是这个${product}！`, subtitle: `${product}开箱` },
          { time: '10-25s', shot: '使用演示+效果展示', line: points.join('，'), subtitle: '真实使用效果' },
          { time: '25-40s', shot: '细节特写+对比', line: t.amazon.points.slice(2,4).join('，'), subtitle: '细节拉满' },
          { time: '40-55s', shot: '使用前后对比+总结', line: `真心推荐，${t.amazon.points[4]}`, subtitle: '闭眼入不踩雷' },
          { time: '55-60s', shot: '指向小黄车+催促', line: '点击小黄车，现在有活动！', subtitle: '⬇️点击购买⬇️' }
        ],
        hashtags: t.tiktok.tags,
        // 兼容字段
        titles: [`${hook}`, `${product}真实测评，看完再买`, `被问爆的${product}到底好不好用`],
        fivePoints: t.amazon.points,
        description: `${hook} ${t.amazon.points.join(' ')}`
      };
    } else {
      // 亚马逊风格
      const points = [...t.amazon.points];
      if (extraPoints.length > 0) points.splice(0, extraPoints.length, ...extraPoints);
      const siteName = site.includes('酷胖') || site.includes('Coupang') ? 'Coupang' : 'Amazon';
      result = {
        source: 'template',
        siteType: 'amazon',
        amazonTitle: `${product} - ${t.amazon.kw.split(' ')[0]} ${t.amazon.kw.split(' ')[1] || ''} | Premium Quality, ${extraPoints[0] || points[0].slice(0,20)}`,
        bulletPoints: points.map((p, i) => `${['✓','★','◆','●','▶'][i]} ${p}`),
        description: `<h2>${product} - 品质之选</h2><p>${points.join('</p><p>')}</p><p><strong>为什么选择我们？</strong>我们专注品质，每一件产品都经过严格质检。${extraPoints.length ? '产品亮点：' + extraPoints.join('；') : ''}现在下单，享受${siteName}快速配送，30天无理由退换！</p>`,
        searchTerms: t.amazon.kw,
        // 兼容字段
        titles: [
          `${product} - Premium Quality ${t.amazon.kw.split(' ')[0]}`,
          `${product} for ${category} - ${extraPoints[0] || points[0].slice(0,15)}`,
          `Best ${product} ${new Date().getFullYear()} - ${points[0].slice(0,20)}`
        ],
        fivePoints: points,
        script30s: `大家好，今天推荐${product}。${points.slice(0,2).join(' ')} 在${siteName}搜索即可购买。`,
        script60s: `大家好，今天给大家介绍${product}。${points.join(' ')} 现在${siteName}上有优惠，品质保证，放心购买。`,
        storyboard: [
          { time: '0-3s', shot: '产品主图+品牌Logo', line: `${product} - 品质之选` },
          { time: '3-15s', shot: '产品细节360度展示', line: points.slice(0,2).join(' ') },
          { time: '15-30s', shot: '使用场景演示', line: points.slice(2,4).join(' ') },
          { time: '30-45s', shot: '包装+配件展示', line: points[4] },
          { time: '45-60s', shot: '品牌信息+购买引导', line: `在${siteName}搜索${product}，立即下单！` }
        ]
      };
    }
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ source: 'fallback', error: e.message }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
  });
}
