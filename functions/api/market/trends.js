// 爆款趋势接口（市场分析页） /api/market/trends?country=美国&limit=6&refresh=1
// 定位：目标五国（美国/加拿大/日本/韩国/泰国）当下真实流行趋势 / 蓝海爆品，每次每国固定返回 6 组
// 数据源：① Google News RSS 按国家+本地语言抓"热销/趋势/选品"实时资讯（主）
//       ② AMZ123早报(/zb) + TT123(/t) 中含选品/爆品/趋势/榜单的文章（补充）
//       ③ 五国人工精选池兜底，按日期轮换，保证任何时候每国都恰好 6 组、且每天打开不一样
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const CACHE_TTL = 30 * 60 * 1000;
const mem = new Map(); // country -> {t, data}

function timeoutSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, ms);
  return ctrl.signal;
}
async function fetchText(url, ms = 8000) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }, signal: timeoutSignal(ms) });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return await resp.text();
}
function decodeEntities(s) {
  if (!s) return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

// 五国元信息：flag + Google News 地区/语言 + 实时查询词 + 中文行业稿相关性正则（避免把同一篇全球通稿塞给每个国家）
const COUNTRY = {
  美国:   { flag: '🇺🇸', gl: 'US', hl: 'en-US', ceid: 'US:en',  win: '7d',  q: ['Amazon best sellers', 'TikTok made me buy it', 'Amazon movers and shakers', 'trending products 2026'], rel: /美国|美区|美站|北美|美元|U\.?S\.?A?|American/i },
  加拿大: { flag: '🇨🇦', gl: 'CA', hl: 'en-CA', ceid: 'CA:en',  win: '14d', q: ['Amazon Canada best sellers', 'trending products Canada', 'TikTok shop Canada'], rel: /加拿大|加国|加站|Canada|Canadian/i },
  日本:   { flag: '🇯🇵', gl: 'JP', hl: 'ja',    ceid: 'JP:ja',  win: '14d', q: ['Amazon 売れ筋', 'TikTok バズ', 'トレンド 商品', '楽天 売れ筋'], rel: /日本|日亚|日系|乐天|Japan|Japanese|円/i },
  韩国:   { flag: '🇰🇷', gl: 'KR', hl: 'ko',    ceid: 'KR:ko',  win: '14d', q: ['쿠팡 베스트', '틱톡 인기 상품', '해외직구 인기', '쇼핑 트렌드'], rel: /韩国|韩区|韩站|酷胖|Coupang|Korea|Korean|원/i },
  泰国:   { flag: '🇹🇭', gl: 'TH', hl: 'th',    ceid: 'TH:th',  win: '14d', q: ['TikTok Shop ขายดี', 'สินค้ามาแรง', 'Shopee ขายดี', 'Lazada ขายดี'], rel: /泰国|泰区|泰站|东南亚|Thailand|Thai|Shopee|Lazada|บาท/i }
};

// 从标题推断平台/货型/热度
function inferPlatform(t) {
  if (/tiktok|틱톡|พิคต๊อก|抖音/i.test(t)) return 'TikTok直邮';
  if (/海外仓|备货|warehouse/i.test(t)) return '海外仓备仓';
  if (/fba|亚马逊|amazon|쿠팡|coupang|楽天|shopee|lazada/i.test(t)) return '亚马逊FBM';
  return '亚马逊FBM';
}
function inferHeat(t) {
  return /爆|飙升|售罄|断货|バズ|베스트|대박|ขายดี|มาแรง|viral|surge|soar|skyrocket|best.?seller|movers|trending|hot|火爆|抢/i.test(t) ? '高' : '中';
}
function inferCargo(t) {
  const tags = ['普货'];
  if (/小|迷你|便携|mini|light|轻|首饰|饰品|手机壳|贴纸|收纳|数据线/i.test(t)) tags.push('轻小件');
  if (/液体|膏|喷雾|电池|电子|带电|磁|粉末|护肤|化妆|香水/i.test(t)) tags.push('敏感货');
  return [...new Set(tags)];
}
function cleanTitle(t) {
  let x = decodeEntities(t).replace(/\s*[-–—|｜]\s*[^-–—|｜]{0,30}(news|资讯|晚报|早报|日报|网|报|频道)$/i, '').trim();
  return x;
}
function makeLiveItem(country, flag, title, source) {
  const t = cleanTitle(title);
  const name = t.length > 30 ? t.slice(0, 30) + '…' : t;
  return {
    id: 'live-' + Math.abs([...t].reduce((a, c) => a + c.charCodeAt(0), 0)),
    name, country, flag, category: '海外实时趋势', heatLevel: inferHeat(t),
    reason: `近期${country}市场上升趋势（来源：${source}，抓取于今日），属于当下正在起量的方向，建议结合自身供应链快速小批量测试。`,
    viralPoint: '实时热点原文：' + t,
    platform: inferPlatform(t), seasonTrend: '当下热搜', cargoTags: inferCargo(t), live: true
  };
}

// 解析 Google News RSS
function parseGoogleRss(xml) {
  const out = [];
  const blocks = xml.split('<item>').slice(1);
  for (const b of blocks) {
    const m = b.match(/<title>([\s\S]*?)<\/title>/);
    if (!m) continue;
    const title = cleanTitle(m[1]).replace(/\s*[-–—]\s*[^-–—]+$/, '');
    if (title.length >= 8) out.push(title);
  }
  return out;
}
async function googleFor(cfg) {
  const out = [];
  const seen = new Set();
  await Promise.all(cfg.q.map(async (q) => {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:' + (cfg.win || '14d'))}&hl=${cfg.hl}&gl=${cfg.gl}&ceid=${cfg.ceid}`;
      const xml = await fetchText(url, 8000);
      for (const t of parseGoogleRss(xml).slice(0, 6)) {
        const k = t.slice(0, 18);
        if (seen.has(k)) continue;
        seen.add(k); out.push(t);
      }
    } catch (e) {}
  }));
  return out;
}

