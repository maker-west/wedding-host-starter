/**
 * 分享版验证：
 *  1) 示例数据脱敏：真实客户姓名 / 真实场地 / 本人电话都不该出现在产物里
 *  2) 首次打开 → 欢迎层；选「先看演示」进 4 场；选「从空白开始」只剩一场空白
 *  3) 老用户（已有数据）不再弹欢迎层
 *  4) 工作台底部有 导出备份 / 恢复演示 / 清空重来，弹窗文案正确
 *  5) 问卷链接自带场次信息：清掉 localStorage 也能渲染出正确新人（相当于别人的手机）
 *  6) 二维码能画出来，链接长度不超过编码器上限
 * 用法：node tools/share_check.js
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
/* 用本地 http 起一个真·静态站：模拟发布后的公网环境（file:// 下没有二维码） */
let BASE = '';
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(String(req.url || '/').split('?')[0]);
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(ROOT, '工作台.html')));
  } else {
    res.writeHead(404); res.end('not found');
  }
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  BASE = 'http://127.0.0.1:' + server.address().port;
  const FILE = BASE + '/';

  /* 1) 产物脱敏扫描 */
  const bundle = fs.readFileSync(path.join(ROOT, '工作台.html'), 'utf8');
  const bad = ['林知夏', '陈屿', '周雨桐', '赵砚', '苏晚', '顾行舟', '何岸', '许亦',
    '中国油画院', '悉昙', '瑰丽', '瑜舍', '王平', '6621', '鼓浪屿'];
  const leaked = bad.filter(x => bundle.indexOf(x) >= 0);
  ok('示例数据已脱敏', leaked.length === 0, leaked.length ? '残留：' + leaked.join('、') : '11 个关键词零命中');

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'zhili-share-')),
    args: ['--no-sandbox', '--disable-gpu', '--mute-audio', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  /* 2) 全新浏览器 → 欢迎层 */
  await page.goto(FILE + '#dash', { waitUntil: 'networkidle2' });
  await sleep(900);
  const welcome = await page.evaluate(() => {
    const el = document.querySelector('.welcome');
    return {
      has: !!el,
      title: el ? el.querySelector('h2').textContent : '',
      btns: el ? Array.from(el.querySelectorAll('.btn')).map(b => b.textContent.trim()) : [],
      overflow: el ? el.scrollWidth > window.innerWidth + 2 : false
    };
  });
  ok('首次打开有欢迎层（看演示 / 空白）',
    welcome.has && welcome.btns.length === 2 && /演示/.test(welcome.btns[0]) && /空白/.test(welcome.btns[1]) && !welcome.overflow,
    JSON.stringify(welcome));

  await page.click('#wlDemo');
  await sleep(600);
  const demo = await page.evaluate(() => ({
    gone: !document.querySelector('.welcome'),
    count: ZHILI.db.weddings.length,
    flag: localStorage.getItem('wb.demo.onboard.v1'),
    names: ZHILI.db.weddings.map(w => w.couple.bride)
  }));
  ok('选「先看演示」→ 4 场虚构婚礼', demo.gone && demo.count === 4 && demo.flag === 'demo',
    JSON.stringify(demo));

  /* 3) 已有数据的老用户不再弹 */
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(900);
  const again = await page.evaluate(() => !!document.querySelector('.welcome'));
  ok('老用户刷新不再弹欢迎层', again === false);

  /* 4) 工作台底部三件套 */
  await page.evaluate(() => ZHILI.go('dash'));
  await sleep(500);
  const card = await page.evaluate(() => ({
    has: !!document.getElementById('dbExport'),
    labels: ['dbExport', 'dbDemo', 'dbBlank'].map(id => {
      const e = document.getElementById(id); return e ? e.textContent.trim() : '';
    })
  }));
  ok('工作台底部有数据出口', card.has && card.labels.join('/') === '导出备份/恢复演示数据/清空重来',
    card.labels.join(' / '));

  await page.click('#dbBlank');
  await sleep(350);
  const blankModal = await page.evaluate(() => ({
    text: (document.querySelector('#modalBody') || {}).textContent || '',
    yes: !!document.querySelector('#dbBlankYes')
  }));
  await page.evaluate(() => document.querySelector('#dbBlankNo').click());
  await sleep(250);
  ok('「清空重来」先确认', blankModal.yes && /不能撤销/.test(blankModal.text), blankModal.text.slice(0, 24));

  /* 5) 分享链接：换一个「别人的手机」（清空本地数据） */
  const link = await page.evaluate(() => ZHILI.surveyLink());
  const ptr = await page.evaluate(() => {
    const w = ZHILI.curW();
    return { bride: w.couple.bride, groom: w.couple.groom, hotel: w.hotel, date: w.date, host: ZHILI.db.profile.name };
  });
  ok('问卷链接带上场次信息', /\?survey=/.test(link) && /&d=/.test(link) && new TextEncoder().encode(link).length <= 260,
    new TextEncoder().encode(link).length + ' 字节');

  /* 发布出去的链接会带 sharecode，问卷链接必须把它一起带过去 */
  await page.goto(BASE + '/?sharecode=TESTCODE', { waitUntil: 'networkidle2' });
  await sleep(900);
  const withCode = await page.evaluate(() => ZHILI.surveyLink());
  ok('问卷链接保留访问参数（sharecode）',
    withCode.indexOf('sharecode=TESTCODE') >= 0 && withCode.indexOf('&survey=') > 0,
    withCode.slice(0, 64) + '…');
  await page.goto(FILE + '#survey', { waitUntil: 'networkidle2' });
  await sleep(900);

  const qr = await page.evaluate(() => {
    ZHILI.go('survey');
    return true;
  });
  await sleep(700);
  const qrInfo = await page.evaluate(() => {
    const cv = document.querySelector('#qrBox canvas');
    if (!cv) return { has: false, note: (document.querySelector('#qrBox') || {}).textContent || '' };
    const g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
    return { has: true, size: cv.width, dark };
  });
  ok('二维码能画出来', qrInfo.has && qrInfo.dark > 200, JSON.stringify(qrInfo));

  /* 换成「别人的手机」：清掉本机数据再打开链接 */
  await page.evaluate(() => localStorage.clear());
  await page.goto(link, { waitUntil: 'networkidle2' });
  await sleep(900);
  const guest = await page.evaluate(() => {
    const h1 = document.querySelector('.g-wrap h1');
    const meta = document.querySelector('.g-meta');
    const foot = document.querySelector('.g-foot');
    const fields = document.querySelectorAll('[data-q]').length;
    return {
      h1: h1 ? h1.textContent.trim() : '',
      meta: meta ? meta.textContent.trim() : '',
      foot: foot ? foot.textContent.trim() : '',
      fields,
      appHidden: (document.querySelector('.app') || {}).style ? document.querySelector('.app').style.display : 'n/a'
    };
  });
  ok('清空本机数据后仍能渲染正确的新人',
    guest.h1.indexOf(ptr.bride) >= 0 && guest.h1.indexOf(ptr.groom) >= 0 && guest.fields >= 8,
    JSON.stringify(guest));
  ok('问卷页脚署名跟着链接走', guest.foot.indexOf(ptr.host) >= 0, guest.foot);

  /* 填一份，看能不能生成回答 */
  const filled = await page.evaluate(() => {
    const ta = document.querySelectorAll('[data-q]');
    ta[0].value = '朋友的旧书店';
    ta[0].dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('gNames').value = '甲 & 乙';
    document.getElementById('gMake').click();
    const out = document.getElementById('gOut');
    return { len: out.value.length, head: out.value.slice(0, 30) };
  });
  ok('新人能填并生成回答', filled.len > 40 && /婚礼问卷/.test(filled.head), filled.len + ' 字');

  /* 6) 从空白开始 */
  await page.evaluate(() => localStorage.clear());
  await page.goto(FILE + '#dash', { waitUntil: 'networkidle2' });
  await sleep(900);
  await page.click('#wlBlank');
  await sleep(900);
  const blank = await page.evaluate(() => ({
    count: ZHILI.db.weddings.length,
    bride: ZHILI.db.weddings[0].couple.bride,
    materials: (ZHILI.db.materials || []).length,
    todos: (ZHILI.db.todos || []).length,
    samples: (ZHILI.db.style.samples || []).length,
    view: ZHILI.view(),
    flag: localStorage.getItem('wb.demo.onboard.v1'),
    welcome: !!document.querySelector('.welcome')
  }));
  ok('选「从空白开始」→ 一场空白、库全空',
    blank.count === 1 && blank.bride === '' && blank.materials === 0 && blank.todos === 0 &&
    blank.samples === 0 && blank.view === 'calendar' && blank.flag === 'blank' && !blank.welcome,
    JSON.stringify(blank));

  /* 空白态页面不报错 */
  await page.evaluate(() => ZHILI.go('script'));
  await sleep(900);
  const blankScript = await page.evaluate(() => ({
    paper: !!document.getElementById('ocPaper'),
    paras: document.querySelectorAll('#ocPaper p').length
  }));
  ok('空白场次的一键主持稿页正常打开', blankScript.paper, JSON.stringify(blankScript));

  const realErr = errors.filter(e => !/favicon|404|Failed to load resource/i.test(e));
  ok('零脚本报错', realErr.length === 0, realErr.slice(0, 3).join(' | '));

  await browser.close();
  await new Promise(r => server.close(r));
  const pass = results.filter(r => r.pass).length;
  console.log(`\n[share] ${pass}/${results.length} 通过`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
