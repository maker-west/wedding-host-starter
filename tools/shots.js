const puppeteer = require('/Users/wangping/WorkBuddy/2026-10-31-22-58-54/wedding-host/node_modules/puppeteer-core');
const OUT = process.env.OUT || '/tmp/zhili-shots';
const PRE = process.env.PRE || '';
const VIEWS = (process.env.VIEWS || 'dash,script,flow,songs,sandbox').split(',');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));
  if (await page.$('.welcome')) await page.screenshot({ path: `${OUT}/${PRE}welcome.png` });
  const demo = await page.$('#wlDemo');
  if (demo) { await demo.click(); await new Promise(r => setTimeout(r, 2400)); }
  for (const v of VIEWS) {
    await page.evaluate(k => window.ZHILI.go(k), v);
    await new Promise(r => setTimeout(r, 700));
    await page.screenshot({ path: `${OUT}/${PRE}${v}.png` });
  }
  // 手机视图
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluate(() => window.ZHILI.go('dash'));
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: `${OUT}/${PRE}m-dash.png` });
  await browser.close();
  console.log('ok');
})();
