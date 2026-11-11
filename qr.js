/* ================================================================
   主持工作台 · 二维码编码器（极简、纯 JS、无外部依赖）
   字节模式（UTF-8）· 纠错等级 L · 版本 1–10（最多约 270 字节）
   输出真正可被手机扫的二维码矩阵 / canvas
   ================================================================ */
(function (root) {
  'use strict';

  /* ---------- GF(256) ---------- */
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /* ---------- 版本容量表（纠错 L） ---------- */
  const EC_L = {
    1: { ec: 7, groups: [[1, 19]] },
    2: { ec: 10, groups: [[1, 34]] },
    3: { ec: 15, groups: [[1, 55]] },
    4: { ec: 20, groups: [[1, 80]] },
    5: { ec: 26, groups: [[1, 108]] },
    6: { ec: 18, groups: [[2, 68]] },
    7: { ec: 20, groups: [[2, 78]] },
    8: { ec: 24, groups: [[2, 97]] },
    9: { ec: 30, groups: [[2, 116]] },
    10: { ec: 18, groups: [[2, 68], [2, 69]] }
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };
  const dataBytes = (v) => EC_L[v].groups.reduce((s, g) => s + g[0] * g[1], 0);

  /* ---------- BCH（格式信息 / 版本信息） ---------- */
  const G15 = 0x537, G15_MASK = 0x5412, G18 = 0x1F25;
  function bitLen(d) { let n = 0; while (d !== 0) { n++; d >>>= 1; } return n; }
  function bch15(data) {
    let d = data << 10;
    while (bitLen(d) - bitLen(G15) >= 0) d ^= G15 << (bitLen(d) - bitLen(G15));
    return ((data << 10) | d) ^ G15_MASK;
  }
  function bch18(v) {
    let d = v << 12;
    while (bitLen(d) - bitLen(G18) >= 0) d ^= G18 << (bitLen(d) - bitLen(G18));
    return (v << 12) | d;
  }

  /* ---------- Reed-Solomon ---------- */
  function genPoly(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); }
      g = ng;
    }
    return g;
  }
  function rs(data, ecLen) {
    const g = genPoly(ecLen);
    const buf = new Uint8Array(data.length + ecLen);
    buf.set(data);
    for (let i = 0; i < data.length; i++) {
      const f = buf[i];
      if (!f) continue;
      for (let j = 0; j < g.length; j++) buf[i + j] ^= mul(g[j], f);
    }
    return buf.slice(data.length);
  }

  /* ---------- 编码为码字流 ---------- */
  function utf8(str) {
    if (root.TextEncoder) return Array.from(new root.TextEncoder().encode(String(str)));
    const s = unescape(encodeURIComponent(String(str)));
    return Array.from(s).map(c => c.charCodeAt(0));
  }

  function pickVersion(len) {
    for (let v = 1; v <= 10; v++) {
      const need = 4 + (v < 10 ? 8 : 16) + len * 8;
      if (need <= dataBytes(v) * 8) return v;
    }
    return 0;
  }

  function codewords(bytes, v) {
    const bits = [];
    const push = (num, n) => { for (let i = n - 1; i >= 0; i--) bits.push((num >> i) & 1); };
    push(4, 4);                                  /* 字节模式 */
    push(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(b => push(b, 8));
    const total = dataBytes(v) * 8;
    for (let i = 0; i < 4 && bits.length < total; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const dc = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      dc.push(b);
    }
    const pad = [0xEC, 0x11];
    let k = 0;
    while (dc.length < total / 8) dc.push(pad[k++ % 2]);

    /* 分块 + 纠错 + 交织 */
    const conf = EC_L[v];
    const blocks = [];
    let idx = 0;
    conf.groups.forEach(([n, len]) => {
      for (let i = 0; i < n; i++) {
        const d = dc.slice(idx, idx + len); idx += len;
        blocks.push({ d: d, e: rs(d, conf.ec) });
      }
    });
    const out = [];
    const maxD = Math.max.apply(null, blocks.map(b => b.d.length));
    for (let i = 0; i < maxD; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]); });
    for (let i = 0; i < conf.ec; i++) blocks.forEach(b => out.push(b.e[i]));
    return out;
  }

  /* ---------- 矩阵 ---------- */
  function maskOn(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  }

  function baseMatrix(v) {
    const size = v * 4 + 17;
    const m = [], fn = [];
    for (let i = 0; i < size; i++) { m.push(new Uint8Array(size)); fn.push(new Uint8Array(size)); }
    const put = (x, y, dark) => { if (x < 0 || y < 0 || x >= size || y >= size) return; m[y][x] = dark ? 1 : 0; fn[y][x] = 1; };
    const finder = (ox, oy) => {
      for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) {
        const inner = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        put(ox + x, oy + y, inner !== 2 && inner !== 4);
      }
    };
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
    for (let i = 8; i < size - 8; i++) { put(i, 6, i % 2 === 0); put(6, i, i % 2 === 0); }
    const pos = ALIGN[v];
    pos.forEach(cy => pos.forEach(cx => {
      if ((cy < 9 && cx < 9) || (cy < 9 && cx > size - 10) || (cy > size - 10 && cx < 9)) return;
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
        put(cx + x, cy + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
      }
    }));
    /* 预留格式信息 / 版本信息区域 */
    for (let i = 0; i < 9; i++) { fn[8][i] = 1; fn[i][8] = 1; }
    for (let i = 0; i < 8; i++) { fn[size - 1 - i][8] = 1; fn[8][size - 1 - i] = 1; }
    if (v >= 7) {
      for (let i = 0; i < 18; i++) {
        fn[Math.floor(i / 3)][size - 11 + (i % 3)] = 1;
        fn[size - 11 + (i % 3)][Math.floor(i / 3)] = 1;
      }
    }
    m[size - 8][8] = 1;
    return { size: size, m: m, fn: fn };
  }

  function placeData(b, words) {
    const size = b.size, m = b.m, fn = b.fn;
    let bit = 0;
    const total = words.length * 8;
    const at = (i) => (i < total) ? ((words[i >> 3] >> (7 - (i & 7))) & 1) : 0;
    let dir = -1, row = size - 1;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (let c = 0; c < 2; c++) {
          const x = col - c;
          if (!fn[row][x]) {
            const dark = at(bit) ^ (maskOn(b.mask, row, x) ? 1 : 0);
            m[row][x] = dark;
            bit++;
          }
        }
        row += dir;
        if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
      }
    }
  }

  function placeFormat(b, mask) {
    const size = b.size, m = b.m;
    const bits = bch15((1 << 3) | mask);   /* 纠错 L = 01 */
    for (let i = 0; i < 15; i++) {
      const v = (bits >> i) & 1;
      if (i < 6) m[i][8] = v;
      else if (i < 8) m[i + 1][8] = v;
      else m[size - 15 + i][8] = v;
    }
    for (let i = 0; i < 15; i++) {
      const v = (bits >> i) & 1;
      if (i < 8) m[8][size - i - 1] = v;
      else if (i < 9) m[8][15 - i] = v;
      else m[8][15 - i - 1] = v;
    }
    m[size - 8][8] = 1;
  }

  function placeVersion(b, v) {
    const size = b.size, m = b.m;
    const bits = bch18(v);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      m[Math.floor(i / 3)][size - 11 + (i % 3)] = bit;
      m[size - 11 + (i % 3)][Math.floor(i / 3)] = bit;
    }
  }

  /* ---------- 掩码评分（ISO 四项罚分） ---------- */
  function penalty(m, size) {
    let p = 0, dark = 0;
    const run = (get) => {
      for (let a = 0; a < size; a++) {
        let last = -1, len = 0;
        for (let b = 0; b < size; b++) {
          const v = get(a, b);
          if (v === last) { len++; }
          else { if (len >= 5) p += 3 + (len - 5); last = v; len = 1; }
        }
        if (len >= 5) p += 3 + (len - 5);
      }
    };
    run((a, b) => m[a][b]);
    run((a, b) => m[b][a]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) p += 3;
    }
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const hit = (get) => {
      for (let a = 0; a < size; a++) {
        for (let b = 0; b <= size - 11; b++) {
          let ok1 = true, ok2 = true;
          for (let k = 0; k < 11; k++) {
            const v = get(a, b + k);
            if (v !== pat1[k]) ok1 = false;
            if (v !== pat2[k]) ok2 = false;
          }
          if (ok1) p += 40;
          if (ok2) p += 40;
        }
      }
    };
    hit((a, b) => m[a][b]);
    hit((a, b) => m[b][a]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) dark++;
    const ratio = dark * 100 / (size * size);
    p += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return p;
  }

  function matrix(text) {
    const bytes = utf8(text);
    const v = pickVersion(bytes.length);
    if (!v) throw new Error('内容太长，二维码装不下（上限约 270 字节）');
    const words = codewords(bytes, v);
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const b = baseMatrix(v);
      b.mask = mask;
      placeData(b, words);
      placeFormat(b, mask);
      if (v >= 7) placeVersion(b, v);
      const score = penalty(b.m, b.size);
      if (!best || score < best.score) best = { m: b.m, size: b.size, score: score, mask: mask, version: v };
    }
    return best;
  }

  /* ---------- 画到 canvas ---------- */
  function draw(canvas, text, opt) {
    opt = opt || {};
    const q = matrix(text);
    const quiet = opt.quiet == null ? 4 : opt.quiet;
    const n = q.size;
    const target = opt.size || 220;
    const px = Math.max(1, Math.floor(target / (n + quiet * 2)));
    const side = (n + quiet * 2) * px;
    canvas.width = side; canvas.height = side;
    canvas.style.width = side + 'px'; canvas.style.height = side + 'px';
    const g = canvas.getContext('2d');
    g.fillStyle = opt.light || '#fff';
    g.fillRect(0, 0, side, side);
    g.fillStyle = opt.dark || '#1B1815';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (q.m[y][x]) g.fillRect((x + quiet) * px, (y + quiet) * px, px, px);
    }
    return q;
  }

  const API = { matrix: matrix, draw: draw, version: (t) => matrix(t).version };
  if (typeof module === 'object' && module.exports) module.exports = API;
  root.QR = API;
})(typeof window !== 'undefined' ? window : globalThis);
