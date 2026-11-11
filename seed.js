/* 主持工作台 · 婚礼主持工作台 —— 示例数据（本地初始种子，仅首次运行写入）
   注意：这份数据是要公开发的演示数据，里里外外都不能出现真实客户、真实场地与本人信息。
   姓名、酒店、故事、联系人都为虚构；如需换成自己的场次，在应用里新建或导入备份即可。 */
/* ---------------- 流程骨架 ----------------
   这几行是从 config.js 的环节表自动生成的：
   改名字、改时长、加减环节，只改 config，这里不用动。
   NOTE 只是「新建场次时预填的备注」，属于示例，换成你自己的提醒即可。 */
(function () {
  var SEG = (window.WB && WB.segments) || [];
  var NOTE = {
    warm:    '提前 5 分钟提示入座，暖场歌单走起',
    open:    '不念套话，用场地的画面或今天的天气起头',
    groom:   '从侧门入场，走到通道 1/3 处停',
    bride:   '父亲送到交接点，交接后退至母亲身边',
    together:'前 8 拍走，副歌进入主舞台',
    vows:    '新人自带手写誓词，准备备用卡',
    rings:   '伴娘递戒枕，戒指从无名指',
    witness: '请长辈或领导证婚，主持人只做介绍与收束',
    kiss:    '拥吻 5 秒，摄影师已在正前方',
    parents: '两家父母上台，先女方后男方；茶几提前摆好',
    folks:   '把话筒交给父母，主持人退半步',
    bouquet: '手捧花怎么分，提前和新人确认（此条不给新人，防剧透）',
    toast:   '香槟塔在左侧，服务员提前满杯',
    end:     '合影区在签到台右侧，先全家福后朋友'
  };
  /* 不想让新人看到的环节，在这里加 key */
  var PLANNER_ONLY = { bouquet: 1 };

  window.SEED_FLOWS = SEG.map(function (s) {
    return {
      key:  s.key,
      name: s.name,
      dur:  s.dur,
      note: NOTE[s.key] || '',
      vis:  PLANNER_ONLY[s.key] ? 'planner' : 'both'
    };
  });
})();

/* ---------------- 歌单示例 ----------------
   注意 seg 存的是环节的 key（config.js 里那个），不是中文名。
   这样以后改了环节的显示名，歌单不会掉链子。
   这 6 条只是让你看见格式，实际用的时候删掉换成自己的。 */
window.SEED_SONGS = [
  { seg: 'warm',    title: 'Perfect',            artist: 'Ed Sheeran',        clip: '整首循环，音量 40%',       use: '暖场' },
  { seg: 'open',    title: 'A Thousand Years',   artist: 'Christina Perri',   clip: '从 0:42 起，淡入 3 秒',   use: '仪式' },
  { seg: 'groom',   title: 'Marry You',          artist: 'Bruno Mars',        clip: '从 0:18 起，副歌前收',    use: '仪式' },
  { seg: 'bride',   title: '示例：新娘入场曲',     artist: '填歌手',             clip: '填从几分几秒起',          use: '仪式' },
  { seg: 'vows',    title: 'River Flows in You', artist: 'Yiruma',            clip: '音量压到 25%，垫底',      use: '仪式' },
  { seg: 'end',     title: 'Beautiful In White', artist: 'Shane Filan',       clip: '整首，音量 45%',          use: '送客' }
];

