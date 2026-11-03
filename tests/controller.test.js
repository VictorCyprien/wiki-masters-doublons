'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const siteApi = require('../extension/src/site-api.js');
const dupApi = require('../extension/src/duplicates.js');
const { IncompleteLoadError, AbortedLoadError } = require('../extension/src/loader.js');
const { memoryStore, createCache } = require('../extension/src/cache.js');
const { makeEntry } = require('./helpers.js');
const { createController } = require('../extension/src/controller.js');

const LIST = '/api/my-collection?sort=rarity&page=0&stats=0';
const tick = () => new Promise((r) => setImmediate(r));
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const fresh = (o = {}) => ({ userId: 'u1', total: 5, freshness: 'F1', template: { collection: [], tagOptions: [] }, ...o });
const rec = (entries, o = {}) => ({ entries, total: entries.length, freshness: 'F1', template: { collection: [], tagOptions: [] }, loadedAt: 1, ...o });

function setup(over = {}) {
  const cache = createCache(memoryStore());
  const states = [];
  const calls = { fresh: 0, loadAll: [], loadNew: [] };
  const d = {
    fetchFreshness: async () => { calls.fresh += 1; return fresh(); },
    loadAll: async (o) => { calls.loadAll.push(o); return { entries: [] }; },
    loadNew: async (o) => { calls.loadNew.push(o); return { entries: [] }; },
    cache,
    site: { classifyUrl: siteApi.classifyUrl, parseSiteQuery: siteApi.parseSiteQuery, buildListResponse: siteApi.buildListResponse,
      buildStatsResponse: siteApi.buildStatsResponse, PAGE_SIZE: siteApi.SITE.PAGE_SIZE },
    dup: { groupDuplicates: dupApi.groupDuplicates, filterGroups: dupApi.filterGroups, summarize: dupApi.summarize, rarityCounts: dupApi.rarityCounts },
    now: () => 4242,
    onState: (s) => states.push(s),
    ...over,
  };
  return { c: createController(d), cache, states, calls, d };
}
const ents = (n, p = 'x') => Array.from({ length: n }, (_, i) => makeEntry({ id: `${p}${i}`, title: `${p}${i}` }));

test('pas de cache : total frais incohérent -> mismatch, error incomplete, rien en cache', async () => {
  const entries = ents(5);
  const { c, cache, states, calls } = setup({
    fetchFreshness: async () => fresh({ total: 13522 }),
    loadAll: async (o) => { calls.loadAll.push(o); return { entries: entries.slice(0, 4) }; },
    loadNew: async () => ({ entries: [entries[4]] }),
  });
  // total frais final 13522 != 5 -> mismatch ; vérifions d'abord les appels
  await c.enter();
  assert.equal(calls.loadAll.length, 1);
  assert.equal(calls.loadAll[0].pageCount, 271);
  assert.equal(calls.loadAll[0].expectedTotal, null);
  assert.ok(states.some((s) => s.mode === 'loading' && s.progress?.phase === 'full'));
  assert.equal(c.getState().error, 'incomplete');
  assert.equal(await cache.get('u1'), null);
});

test('pas de cache : cache rempli avec freshness, template, loadedAt', async () => {
  const entries = ents(5);
  const { c, cache, states } = setup({
    loadAll: async () => ({ entries }),
  });
  await c.enter();
  const r = await cache.get('u1');
  assert.equal(r.entries.length, 5);
  assert.equal(r.freshness, 'F1');
  assert.deepEqual(r.template, { collection: [], tagOptions: [] });
  assert.equal(r.loadedAt, 4242);
  assert.equal(await cache.getLastUserId(), 'u1');
  assert.equal(states.at(-1).mode, 'ready');
  assert.equal(states.at(-1).stale, false);
});

test('lecture complète : loadAll 3, loadNew 1, total frais 4 -> ready avec 4 entrées', async () => {
  const e = ents(4);
  const { c, cache, calls } = setup({
    fetchFreshness: async () => fresh({ total: 4 }),
    loadAll: async () => ({ entries: e.slice(0, 3) }),
    loadNew: async (o) => { calls.loadNew.push(o); return { entries: [e[3]] }; },
  });
  await c.enter();
  assert.equal(c.getState().mode, 'ready');
  assert.equal((await cache.get('u1')).entries.length, 4);
  assert.equal(calls.loadNew[0].knownIds.size, 3);
});

