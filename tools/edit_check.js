/**
 * 出稿后可编辑 验证：
 *  1) 出稿后点「编辑稿子」→ 每个段落变输入框，数量与稿子块数一致
 *  2) 改一段文字 → 字数跟着变、草稿落盘、提词器读到的也是改后的
 *  3) 类型切换 / 加一段 / 删一段 / 改环节名 都能生效
 *  4) 「还原到出稿版」把改动全撤掉
 *  5) 刷新后纸面为空，但有「接着上次的稿子」，进来了还是改过的那版
 *  6) 改动过再点「重新出稿」会先确认，不会静默覆盖
 * 用法：node tools/edit_check.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function ok(name, pass, extra) {
  results.push({ name, pass });
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : ''));
}
const URL = 'file://' + path.join(ROOT, '工作台.html') + '#script';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'zhili-edit-')),
    args: ['--no-sandbox', '--disable-gpu', '--mute-audio', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle2' });
  await sleep(900);

  /* 首次打开会先弹欢迎层，测试里直接选「看演示」跳过 */
  if (await page.$('#wlDemo')) { await page.click('#wlDemo'); await sleep(500); }

  /* 用本地引擎出一稿，等打字动画结束 */
  await page.evaluate(() => { document.querySelector('[data-engine="local"]').click(); });
  await page.evaluate(() => { document.querySelector('#btnOcGen').click(); });
  await page.waitForFunction(() => {
    const b = document.querySelector('#btnOcGen');
    return b && !b.disabled && document.querySelectorAll('#ocPaper p').length > 4;
  }, { timeout: 30000 });
  await sleep(700);

  const before = await page.evaluate(() => ({
    paras: document.querySelectorAll('#ocPaper p').length,
    blocks: ZHILI.ocState().res.groups.reduce((a, g) => a + (g.blocks || []).length, 0),
    words: (document.querySelector('.oc-meta') || {}).textContent || ''
  }));
  ok('出稿完成，纸面是只读段落', before.paras > 4 && before.blocks > before.paras,
    `段落 ${before.paras} · 块 ${before.blocks} · ${before.words}`);

  /* 1) 进入编辑 */
  await page.click('#btnOcEdit');
  await sleep(400);
  const editMode = await page.evaluate(() => ({
    tas: document.querySelectorAll('#ocPaper .oc-ed-ta').length,
    inps: document.querySelectorAll('#ocPaper .oc-ed-gname').length,
    ops: document.querySelectorAll('#ocPaper .oc-ed-ops button').length,
    editClass: document.querySelector('#ocPaper').classList.contains('edit'),
    btn: document.querySelector('#btnOcEdit').textContent,
    focused: document.activeElement && document.activeElement.className,
    overflow: Array.from(document.querySelectorAll('#ocPaper .oc-ed-ta'))
      .filter(t => t.scrollHeight > t.clientHeight + 3).length
  }));
  ok('点「编辑」→ 全部段落变输入框',
    editMode.tas === before.blocks && editMode.inps >= 8 && editMode.editClass && editMode.btn.indexOf('完成') >= 0,
    JSON.stringify(editMode));
  ok('输入框高度已撑开，没有被裁掉的行', editMode.overflow === 0, '溢出 ' + editMode.overflow + ' 个');

  /* 2) 改一段文字 */
  const changed = await page.evaluate(() => {
    const ta = document.querySelectorAll('#ocPaper .oc-ed-ta')[1];
    const old = ta.value;
    ta.focus();
    ta.value = '【测试改动】这一句是我手打的，看看会不会存下来。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.blur();
    return { old, now: ZHILI.ocState().res.groups[0].blocks[1].text, tag: !document.querySelector('#ocEdTag').hidden };
  });
  await sleep(700);
  const persisted = await page.evaluate(() => {
    const w = ZHILI.curW();
    const key = ZHILI.ocState().res.groups[0].key;
    return {
      inDraft: (w.scripts[key] && w.scripts[key].blocks[1] || {}).text || '',
      meta: (document.querySelector('.oc-meta') || {}).textContent || '',
      edited: !!ZHILI.ocState().edited
    };
  });
  ok('改一段 → 内存与草稿同步', changed.now.indexOf('【测试改动】') === 0 &&
    persisted.inDraft.indexOf('【测试改动】') === 0 && persisted.edited,
    `${changed.old.slice(0, 12)}… → ${persisted.inDraft.slice(0, 14)}… · ${persisted.meta}`);
  ok('「已手工改过」标记出现', changed.tag === true);

  /* 3) 类型切换 / 加一段 / 删一段 / 改环节名 */
  const ops = await page.evaluate(() => {
    const oc = ZHILI.ocState();
    const g0 = oc.res.groups[0];
    const n0 = g0.blocks.length;
    /* 类型切换：第一段按 词→提→注 循环 */
    const t0 = g0.blocks[0].t;
    const ty = document.querySelector('#ocPaper [data-ty="0:0"]');
    ty.click();
    const t1 = oc.res.groups[0].blocks[0].t;
    const ORDER = ['say', 'cue', 'note'];
    const want = ORDER[(ORDER.indexOf(t0) + 1) % 3];
    /* 加一段 */
    document.querySelector('#ocPaper [data-addb="0:0"]').click();
    const n1 = oc.res.groups[0].blocks.length;
    /* 删掉刚加的（空段不弹确认） */
    document.querySelector('#ocPaper [data-delb="0:1"]').click();
    const n2 = oc.res.groups[0].blocks.length;
    /* 改环节名 */
    const gi = document.querySelector('#ocPaper [data-gname="0"]');
    gi.value = '开场（改过名字）';
    gi.dispatchEvent(new Event('input', { bubbles: true }));
    gi.blur();
    return { t0, t1, want, n0, n1, n2, name: oc.res.groups[0].name, tas: document.querySelectorAll('#ocPaper .oc-ed-ta').length };
  });
  ok('类型切换 / 加段 / 删段 / 改环节名都生效',
    ops.t1 === ops.want && ops.n1 === ops.n0 + 1 && ops.n2 === ops.n0 && ops.name.indexOf('改过名字') >= 0,
    JSON.stringify(ops));

  /* 4) 提词器读的是改后的稿子 */
  await page.click('#btnOcEdit'); /* 退出编辑，触发落盘 */
  await sleep(500);
  const readView = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('#ocPaper p')).map(x => x.textContent);
    return { hit: ps.some(t => t.indexOf('【测试改动】') >= 0), cue: document.querySelectorAll('#ocPaper .oc-cue').length };
  });
  ok('退出编辑后读到的就是改后的稿子', readView.hit, JSON.stringify(readView));

  const prompter = await page.evaluate(async () => {
    location.hash = '#prompter';
    await new Promise(r => setTimeout(r, 800));
    const body = document.body.innerText;
    return { hit: body.indexOf('【测试改动】') >= 0 };
  });
  ok('提词器同步显示改动', prompter.hit, JSON.stringify(prompter));
  await page.evaluate(() => { ZHILI.go('script'); });
  await sleep(700);

  /* 5) 还原到出稿版 */
  await page.click('#btnOcRevert');
  await sleep(300);
  const modal = await page.evaluate(() => (document.querySelector('#modalBody') || {}).textContent || '');
  await page.evaluate(() => { document.querySelector('#ocRevYes').click(); });
  await sleep(500);
  const reverted = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('#ocPaper p')).map(x => x.textContent);
    const w = ZHILI.curW();
    const key = ZHILI.ocState().res.groups[0].key;
    return {
      hit: ps.some(t => t.indexOf('【测试改动】') >= 0),
      draftHit: ((w.scripts[key] || {}).blocks || []).some(b => String(b.text).indexOf('【测试改动】') >= 0),
      tag: !document.querySelector('#ocEdTag').hidden
    };
  });
  ok('还原到出稿版：改动被撤掉并同步草稿',
    modal.indexOf('还原') >= 0 && !reverted.hit && !reverted.draftHit && !reverted.tag,
    JSON.stringify(reverted));

  /* 6) 再改一处，落到草稿，刷新后能接着改 */
  await page.click('#btnOcEdit');
  await sleep(400);
  await page.evaluate(() => {
    const ta = document.querySelector('#ocPaper .oc-ed-ta');
    ta.focus();
    ta.value = '【再改一次】看看刷新还在不在。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.blur();
  });
  await sleep(800);

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1000);
  await page.evaluate(() => { ZHILI.go('script'); });
  await sleep(700);
  const emptyState = await page.evaluate(() => {
    const b = document.querySelector('#btnLoadDraft');
    return { has: !!b, label: b ? b.textContent.trim() : '', paperEmpty: document.querySelectorAll('#ocPaper p').length };
  });
  ok('刷新后纸面提示「接着上次的稿子」', emptyState.has && emptyState.paperEmpty === 0, JSON.stringify(emptyState));

  await page.click('#btnLoadDraft');
  await sleep(600);
  const loaded = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('#ocPaper .oc-ed-ta')).map(x => x.value);
    return {
      tas: ps.length,
      hit: ps.some(t => t.indexOf('【再改一次】') >= 0),
      edit: ZHILI.ocState().edit
    };
  });
  ok('载入草稿：内容在、直接进编辑态、还能接着改',
    loaded.tas > 4 && loaded.hit && loaded.edit, JSON.stringify(loaded));

  /* 7) 改动过再重出会先确认 */
  await page.evaluate(() => {
    const ta = document.querySelector('#ocPaper .oc-ed-ta');
    ta.focus(); ta.value = '再改一句，试探重出保护。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  await page.click('#btnOcGen');
  await sleep(400);
  const guard = await page.evaluate(() => ({
    text: (document.querySelector('#modalBody') || {}).textContent || '',
    hasYes: !!document.querySelector('#ocRegenYes')
  }));
  ok('改过再重出会先问一句', guard.hasYes && guard.text.indexOf('覆盖') >= 0, guard.text.slice(0, 30));
  await page.evaluate(() => { document.querySelector('#ocRegenNo').click(); });
  await sleep(300);

  ok('零脚本报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  const pass = results.filter(r => r.pass).length;
  console.log(`\n[edit] ${pass}/${results.length} 通过`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
