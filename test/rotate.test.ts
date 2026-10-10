import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displaySize, rotationOf, turn, unturn } from '../webview/rotate';

const apply = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

test('rotation is normalized to quarter turns', () => {
  assert.equal(rotationOf(undefined), 0);
  assert.equal(rotationOf({ rotate: 90 }), 90);
  assert.equal(rotationOf({ rotate: -90 }), 270);
  assert.equal(rotationOf({ rotate: 450 }), 90);
  assert.equal(rotationOf({ rotate: 45 }), 0);
});

test('a turned page swaps its sides at 90 and 270 degrees', () => {
  assert.deepEqual(displaySize(600, 800, 0), [600, 800]);
  assert.deepEqual(displaySize(600, 800, 90), [800, 600]);
  assert.deepEqual(displaySize(600, 800, 180), [600, 800]);
  assert.deepEqual(displaySize(600, 800, 270), [800, 600]);
});

test('corners go where a PDF viewer puts them, and back', () => {
  const [w, h] = [600, 800];
  // clockwise: at 90 the top-left corner is at the top right, the bottom-left at the top left
  assert.deepEqual(apply(turn(90, w, h), 0, 0), [800, 0]);
  assert.deepEqual(apply(turn(90, w, h), 0, h), [0, 0]);
  assert.deepEqual(apply(turn(180, w, h), 0, 0), [600, 800]);
  assert.deepEqual(apply(turn(270, w, h), 0, 0), [0, 600]);
  for (const rot of [0, 90, 180, 270]) {
    for (const [x, y] of [
      [0, 0],
      [123, 456],
      [w, h],
    ]) {
      const [X, Y] = apply(turn(rot, w, h), x, y);
      assert.deepEqual(unturn(rot, w, h, X, Y), [x, y], `rot ${rot} (${x}, ${y})`);
    }
  }
});
