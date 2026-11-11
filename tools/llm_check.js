/**
 * 自带 key（BYOK）验证：
 *  1) 没配置时：大模型不可用、按钮提示未配置、点「大模型」直接弹模型设置
 *  2) 点服务商预设自动填地址与模型名，datalist 有候选
 *  3) 错 key → 测试连接报 401 / key 不对
 *  4) 对 key → 保存后可用，模型名显示在工具栏
 *  5) 用这个 key 真跑一次大模型出稿：请求打到接口、按 SSE 流式写进纸面
 *  6) key 不进 DB、不进导出备份；只在本机 localStorage
 *  7) 地址容错：只给域名补 /v1、粘完整 /chat/completions 也认
 *  8) 清空后回到不可用
 * 用法：node tools/llm_check.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function ok(name, pass, extra) {
  results.push({ name, pass });
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : ''));
}

const GOOD = 'sk-good-key-123';
let hits = 0, streamHits = 0, lastAuth = '';

/* 假的 OpenAI 兼容接口：校验 key、支持 SSE 流式 */
const mock = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Max-Age': '600'
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  const u = String(req.url || '').split('?')[0];
  if (u !== '/v1/chat/completions') { res.writeHead(404, cors); res.end('not found'); return; }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    hits++;
    lastAuth = String(req.headers.authorization || '');
    if (lastAuth !== 'Bearer ' + GOOD) {
      res.writeHead(401, Object.assign({ 'Content-Type': 'application/json' }, cors));
      res.end(JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }));
      return;
    }
    let j = {};
    try { j = JSON.parse(body); } catch (e) { }
    const text = '## 开场\n各位来宾，下午好。今天这场在城郊的一个院子里。\n<音乐起 · 新人候场>\n\n' +
      '## 新人入场\n请全场起立，把手机放下来。\n';
    if (j.stream) {
      streamHits++;
      res.writeHead(200, Object.assign({
        'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache'
      }, cors));
      const parts = text.match(/[\s\S]{1,16}/g) || [];
      let i = 0;
      const timer = setInterval(() => {
        if (i >= parts.length) {
          clearInterval(timer);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] }) + '\n\n');
      }, 25);
      return;
    }
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
    res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }));
  });
});

/* 静态页 */
const site = http.createServer((req, res) => {
  const u = decodeURIComponent(String(req.url || '/').split('?')[0]);
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(ROOT, '工作台.html')));
    return;
  }
  res.writeHead(404); res.end('not found');
});

