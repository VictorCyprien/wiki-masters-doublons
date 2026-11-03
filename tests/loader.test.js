'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  IncompleteLoadError, AbortedLoadError, parseRetryAfter, loadAllPages, loadNewEntries, createSerialFetch,
} = require('../extension/src/loader.js');

const parseList = (json) => json.collection || [];
const range = (from, to) => Array.from({ length: to - from }, (_, i) => ({ id: `e${from + i}` }));
const ok = (entries) => new Response(JSON.stringify({ collection: entries }), { status: 200 });
const status = (code, headers = {}) => new Response('{}', { status: code, headers });

// Environnement factice : sleep instantané qui enregistre ses durées, fetchPage instrumenté.
function env(pages, extra = {}) {
  const sleeps = [];
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const controller = new AbortController();
  const e = {
    sleeps, calls, controller,
    get maxInFlight() { return maxInFlight; },
    fetchPage: async (page) => {
      calls.push(page);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      const r = typeof pages === 'function' ? pages(page, calls) : pages[page];
      if (r instanceof Error) throw r;
      return r;
    },
    parseList,
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => 0,
    signal: controller.signal,
    ...extra,
  };
  return e;
}

const rejectsWith = (p, props) => assert.rejects(p, (err) => {
  for (const [k, v] of Object.entries(props)) assert.equal(err[k], v, k);
  return true;
});

test('loadAllPages lit tout, poliment, avec progression', async () => {
  const progress = [];
  const e = env([ok(range(0, 50)), ok(range(50, 100)), ok(range(100, 150))], { onProgress: (p) => progress.push(p) });
  const { entries } = await loadAllPages({ ...e, pageCount: 3, expectedTotal: 150 });
  assert.equal(entries.length, 150);
  assert.deepEqual(e.sleeps, [400, 400]);
  assert.equal(e.maxInFlight, 1);
  assert.deepEqual(progress, [1, 2, 3].map((pagesRead) => ({ pagesRead, pageCount: 3 })));
});

test('page vide avant pageCount : lecture incomplète empty-page (reprise possible)', async () => {
  const pages = () => [ok(range(0, 50)), ok(range(50, 100)), ok([])];
  await rejectsWith(loadAllPages({ ...env(pages()), pageCount: 3, expectedTotal: 100 }), { name: 'IncompleteLoadError', reason: 'empty-page', page: 2 });
  await rejectsWith(loadAllPages({ ...env(pages()), pageCount: 3, expectedTotal: null }), { reason: 'empty-page', page: 2 });
});

test('expectedTotal null : aucun contrôle', async () => {
  const r = await loadAllPages({ ...env([ok(range(0, 5))]), pageCount: 1, expectedTotal: null });
  assert.equal(r.entries.length, 5);
});

test('même id sur deux pages : dédoublonné, donc mismatch avec le nombre brut', async () => {
  const e = env([ok(range(0, 50)), ok(range(49, 99))]);
  await rejectsWith(loadAllPages({ ...e, pageCount: 2, expectedTotal: 100 }), { reason: 'mismatch' });
});

test('429 avec Retry-After puis 200 : une nouvelle tentative', async () => {
  const e = env((page, calls) => (calls.length === 1 ? status(429, { 'Retry-After': '2' }) : ok(range(0, 3))));
  const r = await loadAllPages({ ...e, pageCount: 1, expectedTotal: 3 });
  assert.equal(r.entries.length, 3);
  assert.deepEqual(e.sleeps, [2000]);
  assert.deepEqual(e.calls, [0, 0]);
});

test('Retry-After trop long : retry-after, aucun sleep de 120 s', async () => {
  const e = env([status(429, { 'Retry-After': '120' })]);
  await rejectsWith(loadAllPages({ ...e, pageCount: 1, expectedTotal: null }), { reason: 'retry-after', status: 429 });
  assert.ok(!e.sleeps.includes(120000));
});

test('401 : arrêt immédiat sans attente ; exception de fetchPage persistante : network après 3 essais', async () => {
  const e1 = env([status(401)]);
  await rejectsWith(loadAllPages({ ...e1, pageCount: 1, expectedTotal: null }), { reason: 'http', status: 401 });
  assert.deepEqual(e1.sleeps, []);
  const e2 = env(() => new TypeError('boom'));
  await rejectsWith(loadAllPages({ ...e2, pageCount: 1, expectedTotal: null }), { reason: 'network', status: null, page: 0 });
  assert.deepEqual(e2.sleeps, [5000, 15000, 45000]);
});

