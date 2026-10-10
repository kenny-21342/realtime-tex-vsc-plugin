import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DisplayList, NativePage } from '../src/protocol';
import { axialBand, cssColor, indexNative, nativeOf } from '../webview/native';

const dl = (flags: unknown): DisplayList => ({ kind: 'page', fonts: {}, lines: [], other: [], flags, width: 0, height: 0, depth: 0 });
const native: NativePage = {
  ops: [
    { op: 'Save', at: { line: 2, item: 4 } },
    { op: 'Paint', at: { line: 2, item: 5 }, ctm: [1, 0, 0, 1, 0, 0], path: [{ s: 'M', x: 0, y: 0 }, { s: 'L', x: 1, y: 1 }], fill: null, even_odd: false, stroke: null },
    { op: 'Restore', at: { line: 2, item: 5 } },
    { op: 'Save', at: { line: null, item: 0 } },
  ],
  transforms: [[{ line: 2, item: 7 }, [2, 0, 0, 2, 0, 0]]],
};

test('native drawing is used only for degraded pages whose flags it resolves', () => {
  assert.equal(nativeOf({ exact: false, dl: dl({ literal: 3 }), native }), native);
  assert.equal(nativeOf({ exact: false, dl: dl({ literal: 3, shading: 1 }), native }), native);
  // anything else on the page (a \special, an unknown box resource) keeps the PDF
  assert.equal(nativeOf({ exact: false, dl: dl({ literal: 3, special: 1 }), native }), undefined);
  assert.equal(nativeOf({ exact: false, dl: dl({ literal: 3 }) }), undefined);
  assert.equal(nativeOf({ exact: true, dl: dl([]), native }), undefined);
});

test('operations are indexed by row and by the item they follow, in order', () => {
  const rows = indexNative(native);
  const r2 = rows.get(2)!;
  assert.deepEqual(r2.after.get(4)!.map((o) => o.op), ['Save']);
  assert.deepEqual(r2.after.get(5)!.map((o) => o.op), ['Paint', 'Restore']);
  assert.deepEqual(r2.transforms.get(7), [2, 0, 0, 2, 0, 0]);
  assert.deepEqual(rows.get(null)!.after.get(0)!.map((o) => o.op), ['Save']);
});

test('colors and the band of an unextended axial shading', () => {
  assert.equal(cssColor({ comps: [1, 0, 0], alpha: 0.5 }), 'rgba(255,0,0,0.5)');
  assert.equal(cssColor({ comps: [0.5], alpha: 1 }), 'rgba(128,128,128,1)');
  // CMYK as pdf.js shows it (and so as the PDF fallback looks)
  assert.equal(cssColor({ comps: [0, 1, 0, 0], alpha: 1 }), 'rgba(251,49,153,1)');
  assert.equal(cssColor({ comps: [0, 0, 0, 0], alpha: 1 }), 'rgba(255,255,255,1)');
  assert.equal(cssColor({ comps: [0, 0, 0, 1], alpha: 1 }), 'rgba(44,46,53,1)');
  // horizontal axis from x=0 to x=10: the band is everything between the vertical lines there
  const band = axialBand([0, 0, 10, 0], [0, 0, 10, 5])!;
  const xs = band.map(([x]) => x).sort((a, b) => a - b);
  assert.deepEqual([xs[0], xs[3]].map(Math.round), [0, 10]);
  assert.ok(Math.max(...band.map(([, y]) => Math.abs(y))) > 5);
  assert.equal(axialBand([1, 1, 1, 1], [0, 0, 1, 1]), undefined);
});
