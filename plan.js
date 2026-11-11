/* ============================================================
   主持工作台 · 现场走位示意图（线稿场地 + 彩色人物）
   逻辑坐标 1000 × 620，调用方自行 scale。
   暴露 window.Plan：
     keyFor(name)            环节名 → 走位脚本 key
     choreo(rows)            生成逐环节每角色路径（自动衔接上一环节落点）
     locate(rows, t)         时间(分钟) → {idx, prog}
     drawInto(g, opts)       在已设好 transform 的 ctx 上画 1000×620
     render(cv, w, rows, t)  页面 canvas 渲染（处理 dpr）
     poster(w, rows, brand)  走位长图 canvas
     legendHTML()            图例
   ============================================================ */
(function () {
  'use strict';

  const LW = 1000, LH = 620;

  /* 品牌与主色都从 config.js 来。plan.js 单独打开时用兜底值。 */
  const CFG = window.WB || {};
  const BRAND = (CFG.brand && CFG.brand.name) || '主持工作台';
  const C = { wine: (CFG.color ? CFG.color('wine') : '#8C3B47') };

  /* 角色表默认值。config.js 里给了 cast 就用它——
     这样「加一个伴郎」只要在 config 里加一行，不用动这里的代码。 */
  const CAST_DEFAULT = [
    { id: 'host',    label: '主持人',   color: '#B08A52', shape: 'suit' },
    { id: 'groom',   label: '新郎',     color: '#3E6C99', shape: 'suit' },
    { id: 'bride',   label: '新娘',     color: '#C05B7B', shape: 'gown' },
    { id: 'father',  label: '新娘父亲', color: '#6B7F8C', shape: 'suit' },
    { id: 'mother',  label: '新娘母亲', color: '#9B7FA6', shape: 'gown' },
    { id: 'gfather', label: '新郎父亲', color: '#7A8C6B', shape: 'suit' },
    { id: 'gmother', label: '新郎母亲', color: '#A68A7F', shape: 'gown' },
    { id: 'bestman', label: '伴郎',     color: '#4E9A8F', shape: 'suit' },
    { id: 'maid',    label: '伴娘',     color: '#D99A4E', shape: 'gown' }
  ];
  const CAST = (CFG.cast && CFG.cast.length) ? CFG.cast : CAST_DEFAULT;

  /* 初始站位（暖场时） */
  const HOME = {
    host:    [500, 82],
    groom:   [478, 584],
    bride:   [522, 584],
    father:  [562, 584],
    mother:  [214, 104],
    gfather: [768, 72],
    gmother: [768, 108],
    bestman: [398, 556],
    maid:    [604, 556]
  };

  /* 环节走位：只写有移动的，其余自动保持上一环节落点 */
  const MOVES = {
    warm: {},
    open: {},
    groom: {
      groom: [[478, 584], [500, 440], [500, 250], [472, 96]],
      host:  [[500, 82], [612, 82]]
    },
    bride: {
      bride:  [[522, 584], [522, 440], [508, 412]],
      father: [[562, 584], [548, 440], [472, 416], [320, 300], [214, 72]],
      groom:  [[472, 96], [486, 250], [488, 402]]
    },
    together: {
      groom: [[488, 402], [484, 250], [478, 96]],
      bride: [[508, 412], [516, 250], [522, 96]]
    },
    vows: {},
    rings: {
      bestman: [[398, 556], [428, 300], [440, 130], [452, 106]],
      maid:    [[604, 556], [572, 300], [560, 130], [548, 106]]
    },
    kiss: {
      bestman: [[452, 106], [398, 92]],
      maid:    [[548, 106], [602, 92]]
    },
    parents: {
      father:  [[214, 72], [330, 84], [398, 76]],
      mother:  [[214, 104], [330, 116], [398, 112]],
      gfather: [[768, 72], [672, 84], [602, 76]],
      gmother: [[768, 108], [672, 116], [602, 112]],
      host:    [[612, 82], [664, 128]]
    },
    bouquet: {
      bride: [[522, 96], [516, 152]],
      maid:  [[602, 92], [566, 260], [542, 330]]
    },
    toast: {
      bride: [[516, 152], [522, 96]],
      maid:  [[542, 330], [566, 260], [602, 92]]
    },
    end: {
      groom:   [[478, 96], [484, 250], [490, 440], [478, 576]],
      bride:   [[522, 96], [516, 250], [510, 440], [522, 576]],
      host:    [[664, 128], [500, 82]],
      bestman: [[398, 92], [420, 300], [398, 556]],
      maid:    [[602, 92], [580, 300], [604, 556]]
    }
  };

  const RULES = [
    ['warm',     ['暖场', 'warm']],
    ['open',     ['开场', 'open']],
    ['groom',    ['新郎']],
    ['bride',    ['新娘', '交接']],
    ['together', ['共同', '携手', '入场']],
    ['vows',     ['誓言', '誓词', '承诺', 'vow']],
    ['rings',    ['戒指', '指环', 'ring']],
    ['kiss',     ['拥吻', '证婚', 'kiss']],
    ['parents',  ['父母', '敬茶', '感恩', '改口']],
    ['bouquet',  ['手捧', '捧花', 'bouquet']],
    ['toast',    ['交杯', '举杯', '敬酒', 'toast']],
    ['end',      ['礼成', '送客', '退场', 'end']]
  ];

  function keyFor(name) {
    const s = String(name == null ? '' : name).replace(/[\s·・•.,，、/]+/g, '');
    for (let i = 0; i < RULES.length; i++) {
      if (RULES[i][1].some(k => s.indexOf(k) >= 0)) return RULES[i][0];
    }
    return 'hold';
  }

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  /* 逐环节生成路径，起点自动衔接上一环节落点（用户改顺序/自定义环节也不乱） */
  function choreo(rows) {
    const seq = [];
    let prev = {};
    CAST.forEach(c => { prev[c.id] = HOME[c.id].slice(); });
    (rows || []).forEach(r => {
      const key = keyFor(r && r.name);
      const def = MOVES[key] || {};
      const paths = {};
      CAST.forEach(c => {
        let path = def[c.id] ? def[c.id].map(p => p.slice()) : [prev[c.id].slice()];
        if (dist(path[0], prev[c.id]) > 2) path.unshift(prev[c.id].slice());
        if (path.length === 1) path.push(path[0].slice());
        paths[c.id] = path;
        prev[c.id] = path[path.length - 1].slice();
      });
      seq.push({ key: key, paths: paths });
    });
    return seq;
  }

  function locate(rows, t) {
    let acc = 0, idx = 0;
    (rows || []).forEach((r, i) => { if (t >= acc) idx = i; acc += r.dur; });
    const r = rows[idx];
    const start = rows.slice(0, idx).reduce((s, x) => s + x.dur, 0);
    const prog = r && r.dur ? Math.max(0, Math.min(1, (t - start) / r.dur)) : 0;
    return { idx: idx, prog: prog };
  }

  function posOn(path, prog) {
    if (!path || !path.length) return [0, 0];
    if (path.length === 1 || prog <= 0) return path[0].slice();
    if (prog >= 1) return path[path.length - 1].slice();
    let total = 0;
    const segs = [];
    for (let i = 1; i < path.length; i++) { const d = dist(path[i - 1], path[i]); segs.push(d); total += d; }
    let want = total * prog;
    for (let i = 0; i < segs.length; i++) {
      if (want <= segs[i] || i === segs.length - 1) {
        const k = segs[i] ? Math.min(1, want / segs[i]) : 0;
        const a = path[i], b = path[i + 1];
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      }
      want -= segs[i];
    }
    return path[path.length - 1].slice();
  }

  /* ---------------- 场地线稿 ---------------- */
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function table(g, x, y, r, label) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(176,138,82,.11)'; g.fill();
    g.strokeStyle = 'rgba(140,110,80,.58)'; g.lineWidth = 1.4; g.stroke();
    g.beginPath(); g.arc(x, y, r * 0.45, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(140,110,80,.22)'; g.stroke();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.3;
      g.beginPath(); g.arc(x + Math.cos(a) * (r + 12), y + Math.sin(a) * (r + 12), 4.5, 0, Math.PI * 2);
      g.fillStyle = 'rgba(140,110,80,.28)'; g.fill();
    }
    if (label) {
      g.fillStyle = 'rgba(110,95,80,.6)'; g.font = '11px -apple-system,sans-serif';
      g.textAlign = 'center'; g.fillText(label, x, y + 4); g.textAlign = 'left';
    }
  }

  function venue(g, ink) {
    const line = ink || 'rgba(90,75,60,.5)';
    /* 外框 */
    rr(g, 8, 8, LW - 16, LH - 16, 14);
    g.strokeStyle = 'rgba(140,110,80,.28)'; g.lineWidth = 1.2; g.stroke();

    /* 舞台 */
    rr(g, 330, 36, 340, 92, 10);
    g.fillStyle = 'rgba(176,138,82,.18)'; g.fill();
    g.strokeStyle = line; g.lineWidth = 1.6; g.stroke();
    g.fillStyle = 'rgba(110,90,70,.75)'; g.font = '600 15px "Songti SC",serif';
    g.textAlign = 'center'; g.fillText('舞 台', 500, 62); g.textAlign = 'left';

    /* T 台 */
    rr(g, 462, 128, 76, 278, 6);
    g.fillStyle = 'rgba(192,91,123,.06)'; g.fill();
    g.strokeStyle = 'rgba(140,110,80,.4)'; g.setLineDash([6, 5]); g.stroke(); g.setLineDash([]);
    g.save(); g.translate(500, 268); g.rotate(-Math.PI / 2);
    g.fillStyle = 'rgba(110,90,70,.45)'; g.font = '12px -apple-system,sans-serif';
    g.textAlign = 'center'; g.fillText('T 台', 0, 4); g.restore(); g.textAlign = 'left';

    /* 交接区 */
    g.beginPath(); g.arc(500, 420, 40, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(192,91,123,.4)'; g.setLineDash([4, 4]); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(150,90,105,.55)'; g.font = '11px -apple-system,sans-serif';
    g.textAlign = 'center'; g.fillText('交接区', 500, 478); g.textAlign = 'left';

    /* 宾客圆桌 */
    table(g, 150, 200, 44, '宾客席');
    table(g, 150, 340, 44, '宾客席');
    table(g, 150, 478, 44, '宾客席');
    table(g, 850, 200, 44, '宾客席');
    table(g, 850, 340, 44, '宾客席');
    table(g, 850, 478, 44, '宾客席');

    /* 双方父母席 */
    table(g, 214, 82, 30, '');
    g.fillStyle = 'rgba(110,95,80,.6)'; g.font = '11px -apple-system,sans-serif';
    g.textAlign = 'center'; g.fillText('新娘父母', 214, 140);
    table(g, 786, 82, 30, '');
    g.fillText('新郎父母', 786, 140); g.textAlign = 'left';

    /* 入口 */
    g.strokeStyle = line; g.lineWidth = 2;
    g.beginPath(); g.moveTo(430, 596); g.lineTo(470, 596); g.moveTo(530, 596); g.lineTo(570, 596); g.stroke();
    g.fillStyle = 'rgba(110,90,70,.7)'; g.font = '12px -apple-system,sans-serif';
    g.textAlign = 'center'; g.fillText('入 口', 500, 604); g.textAlign = 'left';
    g.strokeStyle = 'rgba(140,110,80,.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(470, 596); g.lineTo(452, 560); g.moveTo(530, 596); g.lineTo(548, 560); g.stroke();
  }

  /* ---------------- 人物 ---------------- */
  /* 分两趟画：先画所有身体，再统一画名字，避免后画的人盖住前一个人的名字 */
  function person(g, x, y, c, opts) {
    const o = opts || {};
    const R = o.small ? 0.72 : 1;
    if (!o.labelOnly) {
      g.save(); g.translate(x, y); g.scale(R, R);
      /* 身体 */
      g.fillStyle = c.color;
      if (c.shape === 'gown') {
        g.beginPath(); g.moveTo(0, -2); g.lineTo(11, 16); g.lineTo(-11, 16); g.closePath(); g.fill();
      } else {
        rr(g, -7, -2, 14, 18, 4); g.fill();
      }
      /* 头 */
      g.beginPath(); g.arc(0, -11, 7, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(0, -11, 7, 0, Math.PI * 2); g.stroke();
      g.restore();
    }
    if (o.bodyOnly) return;
    /* 名字（用绝对坐标画，遇到重叠就往下挪，避免字叠字） */
    const fs = 11 * R;
    g.font = `600 ${fs}px -apple-system,sans-serif`;
    const tw = g.measureText(c.label).width;
    const pw = tw + 10 * R, ph = 16 * R;
    let lx = x - pw / 2, ly = y + 20 * R;
    const taken = o.taken;
    if (taken) {
      const hit = (bx, by) => taken.some(r => !(bx + pw < r.x || bx > r.x + r.w || by + ph < r.y || by > r.y + r.h));
      let guard = 0;
      while (hit(lx, ly) && guard++ < 5) ly += ph + 3;
      taken.push({ x: lx, y: ly, w: pw, h: ph });
    }
    g.fillStyle = 'rgba(255,253,249,.94)';
    rr(g, lx, ly, pw, ph, 4 * R); g.fill();
    g.fillStyle = '#4A3F35'; g.textAlign = 'center';
    g.fillText(c.label, lx + pw / 2, ly + ph * 0.71);
    g.textAlign = 'left';
  }

  function trail(g, path, color, prog) {
    if (!path || path.length < 2) return;
    let moved = false;
    for (let i = 1; i < path.length; i++) if (dist(path[i - 1], path[i]) > 2) { moved = true; break; }
    if (!moved) return;
    g.save();
    g.strokeStyle = color; g.globalAlpha = 0.55; g.lineWidth = 1.6; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) g.lineTo(path[i][0], path[i][1]);
    g.stroke(); g.setLineDash([]);
    /* 箭头：画在路径末段 */
    const a = path[path.length - 2], b = path[path.length - 1];
    if (dist(a, b) > 4) {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      g.globalAlpha = 0.8; g.fillStyle = color;
      g.save(); g.translate(b[0], b[1]); g.rotate(ang);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-9, -5); g.lineTo(-9, 5); g.closePath(); g.fill();
      g.restore();
    }
    g.restore();
  }

  /* opts: {rows, t, seq, title, showAllTrails, small, bg} */
  function drawInto(g, opts) {
    const o = opts || {};
    if (o.bg !== false) { g.fillStyle = o.bg || '#FDFAF4'; g.fillRect(0, 0, LW, LH); }
    venue(g);
    const rows = o.rows || [], seq = o.seq || choreo(rows);
    const loc = locate(rows, o.t || 0);
    const step = seq[loc.idx];
    if (!step) return;
    const cur = rows[loc.idx];

    if (o.showAllTrails) {
      seq.forEach((s, i) => {
        if (i === loc.idx) return;
        CAST.forEach(c => {
          const p = s.paths[c.id];
          g.save(); g.globalAlpha = 0.16; trail(g, p, c.color, 1); g.restore();
        });
      });
    }
    CAST.forEach(c => trail(g, step.paths[c.id], c.color, loc.prog));
    const pts = CAST.map(c => [c, posOn(step.paths[c.id], loc.prog)]);
    pts.forEach(([c, p]) => person(g, p[0], p[1], c, { small: o.small, bodyOnly: true }));
    const taken = [];
    pts.forEach(([c, p]) => person(g, p[0], p[1], c, { small: o.small, labelOnly: true, taken: taken }));

    if (cur && o.title !== false) {
      g.fillStyle = 'rgba(140,59,71,.9)'; g.font = '600 15px "Songti SC",serif';
      g.fillText(`${loc.idx + 1}. ${cur.name}`, 26, 40);
      g.fillStyle = 'rgba(110,95,80,.6)'; g.font = '11.5px -apple-system,sans-serif';
      g.fillText(`${cur.from || ''} — ${cur.to || ''} · ${cur.dur} 分钟`, 26, 60);
    }
  }

  function render(cv, w, rows, t) {
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = cv.clientWidth || cv.parentNode.clientWidth || 900;
    const scale = cssW / LW;
    const H = Math.round(LH * scale);
    if (cv.width !== Math.round(cssW * dpr)) { cv.width = Math.round(cssW * dpr); cv.height = Math.round(H * dpr); }
    cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    drawInto(g, { rows: rows, t: t, seq: choreo(rows) });
  }

  function legendHTML() {
    return CAST.map(c =>
      `<span class="pl-lg"><i style="background:${c.color}"></i>${c.label}</span>`).join('');
  }

  /* ---------------- 走位长图 ---------------- */
  function poster(w, rows, brand) {
    const seq = choreo(rows);
    /* 只把有走位脚本或有实际位移的环节拆小图 */
    const cells = [];
    rows.forEach((r, i) => {
      const s = seq[i];
      const moved = CAST.some(c => {
        const p = s.paths[c.id];
        for (let k = 1; k < p.length; k++) if (dist(p[k - 1], p[k]) > 4) return true;
        return false;
      });
      if (moved) cells.push(i);
    });
    if (!cells.length) cells.push(0);

    const W = 1080, pad = 40, colW = (W - pad * 2 - 24) / 2;
    const cellH = Math.round(colW * LH / LW) + 46;
    const ovH = Math.round((W - pad * 2) * LH / LW);
    const H = 216 + ovH + 64 + Math.ceil(cells.length / 2) * (cellH + 20) + 96;
    const dpr = 2;
    const cv = document.createElement('canvas');
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);

    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#FCF8F1'); grad.addColorStop(1, '#F5EEE2');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);

    g.fillStyle = C.wine; g.font = '600 13px "Songti SC",serif';
    g.fillText(BRAND + ' · 现场走位示意图', pad, 52);
    g.fillStyle = '#1B1815'; g.font = '600 32px "Songti SC",serif';
    g.fillText(`${w.couple.bride} & ${w.couple.groom}`, pad, 100);
    g.fillStyle = '#8B8175'; g.font = '13px -apple-system,sans-serif';
    g.fillText(`${w.date || ''} ${w.time || ''} · ${w.hotel || ''} · 示意图非按比例，箭头为行进方向`, pad, 128);

    /* 图例 */
    let lx = pad;
    g.font = '12px -apple-system,sans-serif';
    CAST.forEach(c => {
      g.fillStyle = c.color; g.beginPath(); g.arc(lx + 6, 158, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4A3F35'; g.fillText(c.label, lx + 18, 163);
      lx += 18 + g.measureText(c.label).width + 20;
    });

    /* 总览图（含所有轨迹淡线 + 开场站位） */
    g.fillStyle = '#4A3F35'; g.font = '600 15px "Songti SC",serif';
    g.fillText('总览 · 开场站位与全流程路线', pad, 198);
    g.fillStyle = '#A39A8D'; g.font = '11px -apple-system,sans-serif';
    g.fillText('淡色虚线为其它环节的走位，深色为开场位置', pad + 216, 198);
    g.save(); g.translate(pad, 216); g.scale((W - pad * 2) / LW, (W - pad * 2) / LW);
    rr(g, 0, 0, LW, LH, 10); g.fillStyle = '#FDFAF4'; g.fill();
    g.strokeStyle = 'rgba(140,110,80,.3)'; g.lineWidth = 1; g.stroke();
    drawInto(g, { rows: rows, t: 0, seq: seq, showAllTrails: true, title: false, bg: false });
    g.restore();

    /* 分环节小图 */
    let y = 216 + ovH + 40;
    cells.forEach((ri, n) => {
      const col = n % 2, row = Math.floor(n / 2);
      const x = pad + col * (colW + 24);
      const yy = y + row * (cellH + 20);
      const r = rows[ri];
      const start = rows.slice(0, ri).reduce((s, a) => s + a.dur, 0);
      g.fillStyle = C.wine; g.font = '600 14px "Songti SC",serif';
      g.fillText(`${ri + 1}. ${r.name}`, x, yy);
      g.fillStyle = '#8B8175'; g.font = '11.5px -apple-system,sans-serif';
      g.fillText(`${r.from || ''} · ${r.dur} 分钟`, x + colW - 130, yy);
      g.save(); g.translate(x, yy + 14); g.scale(colW / LW, colW / LW);
      rr(g, 0, 0, LW, LH, 10); g.fillStyle = '#FDFAF4'; g.fill();
      g.strokeStyle = 'rgba(140,110,80,.25)'; g.lineWidth = 1.2; g.stroke();
      drawInto(g, { rows: rows, t: start + r.dur, seq: seq, title: false, small: true, bg: false });
      g.restore();
    });

    g.fillStyle = '#A39A8D'; g.font = '11.5px -apple-system,sans-serif';
    g.fillText('给新人看：每个环节谁从哪里走到哪里。颜色对应上方图例，虚线与箭头为走位路线。', pad, H - 52);
    if (brand) { g.fillStyle = '#B3AA9C'; g.font = '10.5px -apple-system,sans-serif'; g.fillText(brand, pad, H - 28); }
    return cv;
  }

  window.Plan = {
    LW: LW, LH: LH, CAST: CAST, keyFor: keyFor, choreo: choreo, locate: locate,
    posOn: posOn, drawInto: drawInto, render: render, poster: poster, legendHTML: legendHTML
  };
})();
