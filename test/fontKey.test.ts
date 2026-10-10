import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fontKey, isNullFont } from '../src/fontKey';

test('a font with neither name nor file is the null font', () => {
  assert.equal(isNullFont({ id: 27, name: null, fullname: null, psname: null, filename: null, format: null, size: null }), true);
  assert.equal(isNullFont({ id: 22, name: 'cmr12', format: 'unknown', size: 786432 }), false);
  assert.equal(isNullFont({ id: 72, filename: '/x/FandolSong-Regular.otf' }), false);
  assert.equal(fontKey({ id: 72, filename: '/x/FandolSong-Regular.otf', subfont: 1 }), 'file:/x/FandolSong-Regular.otf#1');
});