test('cache, même fraîcheur : aucune lecture, stale false', async () => {
  const { c, cache, calls } = setup();
  await cache.put('u1', rec(ents(3)));
  await c.enter();
  assert.equal(calls.loadAll.length + calls.loadNew.length, 0);
  assert.equal(c.getState().mode, 'ready');
  assert.equal(c.getState().stale, false);
});

test('cache, autre fraîcheur : stale true, aucune lecture', async () => {
  const { c, cache, calls } = setup({ fetchFreshness: async () => fresh({ freshness: 'F2' }) });
  await cache.put('u1', rec(ents(3)));
  await c.enter();
  assert.equal(calls.loadAll.length + calls.loadNew.length, 0);
  assert.equal(c.getState().stale, true);
  assert.equal(c.getState().mode, 'ready');
});

test('fetchFreshness rejette : cache de lastUserId, freshnessUnknown', async () => {
  const { c, cache } = setup({ fetchFreshness: async () => { throw new Error('x'); } });
  await cache.put('u1', rec(ents(3)));
  await cache.setLastUserId('u1');
  await c.enter();
  assert.equal(c.getState().mode, 'ready');
  assert.equal(c.getState().freshnessUnknown, true);
});

test('fetchFreshness total null : traité comme un échec', async () => {
  const { c, cache, calls } = setup({ fetchFreshness: async () => fresh({ total: null }) });
  await c.enter();
  assert.equal(c.getState().error, 'freshness');
  assert.equal(calls.loadAll.length, 0);
  await cache.put('u1', rec(ents(3)));
  await cache.setLastUserId('u1');
  c.exit();
  await c.enter();
  assert.equal(c.getState().freshnessUnknown, true);
});

test('fetchFreshness rejette sans cache : error freshness, aucune lecture', async () => {
  const { c, calls } = setup({ fetchFreshness: async () => { throw new Error('x'); } });
  await c.enter();
  assert.equal(c.getState().mode, 'error');
  assert.equal(c.getState().error, 'freshness');
  assert.equal(calls.loadAll.length, 0);
  assert.equal(c.shouldIntercept(LIST), false);
});

test('setLastUserId après chaque fetchFreshness réussi', async () => {
  const { c, cache } = setup({ fetchFreshness: async () => fresh({ userId: 'u7' }) });
  await cache.put('u7', rec(ents(3)));
  await c.enter();
  assert.equal(await cache.getLastUserId(), 'u7');
});

test('userId null : pas de put ni setLastUserId', async () => {
  const e = ents(5);
  const { c, cache } = setup({
    fetchFreshness: async () => fresh({ userId: null }),
    loadAll: async () => ({ entries: e }),
  });
  await c.enter();
  assert.equal(c.getState().mode, 'ready');
  assert.equal(await cache.getLastUserId(), null);
});

test('refresh incrémental : 3 en cache + 2 nouvelles, total 5', async () => {
  const old = ents(3, 'o');
  const nw = ents(2, 'n');
  const { c, cache, calls } = setup({ loadNew: async (o) => { calls.loadNew.push(o); return { entries: nw }; } });
  await cache.put('u1', rec(old, { freshness: 'F0' }));
  await c.enter();
  assert.equal(c.getState().stale, true);
  await c.refresh();
  const r = await cache.get('u1');
  assert.equal(r.entries.length, 5);
  assert.equal(r.freshness, 'F1');
  assert.equal(r.loadedAt, 4242);
  assert.equal(calls.loadAll.length, 0);
  assert.equal(c.getState().stale, false);
  assert.equal(c.getState().mode, 'ready');
});

test('refresh avec carte partie : lecture complète avec le total frais', async () => {
  const old = ents(3, 'o');
  const { c, cache, calls } = setup({
    fetchFreshness: async () => fresh({ total: 2 }),
    loadAll: async (o) => { calls.loadAll.push(o); return { entries: old.slice(0, 2) }; },
  });
  await cache.put('u1', rec(old));
  await c.enter();
  await c.refresh();
  assert.equal(calls.loadAll.length, 1);
  assert.equal(calls.loadAll[0].pageCount, 1);
  assert.equal((await cache.get('u1')).entries.length, 2);
});

test('refresh : too-many-new -> lecture complète', async () => {
  const old = ents(3, 'o');
  const { c, cache, calls } = setup({
    fetchFreshness: async () => fresh({ total: 3 }),
    loadNew: async (o) => {
      calls.loadNew.push(o);
      if (calls.loadNew.length === 1) throw new IncompleteLoadError({ reason: 'too-many-new' });
      return { entries: [] };
    },
    loadAll: async (o) => { calls.loadAll.push(o); return { entries: old }; },
  });
  await cache.put('u1', rec(old));
  await c.enter();
  await c.refresh();
  assert.equal(calls.loadAll.length, 1);
  assert.equal(c.getState().mode, 'ready');
  assert.equal(c.getState().error, null);
});