// AMZ123 / TT123 文章列表里挑"选品/趋势/爆品/榜单"相关
function parseNavTitles(html, host) {
  const out = [];
  const re = new RegExp('<a[^>]*href="https?://www\\.' + host + '\\.com/t/[A-Za-z0-9]+"[^>]*>', 'g');
  let m;
  while ((m = re.exec(html)) !== null) {
    const tm = m[0].match(/title="([^"]+)"/) || m[0].match(/data-sdk-resource-id="([^"]+)"/);
    if (!tm) continue;
    const title = decodeEntities(tm[1]);
    if (/选品|爆品|趋势|热销|热搜|搜索量|销量|增速|榜单|品类|蓝海|风口|增长|走红|出圈|爆发|爆单|带货|卖爆|爆款|热门|人气|バズ|ベスト|베스트|히트|ขายดี|มาแรง/.test(title)) out.push(title);
  }
  return out;
}

// 五国人工精选兜底池（FBM 数据多于 FBA，TikTok直邮/海外仓充足），按日期轮换
const FLOOR = {
  美国: [
    { name: '便携挂脖风扇（无叶涡轮款）', category: '生活小家电', heatLevel: '高', platform: '海外仓备仓', seasonTrend: '夏季爆卖', cargoTags: ['普货', '敏感货'], reason: '美国夏季炎热，挂脖风扇是近年超级爆品，无叶涡轮款升级四代，海外仓备旺季货跟得上时效。', viralPoint: '痛点：夏天出门太热、手持风扇占手、普通挂脖风扇夹头发。爆点：无叶不绞发+360度环绕出风+4000mAh续航6-12小时+Type-C快充+轻至200多克+多色可选。' },
    { name: '车载收纳/座椅缝隙储物盒', category: '汽车用品', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '全年', cargoTags: ['普货', '轻小件'], reason: '美国汽车保有量高，车内收纳是常青刚需，FBM轻小件好发、退货率低。', viralPoint: '痛点：手机钥匙没处放、缝隙掉东西、车内杂乱。爆点：贴合座椅缝隙不滑落+多格分区+杯架+皮革质感+通用99%车型。' },
    { name: '宠物自动饮水机（静音款）', category: '宠物用品', heatLevel: '高', platform: '亚马逊FBM', seasonTrend: '全年', cargoTags: ['普货', '敏感货'], reason: '美国宠物市场规模大，猫狗饮水机复购与升级需求强，静音+过滤是核心卖点。', viralPoint: '痛点：宠物不爱喝死水、水碗易脏、水泵噪音大。爆点：循环活水+四重过滤+超静音水泵+缺水断电+大容量2.5L+易拆洗。' },
    { name: '厨房硅胶保鲜盖（12件套）', category: '厨房工具', heatLevel: '中', platform: 'TikTok直邮', seasonTrend: '全年', cargoTags: ['普货', '轻小件'], reason: '环保可重复使用替代保鲜膜，TikTok演示拉伸贴合过程极易爆单，直邮小包友好。', viralPoint: '痛点：保鲜膜用一次就扔、剩菜碗盘大小不一盖不住。爆点：食品级硅胶+6种尺寸拉伸贴合+可进洗碗机微波炉+密封防漏。' },
    { name: '瑜伽拉伸带/居家健身阻力带套装', category: '运动健身', heatLevel: '中', platform: 'TikTok直邮', seasonTrend: '全年，新年更旺', cargoTags: ['普货', '轻小件'], reason: '居家健身长期热门，阻力带套装轻小、客单可控，适合直邮冲量。', viralPoint: '痛点：去健身房贵、没时间、大器械占地方。爆点：5档阻力一套搞定+门锚把手全套+天然乳胶不勒+带训练教程卡。' },
    { name: '旅行分装瓶+防水标签套装', category: '旅行收纳', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '旅游旺季', cargoTags: ['普货', '轻小件'], reason: '美国出行与跨境旅行复苏，分装瓶是出行必备，小套轻装适合FBM。', viralPoint: '痛点：登机液体超限、瓶罐分不清哪个是洗发沐浴、标签沾水掉。爆点：防漏硅胶阀+多瓶套装+防水分类标签+透明收纳袋。' },
    { name: 'LED日落灯/氛围投影灯', category: '家居灯饰', heatLevel: '高', platform: 'TikTok直邮', seasonTrend: '全年，秋冬更旺', cargoTags: ['普货', '敏感货'], reason: '氛围灯在TikTok和Ins出镜率极高，年轻人布置房间刚需，视频展示效果好。', viralPoint: '痛点：出租屋光线差、拍照没氛围、普通灯太刺眼。爆点：180度投影+多色切换+USB供电+夹子底座随处固定+一键出大片。' },
    { name: '男士理容胡须修剪套装', category: '个护美容', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '全年', cargoTags: ['普货', '敏感货'], reason: '男士理容是稳定增长类目，套装客单更高、复购耗材（刀头油）带动。', viralPoint: '痛点：胡须长短不齐、剃完泛红、鼻毛耳毛没工具。爆点：一机多头+限位梳多档+防水可冲洗+静音马达+收纳底座。' }
  ],
  加拿大: [
    { name: '冬季车窗除雪/刮雪冰铲（加长款）', category: '汽车用品', heatLevel: '高', platform: '海外仓备仓', seasonTrend: '秋冬旺季', cargoTags: ['普货'], reason: '加拿大冬季漫长多冰雪，除雪工具是强季节性刚需，海外仓提前备才能赶上初雪爆发。', viralPoint: '痛点：清晨车窗结冰刮不动、短铲够不到整片挡风玻璃、冻手。爆点：加长手柄+刮雪刷破冰三合一+防冻材质不脆裂+EVA保暖握把。' },
    { name: '保暖加绒家居袜/防滑地板袜', category: '服饰配件', heatLevel: '中', platform: 'TikTok直邮', seasonTrend: '秋冬', cargoTags: ['普货', '轻小件'], reason: '加拿大室内地暖/地板偏凉，加绒家居袜秋冬走量，轻小直邮友好。', viralPoint: '痛点：冬天脚冷、普通袜子不防滑、在家穿拖鞋闷。爆点：内里厚绒+脚底防滑胶点+高筒护脚踝+多双组合装+可爱图案。' },
    { name: '保温杯/大容量运动水壶（1L）', category: '水具杯壶', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '全年', cargoTags: ['普货'], reason: '加拿大人健身户外多，大容量保温壶常青，注意食品级材质与防漏。', viralPoint: '痛点：水不够喝、保温时间短、漏水弄湿包。爆点：316不锈钢+保冷24h保温12h+防漏弹盖+大容量1L+提手便携。' },
    { name: '户外露营折叠桌椅（轻量铝）', category: '户外运动', heatLevel: '中', platform: '海外仓备仓', seasonTrend: '春夏旺季', cargoTags: ['体积货'], reason: '加拿大露营文化浓厚，夏季国家公园出行带动折叠家具，体积偏大适合海外仓。', viralPoint: '痛点：露营桌椅重不好带、安装麻烦、占后备箱。爆点：铝合金轻量化+秒开免安装+承重稳+折叠后手提收纳。' },
    { name: '宠物冬季保暖马甲/反光外套', category: '宠物用品', heatLevel: '中', platform: 'TikTok直邮', seasonTrend: '秋冬', cargoTags: ['普货', '轻小件'], reason: '冬季遛狗保暖+夜行反光安全，TikTok宠物内容互动高，直邮可测款。', viralPoint: '痛点：小型犬冬天发抖、夜行遛狗不安全、衣服勒肚子。爆点：加绒防风+反光条+魔术贴易穿脱+多尺码覆盖大小犬。' },
    { name: '厨房密封罐/五谷杂粮收纳套装', category: '厨房收纳', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '全年', cargoTags: ['普货'], reason: '家居收纳在加拿大需求稳定，套装客单高、退货低，适合FBM精铺。', viralPoint: '痛点：杂粮开封受潮、橱柜杂乱、找不到东西。爆点：卡扣密封防潮+透明可视+可叠放+统一尺寸+标签笔附赠。' },
    { name: '手机防水袋/滑雪触屏防水套', category: '3C配件', heatLevel: '中', platform: 'TikTok直邮', seasonTrend: '冬夏两旺', cargoTags: ['普货', '轻小件'], reason: '滑雪、漂流、泡温泉场景通用，轻小便宜，直邮冲动购买转化高。', viralPoint: '痛点：玩水滑雪手机进水、普通防水袋触屏失灵。爆点：IPX8级防水+高清可触屏拍照+气囊防沉+通用大屏。' },
    { name: '加湿/香薰一体机（小夜灯款）', category: '生活小家电', heatLevel: '高', platform: '亚马逊FBM', seasonTrend: '秋冬', cargoTags: ['普货', '敏感货'], reason: '加拿大冬季供暖室内极干燥，加湿器刚需，带香薰夜灯的高颜值款溢价高。', viralPoint: '痛点：开暖气干到流鼻血、香薰机夜灯要分别买占插座。爆点：超声波细雾+静音+暖光小夜灯+缺水断电+大容量。' }
  ],
  日本: [
    { name: '迷你收纳盒/桌面分格整理（莫兰迪色）', category: '收纳整理', heatLevel: '高', platform: 'TikTok直邮', seasonTrend: '全年', cargoTags: ['普货', '轻小件'], reason: '日本住宅偏小、极简收纳文化盛行，桌面收纳高频复购，莫兰迪色系在社媒传播快。', viralPoint: '痛点：桌面小物杂乱、抽屉打开找不到、大收纳盒占地方。爆点：可叠放+分格自由组合+磨砂质感+窄缝也能放+一套覆盖全桌。' },
    { name: '厨房沥水/可折叠洗菜篮', category: '厨房工具', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '全年', cargoTags: ['普货'], reason: '日本小户型厨房看重节省空间，可折叠沥水篮常年稳定，注重做工细节。', viralPoint: '痛点：洗菜篮占地方、沥水不干发霉、水槽边没位置。爆点：折叠后仅3cm+挂墙收纳+沥水快+食品级PP+边缘圆滑不划手。' },
    { name: '保暖护膝/护腰（老寒腿季节款）', category: '健康护具', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '秋冬', cargoTags: ['普货', '轻小件'], reason: '日本老龄化明显，保暖护具需求稳定，强调无感佩戴与材质亲肤。', viralPoint: '痛点：膝盖腰部受凉酸痛、普通护具勒得慌、活动就下滑。爆点：自发热+高弹不勒+隐形可穿在裤内+人体工学不下滑。' },
    { name: '便当盒/分格减脂餐盒（可微波）', category: '餐厨用品', heatLevel: '中', platform: 'TikTok直邮', seasonTrend: '全年', cargoTags: ['普货'], reason: '日本人带便当文化强，分格餐盒+减脂搭配在社媒很受欢迎，适合直邮测款。', viralPoint: '痛点：饭菜串味、微波炉加热变形、盖子扣不紧漏汤。爆点：分格不串味+可微波可洗碗机+四扣密封防漏+带餐具筷勺。' },
    { name: '浴室免打孔置物架（无痕贴）', category: '卫浴收纳', heatLevel: '高', platform: '亚马逊FBM', seasonTrend: '全年', cargoTags: ['普货'], reason: '日本租房不能打孔，免打孔收纳是强需求，无痕贴承重是核心卖点。', viralPoint: '痛点：浴室没地方放、打孔怕退租扣钱、吸盘老掉。爆点：强力无痕贴承重5kg+防水不生锈+沥水设计+撕除不留胶。' },
    { name: '宠物猫玩具/逗猫棒自嗨套装', category: '宠物用品', heatLevel: '中', platform: 'TikTok直邮', seasonTrend: '全年', cargoTags: ['普货', '轻小件'], reason: '日本养猫人数高，猫玩具消耗快复购高，套装组合客单更好。', viralPoint: '痛点：猫玩两天就腻、主人没空逗、玩具散落一地。爆点：多款替换头+吸盘自嗨+羽毛铃铛吸引+收纳桶一套集齐。' },
    { name: '旅行收纳压缩袋（手卷免抽气）', category: '旅行收纳', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '旅游旺季', cargoTags: ['普货', '轻小件'], reason: '日本出行讲究收纳整洁，手卷免抽气压缩袋操作简单，适合FBM。', viralPoint: '痛点：行李箱塞不下、抽气袋要带泵麻烦、压缩后漏气回弹。爆点：手卷即压免工具+防漏气阀+加厚耐磨+透明可视。' },
    { name: '蒸汽眼罩/热敷护眼（多片装）', category: '健康个护', heatLevel: '高', platform: 'TikTok直邮', seasonTrend: '全年', cargoTags: ['普货', '轻小件', '敏感货'], reason: '日本社畜加班文化重，热敷护眼消耗品复购极高，多片组合装适合直邮走量。', viralPoint: '痛点：长时间看屏幕眼酸、入睡难、普通眼罩不发热。爆点：恒温蒸汽20分钟+贴合鼻翼+多香型+便携独立包装。' }
  ],
  韩国: [
    { name: '懒人发际线粉/补发修容棒', category: '美妆工具', heatLevel: '高', platform: 'TikTok直邮', seasonTrend: '全年', cargoTags: ['普货', '轻小件', '敏感货'], reason: '韩国美妆全球引领，发际线/阴影类彩妆在TikTok和Coupang常年热卖，轻小包直邮。', viralPoint: '痛点：发缝显宽、发际线后移显脸大、刘海一油就露头皮。爆点：一涂显发量+防水防汗不晕染+小头精准+多色匹配发色。' },
    { name: '花朵耳钉/无耳洞耳夹套装', category: '时尚配饰', heatLevel: '中', platform: 'TikTok直邮', seasonTrend: '春夏更旺', cargoTags: ['普货', '轻小件'], reason: '韩国耳饰设计感强、无耳洞耳夹门槛低，5-8对组合装客单低、转化快。', viralPoint: '痛点：打耳洞怕疼发炎、便宜耳夹夹得疼、单买搭配少。爆点：弹簧软垫不疼+多风格一周不重样+防敏针+礼盒装。' },
    { name: '高颅顶卷发筒/懒人刘海卷', category: '美妆工具', heatLevel: '高', platform: 'TikTok直邮', seasonTrend: '全年', cargoTags: ['普货', '轻小件'], reason: '韩式高颅顶、空气刘海造型需求大，免烫免电的懒人卷发筒在短视频极易爆。', viralPoint: '痛点：头顶塌显脸大、卷发棒伤发、早上没时间。爆点：睡前卷上晨起成型+无痕不勒+多尺寸+自然蓬松高颅顶。' },
    { name: '神奇洗碗布/竹纤维不沾油抹布', category: '家居清洁', heatLevel: '中', platform: 'TikTok直邮', seasonTrend: '全年', cargoTags: ['普货', '轻小件'], reason: '韩国家居清洁品在全亚洲都有热度，不沾油抹布演示对比强、消耗快复购高。', viralPoint: '痛点：普通抹布一周就发黏有味道、擦油污要很多洗洁精。爆点：竹纤维不沾油+一冲就净+抑菌不掉毛+10条大包装。' },
    { name: '桌面迷你加湿器（静音USB）', category: '生活小家电', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '秋冬', cargoTags: ['普货', '敏感货'], reason: '韩国办公室/地暖环境干燥，迷你USB加湿器颜值款受年轻人欢迎，FBM可做。', viralPoint: '痛点：办公室空调地暖干、大加湿器占桌面、噪音影响工作。爆点：静音细雾+USB供电+小巧不占地+氛围夜灯+防干烧。' },
    { name: '韩国宠物保暖/狗狗外出包', category: '宠物用品', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '秋冬', cargoTags: ['普货'], reason: '韩国小型犬饲养多，外出便携包需求稳定，注重透气与颜值。', viralPoint: '痛点：小型犬外出抱不动、普通包闷、狗狗害怕不肯进。爆点：三面透气网+可单肩可斜挎+隐蔽安全感设计+可折叠收纳。' },
    { name: '无痕发夹/高马尾固定抓夹套装', category: '美妆工具', heatLevel: '中', platform: 'TikTok直邮', seasonTrend: '全年', cargoTags: ['普货', '轻小件'], reason: '韩式发型抓夹是长青爆款，套装组合、磨砂高级感配色在社媒转化好。', viralPoint: '痛点：马尾往下坠塌、普通发夹勒头皮、发量多夹不住。爆点：高弹力不扯发+磨砂高级色+大小组合+鲨鱼夹牢固不掉。' },
    { name: '便携折叠咖啡杯/随行杯', category: '水具杯壶', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '全年', cargoTags: ['普货'], reason: '韩国咖啡文化浓厚，环保随行杯需求稳定，可折叠款便携性强。', viralPoint: '痛点：外带杯不环保、保温杯占包、杯子漏洒。爆点：食品级硅胶可折叠+防漏盖+挂环便携+耐冷热+多色。' }
  ],
  泰国: [
    { name: '免胶自粘式假睫毛套装（无胶水）', category: '美妆工具', heatLevel: '高', platform: 'TikTok直邮', seasonTrend: '全年', cargoTags: ['普货', '轻小件', '敏感货'], reason: '泰国美妆市场活跃、TikTok渗透率高，免胶假睫毛是新手友好新品类，直邮转化快。', viralPoint: '痛点：假睫毛胶水辣眼睛、贴不好、卸除扯眼皮。爆点：自粘胶条免胶水+3秒贴好+可重复贴+自然仿真+新手套装含镊子。' },
    { name: '伞绳编织多功能手链/应急挂件', category: '户外小配件', heatLevel: '中', platform: 'TikTok直邮', seasonTrend: '旱季旺季', cargoTags: ['普货', '轻小件'], reason: '泰国户外和露营文化升温，多功能伞绳手链兼具装饰与实用，TikTok"拆伞绳"视频易爆。', viralPoint: '痛点：普通手链只有装饰、户外遇到小问题没工具。爆点：七芯伞绳承重+内置打火石/哨子/小刀+可拆当应急绳+多色情侣款。' },
    { name: '盆栽自动渗水/滴灌器套装', category: '园艺灌溉', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '热季+假期', cargoTags: ['普货', '轻小件'], reason: '泰国炎热植物需水量大，假期出门没人浇花是普遍痛点，自动滴灌器FBM轻小件好发。', viralPoint: '痛点：出门几天花就干死、每天浇水费时、浇多烂根。爆点：锥形渗水速度可调+适配各种饮料瓶+12个套装+免插电自动滴。' },
    { name: '旅行分装瓶防水标签套装', category: '旅行收纳', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '旅游旺季', cargoTags: ['普货', '轻小件'], reason: '泰国旅游业发达，旅行收纳常年需求，FBM小件低风险。', viralPoint: '痛点：洗发沐浴分装分不清、标签遇水掉、瓶身漏液。爆点：防漏硅胶阀+透明瓶身+防水标签分类+便携收纳袋。' },
    { name: '磁吸纱窗/DIY自粘防蚊纱窗', category: '家居日用', heatLevel: '高', platform: 'TikTok直邮', seasonTrend: '雨季夏季更旺', cargoTags: ['普货'], reason: '泰国蚊虫多、雨季更甚，免打孔自粘纱窗是强痛点，DIY安装视频在TikTok传播快。', viralPoint: '痛点：普通纱窗要钉死、租房不能改、蚊子从缝隙进。爆点：魔术贴自粘免打孔+自由裁剪尺寸+密网防小虫+可拆卸清洗。' },
    { name: '便携小风扇/挂脖手持两用', category: '生活小家电', heatLevel: '高', platform: 'TikTok直邮', seasonTrend: '热季爆卖', cargoTags: ['普货', '敏感货'], reason: '泰国全年偏热，小风扇是刚需中的刚需，TikTok展示风力与静音效果转化高。', viralPoint: '痛点：热到没空调不行、手持占手、风扇噪音大风还小。爆点：挂脖手持两用+大风力静音+长续航+Type-C+马卡龙色。' },
    { name: '防水手机袋/漂流触屏套', category: '3C配件', heatLevel: '中', platform: 'TikTok直邮', seasonTrend: '宋干节/旅游季', cargoTags: ['普货', '轻小件'], reason: '泰国宋干节泼水、海岛游场景刚需防水袋，节庆前爆发，轻小直邮灵活补货。', viralPoint: '痛点：泼水玩水手机报废、防水袋触屏不灵、拍照模糊。爆点：IPX8防水+高清触屏拍照+气囊防沉+挂绳稳固。' },
    { name: '硅胶折叠餐盒/便当保鲜盒', category: '餐厨用品', heatLevel: '中', platform: '亚马逊FBM', seasonTrend: '全年', cargoTags: ['普货'], reason: '泰国带餐与外食文化结合，折叠餐盒省空间、色彩丰富受欢迎，FBM可做。', viralPoint: '痛点：餐盒占包、玻璃的太重、密封不好漏汤汁。爆点：硅胶可折叠压扁+四扣密封+可微波可冷藏+轻量化多色。' }
  ]
};

