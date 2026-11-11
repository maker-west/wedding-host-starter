/**
 * 风格档验证：
 *  1) 风格库页有四档可选，选中 S4 会写 pack + 预设滑杆
 *  2) 本地出稿首句来自该档句库；换档句子会变
 *  3) 云端 prompt 里带【风格档】与禁用词
 *  4) 套装骨架对照能认出缺的环节，补齐后流程里真的有
 *  5) 单环节「证婚人致辞」能出稿
 * 用法：node tools/pack_check.js
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

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'zhili-pack-')),
    args: ['--no-sandbox', '--disable-gpu', '--mute-audio', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(ROOT, '工作台.html') + '#script', { waitUntil: 'networkidle2' });
  await sleep(900);

  /* 首次打开会先弹欢迎层，测试里直接选「看演示」跳过 */
  if (await page.$('#wlDemo')) { await page.click('#wlDemo'); await sleep(500); }

  /* 1) 风格库页 */
  await page.evaluate(() => { document.querySelector('[data-tab="style"]').click(); });
  await sleep(500);
  const packs = await page.evaluate(() => ({
    cards: document.querySelectorAll('.pack').length,
    names: Array.from(document.querySelectorAll('.pack b')).map(x => x.textContent),
    frames: document.querySelectorAll('.fr').length,
    missingNew: Array.from(document.querySelectorAll('.fr-new')).length
  }));
  ok('风格库四档 + 骨架对照', packs.cards === 4 && packs.frames >= 14,
    JSON.stringify(packs));

  /* 选 S4 */
  const afterS4 = await page.evaluate(() => {
    document.querySelector('[data-pack="s4"]').click();
    return { pack: ZHILI.db.style.pack, prefs: Object.assign({}, ZHILI.db.style.prefs),
      detailRules: document.querySelectorAll('.pk-sec li').length,
      avoid: document.querySelectorAll('.pk-avoid span').length,
      on: document.querySelector('.pack.on b').textContent };
  });
  ok('选 S4 写入档位并预设滑杆',
    afterS4.pack === 's4' && afterS4.prefs['口语'] === 84 && afterS4.detailRules >= 5,
    JSON.stringify(afterS4));

  /* 2) 引擎层：同一环节在三个档下的第一句。
     句库直接从页面的 stylepacks 读，不在这里写死——
     以后换语料、改句子，测试自动跟着走。 */
  const probe = await page.evaluate(() => {
    const w = ZHILI.curW();
    const base = { samples: ZHILI.db.style.samples, prefs: ZHILI.db.style.prefs, salt: 3 };
    const firstSay = (pack, seg) => {
      const r = Engine.generate(w, seg, Object.assign({ pack: pack }, base));
      const b = (r.blocks || []).find(x => x.t === 'say');
      return b ? b.text : '';
    };
    const segs = ['open', 'bride', 'vows', 'parents', 'toast', 'end'];
    const voices = {}, banks = {};
    ['custom', 's4', 's2', 's8'].forEach(pk => {
      voices[pk] = {}; banks[pk] = {};
      segs.forEach(sg => {
        voices[pk][sg] = firstSay(pk === 'custom' ? '' : pk, sg);
        banks[pk][sg] = (pk === 'custom') ? [] : ((window.Pack.linesFor(pk, sg)) || []);
      });
    });
    return { voices: voices, banks: banks, segs: segs };
  });
  const voices = probe.voices, banks = probe.banks, segs = probe.segs;

  /* 带〔〕的是「待填提示」，不算写好的句子，不计入命中 */
  const isTodo = (x) => x.indexOf('〔') >= 0;
  const hitOf = (pk, sg) => banks[pk][sg].filter(x => !isTodo(x))
    .some(x => voices[pk][sg].indexOf(x) >= 0);
  const hits = {};
  ['s4', 's2', 's8'].forEach(pk => { hits[pk] = segs.filter(sg => hitOf(pk, sg)); });

  /* 所有档位的句子汇总，用来确认「不选档」时一句都不会漏出来 */
  const ALL_LINES = [];
  ['s4', 's2', 's8'].forEach(pk => segs.forEach(sg => {
    banks[pk][sg].forEach(x => { if (ALL_LINES.indexOf(x) < 0) ALL_LINES.push(x); });
  }));
  const customClean = segs.every(sg => !ALL_LINES.some(x => voices.custom[sg].indexOf(x) >= 0));

  /* 阈值说明：示例语料里 open / end 是完整的，其余环节留了填写提示，
     所以「命中 2 个环节」就是对的。把语料补全后这个数会自己变高。 */
  ok('S4/S2/S8 各环节起手句来自各自句库',
    hits.s4.length >= 2 && hits.s2.length >= 2 && hits.s8.length >= 2 && customClean,
    'S4 ' + hits.s4.length + '/6 · S2 ' + hits.s2.length + '/6 · S8 ' + hits.s8.length + '/6 · 不选档不含档位句=' + customClean);

  const distinct = ['s4', 's2', 's8'].map(pk => voices[pk].open);
  ok('三档首句互不相同', new Set(distinct).size === 3, distinct.map(x => x.slice(0, 14)).join(' ｜ '));

  /* 3) UI 出稿跑通（只验证不报错、有稿） */
  const uiRun = await page.evaluate(async () => {
    document.querySelector('[data-tab="write"]').click();
    await new Promise(r => setTimeout(r, 400));
    document.querySelector('[data-engine="local"]').click();
    document.querySelector('#btnOcGen').click();
    await new Promise(r => setTimeout(r, 5000));
    return {
      paras: document.querySelectorAll('#ocPaper p').length,
      text: Array.from(document.querySelectorAll('#ocPaper p')).map(x => x.textContent).join('|')
    };
  }).catch(e => ({ err: e.message }));
  const ALL = ALL_LINES.filter(x => !isTodo(x));
  const uiHit = uiRun && uiRun.text ? ALL.filter(k => uiRun.text.indexOf(k) >= 0).length : 0;
  ok('UI 出稿跑通且带上档位句', !!(uiRun && uiRun.text && uiRun.text.length > 80) && uiHit >= 1,
    '段落文本 ' + ((uiRun && uiRun.text || '').length) + ' 字 · 档位句 ' + uiHit + ' 处');

  /* 4) 云端 prompt 带风格档 */
  const prompt = await page.evaluate(() => {
    try { return ZHILI.buildPrompt().slice(0, 4000); } catch (e) { return 'ERR ' + e.message; }
  });
  ok('云端 prompt 带风格档与禁用词',
    prompt.indexOf('【风格档：') >= 0 && prompt.indexOf('禁用词') >= 0 && prompt.indexOf('硬约束') >= 0,
    prompt ? prompt.split('\n').filter(l => l.indexOf('风格档') >= 0).join(' | ') : '(无法取到)');

  /* 5) 骨架补环节 */
  const frame = await page.evaluate(async () => {
    document.querySelector('[data-tab="style"]').click();
    await new Promise(r => setTimeout(r, 300));
    const before = ZHILI.curW().flow.map(f => f.name);
    document.querySelector('#btnFrameFill').click();
    await new Promise(r => setTimeout(r, 300));
    const after = ZHILI.curW().flow.map(f => f.name);
    return { before: before, after: after };
  });
  ok('补齐套装骨架写进流程',
    frame.after.indexOf('证婚人致辞') >= 0 && frame.after.indexOf('双方父母致辞') >= 0,
    '补前 ' + frame.before.length + ' 环节 → 补后 ' + frame.after.length);

  /* 6) 单环节证婚人致辞 */
  const witness = await page.evaluate(async () => {
    document.querySelector('[data-tab="write"]').click();
    await new Promise(r => setTimeout(r, 350));
    const cat = Array.from(document.querySelectorAll('[data-cat]')).find(b => /单环节/.test(b.textContent));
    cat.click();
    await new Promise(r => setTimeout(r, 300));
    const sc = Array.from(document.querySelectorAll('[data-scene]')).find(b => /证婚人致辞/.test(b.textContent));
    sc.click();
    await new Promise(r => setTimeout(r, 350));
    document.querySelector('#btnOcGen').click();
    await new Promise(r => setTimeout(r, 2600));
    return {
      heads: Array.from(document.querySelectorAll('.oc-h')).map(x => x.textContent),
      text: Array.from(document.querySelectorAll('#ocPaper p')).map(x => x.textContent).join(' / ')
    };
  });
  ok('证婚人致辞单环节可出稿',
    witness.heads.some(h => h.indexOf('证婚人致辞') >= 0) && witness.text.length > 30,
    witness.heads.join(',') + ' | ' + witness.text.slice(0, 60));

  await page.screenshot({ path: '/tmp/shot_pack.png' });

  ok('无脚本报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter(r => !r.pass).length;
  console.log('[pack] ' + (results.length - failed) + '/' + results.length + ' 通过');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