test('refresh : autre compte -> lecture complète sans fusion', async () => {
  const old = ents(3, 'o');
  const mine = ents(2, 'm');
  let user = 'u1';
  const { c, cache, calls } = setup({
    fetchFreshness: async () => fresh({ userId: user, total: 2 }),
    loadNew: async (o) => { calls.loadNew.push(o); return { entries: [] }; },
    loadAll: async (o) => { calls.loadAll.push(o); return { entries: mine }; },
  });
  await cache.put('u1', rec(old, { total: 2 }));
  await c.enter();
  user = 'u2';
  await c.refresh();
  assert.equal(calls.loadAll.length, 1);
  const r2 = await cache.get('u2');
  assert.deepEqual(r2.entries.map((e) => e.id), ['m0', 'm1']);
  assert.equal((await cache.get('u1')).entries.length, 3);
});

test('refresh deux fois pendant une lecture : loadNew une fois', async () => {
  const gate = deferred();
  const { c, cache, calls } = setup({
    loadNew: async (o) => { calls.loadNew.push(o); await gate.promise; return { entries: ents(2, 'n') }; },
  });
  await cache.put('u1', rec(ents(3), { freshness: 'F0' }));
  await c.enter();
  const a = c.refresh();
  const b = c.refresh();
  gate.resolve();
  await Promise.all([a, b]);
  assert.equal(calls.loadNew.length, 1);
});

test('refresh pendant le loadAll d\'enter : même promesse, loadAll une fois', async () => {
  const gate = deferred();
  const e = ents(5);
  const { c, calls } = setup({
    loadAll: async (o) => { calls.loadAll.push(o); await gate.promise; return { entries: e }; },
  });
  const p1 = c.enter();
  await tick();
  const p2 = c.refresh();
  const p3 = c.enter();
  assert.equal(p1, p2);
  assert.equal(p1, p3);
  gate.resolve();
  await p1;
  assert.equal(calls.loadAll.length, 1);
});

test('pendant refresh : interception gardée, ancien enregistrement servi', async () => {
  const gate = deferred();
  const old = [makeEntry({ id: 'a1', title: 'A' }), makeEntry({ id: 'a2', title: 'A' })];
  const { c, cache } = setup({ loadNew: async () => { await gate.promise; return { entries: [] }; } });
  await cache.put('u1', rec(old, { freshness: 'F0' }));
  await c.enter();
  const p = c.refresh();
  await tick();
  assert.equal(c.getState().mode, 'loading');
  assert.equal(c.shouldIntercept('/api/my-collection?page=0'), true);
  assert.equal(c.respond(LIST).collection.length, 1);
  gate.resolve();
  await p;
});

test('première lecture : rien n\'est intercepté', async () => {
  const gate = deferred();
  const { c } = setup({ loadAll: async () => { await gate.promise; return { entries: [] }; } });
  const p = c.enter();
  await tick();
  assert.equal(c.shouldIntercept('/api/my-collection?page=0'), false);
  gate.resolve();
  await p;
});

test('shouldIntercept : classifyUrl nul -> faux', async () => {
  const { c, cache } = setup();
  await cache.put('u1', rec(ents(3)));
  await c.enter();
  assert.equal(c.shouldIntercept('/api/my-collection?page=0'), true);
  assert.equal(c.shouldIntercept('/api/boosters'), false);
});

test('loadAll IncompleteLoadError avec ancien cache : ready, error incomplete, cache intact', async () => {
  const old = ents(3, 'o');
  const { c, cache } = setup({
    fetchFreshness: async () => fresh({ total: 2 }),
    loadNew: async () => ({ entries: [] }),
    loadAll: async () => { throw new IncompleteLoadError({ reason: 'mismatch' }); },
  });
  await cache.put('u1', rec(old));
  await c.enter();
  await c.refresh();
  assert.equal(c.getState().mode, 'ready');
  assert.equal(c.getState().error, 'incomplete');
  assert.equal((await cache.get('u1')).entries.length, 3);
  assert.equal(c.shouldIntercept('/api/my-collection?page=0'), true);
});