test('503 sans Retry-After puis 200 : une attente de 5000, succès', async () => {
  const e = env((page, calls) => (calls.length === 1 ? status(503) : ok(range(0, 3))));
  const r = await loadAllPages({ ...e, pageCount: 1, expectedTotal: 3 });
  assert.equal(r.entries.length, 3);
  assert.deepEqual(e.sleeps, [5000]);
  assert.deepEqual(e.calls, [0, 0]);
});

test('503 quatre fois : attentes 5, 15, 45 s puis IncompleteLoadError 503', async () => {
  const e = env(() => status(503));
  await rejectsWith(loadAllPages({ ...e, pageCount: 2, expectedTotal: null }), { name: 'IncompleteLoadError', reason: 'http', status: 503, page: 0 });
  assert.deepEqual(e.sleeps, [5000, 15000, 45000]);
  assert.equal(e.calls.length, 4);
});

test('rejet réseau puis 200 : une attente de 5000, succès', async () => {
  const e = env((page, calls) => (calls.length === 1 ? new TypeError('reset') : ok(range(0, 2))));
  const r = await loadAllPages({ ...e, pageCount: 1, expectedTotal: 2 });
  assert.equal(r.entries.length, 2);
  assert.deepEqual(e.sleeps, [5000]);
});

test('corps illisible : nouvel essai', async () => {
  const e = env((page, calls) => (calls.length === 1 ? new Response('pas du json', { status: 200 }) : ok(range(0, 2))));
  const r = await loadAllPages({ ...e, pageCount: 1, expectedTotal: 2 });
  assert.equal(r.entries.length, 2);
  assert.deepEqual(e.sleeps, [5000]);
});

test('Retry-After: 2 puis 200 : attente 2000 ; loadNewEntries suit la même politique', async () => {
  const e = env((page, calls) => (calls.length === 1 ? status(503, { 'Retry-After': '2' }) : ok(range(0, 2))));
  await loadAllPages({ ...e, pageCount: 1, expectedTotal: null });
  assert.deepEqual(e.sleeps, [2000]);
  const e2 = env((page, calls) => (calls.length === 1 ? status(502) : ok([{ id: 'known' }])));
  const r = await loadNewEntries({ ...e2, knownIds: new Set(['known']) });
  assert.deepEqual(r.entries, []);
  assert.deepEqual(e2.sleeps, [5000]);
});

test('Retry-After: 120 : arrêt sans attente', async () => {
  const e = env([status(503, { 'Retry-After': '120' })]);
  await rejectsWith(loadAllPages({ ...e, pageCount: 1, expectedTotal: null }), { reason: 'retry-after', status: 503 });
  assert.deepEqual(e.sleeps, []);
  assert.deepEqual(e.calls, [0]);
});

test('abandon pendant l’attente de 15 s : AbortedLoadError, aucun nouvel appel', async () => {
  const e = env(() => status(503));
  e.sleep = async (ms) => { e.sleeps.push(ms); if (ms === 15000) { e.controller.abort(); throw new Error('abandonné'); } };
  await rejectsWith(loadAllPages({ ...e, pageCount: 1, expectedTotal: null }), { name: 'AbortedLoadError' });
  assert.deepEqual(e.sleeps, [5000, 15000]);
  assert.equal(e.calls.length, 2);
});

test('onRetry reçoit { page, attempt, waitMs } avant chaque attente', async () => {
  const retries = [];
  const e = env(() => status(503), { onRetry: (r) => retries.push(r) });
  await assert.rejects(loadAllPages({ ...e, pageCount: 1, expectedTotal: null }));
  assert.deepEqual(retries, [
    { page: 0, attempt: 1, waitMs: 5000 }, { page: 0, attempt: 2, waitMs: 15000 }, { page: 0, attempt: 3, waitMs: 45000 },
  ]);
});

test('backoffMs est une option', async () => {
  const e = env(() => status(503), { backoffMs: [500, 600, 700] });
  await assert.rejects(loadAllPages({ ...e, pageCount: 1, expectedTotal: null }));
  assert.deepEqual(e.sleeps, [500, 600, 700]);
});

test('startPage + initialEntries : reprise, un seul appel, progression depuis la page 0', async () => {
  const progress = [];
  const e = env([null, null, ok(range(100, 150))], { onProgress: (p) => progress.push(p) });
  const r = await loadAllPages({ ...e, pageCount: 3, expectedTotal: 150, startPage: 2, initialEntries: range(0, 100) });
  assert.deepEqual(e.calls, [2]);
  assert.equal(r.entries.length, 150);
  assert.deepEqual(progress.at(-1), { pagesRead: 3, pageCount: 3 });
  assert.deepEqual(e.sleeps, []);
});

