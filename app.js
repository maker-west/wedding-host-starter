/* ================================================================
   主持工作台 — 应用层
   ----------------------------------------------------------------
   品牌、色板、环节表都在 config.js 里，这里只读不写。
   ================================================================ */
(function () {
  'use strict';

  /* 配置的兜底：万一 config.js 没加载（比如单独拷了 app.js），
     用一组默认值撑住，页面不至于白屏。 */
  const CFG = window.WB || {
    id: 'demo',
    brand: { name: '主持工作台', seal: '台', tagline: '婚礼主持工作台', backupName: '工作台备份' },
    theme: { wine: '#8C3B47', gold: '#AF8850' },
    color: (n) => n === 'wine' ? '#8C3B47' : '#AF8850',
    key: (n) => 'wb.demo.' + n,
    segments: []
  };

  /* canvas 不能用 CSS 变量，必须拿具体色值。
     统一从这里取，保证页面和导出的长图是同一个颜色。 */
  const C = {
    get wine() { return CFG.color('wine'); },
    get gold() { return CFG.color('gold'); },
    get sage() { return CFG.color('sage'); }
  };

  const LS_KEY = CFG.key('hostdesk.v1');
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------------- 存储（沙箱 / 隐私模式下 localStorage 可能直接抛错，全部兜底） ---------------- */
  const STORE = (function () {
    let ok = true; const mem = {}; const failCbs = [];
    try { localStorage.setItem('__probe__', '1'); localStorage.removeItem('__probe__'); } catch (e) { ok = false; }
    function fire(e) { failCbs.forEach(f => { try { f(e); } catch (e2) { } }); }
    return {
      available: () => ok,
      ok: () => ok,
      onFail(fn) { failCbs.push(fn); if (!ok) fire(new Error('unavailable')); },
      get(k) {
        if (ok) { try { return localStorage.getItem(k); } catch (e) { ok = false; fire(e); } }
        return mem[k] === undefined ? null : mem[k];
      },
      set(k, v) {
        mem[k] = v;
        if (!ok) return false;
        try { localStorage.setItem(k, v); return true; }
        catch (e) { ok = false; fire(e); return false; }
      },
      /* 估个用量：localStorage 按 UTF-16 计，2 字节/字符 */
      used() {
        if (!ok) return 0;
        let n = 0;
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            n += ((localStorage.getItem(k) || '').length + String(k).length) * 2;
          }
        } catch (e) { }
        return n;
      }
    };
  })();

  const DB_VERSION = 3;

  /* 老数据 / 残缺字段统一补齐，避免某一场缺字段让整个视图渲染崩掉 */
  function normalize(raw) {
    const seed = window.SEED_DB;
    const db = Object.assign({}, seed, raw || {});
    db.version = DB_VERSION;
    db.profile = Object.assign({}, seed.profile, raw && raw.profile);
    db.style = Object.assign({}, seed.style, raw && raw.style, { prefs: Object.assign({}, seed.style.prefs, raw && raw.style && raw.style.prefs) });
    if (!Array.isArray(db.style.samples)) db.style.samples = clone(seed.style.samples);
    /* 风格档：'custom' = 只用旧稿画像；s2/s4/s8 = 套装风格 */
    if (!db.style.pack || !(window.Pack && Pack.byId(db.style.pack) || db.style.pack === 'custom')) db.style.pack = 'custom';
    if (!Array.isArray(db.materials)) db.materials = clone(seed.materials || []);
    if (!Array.isArray(db.templates)) db.templates = clone(seed.templates || []);
    db.materials = db.materials.filter(m => m && String(m.text || '').trim())
      .map(m => Object.assign({ id: uid(), kind: '金句', seg: '', note: '', date: '' }, m));
    if (!Array.isArray(db.todos)) db.todos = clone(seed.todos);
    const list = Array.isArray(db.weddings) && db.weddings.length ? db.weddings : clone(seed.weddings);
    db.weddings = list.map(w => {
      const m = Object.assign({
        id: uid(), date: '', time: '', hotel: '', city: '', status: '咨询中',
        fee: 0, planner: '', contact: '', guests: 0
      }, w || {});
      m.couple = Object.assign({ bride: '', groom: '', brideJob: '', groomJob: '' }, (w && w.couple) || {});
      m.survey = Object.assign({}, (w && w.survey) || {});
      m.scripts = Object.assign({}, (w && w.scripts) || {});
      if (!Array.isArray(m.flow) || !m.flow.length) m.flow = clone(window.SEED_FLOWS).map(f => Object.assign({ id: uid() }, f));
      if (!Array.isArray(m.songs) || !m.songs.length) m.songs = clone(window.SEED_SONGS).map(s => Object.assign({ id: uid() }, s));
      return m;
    });
    return db;
  }

  /* 首次打开（这台浏览器里从没存过数据）= 需要给个入口选择：看示例 / 从空白开始 */
  let FIRST_RUN = false;

  function boot() {
    let rawText = null;
    try { rawText = STORE.get(LS_KEY); } catch (e) { rawText = null; }
    FIRST_RUN = !rawText;
    let raw = null;
    try { raw = JSON.parse(rawText); } catch (e) { raw = null; }
    const isNew = !raw || !Array.isArray(raw.weddings) || !raw.weddings.length;
    const db = normalize(raw);
    if (isNew) {
      // 给最近一场预置两段草稿
      const w2 = db.weddings.find(w => w.id === 'w2');
      if (w2) {
        ['warm', 'open'].forEach((k, i) => {
          const r = Engine.generate(w2, k, { samples: db.style.samples, prefs: db.style.prefs, hostName: db.profile.name, salt: i });
          w2.scripts[k] = { blocks: r.blocks, updated: Date.now(), final: false };
        });
      }
    }
    if (isNew || !raw || raw.version !== DB_VERSION) STORE.set(LS_KEY, JSON.stringify(db));
    return db;
  }

  let DB = boot();
  const save = () => STORE.set(LS_KEY, JSON.stringify(DB));

  /* 存储写失败不能再装作没事：立刻红条 + 备份出口（只提示一次） */
  let storeWarned = false;
  function storeBrokenWarn(e) {
    if (storeWarned) return;
    storeWarned = true;
    const bar = document.getElementById('jsErr');
    if (!bar) return;
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
    bar.innerHTML = '<b>保存已失效</b>' +
      (quota ? '本机浏览器给这个页面的存储写满了，之后的改动只在本次有效，刷新就没了。' : '这个环境不允许写入本机存储，改动只在本次有效。') +
      '先导出备份，再决定要不要清理。' +
      '<button class="js-err-x" data-store-x="1">×</button>' +
      '<span style="display:flex;gap:8px;margin-top:8px">' +
      '<button class="btn sm" id="storeBak" style="background:#FDF3EE;color:#7C2E28;border-color:transparent">立即导出备份</button>' +
      '<button class="btn sm" id="storeLater" style="background:transparent;color:#FDF3EE;border-color:rgba(253,243,238,.45)">知道了</button></span>';
    bar.classList.add('on');
    const bak = document.getElementById('storeBak');
    if (bak) bak.onclick = () => {
      try { download(JSON.stringify(DB, null, 2), `${CFG.brand.backupName || '工作台备份'}_${ymd(TODAY)}.json`); } catch (err) { }
    };
    const later = document.getElementById('storeLater');
    if (later) later.onclick = () => bar.classList.remove('on');
    const x = bar.querySelector('[data-store-x]');
    if (x) x.onclick = () => bar.classList.remove('on');
  }
  STORE.onFail(storeBrokenWarn);

  const state = {
    view: 'dash',
    wid: 'w2',
    seg: 'open',
    scriptTab: 'write',
    calMonth: (function () {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    })(),
    selDate: null,
    salt: 0,
    typing: null,
    focusSong: null,                  // 播放器 → 歌单：定位到哪首歌
    focusCue: null,                   // 歌单 → 播放器：定位到哪个环节
    play: { on: false, t: 0, timer: null, speed: 20 }
  };

  /* ---------------- 时间工具 ---------------- */
  const TODAY = new Date();
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
  function daysTo(s) { const a = parseYmd(ymd(TODAY)); const b = parseYmd(s); return Math.round((b - a) / 86400000); }
  function addMin(hhmm, min) {
    if (!hhmm || hhmm.indexOf(':') < 0) return '';
    const [h, m] = hhmm.split(':').map(Number);
    const t = h * 60 + m + Math.round(Number(min) || 0);
    return String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(((t % 60) + 60) % 60).padStart(2, '0');
  }
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  function prettyDate(s) {
    const d = parseYmd(s);
    return `${d.getMonth() + 1}月${d.getDate()}日 · 周${WD[d.getDay()]}`;
  }

  /* ---------------- 首次访问 / 数据重置 ----------------
     分享出去以后，别人第一次打开不该直接看到「某个人的客户名单」。
     所以留一个入口：看演示，或者从空白开始。 */
  const ONB_KEY = CFG.key('onboard.v1');

  function blankWedding() {
    const d = new Date(TODAY.getTime() + 30 * 86400000);
    return {
      id: uid(), date: ymd(d), time: '18:08', hotel: '', city: '',
      status: '咨询中', fee: 0, planner: '', contact: '', guests: 0,
      couple: { bride: '', groom: '', brideJob: '', groomJob: '' },
      survey: { how: '', story: '', like: '', parents: '', taboo: '', surprise: '', mustSay: '', guestsStruct: '', extra: '' },
      flow: [], songs: [], scripts: {}
    };
  }

  function blankDB() {
    const seed = window.SEED_DB;
    return normalize({
      profile: { name: '', slogan: '', brand: seed.profile.brand, phone: '', city: '' },
      style: { pack: 'custom', prefs: clone(seed.style.prefs), samples: [] },
      materials: [], templates: [], todos: [],
      weddings: [blankWedding()]
    });
  }

  const demoDB = () => normalize(clone(window.SEED_DB));

  function applyDB(next, msg) {
    DB = next;
    state.wid = DB.weddings[0].id;
    state.selDate = DB.weddings[0].date;
    state.calMonth = (DB.weddings[0].date || ymd(TODAY)).slice(0, 7);
    save(); renderShell(); render();
    if (msg) toast(msg);
  }

  function showWelcome() {
    if (document.body.querySelector('.welcome')) return;
    const el = document.createElement('div');
    el.className = 'welcome';
    el.innerHTML = `
      <div class="wl-card">
        <div class="wl-seal">${esc(CFG.brand.seal)}</div>
        <h2>${esc(CFG.brand.name)} · ${esc(CFG.brand.tagline)}</h2>
        <p class="wl-sub">问卷 → 台词 → 流程 → 歌单 → 现场，一个页面走完。电脑和手机都能用，断网也能用。</p>
        <ul class="wl-list">
          <li><b>数据存在你自己的浏览器里</b>，不上传也不共享；换设备用「导出备份」搬过去。</li>
          <li>下面这份是<b>演示数据</b>：4 场虚构婚礼，可以随便改、随便删、随便试。</li>
          <li>随时能在工作台底部「恢复演示数据」或「清空重来」。</li>
        </ul>
        <div class="wl-acts">
          <button class="btn primary" id="wlDemo">先看演示（4 场）</button>
          <button class="btn" id="wlBlank">从空白开始</button>
        </div>
        <p class="wl-foot">纯前端页面 · 不收集任何个人信息 · 建议用 Chrome / Edge / Safari</p>
      </div>`;
    document.body.appendChild(el);
    const done = (kind) => {
      STORE.set(ONB_KEY, kind);
      el.classList.add('out');
      setTimeout(() => el.remove(), 240);
    };
    $('#wlDemo').onclick = () => { done('demo'); toast('已载入 4 场演示，随便改'); };
    $('#wlBlank').onclick = () => {
      done('blank');
      applyDB(blankDB(), '已清空，去「档期管理」建第一场');
      go('calendar');
    };
  }

  const curW = () => DB.weddings.find(w => w.id === state.wid) || DB.weddings[0];
  const segMeta = (key) => Engine.SEGMENTS.find(s => s.key === key) || { name: key, dur: 3 };
  const flowTotal = (w) => (w.flow || []).reduce((a, f) => a + (Number(f.dur) || 0), 0);
  const mmss = (min) => `${Math.floor(min)}′${String(Math.round((min % 1) * 60)).padStart(2, '0')}″`;

  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 1900);
  }
  let modalReturn = null;
  function openModal(title, html) {
    const bg = $('#modalBg');
    if (!bg.classList.contains('on')) modalReturn = document.activeElement;
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    bg.classList.add('on');
    bg.setAttribute('role', 'dialog');
    bg.setAttribute('aria-modal', 'true');
    bg.setAttribute('aria-labelledby', 'modalTitle');
    const first = $('#modalBody').querySelector('input,textarea,select,button');
    setTimeout(() => { try { (first || $('#modalClose')).focus(); } catch (e) { } }, 30);
  }
  function closeModal() {
    const bg = $('#modalBg');
    if (!bg || !bg.classList.contains('on')) return;
    bg.classList.remove('on');
    try { if (modalReturn && modalReturn.focus) modalReturn.focus(); } catch (e) { }
    modalReturn = null;
  }
  /* 弹窗内 Tab 只在弹窗里循环，别跑到背后的页面上 */
  $('#modalBg').addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const list = Array.prototype.filter.call(
      $('#modalBg').querySelectorAll('button,input,textarea,select,[tabindex]:not([tabindex="-1"])'),
      el => !el.disabled && el.offsetParent !== null
    );
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------------- 模型设置：每个用户填自己的 key ---------------- */
  function openModelModal(afterSave) {
    const c = LLM.read();
    const miss = LLM.missing();
    const presets = LLM.presets();
    let presetId = c.preset || '';

    openModal('模型设置 · 用你自己的 key', `
      <p class="tiny muted" style="margin:0 0 12px;line-height:1.85">
        出稿要接一个大模型。这里填<b>你自己的</b>接口，费用走你自己的账号，与其他使用者无关。
        key 只存在这台设备的浏览器里，不上传，也不会写进「导出备份」。<b>公用电脑上别填。</b>
      </p>
      <div class="fld full" style="margin-bottom:12px">
        <label>服务商 <em>点一下自动填好地址和模型名，只剩 key 要填</em></label>
        <div class="tones" id="pmPresets" style="margin-top:6px">
          ${presets.map(p => `<button type="button" class="tone ${c.preset === p.id ? 'on' : ''}" data-pm="${p.id}">${esc(p.name)}</button>`).join('')}
        </div>
        <p class="tiny muted" id="pmNote" style="margin:8px 0 0;line-height:1.7">${esc((presets.find(p => p.id === presetId) || {}).note || '选一个服务商，也可以直接填下面的地址。')}</p>
      </div>
      <div style="display:grid;gap:10px">
        <div class="fld full"><label>接口地址 <em>OpenAI 兼容，一般以 /v1 结尾</em></label>
          <input id="pmBase" spellcheck="false" autocomplete="off" placeholder="https://api.deepseek.com/v1" value="${esc(c.base)}"></div>
        <div class="fld full"><label>API Key <em>只存本机，不上传</em></label>
          <div style="display:flex;gap:6px;align-items:stretch">
            <input id="pmKey" type="password" spellcheck="false" autocomplete="off" placeholder="sk-…" value="${esc(c.key)}" style="flex:1"> 
            <button type="button" class="btn ghost sm" id="pmEye" style="flex:0 0 auto">显示</button>
          </div></div>
        <div class="fld full"><label>模型名 <em>跟服务商文档一致，区分大小写</em></label>
          <input id="pmModel" spellcheck="false" autocomplete="off" list="pmModels" placeholder="deepseek-chat" value="${esc(c.model)}">
          <datalist id="pmModels"></datalist></div>
      </div>
      <div id="pmMsg" class="tiny" style="margin-top:10px;line-height:1.75;color:${miss.length ? 'var(--wine)' : 'var(--ink-3)'}">${miss.length ? '还差：' + miss.join('、') : '已配置：' + esc(LLM.providerName() || '自定义接口') + ' · ' + esc(c.model)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button class="btn primary sm" id="pmSave">保存</button>
        <button class="btn sm" id="pmTest">测试连接</button>
        <button class="btn ghost sm" id="pmClear">清空</button>
      </div>`);

    const msg = (t, bad) => {
      const el = $('#pmMsg');
      if (!el) return;
      el.textContent = t;
      el.style.color = bad ? 'var(--wine)' : 'var(--ink-3)';
    };
    const fillModels = (list) => {
      const dl = $('#pmModels');
      if (dl) dl.innerHTML = (list || []).map(m => `<option value="${esc(m)}"></option>`).join('');
    };
    fillModels((presets.find(p => p.id === presetId) || {}).models);

    const grab = () => ({
      preset: presetId,
      base: $('#pmBase').value.trim(),
      key: $('#pmKey').value.trim(),
      model: $('#pmModel').value.trim()
    });
    const persist = () => {
      const saved = LLM.save(grab());
      if ($('#pmBase')) $('#pmBase').value = saved.base;
      return saved;
    };

    $$('#pmPresets .tone').forEach(b => {
      b.onclick = () => {
        presetId = b.dataset.pm;
        $$('#pmPresets .tone').forEach(x => x.classList.toggle('on', x === b));
        const p = presets.find(x => x.id === presetId) || {};
        if (p.base) $('#pmBase').value = p.base;
        if (p.model) $('#pmModel').value = p.model;
        fillModels(p.models);
        const n = $('#pmNote'); if (n) n.textContent = p.note || '';
        msg(LLM.missing(grab()).length ? '还差：' + LLM.missing(grab()).join('、') : '填好 key 就能用了', LLM.missing(grab()).length > 0);
      };
    });

    $('#pmEye').onclick = () => {
      const inp = $('#pmKey');
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      $('#pmEye').textContent = show ? '隐藏' : '显示';
    };

    $('#pmSave').onclick = () => {
      const saved = persist();
      const left = LLM.missing(saved);
      if (left.length) { msg('还差：' + left.join('、'), true); return; }
      closeModal();
      toast('已保存：' + (LLM.providerName() || '自定义接口') + ' · ' + saved.model);
      if (afterSave) afterSave(saved);
    };

    $('#pmTest').onclick = async () => {
      const saved = persist();
      const left = LLM.missing(saved);
      if (left.length) { msg('还差：' + left.join('、'), true); return; }
      const btn = $('#pmTest');
      const old = btn.textContent;
      btn.disabled = true; btn.textContent = '测试中…';
      msg('正在连 ' + saved.base + ' …');
      try {
        const r = await LLM.test();
        msg('连上了（' + r.ms + ' ms）· ' + r.model + ' 可用', false);
        toast('连接正常');
      } catch (e) {
        msg(LLM.describe(e), true);
      } finally {
        btn.disabled = false; btn.textContent = old;
      }
    };

    $('#pmClear').onclick = () => {
      LLM.clear();
      presetId = '';
      $('#pmBase').value = ''; $('#pmKey').value = ''; $('#pmModel').value = '';
      $$('#pmPresets .tone').forEach(x => x.classList.remove('on'));
      fillModels([]);
      msg('已清空。清空后大模型不可用，出稿会走本地引擎。', false);
      if (afterSave) afterSave(null);
    };
  }

  /* ---------------- 进度 ---------------- */
  function progress(w) {
    const surveyFields = ['how', 'story', 'like', 'parents', 'taboo', 'mustSay'];
    const filled = surveyFields.filter(k => (w.survey && (w.survey[k] || '').trim())).length;
    const allScripts = Object.values(w.scripts || {}).filter(s => s && s.blocks && s.blocks.length);
    const finalSeg = allScripts.filter(s => s.final).length;
    const flowDone = (w.flow || []).length >= 8 ? 1 : 0;
    const songsDone = (w.songs || []).filter(s => s.title).length >= 8 ? 1 : 0;
    return {
      survey: Math.round(filled / surveyFields.length * 100),
      script: Math.round(allScripts.length / Engine.SEGMENTS.length * 100),
      flow: flowDone ? 100 : Math.round((w.flow || []).length / 8 * 100),
      songs: songsDone ? 100 : Math.round(((w.songs || []).filter(s => s.title).length) / 8 * 100),
      finalSeg,
      drafted: allScripts.length
    };
  }

  /* ================================================================
     侧栏 / 顶栏
     ================================================================ */
  function renderShell() {
    $$('#nav a').forEach(a => {
      a.classList.toggle('on', a.dataset.v === state.view);
      a.setAttribute('role', 'button');
      if (a.dataset.v === state.view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const w = curW();
    $('#pkDay').textContent = (w.date || '').slice(8, 10) || '--';
    $('#pkNames').textContent = `${(w.couple.bride || '—')} & ${(w.couple.groom || '—')}`;
    $('#pkWhere').textContent = w.hotel || '场地待定';
    const drafts = Object.values(w.scripts || {}).filter(s => s && !s.final).length;
    const finals = Object.values(w.scripts || {}).filter(s => s && s.final).length;
    $('#badgeScript').textContent = finals ? `${finals}/12` : (drafts ? `${drafts} 段` : '—');
    const note = $('#sideNote');
    if (note) {
      if (!STORE.ok()) {
        note.innerHTML = '<b style="color:#8C3A32">保存已失效</b> · 改动只在本次有效，先导出备份';
      } else {
        const kb = Math.round(STORE.used() / 1024);
        note.textContent = DB.profile.brand + ' · 已用 ' + (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB') + ' · 存本机浏览器';
      }
    }
  }

  /* 导航用事件委托绑一次，避免任何重绘把 onclick 冲掉 */
  (function bindNav() {
    const nav = $('#nav');
    if (!nav) return;
    nav.addEventListener('click', function (e) {
      const a = e.target.closest ? e.target.closest('a[data-v]') : null;
      if (!a) return;
      e.preventDefault();
      go(a.dataset.v);
    });
  })();

  function renderPicker() {
    const menu = $('#pickerMenu');
    const list = DB.weddings.slice().sort((a, b) => a.date.localeCompare(b.date));
    menu.innerHTML = list.map(w => `
      <div class="opt ${w.id === state.wid ? 'on' : ''}" data-id="${w.id}">
        <span class="d" style="font-family:var(--serif);color:var(--wine);font-size:13px">${esc(w.date.slice(5))}</span>
        <span>${esc(w.couple.bride)} &amp; ${esc(w.couple.groom)}</span>
        <small>${esc(w.status)}</small>
      </div>`).join('');
    $$('.opt', menu).forEach(el => el.onclick = () => {
      state.wid = el.dataset.id;
      state.selDate = curW().date;
      menu.classList.remove('on');
      renderShell(); render();
    });
  }
  $('#pickerBtn').onclick = () => {
    const m = $('#pickerMenu');
    if (!m.classList.contains('on')) renderPicker();
    m.classList.toggle('on');
  };
  document.addEventListener('click', e => {
    const m = $('#pickerMenu');
    if (m && !e.target.closest('#picker')) m.classList.remove('on');
  });
  $('#modalClose').onclick = closeModal;
  $('#modalBg').onclick = e => { if (e.target.id === 'modalBg') closeModal(); };
  /* 导出弹窗 / 导出记录里的按钮，统一委托 */
  $('#modalBody').addEventListener('click', e => {
    const b = e.target.closest ? e.target.closest('[data-exp]') : null;
    if (!b) return;
    e.preventDefault();
    exportAction(b.dataset.exp);
  });
  const expBtn = $('#openExports');
  if (expBtn) expBtn.onclick = () => exportListModal();

  const PAGES = {
    dash: ['系统工作台', '今天的场次、待办与断点'],
    script: ['一键主持稿', '选场景 → 认骨架 → 填名单 → 一键出整篇'],
    calendar: ['档期管理', '咨询、已定、已完成的每一场'],
    survey: ['调查问卷', '新人问卷 · 婚庆问卷导入 · 补充访谈'],
    flow: ['流程表', '拖动排序，一键出图片版与文字版'],
    songs: ['婚礼歌单', '每个环节用哪首、从第几秒进'],
    sandbox: ['演示沙盘', '给新人看一遍，胜过说十遍'],
    player: ['播放器', '现场跟着走的时间轴'],
    prompter: ['提词器', '大字滚动，现场照着念'],
    templates: ['图片模板', '报价单 · 流程表 · 订单确认函']
  };

  /* how: 'push' 正常跳转 / 'replace' 覆盖当前历史 / 'none' 由 popstate 触发，不再写历史 */
  function go(v, how) {
    if (!PAGES[v]) return;
    if (v !== 'prompter') tpDestroy();
    clearInterval(state.typing);
    if (state.view !== v) { stopPlay(); stopRowPlay(); plHalt(); }
    state.view = v;
    const mode = how || 'push';
    try {
      if (mode === 'push' && history.pushState) history.pushState({ v: v }, '', '#' + v);
      else if (mode === 'replace' && history.replaceState) history.replaceState({ v: v }, '', '#' + v);
    } catch (e) { }
    renderShell();
    const [t, s] = PAGES[v] || ['', ''];
    $('#pgTitle').textContent = t;
    $('#pgSub').textContent = s;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function topMeta() {
    const w = curW();
    const d = daysTo(w.date);
    const dd = d > 0 ? `还有 <b>${d}</b> 天` : (d === 0 ? '<b>今天</b>' : `已过 <b>${-d}</b> 天`);
    $('#topMeta').innerHTML = `
      <span class="chip"><span class="dot"></span>${esc(w.status)}</span>
      <span class="chip">${esc(prettyDate(w.date))} ${esc(w.time || '')}</span>
      <span class="chip">${dd}</span>`;
  }

  /* ================================================================
     ① 系统工作台
     ================================================================ */
  function renderDash() {
    const w = curW();
    const p = progress(w);
    const upcoming = DB.weddings.filter(x => daysTo(x.date) >= 0).sort((a, b) => a.date.localeCompare(b.date));
    const next = upcoming[0] || w;
    const nn = daysTo(next.date);
    const todoOpen = DB.todos.filter(t => !t.done).length;
    const monthCount = DB.weddings.filter(x => x.date.slice(0, 7) === ymd(TODAY).slice(0, 7)).length;

    const kpis = [
      { k: '最近一场倒计时', v: nn >= 0 ? nn : '—', u: '天', d: `${prettyDate(next.date)} · ${next.couple.bride} & ${next.couple.groom}`, accent: true, act: `data-dash="next"` },
      { k: '本月场次', v: monthCount, u: '场', d: `${ymd(TODAY).slice(0, 7).replace('-', ' / ')} 已排`, act: 'data-dash="month"' },
      { k: '台词进度', v: p.drafted, u: '/ 12 段', d: `已定稿 ${p.finalSeg} 段 · 其余为草稿`, act: 'data-dash="script"' },
      { k: '待办未完成', v: todoOpen, u: '项', d: `共 ${DB.todos.length} 条待办`, act: 'data-dash="todo"' }
    ];

    $('#view').innerHTML = `
      <div class="kpis">
        ${kpis.map((k, i) => `
        <div class="kpi ${k.accent ? 'accent' : ''}" ${k.act} role="button" tabindex="0" title="点击查看">
          <div class="k">${k.k}</div>
          <div class="v">${k.v}<small>${k.u}</small></div>
          <div class="d">${esc(k.d)}</div>
          ${k.accent ? '' : spark(i)}
        </div>`).join('')}
      </div>

      <div class="dash-grid">
        <div>
          <div class="card next-card sect">
            <div class="next-hero">
              <div class="when"><b>${esc(next.status)}</b><span>${esc(prettyDate(next.date))} · ${esc(next.time || '')}</span></div>
              <div class="names">${esc(next.couple.bride)}<i>&amp;</i>${esc(next.couple.groom)}</div>
              <div class="where">${esc(next.hotel)} · ${next.guests || '—'} 人</div>
              <div class="cd"><b>${nn >= 0 ? nn : '—'}</b><span>${nn >= 0 ? 'DAYS LEFT' : '已结束'}</span></div>
            </div>
            <div class="card-b">
              <div class="sect-h" style="margin-bottom:10px"><h3>四件事的完成度</h3><span>问卷 → 台词 → 流程 → 歌单，一条线串起来</span><div class="spacer"></div>
                <button class="btn sm" id="openNext" data-dash="next">进入这一场</button></div>
              ${progBar('问卷', p.survey, 'survey')}
              ${progBar('台词', p.script, 'script')}
              ${progBar('流程', p.flow, 'flow')}
              ${progBar('歌单', p.songs, 'songs')}
            </div>
          </div>

          <div class="card sect" id="todoCard">
            <div class="card-h"><h3>正在等的几件事</h3><span class="hint">${todoOpen} 项未完成</span></div>
            <div class="todo-list">
              ${DB.todos.map(t => `
                <div class="todo ${t.done ? 'done' : ''}" data-todo="${t.id}">
                  <span class="box"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M4 12l6 6L20 6"/></svg></span>
                  <span class="t">${esc(t.text)}</span>
                  <span class="meta">${esc(t.due)}</span>
                </div>`).join('')}
            </div>
          </div>

          <div class="card" id="aboutCard">
            <div class="card-h"><h3>这个工作台</h3><span class="hint">数据在你自己这台浏览器里</span></div>
            <div class="card-b">
              <p class="tiny muted" style="margin:0 0 10px;line-height:1.8">
                纯前端页面，不联网也能用；数据不上传、不共享。换电脑或换手机，用「导出备份」搬过去。
                现在这份是演示数据，可以随便改。
              </p>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn sm" id="dbExport">导出备份</button>
                <button class="btn sm" id="dbModel">模型设置</button>
                <button class="btn sm" id="dbDemo">恢复演示数据</button>
                <button class="btn sm ghost" id="dbBlank">清空重来</button>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="card sect">
            <div class="card-h"><h3>${esc(state.calMonth.replace('-', ' 年 '))} 月</h3><span class="hint">${upcoming.length} 场待办</span></div>
            <div class="mini-cal">
              <div class="wk">${WD.map(d => `<span>${d}</span>`).join('')}</div>
              <div class="days">${miniCal(state.calMonth)}</div>
            </div>
          </div>

          <div class="card sect" data-dash="style" role="button" title="去风格微调">
            <div class="card-h"><h3>风格画像</h3><span class="hint">${curPack() ? '风格档 ' + esc(curPack().name) : '来自 ' + DB.style.samples.length + ' 段旧稿'} · 点开可微调</span></div>
            <div class="card-b">
              <div class="style-bars">
                ${Object.entries(Engine.analyzeStyle(DB.style.samples, DB.style.prefs, curPack() ? curPack().id : null).dims).map(([k, v]) => `
                  <div class="b"><span>${k}</span><span class="track"><i class="fill" style="width:${v}%"></i></span><span class="v">${v}</span></div>`).join('')}
              </div>
              <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:12px">
                ${Engine.analyzeStyle(DB.style.samples, DB.style.prefs, curPack() ? curPack().id : null).tags.map(t => `<span class="tag line">${esc(t)}</span>`).join('')}
              </div>
              <button class="btn sm" style="margin-top:12px" data-go="script">一键出稿</button>
            </div>
          </div>

          <div class="card sect">
            <div class="card-h"><h3>这一场的断点</h3></div>
            <div class="card-b">
              ${gaps(w)}
            </div>
          </div>
        </div>
      </div>`;

    $$('[data-todo]').forEach(el => el.classList.add('clk'));

    /* 「这个工作台」卡片：备份 / 恢复演示 / 清空 */
    const bExp = $('#dbExport');
    if (bExp) bExp.onclick = () => {
      const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
      saveBlob(blob, `${CFG.brand.backupName || '工作台备份'}_${ymd(TODAY)}.json`, { kind: 'json' });
    };
    const bDemo = $('#dbDemo');
    const bModel = $('#dbModel');
    if (bModel) bModel.onclick = () => openModelModal(() => renderDash());
    if (bDemo) bDemo.onclick = () => {
      openModal('恢复演示数据？', `
        <p class="tiny" style="line-height:1.9;margin:0;color:var(--ink-2)">现在这 ${DB.weddings.length} 场会被替换成 4 场虚构的演示婚礼，稿件、歌单、音频一起清掉。想留底，先点「导出备份」。</p>
        <div style="display:flex;gap:8px;margin-top:16px"><button class="btn primary" id="dbDemoYes">恢复演示</button><button class="btn" id="dbDemoNo">取消</button></div>`);
      $('#dbDemoYes').onclick = () => { closeModal(); applyDB(demoDB(), '已恢复演示数据（4 场）'); go('dash'); };
      $('#dbDemoNo').onclick = closeModal;
    };
    const bBlank = $('#dbBlank');
    if (bBlank) bBlank.onclick = () => {
      openModal('清空重来？', `
        <p class="tiny" style="line-height:1.9;margin:0;color:var(--ink-2)">${DB.weddings.length} 场婚礼、全部稿件、歌单、待办都会被清掉，只留一场空白场次。这个动作不能撤销，先「导出备份」更稳妥。</p>
        <div style="display:flex;gap:8px;margin-top:16px"><button class="btn primary" id="dbBlankYes">清空</button><button class="btn" id="dbBlankNo">取消</button></div>`);
      $('#dbBlankYes').onclick = () => { closeModal(); applyDB(blankDB(), '已清空，去「档期管理」建第一场'); go('calendar'); };
      $('#dbBlankNo').onclick = closeModal;
    };
  }

  /* 工作台交互统一用委托：重绘、切换场次都不会把事件冲掉 */
  (function bindDashEvents() {
    const view = $('#view');
    view.addEventListener('click', (e) => {
      const t = e.target.closest('[data-dash],[data-cal],[data-go],[data-goto],[data-todo]');
      if (!t || !view.contains(t)) return;

      if (t.dataset.todo) {
        const td = DB.todos.find(x => x.id === t.dataset.todo);
        if (!td) return;
        td.done = !td.done; save(); renderDash(); return;
      }
      if (t.dataset.cal) {
        const ds = t.dataset.cal;
        const hit = DB.weddings.find(x => x.date === ds);
        if (hit) { state.wid = hit.id; state.selDate = ds; renderShell(); go('calendar'); }
        else { state.selDate = ds; go('calendar'); }
        return;
      }
      const act = t.dataset.dash;
      if (act) {
        const w = curW();
        if (act === 'next') {
          const nx = DB.weddings.filter(x => daysTo(x.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0];
          if (nx) { state.wid = nx.id; state.selDate = nx.date; renderShell(); }
          go('script'); return;
        }
        if (act === 'month') return go('calendar');
        if (act === 'script') return go('script');
        if (act === 'style') { state.scriptTab = 'style'; return go('script'); }
        if (act === 'todo') {
          const c = $('#todoCard');
          if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
      const target = t.dataset.go || t.dataset.goto;
      if (target) go(target);
    });
    view.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target.closest && e.target.closest('[data-dash]');
      if (!t) return;
      e.preventDefault(); t.click();
    });
  })();

  function spark(i) {
    const sets = [
      [8, 10, 9, 12, 11, 14], [3, 5, 4, 6, 5, 6], [2, 3, 3, 4, 5, 6], [6, 5, 7, 6, 8, 7]
    ];
    const arr = sets[i % sets.length];
    const max = Math.max(...arr);
    const pts = arr.map((v, j) => `${j * 9},${18 - (v / max) * 14}`).join(' ');
    return `<svg class="spark" width="46" height="20" viewBox="0 0 46 20"><polyline points="${pts}" fill="none" stroke="rgba(var(--wine-rgb),.42)" stroke-width="1.4"/></svg>`;
  }

  const progBar = (label, v, target) => `
    <div class="pg" data-goto="${target}">
      <span class="pg-l">${label}</span>
      <span class="pg-t"><i class="${v >= 100 ? 'full' : ''}" style="width:${v}%"></i></span>
      <span class="pg-v ${v >= 100 ? 'full' : ''}">${v}%</span>
    </div>`;

  function miniCal(month) {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const startPad = first.getDay();
    const total = new Date(y, m, 0).getDate();
    const prevTotal = new Date(y, m - 1, 0).getDate();
    let html = '';
    for (let i = startPad - 1; i >= 0; i--) html += `<span class="d out">${prevTotal - i}</span>`;
    for (let d = 1; d <= total; d++) {
      const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const hit = DB.weddings.filter(w => w.date === ds);
      const hasEvt = hit.length > 0;
      const isToday = ds === ymd(TODAY);
      html += `<span class="d ${hasEvt ? 'has' : ''} ${isToday ? 'today' : ''}" ${hasEvt || isToday ? `data-cal="${ds}" role="button"` : ''} title="${hasEvt ? esc(hit.map(x => (x.couple.bride || '') + ' & ' + (x.couple.groom || '')).join(' / ')) : (isToday ? '今天' : '')}">${d}</span>`;
    }
    const rest = (7 - ((startPad + total) % 7)) % 7;
    for (let d = 1; d <= rest; d++) html += `<span class="d out">${d}</span>`;
    return html;
  }

  function gaps(w) {
    const out = [];
    if (!(w.survey.story || '').trim()) out.push(['问卷', '恋爱故事还没填，开场白只能写通用版', 'survey']);
    if (!(w.survey.taboo || '').trim()) out.push(['避讳', '没写避讳，台词里容易踩雷', 'survey']);
    const finals = Object.values(w.scripts || {}).filter(s => s && s.final).length;
    if (finals < 12) out.push(['台词', `还有 ${12 - finals} 个环节没定稿`, 'script']);
    const noSong = (w.songs || []).filter(s => !s.title).length;
    if (noSong) out.push(['歌单', `${noSong} 个环节还没配歌`, 'songs']);
    if (!out.length) return `<p class="tiny muted" style="margin:0">这一场该补的都补了。开演前 24 小时再对一遍流程就好。</p>`;
    return out.map(([tag, txt, to]) => `
      <div style="display:flex;gap:9px;align-items:flex-start;padding:7px 0;border-bottom:1px dashed var(--line);cursor:pointer" data-goto="${to}">
        <span class="tag wine" style="flex:none">${tag}</span>
        <span class="tiny" style="color:var(--ink-2);line-height:1.55">${esc(txt)}</span>
      </div>`).join('');
  }

  /* ================================================================
     ② 一键主持稿
     - 模式：选场景 → 认骨架 → 填名单与调性 → 一键出整篇
     - 引擎：本地规则（不编人、缺素材留占位），风格来自「风格库」
     ================================================================ */

  /* 婚礼场景库：每个场景 = 一串真实存在的环节骨架 */
  const SCENES = [
    {
      id: 'full', name: '整场仪式', desc: '从暖场到礼成，一次出全篇', list: [
        { id: 'lawn', name: '户外草坪仪式', tones: ['温情真挚', '轻松欢快', '诗意雅致'],
          desc: '场地本身就是开场素材',
          segs: ['warm', 'open', 'groom', 'bride', 'together', 'vows', 'rings', 'kiss', 'parents', 'bouquet', 'toast', 'end'] },
        { id: 'hall', name: '宴会厅室内仪式', tones: ['端庄大气', '温情真挚', '喜庆热烈'],
          desc: '灯光与舞台调度更重',
          segs: ['warm', 'open', 'groom', 'bride', 'together', 'vows', 'rings', 'kiss', 'parents', 'toast', 'end'] },
        { id: 'chinese', name: '中式 · 敬茶为主', tones: ['端庄大气', '喜庆热烈', '温情真挚'],
          desc: '改口敬茶放中段，长辈戏份重',
          segs: ['warm', 'open', 'groom', 'bride', 'parents', 'toast', 'end'] },
        { id: 'chapel', name: '教堂 · 证婚仪式', tones: ['端庄大气', '诗意雅致', '温情真挚'],
          desc: '短、静、留白多',
          segs: ['open', 'groom', 'bride', 'together', 'vows', 'rings', 'kiss', 'end'] },
        { id: 'small', name: '小型家宴 · 至亲局', tones: ['温情真挚', '轻松欢快', '幽默风趣'],
          desc: '二三十人，说话比仪式重要',
          segs: ['warm', 'open', 'vows', 'toast', 'end'] }
      ]
    },
    {
      id: 'part', name: '单环节', desc: '只缺这一段，直接上台', list: [
        { id: 'p_open', name: '开场白', tones: ['温情真挚', '端庄大气', '轻松欢快'], desc: '第一句话定调', segs: ['open'] },
        { id: 'p_bride', name: '新娘入场', tones: ['温情真挚', '诗意雅致', '喜庆热烈'], desc: '父亲交接那一刻', segs: ['bride'] },
        { id: 'p_vow', name: '誓言环节', tones: ['温情真挚', '诗意雅致', '端庄大气'], desc: '不替新人写誓词，只搭台', segs: ['vows'] },
        { id: 'p_ring', name: '交换戒指', tones: ['温情真挚', '轻松欢快', '喜庆热烈'], desc: '短句、别抢戏', segs: ['rings'] },
        { id: 'p_witness', name: '证婚人致辞', tones: ['端庄大气', '温情真挚', '简练务实'], desc: '介绍、请上台、收束，不复述致辞', segs: ['witness'] },
        { id: 'p_tea', name: '感恩敬茶', tones: ['温情真挚', '端庄大气', '诗意雅致'], desc: '最容易失控的一段', segs: ['parents'] },
        { id: 'p_folks', name: '父母致辞', tones: ['温情真挚', '端庄大气', '轻松欢快'], desc: '把话筒交给父母，你退半步', segs: ['folks'] },
        { id: 'p_toast', name: '交杯 · 举杯', tones: ['喜庆热烈', '轻松欢快', '端庄大气'], desc: '把杯子举起来', segs: ['toast'] },
        { id: 'p_end', name: '礼成送客', tones: ['温情真挚', '喜庆热烈', '轻松欢快'], desc: '合影与撤场引导', segs: ['end'] }
      ]
    },
    {
      id: 'family', name: '习俗 · 家宴', desc: '敬茶、回门、答谢', list: [
        { id: 'f_tea', name: '敬茶改口礼', tones: ['端庄大气', '温情真挚', '喜庆热烈'], desc: '两家父母，先女方后男方', segs: ['parents'] },
        { id: 'f_back', name: '回门 · 答谢宴', tones: ['喜庆热烈', '温情真挚', '轻松欢快'], desc: '轻一点，别端着', segs: ['warm', 'toast', 'end'] },
        { id: 'f_thanks', name: '答谢宴致辞', tones: ['温情真挚', '端庄大气', '简练务实'], desc: '三分钟讲完', segs: ['open', 'end'] }
      ]
    }
  ];

  /* 用户自建模板：把自己的场次结构存下来，下次直接套 */
  const myTemplates = () => (Array.isArray(DB.templates) ? DB.templates : []);
  function allCats() {
    const mine = myTemplates().map(t => ({
      id: 't_' + t.id, name: t.name, desc: t.note || '我的模板',
      tones: (t.tones && t.tones.length ? t.tones : ['温情真挚']),
      segs: t.segs || [], flow: t.flow || '', _tpl: t
    }));
    return SCENES.concat([{
      id: 'mine', name: '我的模板',
      desc: mine.length ? `${mine.length} 个自己存的` : '还没有，出稿页可「存成模板」',
      list: mine
    }]);
  }

  /* 调性 → 风格滑杆的偏移量（真的会改变句长、口语度、用典、幽默） */
  const TONE_MIX = {
    '温情真挚': { 温度: 82, 口语: 62, 用典: 30, 幽默: 24 },
    '喜庆热烈': { 温度: 88, 口语: 72, 用典: 24, 幽默: 46 },
    '轻松欢快': { 温度: 66, 口语: 86, 用典: 14, 幽默: 70 },
    '幽默风趣': { 温度: 60, 口语: 92, 用典: 10, 幽默: 86 },
    '诗意雅致': { 温度: 76, 口语: 38, 用典: 76, 幽默: 14 },
    '端庄大气': { 温度: 78, 口语: 48, 用典: 58, 幽默: 18 },
    '简练务实': { 温度: 64, 口语: 66, 用典: 22, 幽默: 28 }
  };

  function mixPrefs(prefs, tone) {
    const t = TONE_MIX[tone];
    const out = Object.assign({}, prefs);
    if (!t) return out;
    Object.keys(t).forEach(k => {
      const base = Number(out[k]);
      out[k] = Math.round((isFinite(base) ? base : 50) * 0.4 + t[k] * 0.6);
    });
    return out;
  }
  function renderScript() {
    const w = curW();
    const tabs = [['write', '一键主持稿'], ['lib', '我的模板库'], ['style', '风格微调']];
    $('#view').innerHTML = `
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
        <div class="tabs" style="flex:1;min-width:280px">
          ${tabs.map(([k, n]) => `<button data-tab="${k}" class="${state.scriptTab === k ? 'on' : ''}">${n}</button>`).join('')}
        </div>
        <span class="tiny muted">${esc(w.couple.bride)} &amp; ${esc(w.couple.groom)} · ${esc(prettyDate(w.date))}</span>
      </div>
      <div id="tabBody"></div>`;

    $$('[data-tab]').forEach(b => b.onclick = () => { state.scriptTab = b.dataset.tab; renderScript(); });
    if (state.scriptTab === 'write') renderWrite(w);
    if (state.scriptTab === 'lib') renderLib(w);
    if (state.scriptTab === 'style') renderStyleLib(w);
  }

  /* ---- 一键主持稿：状态 ---- */
  function ocState() {
    if (!state.oc) {
      state.oc = { cat: 'full', scene: 'lawn', tone: '', form: null, wid: null, res: null, flat: null, lints: [], salt: 0, useLib: true, engine: '', edit: false, edited: false, snap: null, saveTimer: 0 };
    }
    return state.oc;
  }
  function catOf(oc) {
    const cats = allCats();
    const c = cats.find(x => x.id === oc.cat);
    if (c && c.list.length) return c;
    return SCENES[0];
  }
  function sceneOf(oc, cat) { return cat.list.find(s => s.id === oc.scene) || cat.list[0]; }

  function guardFlow(segKeys) {
    return segKeys.map(k => (Engine.SEGMENTS.find(s => s.key === k) || {}).name).filter(Boolean).join('\n');
  }

  function fillForm(w, scene) {
    const s = w.survey || {};
    return {
      title: [w.couple.bride || '', w.couple.groom || ''].filter(Boolean).join(' & '),
      bride: w.couple.bride || '',
      groom: w.couple.groom || '',
      date: w.date || '',
      time: w.time || '',
      hotel: w.hotel || '',
      guests: s.guestsStruct || '',
      flow: guardFlow(scene.segs),
      mustSay: s.mustSay || '',
      taboo: s.taboo || '',
      extra: s.extra || ''
    };
  }

  /* 用户在「环节流程」里写的行 → 对应到引擎的环节 */
  function matchSeg(line) {
    const t = String(line).replace(/^[\s0-9０-９.、,，)）\-—·]+/, '').trim();
    if (!t) return null;
    return Engine.SEGMENTS.find(s => s.name === t)
      || Engine.SEGMENTS.find(s => t.indexOf(s.name) === 0 || s.name.indexOf(t) === 0)
      || Engine.SEGMENTS.find(s => t.indexOf(s.name) >= 0 || s.name.indexOf(t) >= 0)
      || null;
  }
  function resolveSegs(scene, flow) {
    const lines = String(flow || '').split('\n').map(x => x.trim()).filter(Boolean);
    const hit = [];
    lines.forEach(l => { const s = matchSeg(l); if (s && hit.indexOf(s.key) < 0) hit.push(s.key); });
    return hit.length ? hit : scene.segs.slice();
  }

  function composeAll(w, scene, form, tone, useLib) {
    const keys = resolveSegs(scene, form.flow);
    const segs = keys.map(k => Engine.SEGMENTS.find(s => s.key === k)).filter(Boolean);
    const prefs = mixPrefs(DB.style.prefs, tone);
    const lib = useLib !== false;
    const w2 = Object.assign({}, w, {
      couple: Object.assign({}, w.couple, { bride: form.bride || w.couple.bride, groom: form.groom || w.couple.groom }),
      hotel: form.hotel || w.hotel,
      survey: Object.assign({}, w.survey, {
        guestsStruct: form.guests || (w.survey || {}).guestsStruct,
        mustSay: form.mustSay || '',
        taboo: form.taboo || '',
        extra: form.extra || ''
      })
    });
    const groups = [], lints = [], used = [];
    const memo = { used: new Set(), generic: 0 };
    segs.forEach((seg, i) => {
      const r = Engine.generate(w2, seg.key, {
        samples: lib ? DB.style.samples : [],
        prefs: prefs, hostName: DB.profile.name, salt: (state.oc.salt || 0) + i * 7,
        pack: lib ? DB.style.pack : 'custom'
      });
      const blocks = (r.blocks || []).slice();
      if (lib) {
        const ins = pickMaterials(seg.key, memo);
        if (ins.length) {
          const add = [];
          ins.forEach(m => {
            memo.used.add(m.id);
            add.push({ t: 'note', text: '内容库 · ' + m.kind });
            add.push({ t: 'say', text: m.text });
            used.push(m);
          });
          const at = blocks.findIndex(b => b.t === 'say');
          if (at >= 0) blocks.splice(at + 1, 0, ...add);
          else blocks.push(...add);
        }
      }
      groups.push({ key: seg.key, name: seg.name, dur: seg.dur, blocks: blocks });
      (r.lint || []).forEach(l => lints.push(seg.name + '：' + l));
    });
    return { groups: groups, lints: lints, tone: tone, form: Object.assign({}, form), keys: keys, used: used };
  }

  /* 内容库命中：绑定到该环节的优先；不限环节的句子轮着用，全篇最多 4 条，不重复 */
  function pickMaterials(segKey, memo) {
    const all = (DB.materials || []).filter(m => String(m.text || '').trim());
    const own = all.filter(m => m.seg === segKey && !memo.used.has(m.id)).slice(0, 2);
    if (own.length) return own;
    if (memo.generic >= 4) return [];
    const gen = all.filter(m => (!m.seg || m.seg === 'any') && m.kind !== '称呼' && !memo.used.has(m.id));
    if (!gen.length) return [];
    memo.generic++;
    return gen.slice(0, 1);
  }

  function ocWordCount(flat) {
    if (!flat) return 0;
    return flat.filter(b => b.t === 'say').map(b => b.text).join('').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').length;
  }

  function renderOc(res, upto) {
    if (!res) return ocEmptyHtml(curW());
    const f = res.form || {};
    const head = `
      <div style="padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--line)">
        <div style="font-family:var(--serif);font-size:20px;letter-spacing:.04em;line-height:1.4">${esc(f.title || '婚礼主持稿')}</div>
        <div class="tiny muted" style="margin-top:5px;line-height:1.85">
          ${esc([f.date ? prettyDate(f.date) : '', f.time, f.hotel].filter(Boolean).join(' · ') || '时间地点待补')}<br>
          调性 ${esc(res.tone)} · ${esc(DB.profile.name)} · ${res.engine === 'cloud' ? '大模型' : '本地引擎'}
        </div>
      </div>`;
    let body = '', n = 0;
    res.groups.forEach(g => {
      n++;
      if (upto == null || n <= upto) body += `<h3 class="oc-h">${esc(g.name)}<small>${g.dur} 分钟</small></h3>`;
      (g.blocks || []).forEach(b => {
        n++;
        if (upto != null && n > upto) return;
        if (b.t === 'cue') body += `<div><span class="oc-cue">${esc(b.text)}</span></div>`;
        else if (b.t === 'note') body += `<div><span class="oc-note">${esc(b.text)}</span></div>`;
        else body += `<p>${esc(b.text)}</p>`;
      });
    });
    return head + body + (upto != null ? '<span class="oc-caret"></span>' : '');
  }

  /* ---------- 出稿后可编辑 ---------- */

  /* 把这一场已经存过的环节还原成一份可继续改的稿子 */
  function ocDraftRes(w) {
    if (!w || !w.scripts) return null;
    const keys = Engine.SEGMENTS.map(s => s.key)
      .filter(k => w.scripts[k] && (w.scripts[k].blocks || []).length);
    if (keys.length < 2) return null;
    const groups = keys.map(k => {
      const seg = Engine.SEGMENTS.find(s => s.key === k) || {};
      return {
        key: k, name: w.scripts[k].name || seg.name || k, dur: seg.dur || 5,
        blocks: JSON.parse(JSON.stringify(w.scripts[k].blocks))
      };
    });
    const oc = ocState();
    const scene = sceneOf(oc, catOf(oc));
    const form = oc.form || fillForm(w, scene);
    const updated = Math.max.apply(null, keys.map(k => w.scripts[k].updated || 0));
    return {
      groups, lints: [], tone: oc.tone || scene.tones[0],
      form: Object.assign({}, form), used: [], engine: 'local', draft: true, updated
    };
  }

  function ocEmptyHtml(w) {
    const d = ocDraftRes(w);
    let tip = '';
    if (d) {
      const dt = d.updated ? new Date(d.updated) : null;
      const when = dt ? `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}` : '';
      tip = `<div style="margin-top:16px"><button class="btn sm" id="btnLoadDraft">接着上次的稿子 · ${d.groups.length} 环节${when ? ' · ' + when + ' 存' : ''}</button>
        <div class="tiny muted" style="margin-top:8px">上次出稿（含手工改动）已经自动存过，不会丢。</div></div>`;
    }
    return `<div class="oc-empty">这张纸还空着。<br>左边选好场景、核对一下名单，点「一键出稿」。${tip}</div>`;
  }

  function renderOcEdit(res) {
    const f = res.form || {};
    const head = `<div class="oc-ed-head">
        <div class="oc-ed-title">${esc(f.title || '婚礼主持稿')}</div>
        <div class="tiny muted" style="margin-top:4px;line-height:1.8">${esc([f.date ? prettyDate(f.date) : '', f.time, f.hotel].filter(Boolean).join(' · ') || '时间地点待补')}　·　调性 ${esc(res.tone)}</div>
      </div>`;
    const body = res.groups.map((g, gi) => `
      <div class="oc-ed-g">
        <div class="oc-ed-gh">
          <input class="oc-ed-gname" data-gname="${gi}" value="${esc(g.name)}" aria-label="环节名称">
          <span class="oc-ed-gdur">${g.dur} 分钟</span>
        </div>
        ${(g.blocks || []).map((b, bi) => {
          const lab = b.t === 'cue' ? '提' : b.t === 'note' ? '注' : '词';
          const tname = b.t === 'cue' ? '舞台提示' : b.t === 'note' ? '备注' : '播读词';
          return `<div class="oc-ed-row">
            <textarea class="oc-ed-ta t-${esc(b.t)}" data-g="${gi}" data-b="${bi}" rows="1" spellcheck="false" aria-label="${tname}，第 ${bi + 1} 段">${esc(b.text)}</textarea>
            <div class="oc-ed-ops">
              <button data-ty="${gi}:${bi}" title="现在是${tname}，点一下换类型">${lab}</button>
              <button data-addb="${gi}:${bi}" title="在下面加一段">＋</button>
              <button class="danger" data-delb="${gi}:${bi}" title="删掉这一段">×</button>
            </div>
          </div>`;
        }).join('')}
        <button class="oc-ed-add" data-addend="${gi}">＋ 在这一环节末尾加一段</button>
      </div>`).join('');
    return head + body;
  }

  function ocRebuildFlat() {
    const oc = ocState();
    oc.flat = [];
    if (!oc.res) return;
    oc.res.groups.forEach(g => {
      oc.flat.push({ t: 'h' });
      (g.blocks || []).forEach(b => oc.flat.push(b));
    });
  }

  function ocRefreshMeta() {
    const oc = ocState();
    if (!oc.res) return;
    ocRebuildFlat();
    const m = $('.oc-meta');
    if (m) {
      const wc = ocWordCount(oc.flat);
      m.textContent = wc + ' 字 · 约 ' + Math.max(1, Math.round(wc / 220)) + ' 分钟播读';
    }
  }

  /* 改动落地：进内存 -> 立刻更新字数 -> 半秒后自动存草稿 */
  function ocMarkEdited() {
    const oc = ocState();
    oc.edited = true;
    ocRefreshMeta();
    const tag = $('#ocEdTag'); if (tag) tag.hidden = false;
    const rev = $('#btnOcRevert'); if (rev) rev.hidden = false;
    if (oc.saveTimer) clearTimeout(oc.saveTimer);
    oc.saveTimer = setTimeout(() => {
      oc.saveTimer = 0;
      if (oc.res) ocAutoSave(curW(), oc.res);
    }, 500);
  }

  function ocAutosize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(26, el.scrollHeight + 2) + 'px';
  }

  /* 重画纸面 + 重新绑事件（读 / 编辑两种形态共用） */
  function ocPaint(w) {
    const oc = ocState();
    const paper = $('#ocPaper');
    if (!paper) return;
    paper.classList.toggle('edit', !!(oc.edit && oc.res));
    paper.innerHTML = oc.res
      ? (oc.edit ? renderOcEdit(oc.res) : renderOc(oc.res, null))
      : ocEmptyHtml(w);
    bindOcEdit(w);
    const bar = $('#btnOcEdit');
    if (bar) { bar.textContent = oc.edit ? '完成编辑' : '✎ 编辑稿子'; bar.disabled = !oc.res; bar.classList.toggle('primary', !oc.edit && !!oc.res); }
    const rev = $('#btnOcRevert'); if (rev) rev.hidden = !(oc.edited && oc.snap);
    const tag = $('#ocEdTag'); if (tag) tag.hidden = !oc.edited;
  }

  function ocFocusBlock(gi, bi) {
    const el = $(`#ocPaper .oc-ed-ta[data-g="${gi}"][data-b="${bi}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} }
  }

  function ocAddBlock(gi, bi) {
    const oc = ocState();
    const g = oc.res && oc.res.groups[gi];
    if (!g) return;
    g.blocks = g.blocks || [];
    g.blocks.splice(bi + 1, 0, { t: 'say', text: '' });
    ocMarkEdited();
    ocPaint(curW());
    ocFocusBlock(gi, bi + 1);
  }

  function ocDelBlock(gi, bi) {
    const oc = ocState();
    const g = oc.res && oc.res.groups[gi];
    if (!g || !g.blocks[bi]) return;
    g.blocks.splice(bi, 1);
    ocMarkEdited();
    ocPaint(curW());
    const nx = Math.min(bi, g.blocks.length - 1);
    if (nx >= 0) ocFocusBlock(gi, nx);
  }

  function bindOcEdit(w) {
    const oc = ocState();

    const ld = $('#btnLoadDraft');
    if (ld) ld.onclick = () => {
      const d = ocDraftRes(w);
      if (!d) return toast('没找到草稿');
      oc.res = d; oc.lints = []; oc.edited = false; oc.edit = true;
      oc.snap = JSON.parse(JSON.stringify(d.groups));
      ocRefreshMeta();
      ocPaint(w);
      ocFocusBlock(0, 0);
      toast(`已载入上次的稿子：${d.groups.length} 个环节，可直接改`);
    };

    if (!oc.res) return;

    $$('#ocPaper .oc-ed-ta').forEach(ta => {
      ocAutosize(ta);
      ta.oninput = () => {
        const g = oc.res.groups[+ta.dataset.g];
        const b = g && g.blocks[+ta.dataset.b];
        if (!b) return;
        b.text = ta.value;
        ocAutosize(ta);
        ocMarkEdited();
      };
      ta.onblur = () => {
        if (oc.saveTimer) { clearTimeout(oc.saveTimer); oc.saveTimer = 0; }
        ocAutoSave(curW(), oc.res);
      };
      ta.onkeydown = (e) => {
        const gi = +ta.dataset.g, bi = +ta.dataset.b;
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); ocAddBlock(gi, bi); return; }
        if (e.key === 'Backspace' && ta.value === '') {
          const g = oc.res.groups[gi];
          if (g && (g.blocks || []).length > 1) { e.preventDefault(); ocDelBlock(gi, bi); }
        }
      };
    });

    $$('#ocPaper [data-gname]').forEach(el => {
      el.oninput = () => {
        const g = oc.res.groups[+el.dataset.gname];
        if (!g) return;
        g.name = el.value;
        ocMarkEdited();
      };
      el.onblur = () => { if (oc.saveTimer) { clearTimeout(oc.saveTimer); oc.saveTimer = 0; } ocAutoSave(curW(), oc.res); };
    });

    $$('#ocPaper [data-ty]').forEach(b => b.onclick = () => {
      const [gi, bi] = b.dataset.ty.split(':').map(Number);
      const blk = oc.res.groups[gi] && oc.res.groups[gi].blocks[bi];
      if (!blk) return;
      const order = ['say', 'cue', 'note'];
      blk.t = order[(order.indexOf(blk.t) + 1) % 3];
      ocMarkEdited();
      ocPaint(curW());
      const el = $(`#ocPaper .oc-ed-ta[data-g="${gi}"][data-b="${bi}"]`);
      if (el) el.focus();
      toast(blk.t === 'say' ? '已改为播读词（上台念）' : blk.t === 'cue' ? '已改为舞台提示（音乐/灯光/递物）' : '已改为备注（只给自己看）');
    });
    $$('#ocPaper [data-addb]').forEach(b => b.onclick = () => {
      const [gi, bi] = b.dataset.addb.split(':').map(Number);
      ocAddBlock(gi, bi);
    });
    $$('#ocPaper [data-delb]').forEach(b => b.onclick = () => {
      const [gi, bi] = b.dataset.delb.split(':').map(Number);
      const blk = oc.res.groups[gi] && oc.res.groups[gi].blocks[bi];
      if (blk && String(blk.text).trim()) {
        openModal('删掉这一段？', `
          <p class="tiny" style="line-height:1.85;margin:0;color:var(--ink-2)">「${esc(String(blk.text).slice(0, 26))}${String(blk.text).length > 26 ? '…' : ''}」</p>
          <p class="tiny muted" style="line-height:1.8;margin:8px 0 0">删掉后还能用底下的「还原到出稿版」整体恢复。</p>
          <div style="display:flex;gap:8px;margin-top:16px"><button class="btn primary" id="ocDelYes">删掉</button><button class="btn" id="ocDelNo">算了</button></div>`);
        $('#ocDelYes').onclick = () => { closeModal(); ocDelBlock(gi, bi); };
        $('#ocDelNo').onclick = closeModal;
        return;
      }
      ocDelBlock(gi, bi);
    });
    $$('#ocPaper [data-addend]').forEach(b => b.onclick = () => {
      const gi = +b.dataset.addend;
      const g = oc.res.groups[gi];
      if (!g) return;
      ocAddBlock(gi, (g.blocks || []).length - 1);
    });
  }

  function ocLintHtml(lints) {
    if (!lints || !lints.length) return '';
    return `<div style="margin-top:12px;background:var(--gold-soft);border:1px solid rgba(176,138,82,.3);border-radius:9px;padding:9px 12px">
      <div class="tiny" style="color:#7E5E2C;line-height:1.75">${lints.slice(0, 12).map(l => '· ' + esc(l)).join('<br>')}</div></div>`;
  }

  function ocMarkdown(res) {
    const f = res.form || {};
    const out = ['# ' + (f.title || '婚礼主持稿'), ''];
    out.push([f.date ? prettyDate(f.date) : '', f.time, f.hotel].filter(Boolean).join(' · '));
    out.push('调性：' + res.tone + ' · 主持：' + DB.profile.name);
    out.push('');
    res.groups.forEach(g => {
      out.push('## ' + g.name);
      g.blocks.forEach(b => {
        if (b.t === 'cue') out.push('\n<' + String(b.text).replace(/^<|>$/g, '') + '>\n');
        else if (b.t === 'note') out.push('\n（' + String(b.text).replace(/^⚠\s*/, '') + '）\n');
        else out.push(b.text);
      });
      out.push('');
    });
    return out.join('\n');
  }

  function renderWrite(w) {
    const oc = ocState();
    if (oc.wid !== w.id) { oc.wid = w.id; oc.form = null; oc.res = null; oc.flat = null; oc.lints = []; oc.tone = ''; oc.edit = false; oc.edited = false; oc.snap = null; }
    const cats = allCats();
    const cat = catOf(oc);
    const scene = sceneOf(oc, cat);
    if (!oc.form) { oc.form = fillForm(w, scene); oc.tone = scene.tones[0]; }
    if (!oc.tone) oc.tone = scene.tones[0];
    const f = oc.form;
    const segs = scene.segs.map(k => Engine.SEGMENTS.find(s => s.key === k)).filter(Boolean);
    const mins = segs.reduce((a, s) => a + (s.dur || 0), 0);
    const mat = ['how', 'story', 'like', 'parents'].filter(k => ((w.survey || {})[k] || '').trim()).length;
    const total = cats.reduce((a, c) => a + c.list.length, 0);
    const wc = ocWordCount(oc.flat);

    $('#tabBody').innerHTML = `
      <div class="oc-grid">
        <div>
          <div class="card" style="margin-bottom:14px">
            <div class="card-b">
              <div class="oc-step"><i>1</i><b>选场景</b><span>${total} 个场景 · ${myTemplates().length} 个我的模板</span></div>
              <div class="oc-cats">
                ${cats.map(c => `<button class="oc-cat ${c.id === cat.id ? 'on' : ''}" data-cat="${c.id}">
                  <b>${esc(c.name)}</b><span>${esc(c.desc)}</span></button>`).join('')}
              </div>
              <div class="oc-scenes">
                ${cat.list.map(s => `<button class="chip-s ${s.id === scene.id ? 'on' : ''}" data-scene="${s.id}">${esc(s.name)}</button>`).join('')}
              </div>
              <div class="sk">
                <b>${esc(scene.name)}</b> · 骨架 ${segs.length} 环节 / 约 ${mins} 分钟 · ${esc(scene.desc)}<br>
                ${segs.map(s => esc(s.name)).join(' <em>→</em> ')}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-b">
              <div class="oc-step"><i>2</i><b>填名单与调性</b><span>问卷已带入 ${mat}/4 项素材</span></div>
              <div class="oc-form">
                <div class="fld full"><label>婚礼名称</label>
                  <input data-f="title" value="${esc(f.title)}" placeholder="如：两位新人的名字"></div>
                <div class="fld"><label>新娘</label>
                  <input data-f="bride" value="${esc(f.bride)}" placeholder="姓名"></div>
                <div class="fld"><label>新郎</label>
                  <input data-f="groom" value="${esc(f.groom)}" placeholder="姓名"></div>
                <div class="fld"><label>日期</label>
                  <input data-f="date" type="date" value="${esc(f.date)}"></div>
                <div class="fld"><label>时间</label>
                  <input data-f="time" value="${esc(f.time)}" placeholder="18:08"></div>
                <div class="fld full"><label>场地</label>
                  <input data-f="hotel" value="${esc(f.hotel)}" placeholder="酒店 · 厅名 / 草坪"></div>
                <div class="fld full"><label>到场来宾 · 重要人物 <em>一行一位，只按你写的顺序引用</em></label>
                  <textarea data-f="guests" rows="4" placeholder="两家父母共 4 位&#10;证婚人：李老师&#10;伴郎伴娘各 3 位">${esc(f.guests)}</textarea></div>
                <div class="fld full"><label>环节流程 <em>改这里就是改稿子的结构，一行一个环节</em></label>
                  <textarea data-f="flow" rows="9">${esc(f.flow)}</textarea></div>
                <div class="fld full"><label>必提词 · 关键词 <em>问卷里的「一定要说」会同步过来</em></label>
                  <textarea data-f="mustSay" rows="2" placeholder="一定要提到她妈妈做的那道菜">${esc(f.mustSay)}</textarea></div>
                <div class="fld full"><label>避讳与特殊要求</label>
                  <textarea data-f="taboo" rows="2" placeholder="不提早生贵子、不拿体重开玩笑">${esc(f.taboo)}</textarea></div>
                <div class="fld full"><label>语言调性 <em>会直接改变句长、口语度、用典和幽默</em></label>
                  <div class="tones">
                    ${(scene.tones || []).map(t => `<button class="tone ${t === oc.tone ? 'on' : ''}" data-tone="${esc(t)}">${esc(t)}</button>`).join('')}
                  </div></div>
                <div class="fld full"><label>风格档 <em>你的主持词风格套装里适合婚礼的三档，选中会按档位预设滑杆</em></label>
                  <div class="tones">${packChipsHTML()}</div>
                  <div class="tiny muted" style="margin-top:8px;line-height:1.75">${curPack()
                    ? `当前：<b style="color:var(--wine)">${esc(curPack().name)}</b> —— ${esc(curPack().desc)}。${esc(curPack().who)}。`
                    : '当前：按你风格库里的旧稿画像写，不套固定档位。'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="oc-bar">
            <span class="oc-bar-t">主持稿 <span class="oc-tag-ed" id="ocEdTag" ${oc.edited ? '' : 'hidden'}>已手工改过</span></span>
            <span style="margin-left:auto"></span>
            <button class="btn ghost sm" id="btnOcRevert" ${oc.edited && oc.snap ? '' : 'hidden'}>还原到出稿版</button>
            <button class="btn sm ${!oc.edit && oc.res ? 'primary' : ''}" id="btnOcEdit" ${oc.res ? '' : 'disabled'}>${oc.edit ? '完成编辑' : '✎ 编辑稿子'}</button>
          </div>
          <div class="oc-paper ${oc.edit && oc.res ? 'edit' : ''}" id="ocPaper">${oc.res ? (oc.edit ? renderOcEdit(oc.res) : renderOc(oc.res, null)) : ocEmptyHtml(w)}</div>
          <div class="oc-engine">
            <span class="tiny muted">出稿引擎</span>
            <button class="tone ${ocEngine() === 'cloud' ? 'on' : ''}" data-engine="cloud">大模型</button>
            <button class="tone ${ocEngine() === 'local' ? 'on' : ''}" data-engine="local">本地引擎</button>
            <button class="btn ghost sm" id="ocModel" title="用自己的接口地址、key 和模型">${LLM.available() ? esc(LLM.modelLabel()) + ' · 更换' : '模型未配置 · 点此填写'}</button>
          </div>
          <div class="oc-actions">
            <button class="btn primary" id="btnOcGen">${oc.res ? '重新出稿' : '一键出稿'}</button>
            <button class="btn" id="btnOcStop" disabled>停止</button>
            <button class="btn" id="btnOcCopy" ${oc.res ? '' : 'disabled'}>复制全文</button>
            <button class="btn" id="btnOcMd" ${oc.res ? '' : 'disabled'}>下载 .md</button>
            <button class="btn" id="btnOcKeep" ${oc.res ? '' : 'disabled'}>存回并定稿</button>
            <button class="btn" id="btnOcTpl">存成模板</button>
            <span class="oc-meta">${oc.res ? wc + ' 字 · 约 ' + Math.max(1, Math.round(wc / 220)) + ' 分钟播读' : '内容库 ' + DB.style.samples.length + ' 段旧稿 · ' + (DB.materials || []).length + ' 条素材'}</span>
          </div>
          <div id="ocLint">${ocLintHtml(oc.lints)}</div>
          <div class="lib-strip">
            <label class="lib-sw">
              <input type="checkbox" id="ocUseLib" ${oc.useLib === false ? '' : 'checked'}>
              <span>参考我的库（旧稿 + 素材）</span>
            </label>
            <span class="tiny muted">旧稿 ${DB.style.samples.length} 段 · 自攒素材 ${(DB.materials || []).length} 条${oc.res && oc.res.used && oc.res.used.length ? ` · 本次用上 ${oc.res.used.length} 条` : ''}</span>
            <button class="btn ghost sm" data-tab-go="lib" style="margin-left:auto">去模板库</button>
          </div>
          <p class="tiny muted" style="margin:10px 0 0;line-height:1.75">
            素材只取问卷、你在这里填的内容，以及你自己攒进内容库的句子——缺的地方标「⚠ 待补素材」而不是硬编。出稿后可复制上台，或「存回这一场」——播放器、演示沙盘、流程表都会同步用上。
          </p>
        </div>
      </div>`;

    /* 场景 / 类别切换 */
    $$('[data-cat]').forEach(b => b.onclick = () => {
      const nextCat = allCats().find(c => c.id === b.dataset.cat);
      if (!nextCat) return;
      if (!nextCat.list.length) { toast('还没有自己的模板：先出稿，再点「存成模板」'); return; }
      const oldSkel = guardFlow(scene.segs);
      oc.cat = nextCat.id; oc.scene = nextCat.list[0].id; oc.tone = nextCat.list[0].tones[0];
      if (nextCat.list[0].flow) f.flow = nextCat.list[0].flow;
      else if (!f.flow.trim() || f.flow.trim() === oldSkel.trim()) f.flow = guardFlow(nextCat.list[0].segs);
      renderWrite(w);
    });
    $$('[data-scene]').forEach(b => b.onclick = () => {
      const nextScene = cat.list.find(s => s.id === b.dataset.scene);
      if (!nextScene) return;
      const oldSkel = guardFlow(scene.segs);
      oc.scene = nextScene.id; oc.tone = nextScene.tones[0];
      if (nextScene.flow) f.flow = nextScene.flow;
      else if (!f.flow.trim() || f.flow.trim() === oldSkel.trim()) f.flow = guardFlow(nextScene.segs);
      renderWrite(w);
    });
    $$('[data-tone]').forEach(b => b.onclick = () => {
      oc.tone = b.dataset.tone;
      $$('[data-tone]').forEach(x => x.classList.toggle('on', x.dataset.tone === oc.tone));
    });
    $$('[data-pack]').forEach(b => b.onclick = () => {
      const id = b.dataset.pack;
      setPack(id, () => {
        renderWrite(w);
        const p = Pack.byId(id);
        toast(p ? `已切到「${p.name}」，滑杆按档位预设，可去「风格微调」再改` : '已切回你自己的旧稿画像');
      });
    });

    /* 表单：边填边存进 oc.form */
    $$('[data-f]').forEach(el => {
      el.oninput = () => { f[el.dataset.f] = el.value; };
      el.onchange = () => { f[el.dataset.f] = el.value; };
    });

    $('#btnOcGen').onclick = () => {
      if (oc.edited && oc.res) {
        openModal('这份稿子已经改过', `
          <p class="tiny" style="line-height:1.9;margin:0;color:var(--ink-2)">重新出稿会覆盖你在纸面上改过的内容（已经自动存草稿的那一版也会被替换）。想留底，先「复制全文」或「存成模板」。</p>
          <div style="display:flex;gap:8px;margin-top:16px"><button class="btn primary" id="ocRegenYes">继续重出</button><button class="btn" id="ocRegenNo">取消</button></div>`);
        $('#ocRegenYes').onclick = () => { closeModal(); runOc(w); };
        $('#ocRegenNo').onclick = closeModal;
        return;
      }
      runOc(w);
    };
    $('#btnOcEdit').onclick = () => {
      if (!oc.res) return toast('先出一稿，再改');
      if (!oc.edit) {
        if (!oc.snap) oc.snap = JSON.parse(JSON.stringify(oc.res.groups));
        oc.edit = true;
        ocPaint(w);
        const first = $('#ocPaper .oc-ed-ta');
        if (first) { first.focus(); try { first.setSelectionRange(first.value.length, first.value.length); } catch (e) {} }
        toast('直接点段落改字；右侧「词/提/注」可换类型，⌘+Enter 加一段');
      } else {
        oc.edit = false;
        if (oc.saveTimer) { clearTimeout(oc.saveTimer); oc.saveTimer = 0; }
        if (oc.edited) ocAutoSave(w, oc.res);
        ocPaint(w);
        if (oc.edited) toast('改动已存进这一场的草稿');
      }
    };
    $('#btnOcRevert').onclick = () => {
      if (!oc.snap) return toast('没有可还原的版本');
      openModal('还原到出稿版？', `
        <p class="tiny" style="line-height:1.9;margin:0;color:var(--ink-2)">你在这份稿子上做的手工改动会全部丢掉，回到刚出稿时的样子。</p>
        <div style="display:flex;gap:8px;margin-top:16px"><button class="btn primary" id="ocRevYes">还原</button><button class="btn" id="ocRevNo">取消</button></div>`);
      $('#ocRevYes').onclick = () => {
        closeModal();
        oc.res.groups = JSON.parse(JSON.stringify(oc.snap));
        oc.edited = false;
        ocRefreshMeta();
        ocAutoSave(w, oc.res);
        ocPaint(w);
        toast('已还原到出稿版');
      };
      $('#ocRevNo').onclick = closeModal;
    };
    bindOcEdit(w);
    /* 只更新引擎按钮与模型名，不整页重画——重画会丢掉刚填的表单 */
    const refreshEngine = () => {
      $$('[data-engine]').forEach(x => x.classList.toggle('on', x.dataset.engine === ocEngine()));
      const el = $('#ocModel');
      if (el) el.textContent = LLM.available() ? (LLM.modelLabel() + ' · 更换') : '模型未配置 · 点此填写';
    };
    $$('[data-engine]').forEach(b => b.onclick = () => {
      const want = b.dataset.engine;
      if (want === 'cloud' && !LLM.available()) { openModelModal(() => { oc.engine = 'cloud'; refreshEngine(); }); return; }
      oc.engine = want;
      refreshEngine();
      toast(oc.engine === 'cloud' ? '改用大模型出稿' : '改用本地规则引擎');
    });
    const mdl = $('#ocModel');
    if (mdl) mdl.onclick = () => openModelModal(saved => {
      if (saved && !oc.engine) oc.engine = 'cloud';
      refreshEngine();
      if (saved) toast('模型已就绪，可以点「一键出稿」');
    });
    const sw = $('#ocUseLib');
    if (sw) sw.onchange = () => { oc.useLib = sw.checked; };
    $$('[data-tab-go]').forEach(b => b.onclick = () => { state.scriptTab = b.dataset.tabGo; renderScript(); });
    $('#btnOcStop').onclick = () => {
      if (state.ocAbort) { try { state.ocAbort.abort(); } catch (e) {} }
      clearInterval(state.typing);
      if (oc.res) { ocPaint(curW()); ocAutoSave(curW(), oc.res); }
      $('#btnOcGen').disabled = false;
      $('#btnOcStop').disabled = true;
      $('#btnOcCopy').disabled = !oc.res; $('#btnOcMd').disabled = !oc.res; $('#btnOcKeep').disabled = !oc.res;
      $('#ocLint').innerHTML = ocLintHtml(oc.lints);
    };
    $('#btnOcCopy').onclick = () => { if (oc.res) copy(ocMarkdown(oc.res)); };
    $('#btnOcMd').onclick = () => {
      if (!oc.res) return;
      download(ocMarkdown(oc.res), `${f.bride || '新人'}_${f.groom || ''}_主持稿_${f.date || ymd(TODAY)}.md`);
    };
    $('#btnOcKeep').onclick = () => {
      if (!oc.res) return;
      let n = 0;
      oc.res.groups.forEach(g => {
        if (!g || !g.key) return;
        w.scripts[g.key] = { blocks: g.blocks || [], name: g.name || '', updated: Date.now(), final: true };
        n++;
      });
      save(); renderShell();
      toast(`已定稿 ${n} 个环节（草稿早就自动存了，这一步是标「定稿」）`);
    };
    $('#btnOcTpl').onclick = () => openTplModal(w, scene, f, oc);
  }

  /* ---- 存成我的模板 ---- */
  function openTplModal(w, scene, f, oc) {
    openModal('存成我的模板', `
      <div class="field"><label>模板名称</label>
        <input class="input" id="tplName" value="${esc(scene.name + ' · 我的版本')}" placeholder="如：草坪 12 环节 · 我常用"></div>
      <div class="field"><label>环节（一行一个，改行数就是改结构）</label>
        <textarea class="input" id="tplFlow" rows="9">${esc(f.flow)}</textarea></div>
      <div class="field"><label>默认调性</label>
        <select class="input" id="tplTone">${Object.keys(TONE_MIX).map(k => `<option ${k === oc.tone ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
      <div class="field"><label>备注（选填）</label>
        <input class="input" id="tplNote" placeholder="什么场合用、和别的模板差在哪"></div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn primary" id="tplOk">存进模板库</button>
        <button class="btn" id="tplCancel">取消</button>
      </div>`);
    $('#tplCancel').onclick = closeModal;
    $('#tplOk').onclick = () => {
      const name = $('#tplName').value.trim() || '我的模板';
      const flow = $('#tplFlow').value.trim();
      const keys = resolveSegs(scene, flow);
      if (!keys.length) return toast('环节至少写一个');
      const t = {
        id: uid(), name, flow, segs: keys,
        tones: [$('#tplTone').value], note: $('#tplNote').value.trim(), date: ymd(TODAY)
      };
      DB.templates.unshift(t);
      save(); closeModal();
      const o = ocState();
      o.cat = 'mine'; o.scene = 't_' + t.id; o.tone = t.tones[0];
      if (o.form) o.form.flow = flow;
      state.scriptTab = 'write'; renderScript();
      toast('已存进模板库：' + name);
    };
  }

  function applyTpl(t) {
    const o = ocState();
    o.cat = 'mine'; o.scene = 't_' + t.id;
    o.tone = (t.tones && t.tones[0]) || '温情真挚';
    if (o.form) o.form.flow = t.flow || guardFlow(t.segs || []);
    o.res = null; o.lints = [];
    state.scriptTab = 'write'; renderScript();
    toast('已套用模板：' + t.name);
  }

  function ocEngine() {
    const oc = ocState();
    if (!oc.engine) oc.engine = LLM.available() ? 'cloud' : 'local';
    if (oc.engine === 'cloud' && !LLM.available()) oc.engine = 'local';
    return oc.engine;
  }

  function runOc(w) {
    if (ocEngine() === 'cloud') return runOcCloud(w);
    return runOcLocal(w);
  }

  /* ---------- 大模型出稿 ---------- */
  const OC_SYSTEM = [
    '你是中国一线婚礼主持人，也是长期替同行写稿的撰稿人。你写的每一句都要能被人直接拿上台念。',
    '',
    '【硬规则，不可违反】',
    '1. 只写播读词。舞台执行动作（音乐、灯光、递戒指、递茶、合影）单独成行，放进尖括号，例如 <音乐起：Beautiful In White>。',
    '2. 严禁编造：新人姓名、职业、相识经过、父母情况、来宾身份，只能用我给你的材料。材料没有的细节不要自己造，需要现场补的地方写成（待补：……）。',
    '3. 严格按我给的环节清单逐环节写，一个不少、顺序不变。每个环节用「## 环节名」单独起一行，环节名必须和我给的完全一致。',
    '4. 不要写「以下是主持稿」「希望对你有帮助」这类话；不要用 Markdown 加粗、列表、表情、序号。',
    '5. 句子长短与语气按我给的「风格档」来；有风格档时，风格档的规则优先于其它风格描述。',
    '6. 每段都要推进流程或交代情绪，不写空泛排比和没有信息量的形容。',
    '7. 名单类内容只按我给的原始顺序引用，绝不重排、绝不补人。',
    '8. 风格档里列出的禁用词，一个都不要出现。'
  ].join('\n');

  function ocCloudPrompt(w, scene, form, segs, tone) {
    const pk = (window.Pack && DB.style.pack !== 'custom') ? Pack.byId(DB.style.pack) : null;
    const st = Engine.analyzeStyle(DB.style.samples, DB.style.prefs, pk ? pk.id : null);
    const s = w.survey || {};
    const lib = ocState().useLib !== false;
    const mats = lib ? (DB.materials || []).filter(m => m.text && (!m.seg || (segs || []).some(x => x.key === m.seg))) : [];
    const samples = lib ? (DB.style.samples || []).slice(0, 2) : [];

    const L = [];
    L.push('请为下面这场婚礼写一份完整的主持稿。');
    L.push('');
    L.push('【场次】');
    L.push(`- 婚礼：${form.title || '（未命名）'}`);
    L.push(`- 新娘：${form.bride || '（待补）'}${(w.couple || {}).brideJob ? '（' + w.couple.brideJob + '）' : ''}　新郎：${form.groom || '（待补）'}${(w.couple || {}).groomJob ? '（' + w.couple.groomJob + '）' : ''}`);
    L.push(`- 日期时间：${form.date || ''} ${form.time || ''}`);
    L.push(`- 场地：${form.hotel || '（待补）'}`);
    L.push(`- 来宾：${form.guests || s.guestsStruct || '（待补）'}`);
    L.push(`- 调性：${tone}`);
    L.push(`- 风格画像：平均句长 ${st.avgLen || 20} 字；称呼习惯「${st.address || '各位来宾'}」；温度 ${st.dims['温度']}、口语 ${st.dims['口语']}、用典 ${st.dims['用典']}、幽默 ${st.dims['幽默']}`);
    L.push('');
    L.push('【可用素材（只能用这些）】');
    L.push(`- 怎么认识的：${s.how || '（未提供）'}`);
    L.push(`- 恋爱故事：${s.story || '（未提供）'}`);
    L.push(`- 各自喜欢什么：${s.like || '（未提供）'}`);
    L.push(`- 父母情况：${s.parents || '（未提供）'}`);
    if (form.mustSay) L.push(`- 一定要提到：${form.mustSay}`);
    if (form.taboo) L.push(`- 绝对不能提：${form.taboo}`);
    if (form.extra) L.push(`- 补充说明：${form.extra}`);
    if (mats.length) {
      L.push('');
      L.push('【我自己的句子（能自然用进去就用，位置合适就插）】');
      mats.slice(0, 6).forEach(m => L.push(`- [${m.kind}${m.seg ? ' · ' + segNameOf(m.seg) : ''}] ${m.text}`));
    }
    if (samples.length) {
      L.push('');
      L.push('【我的旧稿（只学语感，不要照抄内容）】');
      samples.forEach(x => L.push('· ' + String(x.text).slice(0, 180)));
    }
    L.push('');
    if (pk) {
      L.push(`【风格档：${pk.name}（${pk.desc}）】`);
      L.push('这几条是硬约束，优先级高于下面的示例；做不到就不要硬写：');
      pk.rules.forEach((r2, i) => L.push(`${i + 1}. ${r2}`));
      if (pk.avoid && pk.avoid.length) L.push(`禁用词与禁用句式：${pk.avoid.join('、')}。这些词一个都不要出现。`);
      L.push('本场各环节的动作要求：');
      Object.keys(pk.moves || {}).forEach(k => {
        const sg = segs.find(x => x.key === k);
        if (sg) L.push(`- ${sg.name}：${pk.moves[k]}`);
      });
    } else {
      L.push('【风格档：沿用我的旧稿画像】');
      L.push('不套用固定档位，按上面画像里的句长、称呼和四个维度写，像我自己写的就行。');
    }
    L.push('');
    L.push('【环节清单（按此顺序，环节名一字不改）】');
    segs.forEach((sg, i) => L.push(`${i + 1}. ${sg.name}（约 ${sg.dur} 分钟）`));
    L.push('');
    L.push(`每个环节写 100–220 字播读词，需要时加少量尖括号执行提示。总共约 ${segs.reduce((a, x) => a + (x.dur || 0), 0)} 分钟的量，不要注水。现在开始写。`);
    return L.join('\n');
  }

  /* 把模型输出的 markdown 绑回环节 */
  function parseCloudScript(text, scene, segs) {
    const groups = [];
    const findSeg = (name) => {
      const n = String(name).replace(/[【】\[\]#*]/g, '').trim();
      return segs.find(s => s.name === n)
        || segs.find(s => n.indexOf(s.name) >= 0 || s.name.indexOf(n) >= 0)
        || null;
    };
    String(text || '').split('\n').forEach(raw => {
      const line = raw.replace(/\*\*/g, '').replace(/\s+$/, '');
      const t = line.trim();
      if (!t) return;
      const h = t.match(/^#{1,4}\s*(.+)$/);
      if (h) {
        const seg = findSeg(h[1]);
        groups.push({
          key: seg ? seg.key : 'x' + groups.length,
          name: seg ? seg.name : h[1].replace(/[【】\[\]]/g, '').trim(),
          dur: seg ? seg.dur : 3,
          blocks: []
        });
        return;
      }
      if (!groups.length) {
        const first = segs[0];
        groups.push({ key: first.key, name: first.name, dur: first.dur, blocks: [] });
      }
      const g = groups[groups.length - 1];
      if (/^[<＜]/.test(t)) {
        g.blocks.push({ t: 'cue', text: t.replace(/^[<＜]|[>＞]$/g, '').trim() });
      } else if (/^[（(【\[]/.test(t)) {
        g.blocks.push({ t: 'note', text: t.replace(/^[（(【\[]|[）)】\]]$/g, '').trim() });
      } else {
        g.blocks.push({ t: 'say', text: t.replace(/^[-*·]\s*/, '') });
      }
    });
    return groups.filter(g => g.blocks.length || g.key !== 'x0');
  }

  function runOcCloud(w) {
    const oc = ocState();
    const scene = sceneOf(oc, catOf(oc));
    const form = oc.form;
    const tone = oc.tone || scene.tones[0];
    const keys = resolveSegs(scene, form.flow);
    const segs = keys.map(k => Engine.SEGMENTS.find(s => s.key === k)).filter(Boolean);

    const paper = $('#ocPaper'), gen = $('#btnOcGen'), stop = $('#btnOcStop');
    if (!paper || !gen) return;
    gen.disabled = true; stop.disabled = false; gen.textContent = '写稿中…';
    ['#btnOcCopy', '#btnOcMd', '#btnOcKeep', '#btnOcEdit'].forEach(s => { const el = $(s); if (el) el.disabled = true; });
    oc.edit = false; oc.edited = false; oc.snap = null;
    paper.classList.remove('edit');
    paper.innerHTML = `<div class="oc-empty">大模型正在写这一场…<br><span class="tiny">${esc(segs.length)} 个环节，边写边显示</span></div>`;

    const ctrl = new AbortController();
    state.ocAbort = ctrl;
    oc.res = null;

    let painted = '';
    let raf = 0;
    const paint = (text) => {
      const groups = parseCloudScript(text, scene, segs);
      if (!groups.length) return;
      const partial = { groups: groups, form: Object.assign({}, form), tone: tone, used: [] };
      paper.innerHTML = renderOc(partial, null) + '<span class="oc-caret"></span>';
    };
    const schedule = (text) => {
      painted = text;
      if (raf) return;
      raf = setTimeout(() => { raf = 0; paint(painted); }, 140);
    };

    const done = (res, note) => {
      gen.disabled = false; gen.textContent = '重新出稿'; stop.disabled = true;
      ['#btnOcCopy', '#btnOcMd', '#btnOcKeep'].forEach(s => { const el = $(s); if (el) el.disabled = !res; });
      oc.edit = false; oc.edited = false; oc.snap = null;
      ocPaint(w);
      const wc = ocWordCount(oc.flat);
      const m = $('.oc-meta');
      if (m) m.textContent = wc + ' 字 · 约 ' + Math.max(1, Math.round(wc / 220)) + ' 分钟播读';
      $('#ocLint').innerHTML = ocLintHtml(oc.lints) + (note ? `<p class="tiny muted" style="margin:8px 0 0">${esc(note)}</p>` : '');
      const lbl = $('#ocModel'); if (lbl) lbl.textContent = LLM.modelLabel() + ' · 更换';
      ocAutoSave(w, res);
    };

    LLM.stream({
      system: OC_SYSTEM,
      user: ocCloudPrompt(w, scene, form, segs, tone),
      temperature: 0.85,
      signal: ctrl.signal,
      onDelta: schedule
    }).then(text => {
      const groups = parseCloudScript(text, scene, segs);
      if (!groups.length) throw new Error('模型没返回可用内容，换个说法再试一次。');
      const missing = segs.filter(s => !groups.some(g => g.key === s.key)).map(s => s.name);
      const used = (DB.materials || []).filter(m => m.text && text.indexOf(String(m.text).slice(0, 12)) >= 0);
      const res = { groups: groups, lints: cloudLints(text, form), tone: tone, form: Object.assign({}, form), used: used, engine: 'cloud' };
      oc.res = res; oc.lints = res.lints;
      oc.flat = [];
      groups.forEach(g => { oc.flat.push({ t: 'h' }); (g.blocks || []).forEach(b => oc.flat.push(b)); });
      done(res, missing.length ? `模型漏了 ${missing.length} 个环节（${missing.join('、')}），可以直接补，或重新出稿。` : '');
      toast('大模型出稿完成：' + groups.length + ' 个环节');
    }).catch(err => {
      const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
      gen.disabled = false; gen.textContent = '重新出稿'; stop.disabled = true;
      if (aborted) {
        const groups = parseCloudScript(painted, scene, segs);
        if (groups.length) {
          const res = { groups: groups, lints: [], tone: tone, form: Object.assign({}, form), used: [], engine: 'cloud' };
          oc.res = res; oc.flat = [];
          groups.forEach(g => { oc.flat.push({ t: 'h' }); (g.blocks || []).forEach(b => oc.flat.push(b)); });
          done(res, '已手动停止，保留已经写出来的部分。');
        } else {
          paper.innerHTML = renderOc(oc.res, null);
        }
        toast('已停止');
        return;
      }
      paper.innerHTML = `<div class="oc-empty">这次没写成。<br><span class="tiny" style="color:var(--wine)">${esc(err.message || '未知错误')}</span><br><br>
        <span class="tiny">可以先切到「本地引擎」出稿，或稍后重试。</span></div>`;
      $('#ocLint').innerHTML = '';
      toast('大模型出稿失败');
    }).finally(() => { state.ocAbort = null; });
  }

  /* 只做能确定性判断的检查：避讳词、空环节 */
  function cloudLints(text, form) {
    const out = [];
    const bad = String(form.taboo || '').split(/[、,，;；\s]+/).filter(x => x.length >= 2);
    bad.forEach(b => { if (text.indexOf(b) >= 0) out.push('稿子里出现了避讳词「' + b + '」，务必删掉'); });
    if (text.indexOf('待补') >= 0) out.push('有（待补：…）占位，上台前记得填或删');
    return out;
  }

  function runOcLocal(w) {
    const oc = ocState();
    const cat = catOf(oc);
    const scene = sceneOf(oc, cat);
    oc.salt = Math.floor(Math.random() * 997);
    const res = composeAll(w, scene, oc.form, oc.tone || scene.tones[0], oc.useLib !== false);
    oc.res = res; oc.lints = res.lints;
    oc.flat = [];
    res.groups.forEach(g => {
      oc.flat.push({ t: 'h' });
      (g.blocks || []).forEach(b => oc.flat.push(b));
    });

    const paper = $('#ocPaper');
    const gen = $('#btnOcGen'), stop = $('#btnOcStop');
    if (!paper || !gen) return;
    gen.disabled = true; stop.disabled = false;
    ['#btnOcCopy', '#btnOcMd', '#btnOcKeep', '#btnOcEdit'].forEach(s => { const el = $(s); if (el) el.disabled = true; });
    clearInterval(state.typing);
    oc.edit = false; oc.edited = false; oc.snap = null;
    paper.classList.remove('edit');
    paper.innerHTML = renderOc(res, 3);

    let i = 0;
    const total = res.groups.reduce((a, g) => a + 1 + (g.blocks || []).length, 0);
    state.typing = setInterval(() => {
      i += 4;
      if (i >= total) {
        clearInterval(state.typing);
        ocPaint(w);
        gen.disabled = false; gen.textContent = '重新出稿';
        stop.disabled = true;
        ['#btnOcCopy', '#btnOcMd', '#btnOcKeep'].forEach(s => { const el = $(s); if (el) el.disabled = false; });
        $('#ocLint').innerHTML = ocLintHtml(res.lints);
        const wc = ocWordCount(oc.flat);
        const m = $('.oc-meta');
        if (m) m.textContent = wc + ' 字 · 约 ' + Math.max(1, Math.round(wc / 220)) + ' 分钟播读';
        ocAutoSave(w, res);
        toast('出稿完成：' + res.groups.length + ' 个环节 · 已自动存草稿');
        return;
      }
      paper.innerHTML = renderOc(res, i);
    }, 90);
  }

  /* 出完立刻落盘，别等用户想起来点「存回这一场」——刷新/切页都不会再丢 */
  function ocAutoSave(w, res) {
    if (!w || !res || !Array.isArray(res.groups) || !res.groups.length) return 0;
    let n = 0;
    res.groups.forEach(g => {
      if (!g || !g.key) return;
      const old = w.scripts[g.key];
      w.scripts[g.key] = {
        blocks: g.blocks || [],
        name: g.name || '',
        updated: Date.now(),
        final: old ? !!old.final : false,
        draft: true
      };
      n++;
    });
    if (n) save();
    return n;
  }

  function wordCount(sc) {
    if (!sc) return 0;
    return sc.blocks.filter(b => b.t === 'say').map(b => b.text).join('').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').length;
  }
  function materialCount(w) {
    const s = w.survey || {};
    return ['how', 'story', 'like', 'parents', 'mustSay'].filter(k => (s[k] || '').trim()).length;
  }

  function renderDoc(sc, typingIdx) {
    return `<div class="doc">${sc.blocks.map((b, i) => {
      if (typingIdx != null && i > typingIdx) return '';
      if (b.t === 'cue') return `<span class="cue">${esc(b.text)}</span>`;
      if (b.t === 'note') return `<span class="note">${esc(b.text)}</span>`;
      return `<p contenteditable="true" data-bi="${i}">${esc(b.text)}</p>`;
    }).join('')}${typingIdx != null ? '<span class="caret"></span>' : ''}</div>`;
  }

  function bindDocEdit(w) {
    $$('#docOut [data-bi]').forEach(el => {
      el.onblur = () => {
        const sc = w.scripts[state.seg];
        if (!sc) return;
        const i = Number(el.dataset.bi);
        const txt = el.innerText.replace(/\u00a0/g, ' ').trim();
        if (txt && sc.blocks[i]) { sc.blocks[i].text = txt; sc.updated = Date.now(); save(); }
      };
    });
  }

  function genSeg(w, saltMode) {
    const btn = $('#btnGen');
    btn.disabled = true;
    state.salt = saltMode ? state.salt + 1 : Math.floor(Math.random() * 999);
    const r = Engine.generate(w, state.seg, {
      samples: DB.style.samples, prefs: DB.style.prefs, hostName: DB.profile.name, salt: state.salt
    });
    const sc = { blocks: r.blocks, updated: Date.now(), final: false };
    w.scripts[state.seg] = sc;
    save(); renderShell();

    // 逐块流式呈现
    const box = $('#docOut');
    let i = 0;
    clearInterval(state.typing);
    box.innerHTML = renderDoc(sc, 0);
    state.typing = setInterval(() => {
      i++;
      if (i >= sc.blocks.length) {
        clearInterval(state.typing);
        box.innerHTML = renderDoc(sc);
        bindDocEdit(w);
        btn.disabled = false;
        const rg = $('#btnRegen'), fn = $('#btnFinal'), ln = $('#btnLearn'), cp = $('#btnCopySeg');
        if (rg) rg.disabled = false;
        if (fn) fn.disabled = false;
        if (ln) ln.disabled = false;
        if (cp) cp.disabled = false;
        showLint(r.lint);
        return;
      }
      box.innerHTML = renderDoc(sc, i);
      const d = box.querySelector('.doc');
      if (d && d.scrollIntoView) d.scrollIntoView({ block: 'nearest' });
    }, 240);
    showLint(r.lint);
  }

  function showLint(lint) {
    $('#lintBox').innerHTML = lint && lint.length
      ? `<div style="margin-top:12px;background:var(--gold-soft);border:1px solid rgba(176,138,82,.3);border-radius:9px;padding:9px 12px">
           <div class="tiny" style="color:#7E5E2C;line-height:1.7">${lint.map(l => '· ' + esc(l)).join('<br>')}</div></div>`
      : '';
  }

  function mdSegment(w, seg) {
    const sc = w.scripts[seg];
    if (!sc) return '';
    return sc.blocks.map(b => b.t === 'cue' ? `<${b.text}>` : (b.t === 'note' ? `（${b.text}）` : b.text)).join('\n');
  }

  /* ---- 风格档（套装 S2/S4/S8） ---- */
  function curPack() {
    return (window.Pack && DB.style.pack && DB.style.pack !== 'custom') ? Pack.byId(DB.style.pack) : null;
  }

  function packChipsHTML() {
    const cur = DB.style.pack || 'custom';
    const items = [{ id: 'custom', name: '我的旧稿画像', desc: '按风格库里的旧稿算，不套档位' }]
      .concat((window.STYLE_PACKS || []).map(p => ({ id: p.id, name: p.name, desc: p.desc })));
    return items.map(x => `<button class="tone pack-c ${x.id === cur ? 'on' : ''}" data-pack="${x.id}" title="${esc(x.desc)}">${esc(x.name)}</button>`).join('');
  }

  /* 选中档位：写 pack + 按档位预设滑杆（之后仍可手动微调） */
  function setPack(id, after) {
    DB.style.pack = id;
    const p = window.Pack && Pack.byId(id);
    if (p && p.prefs) {
      Object.keys(p.prefs).forEach(k => { DB.style.prefs[k] = p.prefs[k]; });
    }
    save();
    if (after) after();
  }

  /* 把套装骨架里本应用原先没有的环节补进这一场的流程 */
  function applyFrame(w) {
    const segs = Engine.SEGMENTS;
    const has = name => (w.flow || []).some(f => segKey(f.name) === segKey(name));
    const mk = key => {
      const s = segs.find(x => x.key === key);
      return { id: uid(), name: s.name, dur: s.dur, note: '套装骨架补充：按现场情况留 2–3 分钟，超时用手势收', vis: 'both' };
    };
    let added = 0;
    if (!has('证婚人致辞')) {
      const at = (w.flow || []).findIndex(f => /戒指/.test(f.name));
      const row = mk('witness');
      if (at >= 0) w.flow.splice(at + 1, 0, row); else w.flow.push(row);
      added++;
    }
    if (!has('双方父母致辞')) {
      const at = (w.flow || []).findIndex(f => /感恩|敬茶/.test(f.name));
      const row = mk('folks');
      if (at >= 0) w.flow.splice(at + 1, 0, row); else w.flow.push(row);
      added++;
    }
    if (added) { save(); toast('已补进 ' + added + ' 个环节，可在流程表里调时长'); }
    else toast('这套骨架该有的环节，你这场已经齐了');
    return added;
  }

  /* ---- 风格库 ---- */
  function renderStyleLib(w) {
    const pk = curPack();
    const st = Engine.analyzeStyle(DB.style.samples, DB.style.prefs, pk ? pk.id : null);
    const diff = window.Pack ? Pack.frameDiff((w.flow || []).map(f => segKey(f.name)).map(k => {
      const s = Engine.SEGMENTS.find(x => segKey(x.name) === k);
      return s ? s.key : k;
    })) : { have: [], missing: [], extra: [] };
    $('#tabBody').innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-h"><h3>风格档</h3><span class="hint">取自你的《主持词大师 · 全风格套装》，只挑了适合婚礼的三档</span></div>
        <div class="card-b">
          <div class="pack-row">
            ${[{ id: 'custom', code: '', name: '我的旧稿画像', desc: '只用风格库里的旧稿算画像，不套固定档位', who: '已经有稳定个人风格时选这个' }]
              .concat((window.STYLE_PACKS || []).map(p => ({ id: p.id, code: p.code, name: p.name, desc: p.desc, who: p.who })))
              .map(x => `
              <button class="pack ${x.id === (DB.style.pack || 'custom') ? 'on' : ''}" data-pack="${x.id}">
                <span class="pk-code">${x.code ? esc(x.code) : '—'}</span>
                <b>${esc(x.name)}</b>
                <span class="pk-desc">${esc(x.desc)}</span>
                <span class="pk-who">${esc(x.who)}</span>
              </button>`).join('')}
          </div>
          ${pk ? `
            <div class="pk-detail">
              <div class="pk-sec"><b>硬规则</b><ol>${pk.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ol></div>
              <div class="pk-sec"><b>禁用</b><div class="pk-avoid">${pk.avoid.map(a => `<span>${esc(a)}</span>`).join('')}</div></div>
              <div class="pk-sec"><b>各环节怎么做</b>
                <div class="pk-moves">${Object.keys(pk.moves || {}).map(k => {
                  const s = Engine.SEGMENTS.find(x => x.key === k) || { name: k };
                  return `<div><em>${esc(s.name)}</em>${esc(pk.moves[k])}</div>`;
                }).join('')}</div>
              </div>
            </div>` : `<p class="tiny muted" style="margin:12px 0 0;line-height:1.8">当前不套档位：出稿按上面画像里的句长、称呼和四个维度来，像你自己写的那样。选一个档位会按它预设滑杆，之后还能手动微调。</p>`}
        </div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-h"><h3>套装婚礼骨架</h3><span class="hint">对照这一场的流程表</span></div>
        <div class="card-b">
          <div class="frame-list">
            ${(window.Pack ? Pack.FRAME : []).map(f => {
              const on = f.seg ? diff.have.some(x => x.seg === f.seg) : false;
              return `<div class="fr ${on ? 'on' : ''}">
                <i>${on ? '✓' : '○'}</i>
                <b>${esc(f.label)}</b>
                ${f.must ? '<span class="fr-must">必备</span>' : '<span class="fr-opt">可选</span>'}
                ${f.added && !on ? '<span class="fr-new">本应用原没有</span>' : ''}
                <span class="fr-hint">${esc(f.hint || '')}</span>
              </div>`;
            }).join('')}
            ${diff.extra.length ? `<div class="fr extra"><i>＋</i><b>你这场的额外环节</b><span class="fr-hint">${diff.extra.map(e => esc(e.label)).join('、')}（套装骨架里没有，有需要就留着）</span></div>` : ''}
          </div>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn sm" id="btnFrameFill">把缺的环节补进流程</button>
            <button class="btn ghost sm" data-go="flow">去流程表看</button>
          </div>
        </div>
      </div>
      <div class="ai-wrap">
        <div class="card">
          <div class="card-h"><h3>画像</h3><span class="hint">${pk ? '风格档：' + esc(pk.name) : st.count + ' 段旧稿'}</span></div>
          <div class="card-b">
            <div class="style-bars">
              ${Object.entries(st.dims).map(([k, v]) => `
                <div class="b"><span>${k}</span><span class="track"><i class="fill" style="width:${v}%"></i></span><span class="v">${v}</span></div>`).join('')}
            </div>
            <hr class="sep">
            <p class="tiny muted" style="margin:0;line-height:1.75">${esc(st.summary)}</p>
            <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:10px">
              ${st.tags.map(t => `<span class="tag line">${esc(t)}</span>`).join('')}
            </div>
            <div style="margin-top:12px" class="tiny muted">称呼习惯：<b style="color:var(--ink-2)">「${esc(st.address)}」</b><br>句长取向：${st.sentence === 'short' ? '短句推进' : '长句铺陈'}（均 ${st.avgLen} 字）</div>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>手动微调</h3><span class="hint">改完即时影响下一段稿</span></div>
          <div class="card-b">
            ${Object.keys(DB.style.prefs).map(k => `
              <div style="margin-bottom:13px">
                <div style="display:flex;font-size:12px;color:var(--ink-2);margin-bottom:4px"><span>${k}</span><span class="mono" style="margin-left:auto;color:var(--ink-3)" id="pv_${k}">${DB.style.prefs[k]}</span></div>
                <input type="range" min="0" max="100" value="${DB.style.prefs[k]}" data-pref="${k}" style="width:100%;accent-color:var(--wine)">
              </div>`).join('')}
            <p class="tiny muted" style="line-height:1.7;margin:6px 0 0">「温度」管情感的浓度，「口语」管像不像人话，「用典」管意象密度，「幽默」只在超过 50 时才真的开口玩笑，「节奏」管句子长短。</p>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-h"><h3>风格样本</h3><span class="hint">${DB.style.samples.length} 段 · 越贴越准</span></div>
        <div class="card-b">
          ${DB.style.samples.length ? DB.style.samples.map(s => `
            <div class="sample">
              <div class="q">${esc(s.text)}</div>
              ${s.why ? `<div class="a">为什么这样写：${esc(s.why)}</div>` : ''}
              <div class="ft"><span class="tag line">${esc(s.tag || '未分类')}</span><span class="tiny muted">${esc(s.date || '')}</span>
                <button class="btn ghost sm" style="margin-left:auto;color:var(--wine)" data-del-sample="${s.id}">删除</button></div>
            </div>`).join('') : `<div class="empty">还没有样本。去「我的内容库」贴两段。</div>`}
        </div>
      </div>`;

    $$('[data-pack]').forEach(b => b.onclick = () => {
      const id = b.dataset.pack;
      setPack(id, () => {
        renderStyleLib(w);
        const p = Pack.byId(id);
        toast(p ? `已切到「${p.name}」，滑杆按档位预设好了` : '已切回你自己的旧稿画像');
      });
    });
    if ($('#btnFrameFill')) $('#btnFrameFill').onclick = () => { applyFrame(w); renderStyleLib(w); };
    $$('[data-pref]').forEach(el => {
      el.oninput = () => {
        DB.style.prefs[el.dataset.pref] = Number(el.value);
        $('#pv_' + el.dataset.pref).textContent = el.value;
        save();
      };
      el.onchange = () => renderStyleLib(w);
    });
    $$('[data-del-sample]').forEach(b => b.onclick = () => {
      DB.style.samples = DB.style.samples.filter(s => s.id !== b.dataset.delSample);
      save(); renderStyleLib(w); toast('已删除样本');
    });
  }

  /* ---- 我的内容库：旧稿样本 + 自攒素材 ---- */
  const MAT_KINDS = ['金句', '故事细节', '誓言', '称呼', '互动话术', '口头语'];
  function segNameOf(key) {
    if (!key || key === 'any') return '不限环节';
    return (Engine.SEGMENTS.find(s => s.key === key) || {}).name || key;
  }
  function segOptionsHTML(sel) {
    return `<option value="">不限环节（哪一段都能用）</option>` +
      Engine.SEGMENTS.map(s => `<option value="${s.key}" ${sel === s.key ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  }

  function renderLib(w) {
    const st = Engine.analyzeStyle(DB.style.samples, DB.style.prefs);
    const mats = DB.materials || [];
    $('#tabBody').innerHTML = `
      <div class="lib-head">
        <div class="lib-kpi"><b>${DB.style.samples.length}</b><span>段旧稿</span></div>
        <div class="lib-kpi"><b>${myTemplates().length}</b><span>个我的模板</span></div>
        <div class="lib-kpi"><b>${mats.length}</b><span>条自攒素材</span></div>
        <div class="lib-kpi"><b>${st.avgLen || 0}</b><span>平均句长（字）</span></div>
        <button class="btn ghost sm" data-tab-go="style">去看风格微调</button>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-h"><h3>① 我的模板</h3><span class="hint">自己存的场次结构，选场景时直接套</span></div>
        <div class="card-b">
          ${myTemplates().length ? myTemplates().map(t => `
            <div class="mat">
              <div class="mat-t">${esc(t.name)}</div>
              <div class="mat-n">${(t.segs || []).map(segNameOf).join(' → ') || '（无环节）'}</div>
              <div class="mat-f">
                <span class="tag gold">${esc((t.tones || [])[0] || '温情真挚')}</span>
                <span class="tag line">${(t.segs || []).length} 环节</span>
                ${t.note ? `<span class="tiny muted">${esc(t.note)}</span>` : ''}
                <button class="btn ghost sm" style="margin-left:auto" data-use-tpl="${t.id}">套用</button>
                <button class="btn ghost sm" style="color:var(--wine)" data-del-tpl="${t.id}">删除</button>
              </div>
            </div>`).join('') : `<div class="empty">还没有模板。去「一键主持稿」调好一场的环节流程，点「存成模板」，下次就能一键套用。</div>`}
        </div>
      </div>

      <div class="lib-two" style="margin-top:16px">
        <div class="card">
          <div class="card-h"><h3>② 贴一段旧稿</h3><span class="hint">长短不限，一段就够</span></div>
          <div class="card-b">
            <p class="tiny muted" style="margin:0 0 12px;line-height:1.75">旧的微信、朋友圈、以前的主持稿都行。不用整理，不用删标点。第二栏比第一栏值钱：你自己说的「为什么」，比从句子里猜准得多。</p>
            <div class="field">
              <label>我写过的台词</label>
              <textarea class="input" id="sText" rows="5" placeholder="随手贴，不用整理……"></textarea>
            </div>
            <div class="field">
              <label>我为什么这样写（选填，但填了准得多）</label>
              <textarea class="input" id="sWhy" rows="3" placeholder="比如：这场在一个美术馆的展厅里，我把墙上那幅画当引子……"></textarea>
            </div>
            <div class="field" style="max-width:220px">
              <label>归类</label>
              <select class="input" id="sTag">
                <option>室内 · 酒店</option><option>户外 · 草坪</option><option>美术馆 · 场地型</option>
                <option>中式 · 传统</option><option>小型 · 私密</option><option>开场白</option><option>情感环节</option>
              </select>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
              <button class="btn primary" id="sSave">存进内容库</button>
              <button class="btn" id="sExtract">从旧稿里抽素材</button>
            </div>
            <p class="tiny muted" style="margin:10px 0 0;line-height:1.7">「抽素材」会把已存旧稿拆成一句一句，选出适合当金句的，放进右边的素材库，标好出处。</p>
          </div>
        </div>

        <div class="card">
          <div class="card-h"><h3>③ 攒自己的句子</h3><span class="hint">${mats.length} 条</span></div>
          <div class="card-b">
            <div class="field">
              <label>素材正文</label>
              <textarea class="input" id="mText" rows="3" placeholder="一句你自己的话，或者一个只有你知道的细节"></textarea>
            </div>
            <div class="row">
              <div class="field" style="flex:1">
                <label>类型</label>
                <select class="input" id="mKind">${MAT_KINDS.map(k => `<option>${k}</option>`).join('')}</select>
              </div>
              <div class="field" style="flex:1.4">
                <label>贴到哪一段</label>
                <select class="input" id="mSeg">${segOptionsHTML('')}</select>
              </div>
            </div>
            <div class="field">
              <label>备注（选填）</label>
              <input class="input" id="mNote" placeholder="什么时候用、别怎么用">
            </div>
            <button class="btn primary" id="mSave">存进素材库</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-h"><h3>我的素材</h3><span class="hint">出稿时按环节自动插入，可在出稿页关掉</span></div>
        <div class="card-b">
          ${mats.length ? mats.map(m => `
            <div class="mat">
              <div class="mat-t">${esc(m.text)}</div>
              ${m.note ? `<div class="mat-n">${esc(m.note)}</div>` : ''}
              <div class="mat-f">
                <span class="tag gold">${esc(m.kind)}</span>
                <span class="tag line">${esc(segNameOf(m.seg))}</span>
                ${m.from ? `<span class="tiny muted">出处：${esc(m.from)}</span>` : ''}
                <button class="btn ghost sm" style="margin-left:auto;color:var(--wine)" data-del-mat="${m.id}">删除</button>
              </div>
            </div>`).join('') : `<div class="empty">还没有素材。上面两栏任选一处写一句就行。</div>`}
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-h"><h3>旧稿样本</h3><span class="hint">${DB.style.samples.length} 段 · 越贴越准</span></div>
        <div class="card-b">
          ${DB.style.samples.length ? DB.style.samples.map(s => `
            <div class="sample">
              <div class="q" style="-webkit-line-clamp:6">${esc(s.text)}</div>
              ${s.why ? `<div class="a">为什么这样写：${esc(s.why)}</div>` : ''}
              <div class="ft"><span class="tag line">${esc(s.tag || '未分类')}</span><span class="tiny muted">${esc(s.date || '')}</span>
                <button class="btn ghost sm" style="margin-left:auto;color:var(--wine)" data-del-sample="${s.id}">删除</button></div>
            </div>`).join('') : `<div class="empty">还没有旧稿。上面「① 贴一段旧稿」贴两段即可。</div>`}
        </div>
      </div>`;

    $$('[data-tab-go]').forEach(b => b.onclick = () => { state.scriptTab = b.dataset.tabGo; renderScript(); });

    $('#sSave').onclick = () => {
      const text = $('#sText').value.trim();
      if (text.length < 15) return toast('再贴长一点，至少一两句');
      DB.style.samples.unshift({ id: uid(), text, why: $('#sWhy').value.trim(), tag: $('#sTag').value, date: ymd(TODAY) });
      save(); renderShell(); renderLib(w);
      const st2 = Engine.analyzeStyle(DB.style.samples, DB.style.prefs);
      toast(`已存：句长 ${st2.avgLen} 字 · 标签「${st2.tags.slice(0, 2).join('、')}」`);
    };

    $('#mSave').onclick = () => {
      const text = $('#mText').value.trim();
      if (text.length < 6) return toast('再写长一点');
      DB.materials.unshift({
        id: uid(), text, kind: $('#mKind').value, seg: $('#mSeg').value,
        note: $('#mNote').value.trim(), date: ymd(TODAY)
      });
      save(); renderLib(w); toast('已存进素材库');
    };

    /* 从旧稿抽金句：拆句、去重、按长度筛 */
    $('#sExtract').onclick = () => {
      const src = DB.style.samples.map(s => s.text).join('\n');
      if (!src.trim()) return toast('先贴一段旧稿');
      const have = new Set((DB.materials || []).map(m => m.text));
      const cand = src.split(/[。！？!?\n]+/).map(x => x.trim())
        .filter(x => x.length >= 12 && x.length <= 60 && !have.has(x));
      if (!cand.length) return toast('旧稿里没抽到新的句子');
      cand.slice(0, 6).forEach(t => DB.materials.unshift({
        id: uid(), text: t, kind: '金句', seg: '', note: '', date: ymd(TODAY), from: '旧稿抽取'
      }));
      save(); renderLib(w); toast(`抽出 ${Math.min(6, cand.length)} 句，已入库`);
    };

    $$('[data-del-mat]').forEach(b => b.onclick = () => {
      DB.materials = DB.materials.filter(m => m.id !== b.dataset.delMat);
      save(); renderLib(w); toast('已删除素材');
    });
    $$('[data-use-tpl]').forEach(b => b.onclick = () => {
      const t = myTemplates().find(x => x.id === b.dataset.useTpl);
      if (t) applyTpl(t);
    });
    $$('[data-del-tpl]').forEach(b => b.onclick = () => {
      DB.templates = myTemplates().filter(t => t.id !== b.dataset.delTpl);
      save(); renderLib(w); toast('已删除模板');
    });
    $$('[data-del-sample]').forEach(b => b.onclick = () => {
      DB.style.samples = DB.style.samples.filter(s => s.id !== b.dataset.delSample);
      save(); renderLib(w); toast('已删除样本');
    });
  }

  /* 兼容旧调用 */
  function renderOld(w) { renderLib(w); }

  /* ================================================================
     ③ 档期管理
     ================================================================ */
  function renderCalendar() {
    const [y, m] = state.calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const pad = first.getDay();
    const total = new Date(y, m, 0).getDate();
    const prevTotal = new Date(y, m - 1, 0).getDate();
    const cells = [];
    for (let i = pad - 1; i >= 0; i--) cells.push({ d: prevTotal - i, out: true });
    for (let d = 1; d <= total; d++) cells.push({ d, out: false });
    while (cells.length % 7) cells.push({ d: cells.length - pad - total + 1, out: true });
    const sel = state.selDate;
    const selW = DB.weddings.filter(w => w.date === sel);

    $('#view').innerHTML = `
      <div style="display:grid;grid-template-columns:1.6fr .95fr;gap:16px;align-items:start">
        <div class="card" style="overflow:hidden">
          <div class="cal-head">
            <button class="btn sm" id="mPrev">‹</button>
            <span class="m">${y} 年 ${m} 月</span>
            <button class="btn sm" id="mNext">›</button>
            <div style="margin-left:auto;display:flex;gap:6px;align-items:center">
              <span class="tag sage">已定 ${DB.weddings.filter(w => w.status === '已定').length}</span>
              <span class="tag gold">待确认 ${DB.weddings.filter(w => w.status === '待确认').length}</span>
              <span class="tag line">咨询 ${DB.weddings.filter(w => w.status === '咨询中').length}</span>
              <button class="btn sm primary" id="addW">＋ 新场次</button>
            </div>
          </div>
          <div class="cal">
            ${WD.map(d => `<div class="hd">${d}</div>`).join('')}
            ${cells.map((c, idx) => {
              if (c.out) return `<div class="cell out"><span class="dn">${c.d}</span></div>`;
              const ds = `${y}-${String(m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
              const evs = DB.weddings.filter(w => w.date === ds);
              const cls = [ds === ymd(TODAY) ? 'today' : '', ds === sel ? 'sel' : ''].join(' ');
              return `<div class="cell ${cls}" data-date="${ds}">
                <span class="dn">${c.d}</span>
                ${evs.map(e => {
                  const k = e.status === '已定' ? '' : (e.status === '已完成' ? 'done' : 'hold');
                  return `<div class="evt ${k}"><b>${esc(e.couple.bride)}&${esc(e.couple.groom)}</b><span>${esc(e.time)} · ${esc((e.hotel || '').split('·')[0])}</span></div>`;
                }).join('')}
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="detail-panel">
          <div class="card">
            <div class="card-h"><h3>${sel ? esc(prettyDate(sel)) : '选一天'}</h3>
              <span class="hint">${selW.length ? selW.length + ' 场' : '空闲'}</span></div>
            <div class="card-b">
              ${selW.length > 1 ? `<div class="orphan-tip" style="margin-bottom:10px">这天排了 ${selW.length} 场，注意赶场时间：${esc(selW.map(x => (x.time || '') + ' ' + (x.couple.bride || '') + '&' + (x.couple.groom || '')).join(' / '))}</div>` : ''}
              ${selW.length ? selW.map(w => `
                <div style="margin-bottom:14px">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                    <span class="tag ${w.status === '已定' ? 'sage' : (w.status === '咨询中' ? '' : 'gold')}">${esc(w.status)}</span>
                    <span class="tiny mono muted">${esc(w.time)}</span>
                  </div>
                  <div style="font-family:var(--serif);font-size:19px;letter-spacing:.03em">${esc(w.couple.bride)} <i style="font-style:normal;color:var(--gold)">&amp;</i> ${esc(w.couple.groom)}</div>
                  <div class="tiny muted" style="margin-top:2px">${esc(w.hotel)} · ${w.guests || '—'} 人 · 报价 ¥${(w.fee || 0).toLocaleString()}</div>
                  <div class="tiny muted" style="margin-top:2px">策划：${esc(w.planner || '—')} · 联系人：${esc(w.contact || '—')}</div>
                  <div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap">
                    <button class="btn sm" data-switch="${w.id}">切换为当前场</button>
                    <button class="btn sm" data-edit="${w.id}">编辑</button>
                    <button class="btn sm ghost" data-delw="${w.id}" style="color:var(--ink-4);margin-left:auto">删除这场</button>
                  </div>
                </div>`).join('<hr class="sep">')
              : `<p class="tiny muted" style="margin:0 0 12px">这天没有安排。可以在这里直接建一场。</p>
                 <button class="btn sm primary" id="addW2">在这天新建场次</button>`}
            </div>
          </div>

          <div class="card" style="margin-top:14px">
            <div class="card-h"><h3>本月排期</h3><span class="hint">${DB.weddings.filter(w => w.date.slice(0, 7) === state.calMonth).length} 场</span></div>
            <div class="card-b" style="padding-top:6px">
              ${DB.weddings.filter(w => w.date.slice(0, 7) === state.calMonth).sort((a, b) => a.date.localeCompare(b.date)).map(w => `
                <div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px dashed var(--line)">
                  <span class="mono tiny" style="color:var(--wine);width:34px">${esc(w.date.slice(8))}</span>
                  <span class="tiny" style="flex:1">${esc(w.couple.bride)} &amp; ${esc(w.couple.groom)}</span>
                  <span class="tiny muted mono">¥${(w.fee || 0) / 1000}k</span>
                </div>`).join('') || '<div class="empty">本月无场次</div>'}
            </div>
          </div>
        </div>
      </div>`;

    $('#mPrev').onclick = () => shiftMonth(-1);
    $('#mNext').onclick = () => shiftMonth(1);
    $$('[data-date]').forEach(el => el.onclick = () => { state.selDate = el.dataset.date; renderCalendar(); });
    $$('[data-switch]').forEach(el => el.onclick = () => { state.wid = el.dataset.switch; renderShell(); go('dash'); });
    $$('[data-edit]').forEach(el => el.onclick = () => { state.wid = el.dataset.edit; renderShell(); go('survey'); });
    const add = (ds) => {
      const date = ds || state.selDate || ymd(TODAY);
      const same = DB.weddings.filter(x => x.date === date);
      const mk = () => {
        const w = {
          id: 'w' + uid(), date, time: '11:58', hotel: '', city: DB.profile.city,
          status: '咨询中', fee: 0, planner: '', contact: '', guests: 0,
          couple: { bride: '待定', groom: '待定', brideJob: '', groomJob: '' },
          survey: { how: '', story: '', like: '', parents: '', taboo: '', surprise: '', mustSay: '', guestsStruct: '', extra: '' },
          flow: clone(window.SEED_FLOWS).map(f => Object.assign({ id: uid() }, f)),
          songs: clone(window.SEED_SONGS).map(s => Object.assign({ id: uid() }, s)),
          scripts: {}
        };
        DB.weddings.push(w); save();
        state.wid = w.id; state.selDate = w.date;
        closeModal(); renderShell(); renderCalendar(); toast('已新建场次');
      };
      if (!same.length) { mk(); return; }
      openModal('这天已经有安排了', `
        <p class="small" style="margin:0 0 10px;line-height:1.8">${esc(prettyDate(date))} 已经有 ${same.length} 场：</p>
        <div class="exp-list">${same.map(x => `<div class="exp-li" style="grid-template-columns:1fr auto">
          <span class="nm">${esc(x.couple.bride)} &amp; ${esc(x.couple.groom)}</span>
          <span class="sz">${esc(x.time || '')} ${esc((x.hotel || '').split('·')[0])}</span></div>`).join('')}</div>
        <p class="tiny muted" style="margin:12px 0 0;line-height:1.8">同一天两场要自己确认赶得过来。可以照建，也可以先换个日子。</p>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="btn primary sm" id="clashGo">还是建在这一天</button>
          <button class="btn sm" id="clashCancel">换个日子</button>
        </div>`);
      $('#clashCancel').onclick = closeModal;
      $('#clashGo').onclick = mk;
    };
    if ($('#addW')) $('#addW').onclick = () => add(null);
    if ($('#addW2')) $('#addW2').onclick = () => add(state.selDate);
    $$('[data-delw]').forEach(b => b.onclick = () => {
      const w = DB.weddings.find(x => x.id === b.dataset.delw);
      if (w) confirmDeleteWedding(w);
    });
  }

  function shiftMonth(delta) {
    const [y, m] = state.calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    state.calMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    renderCalendar();
  }

  function confirmDeleteWedding(w) {
    if (DB.weddings.length <= 1) { toast('至少留一场，不能把最后一场删掉'); return; }
    const songs = w.songs || [];
    const audios = songs.filter(s => s.audio && s.audio.id);
    const nScript = Object.keys(w.scripts || {}).filter(k => w.scripts[k] && (w.scripts[k].blocks || []).length).length;
    openModal('删除这场？', `
      <div class="exp-card">
        <div class="exp-row"><span>场次</span><b>${esc(w.couple.bride || '')} &amp; ${esc(w.couple.groom || '')} · ${esc(w.date || '')}</b></div>
        <div class="exp-row"><span>会一起删</span><b>${nScript} 段稿件 · ${songs.length} 条歌单 · ${audios.length} 段音频</b></div>
      </div>
      <p class="tiny muted" style="margin:12px 0 0;line-height:1.8">删掉不能撤销。要留底就先在「设置」里导出全部数据。</p>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn primary sm" id="delwGo">确认删除</button>
        <button class="btn sm" id="delwCancel">取消</button>
      </div>`);
    $('#delwCancel').onclick = closeModal;
    $('#delwGo').onclick = () => {
      audios.forEach(s => { try { AudioLib.del(s.audio.id); } catch (e) { } delete PEAKS[s.audio.id]; });
      DB.weddings = DB.weddings.filter(x => x.id !== w.id);
      if (state.wid === w.id) state.wid = DB.weddings[0].id;
      save(); closeModal(); renderShell(); renderCalendar();
      toast('已删除这场（含 ' + audios.length + ' 段音频）');
    };
  }

  /* ================================================================
     ④ 调查问卷
     ================================================================ */
  const SURVEY_FIELDS = [
    ['how', '怎么认识的', '一句话就够：在哪、因为什么', 60],
    ['story', '一个只有你们知道的小事', '越具体越好，比如那碗面、那场雨', 90],
    ['like', '各自喜欢什么', '吃的、地方、天气、习惯', 60],
    ['parents', '双方父母的情况', '哪里人、性格、身体状况（影响台上安排）', 80],
    ['taboo', '不能提的事（避讳）', '离异、催生、病情、玩笑禁区 —— 这条最重要', 80],
    ['surprise', '准备的惊喜', '手写信、视频、伴郎的歌', 70],
    ['mustSay', '一定要提到的人和事', '比如"感谢两位妈妈"', 50],
    ['guestsStruct', '来宾构成', '亲戚几桌、同事几桌、有没有小孩', 60],
    ['extra', '其他要求', '时长、开席时间、机位、雨棚', 80]
  ];

  function renderSurvey() {
    const w = curW();
    const s = w.survey || {};
    $('#view').innerHTML = `
      <div style="display:grid;grid-template-columns:1.35fr .8fr;gap:16px;align-items:start">
        <div class="card">
          <div class="card-h"><h3>新人问卷</h3><span class="hint">填完自动进入台词与流程</span></div>
          <div class="card-b">
            <div class="grid-2">
              <div class="field"><label>新娘</label><input class="input" id="f_bride" value="${esc(w.couple.bride)}"></div>
              <div class="field"><label>新郎</label><input class="input" id="f_groom" value="${esc(w.couple.groom)}"></div>
              <div class="field"><label>新娘职业</label><input class="input" id="f_bjob" value="${esc(w.couple.brideJob || '')}" placeholder="影响能不能拿职业开玩笑"></div>
              <div class="field"><label>新郎职业</label><input class="input" id="f_gjob" value="${esc(w.couple.groomJob || '')}"></div>
              <div class="field"><label>日期</label><input class="input" type="date" id="f_date" value="${esc(w.date)}"></div>
              <div class="field"><label>仪式时间</label><input class="input" type="time" id="f_time" value="${esc(w.time || '')}"></div>
              <div class="field"><label>场地</label><input class="input" id="f_hotel" value="${esc(w.hotel)}"></div>
              <div class="field"><label>桌数 / 人数</label><input class="input" id="f_guests" value="${esc(w.guests || '')}"></div>
              <div class="field"><label>报价（元）</label><input class="input" id="f_fee" value="${esc(w.fee || 0)}"></div>
              <div class="field"><label>状态</label>
                <select class="input" id="f_status">
                  ${['咨询中', '待确认', '已定', '已完成'].map(x => `<option ${x === w.status ? 'selected' : ''}>${x}</option>`).join('')}
                </select>
              </div>
            </div>
            <hr class="sep">
            ${SURVEY_FIELDS.map(([k, label, ph, h]) => `
              <div class="field">
                <label>${label}${['taboo', 'story'].includes(k) ? ' <span class="tag wine" style="margin-left:4px">关键</span>' : ''}</label>
                <textarea class="input" data-sf="${k}" rows="${h > 70 ? 3 : 2}" placeholder="${esc(ph)}">${esc(s[k] || '')}</textarea>
              </div>`).join('')}
            <div style="display:flex;gap:8px;margin-top:6px">
              <button class="btn primary" id="svSave">保存问卷</button>
              <button class="btn" id="svNext">保存并去出稿</button>
            </div>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="card-h"><h3>发给新人</h3><span class="hint">扫码填 / 复制发微信</span></div>
            <div class="card-b" style="text-align:center">
              <div id="qrBox" style="display:inline-block;padding:8px;border:1px solid var(--line);border-radius:12px;background:#fff"></div>
              <div class="qr-link" id="qrLink" title="点一下复制这条链接"></div>
              <p class="tiny muted" id="qrHint" style="line-height:1.7;margin:8px 0 0"></p>
              <div style="display:flex;gap:6px;margin-top:10px">
                <button class="btn sm" id="cpLink" style="flex:1">复制问卷链接</button>
                <button class="btn sm" id="cpTxt" style="flex:1">复制问卷文字版</button>
              </div>
              <div style="display:flex;gap:6px;margin-top:6px">
                <button class="btn sm ghost" id="qrSave" style="flex:1">保存二维码</button>
                <button class="btn sm ghost" id="qrPreview" style="flex:1">预览问卷页</button>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:14px">
            <div class="card-h"><h3>婚庆问卷导入</h3><span class="hint">策划那边发来的</span></div>
            <div class="card-b">
              <p class="tiny muted" style="margin:0 0 10px;line-height:1.7">PDF、Word、Excel、CSV 直接拖进来，程序自己抠文字；也可以把微信里的一段话粘进来。抠完自动认日期、场地、人数、新人名，认不准的可以点「AI 精读」。</p>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:9px">
                <button class="btn sm" id="importFileBtn">选择文件（PDF / Word / 表格）</button>
                <input type="file" id="importFile" accept=".pdf,.docx,.xlsx,.csv,.tsv,.txt,.md,.doc,.xls" style="display:none">
                <span class="tiny muted" id="importName">未选择文件</span>
              </div>
              <div id="importDrop" class="drop-zone">
                <span>把文件拖到这里，或点上面的按钮</span>
              </div>
              <textarea class="input" id="importBox" rows="5" placeholder="粘贴策划问卷或微信聊天里的信息…" style="margin-top:9px"></textarea>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px">
                <button class="btn sm" id="importParse">识别并填入</button>
                <button class="btn sm" id="importAi" ${LLM.available() ? '' : 'title="先填自己的模型 key"'}>AI 精读</button>
                <button class="btn sm" id="importClear">清空</button>
                <button class="btn sm ghost" id="expSurvey" style="margin-left:auto" title="把所有场次的问卷导出成表格">导出问卷汇总 .csv</button>
              </div>
              <div id="importLog" style="margin-top:10px"></div>
              <hr class="sep">
              <div class="field" style="margin:0">
                <label>补充访谈（新人不想填问卷时，你自己聊出来的）</label>
                <textarea class="input" data-sf="extra" rows="4" placeholder="聊到什么都记下来，越琐碎越好用">${esc(s.extra || '')}</textarea>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    /* ---------- 发给新人：真链接 + 真二维码 ---------- */
    const link = surveyLink(w);
    const online = isOnline();
    const localOnly = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(location.hostname || '');
    let qrCanvas = null;
    if (online) {
      qrCanvas = drawQR($('#qrBox'), link);
    } else {
      $('#qrBox').innerHTML = '<div class="qr-off">本机文件模式<br><span>没有可扫的公开地址</span></div>';
    }
    $('#qrLink').textContent = online ? link : link.replace(/^.*\//, '…/');
    $('#qrLink').title = link;
    $('#qrLink').onclick = () => copy(link);
    $('#qrHint').innerHTML = !online
      ? '现在是双击本机文件打开的，手机扫不到这个地址。点「下载问卷文件」可以拿到一份能直接发给新人的问卷，或把它发布成在线链接后再扫码。'
      : localOnly
        ? '码里现在填的是本机地址，只有这台电脑打得开。发布成在线链接以后，这个码就能直接给新人扫。'
        : '手机扫码直接填，填完点「生成回答」，把那句话发回微信，再粘到下面「婚庆问卷导入」就能回填。';

    const saveBtn = $('#qrSave');
    if (online) {
      saveBtn.textContent = '保存二维码';
      saveBtn.onclick = () => {
        if (!qrCanvas) return toast('二维码没生成出来');
        downloadCanvas(qrCanvas, `问卷二维码-${w.couple.bride || ''}${w.couple.groom || ''}.png`);
      };
      $('#qrPreview').onclick = () => window.open(link, '_blank');
    } else {
      saveBtn.textContent = '下载问卷文件';
      saveBtn.onclick = () => {
        const blob = new Blob([surveyFileHtml(w)], { type: 'text/html;charset=utf-8' });
        saveBlob(blob, `婚礼问卷-${w.couple.bride || ''}${w.couple.groom || ''}.html`, { kind: 'html' });
      };
      $('#qrPreview').textContent = '预览问卷页';
      $('#qrPreview').onclick = () => {
        const blob = new Blob([surveyFileHtml(w)], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      };
    }

    const bindField = (id, fn) => { const el = $(id); if (el) el.onchange = () => { fn(el.value); save(); renderShell(); }; };
    bindField('#f_bride', v => w.couple.bride = v.trim());
    bindField('#f_groom', v => w.couple.groom = v.trim());
    bindField('#f_bjob', v => w.couple.brideJob = v.trim());
    bindField('#f_gjob', v => w.couple.groomJob = v.trim());
    bindField('#f_date', v => w.date = v);
    const dateEl = $('#f_date');
    if (dateEl) dateEl.onchange = () => {
      const v = dateEl.value;
      const others = DB.weddings.filter(x => x.id !== w.id && x.date === v);
      w.date = v; save(); renderShell();
      if (others.length) {
        toast(`注意：${v.slice(5)} 还有 ${others.length} 场（${others.map(x => x.couple.bride || '待定').join('、')}），确认赶得过来`);
      }
    };
    bindField('#f_time', v => w.time = v);
    bindField('#f_hotel', v => w.hotel = v.trim());
    bindField('#f_guests', v => w.guests = Number(v) || 0);
    bindField('#f_fee', v => w.fee = Number(v) || 0);
    bindField('#f_status', v => w.status = v);

    $$('[data-sf]').forEach(el => {
      el.onchange = () => { w.survey[el.dataset.sf] = el.value; save(); };
    });

    const persistAll = () => {
      w.couple.bride = $('#f_bride').value.trim();
      w.couple.groom = $('#f_groom').value.trim();
      w.couple.brideJob = $('#f_bjob').value.trim();
      w.couple.groomJob = $('#f_gjob').value.trim();
      w.date = $('#f_date').value; w.time = $('#f_time').value;
      w.hotel = $('#f_hotel').value.trim(); w.guests = Number($('#f_guests').value) || 0;
      w.fee = Number($('#f_fee').value) || 0; w.status = $('#f_status').value;
      $$('[data-sf]').forEach(el => { w.survey[el.dataset.sf] = el.value; });
      save(); renderShell();
    };
    $('#svSave').onclick = () => { persistAll(); toast('问卷已保存'); };
    $('#svNext').onclick = () => { persistAll(); go('script'); };

    $('#cpLink').onclick = () => copy(link);
    $('#cpTxt').onclick = () => {
      const t = `【${w.couple.bride || '新人'} & ${w.couple.groom || ''} 婚礼问卷】` +
        (w.date ? `\n日期：${w.date}${w.time ? ' ' + w.time : ''}` : '') +
        (w.hotel ? `\n场地：${w.hotel}` : '') +
        `\n\n有几个小问题想请你们聊聊（一句话就行，不想聊的跳过）：\n` +
        SURVEY_ASK.map(([k, label, q], i) => `${i + 1}. ${q}`).join('\n') +
        `\n\n回答直接按「1. ${SURVEY_ASK[0][1]}：…」这样回我就行。`;
      copy(t);
    };

    const showLog = (log, extra) => {
      $('#importLog').innerHTML = log.length
        ? `<div class="tiny" style="background:var(--sage-soft);color:#3F5A4C;border-radius:8px;padding:8px 11px">${extra ? esc(extra) + '<br>' : ''}识别到 ${log.length} 项：<br>${log.map(esc).join('<br>')}</div>
           <button class="btn sm" id="applyImport" style="margin-top:8px">确认写入</button>`
        : `<div class="tiny" style="color:var(--wine)">${extra ? esc(extra) + '<br>' : ''}没识别出结构化字段。可以直接把内容补进下面的访谈栏，或者手动填上面的表。</div>`;
      if ($('#applyImport')) $('#applyImport').onclick = () => { persistAll(); toast('已写入问卷'); renderSurvey(); };
    };

    const parseInto = (t, extra) => {
      const log = [];
      const setIf = (sel, cond, val, name) => { if (cond) { $(sel).value = val; log.push(name + '：' + val); } };
      /* PDF 常把字之间塞空格、还有康熙部首兼容字，先规整再匹配 */
      const n = String(t || '').normalize('NFKC')
        .replace(/\s*\n\s*/g, ' ')
        .replace(/(\d)\s+(?=\d)/g, '$1')
        .replace(/\s+(?=[\u4e00-\u9fa5])/g, '')
        .replace(/([\u4e00-\u9fa5])\s+/g, '$1');

      /* 有明确标签的最可靠，先认标签 */
      const labeled = (re) => { const m = n.match(re); return m ? m[1].trim() : ''; };
      const lBride = labeled(/(?:新娘|女方)(?:姓名)?\s*[：:]\s*([\u4e00-\u9fa5]{2,4})/);
      const lGroom = labeled(/(?:新郎|男方)(?:姓名)?\s*[：:]\s*([\u4e00-\u9fa5]{2,4})/);
      if (lBride) setIf('#f_bride', true, lBride, '新娘');
      if (lGroom) setIf('#f_groom', true, lGroom, '新郎');

      const dateM = n.match(/(20\d{2})[年\-\/\.](\d{1,2})[月\-\/\.](\d{1,2})/);
      if (dateM) setIf('#f_date', true, `${dateM[1]}-${String(dateM[2]).padStart(2, '0')}-${String(dateM[3]).padStart(2, '0')}`, '日期');
      const timeM = n.match(/(\d{1,2})[:：](\d{2})/);
      if (timeM) setIf('#f_time', true, `${String(timeM[1]).padStart(2, '0')}:${timeM[2]}`, '时间');
      const hotelM = n.match(/([\u4e00-\u9fa5A-Za-z0-9·]{2,18}(?:酒店|饭店|餐厅|草坪|庄园|会所|艺术中心|油画院|会展中心))(?:\s*([\u4e00-\u9fa5A-Za-z0-9·]{2,10}))?/);
      if (hotelM) {
        const clean = s => String(s || '').replace(/^[·・\-—\s]+|[·・\-—\s]+$/g, '');
        const name = clean(hotelM[1] + (hotelM[2] && !/婚|日期|时间|人数|来宾/.test(hotelM[2]) ? hotelM[2] : ''));
        if (name) setIf('#f_hotel', true, name, '场地');
      }
      const numM = n.match(/(\d{2,3})\s*(?:位|人|桌)/);
      if (numM) setIf('#f_guests', true, numM[1], '人数');

      if (!lBride && !lGroom) {
        const coupleM = n.match(/([\u4e00-\u9fa5]{2,4}?)\s*(?:先生|小姐|[&和与×♥])\s*([\u4e00-\u9fa5]{2,4}?)(?=[\s，,。；;、]|$)/);
        if (coupleM) {
          setIf('#f_bride', true, coupleM[1], '新娘');
          setIf('#f_groom', true, coupleM[2], '新郎');
          log.push('（两位名字按「第一个是新娘」放的，反了点右边换一下）');
        }
      }
      /* 新人问卷回复（「1. 避讳：…」一行一条）→ 回填下面的问答题 */
      const raw = String(t || '').normalize('NFKC');
      const sfFilled = [];
      SURVEY_ASK.forEach(([k, label]) => {
        const aliases = SURVEY_ALIAS[k] || [label];
        let val = '';
        raw.split(/\r?\n/).forEach(line => {
          if (val) return;
          const clean = line.replace(/^\s*\d+\s*[.、)．]\s*/, '').trim();
          aliases.forEach(a => {
            const m = clean.match(new RegExp('^' + a + '\\s*[：:]\\s*(.+)$'));
            if (!m) return;
            const v = m[1].trim();
            if (v && !/^[（(]?(还没想好|略|空)[）)]?$/.test(v)) val = v;
          });
        });
        if (!val) return;
        $$(`[data-sf="${k}"]`).forEach(el => { el.value = val; });
        sfFilled.push(label + '：' + (val.length > 20 ? val.slice(0, 20) + '…' : val));
      });
      if (sfFilled.length) {
        log.push('—— 新人问卷回复 ——');
        sfFilled.forEach(x => log.push(x));
      }

      showLog(log, extra);
      return log;
    };

    /* 文件导入：PDF / Word / Excel / CSV / TXT */
    const fileEl = $('#importFile');
    $('#importFileBtn').onclick = () => fileEl.click();
    const handleFile = async (file) => {
      if (!file) return;
      const btn = $('#importFileBtn');
      $('#importName').textContent = file.name + ' · ' + (file.size / 1024).toFixed(0) + ' KB';
      btn.disabled = true; btn.textContent = '正在读…';
      $('#importLog').innerHTML = `<div class="tiny muted">正在从 ${esc(file.name)} 里取文字…</div>`;
      try {
        const r = await window.Importers.extract(file);
        const text = (r.text || '').trim();
        if (!text) throw new Error('这个文件里没取到文字（可能是扫描件或纯图片）');
        $('#importBox').value = text;
        parseInto(text, `${r.kind} 取到 ${text.length} 字`);
        toast(`已读入 ${r.kind}：${text.length} 字`);
      } catch (e) {
        $('#importLog').innerHTML = `<div class="tiny" style="background:var(--wine-soft);color:var(--wine);border-radius:8px;padding:8px 11px">${esc(e.message || '读取失败')}<br><span class="muted">也可以先在电脑上把内容复制出来，粘到上面的框里。</span></div>`;
      } finally {
        btn.disabled = false; btn.textContent = '选择文件（PDF / Word / 表格）';
        fileEl.value = '';
      }
    };
    fileEl.onchange = () => handleFile(fileEl.files[0]);
    const drop = $('#importDrop');
    if (drop) {
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('on'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('on'); }));
      drop.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
      drop.onclick = () => fileEl.click();
    }

    $('#importParse').onclick = () => {
      const t = $('#importBox').value;
      if (!t.trim()) return toast('先把内容贴进来，或导入文件');
      parseInto(t);
    };

    /* AI 精读：把材料交给模型，让它按字段抽取 JSON */
    $('#importAi').onclick = async () => {
      const t = $('#importBox').value.trim();
      if (!LLM.available()) { openModelModal(() => toast('模型就绪，再点一次「AI 精读」')); return; }
      if (!t) return toast('先导入文件或粘贴内容');
      const btn = $('#importAi');
      btn.disabled = true; btn.textContent = '读…';
      $('#importLog').innerHTML = `<div class="tiny muted">大模型正在读这份材料…</div>`;
      try {
        const raw = await LLM.stream({
          system: '你是婚礼主持人的助理，专门从策划案、酒店合同、微信聊天记录里抽取结构化信息。只输出一个 JSON 对象，不要解释，不要 Markdown 代码块。',
          user: [
            '从下面的材料里抽取信息，输出 JSON，字段如下（没有的字段给空字符串，不要编）：',
            '{',
            '  "bride": "新娘姓名", "groom": "新郎姓名",',
            '  "brideJob": "新娘职业", "groomJob": "新郎职业",',
            '  "date": "YYYY-MM-DD", "time": "HH:MM",',
            '  "hotel": "酒店或场地全名", "guests": "到场人数（纯数字）",',
            '  "fee": "主持费（纯数字，没有就空）",',
            '  "how": "两人怎么认识的", "story": "恋爱故事细节",',
            '  "like": "各自喜欢什么", "parents": "父母情况",',
            '  "taboo": "避讳与禁忌", "mustSay": "新人要求一定要提到的内容",',
            '  "extra": "其他有用信息（流程、时长、特殊环节）"',
            '}',
            '',
            '材料：',
            t.slice(0, 8000)
          ].join('\n'),
          temperature: 0.1
        });
        const jsonText = String(raw).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        const obj = JSON.parse(jsonText.slice(jsonText.indexOf('{'), jsonText.lastIndexOf('}') + 1));
        const log = [];
        const put = (sel, key, label, isNum) => {
          const v = obj[key];
          if (v == null || v === '') return;
          const el = $(sel);
          if (!el) return;
          el.value = isNum ? String(v).replace(/[^\d]/g, '') : v;
          log.push(label + '：' + el.value);
        };
        put('#f_bride', 'bride', '新娘'); put('#f_groom', 'groom', '新郎');
        put('#f_bjob', 'brideJob', '新娘职业'); put('#f_gjob', 'groomJob', '新郎职业');
        put('#f_date', 'date', '日期'); put('#f_time', 'time', '时间');
        put('#f_hotel', 'hotel', '场地'); put('#f_guests', 'guests', '人数', true);
        put('#f_fee', 'fee', '主持费', true);
        [['how', '怎么认识的'], ['story', '恋爱故事'], ['like', '各自喜好'], ['parents', '父母情况'],
         ['taboo', '避讳'], ['mustSay', '必提内容'], ['extra', '补充']].forEach(([k, label]) => {
          const v = obj[k];
          if (!v) return;
          const el = $(`[data-sf="${k}"]`);
          if (el) { el.value = v; log.push(label + '：' + String(v).slice(0, 40)); }
          else { w.survey[k] = v; log.push(label + '：' + String(v).slice(0, 40)); }
        });
        showLog(log, 'AI 精读结果');
      } catch (e) {
        $('#importLog').innerHTML = `<div class="tiny" style="background:var(--wine-soft);color:var(--wine);border-radius:8px;padding:8px 11px">AI 没读成：${esc(e.message || '未知错误')}<br><span class="muted">可以先用「识别并填入」，再手动补。</span></div>`;
      } finally {
        btn.disabled = false; btn.textContent = 'AI 精读';
      }
    };

    $('#importClear').onclick = () => { $('#importBox').value = ''; $('#importLog').innerHTML = ''; $('#importName').textContent = '未选择文件'; };
    $('#expSurvey').onclick = () => {
      const csv = surveyCsvAll();
      if (!csv) return toast('还没有可导出的问卷');
      download(csv, `问卷汇总_${ymd(TODAY)}.csv`);
    };
  }

  /* 所有场次的问卷汇总成一张表，Excel / 飞书表格都能直接打开 */
  function surveyCsvAll() {
    const cols = [['日期', w => w.date], ['时间', w => w.time], ['新娘', w => w.couple.bride], ['新郎', w => w.couple.groom],
      ['场地', w => w.hotel], ['状态', w => w.status]].concat(
      SURVEY_FIELDS.map(([k, label]) => [label, w => (w.survey && w.survey[k]) || '']));
    const cell = (v) => {
      const t = String(v == null ? '' : v).replace(/\r?\n/g, ' ').replace(/"/g, '""').trim();
      return /[",\n]/.test(t) ? '"' + t + '"' : t;
    };
    const rows = DB.weddings.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!rows.length) return '';
    return [cols.map(c => cell(c[0])).join(',')]
      .concat(rows.map(w => cols.map(c => { try { return cell(c[1](w)); } catch (e) { return ''; } }).join(',')))
      .join('\r\n');
  }

  /* ================================================================
     问卷链接 / 二维码（真·可扫码）
     ================================================================ */
  /* 新人填表用的题目：短标签 + 长问题，回复文字里用短标签，方便再导回来 */
  const SURVEY_ASK = [
    ['how', '怎么认识的', '你们是怎么认识的？在哪、因为什么（一句话就够）'],
    ['story', '一件小事', '一件只有你们知道的小事：越具体越好，比如那碗面、那场雨'],
    ['like', '喜欢什么', '各自喜欢什么？吃的、地方、天气、小习惯'],
    ['parents', '父母情况', '双方父母哪里人、性格怎么样、身体还好吗（影响台上怎么安排）'],
    ['taboo', '避讳', '有没有不能提的事？离异、催生、病情、玩笑禁区 —— 这条最关键'],
    ['surprise', '惊喜', '你们准备了什么惊喜？手写信、视频、伴郎的歌'],
    ['mustSay', '一定要提到', '一定要在台上提到的人或事？比如「谢谢两位妈妈」'],
    ['guestsStruct', '来宾构成', '来宾大概怎么构成？亲戚几桌、同事几桌、有没有小孩'],
    ['extra', '其他要求', '其他要求：时长、开席时间、机位、雨棚']
  ];
  /* 回复文字里可能出现的写法，解析时都认 */
  const SURVEY_ALIAS = {
    how: ['怎么认识的', '怎么认识', '认识'],
    story: ['一件小事', '小事', '恋爱故事', '故事'],
    like: ['喜欢什么', '各自喜欢', '爱好'],
    parents: ['父母情况', '双方父母', '父母'],
    taboo: ['避讳', '不能提的事', '不能提', '禁忌'],
    surprise: ['惊喜'],
    mustSay: ['一定要提到', '一定要说', '必须提到'],
    guestsStruct: ['来宾构成', '来宾', '宾客'],
    extra: ['其他要求', '其他', '补充']
  };

  /* 保留 sharecode 这类访问参数：发布出去的链接少了它会被判「链接不完整」 */
  const baseUrl = () => {
    const raw = String(location.href || '');
    const noHash = raw.split('#')[0];
    if (!/^https?:/i.test(noHash)) return noHash.split('?')[0];
    try {
      const u = new URL(noHash);
      u.searchParams.delete('survey');
      u.searchParams.delete('d');
      const q = u.searchParams.toString();
      return u.origin + u.pathname + (q ? '?' + q : '');
    } catch (e) { return noHash.split('?')[0]; }
  };
  const isOnline = () => /^https?:$/i.test(location.protocol);

  /* 二维码容量有限（本实现上限约 270 字节），所以链接里只带最必要的几个字 */
  const b64uEnc = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const b64uDec = (s) => {
    let t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    const bin = atob(t);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  };

  /* 问卷链接要把场次信息一起带上：新人的手机上并没有主持人的本地数据 */
  const surveyLink = (w) => {
    const base = baseUrl();
    let q = (base.indexOf('?') >= 0 ? '&' : '?') + 'survey=' + encodeURIComponent(w.id);
    try {
      q += '&d=' + b64uEnc(JSON.stringify({
        b: w.couple.bride || '', g: w.couple.groom || '',
        d: w.date || '', t: w.time || '', h: w.hotel || '',
        ho: DB.profile.name || ''
      }));
    } catch (e) { }
    return base + q;
  };

  /* 从链接里还原出一场「只够渲染问卷」的婚礼 */
  function guestWedding(id, d) {
    if (!d) return null;
    let p = null;
    try { p = JSON.parse(b64uDec(d)); } catch (e) { return null; }
    if (!p || (!p.b && !p.g)) return null;
    return {
      id: id || 'guest',
      date: p.d || '', time: p.t || '', hotel: p.h || '',
      couple: { bride: p.b || '', groom: p.g || '', brideJob: '', groomJob: '' },
      survey: {}, host: p.ho || ''
    };
  }

  function surveyReplyText(w, vals) {
    const head = `【${w.couple.bride || '新娘'} & ${w.couple.groom || '新郎'} 婚礼问卷】` +
      (w.date ? ` ${w.date}` : '') + (w.time ? ' ' + w.time : '') + (w.hotel ? ` · ${w.hotel}` : '');
    const lines = SURVEY_ASK.map(([k, label], i) => {
      const v = String((vals && vals[k]) || '').replace(/\s+/g, ' ').trim();
      return `${i + 1}. ${label}：${v || '（还没想好）'}`;
    });
    return head + '\n' + lines.join('\n');
  }

  function drawQR(box, text, opt) {
    if (!box) return null;
    box.innerHTML = '';
    if (!window.QR) { box.innerHTML = '<span class="tiny muted">二维码模块没加载</span>'; return null; }
    const cv = document.createElement('canvas');
    try {
      window.QR.draw(cv, text, Object.assign({ size: 208, dark: '#1B1815', light: '#fff' }, opt || {}));
    } catch (e) {
      box.innerHTML = '<span class="tiny muted">这段地址太长，画不成码</span>';
      return null;
    }
    box.appendChild(cv);
    return cv;
  }

  /* ---------------- 新人问卷页（?survey=场次id） ---------------- */
  const SURVEY_CSS = `
  .g-page{position:fixed;inset:0;z-index:90;overflow:auto;-webkit-overflow-scrolling:touch;background:#FBF8F3;color:#221E19;
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
  .g-wrap{max-width:600px;margin:0 auto;padding:46px 22px 90px}
  .g-seal{width:44px;height:44px;border-radius:10px;background:var(--wine);color:#F7EDE6;font-family:"Songti SC",serif;
    font-size:24px;display:flex;align-items:center;justify-content:center;margin-bottom:20px}
  .g-wrap h1{font-family:"Songti SC","Noto Serif SC",serif;font-size:26px;line-height:1.4;margin:0 0 8px;font-weight:600;letter-spacing:.5px}
  .g-meta{margin:0 0 18px;font-size:13px;color:var(--wine);letter-spacing:.4px}
  .g-intro{margin:0 0 26px;font-size:14px;line-height:1.85;color:#5B544A}
  .g-field{margin-bottom:18px}
  .g-field label{display:block;font-size:13.5px;line-height:1.7;color:#3A342C;margin-bottom:7px}
  .g-no{display:inline-flex;width:19px;height:19px;border-radius:50%;background:#F0E7DA;color:var(--wine);font-size:11px;
    align-items:center;justify-content:center;margin-right:8px;vertical-align:1px}
  .g-input{width:100%;box-sizing:border-box;border:1px solid #E2D9CA;border-radius:10px;background:#fff;padding:11px 13px;
    font-size:14px;line-height:1.7;color:#221E19;font-family:inherit;outline:none;transition:border-color .15s}
  .g-input:focus{border-color:#B08A52;box-shadow:0 0 0 3px rgba(176,138,82,.13)}
  textarea.g-input{resize:vertical;min-height:56px}
  .g-actions{display:flex;gap:10px;margin:26px 0 12px}
  .g-btn{flex:1;padding:13px 18px;border-radius:10px;border:1px solid var(--wine);background:var(--wine);color:#fff;
    font-size:14px;font-family:inherit;cursor:pointer}
  .g-btn:active{transform:translateY(1px)}
  .g-btn.ghost{background:#fff;color:var(--wine)}
  .g-tip{font-size:12.5px;line-height:1.75;color:#8B8175;margin:0 0 14px}
  .g-out{background:#FFFDF9;border-style:dashed}
  .g-foot{margin-top:34px;font-size:11.5px;color:#B3AA9C;letter-spacing:.3px}
  `;

  function surveyBodyHtml(w, meta) {
    const m = meta || {};
    const bride = w.couple.bride || '', groom = w.couple.groom || '';
    const title = (bride && groom) ? (bride + ' & ' + groom) : (bride || groom || '我们');
    return `
  <div class="g-wrap">
    <div class="g-seal">囍</div>
    <h1>${esc(title)} 的婚礼问卷</h1>
    <p class="g-meta">${esc(w.date || '')}${w.time ? ' · ' + esc(w.time) : ''}${w.hotel ? ' · ' + esc(w.hotel) : ''}</p>
    <p class="g-intro">主持人在准备你们那天要说的话。下面几个问题，想到什么写什么，一句话也行；不想聊的留空就好。</p>
    <form id="gForm" autocomplete="off" onsubmit="return false">
      <div class="g-field">
        <label>你们的名字</label>
        <input id="gNames" class="g-input" placeholder="比如 新娘名 & 新郎名">
      </div>
      ${SURVEY_ASK.map(([k, label, q], i) => `
      <div class="g-field">
        <label><span class="g-no">${i + 1}</span>${esc(q)}</label>
        <textarea class="g-input" data-q="${k}" rows="${(k === 'extra' || k === 'parents' || k === 'taboo') ? 3 : 2}" placeholder="想到什么写什么"></textarea>
      </div>`).join('')}
    </form>
    <div class="g-actions">
      <button class="g-btn" id="gMake" type="button">生成回答</button>
      <button class="g-btn ghost" id="gCopy" type="button">复制回答</button>
    </div>
    <p class="g-tip" id="gTip">填完点「生成回答」，把生成的那段文字复制发回微信就好。</p>
    <textarea id="gOut" class="g-input g-out" rows="10" readonly placeholder="生成后的回答会出现在这里"></textarea>
    <p class="g-foot">${esc(m.brand || DB.profile.brand || CFG.brand.name)} · ${esc(m.host || DB.profile.name || '')}</p>
  </div>`;
  }

  function bindSurveyForm(w, scope, opts) {
    scope = scope || document;
    opts = opts || {};
    const key = CFG.key('survey') + '.' + w.id;
    const fields = $$('[data-q]', scope);
    const namesEl = $('#gNames', scope);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { saved = {}; }
    fields.forEach(el => { if (saved[el.dataset.q]) el.value = saved[el.dataset.q]; });
    if (namesEl && saved.__names) namesEl.value = saved.__names;

    const collect = () => {
      const v = {};
      fields.forEach(el => { v[el.dataset.q] = el.value.trim(); });
      if (namesEl) v.__names = namesEl.value.trim();
      return v;
    };
    const persist = () => { try { localStorage.setItem(key, JSON.stringify(collect())); } catch (e) {} };
    fields.forEach(el => el.addEventListener('input', persist));
    if (namesEl) namesEl.addEventListener('input', persist);

    const out = $('#gOut', scope);
    const tip = $('#gTip', scope);
    const make = () => {
      const v = collect();
      const ww = Object.assign({}, w, { couple: Object.assign({}, w.couple) });
      if (v.__names) {
        const parts = v.__names.split(/[&＆和与、,，\/\s]+/).filter(Boolean);
        if (parts[0]) ww.couple.bride = parts[0];
        if (parts[1]) ww.couple.groom = parts[1];
      }
      const text = surveyReplyText(ww, v);
      out.value = text;
      return text;
    };
    $('#gMake', scope).onclick = () => {
      make();
      if (tip) tip.textContent = '已生成。复制这段文字，发回给主持人就行。';
      persist();
      out.focus();
      try { out.select(); } catch (e) {}
      if (!opts.standalone) toast('已生成回答，可以复制了');
    };
    $('#gCopy', scope).onclick = () => {
      if (!out.value.trim()) make();
      if (opts.standalone) {
        if (legacyCopy(out.value)) { if (tip) tip.textContent = '已复制。粘贴到微信发给主持人即可。'; }
        else { out.focus(); out.select(); if (tip) tip.textContent = '已全选，按 ⌘/Ctrl + C 复制。'; }
        return;
      }
      copy(out.value);
    };
  }

  function renderGuest(id, d) {
    const fromLink = guestWedding(id, d);
    const w = fromLink || DB.weddings.find(x => x.id === id) || DB.weddings[0];
    const app = $('.app');
    if (app) app.style.display = 'none';
    const st = document.createElement('style');
    st.textContent = SURVEY_CSS;
    document.head.appendChild(st);
    const page = document.createElement('div');
    page.className = 'g-page';
    page.innerHTML = surveyBodyHtml(w, fromLink ? { host: fromLink.host } : null);
    document.body.appendChild(page);
    bindSurveyForm(w, page);
    document.title = `${w.couple.bride || ''} & ${w.couple.groom || ''} · 婚礼问卷`;
  }

  /* 离线也能用：把问卷打包成一个单独的 html 文件发出去 */
  function surveyFileHtml(w) {
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc((w.couple.bride || '') + ' & ' + (w.couple.groom || ''))} 婚礼问卷</title>
<style>${SURVEY_CSS}</style></head>
<body class="g-body">${surveyBodyHtml(w)}
<script>
(function(){
  var fields = [].slice.call(document.querySelectorAll('[data-q]'));
  var names = document.getElementById('gNames');
  var out = document.getElementById('gOut');
  var tip = document.getElementById('gTip');
  var ASK = ${JSON.stringify(SURVEY_ASK.map(a => [a[0], a[1]]))};
  var KEY = '${CFG.key("survey")}.${w.id}';
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
  fields.forEach(function (el) { if (saved[el.dataset.q]) el.value = saved[el.dataset.q]; });
  if (names && saved.__names) names.value = saved.__names;
  function collect() {
    var v = {};
    fields.forEach(function (el) { v[el.dataset.q] = el.value.trim(); });
    if (names) v.__names = names.value.trim();
    return v;
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(collect())); } catch (e) {} }
  fields.forEach(function (el) { el.addEventListener('input', persist); });
  if (names) names.addEventListener('input', persist);
  function make() {
    var v = collect();
    var bride = ${JSON.stringify(w.couple.bride || '')}, groom = ${JSON.stringify(w.couple.groom || '')};
    if (v.__names) {
      var parts = v.__names.split(/[&\uff06\u548c\u4e0e\u3001,\uff0c\\/\\s]+/).filter(Boolean);
      if (parts[0]) bride = parts[0];
      if (parts[1]) groom = parts[1];
    }
    var head = '\u3010' + (bride || '\u65b0\u5a18') + ' & ' + (groom || '\u65b0\u90ce') +
      ' \u5a5a\u793c\u95ee\u5377\u3011 ${esc(w.date || '')}${w.time ? ' ' + esc(w.time) : ''}${w.hotel ? ' \u00b7 ' + esc(w.hotel) : ''}';
    var lines = ASK.map(function (a, i) {
      var t = (v[a[0]] || '').replace(/\\s+/g, ' ').trim();
      return (i + 1) + '. ' + a[1] + '\uff1a' + (t || '\uff08\u8fd8\u6ca1\u60f3\u597d\uff09');
    });
    out.value = head + '\\n' + lines.join('\\n');
    return out.value;
  }
  document.getElementById('gMake').addEventListener('click', function () {
    make(); persist();
    tip.textContent = '\u5df2\u751f\u6210\u3002\u590d\u5236\u8fd9\u6bb5\u6587\u5b57\uff0c\u53d1\u56de\u7ed9\u4e3b\u6301\u4eba\u5c31\u884c\u3002';
    out.focus();
    try { out.select(); } catch (e) {}
  });
  document.getElementById('gCopy').addEventListener('click', function () {
    if (!out.value.trim()) make();
    var ok = false, ta = document.createElement('textarea');
    ta.value = out.value; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) { tip.textContent = '\u5df2\u590d\u5236\u3002\u7c98\u8d34\u5230\u5fae\u4fe1\u53d1\u7ed9\u4e3b\u6301\u4eba\u5373\u53ef\u3002'; }
    else {
      if (navigator.clipboard) { navigator.clipboard.writeText(out.value).then(function(){ tip.textContent = '\u5df2\u590d\u5236\u3002'; }, function(){ out.focus(); out.select(); tip.textContent = '\u5df2\u5168\u9009\uff0c\u6309 \u2318/Ctrl + C \u590d\u5236\u3002'; }); }
      else { out.focus(); out.select(); tip.textContent = '\u5df2\u5168\u9009\uff0c\u6309 \u2318/Ctrl + C \u590d\u5236\u3002'; }
    }
  });
})();
<\/script>
</body></html>`;
  }

  /* ================================================================
     ⑤ 流程表
     ================================================================ */
  function flowTimeline(w) {
    let acc = 0;
    const start = w.time || '11:58';
    return (w.flow || []).map(f => {
      const from = addMin(start, acc);
      acc += Number(f.dur) || 0;
      return Object.assign({}, f, { from, to: addMin(start, acc) });
    });
  }

  function renderFlow() {
    const w = curW();
    const total = flowTotal(w);
    const rows = flowTimeline(w);
    const maxDur = Math.max.apply(null, (w.flow || []).map(f => f.dur).concat([1]));

    $('#view').innerHTML = `
      <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:16px;align-items:start">
        <div class="card">
          <div class="card-h"><h3>${esc(w.couple.bride)} &amp; ${esc(w.couple.groom)} 的流程</h3>
            <span class="hint">${rows.length} 个环节 · 共 ${mmss(total)}</span></div>
          <div class="card-b" style="padding-top:8px">
            <div style="display:flex;gap:6px;margin-bottom:10px;align-items:center">
              <button class="btn sm" id="addSeg">＋ 加环节</button>
              <button class="btn sm" id="resetFlow">套用标准骨架</button>
              <span class="tiny muted" style="margin-left:auto">拖动 ⠿ 排序 · 点环节名可改</span>
            </div>
            <div class="flow-list" id="flowList">
              ${rows.map((f, i) => `
                <div class="flow-row" draggable="true" data-fi="${i}">
                  <span class="grip">⠿</span>
                  <span class="tm">${esc(f.from)}<br><span class="tiny muted">${esc(f.to)}</span></span>
                  <span class="t">
                    <input class="tin" value="${esc(f.name)}" data-name="${i}">
                    <span class="flow-bar"><i style="width:${Math.round((f.dur / maxDur) * 100)}%"></i></span>
                    <input class="tin" style="font-size:11px;color:var(--ink-3)" value="${esc(f.note || '')}" data-note="${i}" placeholder="备注：给策划 / 给新人">
                  </span>
                  <span style="display:flex;align-items:center;gap:4px">
                    <input class="tin" style="width:38px;text-align:right" value="${f.dur}" data-dur="${i}">
                    <span class="tiny muted">分</span>
                  </span>
                  <span class="vis" data-vis="${i}">
                    <button class="${f.vis === 'both' ? 'on' : ''}" data-set="both" title="新人和策划都能看">都看</button>
                    <button class="${f.vis === 'planner' ? 'on warn' : ''}" data-set="planner" title="只给策划，不进图片版">策划</button>
                    <button class="${f.vis === 'none' ? 'on warn' : ''}" data-set="none" title="完全不上图">隐藏</button>
                  </span>
                  <button class="btn ghost sm" data-del="${i}" style="color:var(--ink-4)">✕</button>
                </div>`).join('')}
            </div>
            <div style="display:flex;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line);flex-wrap:wrap">
              <button class="btn primary" id="dlPng">导出图片版 PNG</button>
              <button class="btn" id="cpText">复制文字版（给策划）</button>
              <button class="btn" id="previewPoster">看图片版</button>
            </div>
            <p class="tiny muted" style="margin:10px 0 0;line-height:1.7">「策划」和「隐藏」的环节不会出现在新人看到的图片版里——比如手捧花一分二这种，不能让新人提前知道。</p>
          </div>
        </div>

        <div class="card">
          <div class="card-h"><h3>图片版预览</h3><span class="hint">带你的 logo 和 slogan</span></div>
          <div class="card-b">
            ${posterHTML(w, rows, true)}
          </div>
        </div>
      </div>`;

    // 编辑
    $$('[data-name]').forEach(el => el.onchange = () => {
      const i = +el.dataset.name;
      const oldName = w.flow[i].name;
      const newName = el.value.trim();
      w.flow[i].name = newName;
      /* 环节改名，歌单里挂在这一环节上的歌跟着改 —— 不然播放器立刻对不上 */
      let moved = 0;
      if (segKey(oldName)) {
        (w.songs || []).forEach(s => {
          if (segKey(s.seg) === segKey(oldName)) { s.seg = segKey(newName) || newName; moved++; }
        });
      }
      save();
      if (moved) toast(`环节改名，歌单里 ${moved} 首跟着改了`);
    });
    $$('[data-note]').forEach(el => el.onchange = () => { w.flow[+el.dataset.note].note = el.value; save(); });
    $$('[data-dur]').forEach(el => el.onchange = () => { w.flow[+el.dataset.dur].dur = Math.max(0, Number(el.value) || 0); save(); renderFlow(); });
    $$('[data-vis]').forEach(box => {
      $$('button', box).forEach(b => b.onclick = () => {
        w.flow[+box.dataset.vis].vis = b.dataset.set; save(); renderFlow();
      });
    });
    $$('[data-del]').forEach(b => b.onclick = () => {
      const at = +b.dataset.del;
      const row = w.flow[at];
      if (!row) return;
      const key = segKey(row.name);
      const hit = (w.songs || []).map((s, i) => ({ s, i })).filter(x => segKey(x.s.seg) === key);
      const doDel = (alsoSongs) => {
        if (alsoSongs) {
          hit.slice().reverse().forEach(x => {
            if (x.s.audio && x.s.audio.id) { try { AudioLib.del(x.s.audio.id); } catch (e) { } delete PEAKS[x.s.audio.id]; }
            w.songs.splice(x.i, 1);
          });
        }
        w.flow.splice(at, 1);
        save(); renderFlow();
        toast(alsoSongs && hit.length ? `已删环节，连同 ${hit.length} 首歌` : '已删环节');
      };
      if (!hit.length) { doDel(false); return; }
      openModal('这个环节还挂着歌', `
        <p class="small" style="margin:0 0 10px;line-height:1.8">删掉「${esc(row.name)}」之后，歌单里这 ${hit.length} 首会变成「未匹配环节」，播放器也不会再播：</p>
        <div class="exp-list">${hit.map(x => `<div class="exp-li" style="grid-template-columns:1fr auto">
          <span class="nm">${esc(x.s.title || '（未命名）')}</span>
          <span class="sz">${x.s.audio ? '有音频' : '无音频'}</span></div>`).join('')}</div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="btn primary sm" id="fwDelBoth">一起删掉</button>
          <button class="btn sm" id="fwDelOnly">只删环节，歌留着</button>
          <button class="btn ghost sm" id="fwCancel">取消</button>
        </div>`);
      $('#fwCancel').onclick = closeModal;
      $('#fwDelOnly').onclick = () => { closeModal(); doDel(false); };
      $('#fwDelBoth').onclick = () => { closeModal(); doDel(true); };
    });
    $('#addSeg').onclick = () => {
      w.flow.push({ id: uid(), name: '新环节', dur: 3, note: '', vis: 'both' });
      save(); renderFlow();
    };
    $('#resetFlow').onclick = () => {
      w.flow = clone(window.SEED_FLOWS).map(f => Object.assign({ id: uid() }, f));
      save(); renderFlow(); toast('已套用标准骨架');
    };
    $('#cpText').onclick = () => copy(flowText(w));
    $('#dlPng').onclick = () => exportPoster(w);
    $('#previewPoster').onclick = () => openModal('图片版 · ' + w.couple.bride + ' & ' + w.couple.groom,
      `<div style="display:grid;place-items:center"><div style="width:420px">${posterHTML(w, flowTimeline(w), false)}</div></div>`);

    // drag
    let dragIdx = null;
    $$('.flow-row').forEach(row => {
      row.ondragstart = e => { dragIdx = +row.dataset.fi; row.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; };
      row.ondragend = () => { row.classList.remove('drag'); $$('.flow-row').forEach(r => r.classList.remove('over')); };
      row.ondragover = e => { e.preventDefault(); row.classList.add('over'); };
      row.ondragleave = () => row.classList.remove('over');
      row.ondrop = e => {
        e.preventDefault();
        const to = +row.dataset.fi;
        if (dragIdx == null || dragIdx === to) return;
        const item = w.flow.splice(dragIdx, 1)[0];
        w.flow.splice(to, 0, item);
        save(); renderFlow();
      };
    });
  }

  function posterHTML(w, rows, compact) {
    const vis = rows.filter(r => r.vis !== 'planner' && r.vis !== 'none');
    return `<div class="poster" style="${compact ? '' : 'padding:26px 28px'}">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div>
          <h4>${esc(w.couple.bride)} &amp; ${esc(w.couple.groom)}</h4>
          <div class="sub">${esc((w.date || '').replace(/-/g, ' / '))} · ${esc(w.time || '')}</div>
          <div class="sub" style="margin-top:2px">${esc(w.hotel)}</div>
        </div>
        <div style="margin-left:auto;text-align:right">
          <div style="font-family:var(--serif);font-size:13px;letter-spacing:.1em;color:var(--wine)">${esc(DB.profile.brand.split('·')[0].trim())}</div>
          <div class="sub" style="font-size:9px;margin-top:2px">${esc(DB.profile.name)}</div>
        </div>
      </div>
      <div class="pl">
        ${vis.map(r => `
          <div class="pl-row">
            <b>${esc(r.from)}</b>
            <div>${esc(r.name)}<div class="nt">${esc(r.note || '')}</div></div>
          </div>`).join('')}
      </div>
      <div class="foot"><span>${esc(DB.profile.slogan)}</span><span>共 ${mmss(flowTotal(w))}</span></div>
    </div>`;
  }

  function flowText(w) {
    const rows = flowTimeline(w);
    return `【${w.couple.bride} & ${w.couple.groom} 婚礼流程】\n日期：${prettyDate(w.date)} ${w.time || ''}\n场地：${w.hotel}\n总时长：${mmss(flowTotal(w))}\n\n` +
      rows.map(r => `${r.from}-${r.to}　${r.name}${r.note ? '　// ' + r.note : ''}`).join('\n') +
      `\n\n主持人：${DB.profile.name}　${DB.profile.phone}`;
  }

  /* ================================================================
     ⑥ 婚礼歌单
     ================================================================ */
  const SONG_USES = ['暖场', '仪式', '送客'];
  const PEAKS = {};                 // 音频 id → 波形峰值（运行时缓存，不写进 localStorage）
  let TR = null;                    // 当前打开的剪辑器
  let rowPlay = { idx: -1, btn: null };

  /* ----------------------------------------------------------------
     环节 ↔ 歌曲：唯一解析入口
     歌单页和播放器都走这里，避免两边各算一遍对不上
     （原来播放器用「后写覆盖」，取音频又用「第一条」，会显示 A 放 B）
     ---------------------------------------------------------------- */
  /* ---------------- 环节标识归一 ----------------
     这是整套改造里最要紧的一处。
     以前歌单、流程、走位图都靠「中文名」互相对齐，改一个名字就会全断。
     现在所有地方只认 key（config.js 里那个），显示的时候再查回中文名。
     旧数据里存的中文名也能读懂，不会丢。 */
  const normSegName = (s) => String(s == null ? '' : s).replace(/[\s·・•.,，、/]+/g, '').trim();

  function segList() {
    return (window.Engine && Engine.SEGMENTS) || [];
  }

  /* 不管传进来的是中文名还是 key，都归一到 key */
  function segKey(s) {
    const raw = normSegName(s);
    if (!raw) return '';
    const SEG = segList();
    for (let i = 0; i < SEG.length; i++) if (SEG[i].key === raw) return raw;
    for (let i = 0; i < SEG.length; i++) if (normSegName(SEG[i].name) === raw) return SEG[i].key;
    return raw;                        /* 对不上就原样返回，旧数据不会丢 */
  }

  /* key → 界面上显示的中文名 */
  function segName(v) {
    const k = segKey(v);
    if (!k) return '';
    const SEG = segList();
    for (let i = 0; i < SEG.length; i++) if (SEG[i].key === k) return SEG[i].name;
    return String(v == null ? '' : v);
  }

  /* 流程行的规范 key：新数据里自带 key 字段，旧数据按名字反推 */
  function rowKeyOf(r) {
    if (!r) return '';
    return r.key || segKey(r.name);
  }

  function songIndex(w) {
    const rows = flowTimeline(w);
    const keyOfRow = {}, idOfRow = {};
    rows.forEach((r, i) => {
      keyOfRow[rowKeyOf(r)] = i;
      if (r.id && idOfRow[r.id] == null) idOfRow[r.id] = i;
    });

    /* 同一环节排了多首：显示和播放锁定同一条 —— 优先有音频的，其次有曲名的，再次第一条 */
    const better = (a, b) => {
      if (!a) return true;
      const sa = (a.song.audio ? 2 : 0) + (a.song.title ? 1 : 0);
      const sb = (b.song.audio ? 2 : 0) + (b.song.title ? 1 : 0);
      return sb > sa;
    };
    const byKey = {}, byFlow = {};
    (w.songs || []).forEach((s, i) => {
      const rec = { song: s, idx: i };
      const k = segKey(s.seg);
      if (k && better(byKey[k], rec)) byKey[k] = rec;
      if (s.flowId && (!byFlow[s.flowId] || better(byFlow[s.flowId], rec))) byFlow[s.flowId] = rec;
    });

    return {
      rows,
      rowKeys: rows.map(rowKeyOf),
      rowLabels: rows.map(r => r.name),
      /* 这一环节配的是哪首（找不到返回 null） */
      of(row) {
        if (!row) return null;
        if (row.id && byFlow[row.id]) return byFlow[row.id];
        return byKey[rowKeyOf(row)] || null;
      },
      /* 这首歌对到了流程第几行（-1 = 没对上，播放器不会播） */
      rowOf(s) {
        if (!s) return -1;
        if (s.flowId && idOfRow[s.flowId] != null) return idOfRow[s.flowId];
        const k = segKey(s.seg);
        return k && keyOfRow[k] != null ? keyOfRow[k] : -1;
      },
      /* 这首歌归哪一类用途（猜的，用于新建行） */
      useOf(seg) {
        const k = segKey(seg);
        if (/暖场|迎宾|签到|候场/.test(k)) return '暖场';
        if (/送客|礼成|结束|散场/.test(k)) return '送客';
        return '仪式';
      }
    };
  }

  /* 「0:42–1:30」这种紧凑剪辑描述，没有就用 clip 文本；brief = 不显示淡入淡出 */
  function cutText(s, brief) {
    if (!s) return '';
    if (s.trim && s.trim.end > s.trim.start) {
      let t = fmtS(s.trim.start) + '–' + fmtS(s.trim.end);
      if (!brief) {
        const fi = s.trim.fadeIn || 0, fo = s.trim.fadeOut || 0;
        if (fi) t += ' · 淡入 ' + fi.toFixed(1) + 's';
        if (fo) t += ' · 淡出 ' + fo.toFixed(1) + 's';
      }
      return t;
    }
    return s.clip || '';
  }

  function fmtA(sec) {
    sec = Math.max(0, Number(sec) || 0);
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  /* 列表里用紧凑写法：0:24 / 0:02–0:10，够了又不挤 */
  function fmtS(sec) {
    const t = Math.round(Math.max(0, Number(sec) || 0));
    const m = Math.floor(t / 60), s = t % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function parseA(v) {
    const t = String(v == null ? '' : v).trim();
    if (!t) return null;
    const parts = t.split(':').map(x => parseFloat(String(x).replace(/[^\d.]/g, '')));
    if (!parts.length || parts.some(isNaN)) return null;
    let sec = 0;
    parts.forEach(p => { sec = sec * 60 + p; });
    return sec;
  }
  function fileTitle(name) {
    return String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ')
      .replace(/^\s*\d{1,3}[\s.\-、]+/, '').trim().slice(0, 40) || '未命名';
  }
  function fileSize(n) {
    if (!n) return '';
    return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
  }
  function segMinutes(w, seg) {
    if (!seg) return 0;
    const rows = flowTimeline(w);
    const hit = rows.filter(r => r.name === seg)[0]
      || rows.filter(r => r.name.indexOf(seg) >= 0 || seg.indexOf(r.name) >= 0)[0];
    return hit ? hit.dur : 0;
  }

  /* ---------- 单首的音频格 ---------- */
  function songAudioHTML(s, i, rowAt) {
    const jump = rowAt >= 0
      ? `<button class="mini" data-goplayer="${rowAt}" title="到播放器定位到这一环节">↗</button>`
      : '';
    if (!s.audio) {
      return `<span class="au au-empty"><button class="mini wide" data-improw="${i}">＋ 导入音频</button>${jump}</span>`;
    }
    const t = s.trim;
    const cut = (t && t.end > t.start) ? fmtS(t.start) + '–' + fmtS(t.end) : '';
    return `<span class="au">
      <canvas class="au-wave" data-au="${i}" width="104" height="30" title="点一下打开剪辑"></canvas>
      <span class="au-info"><b>${fmtS(s.audio.dur)}</b><em class="${cut ? '' : 'none'}">${cut || '未剪'}</em></span>
      <span class="au-btns">
        <button class="mini" data-playsong="${i}" title="试听这一段">▶</button>
        <button class="mini" data-trim="${i}" title="剪辑进出点">剪</button>
        ${jump}
      </span>
    </span>`;
  }

  function songRowHTML(s, i, si) {
    const u = s.use || '仪式';
    const rowAt = si.rowOf(s);
    const inFlow = rowAt >= 0;
    const cur = segKey(s.seg);            /* 内部一律用 key 比较 */
    const keys = si.rowKeys, labels = si.rowLabels;
    const extra = cur && keys.indexOf(cur) < 0 ? cur : '';
    return `<div class="song-row" data-row="${i}" id="srow-${i}">
      <span class="no">${String(i + 1).padStart(2, '0')}</span>
      <span class="nm">
        <input class="tin t-title" value="${esc(s.title)}" data-st="${i}" placeholder="曲名">
        <small>
          <select class="tin t-seg ${inFlow ? '' : 'miss'}" data-sg="${i}" title="${inFlow ? '对应流程「' + esc(si.rows[rowAt].name) + '」，跟场时自动播' : '流程里没有这个环节，播放器不会播它'}">
            ${cur ? '' : '<option value="" selected>（选环节）</option>'}
            ${extra ? `<option value="${esc(extra)}" selected>${esc(segName(extra))} ⚠</option>` : ''}
            ${keys.map((k, n) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(labels[n])}</option>`).join('')}
          </select>
          <i>·</i>
          <input class="tin t-art" value="${esc(s.artist || '')}" data-sa="${i}" placeholder="歌手">
        </small>
      </span>
      <span><input class="tin t-clip" value="${esc(s.clip || '')}" data-sc="${i}" placeholder="从第几秒进"></span>
      <span><select class="tag-sel ${u === '暖场' ? 'gold' : (u === '送客' ? 'sage' : 'line')}" data-su="${i}">${SONG_USES.map(x => `<option ${x === u ? 'selected' : ''}>${x}</option>`).join('')}</select></span>
      ${songAudioHTML(s, i, rowAt)}
      <span class="dl"><button class="btn ghost sm" data-sdel="${i}">✕</button></span>
    </div>`;
  }

  function renderSongs() {
    const w = curW();

    /* 从播放器点「歌单」跳过来：定位到这一环节；还没有歌就顺手建一行 */
    const focus = state.focusSong;
    state.focusSong = null;
    let focusIdx = null;
    if (focus) {
      const si0 = songIndex(w);
      if (focus.idx != null && w.songs[focus.idx]) focusIdx = focus.idx;
      else {
        const k = segKey(focus.seg);
        const exist = w.songs.findIndex(s => segKey(s.seg) === k);
        if (exist >= 0) focusIdx = exist;
        else if (focus.seg) {
          w.songs.push({ id: uid(), seg: focus.seg, title: '', artist: '', clip: '', use: si0.useOf(focus.seg), flowId: focus.fid || null });
          save();
          focusIdx = w.songs.length - 1;
        }
      }
    }

    const songs = w.songs || [];
    const si = songIndex(w);
    const uses = SONG_USES.slice();
    songs.forEach(s => { const u = s.use || '仪式'; if (uses.indexOf(u) < 0) uses.push(u); });
    const byUse = (u) => songs.filter(s => (s.use || '仪式') === u).length;
    const withAudio = songs.filter(s => s.audio).length;
    const live = si.rows.filter(r => { const p = si.of(r); return p && p.song.audio; }).length;
    const orphan = songs.filter(s => si.rowOf(s) < 0).length;

    $('#view').innerHTML = `
      <div class="card">
        <div class="card-h"><h3>环节 × 歌曲</h3>
          <span class="hint">暖场 ${byUse('暖场')} · 仪式 ${byUse('仪式')} · 送客 ${byUse('送客')} · 音频 ${withAudio}/${songs.length} · <b style="color:var(--wine)">跟场可播 ${live}/${si.rows.length}</b></span></div>
        <div class="card-b" style="padding-top:2px">
          <div class="drop-hint">把 MP3 / WAV / M4A 拖到某一行 → 只导入这一首；拖到某一节里 → 按顺序排进这一节。导入后直接进剪辑，定好进出点再保存。<b style="color:var(--wine)">环节选对 + 剪好，播放器跟场就会自动播这一段。</b></div>
          <div id="songTips">
          ${orphan ? `<div class="orphan-tip">有 ${orphan} 首的环节在流程里找不到（选环节那一栏标红），播放器不会播它——把环节改成流程里的名字就接上了。</div>` : ''}
          </div>
          ${uses.map(u => {
            const list = songs.map((s, i) => ({ s, i })).filter(x => (x.s.use || '仪式') === u);
            return `<div class="song-sec" data-sec="${esc(u)}">
              <div class="song-sec-h">
                <b>${esc(u)}</b>
                <span class="tiny muted">${list.length} 首 · 音频 ${list.filter(x => x.s.audio).length} 段</span>
                <span class="sp"></span>
                <button class="btn ghost sm" data-addsong="${esc(u)}">＋ 新增</button>
                <button class="btn ghost sm" data-impsec="${esc(u)}">↑ 导入本节音乐</button>
              </div>
              <div class="song-row hr">
                <span>#</span><span>环节 / 歌曲</span><span>剪辑要求</span><span>用途</span><span>音频（导入 · 剪辑）</span><span></span>
              </div>
              ${list.map(x => songRowHTML(x.s, x.i, si)).join('')
                || '<div class="song-empty">这一节还没有歌。点右上「导入本节音乐」可以一次选好几个文件。</div>'}
            </div>`;
          }).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="card">
          <div class="card-h"><h3>发给新人 / 策划</h3></div>
          <div class="card-b">
            <p class="tiny muted" style="margin:0 0 10px;line-height:1.7">歌单按环节整理好，新人交上来的曲目可以直接对照。导入的音频存在这台电脑的浏览器里，剪完可以导出成 WAV 发给音控——清单里带进点、出点和淡入淡出。</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn primary" id="dlSongs">导出歌单清单 .txt</button>
              <button class="btn" id="cpSongs">复制到微信</button>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>新人交来的歌单</h3><span class="hint">对照用</span></div>
          <div class="card-b">
            <div class="tiny" style="line-height:2;color:var(--ink-2)">
              ${songs.slice(0, 6).map(s => `<div style="display:flex;gap:8px"><span class="mono" style="color:var(--wine);width:70px">${esc(segName(s.seg) || '—')}</span><span>${esc(s.title || '待定')}</span><span class="muted" style="margin-left:auto">${esc(s.clip || '')}</span></div>`).join('')}
            </div>
            <p class="tiny muted" style="margin:12px 0 0;line-height:1.7">导入音频后，这里显示的就是剪完的真实进出点，直接念给音控听。</p>
          </div>
        </div>
      </div>`;

    $$('[data-st]').forEach(el => el.onchange = () => { w.songs[+el.dataset.st].title = el.value.trim(); save(); });
    $$('[data-sg]').forEach(el => el.onchange = () => {
      const s = w.songs[+el.dataset.sg];
      if (!s) return;
      s.seg = el.value;
      delete s.flowId;
      save();
      toast(s.seg ? '已接到「' + segName(s.seg) + '」，播放器跟场会播它' : '已取消对应环节');
      renderSongs();
    });
    $$('[data-sa]').forEach(el => el.onchange = () => { w.songs[+el.dataset.sa].artist = el.value.trim(); save(); });
    $$('[data-sc]').forEach(el => el.onchange = () => { w.songs[+el.dataset.sc].clip = el.value.trim(); save(); });
    $$('[data-su]').forEach(el => el.onchange = () => {
      w.songs[+el.dataset.su].use = el.value; save(); renderSongs();
    });
    $$('[data-sdel]').forEach(b => b.onclick = () => {
      const i = +b.dataset.sdel, s = w.songs[i];
      if (s && s.audio) AudioLib.del(s.audio.id);
      w.songs.splice(i, 1); stopRowPlay(); save(); renderSongs();
    });
    $$('[data-improw]').forEach(b => b.onclick = () => pickAudio(+b.dataset.improw));
    $$('[data-impsec]').forEach(b => b.onclick = () => pickSectionAudio(b.dataset.impsec));
    $$('[data-addsong]').forEach(b => b.onclick = () => {
      w.songs.push({ id: uid(), seg: '', title: '', artist: '', clip: '', use: b.dataset.addsong });
      save(); renderSongs();
    });
    $$('[data-trim]').forEach(b => b.onclick = () => openTrimmer(+b.dataset.trim));
    $$('[data-au]').forEach(cv => {
      cv.onclick = () => openTrimmer(+cv.dataset.au);
    });
    $$('[data-playsong]').forEach(b => b.onclick = () => toggleRowPlay(+b.dataset.playsong, b));

    /* 拖文件进来：单首直接导入并进剪辑，多个顺着这一节往下排 */
    $$('#view .song-row[data-row]').forEach(row => {
      const i = +row.dataset.row;
      row.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); row.classList.add('drop'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation();
        row.classList.remove('drop');
        const files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
        if (!files.length) return;
        if (files.length === 1) importOne(i, files[0]);
        else importRowMulti(i, files);
      });
    });
    $$('#view .song-sec').forEach(sec => {
      const use = sec.dataset.sec;
      sec.addEventListener('dragover', e => { e.preventDefault(); sec.classList.add('drop-sec'); });
      sec.addEventListener('dragleave', e => {
        if (!sec.contains(e.relatedTarget)) sec.classList.remove('drop-sec');
      });
      sec.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation();
        sec.classList.remove('drop-sec');
        if (e.target.closest && e.target.closest('.song-row')) return;
        const files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
        if (files.length) importMany(use, files);
      });
    });

    $('#dlSongs').onclick = () => download(songText(w), `歌单_${w.date}.txt`);
    $('#cpSongs').onclick = () => copy(songText(w));
    $$('[data-goplayer]').forEach(b => b.onclick = () => {
      state.focusCue = +b.dataset.goplayer;
      go('player');
    });
    hydrateWaves();

    if (focusIdx != null) {
      const row = document.getElementById('srow-' + focusIdx);
      if (row) {
        row.classList.add('focus');
        try { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { row.scrollIntoView(); }
        const t = row.querySelector('[data-st]');
        if (t && !t.value) setTimeout(() => { try { t.focus(); } catch (e) {} }, 320);
      }
    }
  }

  /* ---------- 列表里的小波形 ---------- */
  function paintSongWave(cv, s) {
    if (!cv || !s || !s.audio) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || 104, h = cv.clientHeight || 30;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const pk = PEAKS[s.audio.id];
    if (!pk) {
      g.fillStyle = '#E2D9CB'; g.fillRect(0, h / 2 - 1, w, 2);
      return;
    }
    const dur = s.audio.dur || 1;
    const t = (s.trim && s.trim.end > s.trim.start) ? s.trim : { start: 0, end: dur };
    const x0 = t.start / dur * w, x1 = t.end / dur * w;
    for (let x = 0; x < w; x++) {
      const p = pk[Math.min(pk.length - 1, Math.floor(x / w * pk.length))] || 0;
      const bh = Math.max(1, p * (h - 4));
      g.fillStyle = (x >= x0 && x < x1) ? C.wine : '#D8CEBE';
      g.fillRect(x, (h - bh) / 2, 1, bh);
    }
    g.fillStyle = C.wine;
    g.fillRect(Math.max(0, x0 - 1), 0, 1.5, h);
    g.fillRect(Math.min(w - 1, x1), 0, 1.5, h);
  }

  function hydrateWaves() {
    const w = curW();
    const list = $$('#view [data-au]');
    const lost = [];
    let pending = list.length;
    const finish = () => {
      if (--pending > 0) return;
      const tips = $('#songTips');
      if (!tips || !lost.length) return;
      const old = $('#lostTip'); if (old) old.remove();
      lost.sort((a, b) => a - b);
      tips.insertAdjacentHTML('afterbegin', `<div class="orphan-tip" id="lostTip">
        有 <b>${lost.length}</b> 段音频在这台电脑上找不到了（换机器 / 清过缓存 / 隐私窗口都会这样）。曲名和剪辑点还在，把原文件重新挂上就恢复。
        <button class="btn ghost sm" id="relinkPick" style="margin-left:6px">批量重挂</button>
        <button class="btn ghost sm" id="relinkList">看看是哪几首</button></div>`);
      const pick = $('#relinkPick');
      if (pick) pick.onclick = () => relinkPick(lost.slice());
      const show = $('#relinkList');
      if (show) show.onclick = () => openModal('找不到的音频', `
        <div class="exp-list">${lost.map(i => {
          const s = w.songs[i] || {};
          return `<div class="exp-li" style="grid-template-columns:1fr auto">
            <span class="nm">${esc(s.title || '（未命名）')}</span>
            <span class="sz">${esc(segName(s.seg) || '未选环节')}</span></div>`;
        }).join('')}</div>
        <p class="tiny muted" style="margin:12px 0 0;line-height:1.8">原文件一般在给别人发歌单时的同一批文件里。点「批量重挂」把这些文件一起选上，会按文件名自动对回每一首。</p>
        <div style="margin-top:12px"><button class="btn primary sm" id="relinkFromModal">批量重挂</button></div>`);
      const fromM = $('#relinkFromModal');
      if (fromM) fromM.onclick = () => relinkPick(lost.slice());
    };
    list.forEach(cv => {
      const i = +cv.dataset.au, s = w.songs[i];
      if (!s || !s.audio) { if (pending > 0) finish(); return; }
      if (PEAKS[s.audio.id]) { paintSongWave(cv, s); finish(); return; }
      AudioLib.meta(s.audio.id).then(rec => {
        if (rec && rec.peaks) { PEAKS[rec.id] = rec.peaks; paintSongWave(cv, s); }
        else {
          lost.push(i);
          cv.title = '本地找不到这个文件了，点「剪」可以重新导入';
          const box = cv.parentNode;
          const durEl = box && box.querySelector('.au-info b');
          const cutEl = box && box.querySelector('.au-info em');
          if (durEl) durEl.textContent = '—';
          if (cutEl) { cutEl.textContent = '需重新导入'; cutEl.className = 'lost'; }
          paintSongWave(cv, s);
        }
        finish();
      }).catch(() => { paintSongWave(cv, s); finish(); });
    });
  }

  /* 批量把本地文件重新挂回丢了音频的几首：先按文件名对，剩下的按顺序补 */
  const normName = (x) => String(x || '').toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, '').replace(/^\s*\d{1,3}[\s._\-、]+/, '')
    .replace(/[\s._\-（）()【】\[\]]/g, '');

  function relinkPick(idxs) {
    if (!idxs || !idxs.length) return;
    if (!AudioLib.support()) { toast('这台浏览器不支持音频，换 Chrome / Safari 打开'); return; }
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = 'audio/*,.mp3,.m4a,.wav,.ogg,.oga,.flac,.aac,.opus';
    inp.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(inp);
    inp.onchange = async () => {
      const files = [...(inp.files || [])];
      inp.remove();
      if (!files.length) return;
      const w = curW();
      const pool = idxs.filter(i => w.songs[i]);
      const used = {};
      let ok = 0, bad = 0;
      for (let k = 0; k < files.length; k++) {
        const f = files[k];
        const fn = normName(f.name);
        let idx = pool.find(i => {
          if (used[i]) return false;
          const s = w.songs[i];
          const a = normName(s.title), b = normName(s.audio && s.audio.name);
          return (a && (a === fn || fn.indexOf(a) >= 0 || a.indexOf(fn) >= 0)) || (b && b === fn);
        });
        if (idx == null) idx = pool.find(i => !used[i]);
        if (idx == null) break;
        used[idx] = 1;
        toast(`重挂 ${k + 1}/${files.length}…`);
        try { await importAudioTo(idx, f); ok++; } catch (e) { bad++; }
      }
      renderSongs();
      toast(`重挂 ${ok} 段${bad ? '，' + bad + ' 段读不了' : ''}${ok ? '，剪辑点已保留' : ''}`);
    };
    inp.click();
  }

  /* ---------- 导入 ---------- */
  function pickAudio(idx) {
    if (!AudioLib.support()) { toast('这台浏览器不支持音频，换 Chrome / Safari 打开'); return; }
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'audio/*,.mp3,.m4a,.wav,.ogg,.oga,.flac,.aac,.opus';
    inp.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(inp);
    inp.onchange = () => {
      const f = (inp.files || [])[0];
      inp.remove();
      if (f) importOne(idx, f);
    };
    inp.click();
  }

  function pickSectionAudio(use) {
    if (!AudioLib.support()) { toast('这台浏览器不支持音频，换 Chrome / Safari 打开'); return; }
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'audio/*,.mp3,.m4a,.wav,.ogg,.oga,.flac,.aac,.opus';
    inp.multiple = true;
    inp.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(inp);
    inp.onchange = () => {
      const files = Array.prototype.slice.call(inp.files || []);
      inp.remove();
      if (files.length) importMany(use, files);
    };
    inp.click();
  }

  async function importAudioTo(idx, file) {
    const w = curW();
    const s = w.songs[idx];
    if (!s) throw new Error('这一行不在了');
    const buf = await AudioLib.decode(file);
    const rec = {
      id: 'a' + uid() + Date.now().toString(36).slice(-4),
      name: file.name,
      type: file.type || '',
      size: file.size,
      dur: Math.round(buf.duration * 100) / 100,
      peaks: AudioLib.peaks(buf, 640),
      blob: file
    };
    const stored = await AudioLib.put(rec);
    PEAKS[rec.id] = rec.peaks;
    if (s.audio && s.audio.id && s.audio.id !== rec.id) AudioLib.del(s.audio.id);
    s.audio = { id: rec.id, name: rec.name, size: rec.size, type: rec.type, dur: rec.dur };
    const segM = segMinutes(w, s.seg);
    const end = segM ? Math.min(buf.duration, Math.max(8, segM * 60)) : buf.duration;
    s.trim = { start: 0, end: Math.round(end * 10) / 10, fadeIn: 1.5, fadeOut: 1.5, gain: 1 };
    s.clip = fmtS(0) + ' → ' + fmtS(end);
    if (!s.title) s.title = fileTitle(file.name);
    save();
    return stored;
  }

  async function importOne(idx, file) {
    const w = curW();
    const s = w.songs[idx];
    if (!s) return;
    toast('正在读取「' + fileTitle(file.name) + '」…');
    try {
      const stored = await importAudioTo(idx, file);
      renderSongs();
      toast(stored ? ('已导入 ' + fmtA(s.audio.dur) + '，来定进出点') : '已导入（本机存不了，本次有效）');
      openTrimmer(idx);
    } catch (e) {
      toast(e && e.message ? e.message : '导入失败');
    }
  }

  async function runImport(slots, files, label) {
    const w = curW();
    let ok = 0, bad = 0, made = 0;
    let use = '';
    if (slots.length && w.songs[slots[0]]) use = w.songs[slots[0]].use || '仪式';
    for (let k = 0; k < files.length; k++) {
      toast(`导入中 ${k + 1}/${files.length}…`);
      let idx = slots.shift();
      if (idx == null) {
        w.songs.push({ id: uid(), seg: '', title: fileTitle(files[k].name), artist: '', clip: '', use: use || '仪式' });
        idx = w.songs.length - 1;
        made++;
      }
      try { await importAudioTo(idx, files[k]); ok++; }
      catch (e) { bad++; }
    }
    save(); renderSongs();
    toast(`${label}导入 ${ok} 段${made ? '（新增 ' + made + ' 首）' : ''}${bad ? '，' + bad + ' 段读不了' : ''}`);
  }

  function importMany(use, files) {
    const w = curW();
    const slots = [];
    w.songs.forEach((s, i) => { if ((s.use || '仪式') === use && !s.audio) slots.push(i); });
    return runImport(slots, files, `「${use}」`);
  }

  function importRowMulti(idx, files) {
    const w = curW();
    const use = (w.songs[idx] && w.songs[idx].use) || '仪式';
    const slots = [idx];
    w.songs.forEach((s, i) => { if (i > idx && (s.use || '仪式') === use && !s.audio) slots.push(i); });
    return runImport(slots, files, '');
  }

  /* ---------- 行内试听 ---------- */
  function stopRowPlay() {
    if (window.AudioLib) AudioLib.stop();
    if (rowPlay.btn) { rowPlay.btn.textContent = '▶'; rowPlay.btn.classList.remove('on'); }
    rowPlay = { idx: -1, btn: null };
  }

  function toggleRowPlay(idx, btn) {
    const w = curW();
    const s = w.songs[idx];
    if (!s || !s.audio) return;
    if (rowPlay.idx === idx) { stopRowPlay(); return; }
    stopRowPlay();
    const t = (s.trim && s.trim.end > s.trim.start) ? s.trim : { start: 0, end: s.audio.dur };
    AudioLib.buffer(s.audio.id).then(buf => {
      AudioLib.play(buf, {
        start: t.start, end: t.end,
        fadeIn: t.fadeIn || 0, fadeOut: t.fadeOut || 0,
        gain: t.gain == null ? 1 : t.gain
      }, () => stopRowPlay());
      rowPlay = { idx, btn };
      btn.textContent = '■'; btn.classList.add('on');
    }).catch(e => toast(e.message || '播放失败'));
  }

  /* ---------- 剪辑器 ---------- */
  function openTrimmer(idx) {
    const w = curW();
    const s = w.songs[idx];
    if (!s || !s.audio) { toast('先给这一行导入音频'); return; }
    stopRowPlay();
    openModal('剪辑 · ' + (s.title || fileTitle(s.audio.name)), '<div class="tr-load">正在读取音频…</div>');
    AudioLib.buffer(s.audio.id).then(buf => buildTrimmer(idx, s, buf)).catch(e => {
      $('#modalBody').innerHTML = `<div class="tr-load err">${esc(e && e.message ? e.message : '读取失败')}</div>
        <div class="tr-foot"><button class="btn primary" id="trRe">重新导入</button></div>`;
      const b = $('#trRe');
      if (b) b.onclick = () => { closeModal(); pickAudio(idx); };
    });
  }

  function buildTrimmer(idx, s, buf) {
    const w = curW();
    const dur = buf.duration;
    const segM = segMinutes(w, s.seg);
    const defEnd = Math.min(dur, Math.max(3, segM ? segM * 60 : dur));
    const src = (s.trim && s.trim.end > s.trim.start) ? s.trim : { start: 0, end: defEnd, fadeIn: 1.5, fadeOut: 1.5, gain: 1 };
    const st = {
      start: Math.max(0, Math.min(dur - 0.3, src.start || 0)),
      end: Math.max(0.3, Math.min(dur, src.end == null ? dur : src.end)),
      fadeIn: src.fadeIn == null ? 1.5 : src.fadeIn,
      fadeOut: src.fadeOut == null ? 1.5 : src.fadeOut,
      gain: src.gain == null ? 1 : src.gain
    };
    if (st.end <= st.start + 0.2) st.end = Math.min(dur, st.start + 30);

    $('#modalBody').innerHTML = `
      <div class="tr">
        <div class="tr-file">
          <div class="tr-ttl">${esc(s.title || fileTitle(s.audio.name))}<span>${esc(s.artist || '')}</span></div>
          <div class="tr-sub">${esc(s.audio.name)} · ${fmtA(dur)} · ${fileSize(s.audio.size)}${segM ? ' · 流程给这一环 ' + segM + ' 分钟' : ''}</div>
        </div>
        <div class="tr-canvas"><canvas id="trWave" width="780" height="132"></canvas></div>
        <div class="tr-hint">拖两端定进出点 · 拖中间整段平移 · 双击复位</div>
        <div class="tr-times">
          <label><span>进点</span><input id="trIn" spellcheck="false"></label>
          <label><span>出点</span><input id="trOut" spellcheck="false"></label>
          <div class="tr-len" id="trLen"></div>
          ${segM ? `<button class="btn ghost sm" id="trFit">按环节 ${segM}′ 剪</button>` : ''}
        </div>
        <div class="tr-play">
          <button class="btn primary" id="trPlay">▶ 试听选中</button>
          <label class="tr-check"><input type="checkbox" id="trLoop"> 循环</label>
          <span class="tr-tip">空格键播放 / 暂停</span>
        </div>
        <div class="tr-fades">
          <label><span>淡入</span><input type="range" id="trFi" min="0" max="8" step="0.1"><em id="trFiV"></em></label>
          <label><span>淡出</span><input type="range" id="trFo" min="0" max="8" step="0.1"><em id="trFoV"></em></label>
          <label><span>音量</span><input type="range" id="trGain" min="0.2" max="1" step="0.02"><em id="trGainV"></em></label>
        </div>
        <div class="tr-foot">
          <button class="btn primary" id="trSave">保存剪辑</button>
          <button class="btn" id="trExport">导出片段 .wav</button>
          <button class="btn ghost" id="trReimport">换个文件</button>
          <button class="btn ghost" id="trDel" style="margin-left:auto;color:var(--ink-4)">移除音频</button>
        </div>
      </div>`;

    const cv = $('#trWave');
    const loopBox = $('#trLoop');
    let drag = null, dragFrom = 0, dragS = 0, dragE = 0;
    let tick = null, playing = false, ph = null, playT0 = 0, playFrom = 0;

    function niceStep() {
      const cands = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
      const cw = cv.clientWidth || 760;
      for (let i = 0; i < cands.length; i++) if (cw / (dur / cands[i]) >= 58) return cands[i];
      return 600;
    }
    function tickLabel(t) {
      const m = Math.floor(t / 60), sec = t - m * 60;
      return m + ':' + (sec < 10 ? '0' : '') + Math.round(sec);
    }

    function paint() {
      if (!cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = cv.clientWidth || 760, chh = cv.clientHeight || 132;
      if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(chh * dpr)) {
        cv.width = Math.round(cw * dpr); cv.height = Math.round(chh * dpr);
      }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, cw, chh);
      g.fillStyle = '#FBF8F3'; g.fillRect(0, 0, cw, chh);
      const top = 22, hh = chh - top - 8, mid = top + hh / 2;

      const step = niceStep();
      g.strokeStyle = '#EAE2D5'; g.lineWidth = 1;
      g.fillStyle = '#A79C8C'; g.font = '10px ui-monospace,Menlo,monospace'; g.textBaseline = 'top';
      for (let t = 0; t <= dur + 0.001; t += step) {
        const x = t / dur * cw;
        g.beginPath(); g.moveTo(Math.round(x) + 0.5, top - 7); g.lineTo(Math.round(x) + 0.5, chh - 5); g.stroke();
        g.fillText(tickLabel(t), Math.min(cw - 24, x + 3), 3);
      }

      const pk = PEAKS[s.audio.id] || [];
      const x0 = st.start / dur * cw, x1 = st.end / dur * cw;
      if (pk.length) {
        for (let x = 0; x < cw; x++) {
          const p = pk[Math.min(pk.length - 1, Math.floor(x / cw * pk.length))] || 0;
          const bh = Math.max(1, p * hh * 0.94);
          g.fillStyle = (x >= x0 && x < x1) ? C.wine : '#D9CFC0';
          g.fillRect(x, mid - bh / 2, 1, bh);
        }
      } else {
        g.fillStyle = '#D9CFC0'; g.fillRect(0, mid - 1, cw, 2);
      }

      g.fillStyle = 'rgba(var(--wine-rgb),.06)'; g.fillRect(x0, top, Math.max(1, x1 - x0), hh);
      g.fillStyle = C.wine;
      g.fillRect(Math.max(0, x0 - 1), top - 2, 2, hh + 4);
      g.fillRect(Math.min(cw - 1, x1 - 1), top - 2, 2, hh + 4);
      [x0, x1].forEach(x => {
        g.beginPath(); g.arc(Math.max(4, Math.min(cw - 4, x)), top - 3, 4, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(Math.max(4, Math.min(cw - 4, x)), top + hh + 3, 4, 0, Math.PI * 2); g.fill();
      });

      if (ph != null) {
        const px = ph / dur * cw;
        g.fillStyle = 'rgba(27,24,21,.55)'; g.fillRect(px - 0.5, 0, 1, chh);
      }
    }

    function sync(repaint) {
      $('#trIn').value = fmtA(st.start);
      $('#trOut').value = fmtA(st.end);
      $('#trLen').textContent = '选中 ' + fmtA(st.end - st.start) + ' / 全长 ' + fmtA(dur);
      $('#trFiV').textContent = st.fadeIn.toFixed(1) + 's';
      $('#trFoV').textContent = st.fadeOut.toFixed(1) + 's';
      $('#trGainV').textContent = Math.round(st.gain * 100) + '%';
      if (repaint !== false) paint();
    }

    function stopPlay() {
      playing = false;
      AudioLib.stop();
      if (tick) { clearInterval(tick); tick = null; }
      ph = null;
      const b = $('#trPlay');
      if (b) { b.textContent = '▶ 试听选中'; b.classList.remove('on'); }
      paint();
    }

    function startPlay() {
      if (playing) { stopPlay(); return; }
      if (!AudioLib.support()) { toast('这台浏览器不能播放音频'); return; }
      stopPlay();
      const t0 = AudioLib.play(buf, st, () => {
        if (!playing) return;
        if (loopBox && loopBox.checked) { playing = false; startPlay(); }
        else stopPlay();
      });
      playing = true; playT0 = t0; playFrom = st.start; ph = st.start;
      const b = $('#trPlay');
      if (b) { b.textContent = '❚❚ 暂停'; b.classList.add('on'); }
      tick = setInterval(() => {
        if (!playing) return;
        const t = playFrom + (AudioLib.now() - playT0);
        if (t >= st.end - 0.02) { ph = st.end; paint(); return; }
        ph = t; paint();
      }, 40);
    }

    function tOf(e) {
      const r = cv.getBoundingClientRect();
      return Math.max(0, Math.min(dur, (e.clientX - r.left) / Math.max(1, r.width) * dur));
    }

    function applyDrag(t) {
      const MIN = 0.3;
      if (drag === 'in') st.start = Math.max(0, Math.min(st.end - MIN, t));
      else if (drag === 'out') st.end = Math.min(dur, Math.max(st.start + MIN, t));
      else if (drag === 'move') {
        const d = t - dragFrom;
        let ns = dragS + d, ne = dragE + d;
        if (ns < 0) { ne -= ns; ns = 0; }
        if (ne > dur) { ns -= (ne - dur); ne = dur; }
        st.start = Math.max(0, ns); st.end = Math.min(dur, ne);
      }
      sync();
    }

    cv.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (playing) stopPlay();
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      const t = tOf(e);
      const r = cv.getBoundingClientRect();
      const tol = dur * 10 / Math.max(1, r.width);
      if (Math.abs(t - st.start) <= tol) drag = 'in';
      else if (Math.abs(t - st.end) <= tol) drag = 'out';
      else if (t > st.start && t < st.end) { drag = 'move'; dragFrom = t; dragS = st.start; dragE = st.end; }
      else drag = (t < st.start) ? 'in' : 'out';
      applyDrag(t);
    });
    cv.addEventListener('pointermove', e => { if (drag) { e.preventDefault(); applyDrag(tOf(e)); } });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('pointercancel', () => { drag = null; });
    cv.addEventListener('dblclick', () => { st.start = 0; st.end = dur; sync(); });

    $('#trIn').onchange = e => {
      const v = parseA(e.target.value);
      if (v == null) { sync(); return; }
      st.start = Math.max(0, Math.min(st.end - 0.3, v)); sync();
    };
    $('#trOut').onchange = e => {
      const v = parseA(e.target.value);
      if (v == null) { sync(); return; }
      st.end = Math.min(dur, Math.max(st.start + 0.3, v)); sync();
    };
    $('#trFi').value = st.fadeIn;
    $('#trFo').value = st.fadeOut;
    $('#trGain').value = st.gain;
    $('#trFi').oninput = e => { st.fadeIn = +e.target.value; sync(false); };
    $('#trFo').oninput = e => { st.fadeOut = +e.target.value; sync(false); };
    $('#trGain').oninput = e => { st.gain = +e.target.value; sync(false); };
    const fit = $('#trFit');
    if (fit) fit.onclick = () => {
      st.end = Math.min(dur, st.start + segM * 60); sync();
    };

    $('#trPlay').onclick = startPlay;
    $('#trSave').onclick = () => {
      s.trim = {
        start: Math.round(st.start * 10) / 10,
        end: Math.round(st.end * 10) / 10,
        fadeIn: Math.round(st.fadeIn * 10) / 10,
        fadeOut: Math.round(st.fadeOut * 10) / 10,
        gain: Math.round(st.gain * 100) / 100
      };
      s.clip = fmtS(st.start) + ' → ' + fmtS(st.end);
      save();
      stopPlay(); TR = null; closeModal(); renderSongs();
      toast('已保存：' + s.clip + ' · 长 ' + fmtA(st.end - st.start));
    };
    $('#trExport').onclick = () => {
      try {
        const blob = AudioLib.encodeWav(buf, st);
        const fn = (s.title || fileTitle(s.audio.name)).replace(/[\\/:*?"<>|]/g, '') + '_' + fmtA(st.start).replace(':', 'm').replace('.', 's') + '.wav';
        saveBlob(blob, fn, { kind: 'wav', quiet: true });
      } catch (e) { toast('导出失败：' + (e.message || '未知')); }
    };
    $('#trReimport').onclick = () => { stopPlay(); TR = null; closeModal(); pickAudio(idx); };
    $('#trDel').onclick = () => {
      AudioLib.del(s.audio.id);
      delete PEAKS[s.audio.id];
      delete s.audio; delete s.trim;
      save();
      stopPlay(); TR = null; closeModal(); renderSongs();
      toast('已移除音频');
    };

    TR = { stop: stopPlay, toggle: startPlay };
    sync();
    setTimeout(paint, 30);
  }

  /* 弹窗关闭 / 空格快捷键只挂一次 */
  document.addEventListener('click', e => {
    const t = e.target;
    if (!TR || !t || !t.id) return;
    if (t.id === 'modalClose' || t.id === 'modalBg') { TR.stop(); TR = null; }
  });
  document.addEventListener('keydown', e => {
    if (!TR || e.code !== 'Space') return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/i.test(tag)) return;
    if (!$('#modalBg') || !$('#modalBg').classList.contains('on')) { TR = null; return; }
    e.preventDefault();
    TR.toggle();
  });

  function songText(w) {
    const si = songIndex(w);
    return `【${w.couple.bride} & ${w.couple.groom} 婚礼歌单】\n${w.date} ${w.time || ''} · ${w.hotel}\n\n` +
      si.rows.map(r => {
        const p = si.of(r);
        const s = p && p.song;
        const tail = s && cutText(s) ? `　[${cutText(s)}]` : '';
        return `${r.from}　${r.name}　|　${s ? (s.title || '待定') + (s.artist ? ' - ' + s.artist : '') + tail : '（待定）'}`;
      }).join('\n') + `\n\n主持人：${DB.profile.name}`;
  }

  /* ================================================================
     ⑦ 演示沙盘 / ⑧ 播放器
     ================================================================ */
  function totalMin(w) { return flowTotal(w) || 1; }

  function stageHTML(w, rows, mode) {
    const total = totalMin(w);
    return `<div class="stage">
      <div class="h"><span>● 演示沙盘</span><span style="opacity:.4">|</span><span>${esc(w.couple.bride)} &amp; ${esc(w.couple.groom)}</span></div>
      <div class="clock" id="stageClock">${esc(w.time || '11:58')}</div>
      <div class="now" id="stageNow">${esc(rows[0] ? rows[0].name : '—')}</div>
      <div class="nxt" id="stageNext">${rows[1] ? '下一个：' + esc(rows[1].name) + ' · ' + rows[1].dur + ' 分钟' : ''}</div>
      <div class="tl" id="tl">
        <div class="track" id="track">
          ${rows.map((r, i) => `<div class="blk" data-bi="${i}" style="flex:${r.dur} 1 0" title="${esc(r.name)} ${esc(r.from)}-${esc(r.to)}">
            <span>${esc(r.name)}</span><em>${r.dur}′</em></div>`).join('')}
        </div>
        <div class="head" id="tlHead" style="left:0"></div>
        <div class="ruler"><span>${esc(w.time || '')}</span><span>${esc(addMin(w.time || '11:58', total))}</span></div>
      </div>
      <div class="ctrl">
        <button class="btn primary" id="btnPlay">▶ 开始走场</button>
        <button class="btn" id="btnReset">重置</button>
        <span class="tiny" style="color:rgba(245,237,228,.5);margin-left:6px" id="playMeta">共 ${rows.length} 环节 · ${mmss(total)}</span>
        <span style="margin-left:auto;display:flex;gap:6px">
          <button class="btn" id="btnPoster">导出长图</button>
          <button class="btn" id="btnVideo">导出视频</button>
        </span>
      </div>
    </div>`;
  }

  function renderSandbox() {
    const w = curW();
    const rows = flowTimeline(w);
    $('#view').innerHTML = `
      ${stageHTML(w, rows)}
      <div class="plan-card">
        <div class="plan-head">
          <b>现场走位示意图</b>
          <span class="tiny muted">彩色小人随走场移动 · 虚线箭头 = 行进路线 · 示意图非按比例</span>
          <span style="margin-left:auto;display:flex;gap:6px">
            <button class="btn sm" id="btnPlanPoster">导出走位长图</button>
          </span>
        </div>
        <canvas id="planCv" aria-label="婚礼现场走位示意图"></canvas>
        <div class="plan-legend">${window.Plan ? Plan.legendHTML() : ''}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-top:18px">
        ${rows.map((r, i) => `
          <div class="cuecard" data-jump="${i}">
            <div class="tm">${esc(r.from)} — ${esc(r.to)}</div>
            <div class="nm">${esc(r.name)}</div>
            <div class="sg">${esc(r.note || '无备注')}</div>
          </div>`).join('')}
      </div>
      <p class="tiny muted" style="margin-top:14px;line-height:1.7">沙盘是按真实时长压缩走的：走完一遍，你能提前看到哪一段会拖、哪一段的气口太紧。导出视频为动画预览（含走位，非实拍合成），长图可以直接发新人。</p>`;

    if ($('#btnPlanPoster')) $('#btnPlanPoster').onclick = () => exportPlanPoster(w, rows);

    bindStage(w, rows);
    $$('[data-jump]').forEach(el => el.onclick = () => {
      const i = +el.dataset.jump;
      let acc = 0;
      for (let k = 0; k < i; k++) acc += rows[k].dur;
      seekTo(w, rows, acc);
    });
  }

  function bindStage(w, rows) {
    const total = totalMin(w);
    let acc = 0;
    const starts = rows.map(r => { const s = acc; acc += r.dur; return s; });

    const update = (t) => {
      state.play.t = Math.max(0, Math.min(total, t));
      const idx = starts.reduce((p, s, i) => (state.play.t >= s ? i : p), 0);
      const head = $('#tlHead');
      if (head) head.style.left = (state.play.t / total * 100) + '%';
      $$('#track .blk').forEach((b, i) => b.classList.toggle('on', i === idx));
      $('#stageNow').textContent = rows[idx] ? rows[idx].name : '—';
      $('#stageNext').textContent = rows[idx + 1] ? '下一个：' + rows[idx + 1].name + ' · ' + rows[idx + 1].dur + ' 分钟' : '这是最后一个环节';
      $('#stageClock').textContent = addMin(w.time || '11:58', state.play.t) || '';
      $$('[data-jump]').forEach((c, i) => c.classList.toggle('now', i === idx));
      $('#playMeta').textContent = state.play.on
        ? `进行中 ${mmss(state.play.t)} / ${mmss(total)}`
        : `共 ${rows.length} 环节 · ${mmss(total)}`;
      drawPlan(w, rows, state.play.t);
    };
    update(state.play.t);

    $('#btnPlay').onclick = () => {
      if (state.play.on) { stopPlay(); update(state.play.t); return; }
      state.play.on = true;
      $('#btnPlay').textContent = '⏸ 暂停';
      state.play.timer = setInterval(() => {
        const next = state.play.t + 0.5;
        if (next >= total) { update(total); stopPlay(); return; }
        update(next);
      }, 250);
    };
    $('#btnReset').onclick = () => { stopPlay(); state.play.t = 0; update(0); };
    $('#btnPoster').onclick = () => exportTimeline(w, rows);
    $('#btnVideo').onclick = () => {
      openModal('导出视频',
        `<p class="tiny muted" style="line-height:1.8;margin:0">沙盘的动画预览是竖屏短片：上半屏流程进度，下半屏现场走位动画（彩色小人）。导出为 WebM，可在微信里直接播。真实的实拍合成需要现场素材，不在这里做。</p>
         <div style="margin-top:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn primary" id="recBtn">开始生成（12 秒）</button><span class="tiny muted" id="recLog"></span></div>`);
      /* 必须在弹窗打开后再绑，否则 #recBtn 还不存在 */
      const rb = $('#recBtn');
      if (rb) rb.onclick = () => { rb.disabled = true; rb.textContent = '生成中…'; recordTimeline(w, rows); };
    };
  }

  function seekTo(w, rows, t) {
    state.play.t = t;
    const total = totalMin(w);
    const head = $('#tlHead');
    if (head) head.style.left = (Math.min(t, total) / total * 100) + '%';
    let acc = 0, idx = 0;
    rows.forEach((r, i) => { if (t >= acc) idx = i; acc += r.dur; });
    $('#stageNow').textContent = rows[idx].name;
    $('#stageClock').textContent = addMin(w.time || '11:58', t);
    $$('#track .blk').forEach((b, i) => b.classList.toggle('on', i === idx));
    $$('[data-jump]').forEach((c, i) => c.classList.toggle('now', i === idx));
    drawPlan(w, rows, t);
  }

  /* ---- 现场走位示意图（线稿场地 + 彩色人物） ---- */
  function drawPlan(w, rows, t) {
    const cv = $('#planCv');
    if (!cv || !window.Plan) return;
    try { Plan.render(cv, w, rows, t); } catch (e) { /* 画图失败不影响走场 */ }
  }

  function exportPlanPoster(w, rows) {
    if (!window.Plan) { toast('走位图模块未加载'); return; }
    try {
      const cv = Plan.poster(w, rows, `${DB.profile.brand} · ${DB.profile.name} · ${DB.profile.phone}`);
      downloadCanvas(cv, `走位图_${w.couple.bride}_${w.date}.png`);
    } catch (e) { toast('长图生成失败：' + (e.message || e)); }
  }

  function stopPlay() {
    state.play.on = false;
    clearInterval(state.play.timer);
    const b = $('#btnPlay'); if (b) b.textContent = '▶ 开始走场';
  }

  /* ---- 播放器 ---- */
  /* ================================================================
     提词器（现场照着念）
     - 稿源：一键主持稿本次生成 → 否则这一场已存稿的环节
     - 大字滚动 / 调速 / 镜像 / 全屏 / 键盘控制
     ================================================================ */
  let TP = null;

  /* 提词器偏好 + 遥控通道（同源另开一页 #remote 就能用手机控） */
  const TP_KEY = CFG.key('tp.v1');
  function tpPref() { try { return JSON.parse(localStorage.getItem(TP_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function tpPrefSave(p) {
    try { localStorage.setItem(TP_KEY, JSON.stringify(Object.assign(tpPref(), p))); } catch (e) { }
  }
  const TP_CH = (function () {
    try { return ('BroadcastChannel' in window) ? new BroadcastChannel(CFG.key('tp')) : null; } catch (e) { return null; }
  })();
  function tpSend(cmd, v) {
    if (!TP_CH) return false;
    try { TP_CH.postMessage({ type: 'cmd', cmd: cmd, v: v }); return true; } catch (e) { return false; }
  }

  function tpDoc(w) {
    const oc = state.oc;
    if (oc && oc.wid === w.id && oc.res && oc.res.groups && oc.res.groups.length) {
      return oc.res.groups.map(g => ({ name: g.name, blocks: g.blocks || [] }));
    }
    const groups = [];
    Engine.SEGMENTS.forEach(s => {
      const sc = w.scripts[s.key];
      if (sc && sc.blocks && sc.blocks.length) groups.push({ name: s.name, blocks: sc.blocks });
    });
    return groups;
  }

  function tpDestroy() {
    if (!TP) return;
    if (TP.kill) TP.kill();
    TP = null;
    document.body.classList.remove('tp-on');
  }

  function renderPrompter() {
    tpDestroy();
    const w = curW();
    const groups = tpDoc(w);
    const who = `${w.couple.bride || '—'} & ${w.couple.groom || '—'}`;

    if (!groups.length) {
      $('#view').innerHTML = `
        <div class="tp" style="cursor:default">
          <div class="tp-empty">
            这一场还没有稿子。<br>
            先去「一键主持稿」出一次，或者出完点「存回这一场」。<br><br>
            <button class="tp-btn pri" id="tpGoGen">去一键出稿</button>
            <button class="tp-btn" id="tpExit">退出</button>
          </div>
        </div>`;
      $('#tpGoGen').onclick = () => go('script');
      $('#tpExit').onclick = () => go('dash');
      return;
    }

    let html = '';
    groups.forEach(g => {
      html += `<h4>${esc(g.name)}</h4>`;
      (g.blocks || []).forEach(b => {
        if (b.t === 'cue') html += `<div><span class="cue">${esc(b.text)}</span></div>`;
        else if (b.t === 'note') html += `<div><span class="note">${esc(b.text)}</span></div>`;
        else html += `<p>${esc(b.text)}</p>`;
      });
    });

    $('#view').innerHTML = `
      <div class="tp" id="tp">
        <div class="tp-top">
          <b>${esc(who)}</b>
          <span style="opacity:.4">|</span>
          <span id="tpCur" style="color:rgba(244,240,231,.85)">${esc(groups[0].name)}</span>
          <span class="tp-prog"><i id="tpProg"></i></span>
          <span class="tp-time" id="tpPct">0%</span>
          <span class="tp-hint" style="margin-left:auto">空格 播放/暂停 · ↑↓ 速度 · +/− 字号 · Esc 退出</span>
        </div>
        <div class="tp-guide"></div>
        <div class="tp-scroll" id="tpScroll"><div class="tp-inner" id="tpInner">${html}</div></div>
        <div class="tp-bar">
          <button class="tp-btn" id="tpFsDown">A−</button>
          <span class="tp-hint" id="tpFsVal" style="margin:0 2px">40</span>
          <button class="tp-btn" id="tpFsUp">A+</button>
          <span class="tp-sep"></span>
          <button class="tp-btn pri" id="tpPlay">▶ 开播</button>
          <button class="tp-btn" id="tpSlow">慢</button>
          <button class="tp-btn on" id="tpMid">中</button>
          <button class="tp-btn" id="tpFast">快</button>
          <span class="tp-sep"></span>
          <button class="tp-btn" id="tpMirror">镜像</button>
          <button class="tp-btn" id="tpFull">全屏</button>
          <button class="tp-btn" id="tpRemote" title="复制遥控地址">遥控</button>
          <span class="tp-sep"></span>
          <button class="tp-btn" id="tpExit">退出</button>
        </div>
      </div>`;

    const tpEl = $('#tp'), sc = $('#tpScroll'), inner = $('#tpInner');
    const SPEEDS = { slow: 0.45, mid: 1.15, fast: 2.5 };
    const pref = tpPref();
    let alive = true, raf = 0;
    let fs = Math.min(84, Math.max(18, Number(pref.fs) || 40));
    let speedKey = SPEEDS[pref.speed] ? pref.speed : 'mid';
    let speed = SPEEDS[speedKey];
    let playing = false;
    let mirror = !!pref.mirror;
    /* 用定时器推进而不是 rAF：后台标签页 rAF 会被节流，提词器不能停 */

    const applyFs = () => {
      inner.style.setProperty('--tp-fs', fs + 'px');
      $('#tpFsVal').textContent = fs;
      tpPrefSave({ fs: fs });
    };
    let lastBc = 0;
    const tick = () => {
      if (!alive) return;
      if (playing) sc.scrollTop += speed;
      if (TP_CH && Date.now() - lastBc > 400) {
        lastBc = Date.now();
        const max = Math.max(1, sc.scrollHeight - sc.clientHeight);
        try { TP_CH.postMessage({ type: 'state', playing: playing, speed: speedKey, fs: fs, mirror: mirror, pct: Math.round(sc.scrollTop / max * 100) }); } catch (e) { }
      }
    };
    const upd = () => {
      const max = sc.scrollHeight - sc.clientHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, sc.scrollTop / max)) : 0;
      const bar = $('#tpProg'), pct = $('#tpPct');
      if (bar) bar.style.width = (p * 100).toFixed(1) + '%';
      if (pct) pct.textContent = Math.round(p * 100) + '%';
      const hs = inner.querySelectorAll('h4');
      let name = hs.length ? hs[0].textContent : '';
      const line = window.innerHeight * 0.33 + 60;
      hs.forEach(h => { if (h.getBoundingClientRect().top <= line) name = h.textContent; });
      const el = $('#tpCur');
      if (el && name) el.textContent = name;
    };

    const setPlay = (on) => {
      playing = on;
      const b = $('#tpPlay');
      if (b) { b.textContent = on ? '❚❚ 暂停' : '▶ 开播'; b.classList.toggle('on', on); }
      if (!on) { tpEl.classList.remove('hide-ui'); tpEl.classList.add('show-cursor'); }
      else wake();
    };
    const setSpeed = (k) => {
      if (!SPEEDS[k]) return;
      speedKey = k;
      speed = SPEEDS[k];
      tpPrefSave({ speed: k });
      ['slow', 'mid', 'fast'].forEach(x => {
        const b = $('#' + ({ slow: 'tpSlow', mid: 'tpMid', fast: 'tpFast' })[x]);
        if (b) b.classList.toggle('on', x === k);
      });
    };

    const setMirror = (on) => {
      mirror = on;
      inner.classList.toggle('mirror', mirror);
      $('#tpMirror').classList.toggle('on', mirror);
      tpPrefSave({ mirror: mirror });
    };

    $('#tpFsDown').onclick = () => { fs = Math.max(18, fs - 4); applyFs(); };
    $('#tpFsUp').onclick = () => { fs = Math.min(84, fs + 4); applyFs(); };
    $('#tpPlay').onclick = () => setPlay(!playing);
    $('#tpSlow').onclick = () => setSpeed('slow');
    $('#tpMid').onclick = () => setSpeed('mid');
    $('#tpFast').onclick = () => setSpeed('fast');
    $('#tpMirror').onclick = () => setMirror(!mirror);
    $('#tpFull').onclick = () => {
      try {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
      } catch (e) { toast('当前窗口不允许全屏，可直接用 F11'); }
    };
    $('#tpExit').onclick = () => { tpDestroy(); go('dash'); };
    $('#tpRemote').onclick = () => {
      const url = location.href.split('#')[0] + '#remote';
      copy(url);
      toast('遥控地址已复制 · 同源另一个窗口/手机打开它就能控');
    };

    /* 鼠标静止就藏控制条，现场不挡字 */
    let hideT = null;
    const wake = () => {
      tpEl.classList.remove('hide-ui');
      tpEl.classList.add('show-cursor');
      clearTimeout(hideT);
      hideT = setTimeout(() => {
        /* 只有正在走稿子时才自动收起来，暂停时控制条常驻 */
        if (!playing) return;
        tpEl.classList.add('hide-ui');
        tpEl.classList.remove('show-cursor');
      }, 4000);
    };
    tpEl.addEventListener('mousemove', wake);
    wake();

    const onKey = (e) => {
      const k = e.key;
      if (k === 'Escape') { e.preventDefault(); tpDestroy(); go('dash'); return; }
      if (k === ' ' || k === 'Spacebar') { e.preventDefault(); setPlay(!playing); wake(); return; }
      if (k === 'ArrowDown') { e.preventDefault(); speed = Math.min(4, speed + 0.3); wake(); return; }
      if (k === 'ArrowUp') { e.preventDefault(); speed = Math.max(0.2, speed - 0.3); wake(); return; }
      if (k === '+' || k === '=') { e.preventDefault(); fs = Math.min(84, fs + 4); applyFs(); wake(); return; }
      if (k === '-') { e.preventDefault(); fs = Math.max(18, fs - 4); applyFs(); wake(); return; }
      if (k === 'm' || k === 'M') { e.preventDefault(); $('#tpMirror').click(); wake(); return; }
      if (k === 'f' || k === 'F') { e.preventDefault(); $('#tpFull').click(); wake(); return; }
    };
    document.addEventListener('keydown', onKey, true);

    sc.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('resize', upd);

    applyFs();
    setSpeed(speedKey);
    if (mirror) setMirror(true);
    upd();
    raf = setInterval(tick, 16);
    document.body.classList.add('tp-on');

    /* 手机遥控：另一台设备打开同一地址 + #remote */
    const onMsg = (ev) => {
      const d = ev.data || {};
      if (d.type !== 'cmd') return;
      if (d.cmd === 'toggle') setPlay(!playing);
      else if (d.cmd === 'play') setPlay(true);
      else if (d.cmd === 'pause') setPlay(false);
      else if (d.cmd === 'speed') setSpeed(d.v);
      else if (d.cmd === 'fs') { fs = Math.max(18, Math.min(84, fs + (d.v > 0 ? 4 : -4))); applyFs(); }
      else if (d.cmd === 'mirror') setMirror(!mirror);
      else if (d.cmd === 'top') { sc.scrollTop = 0; upd(); }
      wake();
    };
    if (TP_CH) TP_CH.addEventListener('message', onMsg);

    TP = {
      kill() {
        alive = false;
        clearInterval(raf);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', upd);
        clearTimeout(hideT);
        if (TP_CH) TP_CH.removeEventListener('message', onMsg);
        if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
      }
    };
  }

  /* ================================================================
     遥控页（#remote）：手机扫同一个地址，控制提词器
     - 走 BroadcastChannel，同源另一标签页/窗口生效
     ================================================================ */
  function renderRemote() {
    document.body.innerHTML = `
      <div class="rmt">
        <div class="rmt-h">提词器遥控 <span id="rmtState">未连接</span></div>
        <div class="rmt-pct"><i id="rmtBar"></i></div>
        <button class="rmt-big" id="rmtToggle">▶ 开播 / ❚❚ 暂停</button>
        <div class="rmt-row">
          <button class="rmt-btn" data-cmd="speed" data-v="slow">慢</button>
          <button class="rmt-btn" data-cmd="speed" data-v="mid">中</button>
          <button class="rmt-btn" data-cmd="speed" data-v="fast">快</button>
        </div>
        <div class="rmt-row">
          <button class="rmt-btn" data-cmd="fs" data-v="-1">字号 −</button>
          <button class="rmt-btn" data-cmd="fs" data-v="1">字号 ＋</button>
        </div>
        <div class="rmt-row">
          <button class="rmt-btn" data-cmd="mirror">镜像</button>
          <button class="rmt-btn" data-cmd="top">回到开头</button>
        </div>
        <p class="rmt-tip" id="rmtTip">在同源的另一个窗口/标签里打开提词器（#prompter），这里就能控。</p>
      </div>`;
    const tip = document.getElementById('rmtTip');
    const state = document.getElementById('rmtState');
    const bar = document.getElementById('rmtBar');
    if (!TP_CH) {
      if (tip) tip.textContent = '这个浏览器不支持跨窗口遥控（BroadcastChannel 不可用），换 Chrome / Edge 试试。';
      if (state) state.textContent = '不支持';
      return;
    }
    const toggle = document.getElementById('rmtToggle');
    if (toggle) toggle.onclick = () => tpSend('toggle');
    document.querySelectorAll('[data-cmd]').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.v;
        tpSend(b.dataset.cmd, b.dataset.cmd === 'speed' ? v : Number(v) || 0);
      };
    });
    let last = 0;
    TP_CH.addEventListener('message', ev => {
      const d = ev.data || {};
      if (d.type !== 'state') return;
      last = Date.now();
      if (state) state.textContent = (d.playing ? '播放中' : '暂停') + ' · ' + (d.pct || 0) + '%';
      if (bar) bar.style.width = (d.pct || 0) + '%';
      if (toggle) toggle.textContent = d.playing ? '❚❚ 暂停' : '▶ 开播';
      document.querySelectorAll('[data-cmd="speed"]').forEach(b => b.classList.toggle('on', b.dataset.v === d.speed));
      if (tip) tip.textContent = '已连上提词器窗口。';
    });
    setInterval(() => {
      if (last && Date.now() - last > 4000 && state) state.textContent = '对方已断开';
    }, 2000);
  }

  /* ================================================================
     ⑧ 播放器 —— 和歌单打通
     - 环节 ↔ 歌曲走 songIndex()，和歌单页同一份解析
     - 实时 1×：进入某环节就从歌单剪好的进点自动放，离开自动停
     - 预演 8× / 30×：只走时间轴，不放音频（压缩走场，音频对不上）
     ================================================================ */
  let PL = { t: 0, on: false, timer: null, last: 0, speed: 1, cur: -1, tok: 0, adHoc: [] };
  const PL_SPEED = [[1, '实时 1×'], [8, '预演 8×'], [30, '预演 30×']];

  function plHalt() {
    PL.on = false;
    clearInterval(PL.timer); PL.timer = null;
    PL.tok++; AudioLib.stop(); PL.cur = -1;
  }

  function plStopAudio() {
    PL.tok++;
    AudioLib.stop();
    PL.cur = -1;
  }

  /* 放第 i 个环节的歌；offset = 已经走过多少秒（中途接上就从对应位置进） */
  function plPlayCue(si, i, offset) {
    const row = si.rows[i];
    const p = row ? si.of(row) : null;
    const s = p && p.song;
    /* 不管有没有得放，都算「已进入这一环节」，避免每 200ms 重试一次 */
    PL.cur = i;
    if (!s || !s.audio) { PL.tok++; AudioLib.stop(); return; }
    const tr = (s.trim && s.trim.end > s.trim.start) ? s.trim : { start: 0, end: s.audio.dur || 0 };
    const len = Math.max(0, (tr.end || 0) - (tr.start || 0));
    const off = Math.max(0, offset || 0);
    if (len < 0.3 || off >= len - 0.05) { PL.tok++; AudioLib.stop(); return; }  // 这一段已经放完了
    const tok = ++PL.tok;
    AudioLib.buffer(s.audio.id).then(buf => {
      if (tok !== PL.tok || !PL.on) return;
      AudioLib.play(buf, {
        start: tr.start + off,
        end: tr.end,
        fadeIn: off > 0.3 ? 0.4 : (tr.fadeIn || 0),
        fadeOut: tr.fadeOut || 0,
        gain: tr.gain == null ? 1 : tr.gain
      }, () => { if (tok === PL.tok) PL.cur = i; });
    }).catch(() => { /* 文件丢了：静默，歌单里那行会标「需重新导入」 */ });
  }

  /* 提前解出下一段，走到边界不会卡一下 */
  function plPrefetch(si, i, leftSec) {
    if (leftSec > 6) return;
    const p = si.of(si.rows[i + 1]);
    if (p && p.song.audio && p.song.audio.id) AudioLib.buffer(p.song.audio.id).catch(() => {});
  }

  function renderPlayer() {
    const w = curW();
    const si = songIndex(w);
    /* 插播：临时塞进时间轴的环节，只影响本次跟场，不写进流程表 */
    const rows = [];
    si.rows.forEach((r, i) => {
      rows.push(r);
      (PL.adHoc || []).filter(a => a.afterKey === i).forEach(a => {
        rows.push({ name: a.name, dur: a.dur, from: '', to: '', ad: a });
      });
    });
    const totalSec = Math.max(1, Math.round(rows.reduce((a, r) => a + (Number(r.dur) || 0), 0) * 60));
    const starts = [];
    (function () { let acc = 0; rows.forEach(r => { starts.push(acc); acc += (Number(r.dur) || 0) * 60; }); })();
    const at = (t) => starts.reduce((p, s, i) => (t >= s ? i : p), 0);
    const spName = () => (PL_SPEED.filter(x => x[0] === PL.speed)[0] || PL_SPEED[0])[1];

    /* 从歌单点「↗」跳过来：定位到那一环节 */
    if (state.focusCue != null) {
      const i = state.focusCue;
      state.focusCue = null;
      if (rows[i]) { PL.t = starts[i]; PL.cur = -1; }
    }

    $('#view').innerHTML = `
      <div class="stage" style="background:linear-gradient(170deg,#241E1A,#151110)">
        <div class="h"><span>● 播放器</span><span style="opacity:.4">|</span><span>CUE 时间轴</span></div>
        <div class="now" id="pNow">${esc(rows[0] ? rows[0].name : '—')}</div>
        <div class="nxt" id="pNext"></div>
        <div class="clock" id="pClock">${esc(w.time || '')}</div>
        <div class="p-warn" id="pWarn"></div>
        <div class="tl">
          <div class="track" id="pTrack">
            ${rows.map((r, i) => `<div class="blk" data-pi="${i}" style="flex:${r.dur} 1 0"><span>${esc(r.name)}</span><em>${esc(r.from)}</em></div>`).join('')}
          </div>
          <div class="head" id="pHead" style="left:0"></div>
        </div>
        <div class="ctrl">
          <button class="btn primary" id="pPlay">▶ 跟场</button>
          <button class="btn" id="pReset">回到开头</button>
          <button class="btn" id="pAdhoc" title="临时加一段：致辞超时、加个游戏">＋ 插播</button>
          <span class="pl-sp">${PL_SPEED.map(([v, l]) =>
            `<button class="${PL.speed === v ? 'on' : ''}" data-speed="${v}">${l}</button>`).join('')}</span>
          <span class="tiny p-meta" id="pMeta"></span>
        </div>
      </div>

      <div class="sect" style="margin-top:20px">
        <div class="sect-h"><h3>CUE 表</h3><span>跟场时自动播歌单里剪好的那一段</span></div>
        <div class="cuebar">
          ${rows.map((r, i) => {
            const p = r.ad ? null : si.of(r);
            const s = p && p.song;
            const has = !!(s && s.audio);
            const cut = s ? cutText(s, true) : '';
            if (r.ad) {
              return `<div class="cuecard ad" data-cue="${i}">
                <div class="tm">插播</div>
                <button class="mini act" data-delad="${esc(r.ad.id)}" title="取消这段插播">✕</button>
                <div class="nm">${esc(r.name)} <span class="tiny muted">${r.dur}′</span></div>
                <div class="sg"><span class="cue-song off">临时加的，不进流程表</span></div>
              </div>`;
            }
            return `<div class="cuecard" data-cue="${i}">
              <div class="tm">${esc(r.from)}</div>
              <button class="mini act" data-gosong="${p ? p.idx : ''}" data-gseg="${esc(r.name)}" data-gfid="${esc(r.id || '')}" title="到歌单里改这一环节">歌单</button>
              <div class="nm">${esc(r.name)} <span class="tiny muted">${r.dur}′</span></div>
              <div class="sg">
                ${has ? `<button class="mini cue-play" data-cueplay="${p.idx}" title="单独试听剪好的这一段">▶</button>` : ''}
                <span class="cue-song ${has ? '' : 'off'}">${s ? '♪ ' + esc(s.title || '待定') : '未配歌'}</span>
                ${cut ? `<em class="cue-cut">${esc(cut)}</em>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    const upd = (t) => {
      t = Math.max(0, Math.min(totalSec, t));
      PL.t = t;
      const i = at(t);
      $('#pHead').style.left = (t / totalSec * 100) + '%';
      const r = rows[i];
      $('#pNow').textContent = r ? r.name : '—';
      const p = r && !r.ad ? si.of(r) : null;
      const s = p && p.song;
      const cut = s ? cutText(s, true) : '';
      $('#pNext').innerHTML = r && r.ad
        ? '插播中 · 说完点下一个环节'
        : (s
          ? `♪ ${esc(s.title || '待定')}${s.artist ? ' · ' + esc(s.artist) : ''}${cut ? '　[' + esc(cut) + ']' : ''}`
          : '这个环节还没配歌');
      $('#pClock').textContent = addMin(w.time || '11:58', Math.floor(t / 60)) || '';
      $$('#pTrack .blk').forEach((b, k) => b.classList.toggle('on', k === i));
      $$('[data-cue]').forEach((c, k) => c.classList.toggle('now', k === i));

      /* 剩余时间提醒：最后 3 分钟开始提示，最后 1 分钟变红 */
      const warn = $('#pWarn');
      if (warn) {
        const remain = totalSec - t;
        const on = PL.on && remain <= 180 && remain > 0;
        warn.classList.toggle('on', on);
        warn.classList.toggle('urgent', remain <= 60 && remain > 0);
        warn.textContent = on ? (remain <= 60 ? '只剩 ' + Math.ceil(remain) + ' 秒' : '还剩 ' + Math.ceil(remain / 60) + ' 分钟') : '';
      }

      let live;
      if (PL.speed !== 1) live = '预演不放音频';
      else if (!PL.on) live = s && s.audio ? '待跟场' : '未配歌';
      else live = s && s.audio ? '♪ 在放' : '这一环节无音频';
      $('#pMeta').textContent = `${mmss(t / 60)} / ${mmss(totalSec / 60)} · ${spName()} · ${live}`;

      if (i !== PL.cur) {
        if (r && r.ad) { plStopAudio(); PL.cur = i; }
        else if (PL.on && PL.speed === 1) plPlayCue(si, i, t - starts[i]);
        else PL.cur = i;
      }
    };

    const plPause = () => {
      PL.on = false;
      clearInterval(PL.timer); PL.timer = null;
      plStopAudio();
      const b = $('#pPlay'); if (b) b.textContent = '▶ 跟场';
    };

    const tick = () => {
      const now = Date.now();
      const dt = Math.min(1.2, (now - PL.last) / 1000) * PL.speed;
      PL.last = now;
      const nx = PL.t + dt;
      if (nx >= totalSec) { upd(totalSec); plPause(); return; }
      upd(nx);
      const i = at(PL.t);
      if (rows[i] && rows[i].ad) return;
      const endSec = i < rows.length - 1 ? starts[i + 1] : totalSec;
      plPrefetch(si, i, endSec - PL.t);
    };

    upd(PL.t);
    $('#pPlay').textContent = PL.on ? '⏸ 暂停' : '▶ 跟场';
    if (PL.on) { PL.last = Date.now(); PL.timer = setInterval(tick, 200); }

    $('#pPlay').onclick = () => {
      if (PL.on) { plPause(); upd(PL.t); return; }
      if (PL.t >= totalSec - 0.6) PL.t = 0;
      PL.on = true;
      PL.last = Date.now();
      PL.cur = -1;
      $('#pPlay').textContent = '⏸ 暂停';
      upd(PL.t);
      PL.timer = setInterval(tick, 200);
    };
    $('#pReset').onclick = () => { plPause(); PL.t = 0; upd(0); };

    $('#pAdhoc').onclick = () => {
      const cur = rows[at(PL.t)];
      let base = -1;
      for (let k = at(PL.t); k >= 0; k--) { if (!rows[k].ad) { base = si.rows.indexOf(rows[k]); break; } }
      openModal('插播一段', `
        <div class="field"><label>这一段叫什么</label><input class="input" id="adName" value="临时致辞" placeholder="如：伴郎加唱 / 父母讲话"></div>
        <div class="field"><label>大概多久（分钟）</label><input class="input" id="adDur" type="number" min="0.5" step="0.5" value="3"></div>
        <p class="tiny muted" style="margin:0;line-height:1.8">插在「${esc(cur ? cur.name : '开头')}」之后，只影响这次跟场，不写进流程表。时间轴会自动把后面的环节往后推。</p>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="btn primary sm" id="adOk">插入</button>
          <button class="btn sm" id="adCancel">取消</button>
        </div>`);
      $('#adCancel').onclick = closeModal;
      $('#adOk').onclick = () => {
        const name = ($('#adName').value || '').trim() || '插播';
        const d = Math.max(0.5, Number($('#adDur').value) || 3);
        PL.adHoc = PL.adHoc || [];
        PL.adHoc.push({ id: 'ad' + uid(), name: name, dur: d, afterKey: base });
        closeModal(); renderPlayer();
        toast('已插入「' + name + '」' + d + ' 分钟 · 跟场时会计入');
      };
    };

    $$('[data-delad]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      PL.adHoc = (PL.adHoc || []).filter(a => a.id !== b.dataset.delad);
      renderPlayer(); toast('已取消这段插播');
    });

    $$('[data-speed]').forEach(b => b.onclick = () => {
      PL.speed = +b.dataset.speed;
      $$('[data-speed]').forEach(x => x.classList.toggle('on', +x.dataset.speed === PL.speed));
      plStopAudio();
      PL.last = Date.now();
      upd(PL.t);
    });

    const jumpTo = (i) => { PL.cur = -1; upd(starts[i]); };    $$('[data-cue]').forEach((c, i) => c.onclick = e => {
      if (e.target.closest('button')) return;
      jumpTo(i);
    });
    $$('[data-pi]').forEach((b, i) => b.onclick = () => jumpTo(i));

    /* 到歌单里改：定位到这一环节；还没配歌会自动建一行 */
    $$('[data-gosong]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      state.focusSong = {
        idx: b.dataset.gosong === '' ? null : +b.dataset.gosong,
        seg: b.dataset.gseg,
        fid: b.dataset.gfid || null
      };
      go('songs');
    });

    $$('[data-cueplay]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      /* 单独试听和跟场不能同时响，先停跟场 */
      if (PL.on) { plPause(); upd(PL.t); }
      toggleRowPlay(+b.dataset.cueplay, b);
    });
  }

  /* ---- 导出：长图 ---- */
  function exportTimeline(w, rows) {
    const W = 900, H = 240 + rows.length * 0 + 420;
    const cv = document.createElement('canvas');
    const dpr = 2;
    cv.width = W * dpr; cv.height = (260 + 300) * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    // bg
    const grad = g.createLinearGradient(0, 0, W, 560);
    grad.addColorStop(0, '#FCF8F1'); grad.addColorStop(1, '#F3EADC');
    g.fillStyle = grad; g.fillRect(0, 0, W, 560);
    g.fillStyle = C.wine; g.font = '600 13px "Songti SC",serif'; g.fillText((CFG.brand.name || '') + ' · 婚礼流程沙盘', 48, 52);
    g.fillStyle = '#1B1815'; g.font = '600 34px "Songti SC",serif';
    g.fillText(`${w.couple.bride} & ${w.couple.groom}`, 48, 104);
    g.fillStyle = '#8B8175'; g.font = '13px -apple-system,sans-serif';
    g.fillText(`${prettyDate(w.date)} ${w.time || ''} · ${w.hotel} · 共 ${mmss(flowTotal(w))}`, 48, 132);

    // timeline
    const total = totalMin(w), x0 = 48, y0 = 180, wTrack = W - 96, h = 46;
    let acc = 0;
    rows.forEach((r) => {
      const x = x0 + (acc / total) * wTrack;
      const bw = Math.max(6, (r.dur / total) * wTrack - 2);
      g.fillStyle = acc / total < 0.5 ? 'rgba(var(--wine-rgb),.82)' : 'rgba(176,138,82,.82)';
      roundRect(g, x, y0, bw, h, 5); g.fill();
      g.fillStyle = 'rgba(255,255,255,.95)'; g.font = '10px -apple-system,sans-serif';
      g.save(); g.beginPath(); g.rect(x, y0, bw - 4, h); g.clip();
      g.fillText(r.name, x + 6, y0 + 19);
      g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(r.from, x + 6, y0 + 34);
      g.restore();
      acc += r.dur;
    });
    // list
    let y = y0 + h + 34;
    g.font = '12px -apple-system,sans-serif';
    rows.forEach((r, i) => {
      if (i > 11) return;
      g.fillStyle = C.wine; g.font = '500 12px "Songti SC",serif';
      g.fillText(r.from, x0, y);
      g.fillStyle = '#2A2520'; g.font = '12px -apple-system,sans-serif';
      g.fillText(r.name, x0 + 58, y);
      g.fillStyle = '#8B8175';
      g.fillText(`${r.dur} 分钟`, x0 + 220, y);
      g.fillStyle = '#A39A8D'; g.font = '11px -apple-system,sans-serif';
      g.fillText((r.note || '').slice(0, 26), x0 + 290, y);
      y += 22;
    });
    g.fillStyle = '#B3AA9C'; g.font = '10.5px -apple-system,sans-serif';
    g.fillText(`${DB.profile.brand} · ${DB.profile.name} · ${DB.profile.phone}`, x0, 540);
    downloadCanvas(cv, `沙盘_${w.date}.png`);
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  /* ---- 导出：流程表 PNG ---- */
  function exportPoster(w) {
    const rows = flowTimeline(w).filter(r => r.vis !== 'planner' && r.vis !== 'none');
    const W = 760, H = 180 + rows.length * 36 + 90;
    const cv = document.createElement('canvas'); const dpr = 2;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    g.fillStyle = '#FFFDF9'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(176,138,82,.35)'; g.lineWidth = 1; g.strokeRect(14, 14, W - 28, H - 28);

    g.fillStyle = C.wine; g.font = '600 12px "Songti SC",serif';
    g.fillText(DB.profile.brand, 40, 56);
    g.fillStyle = '#1B1815'; g.font = '600 27px "Songti SC",serif';
    g.fillText(`${w.couple.bride} & ${w.couple.groom}`, 40, 96);
    g.fillStyle = '#8B8175'; g.font = '12.5px -apple-system,sans-serif';
    g.fillText(`${(w.date || '').replace(/-/g, ' / ')} · ${w.time || ''} · ${w.hotel}`, 40, 120);

    let y = 160;
    rows.forEach(r => {
      g.fillStyle = C.wine; g.font = '500 12.5px "Songti SC",serif';
      g.fillText(r.from, 40, y);
      g.fillStyle = '#221E19'; g.font = '13px -apple-system,sans-serif';
      g.fillText(r.name, 104, y);
      g.fillStyle = '#A39A8D'; g.font = '11px -apple-system,sans-serif';
      if (r.note) g.fillText(r.note.slice(0, 30), 260, y);
      g.strokeStyle = 'rgba(27,24,21,.08)';
      g.beginPath(); g.moveTo(40, y + 10); g.lineTo(W - 40, y + 10); g.stroke();
      y += 36;
    });
    g.fillStyle = '#B3AA9C'; g.font = '10.5px -apple-system,sans-serif';
    g.fillText(DB.profile.slogan, 40, H - 40);
    g.fillText(`共 ${mmss(flowTotal(w))}`, W - 130, H - 40);
    downloadCanvas(cv, `流程表_${w.couple.bride}_${w.date}.png`);
  }

  /* ---- 录制一段走势动画（简化：真实导出 WebM 由 MediaRecorder 完成） ---- */
  function recordTimeline(w, rows) {
    const log = $('#recLog');
    const cv = document.createElement('canvas');
    cv.width = 720; cv.height = 1280;
    const g = cv.getContext('2d');
    if (!cv.captureStream || !window.MediaRecorder) { log.textContent = '当前浏览器不支持录制'; return; }
    const stream = cv.captureStream(25);
    let rec;
    try { rec = new MediaRecorder(stream, { mimeType: 'video/webm' }); }
    catch (e) { log.textContent = '当前浏览器不支持 WebM 录制'; return; }
    const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      saveBlob(blob, `沙盘_${w.couple.bride}_${w.date}.webm`, { kind: 'webm', quiet: true });
      log.textContent = '已导出 WebM（' + fmtSize(blob.size) + '）· 在系统「下载」文件夹';
    };
    rec.start();
    const total = totalMin(w);
    const planSeq = window.Plan ? Plan.choreo(rows) : null;
    let t = 0;
    const draw = () => {
      g.fillStyle = '#1B1815'; g.fillRect(0, 0, 720, 1280);
      const grad = g.createRadialGradient(600, 100, 20, 600, 100, 900);
      grad.addColorStop(0, 'rgba(176,138,82,.35)'); grad.addColorStop(1, 'rgba(27,24,21,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 720, 1280);
      g.fillStyle = 'rgba(245,237,228,.6)'; g.font = '14px -apple-system,sans-serif';
      g.fillText((CFG.brand.name || '') + ' · 演示沙盘', 48, 90);
      g.fillStyle = '#F7EEE3'; g.font = '600 44px "Songti SC",serif';
      g.fillText(w.couple.bride, 48, 190);
      g.fillText(w.couple.groom, 48, 250);
      g.fillStyle = 'rgba(245,237,228,.5)'; g.font = '16px -apple-system,sans-serif';
      g.fillText(`${w.date} · ${w.hotel}`, 48, 300);

      let acc = 0, idx = 0;
      rows.forEach((r, i) => { if (t >= acc) idx = i; acc += r.dur; });
      const cur = rows[idx];
      g.fillStyle = '#F0D9AE'; g.font = '20px -apple-system,sans-serif';
      g.fillText(cur.from, 48, 470);
      g.fillStyle = '#FFF8F0'; g.font = '600 56px "Songti SC",serif';
      g.fillText(cur.name, 48, 540);
      g.fillStyle = 'rgba(245,237,228,.6)'; g.font = '18px -apple-system,sans-serif';
      g.fillText((cur.note || '').slice(0, 22), 48, 590);

      /* 现场走位平面图 */
      if (planSeq) {
        const ps = 624 / Plan.LW;
        g.save(); g.translate(48, 628); g.scale(ps, ps);
        roundRect(g, 0, 0, Plan.LW, Plan.LH, 14); g.fillStyle = '#FDFAF4'; g.fill();
        Plan.drawInto(g, { rows: rows, t: t, seq: planSeq, title: false, bg: false });
        g.restore();
        g.fillStyle = 'rgba(245,237,228,.45)'; g.font = '13px -apple-system,sans-serif';
        g.fillText('走位示意 · 彩色小人为新人 / 主持人 / 父母 / 伴郎伴娘', 48, 628 + 624 * Plan.LH / Plan.LW + 26);
      }

      const x0 = 48, wTrack = 624, y0 = 1070;
      let acc2 = 0;
      rows.forEach(r => {
        const x = x0 + (acc2 / total) * wTrack;
        const bw = Math.max(4, (r.dur / total) * wTrack - 2);
        g.fillStyle = acc2 <= t ? 'rgba(232,196,148,.92)' : 'rgba(255,255,255,.12)';
        roundRect(g, x, y0, bw, 26, 4); g.fill();
        acc2 += r.dur;
      });
      const hx = x0 + (t / total) * wTrack;
      g.fillStyle = '#FFF'; g.fillRect(hx - 1, y0 - 8, 2, 42);
      g.fillStyle = 'rgba(245,237,228,.55)'; g.font = '14px -apple-system,sans-serif';
      g.fillText(`${Math.round(t)} / ${Math.round(total)} 分钟`, 48, y0 + 70);
      g.fillStyle = 'rgba(245,237,228,.35)'; g.font = '13px -apple-system,sans-serif';
      g.fillText(DB.profile.brand, 48, 1200);
    };
    const iv = setInterval(() => {
      t += total / (12 * 25);
      draw();
      if (t >= total) { clearInterval(iv); setTimeout(() => rec.stop(), 400); }
    }, 40);
    draw();
  }

  /* ================================================================
     ⑨ 图片模板
     ================================================================ */
  const TPLS = [
    { id: 'quote', name: '报价单', desc: '给直客，含分项与合计' },
    { id: 'flow', name: '流程表图片版', desc: '给新人 / 策划，可隐藏环节' },
    { id: 'confirm', name: '订单确认函', desc: '档期确认，双方签字位' }
  ];

  function renderTemplates() {
    const w = curW();
    $('#view').innerHTML = `
      <div class="tpl-grid">
        ${TPLS.map(t => `
          <div class="tpl" data-tpl="${t.id}">
            <div class="pv">
              <div style="font-family:var(--serif);font-size:12px;color:var(--wine);letter-spacing:.1em">${esc(DB.profile.brand)}</div>
              <div style="font-family:var(--serif);font-size:19px;margin:6px 0 12px">${esc(t.name)}</div>
              <div class="l m"></div><div class="l s"></div><div class="l"></div><div class="l m"></div><div class="l s"></div>
              <div style="position:absolute;right:18px;top:18px;font-size:9px;letter-spacing:.16em;color:var(--ink-4)">TEMPLATE</div>
            </div>
            <div class="ft"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></div>
          </div>`).join('')}
      </div>
      <div class="card" style="margin-top:18px">
        <div class="card-h"><h3>模板里的固定信息</h3><span class="hint">改一次，所有模板同步</span></div>
        <div class="card-b">
          <div class="grid-2">
            <div class="field"><label>品牌名</label><input class="input" id="p_brand" value="${esc(DB.profile.brand)}"></div>
            <div class="field"><label>主持人</label><input class="input" id="p_name" value="${esc(DB.profile.name)}"></div>
            <div class="field"><label>联系电话</label><input class="input" id="p_phone" value="${esc(DB.profile.phone)}"></div>
            <div class="field"><label>Slogan</label><input class="input" id="p_slogan" value="${esc(DB.profile.slogan)}"></div>
          </div>
          <button class="btn sm" id="pSave">保存</button>
          <hr class="sep">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn sm" id="expJson">导出全部数据 .json</button>
            <button class="btn sm" id="impJson">导入备份</button>
            <input type="file" id="impFile" accept=".json" style="display:none">
            <span class="tiny muted" style="align-self:center">数据在这台电脑的浏览器里，换机器请先导出。</span>
          </div>
        </div>
      </div>`;

    $$('[data-tpl]').forEach(el => el.onclick = () => openTemplate(el.dataset.tpl, w));
    $('#pSave').onclick = () => {
      DB.profile.brand = $('#p_brand').value; DB.profile.name = $('#p_name').value;
      DB.profile.phone = $('#p_phone').value; DB.profile.slogan = $('#p_slogan').value;
      save(); renderShell(); toast('已保存');
    };
    $('#expJson').onclick = () => download(JSON.stringify(DB, null, 2), `${CFG.brand.backupName || '工作台备份'}_${ymd(TODAY)}.json`);
    $('#impJson').onclick = () => $('#impFile').click();
    $('#impFile').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const d = JSON.parse(rd.result);
          if (!d || !Array.isArray(d.weddings) || !d.weddings.length) throw new Error('这不是本工作台的备份文件');
          if (Number(d.version) > DB_VERSION) {
            throw new Error('这份备份来自更新的版本（v' + d.version + '），先刷新页面升级本工具再导入');
          }
          DB = normalize(d);          // 老备份缺字段也补齐，避免导完某个视图打不开
          save(); renderShell(); render();
          toast('已导入 ' + DB.weddings.length + ' 场（缺失字段已自动补齐）');
        } catch (err) { toast('导入失败：' + err.message); }
      };
      rd.readAsText(f);
    };
  }

  function openTemplate(id, w) {
    const html = `<div style="display:grid;place-items:center;background:var(--paper-2);padding:18px;border-radius:10px">
      <canvas id="tplCv" style="max-width:100%;box-shadow:var(--shadow)"></canvas></div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn primary" id="tplDl">下载 PNG</button>
      <span class="tiny muted" style="align-self:center">A4 竖版 · 2 倍分辨率</span></div>`;
    openModal(TPLS.find(t => t.id === id).name + ' · ' + w.couple.bride + ' & ' + w.couple.groom, html);
    const cv = $('#tplCv');
    drawTpl(cv, id, w);
    $('#tplDl').onclick = () => downloadCanvas(cv, `${id}_${w.date}.png`);
  }

  function drawTpl(cv, id, w) {
    const W = 620, H = 860, dpr = 2;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W * 0.82 + 'px';
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    g.fillStyle = '#FFFDF9'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(176,138,82,.4)'; g.strokeRect(16, 16, W - 32, H - 32);

    g.fillStyle = C.wine; g.font = '600 12px "Songti SC",serif';
    g.fillText(DB.profile.brand, 44, 62);
    g.fillStyle = '#1B1815'; g.font = '600 22px "Songti SC",serif';
    g.fillText(TPLS.find(t => t.id === id).name, 44, 100);
    g.fillStyle = '#8B8175'; g.font = '12px -apple-system,sans-serif';
    g.fillText(`${w.couple.bride} & ${w.couple.groom}　|　${w.date} ${w.time || ''}　|　${w.hotel}`, 44, 126);

    g.strokeStyle = 'rgba(27,24,21,.12)';
    g.beginPath(); g.moveTo(44, 146); g.lineTo(W - 44, 146); g.stroke();

    let y = 186;
    const line = (a, b, strong) => {
      g.fillStyle = strong ? '#1B1815' : '#5B544A';
      g.font = (strong ? '600 ' : '') + '13px -apple-system,sans-serif';
      g.fillText(a, 44, y);
      g.textAlign = 'right'; g.fillText(b, W - 44, y); g.textAlign = 'left';
      y += 30;
    };

    if (id === 'quote') {
      line('主持服务（含前期沟通、流程设计、现场执行）', '¥ ' + (w.fee ? (w.fee * 0.8).toFixed(0) : '—'));
      line('彩排 / 走场（一次）', '¥ 800');
      line('定制台词撰写（含风格库适配）', '¥ 1200');
      line('现场音乐剪辑与播放', '¥ 600');
      y += 6; g.strokeStyle = 'rgba(27,24,21,.14)'; g.beginPath(); g.moveTo(44, y); g.lineTo(W - 44, y); g.stroke(); y += 34;
      line('合计', '¥ ' + ((w.fee ? w.fee * 0.8 : 0) + 2600).toFixed(0), true);
      y += 12;
      g.fillStyle = '#8B8175'; g.font = '11.5px -apple-system,sans-serif';
      ['· 报价含一次免费改期（提前 15 天告知）', '· 差旅、住宿另计，按实际发生结算', '· 定金 50%，余款于仪式当日结清']
        .forEach(t => { g.fillText(t, 44, y); y += 22; });
    } else if (id === 'flow') {
      flowTimeline(w).filter(r => r.vis !== 'planner' && r.vis !== 'none').forEach(r => {
        g.fillStyle = C.wine; g.font = '500 12.5px "Songti SC",serif';
        g.fillText(r.from, 44, y);
        g.fillStyle = '#221E19'; g.font = '13px -apple-system,sans-serif';
        g.fillText(r.name, 116, y);
        g.fillStyle = '#A39A8D'; g.font = '10.5px -apple-system,sans-serif';
        g.textAlign = 'right'; g.fillText(r.dur + '′', W - 44, y); g.textAlign = 'left';
        g.strokeStyle = 'rgba(27,24,21,.07)'; g.beginPath(); g.moveTo(44, y + 10); g.lineTo(W - 44, y + 10); g.stroke();
        y += 34;
      });
    } else {
      g.fillStyle = '#5B544A'; g.font = '12.5px -apple-system,sans-serif';
      const txt = ['兹确认，', `${w.couple.bride} 与 ${w.couple.groom} 的婚礼，`,
        `定于 ${w.date} ${w.time || ''} 在 ${w.hotel} 举行。`,
        `主持人为 ${DB.profile.name}，服务内容以流程表为准。`,
        '定金到账即视为档期锁定，当日不再接受其它预订。'];
      txt.forEach(t => { g.fillText(t, 44, y); y += 26; });
      y += 20;
      line('服务费', '¥ ' + (w.fee || 0).toLocaleString());
      line('策划 / 对接人', w.planner || '—');
      line('宾客人数', (w.guests || '—') + ' 人');
      y += 50;
      g.strokeStyle = 'rgba(27,24,21,.35)';
      g.beginPath(); g.moveTo(44, y); g.lineTo(240, y); g.moveTo(W - 240, y); g.lineTo(W - 44, y); g.stroke();
      g.fillStyle = '#8B8175'; g.font = '11px -apple-system,sans-serif';
      g.fillText('新人签字', 44, y + 18); g.fillText('主持人签字', W - 240, y + 18);
    }

    g.fillStyle = '#B3AA9C'; g.font = '10.5px -apple-system,sans-serif';
    g.fillText(DB.profile.slogan, 44, H - 56);
    g.textAlign = 'right'; g.fillText(DB.profile.phone, W - 44, H - 56); g.textAlign = 'left';
  }

  /* ================================================================
     通用：下载 / 复制
     ================================================================ */
  /* ---------------- 导出：一处管住落盘、提示与记录 ---------------- */
  const EXP_KEY = CFG.key('exports.v1');
  let EXP_LAST = null;

  function expList() {
    try { return JSON.parse(localStorage.getItem(EXP_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function expPush(rec) {
    const list = expList();
    list.unshift(rec);
    try { localStorage.setItem(EXP_KEY, JSON.stringify(list.slice(0, 15))); } catch (e) { }
  }
  /* 预览窗口 / iframe 里下载会被拦，先判断出来 */
  function inFrame() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function rawDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { a.parentNode.removeChild(a); } catch (e) { } }, 1500);
    return url;
  }
  function saveBlob(blob, name, opt) {
    opt = opt || {};
    let url = '';
    try { url = rawDownload(blob, name); }
    catch (e) { toast('导出失败：' + (e.message || '未知')); return; }
    const rec = {
      n: name, s: blob.size, t: Date.now(), k: opt.kind || '',
      x: opt.text ? String(opt.text).slice(0, 20000) : ''
    };
    expPush(rec);
    EXP_LAST = { url: url, blob: blob, rec: rec };
    if (opt.quiet) { toast('已导出 ' + name + '（' + fmtSize(blob.size) + '）· 在系统「下载」文件夹'); return; }
    if (inFrame()) exportDialog(rec, url);
    else toast('已导出 ' + name + '（' + fmtSize(blob.size) + '）· 在浏览器「下载」目录');
  }
  function download(text, name) {
    saveBlob(new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' }), name, { kind: 'text', text: text });
  }
  function downloadCanvas(cv, name) {
    cv.toBlob(b => { if (b) saveBlob(b, name, { kind: 'png' }); else toast('导出失败：画布是空的'); }, 'image/png');
  }

  /* 预览窗口里点导出后弹这张卡：文件名 / 大小 / 去哪找 / 拿不到怎么办 */
  function exportDialog(rec, url) {
    openModal('文件已生成', `
      <div class="exp-card">
        <div class="exp-row"><span>文件名</span><b>${esc(rec.n)}</b></div>
        <div class="exp-row"><span>大小</span><b>${fmtSize(rec.s)}</b></div>
        <div class="exp-row"><span>时间</span><b>${new Date(rec.t).toLocaleTimeString('zh-CN', { hour12: false })}</b></div>
      </div>
      <p class="tiny muted" style="margin:12px 0 0;line-height:1.8">
        文件已经交给浏览器，默认落在系统的<b>「下载」文件夹</b>（macOS：访达侧栏「下载」，Windows：<span class="mono">下载</span>）。
      </p>
      <p class="tiny muted" style="margin:6px 0 0;line-height:1.8">
        如果找不着，多半是<b>预览窗口拦截了下载</b>（页面嵌在框里，浏览器不放行）。用下面任意一种拿文件：
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn primary sm" data-exp="again">再下载一次</button>
        ${rec.x ? '<button class="btn sm" data-exp="copy">复制内容</button>' : ''}
        <button class="btn sm" data-exp="browser">在浏览器里打开本页</button>
        <button class="btn ghost sm" data-exp="list">全部导出记录</button>
      </div>`);
  }

  function exportListModal() {
    const list = expList();
    if (!list.length) {
      openModal('导出记录', '<p class="tiny muted" style="line-height:1.9">还没有导出过东西。所有导出都会记在这里，方便回头找文件。</p>');
      return;
    }
    openModal('导出记录', `
      <p class="tiny muted" style="margin:0 0 10px;line-height:1.8">文件都在系统的「下载」文件夹里。点文件名可以复制内容再存一次；文本类可直接再下载。</p>
      <div class="exp-list">
        ${list.map((r, i) => `
          <div class="exp-li">
            <span class="tm">${new Date(r.t).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            <span class="nm">${esc(r.n)}</span>
            <span class="sz">${fmtSize(r.s)}</span>
            <span class="op">
              ${r.x ? `<button class="mini" data-exp="redl:${i}" title="再下载一次">↓</button>` : ''}
              ${r.x ? `<button class="mini" data-exp="copyi:${i}" title="复制内容">复制</button>` : ''}
            </span>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn ghost sm" data-exp="clear">清空记录</button>
      </div>`);
  }

  function exportAction(act) {
    if (act === 'again' && EXP_LAST) { rawDownload(EXP_LAST.blob || new Blob([EXP_LAST.rec.x || ''], { type: 'text/plain;charset=utf-8' }), EXP_LAST.rec.n); return; }
    if (act === 'copy' && EXP_LAST) { copy(EXP_LAST.rec.x || ''); return; }
    if (act === 'browser') {
      const u = location.href;
      copy(u);
      try { window.open(u, '_blank'); } catch (e) { }
      toast('已在浏览器打开；打不开就把地址粘到浏览器（已复制）');
      return;
    }
    if (act === 'list') { exportListModal(); return; }
    if (act === 'clear') { try { localStorage.removeItem(EXP_KEY); } catch (e) { } exportListModal(); return; }
    if (act.indexOf('redl:') === 0) {
      const r = expList()[+act.split(':')[1]];
      if (r) rawDownload(new Blob(['\ufeff' + (r.x || '')], { type: 'text/plain;charset=utf-8' }), r.n);
      return;
    }
    if (act.indexOf('copyi:') === 0) {
      const r = expList()[+act.split(':')[1]];
      if (r) copy(r.x || '');
    }
  }
  /* 复制：优先剪贴板 API，沙箱里被拒就退回 execCommand，再不行弹窗让人手动复制 */
  function copy(text) {
    const t = String(text == null ? '' : text);
    if (!t.trim()) { toast('没有可复制的内容'); return; }
    const okToast = () => toast('已复制');
    const fallback = () => { if (legacyCopy(t)) okToast(); else manualCopy(t); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(okToast, fallback);
        return;
      }
    } catch (e) { /* 忽略，走兜底 */ }
    fallback();
  }

  function legacyCopy(text) {
    let ta = null, ok = false;
    try {
      ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;z-index:-1';
      document.body.appendChild(ta);
      const sel = document.getSelection();
      const prev = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (e2) {}
      ok = document.execCommand('copy');
      if (prev && sel) { sel.removeAllRanges(); sel.addRange(prev); }
    } catch (e) { ok = false; }
    if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
    return ok;
  }

  function manualCopy(text) {
    openModal('手动复制', `
      <p class="small" style="margin:0 0 10px;line-height:1.75">这个环境不让脚本直接写剪贴板。下面的文字已经全选，按 <b>⌘ + C</b>（Windows 用 <b>Ctrl + C</b>）复制即可。</p>
      <textarea class="input" id="manualCopyBox" rows="9" readonly style="font-size:12px;line-height:1.75">${esc(text)}</textarea>`);
    const box = $('#manualCopyBox');
    if (box) { box.focus(); box.select(); try { box.setSelectionRange(0, text.length); } catch (e) {} }
  }

  /* ================================================================
     路由 / 启动
     ================================================================ */
  const RENDERERS = {
    dash: renderDash, script: renderScript, calendar: renderCalendar, survey: renderSurvey,
    flow: renderFlow, songs: renderSongs, sandbox: renderSandbox, player: renderPlayer,
    prompter: renderPrompter, templates: renderTemplates
  };

  function render() {
    const pg = PAGES[state.view] || ['', ''];
    $('#pgTitle').textContent = pg[0];
    $('#pgSub').textContent = pg[1];
    try {
      topMeta();
    } catch (e) { console.error('topMeta', e); }
    try {
      (RENDERERS[state.view] || renderDash)();
    } catch (e) {
      console.error('render:' + state.view, e);
      const box = $('#view');
      if (box) {
        box.innerHTML = `
          <div class="card" style="border-color:#E1B7B0;background:#FDF6F4">
            <h3 style="margin:0 0 8px;font-family:var(--serif)">这个视图渲染出错了</h3>
            <p class="small" style="margin:0 0 10px;line-height:1.75">
              其他模块不受影响，可以直接切换。若要恢复，可在下方清空本机缓存后刷新。
            </p>
            <pre class="tiny" style="white-space:pre-wrap;background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px;color:#8C4A3F;margin:0 0 12px">${esc(String(e && e.message || e))}</pre>
            <button class="btn sm" id="errReset">清空缓存并刷新</button>
          </div>`;
        const b = $('#errReset');
        if (b) b.onclick = () => { try { localStorage.removeItem(LS_KEY); } catch (e2) {} location.reload(); };
      }
    }
  }

  /* 新人打开的问卷页：?survey=场次id */
  const guestId = (function () {
    const q = String(location.search || '').replace(/^\?/, '');
    if (!q) return '';
    const m = q.match(/(?:^|&)survey=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  })();
  const guestData = (function () {
    const q = String(location.search || '').replace(/^\?/, '');
    if (!q) return '';
    const m = q.match(/(?:^|&)d=([^&]+)/);
    return m ? m[1] : '';
  })();

  /* 遥控页（手机用）：#remote */
  if ((location.hash || '').replace('#', '') === 'remote') {
    try { renderRemote(); } catch (e) {
      console.error('remote', e);
      document.body.innerHTML = '<p style="padding:40px;font-size:14px">遥控页打开失败：' + esc(String(e && e.message || e)) + '</p>';
    }
    return;
  }

  if (guestId) {
    try {
      renderGuest(guestId, guestData);
    } catch (e) {
      console.error('guest', e);
      document.body.innerHTML = '<p style="padding:40px;font-size:14px;line-height:1.8">问卷页打开失败：' + esc(String(e && e.message || e)) + '</p>';
    }
    return;
  }

  try {
    renderShell();
    state.selDate = curW().date;
    const hashView = (location.hash || '').replace('#', '');
    if (PAGES[hashView]) state.view = hashView;
    render();
    try { history.replaceState({ v: state.view }, '', '#' + state.view); } catch (e) { }
    /* 第一次打开：先问一句「看演示还是空白」，别直接把人扔进别人的客户名单 */
    if (FIRST_RUN && STORE.available() && !STORE.get(ONB_KEY)) showWelcome();
  } catch (e) {
    console.error('boot', e);
    if (window.__showFatal) window.__showFatal(e);
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && state.view === 'script') $('#btnGen') && $('#btnGen').click();
  });

  /* 前进 / 后退要能切视图，别让浏览器退出去 */
  window.addEventListener('popstate', () => {
    const hv = (location.hash || '').replace('#', '') || 'dash';
    if (!PAGES[hv] || hv === state.view) return;
    go(hv, 'none');
  });

  /* 窗口变宽变窄时走位图要按新宽度重画，否则 canvas 被拉变形 */
  let planRsT = null;
  window.addEventListener('resize', () => {
    if (!$('#planCv')) return;
    clearTimeout(planRsT);
    planRsT = setTimeout(() => {
      const w = curW(); if (!w) return;
      drawPlan(w, flowTimeline(w), state.play.t);
    }, 140);
  });

  /* 把 config.js 里的品牌名、印章字填进侧栏。
     放在这里而不是开头，是因为要等 body 解析完才有那几个节点。 */
  if (CFG.applyBrandDOM) CFG.applyBrandDOM();

  /* 给自动化冒烟和现场排查留的口子（只读 DB，改数据还是走界面） */
  window.ZHILI = {
    go: go,
    view: () => state.view,
    get db() { return DB; },
    curW: () => curW(),
    ocState: () => ocState(),
    surveyLink: () => surveyLink(curW()),
    version: DB_VERSION,
    /* 测试/自检用：按当前场次与表单拼一次云端 prompt，不真的发请求 */
    buildPrompt: function () {
      const w = curW(), oc = ocState();
      const cat = catOf(oc), scene = sceneOf(oc, cat);
      if (!oc.form) oc.form = fillForm(w, scene);
      const segs = (oc.form.flow ? resolveSegs(scene, oc.form.flow) : scene.segs)
        .map(k => Engine.SEGMENTS.find(s => s.key === k)).filter(Boolean);
      return ocCloudPrompt(w, scene, oc.form, segs, oc.tone || scene.tones[0]);
    }
  };
})();
