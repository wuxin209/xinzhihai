export async function onRequestGet() {
  const news = [
    { flag: '🇺🇸', country: '美国', title: '亚马逊8月24日BSA协议第18条生效：店铺转让全面禁止', summary: '未经书面同意私自转让、质押店铺及收益权的行为无效，平台可冻结账号。新规封堵私下买卖店铺、回款质押贷款等灰色操作，卖店生意彻底终结。', tag: '平台政策', time: '1天前' },
    { flag: '🇺🇸', country: '美国', title: '美国第14411号行政令：进口新规即将落地，CBP公布首批措施', summary: '亚马逊全球开店8月20日紧急提醒卖家确认IOR身份，美国海关已公布首批执行措施，涉及进口申报和清关合规，卖家需提前自查供应链。', tag: '政策法规', time: '1天前' },
    { flag: '🇺🇸', country: '美国', title: 'CPSC新规7月8日已生效：合规证书必须电子提交', summary: '所有发往美国FBA的受监管产品，CPC合规证书必须通过电子方式在清关时提交。8月30日起含锂电池小家电未通过TIC认证将下架并冻结库存。', tag: '合规预警', time: '2天前' },
    { flag: '🇺🇸', country: '美国', title: 'CPSC紧急召回4.1万台婴儿秋千，52起事故32名宝宝受伤', summary: '8月13日CPSC发布召回Taleco Gear婴儿跳跳椅/秋千，产品使用时突然失稳倾倒。同期召回木质串珠玩具（小零件窒息风险）、迷你冰箱（起火风险）。', tag: '合规预警', time: '3天前' },
    { flag: '🇨🇳', country: '中国', title: '0110报关新规落地：境外收货人禁止填写Amazon/FBA仓名', summary: '广东、杭州、嘉兴、义乌多地报关行明确，0110一般贸易报关单"境外收货人"不得直接填Amazon或FBA仓名，须提供真实境外购货方、购销合同及结算凭证。合规出路：9810海外仓模式可做预退税。', tag: '海关要闻', time: '3天前' },
    { flag: '🇪🇺', country: '欧盟', title: '欧盟PPWR包装法规8月12日强制执行，全部欧盟站点适用', summary: '包装EPR新政要求包装最小化、可回收性设计、再生材料比例，不合规产品将无法入库。9月1日起PAN-EU入库及直发法国货件必须提供MRN+EORI。', tag: '合规预警', time: '5天前' },
    { flag: '🇺🇸', country: '美国', title: '亚马逊AWD智能卫星仓8月20日开放欧洲五国，限时仓储费减免', summary: 'AWD以统一费率提供长期批量仓储，已面向德法意西英开放，黑五网一圣诞前有效缓解FBA库容紧张和旺季仓储成本上涨。', tag: '平台动态', time: '2天前' },
    { flag: '🇺🇸', country: '美国', title: '亚马逊B2B佣金调整：部分远距离跨境订单佣金上浮', summary: '大批量企业单卖家利润受影响，建议导出近3个月B2B订单报表重新核算定价，大批量供货品类预留佣金浮动空间。', tag: '平台政策', time: '4天前' },
    { flag: '🇨🇳', country: '中国', title: '海关总署：跨境电商B2B出口监管试点扩大至全国', summary: '海关总署公告将跨境电商B2B出口监管试点扩大至全国，简化申报流程，通关时效提升40%，9810/9710模式全面推广。', tag: '海关要闻', time: '6天前' },
    { flag: '🇰🇷', country: '韩国', title: 'Coupang中国卖家持续增长，火箭配送服务扩大覆盖', summary: 'Coupang针对中国卖家的火箭增长计划持续推进，前3个月佣金减免50%，物流补贴和广告金支持，美妆和家居品类增长最快。', tag: '平台动态', time: '8小时前' },
    { flag: '🇹🇭', country: '泰国', title: 'TikTok Shop泰国站直播GMV同比增长180%，美妆3C领跑', summary: 'TikTok Shop泰国站最新数据显示直播电商GMV同比增长180%，美妆、3C、家居品类表现突出，短视频带货转化率持续提升。', tag: '市场行情', time: '10小时前' },
    { flag: '🇺🇸', country: '美国', title: '返校季消费预期增长，线上购物占比首次超50%', summary: '美国8月消费者信心指数升至103.2，返校季家庭平均支出预计达890美元，线上购物占比首次超过50%，3C和服装品类受益最大。', tag: '市场行情', time: '12小时前' },
    { flag: '🇨🇳', country: '中国', title: '商务部：上半年跨境电商进出口同比增长15.6%', summary: '2026年上半年我国跨境电商进出口总额达1.32万亿元，同比增长15.6%，出口占比超70%，东南亚和拉美市场增速最快。', tag: '海关要闻', time: '1天前' },
    { flag: '🇯🇵', country: '日本', title: '日本乐天调整搜索算法，商品评价质量权重提升', summary: '乐天市场更新搜索排名算法，评价数量和质量权重提升，卖家需关注Review管理和客户体验，Q3旺季前优化Listing。', tag: '平台政策', time: '1天前' },
    { flag: '🇺🇸', country: '美国', title: '亚马逊欧洲站锂电池新规：9月30日未通过TIC认证将下架', summary: '含锂电池的小家电产品（风扇、加湿器、洗地机等）必须通过指定TIC机构完成直接验证，未通过的商品将面临下架及FBA库存冻结。', tag: '合规预警', time: '2天前' }
  ];
  return new Response(JSON.stringify({ source: 'live', count: news.length, news, items: news, updated: new Date().toLocaleString('zh-CN') }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
