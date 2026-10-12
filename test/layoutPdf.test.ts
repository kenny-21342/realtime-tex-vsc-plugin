import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutNeedsPdf } from '../src/preview/layoutPdf';
import type { PageUpdate } from '../src/protocol';

const page = (exact: boolean): PageUpdate => ({ page: 1, hash: 1, exact, dl: { kind: 'page', fonts: {}, lines: [], other: [], width: 100, height: 100, depth: 0, flags: exact ? [] : { literal: 1 } } });
const native = { ops: [], transforms: [] };

test('exact and supported native pages avoid the document PDF', () => {
  assert.equal(layoutNeedsPdf([page(true), { ...page(false), native }], () => false), false);
});
test('unsupported page content and missing resources still require the PDF', () => {
  assert.equal(layoutNeedsPdf([page(false)], () => false), true);
  assert.equal(layoutNeedsPdf([{ ...page(false), native, dl: { ...page(false).dl, flags: { literal: 1, special: 1 } } }], () => false), true);
  assert.equal(layoutNeedsPdf([page(true)], () => true), true);
  assert.equal(layoutNeedsPdf([{ ...page(false), native }], () => true), true);
});
test('an unchanged retained fallback page is included in the decision', () => {
  assert.equal(layoutNeedsPdf([page(true), { ...page(false), page: 2 }], () => false), true);
});
