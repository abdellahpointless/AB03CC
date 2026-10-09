#!/usr/bin/env python3
"""Turns dist-single/index.html (vite-plugin-singlefile output) into the head-less fragment the artifact viewer expects."""
import re
import sys

src = sys.argv[1]
dst = sys.argv[2]
s = open(src, encoding='utf-8').read()
i = s.index('<script type="module"')
j = s.rindex('</script>') + len('</script>')
script = re.sub(r'<script type="module"[^>]*>', '<script type="module">', s[i:j], count=1)
rest = s[:i] + s[j:]
styles = re.findall(r'<style[^>]*>.*?</style>', rest, re.S)
assert styles, 'no <style> found outside the script'
open(dst, 'w', encoding='utf-8').write('<title>CNC Smart Planner</title>\n' + '\n'.join(styles) + '\n<div id="root"></div>\n' + script + '\n')
print(f'wrote {dst}: {len(styles)} style block(s), script {len(script):,} chars')