test('loadAll IncompleteLoadError sans cache : mode error, pas d\'interception', async () => {
  const { c } = setup({ loadAll: async () => { throw new IncompleteLoadError({ reason: 'mismatch' }); } });
  await c.enter();
  assert.equal(c.getState().mode, 'error');
  assert.equal(c.getState().error, 'incomplete');
  assert.equal(c.shouldIntercept('/api/my-collection?page=0'), false);
});

test('exception inattendue (cache) : error unexpected', async () => {
  const { c, cache } = setup();
  cache.get = async () => { throw new Error('idb'); };
  await c.enter();
  assert.equal(c.getState().mode, 'error');
  assert.equal(c.getState().error, 'unexpected');
});

test('AbortedLoadError sans exit : mode off sans erreur', async () => {
  const { c } = setup({ loadAll: async () => { throw new AbortedLoadError(); } });
  await c.enter();
  assert.equal(c.getState().mode, 'off');
  assert.equal(c.getState().error, null);
});

test('exit pendant loading : signal aborted, off, pas d\'interception', async () => {
  const gate = deferred();
  let sig;
  const { c } = setup({ loadAll: async (o) => { sig = o.signal; await gate.promise; throw new AbortedLoadError(); } });
  const p = c.enter();
  await tick();
  c.exit();
  assert.equal(sig.aborted, true);
  gate.resolve();
  await p;
  assert.equal(c.getState().mode, 'off');
  assert.equal(c.shouldIntercept(LIST), false);
});

test('exit pendant fetchFreshness : reste off, loadAll jamais appelé', async () => {
  const gate = deferred();
  const { c, calls } = setup({ fetchFreshness: async () => { await gate.promise; return fresh(); } });
  const p = c.enter();
  await tick();
  c.exit();
  gate.resolve();
  await p;
  await tick();
  assert.equal(c.getState().mode, 'off');
  assert.equal(calls.loadAll.length, 0);
});

test('exit puis enter pendant une lecture : l\'abandon tardif ne touche pas la seconde', async () => {
  const g1 = deferred();
  const g2 = deferred();
  let n = 0;
  const e = ents(5);
  const { c } = setup({
    loadAll: async () => {
      n += 1;
      if (n === 1) { await g1.promise; throw new AbortedLoadError(); }
      await g2.promise;
      return { entries: e };
    },
  });
  const p1 = c.enter();
  await tick();
  c.exit();
  const p2 = c.enter();
  await tick();
  assert.notEqual(p1, p2);
  g1.resolve();
  await p1;
  assert.equal(c.getState().mode, 'loading');
  g2.resolve();
  await p2;
  assert.equal(c.getState().mode, 'ready');
});

test('exit remet summary et pageCounts à null', async () => {
  const { c, cache } = setup();
  await cache.put('u1', rec([makeEntry({ title: 'A' }), makeEntry({ title: 'A' })]));
  await c.enter();
  c.respond(LIST);
  assert.notEqual(c.getState().summary, null);
  c.exit();
  assert.equal(c.getState().summary, null);
  assert.equal(c.getState().pageCounts, null);
});

function dupCollection() {
  return [
    makeEntry({ id: '1', title: 'Alpha', rarity: 'L', count: 3 }),
    makeEntry({ id: '2', title: 'Beta', rarity: 'L' }),
    makeEntry({ id: '3', title: 'Beta', rarity: 'L' }),
    makeEntry({ id: '4', title: 'Gamma', rarity: 'C', count: 2 }),
    makeEntry({ id: '5', title: 'Solo', rarity: 'L' }),
  ];
}

test('respond liste : filtre L, une entrée par groupe, summary et pageCounts', async () => {
  const { c, cache } = setup();
  await cache.put('u1', rec(dupCollection()));
  await c.enter();
  const body = c.respond('/api/my-collection?sort=rarity&rarity=L&page=0&stats=0');
  assert.deepEqual(body.collection.map((e) => e.card.wikipedia_title), ['Alpha', 'Beta']);
  assert.deepEqual(c.getState().summary, { cards: 2, extra: 3 });
  assert.deepEqual(c.getState().pageCounts, [3, 2]);
});

test('respond stats : total = groupes L, rarityCounts ignore le filtre de rareté', async () => {
  const { c, cache } = setup();
  await cache.put('u1', rec(dupCollection()));
  await c.enter();
  const s = c.respond('/api/my-collection/stats?sort=rarity&rarity=L');
  assert.equal(s.total, 2);
  assert.deepEqual(s.rarityCounts, { L: 2, C: 1 });
});

