/// <reference lib="dom" />
/// <reference path="../webview/opentype.d.ts" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DisplayList, NativePage } from '../src/protocol';
import { drawOverlay } from '../webview/overlay';
import { FontStore, ImageStore } from '../webview/render';

test('native paths and rotated labels share the overlay row placement exactly once', () => {
  const transforms: number[][] = [];
  const glyphs: string[] = [];
  let strokes = 0;
  const ctx = {
    setTransform: (...m: number[]) => transforms.push(m),
    stroke: () => strokes++, setLineDash: () => {},
    fillText: (s: string) => glyphs.push(s),
  } as unknown as CanvasRenderingContext2D;
  const oldPath = globalThis.Path2D;
  globalThis.Path2D = class { moveTo() {} lineTo() {} } as unknown as typeof Path2D;
  try {
    const line = { x: 0, y: 7, w: 100, h: 7, d: 0, items: [['l', 0, 'S', 0, 0], ['g', 1, 65, null, 10, 20, 5, 0]] };
    const dl: DisplayList = { kind: 'paragraph', fonts: { '1': { id: 1, size: 100, name: 'Example' } }, lines: [{ ...line, items: line.items as DisplayList['lines'][number]['items'] }], other: [], flags: { literal: 1 }, width: 100, height: 7, depth: 0 };
    const native: NativePage = {
      ops: [{ op: 'Paint', at: { line: 0, item: 0 }, ctm: [1, 0, 0, 1, 3, 4], path: [{ s: 'M', x: 0, y: 0 }, { s: 'L', x: 1, y: 2 }], fill: null, even_odd: false, stroke: { color: { comps: [0], alpha: 1 }, width: 1, cap: 0, join: 0, miter_limit: 10, dash: [], dash_phase: 0 } }],
      transforms: [[{ line: 0, item: 1 }, [0, 1, -1, 0, 0, 0]]],
    };
    drawOverlay(ctx, [2, 0, 0, 2, 5, 6], new FontStore(), new ImageStore(async () => { throw new Error('unused'); }), {
      overlay: { parId: 1, dl, native, fragments: [], revision: 1 },
      rows: [{ index: 0, line: dl.lines[0], dx: 100, dy: 200 }],
    });
    assert.equal(strokes, 1, 'the drawing must be painted');
    assert.deepEqual(glyphs, ['A'], 'the label must be painted');
    assert.deepEqual(transforms, [[2, 0, 0, 2, 211, 414], [0, 2, -2, 0, 165, 426]]);
  } finally { globalThis.Path2D = oldPath; }
});


test('initial colour stacks remain in force across translated overlay rows', () => {
  const colours: unknown[] = [];
  const ctx = {
    fillStyle: '', setTransform: () => {}, fillText: () => colours.push(ctx.fillStyle),
  } as unknown as CanvasRenderingContext2D;
  const row = { x: 0, y: 0, w: 100, h: 7, d: 0, items: [['g', 1, 65, null, 10, 20, 5, 0]] as DisplayList['lines'][number]['items'] };
  const dl: DisplayList = { kind: 'paragraph', fonts: { '1': { id: 1, name: 'Example', size: 100 } }, lines: [row, row], other: [['c', 0, 0, '0 0 1 rg 0 0 1 RG']], flags: [], width: 100, height: 20, depth: 0 };
  drawOverlay(ctx, [1, 0, 0, 1, 0, 0], new FontStore(), new ImageStore(async () => { throw new Error('unused'); }), {
    overlay: { parId: 1, dl, fragments: [], revision: 1 },
    rows: [{ index: 0, line: row, dx: 20, dy: 40 }, { index: 1, line: row, dx: 20, dy: 60 }],
  });
  assert.deepEqual(colours, ['rgb(0,0,255)', 'rgb(0,0,255)']);
});
