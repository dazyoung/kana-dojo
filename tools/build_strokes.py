import json, re, sys, pathlib
src = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2])
pat = re.compile(r'<path id="kvg:[0-9a-f]+-s(\d+)"[^>]*\sd="([^"]+)"')
data = {}
for f in sorted(src.glob('*.svg')):
    ch = chr(int(f.stem, 16))
    strokes = sorted(((int(n), d) for n, d in pat.findall(f.read_text('utf-8'))))
    if strokes:
        data[ch] = [d for _, d in strokes]
js = ("// Stroke-order data generated from KanjiVG (https://kanjivg.tagaini.net)\n"
      "// Copyright (C) 2009/2010/2011 Ulrich Apel. Licensed CC BY-SA 3.0.\n"
      "// Each entry: list of SVG path strings in stroke order, viewBox 0 0 109 109.\n"
      "window.STROKES = " + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ";\n")
out.write_text(js, 'utf-8')
print(len(data), 'chars,', out.stat().st_size, 'bytes')
print({c: len(v) for c, v in data.items() if c in 'あきさふゆをんがぱアキヲン'})