test('groupes mémoïsés par enregistrement', async () => {
  let calls = 0;
  const { c, cache, d } = setup();
  const orig = d.dup.groupDuplicates;
  d.dup.groupDuplicates = (e) => { calls += 1; return orig(e); };
  await cache.put('u1', rec(dupCollection()));
  await c.enter();
  c.respond(LIST);
  c.respond('/api/my-collection/stats?sort=rarity');
  c.respond(LIST);
  assert.equal(calls, 1);
});

test('template frais appliqué à l\'enregistrement en mémoire', async () => {
  const { c, cache } = setup({ fetchFreshness: async () => fresh({ template: { collection: [], tagOptions: [{ id: 't' }], extra: 1 } }) });
  await cache.put('u1', rec(dupCollection()));
  await c.enter();
  assert.equal(c.respond(LIST).extra, 1);
});

test('collection sans doublon : liste vide, summary 0, stats total 0', async () => {
  const { c, cache } = setup();
  await cache.put('u1', rec([makeEntry({ title: 'A' }), makeEntry({ title: 'B' })]));
  await c.enter();
  assert.deepEqual(c.respond(LIST).collection, []);
  assert.deepEqual(c.getState().summary, { cards: 0, extra: 0 });
  assert.equal(c.respond('/api/my-collection/stats?sort=rarity').total, 0);
});

test('refresh puis exit, loadNew rejette too-many-new : aucun appel de plus, reste off', async () => {
  const gate = deferred();
  const { c, cache, calls } = setup({ loadNew: async () => { await gate.promise; throw new IncompleteLoadError({ reason: 'too-many-new' }); } });
  await cache.put('u1', rec(ents(3), { freshness: 'F0' }));
  await c.enter();
  const before = calls.fresh;
  const p = c.refresh();
  await tick();
  c.exit();
  gate.resolve();
  await p;
  await tick();
  assert.equal(calls.fresh, before);
  assert.equal(calls.loadAll.length, 0);
  assert.equal(c.getState().mode, 'off');
});

test('exit puis fetchFreshness rejette en retard : lastUserId non lu, état inchangé', async () => {
  const gate = deferred();
  const { c, cache, states } = setup({ fetchFreshness: async () => { await gate.promise; throw new Error('x'); } });
  let read = 0;
  const orig = cache.getLastUserId;
  cache.getLastUserId = (...a) => { read += 1; return orig(...a); };
  const p = c.enter();
  await tick();
  c.exit();
  const n = states.length;
  gate.resolve();
  await p;
  await tick();
  assert.equal(read, 0);
  assert.equal(states.length, n);
  assert.equal(c.getState().mode, 'off');
});

test('changement de compte pendant refresh : ancien enregistrement plus servi, échec -> mode error', async () => {
  const gate = deferred();
  let user = 'u1';
  const s = setup({
    fetchFreshness: async () => fresh({ userId: user, total: 2 }),
    loadNew: async () => ({ entries: [] }),
    loadAll: async () => { await gate.promise; throw new IncompleteLoadError({ reason: 'network' }); },
  });
  await s.cache.put('u1', rec(ents(3, 'o')));
  await s.c.enter();
  user = 'u2';
  const p = s.c.refresh();
  await tick();
  assert.equal(s.c.shouldIntercept('/api/my-collection?page=0'), false);
  gate.resolve();
  await p;
  assert.equal(s.c.getState().mode, 'error');
});

test('enter() en mode actif, fetchFreshness échoue sans cache lastUserId : plus d\'interception', async () => {
  let fail = false;
  const { c, cache } = setup({ fetchFreshness: async () => { if (fail) throw new Error('x'); return fresh(); } });
  await cache.put('u1', rec(ents(3)));
  await c.enter();
  assert.equal(c.shouldIntercept('/api/my-collection?page=0'), true);
  fail = true;
  await cache.setLastUserId('nobody');
  await c.enter();
  assert.equal(c.shouldIntercept('/api/my-collection?page=0'), false);
  assert.equal(c.getState().error, 'freshness');
});

test('vérification de la lecture complète : la progression full est conservée', async () => {
  const e = ents(5);
  const { c, states } = setup({
    loadAll: async (o) => { o.onProgress({ pagesRead: 1, pageCount: 1 }); return { entries: e.slice(0, 4) }; },
    loadNew: async (o) => { o.onProgress({ pagesRead: 1, pageCount: null }); assert.equal(c.getState().progress.phase, 'full'); assert.equal(c.getState().progress.pageCount, 1); return { entries: [e[4]] }; },
  });
  await c.enter();
  assert.equal(c.getState().mode, 'ready');
  assert.ok(!states.some((s) => s.progress && s.progress.phase === 'full' && s.progress.pageCount === null));
});

