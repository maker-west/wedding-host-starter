#!/usr/bin/env python3
""" 
把 index.html + styles.css + 各个 js 内联成单文件 工作台.html。
没有任何外链依赖：大模型走使用者自己填的接口，不需要云 SDK。

用法：python3 tools/build_single.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORDER = ['config.js', 'llm.js', 'importers.js', 'seed.js', 'engine.js', 'qr.js', 'audio.js', 'stylepacks.js', 'plan.js', 'app.js']


def main() -> int:
    index = ROOT / 'index.html'
    css = ROOT / 'styles.css'
    for f in [index, css] + [ROOT / x for x in ORDER]:
        if not f.exists():
            print('[build] 缺文件：%s' % f, file=sys.stderr)
            return 1

    html = index.read_text(encoding='utf-8')
    html = html.replace('<link rel="stylesheet" href="styles.css">',
                        '<style>\n' + css.read_text(encoding='utf-8') + '\n</style>')

    missing = []

    def inline_js(m):
        src = m.group(1)
        if src.startswith('http'):
            return m.group(0)
        p = ROOT / src
        if not p.exists():
            missing.append(src)
            return m.group(0)
        code = p.read_text(encoding='utf-8').replace('</script', '<\\/script')
        return '<script>\n/* ==== %s ==== */\n%s\n</script>' % (src, code)

    html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)

    out = ROOT / '工作台.html'
    out.write_text(html, encoding='utf-8')

    kb = len(html.encode('utf-8')) / 1024
    print('[build] %s  %.0f KB' % (out.name, kb))
    if missing:
        print('[build] 这些脚本没内联进单文件：%s' % ', '.join(missing), file=sys.stderr)
        return 1
    if '<link rel="stylesheet"' in html or 'src="' in html:
        print('[build] 警告：还有外链资源没内联', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