(async () => {
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const MOCK = 'http://127.0.0.1:' + mock.address().port + '/v1';
  const BASE = 'http://127.0.0.1:' + site.address().port + '/';

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'zhili-llm-')),
    args: ['--no-sandbox', '--disable-gpu', '--mute-audio']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(BASE + '#script', { waitUntil: 'networkidle2' });
  await sleep(900);
  if (await page.$('#wlDemo')) { await page.click('#wlDemo'); await sleep(500); }
  await page.evaluate(() => ZHILI.go('script'));
  await sleep(600);

  /* 1) 没有 key 的状态 */
  const before = await page.evaluate(() => ({
    avail: LLM.available(),
    miss: LLM.missing(),
    label: (document.querySelector('#ocModel') || {}).textContent || ''
  }));
  ok('未配置时大模型不可用且提示清楚',
    before.avail === false && before.miss.length === 3 && before.label.indexOf('未配置') >= 0,
    JSON.stringify(before));

  /* 点「大模型」不该报错，而是弹模型设置 */
  await page.evaluate(() => { document.querySelector('[data-engine="cloud"]').click(); });
  await sleep(400);
  const modalOpen = await page.evaluate(() => ({
    has: !!document.querySelector('#pmBase'),
    presets: document.querySelectorAll('#pmPresets .tone').length,
    title: (document.querySelector('#modalTitle') || {}).textContent || ''
  }));
  ok('点「大模型」自动弹出模型设置', modalOpen.has && modalOpen.presets >= 6,
    modalOpen.title + ' · ' + modalOpen.presets + ' 个服务商');

  /* 2) 点预设自动填 */
  const preset = await page.evaluate(() => {
    document.querySelector('[data-pm="deepseek"]').click();
    return {
      base: document.querySelector('#pmBase').value,
      model: document.querySelector('#pmModel').value,
      opts: document.querySelectorAll('#pmModels option').length
    };
  });
  ok('点服务商预设自动填地址与模型名',
    preset.base === 'https://api.deepseek.com/v1' && preset.model === 'deepseek-chat' && preset.opts >= 2,
    JSON.stringify(preset));

  /* 3) 错 key → 测试连接报错 */
  await page.evaluate((mockUrl) => {
    document.querySelector('#pmBase').value = mockUrl;
    document.querySelector('#pmKey').value = 'sk-wrong-key';
    document.querySelector('#pmModel').value = 'mock-chat';
    document.querySelector('#pmTest').click();
  }, MOCK);
  await sleep(2200);
  const badMsg = await page.evaluate(() => (document.querySelector('#pmMsg') || {}).textContent || '');
  ok('错 key 测试连接说清是 401', badMsg.indexOf('401') >= 0 || badMsg.indexOf('key 不对') >= 0, badMsg.slice(0, 46));

  /* 4) 对 key → 测试通过 → 保存 */
  await page.evaluate((k) => { document.querySelector('#pmKey').value = k; }, GOOD);
  await page.click('#pmTest');
  await sleep(2200);
  const goodMsg = await page.evaluate(() => (document.querySelector('#pmMsg') || {}).textContent || '');
  await page.click('#pmSave');
  await sleep(500);
  const afterSave = await page.evaluate(() => ({
    avail: LLM.available(),
    label: (document.querySelector('#ocModel') || {}).textContent || '',
    modal: document.querySelector('#modalBg').classList.contains('on'),
    stored: !!localStorage.getItem('wb.demo.llm.v1')
  }));
  ok('key 正确：测试通过并保存',
    goodMsg.indexOf('连上了') >= 0 && afterSave.avail && afterSave.label.indexOf('mock-chat') >= 0 && afterSave.modal === false,
    goodMsg.slice(0, 30) + ' ｜ ' + afterSave.label);
  ok('配置写在 localStorage，不进 DB', afterSave.stored && (await page.evaluate(() => JSON.stringify(ZHILI.db).indexOf('sk-good-key-123') < 0)), 'wb.demo.llm.v1');

  /* 5) 真跑一次大模型出稿 */
  await page.evaluate(() => { document.querySelector('[data-engine="cloud"]').click(); });
  await sleep(300);
  const engineOn = await page.evaluate(() =>
    !!document.querySelector('[data-engine="cloud"].on'));
  await page.click('#btnOcGen');
  await page.waitForFunction(() => {
    const ps = document.querySelectorAll('#ocPaper p');
    return ps.length > 2 && ps[0].textContent.indexOf('各位来宾') >= 0;
  }, { timeout: 25000 }).catch(() => { });
  await sleep(600);
  const gen = await page.evaluate(() => ({
    paras: document.querySelectorAll('#ocPaper p').length,
    text: Array.from(document.querySelectorAll('#ocPaper p')).map(x => x.textContent).join('|'),
    head: document.querySelectorAll('#ocPaper .oc-h').length
  }));
  ok('大模型出稿走的是自己填的接口',
    engineOn && hits >= 2 && streamHits >= 1 && gen.text.indexOf('各位来宾，下午好') >= 0,
    '请求 ' + hits + ' 次（流式 ' + streamHits + '）· 段落 ' + gen.paras + ' · 环节 ' + gen.head);

  /* 6) 草稿存回后，DB 里也不能带 key */
  const dbLeak = await page.evaluate(() => {
    const s = JSON.stringify(ZHILI.db) + JSON.stringify(localStorage.getItem('wb.demo.hostdesk.v1') || '');
    return { leak: s.indexOf('sk-good-key-123') >= 0, len: s.length };
  });
  ok('稿件与整库都不含 key', !dbLeak.leak, dbLeak.len + ' 字节扫过');

  /* 7) 地址容错 */
  const norm = await page.evaluate(() => {
    const a = LLM.save({ base: 'api.deepseek.com', preset: '' }).base;
    const b = LLM.save({ base: 'https://x.example.com/v1/chat/completions/' }).base;
    const c = LLM.save({ base: '  https://y.example.com/v1///  ' }).base;
    return { a, b, c };
  });
  ok('接口地址容错（补协议 / 补 v1 / 去多余路径）',
    norm.a === 'https://api.deepseek.com/v1' &&
    norm.b === 'https://x.example.com/v1' &&
    norm.c === 'https://y.example.com/v1',
    JSON.stringify(norm));

  /* 8) 清空 */
  const cleared = await page.evaluate(() => {
    LLM.clear();
    return { avail: LLM.available(), miss: LLM.missing().length };
  });
  ok('清空后回到不可用（出稿自动退回本地引擎）', !cleared.avail && cleared.miss === 3, JSON.stringify(cleared));

  const realErr = errors.filter(e => !/favicon|404|Failed to load resource/i.test(e));
  ok('零脚本报错', realErr.length === 0, realErr.slice(0, 2).join(' | '));

  await browser.close();
  await new Promise(r => mock.close(r));
  await new Promise(r => site.close(r));
  const pass = results.filter(r => r.pass).length;
  console.log('\n[llm] ' + pass + '/' + results.length + ' 通过');
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => {
  console.error('[llm] 崩了：', e && e.message);
  process.exit(1);
});
