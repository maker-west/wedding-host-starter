/* ================================================================
   主持工作台 · 音频库 AudioLib
   - 音频文件存 IndexedDB（localStorage 装不下二进制）
   - 解码出波形峰值，列表里直接画真实波形
   - 按「进点 / 出点 / 淡入 / 淡出 / 音量」裁剪，导出 16bit WAV
   - 不能存（file:// 被限制、隐私模式）时自动退回内存：本会话可用
   ================================================================ */
(function () {
  'use strict';

  var DB_NAME = (window.WB && WB.id) ? ('wb_' + WB.id + '_audio') : 'wb_demo_audio';
  var STORE = 'files';
  var dbPromise = null;
  var mem = {};
  var persistable = true;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try {
        if (!window.indexedDB) { reject(new Error('这台浏览器不支持 IndexedDB')); return; }
        req = window.indexedDB.open(DB_NAME, 1);
      } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('打不开本地音频库')); };
      req.onblocked = function () { reject(new Error('本地音频库被另一个窗口占用')); };
    }).catch(function (e) {
      persistable = false;
      throw e;
    });
    return dbPromise;
  }

  function run(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var req;
        try { req = fn(store); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(req ? req.result : undefined); };
        t.onerror = function () { reject(t.error || new Error('读写失败')); };
        t.onabort = function () { reject(t.error || new Error('写入被中止（可能超出浏览器存储上限）')); };
      });
    }).catch(function (e) {
      persistable = false;
      throw e;
    });
  }

  /* ---------- 存取 ---------- */
  /* 能存进 IndexedDB 就不在内存里留整份文件（音频动辄几 MB）；只缓存轻量的元数据 */
  var metaCache = {};

  function strip(r) {
    return { id: r.id, name: r.name, size: r.size, type: r.type, dur: r.dur, peaks: r.peaks };
  }

  function put(rec) {
    metaCache[rec.id] = strip(rec);
    return run('readwrite', function (s) { return s.put(rec); })
      .then(function () { delete mem[rec.id]; return true; })
      .catch(function () { mem[rec.id] = rec; return false; });
  }

  function get(id) {
    if (mem[id]) return Promise.resolve(mem[id]);
    return run('readonly', function (s) { return s.get(id); })
      .then(function (r) { return r || null; })
      .catch(function () { return null; });
  }

  function meta(id) {
    if (metaCache[id]) return Promise.resolve(metaCache[id]);
    return get(id).then(function (r) {
      if (!r) return null;
      metaCache[id] = strip(r);
      return metaCache[id];
    });
  }

  function del(id) {
    delete mem[id];
    delete metaCache[id];
    if (lastBuf.id === id) { lastBuf = { id: null, buf: null }; }
    return run('readwrite', function (s) { return s.delete(id); }).catch(function () { return null; });
  }

  function used() {
    var n = 0;
    Object.keys(mem).forEach(function (k) { n += (mem[k].size || 0); });
    return n;
  }

  /* ---------- 解码 ---------- */
  var ctx = null;
  var lastBuf = { id: null, buf: null };

  function ac() {
    if (ctx) return ctx;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) throw new Error('这台浏览器不支持音频解码，请用 Chrome / Safari 打开');
    ctx = new C();
    return ctx;
  }

  function decode(blob) {
    return blob.arrayBuffer().then(function (buf) {
      return new Promise(function (resolve, reject) {
        var c = ac();
        var p;
        try {
          p = c.decodeAudioData(buf, resolve, reject);
        } catch (e) { reject(e); return; }
        if (p && p.then) p.then(resolve, reject);
      });
    }).catch(function (e) {
      throw new Error('这个文件解不开（' + (e && e.message ? e.message : '格式不支持') + '），试试 MP3 / WAV / M4A');
    });
  }

  function buffer(id) {
    if (lastBuf.id === id && lastBuf.buf) return Promise.resolve(lastBuf.buf);
    return get(id).then(function (rec) {
      if (!rec || !rec.blob) throw new Error('本地找不到这个音频文件，请重新导入');
      return decode(rec.blob).then(function (b) { lastBuf = { id: id, buf: b }; return b; });
    });
  }

  /* ---------- 波形峰值 ---------- */
  function peaks(buffer, n) {
    n = n || 520;
    var len = buffer.length;
    var chs = Math.min(2, buffer.numberOfChannels);
    var data = [];
    for (var c = 0; c < chs; c++) data.push(buffer.getChannelData(c));
    var out = new Array(n);
    var step = len / n;
    var stride = Math.max(1, Math.floor(step / 1200)); // 每桶最多采样约 1200 点，够画图
    for (var i = 0; i < n; i++) {
      var s0 = Math.floor(i * step);
      var s1 = Math.min(len, Math.floor((i + 1) * step));
      var m = 0;
      for (var j = s0; j < s1; j += stride) {
        for (var k = 0; k < chs; k++) {
          var v = data[k][j];
          if (v < 0) v = -v;
          if (v > m) m = v;
        }
      }
      out[i] = Math.round(Math.min(1, m) * 1000) / 1000;
    }
    return out;
  }

  /* ---------- 导出 WAV ---------- */
  function encodeWav(buffer, opt) {
    opt = opt || {};
    var sr = buffer.sampleRate;
    var dur = buffer.duration;
    var start = Math.max(0, Math.min(dur, opt.start || 0));
    var end = Math.max(start, Math.min(dur, opt.end == null ? dur : opt.end));
    var s0 = Math.floor(start * sr);
    var s1 = Math.floor(end * sr);
    var n = Math.max(0, s1 - s0);
    var chs = Math.min(2, buffer.numberOfChannels);
    var gain = opt.gain == null ? 1 : opt.gain;
    var fi = Math.max(0, (opt.fadeIn || 0) * sr);
    var fo = Math.max(0, (opt.fadeOut || 0) * sr);
    if (fi + fo > n) { var k = n / (fi + fo || 1); fi *= k; fo *= k; }

    var bytes = 44 + n * chs * 2;
    var ab = new ArrayBuffer(bytes);
    var dv = new DataView(ab);
    var str = function (off, s) { for (var i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * chs * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, chs, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * chs * 2, true); dv.setUint16(32, chs * 2, true);
    dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * chs * 2, true);

    var ch = [];
    for (var c = 0; c < chs; c++) ch.push(buffer.getChannelData(c));
    var off = 44;
    for (var i2 = 0; i2 < n; i2++) {
      var env = 1;
      if (fi > 0 && i2 < fi) env *= i2 / fi;
      if (fo > 0 && i2 > n - fo) env *= Math.max(0, (n - i2) / fo);
      for (var c2 = 0; c2 < chs; c2++) {
        var v = ch[c2][s0 + i2] * env * gain;
        if (v > 1) v = 1; else if (v < -1) v = -1;
        dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  /* ---------- 播放（带淡入淡出） ---------- */
  var srcNode = null;
  var gainNode = null;

  function play(buffer, opt, onEnd) {
    stop();
    opt = opt || {};
    var c = ac();
    if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
    var start = Math.max(0, Math.min(buffer.duration, opt.start || 0));
    var end = Math.max(start, Math.min(buffer.duration, opt.end == null ? buffer.duration : opt.end));
    var dur = Math.max(0.02, end - start);
    var gain = opt.gain == null ? 1 : opt.gain;
    var fi = Math.min(opt.fadeIn || 0, dur / 2);
    var fo = Math.min(opt.fadeOut || 0, dur / 2);

    srcNode = c.createBufferSource();
    srcNode.buffer = buffer;
    gainNode = c.createGain();
    var t0 = c.currentTime + 0.02;
    if (fi > 0) {
      gainNode.gain.setValueAtTime(0, t0);
      gainNode.gain.linearRampToValueAtTime(gain, t0 + fi);
    } else {
      gainNode.gain.setValueAtTime(gain, t0);
    }
    if (fo > 0) {
      gainNode.gain.setValueAtTime(gain, t0 + dur - fo);
      gainNode.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    }
    srcNode.connect(gainNode);
    gainNode.connect(c.destination);
    srcNode.onended = function () { if (onEnd) onEnd(); };
    try {
      srcNode.start(t0, start, dur);
    } catch (e) {
      srcNode.start(0, start, dur);
    }
    return t0;
  }

  function stop() {
    if (srcNode) {
      try { srcNode.onended = null; srcNode.stop(); } catch (e) {}
      try { srcNode.disconnect(); } catch (e) {}
      srcNode = null;
    }
    if (gainNode) { try { gainNode.disconnect(); } catch (e) {} gainNode = null; }
  }

  function now() { return ac().currentTime; }

  window.AudioLib = {
    put: put, get: get, meta: meta, del: del, buffer: buffer,
    decode: decode, peaks: peaks, encodeWav: encodeWav,
    play: play, stop: stop, now: now,
    used: used,
    isPersistable: function () { return persistable; },
    support: function () { return !!(window.AudioContext || window.webkitAudioContext); }
  };
})();