test('refresh sans enregistrement, fetchFreshness échoue : loading puis error freshness', async () => {
  let fail = true;
  const { c, states } = setup({ fetchFreshness: async () => { if (fail) throw new Error('x'); return fresh(); } });
  await c.enter();
  assert.equal(c.getState().error, 'freshness');
  const n = states.length;
  const p = c.refresh();
  assert.equal(c.getState().mode, 'loading');
  assert.ok(states.length > n);
  await p;
  assert.equal(c.getState().mode, 'error');
  assert.equal(c.getState().error, 'freshness');
});

// --- Task 10 : essais espacés, reprise de la lecture complète ---
const objs = (from, to) => Array.from({ length: to - from }, (_, i) => ({ id: `r${from + i}` }));

test('échec à la page d\'indice 96 : putPartial, error, resumeAt ; refresh reprend et finit', async () => {
  const read = objs(0, 96 * 50);
  const all = objs(0, 13522);
  let mode = 'fail';
  const { c, cache, calls } = setup({
    fetchFreshness: async () => fresh({ total: 13522 }),
    loadAll: async (o) => {
      calls.loadAll.push(o);
      if (mode === 'fail') {
        o.onPage({ page: 95, entries: read });
        throw new IncompleteLoadError({ reason: 'http', page: 96, status: 503 });
      }
      return { entries: all };
    },
  });
  await c.enter();
  const p = await cache.getPartial('u1');
  assert.equal(p.nextPage, 96);
  assert.equal(p.entries.length, 96 * 50);
  assert.equal(p.pageCount, 271);
  assert.equal(p.savedAt, 4242);
  assert.equal(c.getState().mode, 'error');
  assert.deepEqual(c.getState().resumeAt, { page: 97, pageCount: 271 });
  mode = 'ok';
  await c.refresh();
  const last = calls.loadAll.at(-1);
  assert.equal(last.startPage, 96);
  assert.equal(last.initialEntries.length, 96 * 50);
  assert.equal(c.getState().mode, 'ready');
  assert.equal(c.getState().resumeAt, null);
  assert.equal(await cache.getPartial('u1'), null);
  assert.equal((await cache.get('u1')).entries.length, 13522);
});

test('reprise de plus de 24 h : ignorée, départ à 0', async () => {
  const { c, cache, calls } = setup();
  await cache.putPartial('u1', { entries: objs(0, 50), nextPage: 1, pageCount: 1, savedAt: 4242 - 24 * 3600 * 1000 - 1, total: 5, rarityCounts: {} });
  await c.enter();
  assert.equal(calls.loadAll[0].startPage, 0);
  assert.deepEqual(calls.loadAll[0].initialEntries, []);
  assert.equal(await cache.getPartial('u1'), null);
});

test('reprise de 24 h pile : acceptée ; enter() sans enregistrement reprend automatiquement', async () => {
  const { c, cache, calls } = setup({ fetchFreshness: async () => fresh({ total: 500 }) });
  await cache.putPartial('u1', { entries: objs(0, 150), nextPage: 3, pageCount: 10, savedAt: 4242 - 24 * 3600 * 1000, total: 500, rarityCounts: {} });
  await c.enter();
  assert.equal(calls.loadAll[0].startPage, 3);
  assert.equal(calls.loadAll[0].initialEntries.length, 150);
});

test('reprise inutilisable (nextPage >= pageCount) : ignorée et effacée', async () => {
  const { c, cache, calls } = setup();
  await cache.putPartial('u1', { entries: objs(0, 50), nextPage: 1, pageCount: 1, savedAt: 4242, total: 5, rarityCounts: {} });
  await c.enter();
  assert.equal(calls.loadAll[0].startPage, 0);
  assert.equal(await cache.getPartial('u1'), null);
});

test('onPage : putPartial toutes les 10 pages seulement', async () => {
  const saved = [];
  const { c, cache } = setup({
    fetchFreshness: async () => fresh({ total: 13522 }),
    loadAll: async (o) => {
      for (let page = 0; page < 25; page += 1) {
        o.onPage({ page, entries: objs(0, (page + 1) * 2) });
        await tick();
        const p = await cache.getPartial('u1');
        if (p && (!saved.length || saved.at(-1).nextPage !== p.nextPage)) saved.push(p);
      }
      throw new AbortedLoadError();
    },
  });
  await c.enter();
  assert.deepEqual(saved.map((p) => [p.nextPage, p.entries.length]), [[10, 20], [20, 40]]);
  assert.equal(c.getState().mode, 'off');
  assert.equal((await cache.getPartial('u1')).nextPage, 20); // pas de sauvegarde supplémentaire à l'abandon
});

