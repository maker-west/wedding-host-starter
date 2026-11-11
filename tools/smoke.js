/**
 * 冒烟测试：真 Chrome 跑三件事，防止「改一处崩一片」。
 *   1) 10 个视图都能渲染、无脚本报错
 *   2) 一键主持稿出稿后自动存草稿，刷新还在
 *   3) 歌单导出真的落盘 + 导出记录有条目；问卷汇总 CSV 落盘
 *   4) 浏览器后退能回到上一个视图
 *
 * 用法：node tools/smoke.js            （先 npm i）
 * 说明：需要本机装了 Chrome；装法见 package.json 里的 devDependencies。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME_PATH ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : '/usr/bin/google-chrome');

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  console.error('[smoke] 没装 puppeteer-core，先执行：npm i');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const VIEWS = ['dash', 'script', 'calendar', 'survey', 'flow', 'songs', 'sandbox', 'player', 'prompter', 'templates'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function ok(name, pass, extra) {
  results.push({ name, pass, extra });
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : ''));
}

(async () => {
  if (!fs.existsSync(CHROME)) {
    console.error('[smoke] 找不到 Chrome：' + CHROME + '\n        用 CHROME_PATH 指定路径');
    process.exit(2);
  }
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'zhili-dl-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zhili-prof-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    userDataDir: profile,
    args: ['--no-sandbox', '--disable-gpu', '--mute-audio', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const url = 'file://' + path.join(ROOT, '工作台.html');
  await page.goto(url + '#dash', { waitUntil: 'networkidle2' });
  await sleep(900);

  /* 首次打开会先弹欢迎层，测试里直接选「看演示」跳过 */
  if (await page.$('#wlDemo')) { await page.click('#wlDemo'); await sleep(500); }

  /* 1) 十个视图 */
  let bad = [];
  for (const v of VIEWS) {
    await page.evaluate(x => window.ZHILI.go(x), v);
    await sleep(v === 'prompter' ? 500 : 260);
    const len = await page.evaluate(() => (document.getElementById('view') || {}).innerHTML.length || 0);
    if (len < 80) bad.push(v + '(' + len + ')');
    if (v === 'prompter') await page.evaluate(() => window.ZHILI.go('dash'));
  }
  ok('10 个视图渲染', bad.length === 0, bad.length ? bad.join(',') : '');

  /* 2) 出稿 + 自动草稿 */
  await page.evaluate(() => window.ZHILI.go('script'));
  await sleep(400);
  const stamped = await page.evaluate(() => {
    const loc = document.querySelector('[data-engine="local"]');
    if (loc) loc.click();                 // 冒烟只测本地引擎，不依赖模型额度
    const b = document.getElementById('btnOcGen');
    if (!b) return 'no-btn';
    b.click();
    return 'clicked';
  });
  await sleep(4200);
  const paperLen = await page.evaluate(() => (document.getElementById('ocPaper') || {}).innerText.length || 0);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(800);
  const saved = await page.evaluate(() => {
    try {
      const db = JSON.parse(localStorage.getItem('wb.demo.hostdesk.v1') || '{}');
      const w = (db.weddings || []).find(x => x.id === 'w2');
      const keys = Object.keys((w && w.scripts) || {}).filter(k => ((w.scripts[k] || {}).blocks || []).length);
      return keys.length;
    } catch (e) { return -1; }
  });
  ok('出稿', stamped === 'clicked' && paperLen > 400, 'paper=' + paperLen);
  ok('出稿后自动存草稿', saved > 0, 'segments=' + saved);

  /* 3) 导出落盘 */
  fs.readdirSync(dl).forEach(f => fs.unlinkSync(path.join(dl, f)));
  await page.evaluate(() => window.ZHILI.go('songs'));
  await sleep(600);
  await page.click('#dlSongs');
  await sleep(1200);
  const files = fs.readdirSync(dl);
  const txt = files.find(f => /\.txt$/.test(f));
  const body = txt ? fs.readFileSync(path.join(dl, txt), 'utf8') : '';
  ok('歌单导出落盘', !!txt && body.length > 50, txt || 'no file');
  const rec = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('wb.demo.exports.v1') || '[]').length; } catch (e) { return -1; }
  });
  ok('导出记录', rec > 0, 'records=' + rec);

  /* 4) 问卷汇总 csv */
  fs.readdirSync(dl).forEach(f => fs.unlinkSync(path.join(dl, f)));
  await page.evaluate(() => window.ZHILI.go('survey'));
  await sleep(600);
  const hasBtn = await page.evaluate(() => !!document.getElementById('expSurvey'));
  if (hasBtn) await page.click('#expSurvey');
  await sleep(900);
  const csv = fs.readdirSync(dl).find(f => /\.csv$/.test(f));
  ok('问卷汇总导出', !!csv, csv || 'no file');

  /* 5) 后退 */
  await page.evaluate(() => window.ZHILI.go('dash'));
  await sleep(300);
  await page.evaluate(() => window.ZHILI.go('player'));
  await sleep(400);
  await page.goBack();
  await sleep(500);
  const backView = await page.evaluate(() => (location.hash || '').replace('#', ''));
  ok('后退回到上一视图', backView === 'dash', 'hash=' + backView);

  const realErr = errors.filter(e => !/favicon|net::ERR|sdk|cdn\.jsdelivr/i.test(e));
  ok('无脚本报错', realErr.length === 0, realErr.slice(0, 2).join(' | '));

  await browser.close();
  const failed = results.filter(r => !r.pass).length;
  console.log('\n[smoke] ' + (results.length - failed) + '/' + results.length + ' 通过');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('[smoke] 崩了：', e && e.message);
  process.exit(2);
});
