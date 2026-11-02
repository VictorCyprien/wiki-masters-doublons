'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { installInterceptor } = require('../extension/src/interceptor.js');

function makeTarget() {
  const marker = { marker: true };
  const calls = [];
  const target = {
    fetch(...args) { calls.push({ self: this, args }); return marker; },
  };
  return { target, marker, calls };
}

test('sans interception : même valeur, mêmes arguments', () => {
  const { target, marker, calls } = makeTarget();
  installInterceptor({ target, shouldIntercept: () => false, respond: () => ({}) });
  const opts = { method: 'GET' };
  assert.equal(target.fetch('/api/boosters', opts), marker);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['/api/boosters', opts]);
  assert.equal(calls[0].args[1], opts);
  assert.equal(calls[0].self, target);
});

test('interception : réponse 200 JSON, original non appelé', async () => {
  const { target, calls } = makeTarget();
  const logs = [];
  installInterceptor({
    target,
    shouldIntercept: () => true,
    respond: () => ({ a: 1 }),
    log: (...a) => logs.push(a),
  });
  const res = await target.fetch('/api/my-collection?page=0');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.deepEqual(await res.json(), { a: 1 });
  assert.equal(calls.length, 0);
  const serve = logs.find((l) => l[0] === 'intercept:serve');
  assert.deepEqual(serve[1], { path: '/api/my-collection?page=0' });
});

test('respond lève : retombée sur l\'original', () => {
  const { target, marker, calls } = makeTarget();
  const logs = [];
  installInterceptor({
    target, shouldIntercept: () => true,
    respond: () => { throw new Error('boom'); },
    log: (...a) => logs.push(a),
  });
  assert.equal(target.fetch('/x'), marker);
  assert.equal(calls.length, 1);
  assert.ok(logs.some((l) => l[0] === 'intercept:fallback'));
});

test('respond asynchrone rejette : retombée sur l\'original', async () => {
  const { target, marker, calls } = makeTarget();
  installInterceptor({
    target, shouldIntercept: () => true,
    respond: async () => { throw new Error('boom'); },
  });
  assert.equal(await target.fetch('/x'), marker);
  assert.equal(calls.length, 1);
});

test('respond asynchrone résout : réponse substituée', async () => {
  const { target, calls } = makeTarget();
  installInterceptor({ target, shouldIntercept: () => true, respond: async () => ({ b: 2 }) });
  const res = await target.fetch('/x');
  assert.deepEqual(await res.json(), { b: 2 });
  assert.equal(calls.length, 0);
});

test('shouldIntercept lève : retombée sur l\'original', () => {
  const { target, marker, calls } = makeTarget();
  installInterceptor({
    target, shouldIntercept: () => { throw new Error('boom'); }, respond: () => ({}),
  });
  assert.equal(target.fetch('/x'), marker);
  assert.equal(calls.length, 1);
});

test('lit l\'URL d\'un Request et d\'un URL', () => {
  const { target } = makeTarget();
  const seen = [];
  installInterceptor({ target, shouldIntercept: (u) => { seen.push(u); return false; }, respond: () => ({}) });
  target.fetch(new Request('https://www.wiki-masters.com/api/my-collection?page=0'));
  target.fetch(new URL('https://www.wiki-masters.com/api/my-collection/stats'));
  assert.deepEqual(seen, [
    'https://www.wiki-masters.com/api/my-collection?page=0',
    'https://www.wiki-masters.com/api/my-collection/stats',
  ]);
});

test('uninstall restaure le fetch d\'origine', () => {
  const { target } = makeTarget();
  const original = target.fetch;
  const h = installInterceptor({ target, shouldIntercept: () => false, respond: () => ({}) });
  assert.notEqual(target.fetch, original);
  assert.equal(h.originalFetch, original);
  h.uninstall();
  assert.equal(target.fetch, original);
});

test('onSettled : appelé pour un appel surveillé, réel ou substitué', async () => {
  const { target } = makeTarget();
  const settled = [];
  let intercept = false;
  installInterceptor({
    target, shouldIntercept: () => intercept, respond: () => ({}),
    isWatched: () => true, onSettled: (u, i) => settled.push([u, i]),
  });
  await target.fetch('/a');
  assert.deepEqual(settled, [['/a', false]]);
  intercept = true;
  await target.fetch('/b');
  assert.deepEqual(settled, [['/a', false], ['/b', true]]);
});

test('onSettled : réponse réelle identique, erreur réseau préservée, exception ignorée', async () => {
  const marker = { m: 1 };
  const target = { fetch: () => Promise.resolve(marker) };
  const settled = [];
  installInterceptor({
    target, shouldIntercept: () => false, respond: () => ({}),
    isWatched: () => true, onSettled: (u, i) => { settled.push([u, i]); throw new Error('x'); },
  });
  assert.equal(await target.fetch('/a'), marker);
  const err = new Error('net');
  target.fetch = (() => { const o = target.fetch; return o; })();
  const t2 = { fetch: () => Promise.reject(err) };
  installInterceptor({
    target: t2, shouldIntercept: () => false, respond: () => ({}),
    isWatched: () => true, onSettled: (u, i) => settled.push([u, i]),
  });
  await assert.rejects(t2.fetch('/b'), err);
  assert.deepEqual(settled, [['/a', false], ['/b', false]]);
});

test('isWatched faux : onSettled jamais appelé', async () => {
  const { target } = makeTarget();
  let n = 0;
  installInterceptor({
    target, shouldIntercept: () => false, respond: () => ({}),
    isWatched: () => false, onSettled: () => { n++; },
  });
  await target.fetch('/a');
  assert.equal(n, 0);
});

test('respond asynchrone renvoie un objet non sérialisable : retombée sur l\'original, une seule fois', async () => {
  const { target, marker, calls } = makeTarget();
  installInterceptor({
    target, shouldIntercept: () => true,
    respond: async () => { const o = {}; o.o = o; return o; },
  });
  assert.equal(await target.fetch('/x'), marker);
  assert.equal(calls.length, 1);
});