test('mismatch final : clearPartial, pas de resumeAt', async () => {
  const { c, cache } = setup({
    fetchFreshness: async () => fresh({ total: 13522 }),
    loadAll: async () => ({ entries: objs(0, 5) }),
  });
  await cache.putPartial('u1', { entries: objs(0, 50), nextPage: 1, pageCount: 271, savedAt: 4242, total: 13522, rarityCounts: {} });
  await c.enter();
  assert.equal(c.getState().error, 'incomplete');
  assert.equal(c.getState().resumeAt, null);
  assert.equal(await cache.getPartial('u1'), null);
});

test('exit pendant l\'échec : aucune écriture après la nouvelle génération', async () => {
  const gate = deferred();
  const { c, cache } = setup({
    fetchFreshness: async () => fresh({ total: 13522 }),
    loadAll: async (o) => {
      await gate.promise;
      o.onPage({ page: 9, entries: objs(0, 500) });
      throw new IncompleteLoadError({ reason: 'http', page: 10, status: 503 });
    },
  });
  const p = c.enter();
  await tick();
  c.exit();
  gate.resolve();
  await p;
  await tick();
  assert.equal(await cache.getPartial('u1'), null);
  assert.equal(c.getState().mode, 'off');
  assert.equal(c.getState().resumeAt, null);
});

test('attente d\'essai : progress.retryInMs renseigné puis remis à null', async () => {
  const { c, states } = setup({
    fetchFreshness: async () => fresh({ total: 13522 }),
    loadAll: async (o) => {
      o.onRetry({ page: 0, attempt: 1, waitMs: 5000 });
      o.onProgress({ pagesRead: 1, pageCount: 271 });
      throw new AbortedLoadError();
    },
  });
  await c.enter();
  const waiting = states.find((s) => s.progress?.retryInMs === 5000);
  assert.ok(waiting);
  assert.equal(waiting.progress.phase, 'full');
  assert.equal(states.filter((s) => s.progress).at(-1).progress.retryInMs, null);
});

// --- Fix round 1 ---
const withRarity = (total, rarityCounts) => fresh({ total, template: { collection: [], tagOptions: [], rarityCounts } });

test('reprise : une suppression (total ou rareté en baisse) écarte le partiel', async () => {
  const { c, cache, calls } = setup({ fetchFreshness: async () => withRarity(499, { C: 299, R: 200 }) });
  await cache.putPartial('u1', { entries: objs(0, 150), nextPage: 3, pageCount: 10, savedAt: 4242, total: 500, rarityCounts: { C: 300, R: 200 } });
  await c.enter();
  assert.equal(calls.loadAll[0].startPage, 0);
  assert.deepEqual(calls.loadAll[0].initialEntries, []);
  assert.equal(await cache.getPartial('u1'), null);
});

test('reprise : une rareté en baisse compensée par un ajout (total égal) est écartée', async () => {
  const { c, cache, calls } = setup({ fetchFreshness: async () => withRarity(500, { C: 299, R: 201 }) });
  await cache.putPartial('u1', { entries: objs(0, 150), nextPage: 3, pageCount: 10, savedAt: 4242, total: 500, rarityCounts: { C: 300, R: 200 } });
  await c.enter();
  assert.equal(calls.loadAll[0].startPage, 0);
});

test('reprise : de purs ajouts (total et rareté en hausse) gardent le partiel', async () => {
  const { c, cache, calls } = setup({ fetchFreshness: async () => withRarity(502, { C: 301, R: 200, E: 1 }) });
  await cache.putPartial('u1', { entries: objs(0, 150), nextPage: 3, pageCount: 11, savedAt: 4242, total: 500, rarityCounts: { C: 300, R: 200 } });
  await c.enter();
  assert.equal(calls.loadAll[0].startPage, 3);
  assert.equal(calls.loadAll[0].initialEntries.length, 150);
});

test('reprise : un partiel sans total/rarityCounts (ancien format) est écarté', async () => {
  const { c, cache, calls } = setup({ fetchFreshness: async () => fresh({ total: 500 }) });
  await cache.putPartial('u1', { entries: objs(0, 150), nextPage: 3, pageCount: 10, savedAt: 4242 });
  await c.enter();
  assert.equal(calls.loadAll[0].startPage, 0);
  assert.equal(await cache.getPartial('u1'), null);
});

