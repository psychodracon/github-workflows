import assert from 'node:assert/strict';
import { test } from 'node:test';
import { greeting } from './greeting.js';

test('greeting', () => {
  assert.equal(greeting, 'fixture ok');
});
