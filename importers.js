/* ================================================================
   文件取文：PDF / Word(.docx) / Excel(.xlsx) / CSV / TXT
   - docx/xlsx 是 zip，用 DecompressionStream 直接解，不依赖外部库
   - PDF 用 pdf.js（CDN），worker 走 Blob URL，避免跨域 Worker 被拦
   ================================================================ */
window.Importers = (function () {
  'use strict';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('脚本加载失败：' + src));
      document.head.appendChild(s);
    });
  }

  /* ---------- zip ---------- */
  function findEOCD(dv, len) {
    const min = Math.max(0, len - 66000);
    for (let i = len - 22; i >= min; i--) if (dv.getUint32(i, true) === 0x06054b50) return i;
    return -1;
  }
  function readZip(buf) {
    const dv = new DataView(buf);
    const eocd = findEOCD(dv, buf.byteLength);
    if (eocd < 0) throw new Error('文件结构不是标准 zip（老版 .doc / .xls 不支持）');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const csize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const cmtLen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      const name = new TextDecoder('utf-8').decode(new Uint8Array(buf, off + 46, nameLen));
      const lnameLen = dv.getUint16(lho + 26, true);
      const lextraLen = dv.getUint16(lho + 28, true);
      const dataStart = lho + 30 + lnameLen + lextraLen;
      files[name] = { method: method, data: new Uint8Array(buf, dataStart, csize) };
      off += 46 + nameLen + extraLen + cmtLen;
    }
    return files;
  }
  async function entryText(entry) {
    if (!entry) return '';
    if (entry.method === 0) return new TextDecoder('utf-8', { fatal: false }).decode(entry.data);
    if (typeof DecompressionStream === 'undefined') throw new Error('这个浏览器不支持解压，请换成 Chrome / Edge / Safari 16.4+');
    const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }
  const unesc = (s) => String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');

  /* ---------- docx ---------- */
  async function docxText(buf) {
    const files = readZip(buf);
    const xml = await entryText(files['word/document.xml']);
    if (!xml) throw new Error('这个 Word 文件里没读到正文');
    const body = xml
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '');
    return unesc(body).replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------- xlsx ---------- */
  async function xlsxText(buf) {
    const files = readZip(buf);
    const sharedXml = await entryText(files['xl/sharedStrings.xml']);
    const shared = [];
    if (sharedXml) {
      const items = sharedXml.match(/<si[\s\S]*?<\/si>/g) || [];
      items.forEach(si => {
        const texts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        shared.push(unesc(texts.map(t => t.replace(/<[^>]+>/g, '')).join('')));
      });
    }
    const sheetNames = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
    if (!sheetNames.length) throw new Error('这个表格里没读到工作表');
    const lines = [];
    for (const name of sheetNames.slice(0, 3)) {
      const xml = await entryText(files[name]);
      const rows = xml.match(/<row[\s\S]*?<\/row>/g) || [];
      rows.forEach(r => {
        const cells = r.match(/<c[^>]*>[\s\S]*?<\/c>|<c[^>]*\/>/g) || [];
        const vals = cells.map(c => {
          const isStr = /t="s"/.test(c);
          const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          if (v == null) {
            const inline = (c.match(/<is>[\s\S]*?<\/is>/) || [])[0];
            return inline ? unesc(inline.replace(/<[^>]+>/g, '')) : '';
          }
          return isStr ? (shared[Number(v)] || '') : unesc(v);
        }).map(x => String(x).trim());
        const filled = vals.filter(Boolean);
        if (!filled.length) return;
        // 两列且左列是短标签（项目/新人/场地…）就写成「标签：值」，比用制表符更好读、也更好认
        if (filled.length === 2 && vals[0] && vals[0].length <= 8) lines.push(vals[0] + '：' + vals[1]);
        else lines.push(filled.join(' '));
      });
    }
    return lines.join('\n');
  }

  /* ---------- pdf ---------- */
  let pdfjsPromise = null;
  function ensurePdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsPromise) return pdfjsPromise;
    const base = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
    pdfjsPromise = (async () => {
      await loadScript(base + 'pdf.min.js');
      const lib = window.pdfjsLib;
      if (!lib) throw new Error('PDF 解析库没加载成功（可能没联网）');
      try {
        const code = await (await fetch(base + 'pdf.worker.min.js')).text();
        lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      } catch (e) {
        lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
      }
      return lib;
    })();
    return pdfjsPromise;
  }
  async function pdfText(buf) {
    const lib = await ensurePdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    const out = [];
    const max = Math.min(doc.numPages, 30);
    for (let p = 1; p <= max; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let line = '';
      tc.items.forEach(it => { line += it.str + (it.hasEOL ? '\n' : ''); });
      out.push(line.replace(/[ \t]{2,}/g, ' ').trim());
    }
    return out.join('\n\n').trim();
  }

  function extOf(name) { return String(name).toLowerCase().split('.').pop(); }

  /* PDF 里的字常被拆成「康熙部首」兼容字符（新人 → 新⼈），NFKC 能规整回正常汉字 */
  const fixGlyphs = (s) => {
    try { return String(s).normalize('NFKC'); } catch (e) { return String(s); }
  };

  async function extract(file) {
    const ext = extOf(file.name);
    const buf = await file.arrayBuffer();
    let out;
    if (ext === 'pdf') {
      const t = await pdfText(buf);
      if (t.replace(/\s/g, '').length < 40) {
        throw new Error('这份 PDF 里没有可复制的文字（多半是扫描件或截图），解析不出内容。可以让新人用「问卷文字版」回一段文字，或把里面的字直接贴进下面的框里');
      }
      out = { text: t, kind: 'PDF' };
    }
    else if (ext === 'docx') out = { text: await docxText(buf), kind: 'Word' };
    else if (ext === 'xlsx') out = { text: await xlsxText(buf), kind: 'Excel' };
    else if (ext === 'doc' || ext === 'xls') throw new Error('老版 .doc / .xls 解析不了，用 Word/Excel 另存为 .docx / .xlsx 再导');
    else if (ext === 'csv' || ext === 'tsv' || ext === 'txt' || ext === 'md') {
      out = { text: new TextDecoder('utf-8', { fatal: false }).decode(buf), kind: ext.toUpperCase() };
    } else throw new Error('不支持的文件类型：.' + ext);
    out.text = fixGlyphs(out.text);
    return out;
  }

  return { extract };
})();
