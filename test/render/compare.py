#!/usr/bin/env python3
"""Compare the preview's drawing of pages (test/render/run.ts PNGs) with MuPDF's rendering.

Usage: compare.py PDF PNG_DIR DPI [--diff N] [--max SHARE] [--require-native]
Per page: the share of pixels whose largest channel difference exceeds 64/255 (ink where the
other has none, or missing ink), after a 1-pixel tolerance for anti-aliasing (a pixel counts
only when no pixel within 1 px of it in the other image is close). --diff N writes diff images
for the N worst pages (red: only in the preview, blue: only in the PDF). --max SHARE: exit 1
when a page's preview-only plus pdf-only share exceeds SHARE (CI uses 0.06; anti-aliasing and
hinting alone stay near 0.03). --require-native: exit 1 when a page is not drawn natively.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image


def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(np.int16)


def near(a, b, tol=64):
    """For each pixel of a: is some pixel of b within 1 px close to it?"""
    h, w, _ = a.shape
    ok = np.zeros((h, w), bool)
    pb = np.pad(b, ((1, 1), (1, 1), (0, 0)), mode="edge")
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            ok |= np.abs(a - pb[dy:dy + h, dx:dx + w]).max(axis=2) <= tol
    return ok


def main():
    pdf, pngdir, dpi = sys.argv[1], Path(sys.argv[2]), int(sys.argv[3])
    ndiff = int(sys.argv[sys.argv.index("--diff") + 1]) if "--diff" in sys.argv else 0
    limit = float(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else None
    require_native = "--require-native" in sys.argv
    doc = pymupdf.open(pdf)
    summary = {s["page"]: s for s in json.load(open(pngdir / "summary.json"))}
    rows = []
    for n, s in sorted(summary.items()):
        ours = load(pngdir / f"page{n}.png")
        pix = doc[n - 1].get_pixmap(dpi=dpi, alpha=False)
        ref = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, 3).astype(np.int16)
        h, w = min(ours.shape[0], ref.shape[0]), min(ours.shape[1], ref.shape[1])
        ours, ref = ours[:h, :w], ref[:h, :w]
        bad_ours = ~near(ours, ref)
        bad_ref = ~near(ref, ours)
        ink = (ref.max(axis=2) < 200).sum() or 1
        rows.append((n, s, bad_ours.sum() / ink, bad_ref.sum() / ink, bad_ours, bad_ref, ref))
    for n, s, a, b, *_ in rows:
        print(f"page {n}: {'native' if s['native'] else 'not native (' + str(s['reason']) + ')'}; "
              f"differing pixels / ink: preview-only {a:.4f}, pdf-only {b:.4f}")
    worst = sorted(rows, key=lambda r: -(r[2] + r[3]))[:ndiff]
    for n, _, _, _, bo, br, ref in worst:
        img = np.full(ref.shape, 255, np.uint8)
        img[(ref.max(axis=2) < 200)] = (200, 200, 200)
        img[bo] = (230, 0, 0)
        img[br] = (0, 0, 230)
        Image.fromarray(img).save(pngdir / f"diff-page{n}.png")
    if rows:
        print("worst page (preview-only + pdf-only):", max((r[2] + r[3], r[0]) for r in rows))
    failed = []
    if limit is not None:
        failed += [f"page {r[0]}: {r[2] + r[3]:.4f} > {limit}" for r in rows if r[2] + r[3] > limit]
    if require_native:
        failed += [f"page {n}: not native ({s['reason']})" for n, s, *_ in rows if not s["native"]]
    if not rows:
        failed.append("no pages")
    for f in failed:
        print("FAIL", f)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
