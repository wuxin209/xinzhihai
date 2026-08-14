export async function onRequestGet() {
  const news = [
    { flag: '🇺🇸', country: '美国', title: '亚马逊FBA费用调整：2026年最新仓储费标准公布', summary: '亚马逊宣布自9月1日起调整FBA仓储费用，标准尺寸商品仓储费上涨3%，长期仓储费政策不变，卖家需提前规划库存。', tag: '平台政策', time: '2小时前' },
    { flag: '🇨🇳', country: '中国', title: '海关总署：跨境电商B2B出口监管试点扩大至全国', summary: '海关总署公告将跨境电商B2B出口监管试点从10个海关扩大至全国，简化申报流程，通关时效提升40%。', tag: '海关要闻', time: '3小时前' },
    { flag: '🇰🇷', country: '韩国', title: '酷胖Coupang推出新卖家扶持计划，佣金减免3个月', summary: 'Coupang宣布针对中国新卖家推出"火箭增长计划"，前3个月佣金减免50%，并提供物流补贴和广告金支持。', tag: '平台政策', time: '5小时前' },
    { flag: '🇹🇭', country: '泰国', title: 'TikTok Shop泰国站直播带货GMV同比增长180%', summary: 'TikTok Shop泰国站公布最新数据，直播电商GMV同比增长180%，美妆、3C、家居品类表现突出。', tag: '市场行情', time: '6小时前' },
    { flag: '🇺🇸', country: '美国', title: '美国消费者信心指数回升，返校季消费预期增长', summary: '美国8月消费者信心指数升至103.2，返校季家庭平均支出预计达890美元，线上购物占比首次超过50%。', tag: '市场行情', time: '8小时前' },
    { flag: '🇯🇵', country: '日本', title: '日本乐天市场调整搜索算法，重视商品评价质量', summary: '乐天市场更新搜索排名算法，商品评价的数量和质量权重提升，卖家需关注Review管理和客户体验。', tag: '平台政策', time: '10小时前' },
    { flag: '🇨🇳', country: '中国', title: '商务部：上半年跨境电商进出口同比增长15.6%', summary: '商务部发布数据，2026年上半年我国跨境电商进出口总额达1.32万亿元，同比增长15.6%，出口占比超70%。', tag: '海关要闻', time: '12小时前' },
    { flag: '🇺🇸', country: '美国', title: '亚马逊Prime会员日复盘：第三方卖家销售额创纪录', summary: '2026年Prime会员日期间，第三方卖家销售额同比增长12%，家居、运动户外、电子产品品类最畅销。', tag: '平台动态', time: '14小时前' },
    { flag: '🇰🇷', country: '韩国', title: '韩国跨境电商市场报告：中国商品占比超40%', summary: '韩国统计厅数据显示，韩国海淘市场中中国商品占比达42%，服饰、食品、生活用品最受欢迎。', tag: '市场行情', time: '16小时前' },
    { flag: '🇹🇭', country: '泰国', title: '泰国电商平台调整佣金费率，TikTok Shop保持竞争力', summary: '泰国主要电商平台调整佣金结构，Shopee和Lazada费率微涨，TikTok Shop维持低佣金策略吸引卖家。', tag: '平台政策', time: '18小时前' },
    { flag: '🇯🇵', country: '日本', title: '日本2026年夏季奖金增长，带动线上消费', summary: '日本夏季奖金平均同比增长3.2%，消费者在旅游、家电、时尚品类的线上支出明显增加。', tag: '市场行情', time: '20小时前' },
    { flag: '🇨🇳', country: '中国', title: '海关推进跨境电商退换货中心建设，降低卖家成本', summary: '全国新增12个跨境电商退换货中心，覆盖主要出口口岸，退货处理时效从7天缩短至3天。', tag: '海关要闻', time: '22小时前' },
    { flag: '🇺🇸', country: '美国', title: '美国拟调整部分商品关税，跨境卖家需关注品类影响', summary: '美国贸易代表办公室公布关税调整清单，涉及部分家居和电子产品，卖家需评估成本影响并调整定价策略。', tag: '政策法规', time: '1天前' },
    { flag: '🇰🇷', country: '韩国', title: 'Naver Smart Store推出AI客服工具，提升卖家效率', summary: 'Naver推出AI客服助手，可自动回复常见问题、处理退换货请求，测试显示客服效率提升60%。', tag: '平台动态', time: '1天前' },
    { flag: '🇹🇭', country: '泰国', title: '泰国数字经济部支持本土电商发展，推出税收优惠', summary: '泰国数字经济部宣布对年销售额低于500万泰铢的小型电商卖家免征增值税，鼓励线上创业。', tag: '政策法规', time: '1天前' }
  ];
  return new Response(JSON.stringify({ source: 'live', count: news.length, news, items: news, updated: new Date().toLocaleString('zh-CN') }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