test('initialEntries dédoublonnées avec les nouvelles par id', async () => {
  const e = env([null, ok(range(45, 60))]);
  const r = await loadAllPages({ ...e, pageCount: 2, expectedTotal: null, startPage: 1, initialEntries: range(0, 50) });
  assert.equal(r.entries.length, 60);
});

test('onPage appelé après chaque page avec le cumul', async () => {
  const seen = [];
  const e = env([ok(range(0, 50)), ok(range(50, 70))]);
  await loadAllPages({ ...e, pageCount: 2, expectedTotal: null, onPage: ({ page, entries }) => seen.push([page, entries.length]) });
  assert.deepEqual(seen, [[0, 50], [1, 70]]);
});

test('parseRetryAfter', () => {
  assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:28:02 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')), 2000);
  assert.equal(parseRetryAfter('3', 0), 3000);
  assert.equal(parseRetryAfter(null, 0), null);
  assert.equal(parseRetryAfter('bientôt', 0), null);
});

test('abandon pendant la 2e page : AbortedLoadError, plus aucun appel', async () => {
  const e = env((page) => {
    if (page === 1) e.controller.abort();
    return ok(range(page * 50, page * 50 + 50));
  });
  await assert.rejects(loadAllPages({ ...e, pageCount: 3, expectedTotal: null }), (err) => err.name === 'AbortedLoadError' && err instanceof AbortedLoadError);
  assert.deepEqual(e.calls, [0, 1]);
});

test('rejet de fetchPage alors que le signal est déclenché : abandon, pas network', async () => {
  const e = env((page) => { e.controller.abort(); return new Error('AbortError'); });
  await rejectsWith(loadAllPages({ ...e, pageCount: 2, expectedTotal: null }), { name: 'AbortedLoadError' });
});

test('sleep qui rejette sur abandon : AbortedLoadError', async () => {
  const e = env([ok(range(0, 50)), ok(range(50, 60))]);
  e.sleep = async () => { e.controller.abort(); throw new Error('aborted'); };
  await rejectsWith(loadAllPages({ ...e, pageCount: 2, expectedTotal: null }), { name: 'AbortedLoadError' });
  assert.deepEqual(e.calls, [0]);
});

test('erreurs : IncompleteLoadError', () => {
  const err = new IncompleteLoadError({ reason: 'http', status: 500 });
  assert.equal(err.name, 'IncompleteLoadError');
  assert.equal(err.page, null);
  assert.ok(err instanceof Error);
});

test('journal : load:page et load:stop', async () => {
  const logs = [];
  const e = env([ok(range(0, 2))], { log: (name, data) => logs.push([name, data]) });
  await loadAllPages({ ...e, pageCount: 1, expectedTotal: null });
  assert.equal(logs[0][0], 'load:page');
  assert.equal(logs[0][1].page, 0);
  assert.equal(logs[0][1].status, 200);
  assert.equal(typeof logs[0][1].ms, 'number');
  assert.equal(logs.at(-1)[0], 'load:stop');
});

test('loadNewEntries : s’arrête après la première page contenant un id connu', async () => {
  const known = new Set(range(60, 100).map((x) => x.id));
  const e = env([ok(range(0, 50)), ok(range(50, 100)), ok(range(100, 150))]);
  const { entries } = await loadNewEntries({ ...e, knownIds: known });
  assert.equal(entries.length, 60);
  assert.deepEqual(e.calls, [0, 1]);
});

test('loadNewEntries : page 0 avec un id connu en tête', async () => {
  const e = env([ok(range(0, 50))]);
  const { entries } = await loadNewEntries({ ...e, knownIds: new Set(['e0']) });
  assert.equal(entries.length, 49);
  assert.equal(e.calls.length, 1);
});

test('loadNewEntries : page 0 entièrement connue → []', async () => {
  const e = env([ok(range(0, 50))]);
  const { entries } = await loadNewEntries({ ...e, knownIds: new Set(range(0, 50).map((x) => x.id)) });
  assert.deepEqual(entries, []);
  assert.equal(e.calls.length, 1);
});

test('loadNewEntries : page vide → fin ; maxPages sans id connu → too-many-new', async () => {
  const r = await loadNewEntries({ ...env([ok(range(0, 5)), ok([])]), knownIds: new Set() });
  assert.equal(r.entries.length, 5);
  const e = env((page) => ok(range(page * 50, page * 50 + 50)));
  await rejectsWith(loadNewEntries({ ...e, knownIds: new Set(), maxPages: 2 }), { reason: 'too-many-new' });
  assert.deepEqual(e.calls, [0, 1]);
});