function rotateFloor(list, doy, n) {
  const len = list.length;
  const out = [];
  const start = doy % len;
  for (let i = 0; i < n; i++) out.push(list[(start + i) % len]);
  return out;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  let country = url.searchParams.get('country') || '美国';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '6', 10) || 6, 12);
  const refresh = url.searchParams.get('refresh') === '1';
  if (!FLOOR[country]) country = '美国';
  const cfg = COUNTRY[country];
  const flag = cfg.flag;

  if (!refresh) {
    const hit = mem.get(country);
    if (hit && Date.now() - hit.t < CACHE_TTL) {
      return new Response(JSON.stringify({ ...hit.data, cached: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
  }

  const doy = dayOfYear();
  const sources = [];
  const live = [];
  const seen = new Set();
  const pushLive = (title, src) => {
    const k = title.slice(0, 16);
    if (!title || seen.has(k)) return;
    seen.add(k);
    live.push(makeLiveItem(country, flag, title, src));
  };

  // ① Google News 实时（主源）
  try {
    const g = await googleFor(cfg);
    if (g.length) { sources.push('GoogleNews'); g.slice(0, 8).forEach(t => pushLive(t, 'Google资讯')); }
  } catch (e) {}

  // ② AMZ123 / TT123 选品趋势文章（补充，按日期错开）
  try {
    const [zb, tt] = await Promise.all([
      fetchText('https://www.amz123.com/zb', 7000).then(h => parseNavTitles(h, 'amz123')).catch(() => []),
      fetchText('https://www.tt123.com/t/', 7000).then(h => parseNavTitles(h, 'tt123')).catch(() => [])
    ]);
    const rel = cfg.rel;
    const pick = (arr, src) => arr.filter(t => rel.test(t)).slice(0, 4).forEach(t => pushLive(t, src));
    if (zb.length) { const before = live.length; pick(zb, 'AMZ123早报'); if (live.length > before) sources.push('AMZ123'); }
    if (tt.length) { const before = live.length; pick(tt, 'TT123'); if (live.length > before) sources.push('TT123'); }
  } catch (e) {}

  // ③ 精选兜底按日期轮换，补足到 limit
  const floor = rotateFloor(FLOOR[country], doy, FLOOR[country].length)
    .map((x, i) => ({ id: 'floor-' + country + '-' + i, country, flag, ...x }));
  const items = [];
  for (const it of live) { if (items.length >= limit) break; items.push(it); }
  for (const it of floor) { if (items.length >= limit) break; items.push(it); }
  while (items.length < limit && floor.length) items.push(floor[items.length % floor.length]);

  const result = {
    source: sources.length ? 'live:' + sources.join('+') : 'curated-floor',
    country, flag, count: items.length,
    liveCount: live.length, items,
    updated: new Date().toLocaleString('zh-CN')
  };
  mem.set(country, { t: Date.now(), data: result });
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
