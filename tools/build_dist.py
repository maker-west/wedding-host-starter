#!/usr/bin/env python3
"""
生成可发布的静态目录：dist/index.html（单文件版改名）
只放一个文件，避免把 node_modules / examples / 真实素材一起传上去。

用法：python3 tools/build_dist.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"


def main() -> int:
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "build_single.py")])
    if r.returncode != 0:
        return r.returncode
    src = ROOT / "工作台.html"
    if not src.exists():
        print("[dist] 没有 工作台.html", file=sys.stderr)
        return 1
    DIST.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, DIST / "index.html")
    kb = (DIST / "index.html").stat().st_size / 1024
    print("[dist] dist/index.html  %.0f KB" % kb)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
