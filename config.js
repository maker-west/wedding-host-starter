/* ================================================================
   config.js —— 唯一需要改的文件
   ----------------------------------------------------------------
   想把这个工作台变成你自己的，改这一个文件就够了：

     1. id        改掉它，你的数据和别人的不会混在一起
     2. brand     名字、印章字、副标题、备份文件名
     3. theme     主色。页面、导出的长图、走位图会一起跟着变
     4. segments  环节表。改名字、改时长、加减环节都在这里
     5. cast      走位图里的人。加一个伴郎就加一行

   改完刷新页面就生效，不用构建、不用重启。
   ================================================================ */
(function (global) {
  'use strict';

  var CONFIG = {

    /* ---------------- 1. 身份 ---------------- */
    /* 改了这个 id，等于换了一个独立的数据空间：
       同一台电脑上开两个版本，各自的数据和大模型 key 不会互相覆盖。 */
    id: 'demo',

    /* ---------------- 2. 品牌 ---------------- */
    brand: {
      name: '主持工作台',        // 侧栏大标题
      seal: '台',                // 左上角那个方块里的字，只放一个
      tagline: '婚礼主持 · 台本与现场', // 侧栏副标题
      title: '主持工作台 · 婚礼', // 浏览器标签标题
      desc: '婚礼主持人的一站式工作台：新人问卷、主持稿、流程、歌单、走位沙盘、提词器。纯前端页面，数据存在本机，断网也能用。',
      ogDesc: '问卷 → 台词 → 流程 → 歌单 → 现场，一个页面走完。',
      backupName: '工作台备份'    // 导出的 json 文件名：工作台备份_20261111.json
    },

    /* ---------------- 3. 色板 ---------------- */
    /* 只要换掉 wine 这一行，整站主色就变了。
       想更彻底，可以把 paper（底色）、gold（点缀）一起改。 */
    theme: {
      paper:    '#F6F4EF',
      'paper-2': '#EFEBE2',
      card:     '#FFFFFF',
      ink:      '#17140F',
      'ink-2':  '#433C33',
      'ink-3':  '#776C5E',
      'ink-4':  '#A4988A',
      line:     'rgba(23,20,15,.085)',
      'line-2': 'rgba(23,20,15,.16)',
      wine:     '#8C3B47',   /* ← 主色，改这一个值就行 */
      'wine-2': '#A85460',   /* 主色浅一档，用于渐变和小字 */
      'wine-soft': '#F7EBEB', /* 主色 8% 的底色，用于选中态 */
      gold:     '#AF8850',
      'gold-soft': '#F7F1E4',
      sage:     '#5C7A68',
      'sage-soft': '#EAF0EB',
      blue:     '#4A6785',
      'blue-soft': '#E8EEF4'
    },

    /* ---------------- 4. 环节表 ---------------- */
    /* 整个系统的地基。key 是内部索引（不要用中文，不要重复），
       name 是界面上显示的名字，dur 是分钟。
       加减环节只改这个数组，稿子、流程表、走位图会一起跟着变。 */
    segments: [
      { key: 'warm',     name: '暖场提示',            dur: 8 },
      { key: 'open',     name: '开场白',              dur: 4 },
      { key: 'groom',    name: '新郎入场',            dur: 2 },
      { key: 'bride',    name: '新娘入场 · 父亲交接',  dur: 4 },
      { key: 'together', name: '共同入场',            dur: 3 },
      { key: 'vows',     name: '誓言环节',            dur: 5 },
      { key: 'rings',    name: '交换戒指',            dur: 3 },
      { key: 'witness',  name: '证婚人致辞',          dur: 3 },
      { key: 'kiss',     name: '拥吻 · 证婚',         dur: 3 },
      { key: 'parents',  name: '感恩父母 · 敬茶',      dur: 7 },
      { key: 'folks',    name: '双方父母致辞',        dur: 3 },
      { key: 'bouquet',  name: '手捧花',              dur: 4 },
      { key: 'toast',    name: '交杯酒 · 举杯',       dur: 4 },
      { key: 'end',      name: '礼成送客',            dur: 3 }
    ],

    /* ---------------- 5. 走位图里的人 ---------------- */
    /* 这一组是演示配色，不是标准答案。
       换成你自己一眼能分清的颜色就行——九个人同框，最容易犯的错
       是用了九个相近的色，打印出来全糊成一片。 */
    cast: [
      { id: 'host',    label: '主持人',   color: '#8A8378', shape: 'suit' },
      { id: 'groom',   label: '新郎',     color: '#5B7A96', shape: 'suit' },
      { id: 'bride',   label: '新娘',     color: '#A8637A', shape: 'gown' },
      { id: 'father',  label: '新娘父亲', color: '#7C8A96', shape: 'suit' },
      { id: 'mother',  label: '新娘母亲', color: '#9A8AA6', shape: 'gown' },
      { id: 'gfather', label: '新郎父亲', color: '#84906F', shape: 'suit' },
      { id: 'gmother', label: '新郎母亲', color: '#A08A7C', shape: 'gown' },
      { id: 'bestman', label: '伴郎',     color: '#5E9A90', shape: 'suit' },
      { id: 'maid',    label: '伴娘',     color: '#C2924F', shape: 'gown' }
    ]
  };

  /* ================================================================
     下面是把它用起来的胶水代码，一般不用改。
     ================================================================ */

  /* 取一个颜色。canvas 不能直接用 var(--wine)，必须给具体色值，
     所以这里读的是配置里的值，保证页面和导出图是同一个颜色。 */
  CONFIG.color = function (name) {
    var v = CONFIG.theme[name] || CONFIG.theme[name.replace(/^--/, '')];
    return v || name;
  };

  /* ---------------- 颜色小工具 ----------------
     用于从主色派生出「深一档」和「带透明度的」版本，
     这样你只改一个 wine，渐变、hover、选中底色会一起跟着变。 */
  function hexToRgb(h) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(h || '').trim());
    if (!m) return null;
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  /* 往黑色方向压 k（0 = 原色，1 = 全黑） */
  function mixBlack(hex, k) {
    var c = hexToRgb(hex);
    if (!c) return hex;
    return '#' + c.map(function (v) {
      var n = Math.round(v * (1 - k)).toString(16);
      return n.length < 2 ? '0' + n : n;
    }).join('');
  }

  /* 把色板写进 CSS 变量，覆盖 styles.css 里的默认值。
     用行内样式写，优先级更高，所以 config 说了算。 */
  CONFIG.applyTheme = function () {
    if (!global.document) return;
    var root = document.documentElement;
    Object.keys(CONFIG.theme).forEach(function (k) {
      root.style.setProperty('--' + k, CONFIG.theme[k]);
    });

    /* 派生值：改 wine 一处，下面这些自动跟着变
       --wine-rgb   给 rgba() 用：rgba(var(--wine-rgb), .16)
       --wine-deep  压暗 22%，用于渐变深端和按钮 hover */
    var w = CONFIG.theme.wine;
    var rgb = hexToRgb(w);
    if (rgb) {
      root.style.setProperty('--wine-rgb', rgb.join(','));
      root.style.setProperty('--wine-deep', mixBlack(w, 0.22));
    }
  };

  /* 改标题、描述、主题色、favicon。
     在 head 里就能跑，不依赖 body 解析完。 */
  CONFIG.applyMeta = function () {
    if (!global.document) return;
    var b = CONFIG.brand;
    var d = document;

    d.title = b.title;

    function meta(sel, attr, val) {
      var el = d.querySelector(sel);
      if (!el) {
        el = d.createElement('meta');
        var m = sel.match(/\[(name|property)="([^"]+)"\]/);
        if (m) el.setAttribute(m[1], m[2]);
        d.head.appendChild(el);
      }
      el.setAttribute(attr, val);
    }
    meta('meta[name="description"]', 'content', b.desc);
    meta('meta[property="og:title"]', 'content', b.title);
    meta('meta[property="og:description"]', 'content', b.ogDesc);
    meta('meta[name="theme-color"]', 'content', CONFIG.color('wine'));

    /* favicon 用内联 SVG 画出来：一个圆角方块 + 印章字。
       这样不用额外图片文件，改品牌时它会跟着变。 */
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
      "<rect width='32' height='32' rx='7' fill='" + CONFIG.color('wine') + "'/>" +
      "<text x='16' y='23' font-size='19' text-anchor='middle' fill='#F7EDE6' " +
      "font-family='serif'>" + (b.seal || '台') + "</text></svg>";
    var icon = d.querySelector('link[rel="icon"]');
    if (!icon) { icon = d.createElement('link'); icon.rel = 'icon'; d.head.appendChild(icon); }
    icon.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  };

  /* 填侧栏的品牌区。要等 body 解析完才能调，所以放在 app.js 启动时。 */
  CONFIG.applyBrandDOM = function () {
    if (!global.document) return;
    var b = CONFIG.brand;
    var seal = document.querySelector('.brand .seal');
    var h1 = document.querySelector('.brand h1');
    var p = document.querySelector('.brand p');
    if (seal) seal.textContent = b.seal;
    if (h1) h1.textContent = b.name;
    if (p) p.textContent = b.tagline;
  };

  /* 存储键前缀。所有 localStorage / IndexedDB 的键都从这里派生，
     这样两个不同的 id 天然互不干扰。 */
  CONFIG.key = function (name) {
    return 'wb.' + CONFIG.id + '.' + name;
  };

  global.WB = CONFIG;
})(window);