window.SEED_DB = {
  version: 1,
  profile: {
    name: '周予',
    slogan: '把每一场婚礼，讲成一个只属于他们的故事',
    brand: '婚礼主持',
    phone: '',
    city: '北京'
  },
  style: {
    pack: 'custom',
    prefs: { 温度: 72, 口语: 64, 用典: 38, 幽默: 30, 节奏: 58 },
    /* ↓ 这里放你过去写过的稿子，用来算「风格画像」。
         现在是空的示例：删掉它，粘 2—5 段你自己写过的主持词。
         样本越像你真实说话，后面出的稿越像你。 */
    samples: [
      {
        id: 's1',
        text: '〔示例〕把你过去写过的一段主持词粘在这里。不用完整，一段就够。',
        why: '〔示例〕写一句你当时的考虑：为什么这么起头、为什么用这个词。这段话不会被念出来，只是让你自己回想。',
        tag: '〔示例〕场景标签', date: '2026-01-01'
      }
    ]
  },
  /* 内容库：自己攒的句子和细节，出稿时按环节自动插进去 */
  /* 内容库：自己攒的句子和细节。出稿时按环节自动插进去。
     这里只留两条说明格式，剩下的自己往里加——这部分是纯积累，抄不来。 */
  materials: [
    /* 这里放你自己攒的句子。seg 留空 = 不绑定环节，任何环节都可能用到；
       填了 key（如 'vows'）就只用在那一个环节。加一条就能用，不用改代码。 */
    {
      id: 'm1', kind: '故事细节', seg: 'vows',
      text: '〔示例〕记一个新人讲过的具体细节：一件物品、一个动作、一句话。',
      note: '誓言环节用来垫情绪，别抢在新人自己说话前面',
      date: '2026-01-01'
    }
  ],
  weddings: [
    {
      id: 'w1',
      date: '2026-10-18',
      time: '11:58',
      hotel: '城西美术馆 · 陈列厅',
      city: '北京',
      status: '已完成',
      fee: 8800,
      planner: '小林',
      contact: '13* **** 2043',
      guests: 88,
      couple: { bride: '沈知白', groom: '陆昭', brideJob: '书籍设计师', groomJob: '建筑摄影师' },
      survey: {
        how: '朋友的旧书店开张那天，一个在找绝版画册，一个在拍书架',
        story: '他把她翻书的侧脸拍了下来，三个月后才敢发给她',
        like: '她喜欢冬天、旧书和不太甜的东西；他喜欢长焦镜头和下雨天',
        parents: '女方父母在苏州，男方父母在本地；父亲话少，母亲爱笑',
        taboo: '不提催生，不说"早生贵子"；男方父亲今年做过手术，不宜久站',
        surprise: '新郎写了一封手写信，想在誓言环节念',
        mustSay: '感谢两位妈妈',
        guestsStruct: '亲友为主，同事两桌，孩子六七个',
        extra: '仪式 30 分钟内结束，12:30 必须开席'
      },
      flow: [],
      songs: [],
      scripts: {}
    },
    {
      id: 'w2',
      date: '2026-11-15',
      time: '18:08',
      hotel: '云栖山谷酒店 · 草坪',
      city: '北京',
      status: '已定',
      fee: 12800,
      planner: '小周',
      contact: '18* **** 7712',
      guests: 120,
      couple: { bride: '温念', groom: '程野', brideJob: '儿科医生', groomJob: '独立乐队吉他手' },
      survey: {
        how: '三年前一场朋友的生日聚会，两个人被安排坐在同一桌',
        story: '散场时下大雨，只有一把伞，他把伞全给了她，自己淋着去路口打车',
        like: '她喜欢海、凌晨的便利店；他喜欢老吉他和黑胶',
        parents: '女方父母从外地赶来，男方父母在本地；双方父亲都是老师',
        taboo: '不要提淋雨、堵车这类梗；新娘外婆刚过世',
        surprise: '伴郎团准备了一首歌，放在敬酒前',
        mustSay: '提一句"那把伞"',
        guestsStruct: '大学同学三桌，乐队朋友一桌，长辈五桌',
        extra: '户外草坪，18:08 天刚好黑，灯光要跟上；备雨棚'
      },
      flow: [],
      songs: [],
      scripts: {}
    },
    {
      id: 'w3',
      date: '2026-11-29',
      time: '11:38',
      hotel: '城中饭店 · 三层宴会厅',
      city: '北京',
      status: '待确认',
      fee: 9800,
      planner: '小林',
      contact: '15* **** 3098',
      guests: 160,
      couple: { bride: '宋迟', groom: '裴岸', brideJob: '中学语文老师', groomJob: '外科医生' },
      survey: {
        how: '朋友的婚礼上同桌，聊了一整晚的旧电视剧',
        story: '他第二天发来一张手写的书单，说"你提到的那几本我都看过"',
        like: '她喜欢古诗词和桂花；他喜欢跑步',
        parents: '两家都是本地人，亲戚多',
        taboo: '不提工作太忙、不拿医生开玩笑',
        surprise: '暂无',
        mustSay: '',
        guestsStruct: '亲戚为主，长辈十桌',
        extra: '中式改良流程，保留敬茶与改口'
      },
      flow: [],
      songs: [],
      scripts: {}
    },
    {
      id: 'w4',
      date: '2026-12-13',
      time: '17:28',
      hotel: '旧厂房艺术区 · 顶层',
      city: '北京',
      status: '咨询中',
      fee: 0,
      planner: '',
      contact: '',
      guests: 60,
      couple: { bride: '顾南', groom: '韩序', brideJob: '', groomJob: '' },
      survey: { how: '', story: '', like: '', parents: '', taboo: '', surprise: '', mustSay: '', guestsStruct: '', extra: '' },
      flow: [],
      songs: [],
      scripts: {}
    }
  ],
  todos: [
    { id: 't1', text: '11/15 草坪场 · 确认户外雨棚与灯光方案', due: '11-11', done: false, wid: 'w2' },
    { id: 't2', text: '11/15 草坪场 · 收到新人最终歌单并核对剪辑点', due: '11-10', done: false, wid: 'w2' },
    { id: 't3', text: '11/15 草坪场 · 誓言环节备用卡打印', due: '11-13', done: true, wid: 'w2' },
    { id: 't4', text: '11/29 宴会厅 · 发送新人问卷（第二次催填）', due: '11-16', done: false, wid: 'w3' },
    { id: 't5', text: '12/13 顶层 · 报价单与合同待发', due: '11-18', done: false, wid: 'w4' }
  ]
};