// ---- createSerialFetch ----

function serialEnv({ timeoutPending = true } = {}) {
  const st = { clock: 0, log: [], sleeps: [] };
  st.now = () => st.clock;
  st.sleep = (ms, signal) => new Promise((resolve, reject) => {
    st.sleeps.push(ms);
    if (ms === 20000 && timeoutPending) {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      return;
    }
    st.clock += ms;
    resolve();
  });
  st.fetchFn = (url, init) => new Promise((resolve, reject) => {
    const entry = { url, start: st.clock };
    st.log.push(entry);
    st.active = (st.active || 0) + 1;
    st.maxActive = Math.max(st.maxActive || 0, st.active);
    setImmediate(() => {
      st.clock += 100;
      st.active -= 1;
      entry.end = st.clock;
      resolve(new Response('ok'));
    });
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  return st;
}

test('createSerialFetch : appels simultanés exécutés l’un après l’autre, avec écart', async () => {
  const st = serialEnv();
  const f = createSerialFetch({ fetchFn: st.fetchFn, sleep: st.sleep, now: st.now });
  await Promise.all([f('/a'), f('/b'), f('/c')]);
  assert.equal(st.maxActive, 1);
  assert.deepEqual(st.log.map((l) => l.url), ['/a', '/b', '/c']);
  assert.ok(st.log[1].start - st.log[0].end >= 400);
  assert.ok(st.log[2].start - st.log[1].end >= 400);
});

test('createSerialFetch : dépassement du délai → rejet', async () => {
  const st = serialEnv();
  st.fetchFn = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  // le sleep du délai max se déclenche tout de suite
  const f = createSerialFetch({ fetchFn: st.fetchFn, sleep: serialEnv({ timeoutPending: false }).sleep, now: st.now });
  await assert.rejects(f('/slow'), (err) => err.name === 'TimeoutError');
});

test('createSerialFetch : le signal de l’appelant annule l’appel', async () => {
  const st = serialEnv();
  const f = createSerialFetch({ fetchFn: st.fetchFn, sleep: st.sleep, now: st.now });
  const c = new AbortController();
  c.abort();
  await assert.rejects(f('/x', { signal: c.signal }));
  assert.equal(st.log.length, 0);
});

test('createSerialFetch : le corps reste lisible après le retour de l’appel', async () => {
  const st = serialEnv();
  const fetchFn = async (url, init) => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('corps'));
        init.signal.addEventListener('abort', () => { try { controller.error(new Error('aborted')); } catch {} }, { once: true });
      },
      pull() { return new Promise(() => {}); },
    });
    return new Response(body);
  };
  const f = createSerialFetch({ fetchFn, sleep: st.sleep, now: st.now });
  const res = await f('/x');
  await new Promise((r) => setImmediate(r));
  const reader = res.body.getReader();
  const { value } = await reader.read();
  assert.equal(new TextDecoder().decode(value), 'corps');
});

test('createSerialFetch : fetchFn qui ignore le signal → TimeoutError, et l’appel suivant s’exécute', async () => {
  const st = serialEnv({ timeoutPending: false });
  let n = 0;
  const fetchFn = () => (++n === 1 ? new Promise(() => {}) : Promise.resolve(new Response('ok')));
  const f = createSerialFetch({ fetchFn, sleep: st.sleep, now: st.now });
  await assert.rejects(f('/hang'), (err) => err.name === 'TimeoutError');
  const res = await f('/next');
  assert.equal(await res.text(), 'ok');
});

test('createSerialFetch : abandon d’un appel en file → rejet immédiat, la chaîne reste intacte', async () => {
  const st = serialEnv();
  let release;
  const started = [];
  const fetchFn = (url) => {
    started.push(url);
    if (url === '/A') return new Promise((resolve) => { release = () => resolve(new Response('a')); });
    return Promise.resolve(new Response(url));
  };
  const f = createSerialFetch({ fetchFn, sleep: st.sleep, now: st.now });
  const a = f('/A');
  const c = new AbortController();
  const b = f('/B', { signal: c.signal });
  await new Promise((r) => setImmediate(r));
  c.abort();
  await assert.rejects(b, (err) => err.name === 'AbortError');
  assert.deepEqual(started, ['/A']);
  const cc = f('/C');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started, ['/A']); // C attend toujours A
  release();
  await a;
  assert.equal(await (await cc).text(), '/C');
  assert.deepEqual(started, ['/A', '/C']);
});

