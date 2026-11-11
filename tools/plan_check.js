/**
 * 走位示意图验证：
 *  1) 沙盘页有 #planCv 且真的画出了内容（非空白）
 *  2) 时间推进人物会动（两帧像素不同）
 *  3) 走位长图 PNG 落盘
 *  4) 走位视频 WebM 落盘
 *  5) 自定义环节名 / 空流程不炸
 * 用法：node tools/plan_check.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function ok(name, pass, extra) {
  results.push({ name, pass });
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : ''));
}

(async () => {
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'zhili-plan-dl-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zhili-plan-prof-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', userDataDir: profile,
    args: ['--no-sandbox', '--disable-gpu', '--mute-audio', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(ROOT, '工作台.html') + '#sandbox', { waitUntil: 'networkidle2' });
  await sleep(1000);

  /* 首次打开会先弹欢迎层，测试里直接选「看演示」跳过 */
  if (await page.$('#wlDemo')) { await page.click('#wlDemo'); await sleep(500); }

  /* 1) canvas 存在且有内容（与米白背景不同的像素占比） */
  const info = await page.evaluate(() => {
    const cv = document.getElementById('planCv');
    if (!cv) return { has: false };
    const g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0, ink = 0;
    for (let y = 0; y < cv.height; y += 6) {
      for (let x = 0; x < cv.width; x += 6) {
        const i = (y * cv.width + x) * 4;
        n++;
        if (d[i + 3] > 0 && (Math.abs(d[i] - 253) > 22 || Math.abs(d[i + 1] - 250) > 22 || Math.abs(d[i + 2] - 244) > 22)) ink++;
      }
    }
    return { has: true, w: cv.width, h: cv.height, inkPct: +(ink / n * 100).toFixed(1),
      legend: document.querySelectorAll('.pl-lg').length,
      key: Plan.keyFor('新娘入场 · 父亲交接') };
  });
  ok('沙盘页走位图已绘制', !!(info.has && info.w > 300 && info.inkPct > 2), JSON.stringify(info));

  /* 2) 时间推进人物会动 */
  const shotA = await page.evaluate(() => document.getElementById('planCv').toDataURL());
  await page.evaluate(() => { document.querySelectorAll('[data-jump]')[3].click(); });
  await sleep(400);
  const shotB = await page.evaluate(() => document.getElementById('planCv').toDataURL());
  const nowTxt = await page.evaluate(() => document.getElementById('stageNow').textContent);
  ok('切环节人物位置变化', shotA !== shotB, '当前环节：' + nowTxt);

  /* 播放 1.2 秒看连续动画 */
  await page.click('#btnPlay');
  await sleep(1200);
  const shotC = await page.evaluate(() => document.getElementById('planCv').toDataURL());
  await page.click('#btnPlay');
  ok('播放时画面持续更新', shotB !== shotC);

  /* 3) 走位长图 */
  await page.click('#btnPlanPoster');
  await sleep(1200);
  const png = fs.readdirSync(dl).filter(f => f.startsWith('走位图') && f.endsWith('.png'));
  let pngSize = 0, dims = null;
  if (png.length) {
    pngSize = fs.statSync(path.join(dl, png[0])).size;
    const buf = fs.readFileSync(path.join(dl, png[0]));
    dims = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  ok('走位长图落盘', png.length === 1 && pngSize > 60000, png[0] + ' ' + (pngSize / 1024).toFixed(0) + 'KB ' + JSON.stringify(dims));

  /* 4) 走位视频（录制 12 秒 + 编码，轮询最多 35 秒） */
  await page.click('#btnVideo');
  await sleep(500);
  await page.click('#recBtn');
  let webm = [];
  for (let i = 0; i < 35; i++) {
    await sleep(1000);
    webm = fs.readdirSync(dl).filter(f => f.endsWith('.webm') && !f.endsWith('.crdownload'));
    if (webm.length) break;
  }
  const vSize = webm.length ? fs.statSync(path.join(dl, webm[0])).size : 0;
  ok('走位视频落盘', webm.length === 1 && vSize > 20000, (webm[0] || 'none') + ' ' + (vSize / 1024).toFixed(0) + 'KB');
  await page.evaluate(() => { const b = document.getElementById('modalClose'); if (b) b.click(); });

  /* 5) 自定义环节 + 空流程 */
  const robust = await page.evaluate(() => {
    try {
      const rows = [{ name: '一个从没见过的环节', dur: 3, from: '12:00', to: '12:03' }];
      const seq = Plan.choreo(rows);
      const cv = document.createElement('canvas'); cv.width = 500; cv.height = 310;
      const g = cv.getContext('2d'); g.scale(0.5, 0.5);
      Plan.drawInto(g, { rows: rows, t: 1, seq: seq });
      const empty = Plan.choreo([]);
      const w = ZHILI.db.weddings[0];
      const cv2 = Plan.poster(w, rows, 'test');
      return { ok: true, key: seq[0].key, empty: empty.length, posterH: cv2.height };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  ok('自定义环节/单环节长图不炸', robust.ok, JSON.stringify(robust));

  await page.evaluate(() => ZHILI.go('sandbox'));
  await sleep(500);
  await page.screenshot({ path: '/tmp/shot_plan.png' });

  ok('无脚本报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log('\n下载目录：' + dl);
  await browser.close();
  const failed = results.filter(r => !r.pass).length;
  console.log('[plan] ' + (results.length - failed) + '/' + results.length + ' 通过');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
