/* ================================================================
   主持工作台 · 大模型（自带 key）
   - 每个使用者填自己的接口地址 / key / 模型名，各付各的费用
   - key 只写本机 localStorage['wb.<id>.llm.v1']：不上传、不进 DB、
     不会出现在「导出备份」里，也不会跟着页面发给别人
   - 直接调 OpenAI 兼容的 POST {base}/chat/completions（SSE 流式）
   ================================================================ */
window.LLM = (function () {
  'use strict';

  const KEY = (window.WB && WB.key) ? WB.key('llm.v1') : 'wb.demo.llm.v1';

  const PRESETS = [
    { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
      models: ['deepseek-chat', 'deepseek-reasoner'], note: '便宜、中文顺，写整篇够用' },
    { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'], note: '需要你的网络能直连' },
    { id: 'moonshot', name: '月之暗面 Kimi', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k'], note: '长文稳' },
    { id: 'zhipu', name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash',
      models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'], note: 'flash 有免费额度' },
    { id: 'siliconflow', name: '硅基流动', base: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen2.5-72B-Instruct',
      models: ['Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3'], note: '一家聚合多家开源模型' },
    { id: 'dashscope', name: '阿里通义百炼', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'], note: '国内直连稳' },
    { id: 'ark', name: '火山方舟', base: 'https://ark.cn-beijing.volces.com/api/v3', model: '',
      models: [], note: '模型名要填「接入点 ID」（ep- 开头）' },
    { id: 'ollama', name: '本机 Ollama', base: 'http://localhost:11434/v1', model: 'qwen2.5:7b',
      models: ['qwen2.5:7b', 'qwen2.5:14b', 'llama3.1:8b'], note: '完全离线；启动时要设 OLLAMA_ORIGINS=*' }
  ];

  let lastErr = null;

  const isLocalHost = (b) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?=[:/]|$)/i.test(String(b || ''));

  /* 地址容错：补协议、去尾斜杠、粘了完整 /chat/completions 也认、只给域名时补 /v1 */
  function normBase(b) {
    let s = String(b || '').trim().replace(/\s+/g, '');
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    s = s.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
    try {
      const u = new URL(s);
      if (!u.pathname || u.pathname === '/') s = u.origin + '/v1';
    } catch (e) { }
    return s;
  }

  function read() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { c = {}; }
    return {
      preset: String(c.preset || ''),
      base: String(c.base || '').trim(),
      key: String(c.key || '').trim(),
      model: String(c.model || '').trim(),
      temp: (typeof c.temp === 'number' && c.temp >= 0 && c.temp <= 2) ? c.temp : null
    };
  }

  function save(patch) {
    const next = Object.assign(read(), patch || {});
    next.base = normBase(next.base);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { }
    return read();
  }

  function clear() { try { localStorage.removeItem(KEY); } catch (e) { } }

  function missing(c) {
    c = c || read();
    const out = [];
    if (!c.base) out.push('接口地址');
    if (!c.key && !isLocalHost(c.base)) out.push('key');
    if (!c.model) out.push('模型名');
    return out;
  }

  function available() { return missing().length === 0; }
  function modelLabel() { return read().model || ''; }
  function providerName() {
    const c = read();
    const p = PRESETS.find(x => x.id === c.preset);
    return p ? p.name : (c.base ? '自定义接口' : '');
  }

  function describe(e) {
    const code = (e && e.code) || '';
    const d = e && e.detail ? '：' + String(e.detail).slice(0, 140) : '';
    if (code === 'no_key') return '模型设置还没填完（接口地址 / key / 模型名）。点「模型设置」补上，或先用本地引擎。';
    if (code === 'net') return '连不上这个接口地址。先看地址有没有写错；如果是被浏览器跨域挡住（CORS），这家服务商不允许网页直连，换一家或自建代理。';
    if (code === 'timeout') return '模型 20 秒没响应。网络慢或服务商在排队，稍后再试。';
    if (code === 'http_401') return 'key 不对（HTTP 401）。整段重新复制一次，前后别带空格' + d;
    if (code === 'http_403') return '这个 key 没有该模型的权限，或调用被限制（HTTP 403）' + d;
    if (code === 'http_404') return '接口地址或模型名不对（HTTP 404）。地址一般以 /v1 结尾，模型名要跟服务商文档一字不差' + d;
    if (code === 'http_400') return '请求被拒（HTTP 400），多半是模型名不对' + d;
    if (code === 'http_429') return '请求太频繁或额度用尽（HTTP 429），等一会儿再试' + d;
    if (/^http_5/.test(code)) return '服务商暂时不可用（HTTP ' + code.slice(5) + '），稍后重试' + d;
    if (code === 'empty') return '模型返回了空内容。换一个模型名或稍后再试。';
    if (code === 'json') return '返回的不是 OpenAI 兼容格式，这个地址可能不是聊天接口。';
    return (e && e.message) || '未知错误';
  }

  function hdr(c) {
    const h = { 'Content-Type': 'application/json' };
    if (c.key) h['Authorization'] = 'Bearer ' + c.key;
    return h;
  }

  function httpErr(status, txt) {
    let detail = '';
    try {
      const j = JSON.parse(txt);
      detail = (j.error && (j.error.message || j.error.type || j.error.code)) || j.message || '';
    } catch (e) { detail = String(txt || '').replace(/\s+/g, ' ').slice(0, 160); }
    const e = new Error('HTTP ' + status);
    e.code = 'http_' + status; e.status = status; e.detail = detail;
    return e;
  }

  function chunkText(raw) {
    try {
      const j = JSON.parse(raw);
      const ch = (j.choices && j.choices[0]) || {};
      return (ch.delta && (ch.delta.content || ch.delta.reasoning_content)) ||
        (ch.message && ch.message.content) || '';
    } catch (e) { return ''; }
  }

  /* 整包文本里可能仍是 SSE 片段（有些代理忽略 content-type） */
  function sseCollect(txt) {
    let out = '';
    String(txt || '').split('\n').forEach(l => {
      const line = l.replace(/\r$/, '').trim();
      if (line.indexOf('data:') !== 0) return;
      const d = line.slice(5).trim();
      if (!d || d === '[DONE]') return;
      out += chunkText(d);
    });
    return out;
  }

  async function stream(opts) {
    const c = read();
    if (missing(c).length) {
      const e = new Error(describe({ code: 'no_key' }));
      e.code = 'no_key'; lastErr = e; throw e;
    }

    const body = {
      model: c.model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user }
      ],
      stream: true
    };
    const temp = (typeof opts.temperature === 'number') ? opts.temperature : c.temp;
    if (typeof temp === 'number') body.temperature = temp;

    let res;
    try {
      res = await fetch(c.base + '/chat/completions', {
        method: 'POST',
        headers: hdr(c),
        body: JSON.stringify(body),
        signal: opts.signal
      });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      const e = new Error(describe({ code: 'net' }));
      e.code = 'net'; e.raw = err; lastErr = e; throw e;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const e = httpErr(res.status, txt);
      e.message = describe(e); lastErr = e; throw e;
    }

    const ctype = String((res.headers && res.headers.get && res.headers.get('content-type')) || '');

    /* 少数服务商不认 stream:true，直接回整包 JSON */
    if (!res.body || !res.body.getReader || /application\/json/i.test(ctype)) {
      const txt = await res.text();
      let text = '';
      if (/application\/json/i.test(ctype) || /^\s*\{/.test(txt)) text = chunkText(txt.trim());
      else text = sseCollect(txt);
      text = String(text || '').trim();
      if (!text) {
        const e = new Error(describe({ code: /application\/json/i.test(ctype) ? 'empty' : 'json' }));
        e.code = 'empty'; lastErr = e; throw e;
      }
      if (opts.onDelta) opts.onDelta(text);
      return text;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '', text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, '').trim();
          buf = buf.slice(i + 1);
          if (!line || line.charAt(0) === ':') continue;
          if (line.indexOf('data:') !== 0) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          const t = chunkText(data);
          if (t) { text += t; if (opts.onDelta) opts.onDelta(text); }
        }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      const e = new Error(describe({ code: 'net' }));
      e.code = 'net'; e.raw = err; lastErr = e; throw e;
    }

    if (!text.trim()) {
      const e = new Error(describe({ code: 'empty' }));
      e.code = 'empty'; lastErr = e; throw e;
    }
    return text;
  }

  async function once(opts) { return stream(opts); }

  /* 测试连通性：发一个 4 token 的小请求，能区分 key 错 / 地址错 / 模型名错 */
  async function test(opts) {
    const c = read();
    const miss = missing(c);
    if (miss.length) {
      const e = new Error('还差：' + miss.join('、'));
      e.code = 'no_key'; throw e;
    }
    const ctrl = new AbortController();
    const to = setTimeout(() => { try { ctrl.abort(); } catch (e) { } }, (opts && opts.timeout) || 20000);
    const t0 = Date.now();
    try {
      const r = await fetch(c.base + '/chat/completions', {
        method: 'POST',
        headers: hdr(c),
        body: JSON.stringify({
          model: c.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 4,
          stream: false
        }),
        signal: ctrl.signal
      });
      const txt = await r.text();
      if (!r.ok) throw httpErr(r.status, txt);
      return { ok: true, ms: Date.now() - t0, model: c.model, base: c.base };
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const x = new Error(describe({ code: 'timeout' }));
        x.code = 'timeout'; throw x;
      }
      if (e && e.code) { e.message = describe(e); throw e; }
      const x = new Error(describe({ code: 'net' }));
      x.code = 'net'; throw x;
    } finally { clearTimeout(to); }
  }

  return {
    available, missing, read, save, clear, presets: () => PRESETS.slice(),
    modelLabel, providerName, describe, stream, once, test,
    lastError: () => lastErr,
    /* 兼容旧调用 */
    ensure: () => read()
  };
})();
