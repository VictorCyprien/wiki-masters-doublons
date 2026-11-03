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

test('onFallback : appelé avec l\'URL et l\'erreur, en synchrone et en asynchrone', async () => {
  const seen = [];
  const a = makeTarget();
  installInterceptor({
    target: a.target, shouldIntercept: () => true,
    respond: () => { throw new Error('sync'); },
    onFallback: (url, err) => seen.push([url, err.message]),
  });
  a.target.fetch('/x?a=1');
  const b = makeTarget();
  installInterceptor({
    target: b.target, shouldIntercept: () => true,
    respond: async () => { throw new Error('async'); },
    onFallback: (url, err) => seen.push([url, err.message]),
  });
  await b.target.fetch('/y');
  assert.deepEqual(seen, [['/x?a=1', 'sync'], ['/y', 'async']]);
});

test('onFallback qui lève : la retombée sur l\'original a lieu quand même', async () => {
  const { target, marker, calls } = makeTarget();
  installInterceptor({
    target, shouldIntercept: () => true,
    respond: async () => { throw new Error('boom'); },
    onFallback: () => { throw new Error('rappel'); },
  });
  assert.equal(await target.fetch('/x'), marker);
  assert.equal(calls.length, 1);
});

test('onFallback : jamais appelé sans échec', async () => {
  let n = 0;
  const a = makeTarget();
  installInterceptor({ target: a.target, shouldIntercept: () => false, respond: () => ({}), onFallback: () => { n += 1; } });
  a.target.fetch('/x');
  const b = makeTarget();
  installInterceptor({ target: b.target, shouldIntercept: () => true, respond: async () => ({ ok: 1 }), onFallback: () => { n += 1; } });
  await b.target.fetch('/x');
  assert.equal(n, 0);
});

const okFetch = (status = 204) => () => Promise.resolve({ status });
function withOnResponse(fetchImpl, over = {}) {
  const target = { fetch: fetchImpl };
  const seen = [];
  installInterceptor({
    target, shouldIntercept: () => false, respond: () => ({}),
    onResponse: (r) => seen.push(r), ...over,
  });
  return { target, seen };
}

test('onResponse : PATCH non intercepté reçoit url, méthode, corps, statut', async () => {
  const { target, seen } = withOnResponse(okFetch(204));
  await target.fetch('/rest/v1/user_cards?id=eq.a', { method: 'patch', body: '{"starred":true}', headers: { apikey: 'secret' } });
  assert.deepEqual(seen, [{ url: '/rest/v1/user_cards?id=eq.a', method: 'PATCH', body: '{"starred":true}', status: 204 }]);
});

test('onResponse : GET et HEAD jamais', async () => {
  const { target, seen } = withOnResponse(okFetch(200));
  await target.fetch('/a');
  await target.fetch('/a', { method: 'GET' });
  await target.fetch('/a', { method: 'HEAD' });
  assert.deepEqual(seen, []);
});

test('onResponse : appel intercepté jamais', async () => {
  const { target, seen } = withOnResponse(okFetch(200), { shouldIntercept: () => true, respond: () => ({}) });
  await target.fetch('/a', { method: 'POST', body: 'x' });
  assert.deepEqual(seen, []);
});

test('onResponse : le rappel qui lève ne change pas la valeur de l\'original', async () => {
  const marker = { status: 201 };
  const { target } = withOnResponse(() => Promise.resolve(marker), { onResponse: () => { throw new Error('x'); } });
  assert.equal(await target.fetch('/a', { method: 'POST', body: 'x' }), marker);
});

test('onResponse : rejet réseau préservé, rappel non appelé', async () => {
  const err = new Error('net');
  const { target, seen } = withOnResponse(() => Promise.reject(err));
  await assert.rejects(target.fetch('/a', { method: 'DELETE' }), err);
  assert.deepEqual(seen, []);
});

test('onResponse : Request DELETE, corps null', async () => {
  const { target, seen } = withOnResponse(okFetch(204));
  await target.fetch({ url: '/rest/v1/user_card_tags?x=1', method: 'DELETE' });
  assert.deepEqual(seen, [{ url: '/rest/v1/user_card_tags?x=1', method: 'DELETE', body: null, status: 204 }]);
});

test('onResponse : corps non texte donne null', async () => {
  const { target, seen } = withOnResponse(okFetch(200));
  await target.fetch('/a', { method: 'POST', body: new Uint8Array([1]) });
  assert.equal(seen[0].body, null);
});

test('onResponse : vu avant le then du site', async () => {
  const order = [];
  const { target } = withOnResponse(okFetch(204), { onResponse: () => order.push('rappel') });
  await target.fetch('/a', { method: 'POST', body: '{}' }).then(() => order.push('site'));
  assert.deepEqual(order, ['rappel', 'site']);
});

test('onResponse : vrai Request DELETE', async () => {
  const { target, seen } = withOnResponse(okFetch(204));
  await target.fetch(new Request('https://x.test/rest/v1/user_card_tags?a=eq.1', { method: 'DELETE' }));
  assert.deepEqual(seen, [{ url: 'https://x.test/rest/v1/user_card_tags?a=eq.1', method: 'DELETE', body: null, status: 204 }]);
});

test('onResponse : ReadableStream et FormData donnent body null, corps non consommé', async () => {
  const { target, seen } = withOnResponse(okFetch(200));
  const stream = new ReadableStream();
  await target.fetch('/a', { method: 'POST', body: stream });
  await target.fetch('/a', { method: 'POST', body: new FormData() });
  assert.equal(seen[0].body, null);
  assert.equal(seen[1].body, null);
  assert.equal(stream.locked, false);
});