test('onRetry annonce l\'attente réelle (plancher de 400 ms) et le journal garde load:retry', async () => {
  const retries = [];
  const logs = [];
  const e = env(() => status(503), { backoffMs: [100, 200, 300], onRetry: (r) => retries.push(r), log: (k, d) => logs.push([k, d]) });
  await assert.rejects(loadAllPages({ ...e, pageCount: 1, expectedTotal: null }));
  assert.deepEqual(retries.map((r) => r.waitMs), [400, 400, 400]);
  assert.deepEqual(e.sleeps, [400, 400, 400]);
  const l = logs.filter(([k]) => k === 'load:retry');
  assert.equal(l.length, 3);
  assert.deepEqual(l[0][1], { page: 0, attempt: 1, waitMs: 400, reason: 'http', status: 503 });
});

test('loadNewEntries : un id vu sur deux pages (décalage) n\'est rendu qu\'une fois', async () => {
  const e = env([ok([{ id: 'n0' }, { id: 'n1' }]), ok([{ id: 'n1' }, { id: 'n2' }, { id: 'k0' }])]);
  const { entries } = await loadNewEntries({ ...e, knownIds: new Set(['k0']) });
  assert.deepEqual(entries.map((x) => x.id), ['n0', 'n1', 'n2']);
});

// ---- createSerialFetch : verrou partagé entre onglets ----

function fakeLocks() {
  const queues = new Map();
  const L = {
    requests: [],
    request(name, opts, cb) {
      L.requests.push(name);
      const q = queues.get(name) || { held: false, waiting: [] };
      queues.set(name, q);
      return new Promise((resolve, reject) => {
        const signal = opts?.signal;
        const grant = async (entry) => {
          q.held = true;
          try { resolve(await cb()); } catch (e) { reject(e); } finally {
            q.held = false;
            const next = q.waiting.shift();
            if (next) next();
          }
        };
        if (signal?.aborted) return reject(Object.assign(new Error('abort'), { name: 'AbortError' }));
        const entry = () => grant(entry);
        if (!q.held) return void grant(entry);
        q.waiting.push(entry);
        signal?.addEventListener('abort', () => {
          const i = q.waiting.indexOf(entry);
          if (i >= 0) { q.waiting.splice(i, 1); reject(Object.assign(new Error('abort'), { name: 'AbortError' })); }
        }, { once: true });
      });
    },
  };
  return L;
}

test('createSerialFetch : deux onglets (verrou partagé) ne lisent jamais en parallèle', async () => {
  const st = serialEnv();
  const locks = fakeLocks();
  const a = createSerialFetch({ fetchFn: st.fetchFn, sleep: st.sleep, now: st.now, locks });
  const b = createSerialFetch({ fetchFn: st.fetchFn, sleep: st.sleep, now: st.now, locks });
  await Promise.all([a('/a1'), b('/b1'), a('/a2'), b('/b2')]);
  assert.equal(st.maxActive, 1);
  assert.equal(st.log.length, 4);
  assert.ok(locks.requests.every((n) => n === 'wm-doublons:net'));
  // l'écart de 400 ms vaut aussi entre onglets : le verrou est tenu 400 ms après l'appel
  assert.ok(st.sleeps.filter((ms) => ms === 400).length >= 4);
});

test('createSerialFetch : abandon pendant l\'attente du verrou, immédiat et sans appel réseau', async () => {
  const st = serialEnv();
  const locks = fakeLocks();
  // un autre onglet tient le verrou
  let free;
  locks.request('wm-doublons:net', {}, () => new Promise((r) => { free = r; }));
  const f = createSerialFetch({ fetchFn: st.fetchFn, sleep: st.sleep, now: st.now, locks });
  const c = new AbortController();
  const p = f('/x', { signal: c.signal });
  await new Promise((r) => setImmediate(r));
  c.abort();
  await assert.rejects(p, (err) => err.name === 'AbortError');
  assert.equal(st.log.length, 0);
  free();
});

test('createSerialFetch : sans navigator.locks, comportement inchangé', async () => {
  const st = serialEnv();
  const f = createSerialFetch({ fetchFn: st.fetchFn, sleep: st.sleep, now: st.now, locks: null });
  await Promise.all([f('/a'), f('/b')]);
  assert.equal(st.maxActive, 1);
  assert.equal(st.log.length, 2);
});
