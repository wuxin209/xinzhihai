const TPL = {
  '家居': { titles: ['这个{product}太绝了！后悔没早买','租房党必入！{product}开箱实测','提升幸福感的{product}，用了就回不去'], points: ['材质厚实，做工精细，质感满满','安装简单，5分钟搞定','实用又好看，朋友来都问链接','性价比超高，同价位无敌','细节到位，设计贴心'], desc: '这款{product}真的是近期买到最满意的家居好物！材质和做工都超出预期，放在家里瞬间提升格调。无论是自用还是送礼都非常合适，强烈推荐！', hooks: ['你家是不是也缺一个这样的{product}？','别再乱买了，{product}选这款就对了','今天给大家分享一个让家变美的秘密武器'] },
  '3C': { titles: ['{product}深度测评：值不值得买？','2026最值得入手的{product}，实测告诉你','{product}使用一个月真实感受'], points: ['性能强劲，日常使用丝滑流畅','续航持久，一天一充无压力','做工精致，手感一流','性价比高，同价位首选','售后有保障，放心买'], desc: '这款{product}我用了一个月，整体表现非常满意。性能、续航、做工都在线，这个价位能有这样的表现真的很惊喜。', hooks: ['{product}到底值不值得买？今天实测告诉你','用了一个月{product}，说几句真心话','别被参数骗了，{product}真实体验分享'] },
  '美妆': { titles: ['{product}真实测评，无广放心看','被问爆的{product}，到底好不好用？','{product}空瓶记：会回购吗？'], points: ['质地清爽不油腻，吸收快','成分安全，敏感肌友好','效果肉眼可见，坚持用有惊喜','包装精致，送人自用两相宜','性价比高，学生党也能冲'], desc: '这款{product}我用了快两个月，来说说真实感受。质地和使用感都很好，效果也确实看得见。成分安全，不用担心刺激皮肤。', hooks: ['姐妹们，这款{product}我真的按头安利','无广实测！{product}到底值不值得买','用空三瓶{product}，来说句公道话'] },
  '服饰': { titles: ['{product}上身效果绝了！','微胖姐妹冲！{product}显瘦10斤','{product}开箱：质感超出价格'], points: ['面料舒适透气，夏天穿不闷','版型显瘦，遮肉效果一流','百搭款，怎么穿都好看','做工精细，没有多余线头','尺码标准，按推荐码买不踩雷'], desc: '这件{product}真的超出预期！面料舒服、版型好、显瘦效果一流，穿上身整个人气质都不一样了。', hooks: ['这件{product}穿上同事都问链接','微胖女生的福音！{product}太显瘦了','平价穿出高级感，{product}绝了'] },
  '母婴': { titles: ['宝妈必看！{product}真实使用感受','{product}值不值得买？宝妈实测','带娃神器{product}，解放双手'], points: ['材质安全，宝宝用着放心','设计贴心，宝妈操作方便','实用性强，每天都在用','易清洗，好打理','性价比高，养娃省钱利器'], desc: '作为一个挑剔的宝妈，这款{product}我真的要给满分。材质安全、设计合理、实用性强，用了之后带娃轻松了很多。', hooks: ['宝妈们，这款{product}真的早买早享受','带娃两年，{product}是我买过最实用的','别再交智商税了，{product}才是真神器'] },
  '运动': { titles: ['{product}实测：运动党必备','健身教练推荐的{product}，真香','{product}使用体验：值不值这个价？'], points: ['专业级品质，运动表现提升明显','舒适度高，长时间使用不累','耐用性强，用了半年还跟新的一样','设计科学，保护到位','性价比高，比健身房办卡划算'], desc: '这款{product}是健身教练推荐给我的，用了之后确实感觉不一样。品质专业、舒适度高、效果明显。', hooks: ['运动党集合！这款{product}真的香','教练让我买的{product}，果然没骗我','用了三个月{product}，说说真实感受'] },
  '食品': { titles: ['{product}开箱：好吃到停不下来','回购N次的{product}，无限囤货','{product}测评：到底好不好吃？'], points: ['真材实料，味道正宗','配料干净，吃得放心','独立包装，方便携带','价格实惠，性价比高','全家都爱吃，已回购多次'], desc: '这款{product}真的太好吃了！第一次买就被惊艳到，味道正宗、用料实在，全家人都爱吃。已经回购好几次了。', hooks: ['这个{product}我能吃一辈子','别买！我怕你吃了停不下来','全网吹爆的{product}，真有那么好吃？'] },
  '其他': { titles: ['{product}开箱实测，惊喜满满','被安利的{product}，用了真香','{product}值不值得买？看完再决定'], points: ['品质超出预期，物超所值','实用性强，日常必备','设计合理，使用方便','做工精细，细节到位','价格合理，值得入手'], desc: '这款{product}整体表现不错，品质和实用性都在线，价格也合理。如果你正好需要这类产品，这款值得考虑。', hooks: ['这款{product}真的被低估了','用了两周{product}，来说说感受','{product}开箱：这个价位绝了'] }
};

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { product = '这款产品', category = '其他', site = '亚马逊美国', sellingPoints = '' } = body;
    const t = TPL[category] || TPL['其他'];
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const titles = t.titles.map(s => s.replace(/{product}/g, product));
    let points = [...t.points];
    if (sellingPoints) {
      const extra = sellingPoints.split(/[,，\n]/).filter(Boolean).slice(0, 2).map(s => s.trim());
      points.splice(0, extra.length, ...extra);
    }
    const result = {
      source: 'template',
      titles,
      fivePoints: points,
      description: t.desc.replace(/{product}/g, product),
      script30s: `${pick(t.hooks).replace(/{product}/g, product)} 大家好，今天给大家推荐${product}。${points.slice(0,3).join(' ')} 现在${site}上有优惠，喜欢的朋友赶紧冲！`,
      script60s: `${pick(t.hooks).replace(/{product}/g, product)} 大家好，今天给大家详细测评${product}。${points.join(' ')} ${t.desc.replace(/{product}/g, product)} 目前在${site}上价格很美丽，点击下方链接看看吧！`,
      storyboard: [
        { time: '0-3s', shot: '特写产品+悬念开场', line: pick(t.hooks).replace(/{product}/g, product) },
        { time: '3-15s', shot: '产品细节展示+使用演示', line: points.slice(0,2).join(' ') },
        { time: '15-30s', shot: '实际使用场景+效果展示', line: points.slice(2,4).join(' ') },
        { time: '30-45s', shot: '对比/测评+总结推荐', line: points[4] },
        { time: '45-60s', shot: '引导下单+平台信息', line: `现在${site}有活动，赶紧下单！` }
      ]
    };
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