test('le partiel sauvegardé porte total et rarityCounts de la fraîcheur de départ', async () => {
  const { c, cache } = setup({
    fetchFreshness: async () => withRarity(13522, { C: 5 }),
    loadAll: async (o) => {
      o.onPage({ page: 9, entries: objs(0, 500) });
      throw new IncompleteLoadError({ reason: 'http', page: 10, status: 503 });
    },
  });
  await c.enter();
  const p = await cache.getPartial('u1');
  assert.equal(p.total, 13522);
  assert.deepEqual(p.rarityCounts, { C: 5 });
});

test('pas de point de sauvegarde quand page + 1 === pageCount', async () => {
  const { c, cache } = setup({
    fetchFreshness: async () => fresh({ total: 500 }), // 10 pages
    loadAll: async (o) => { o.onPage({ page: 9, entries: objs(0, 500) }); await tick(); return { entries: objs(0, 5) }; },
  });
  let wrote = false;
  const orig = cache.putPartial;
  cache.putPartial = async (...a) => { wrote = true; return orig(...a); };
  await c.enter();
  assert.equal(wrote, false);
});

test('échec sans aucune entrée gardée : pas de partiel, pas de resumeAt', async () => {
  const { c, cache } = setup({
    fetchFreshness: async () => fresh({ total: 13522 }),
    loadAll: async () => { throw new IncompleteLoadError({ reason: 'http', page: 0, status: 503 }); },
  });
  await c.enter();
  assert.equal(c.getState().error, 'incomplete');
  assert.equal(c.getState().resumeAt, null);
  assert.equal(await cache.getPartial('u1'), null);
});

test('échec d\'écriture du partiel : pas de resumeAt', async () => {
  const { c, cache } = setup({
    fetchFreshness: async () => fresh({ total: 13522 }),
    loadAll: async (o) => {
      o.onPage({ page: 3, entries: objs(0, 200) });
      throw new IncompleteLoadError({ reason: 'http', page: 4, status: 503 });
    },
  });
  cache.putPartial = async () => { throw new Error('quota'); };
  await c.enter();
  assert.equal(c.getState().mode, 'error');
  assert.equal(c.getState().error, 'incomplete');
  assert.equal(c.getState().resumeAt, null);
});

test('abandon() en ready : error unexpected, plus d\'interception, compteurs effacés', async () => {
  const { c, cache } = setup();
  await cache.put('u1', rec([makeEntry({ title: 'A' }), makeEntry({ title: 'A' })]));
  await c.enter();
  c.respond(LIST);
  assert.notEqual(c.getState().pageCounts, null);
  c.abandon();
  const s = c.getState();
  assert.equal(s.mode, 'error');
  assert.equal(s.error, 'unexpected');
  assert.equal(s.summary, null);
  assert.equal(s.pageCounts, null);
  assert.equal(s.loadedAt, null);
  assert.equal(c.shouldIntercept(LIST), false);
});

test('abandon() en off : sans effet', () => {
  const { c, states } = setup();
  c.abandon();
  assert.equal(c.getState().mode, 'off');
  assert.equal(states.length, 0);
});

test('abandon() pendant une lecture : signal aborted, l\'abandon tardif ne change pas l\'erreur', async () => {
  const d = deferred();
  let signal;
  const { c, cache } = setup({
    loadNew: (o) => { signal = o.signal; return d.promise; },
  });
  await cache.put('u1', rec(ents(3)));
  await c.enter();
  const p = c.refresh();
  await tick();
  c.abandon();
  assert.equal(signal.aborted, true);
  d.reject(new AbortedLoadError());
  await p;
  assert.equal(c.getState().mode, 'error');
  assert.equal(c.getState().error, 'unexpected');
});

test('enter() après abandon() : mode Doublons de nouveau servi', async () => {
  const { c, cache } = setup();
  await cache.put('u1', rec(ents(3)));
  await c.enter();
  c.abandon();
  await c.enter();
  assert.equal(c.getState().mode, 'ready');
  assert.equal(c.getState().error, null);
  assert.equal(c.shouldIntercept(LIST), true);
});

test('refresh() après abandon() : repart du cache, aucune lecture', async () => {
  const { c, cache, calls } = setup();
  await cache.put('u1', rec(ents(3)));
  await c.enter();
  c.abandon();
  await c.refresh();
  assert.equal(calls.loadAll.length + calls.loadNew.length, 0);
  assert.equal(c.getState().mode, 'ready');
  assert.equal(c.shouldIntercept(LIST), true);
});
