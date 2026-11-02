'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryStore, createCache } = require('../extension/src/cache.js');

const rec = (n) => ({ entries: [{ card_id: n, count: 1 }], total: 1, freshness: `f${n}`, template: { a: n }, loadedAt: n });

test('put puis get rend le même contenu', async () => {
  const c = createCache(memoryStore());
  await c.put('A', rec(1));
  assert.deepEqual(await c.get('A'), rec(1));
});

test('séparation par compte', async () => {
  const c = createCache(memoryStore());
  await c.put('A', rec(1));
  assert.equal(await c.get('B'), null);
});

test('cache vide et lastUserId', async () => {
  const c = createCache(memoryStore());
  assert.equal(await c.get('A'), null);
  assert.equal(await c.getLastUserId(), null);
  await c.setLastUserId('A');
  assert.equal(await c.getLastUserId(), 'A');
});

test('put écrase', async () => {
  const c = createCache(memoryStore());
  await c.put('A', rec(1));
  await c.put('A', rec(2));
  assert.deepEqual(await c.get('A'), rec(2));
});

test('memoryStore rend des copies', async () => {
  const c = createCache(memoryStore());
  const r = rec(1);
  await c.put('A', r);
  r.entries.push('x');
  const got = await c.get('A');
  got.entries.push('y');
  assert.deepEqual(await c.get('A'), rec(1));
});

test('putPartial / getPartial / clearPartial, séparés par compte, en copies', async () => {
  const c = createCache(memoryStore());
  assert.equal(await c.getPartial('A'), null);
  const part = { entries: [{ id: 'a' }], nextPage: 3, pageCount: 9, savedAt: 5 };
  await c.putPartial('A', part);
  part.entries.push({ id: 'b' });
  assert.deepEqual(await c.getPartial('A'), { entries: [{ id: 'a' }], nextPage: 3, pageCount: 9, savedAt: 5 });
  assert.equal(await c.getPartial('B'), null);
  assert.equal(await c.get('A'), null);
  await c.clearPartial('A');
  assert.equal(await c.getPartial('A'), null);
});
