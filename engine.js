/* ================================================================
   主持工作台 · 台词引擎（本地规则引擎）
   - 输入：场次信息 + 新人问卷 + 风格库样本 + 风格滑杆
   - 输出：按环节结构化的播读词 / 舞台提示 / 待补占位
   - 原则：只用问卷里真实存在的素材，缺什么就留占位，不编人、不编事
   ================================================================ */
(function (global) {
  'use strict';

  /* ---------- 小工具 ---------- */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seedStr) {
    let a = hash(seedStr) || 1;
    return function () {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
  const has = (s) => typeof s === 'string' && s.trim().length > 0;
  const cut = (s, n) => {
    if (!has(s)) return '';
    const clean = s.replace(/\s+/g, ' ').trim();
    return clean.length > n ? clean.slice(0, n) + '…' : clean;
  };

  /* ---------- 环节骨架 ---------- */
  /* 下面这份是默认值。真正生效的是 config.js 里的 segments——
     改名字、改时长、加减环节都去那里改，稿子 / 流程表 / 走位图会一起变。
     注意：新加的环节如果这里没有对应的台词生成器，会留空，不会报错。 */
  const SEG_DEFAULT = [
    { key: 'warm',     name: '暖场提示',           dur: 8 },
    { key: 'open',     name: '开场白',             dur: 4 },
    { key: 'groom',    name: '新郎入场',           dur: 2 },
    { key: 'bride',    name: '新娘入场 · 父亲交接', dur: 4 },
    { key: 'together', name: '共同入场',           dur: 3 },
    { key: 'vows',     name: '誓言环节',           dur: 5 },
    { key: 'rings',    name: '交换戒指',           dur: 3 },
    { key: 'witness',  name: '证婚人致辞',         dur: 3 },
    { key: 'kiss',     name: '拥吻 · 证婚',        dur: 3 },
    { key: 'parents',  name: '感恩父母 · 敬茶',     dur: 7 },
    { key: 'folks',    name: '双方父母致辞',       dur: 3 },
    { key: 'bouquet',  name: '手捧花',             dur: 4 },
    { key: 'toast',    name: '交杯酒 · 举杯',      dur: 4 },
    { key: 'end',      name: '礼成送客',           dur: 3 }
  ];
  const SEGMENTS = (window.WB && WB.segments && WB.segments.length)
    ? window.WB.segments
    : SEG_DEFAULT;

  /* ---------- 风格画像：从「我的旧台词」里真算 ---------- */
  function analyzeStyle(samples, prefs, packId) {
    const list = (samples || []).filter(s => has(s.text));
    const text = list.map(s => s.text).join('\n');
    const sentences = text.split(/[。！？!?…]+/).map(s => s.trim()).filter(Boolean);
    const avgLen = sentences.length ? sentences.reduce((a, s) => a + s.length, 0) / sentences.length : 0;

    const c1 = (text.match(/你看|其实|我跟你讲|咱们|你说|对吧|是不是|对不对|说白了|就这么|啊/g) || []).length;
    const c2 = (text.match(/愿|岁岁|余年|此|之|相守|白首|往后|共赴|余下|光阴|朝暮/g) || []).length;
    const c3 = (text.match(/各位|大家|朋友们|来宾/g) || []).length;
    const c4 = (text.match(/哈哈哈|笑|逗|开玩笑|别急|偷偷|结果/g) || []).length;
    const denom = Math.max(1, sentences.length);
    const colloquial = Math.min(100, Math.round(c1 / denom * 130));
    const classic = Math.min(100, Math.round(c2 / denom * 150));
    const audience = Math.min(100, Math.round(c3 / denom * 120));
    const humor = Math.min(100, Math.round(c4 / denom * 140));

    const p = prefs || {};
    const w = (a, b) => (typeof p[a] === 'number' ? Math.round(p[a] * 0.55 + b * 0.45) : b);

    const dims = {
      温度: w('温度', Math.min(100, 55 + classic / 3 + colloquial / 8)),
      口语: w('口语', list.length ? colloquial : 55),
      用典: w('用典', list.length ? classic : 40),
      幽默: w('幽默', list.length ? humor : 30),
      节奏: w('节奏', p['节奏'] != null ? p['节奏'] : (avgLen ? Math.max(28, Math.min(92, Math.round(110 - avgLen * 2.2))) : 58))
    };

    const tags = [];
    if (dims.口语 >= 62) tags.push('口语叙述'); else tags.push('书面质感');
    if (dims.用典 >= 52) tags.push('善用意象'); else tags.push('少用典故');
    if (dims.幽默 >= 50) tags.push('适度玩笑'); else tags.push('克制庄重');
    if (dims.温度 >= 66) tags.push('情感落点靠后');
    if (avgLen && avgLen < 22) tags.push('短句推进');
    if (avgLen && avgLen > 34) tags.push('长句铺陈');
    if (audience >= 55) tags.push('称呼用「各位」');

    const out = {
      count: list.length,
      avgLen: Math.round(avgLen),
      dims: dims,
      tags: tags,
      address: audience >= 55 ? '各位来宾，各位亲友' : (dims.口语 >= 62 ? '大家好' : '各位来宾'),
      sentence: avgLen && avgLen < 24 ? 'short' : 'long',
      summary: list.length
        ? `已读 ${list.length} 段旧稿，平均句长 ${Math.round(avgLen)} 字，${tags.slice(0, 3).join('、')}`
        : '风格库还没有旧稿。贴两段你以前写过的台词，画像会立刻具体起来。'
    };

    /* 选定套装风格档时，称呼与句长以档位为准（档是硬约束，画像只作参考） */
    const pk = (packId && global.Pack) ? global.Pack.byId(packId) : null;
    if (pk) {
      if (pk.address) out.address = pk.address;
      if (pk.sentence) out.sentence = pk.sentence;
      out.packId = pk.id;
      out.packName = pk.name;
      out.summary = `风格档 S${pk.code ? pk.code.replace('S', '') : ''} ${pk.name} · ${pk.desc}${list.length ? ` · 参考 ${list.length} 段旧稿` : ''}`;
    }
    return out;
  }

  /* ---------- 素材收集 ---------- */
  function material(w) {
    const s = w.survey || {};
    const c = w.couple || {};
    return {
      bride: has(c.bride) ? c.bride : '（新娘姓名待补）',
      groom: has(c.groom) ? c.groom : '（新郎姓名待补）',
      brideJob: has(c.brideJob) ? c.brideJob : '',
      groomJob: has(c.groomJob) ? c.groomJob : '',
      hotel: has(w.hotel) ? w.hotel : '（场地待补）',
      city: has(w.city) ? w.city : '',
      date: has(w.date) ? w.date : '',
      how: has(s.how) ? s.how : '',
      story: has(s.story) ? s.story : '',
      like: has(s.like) ? s.like : '',
      parents: has(s.parents) ? s.parents : '',
      surprise: has(s.surprise) ? s.surprise : '',
      mustSay: has(s.mustSay) ? s.mustSay : '',
      guests: has(s.guestsStruct) ? s.guestsStruct : ''
    };
  }

  /* 缺素材时的占位提示 */
  const PH = (what) => ({ t: 'note', text: `⚠ 待补素材：${what}（问卷里填上后重新生成，这一段会自动换成真话）` });

  /* ---------- 各环节撰写 ---------- */
  const BUILDERS = {

    warm(r, m, st, w) {
      const out = [];
      out.push({ t: 'cue', text: `<仪式前 5 分钟 · 音乐音量降至 40% · 灯光进入第一档>` });
      out.push({ t: 'say', text: pick(r, [
        `${st.address}，还有五分钟，我们的仪式就要开始了。请还没有入座的朋友，往前坐一点，今天没有安排多余的座位。`,
        `${st.address}，仪式还有五分钟开始。请您把手机调成静音，接下来的半个小时，交给台上这两个人。`,
        `${st.address}，我们还有五分钟。请大家把手机调成静音——今天会有摄影师替你们把这些画面留下来。`
      ]) });
      out.push({ t: 'say', text: pick(r, [
        `待会儿仪式开始之后，请尽量不要走动。不是规矩多，是怕您一走动，正好错过他们最重要的那几秒。`,
        `一会儿如果听到掌声，不用等主持人提示，想鼓就鼓。今天这一场，热烈一点没关系。`,
        `待会儿新郎入场的时候，大家可以先给他一点声音。他今天紧张得比新娘还早。`
      ]) });
      out.push({ t: 'cue', text: `<确认音控：开场曲已就位 · 确认摄影机位：正面 + 侧后方>` });
      return out;
    },

    open(r, m, st, w) {
      const out = [];
      if (has(m.story) || has(m.how)) {
        out.push({ t: 'say', text: pick(r, [
          `先不讲"金秋送爽"。今天我想从一件事讲起。`,
          `开场我不念套话。我想先说一件他们俩都没怎么跟别人讲过的事。`,
          `在请出新郎之前，我想先花一分钟，讲讲这个地方，和这个日子。`
        ]) });
        out.push({ t: 'say', text: `${cut(m.how, 60)}。` + (has(m.story) ? `${cut(m.story, 70)}。` : '') });
        out.push({ t: 'say', text: pick(r, [
          `这件事听起来不大，但一个人愿意把另一个人放在心里这么久，就已经是答案了。`,
          `你很难说这一刻改变了什么。但如果没有那一天，今天这个厅里，就不会坐着这么多人。`,
          `所以我常觉得，婚礼不是从今天开始的。婚礼只是把已经发生的事，请所有人一起看见。`
        ]) });
      } else {
        out.push({ t: 'say', text: `今天在场的，是${m.groom}和${m.bride}最亲近的人。我不打算用太长的开场，把时间留给他们。` });
        out.push(PH('两人的相识经过'));
      }
      out.push({ t: 'say', text: pick(r, [
        `我是今天的主持人${(w && w.hostName) ? '，' + w.hostName : ''}。接下来这半个小时，由我替他们把这一天串起来。`,
        `我是今天的主持人${(w && w.hostName) ? '，' + w.hostName : ''}。今天不讲排场，只讲他们两个人的事。`
      ]) });
      out.push({ t: 'cue', text: `<灯光收至舞台 · 音乐起 · 主持人退至侧位>` });
      return out;
    },

    groom(r, m, st, w) {
      const out = [];
      out.push({ t: 'say', text: pick(r, [
        `现在，让我们把目光交给今天最紧张的那个人——新郎${m.groom}。`,
        `第一个走上来的，是${m.groom}。他今天早上跟我说，他不紧张。我信了一半。`,
        `有请新郎${m.groom}入场。`
      ]) });
      if (has(m.groomJob)) out.push({ t: 'say', text: pick(r, [
        `一个${m.groomJob}，平时习惯了把镜头对准别人。今天，他站在了镜头这一边。`,
        `他是做${m.groomJob}的，今天这一场，他没有安排任何人替他记录——他说，他想专心看。`
      ]) });
      out.push({ t: 'say', text: `请你走到这里，停一下。往前看，门口那边，一会儿会出现一个人。` });
      out.push({ t: 'cue', text: `<新郎行至 T 台 1/3 处停步 · 面向入口 · 音乐降 2 秒留白>` });
      return out;
    },

    bride(r, m, st, w) {
      const out = [];
      out.push({ t: 'cue', text: `<入口门打开 · 追光跟人 · 音乐从 1:12 进>` });
      out.push({ t: 'say', text: pick(r, [
        `门开了。`,
        `现在，请所有人起立，把目光交给门口。`,
        `接下来的这段路，她要自己走一半。`
      ]) });
      out.push({ t: 'say', text: `有请新娘${m.bride}，和她的父亲。` });
      if (has(m.parents)) {
        out.push({ t: 'say', text: `在座的很多人都知道，${cut(m.parents, 42)}。今天他们坐在第一排，看着女儿往前走。` });
      }
      out.push({ t: 'say', text: pick(r, [
        `父亲，请您把女儿的手，交给面前这个年轻人。这一交，是信任，也是把一个家的一部分，交到另一个家里。`,
        `按照惯例，这里应该有一个交接。但我更愿意说，这是父亲把手松开的那一刻——不是交出去，是放心了。`
      ]) });
      out.push({ t: 'say', text: `新郎，从今天起，她走夜路的时候，你替她开灯。` });
      out.push({ t: 'cue', text: `<父亲退至母亲身边 · 递手 · 新人并肩站定>` });
      return out;
    },

    together(r, m, st, w) {
      const out = [];
      out.push({ t: 'say', text: pick(r, [
        `${m.groom}，${m.bride}，请你们一起，往前走。`,
        `现在，请你们两个人，一起走上这段路。`
      ]) });
      out.push({ t: 'say', text: pick(r, [
        `不用急。这一段路，你们只走这一次。`,
        `走得慢一点也没关系，今天所有人都在等你们。`
      ]) });
      out.push({ t: 'cue', text: `<共同入场 · 副歌落主舞台 · 宾客鼓掌>` });
      out.push({ t: 'say', text: `请两位面向彼此。${has(m.like) ? `我知道${cut(m.like, 46)}——从今天起，这些都要变成两个人的了。` : '从今天起，你们要一起过的，是日子。'}` });
      return out;
    },

    vows(r, m, st, w) {
      const out = [];
      out.push({ t: 'say', text: pick(r, [
        `接下来是誓言。这一段，我不替你们说。`,
        `婚礼上最容易变成套话的，就是誓言。所以今天这一段，他们自己写。`
      ]) });
      if (has(m.surprise)) {
        out.push({ t: 'say', text: `先说一件事：${cut(m.surprise, 56)}。` });
        out.push({ t: 'cue', text: `<工作人员递上手写信 · 备用卡待命>` });
      }
      out.push({ t: 'say', text: `新郎，请先对她说。` });
      out.push({ t: 'cue', text: `<新郎读誓词 · 音乐压至 25% · 读毕停顿 3 秒>` });
      out.push({ t: 'say', text: `新娘，请对他说。` });
      out.push({ t: 'cue', text: `<新娘读誓词 · 读毕不急着接话，留 2 秒>` });
      if (st.dims.温度 >= 62) {
        out.push({ t: 'say', text: pick(r, [
          `这些话，今天在场的人不一定都听得清。但没关系，说的人只有一个，听的人也只有一个。`,
          `誓言不是保证以后不会吵架。誓言是，吵完架以后，还愿意回来。`
        ]) });
      }
      return out;
    },

    rings(r, m, st, w) {
      const out = [];
      out.push({ t: 'say', text: pick(r, [
        `戒指。`,
        `接下来，是戒指。`
      ]) });
      out.push({ t: 'say', text: pick(r, [
        `一枚戒指的重量不到五克，但它压得住一句"我在"。`,
        `戒指是一个圆，没有起点，也没有终点。这大概是它被选来做信物的原因。`
      ]) });
      out.push({ t: 'cue', text: `<伴娘递上戒枕 · 新郎取戒 · 戴上无名指>` });
      out.push({ t: 'say', text: `请新郎，把这枚戒指，戴在${m.bride}的无名指上。` });
      out.push({ t: 'say', text: `请新娘，为${m.groom}戴上。` });
      out.push({ t: 'cue', text: `<戒指到位 · 手部特写机位跟进>` });
      return out;
    },

    /* 证婚人 / 主婚人致辞：主持人只做介绍、控时、收束，不复述致辞内容 */
    witness(r, m, st, w) {
      const out = [];
      out.push({ t: 'say', text: pick(r, [
        `接下来，请证婚人上台。`,
        `下面有请证婚人，为两位新人证婚。`
      ]) });
      out.push({ t: 'say', text: `（此处念出证婚人姓名与身份，只按来宾名单顺序，不改写职务）` });
      out.push({ t: 'cue', text: `<证婚人上台 · 话筒交接 · 音乐压至 20% · 提示 3 分钟>` });
      out.push({ t: 'say', text: pick(r, [
        `谢谢您。这段话，他们两个会记很久。`,
        `谢谢。请证婚人回座。`
      ]) });
      out.push({ t: 'cue', text: `<证婚人下台 · 递回话筒 · 留 2 秒>` });
      if (st.dims.温度 >= 70) out.push({ t: 'say', text: `证婚人说的那句「我看着他们长大」，比任何祝词都重。` });
      return out;
    },

    kiss(r, m, st, w) {
      const out = [];
      out.push({ t: 'say', text: pick(r, [
        `现在，新郎可以亲吻你的新娘了。`,
        `按照流程，这里有一个吻。请吧。`
      ]) });
      out.push({ t: 'cue', text: `<拥吻 5 秒 · 副歌进入 · 全场掌声>` });
      if (st.dims.幽默 >= 52) {
        out.push({ t: 'say', text: pick(r, [
          `好，五秒钟，够了。再久一点，摄影师的内存就不够了。`,
          `可以了可以了，剩下的回家慢慢来。`
        ]) });
      }
      out.push({ t: 'say', text: `从这一刻起，在法律上、在亲友面前，你们是夫妻了。` });
      return out;
    },

    parents(r, m, st, w) {
      const out = [];
      out.push({ t: 'say', text: pick(r, [
        `接下来的这个环节，容易让人红了眼睛。`,
        `婚礼上有一个环节，主持人一般不敢多说话。就是现在。`
      ]) });
      out.push({ t: 'say', text: `请双方父母上台。${has(m.parents) ? cut(m.parents, 46) + '。' : ''}` });
      out.push({ t: 'cue', text: `<两家父母上台 · 茶几就位 · 先女方后男方 · 音乐：萱草花>` });
      out.push({ t: 'say', text: `请两位新人，先给爸爸妈妈敬一杯茶。` });
      out.push({ t: 'say', text: pick(r, [
        `这一杯茶，是敬二十几年的饭、二十几年的衣服、和二十几年没说出口的担心。`,
        `从小到大，他们给你们的，从来没有让你们还过。今天这杯茶，不是还，是告诉一声：我长大了。`
      ]) });
      if (has(m.mustSay)) out.push({ t: 'say', text: `在这里，我想替两位新人说一句：${cut(m.mustSay, 40)}。` });
      out.push({ t: 'say', text: `爸爸妈妈，请坐。今天，你们可以放心了。` });
      out.push({ t: 'cue', text: `<父母落座第一排 · 递纸巾 · 留 5 秒静场>` });
      return out;
    },

    /* 双方父母致辞：主持人退半步，只做邀请与兜底 */
    folks(r, m, st, w) {
      const out = [];
      out.push({ t: 'say', text: pick(r, [
        `今天有两个人，本来不打算讲话。`,
        `接下来这两分钟，不属于我，也不属于新人。`
      ]) });
      out.push({ t: 'say', text: `请${m.bride}的父亲，说两句。` });
      out.push({ t: 'cue', text: `<女方父亲致辞 · 话筒送上去 · 不催 · 递纸巾>` });
      out.push({ t: 'say', text: `谢谢。下面请${m.groom}的父亲。` });
      out.push({ t: 'cue', text: `<男方父亲致辞 · 控在 2 分钟内 · 超时用手势提示>` });
      out.push({ t: 'say', text: pick(r, [
        `两位父亲的话都不长。但今天说完，家里的话就变少了。`,
        `谢谢两位。有些话，今天说完就够用一辈子。`
      ]) });
      return out;
    },

    bouquet(r, m, st, w) {
      const out = [];
      out.push({ t: 'say', text: pick(r, [
        `${m.bride}手里这束花，今天不抛。`,
        `手捧花，今天换个送法。`
      ]) });
      out.push({ t: 'say', text: pick(r, [
        `她说，这束花她想分成两束，送给今天陪她站了最久的人。`,
        `她提前跟我说，这束花要一分二，给两个一直在她身边的人。`
      ]) });
      out.push({ t: 'cue', text: `<手捧花一分二 · 两位伴娘上台 · 拥抱>` });
      out.push({ t: 'say', text: `花会谢，但今天这一下，你们会记很久。` });
      return out;
    },

    toast(r, m, st, w) {
      const out = [];
      out.push({ t: 'say', text: pick(r, [
        `到了举杯的时候了。`,
        `接下来，请工作人员把酒杯送上来。`
      ]) });
      out.push({ t: 'cue', text: `<香槟塔就位 · 服务员满杯 · 音乐渐强>` });
      out.push({ t: 'say', text: `请两位新人，交杯。` });
      out.push({ t: 'say', text: pick(r, [
        `我也想请全场举起杯子——不管您杯子里是酒，是茶，还是白开水。`,
        `请全场起立，举起您手里的杯子。`
      ]) });
      out.push({ t: 'say', text: `敬${m.groom}和${m.bride}。敬今天坐在这里的每一个人。敬往后的日子。` });
      out.push({ t: 'cue', text: `<全场举杯 · 掌声 · 新人退至主桌>` });
      return out;
    },

    end(r, m, st, w) {
      const out = [];
      out.push({ t: 'say', text: pick(r, [
        `仪式到这里就结束了。`,
        `好，仪式礼成。`
      ]) });
      out.push({ t: 'say', text: `感谢各位今天的到场。${has(m.guests) ? `今天来的人里，${cut(m.guests, 40)}，都是他们人生里很重要的人。` : ''}` });
      out.push({ t: 'say', text: `接下来请各位移步宴会厅，${(w && w.time) ? w.time + ' ' : ''}准时开席。合影区在签到台右侧，先拍全家福，再拍朋友。` });
      out.push({ t: 'cue', text: `<引导宾客入席 · 送客音乐起 · 主持人收麦>` });
      return out;
    }
  };

  /* ---------- 冲突检查 ---------- */
  function lint(text, w) {
    const warn = [];
    const taboo = ((w.survey && w.survey.taboo) || '').trim();
    if (taboo) {
      const words = taboo.split(/[，,、;；。\s]+/).filter(x => x.length >= 2);
      words.forEach(word => {
        if (text.includes(word)) warn.push(`出现避讳词「${word}」，问卷里明确要求避开`);
      });
    }
    if (/早生贵子|多子多福|早生/.test(text) && !/不提|不说/.test(taboo)) {
      warn.push('含「早生贵子」类表述，如新人未要求建议删除');
    }
    if ((text.match(/[。！？]/g) || []).length < 3) warn.push('这一段几乎没有停顿，台上不好换气');
    return warn;
  }

  /* 风格档换声：把该环节的第一句播读词换成档位句库里的句子。
     只换起手句 —— 结构、舞台提示、素材占位全部保留，改一处就能听出差别。 */
  function voice(blocks, packId, segKey, r) {
    if (!packId || !global.Pack) return blocks;
    const lines = global.Pack.linesFor(packId, segKey);
    if (!lines || !lines.length) return blocks;
    const out = blocks.slice();
    const i = out.findIndex(b => b.t === 'say');
    if (i < 0) return out;
    out[i] = { t: 'say', text: pick(r, lines), pack: packId };
    return out;
  }

  /* ---------- 主入口 ---------- */
  function generate(w, segKey, opts) {
    opts = opts || {};
    const st = analyzeStyle(opts.samples || [], opts.prefs || {}, opts.pack);
    const m = material(w);
    const builder = BUILDERS[segKey];
    if (!builder) return { blocks: [], style: st, lint: [] };
    const r = rng([w.id, segKey, opts.salt || 0, st.dims.口语, st.dims.幽默, opts.pack || ''].join('|'));
    const built = builder(r, m, st, Object.assign({ hostName: opts.hostName }, w));
    const blocks = voice(built, opts.pack, segKey, r);
    const plain = blocks.filter(b => b.t === 'say').map(b => b.text).join('');
    return { blocks, style: st, lint: lint(plain, w) };
  }

  /* ---------- 纯文本导出 ---------- */
  function toMarkdown(w, segKey, blocks) {
    const seg = SEGMENTS.find(s => s.key === segKey);
    const head = `## ${seg ? seg.name : segKey}\n`;
    const body = blocks.map(b => {
      if (b.t === 'cue') return `\n<${b.text.replace(/^<|>$/g, '')}>\n`;
      if (b.t === 'note') return `\n（${b.text.replace(/^⚠\s*/, '')}）\n`;
      return b.text;
    }).join('\n');
    return `${head}\n${body}\n`;
  }

  global.Engine = { SEGMENTS, analyzeStyle, generate, toMarkdown, material, lint, BUILDERS };
})(window);
