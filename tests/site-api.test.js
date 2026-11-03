'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../extension/src/site-api.js');
const { makeEntry } = require('./helpers.js');
const page0 = require('./fixtures/page0.json');
const page0Stats1 = require('./fixtures/page0-stats1.json');
const statsFixture = require('./fixtures/stats.json');

const { SITE, classifyUrl, parseSiteQuery, buildPageUrl, parseList, buildListResponse,
  buildStatsResponse, readFreshness, fetchFreshness } = api;

const cards = (n) => Array.from({ length: n }, (_, i) => makeEntry({ title: `Carte ${i}` }));

test('classifyUrl', () => {
  assert.equal(classifyUrl('/api/my-collection?sort=rarity&page=0&stats=0'), 'list');
  assert.equal(classifyUrl('/api/my-collection/stats?sort=rarity&q=L%C3%A9man'), 'stats');
  assert.equal(classifyUrl('https://www.wiki-masters.com/api/my-collection'), 'list');
  assert.equal(classifyUrl('/api/cards?page=0&sort=rarity'), null);
  assert.equal(classifyUrl('https://evil.example/api/my-collection'), null);
});

test('parseSiteQuery', () => {
  assert.deepEqual(parseSiteQuery('/api/my-collection?sort=rarity&q=L%C3%A9man&page=0&stats=0'),
    { page: 0, search: 'Léman', tagId: null, rarities: [] });
  assert.deepEqual(parseSiteQuery('/api/my-collection?sort=rarity&rarity=L&page=0&stats=0'),
    { page: 0, search: '', tagId: null, rarities: ['L'] });
  assert.equal(parseSiteQuery('/api/my-collection?sort=rarity&tag_id=92158624-7aba-4e00-832d-e5d5571d2c52&page=0&stats=0').tagId,
    '92158624-7aba-4e00-832d-e5d5571d2c52');
  assert.equal(parseSiteQuery('/api/my-collection?sort=rarity&page=2&stats=0').page, 2);
  assert.deepEqual(parseSiteQuery('/api/my-collection/stats?sort=rarity&rarity=L,UR').rarities, ['L', 'UR']);
  assert.deepEqual(parseSiteQuery('/api/my-collection/stats?rarity=L&rarity=R,,SR').rarities, ['L', 'R', 'SR']);
});

test('buildPageUrl', () => {
  assert.equal(buildPageUrl(3, 'added'), '/api/my-collection?sort=added&page=3&stats=0');
});

test('parseList', () => {
  assert.equal(parseList(page0).length, 6);
  assert.deepEqual(parseList({}), []);
});

test('buildListResponse tranche la page', () => {
  const r = buildListResponse(page0, cards(53), 1);
  assert.equal(r.collection.length, 3);
  assert.equal(r.total, null);
  assert.deepEqual(r.rarityCounts, {});
  assert.deepEqual(r.tagOptions, []);
  assert.deepEqual(r.pendingTradeCardIds, []);
});

test('buildListResponse page hors limites', () => {
  assert.deepEqual(buildListResponse(page0, cards(1), 5).collection, []);
});

test('buildListResponse ne modifie pas le template', () => {
  const before = JSON.stringify(page0);
  buildListResponse(page0, cards(10), 0);
  assert.equal(JSON.stringify(page0), before);
});

test('buildStatsResponse', () => {
  const r = buildStatsResponse(page0Stats1, { total: 24, rarityCounts: { C: 20, R: 4 } });
  assert.deepEqual(r, { total: 24, totalUnique: 24, rarityCounts: { C: 20, R: 4 }, tagOptions: page0Stats1.tagOptions });
  assert.equal(r.tagOptions.length, 1);
  assert.deepEqual(Object.keys(r).sort(), Object.keys(statsFixture).sort());
});

test('readFreshness', () => {
  const sorted = Object.fromEntries(Object.entries(page0Stats1.rarityCounts).sort(([a], [b]) => (a < b ? -1 : 1)));
  const r = readFreshness(page0Stats1);
  assert.equal(r.userId, 'user-A');
  assert.equal(r.total, 13522);
  assert.equal(r.freshness, '13522|' + JSON.stringify(sorted));
  assert.equal(r.template, page0Stats1);
});

test('readFreshness ne dépend pas de l\'ordre des clés', () => {
  const a = readFreshness({ collection: [], total: 3, rarityCounts: { C: 1, R: 2 } });
  const b = readFreshness({ collection: [], total: 3, rarityCounts: { R: 2, C: 1 } });
  assert.equal(a.freshness, b.freshness);
  assert.equal(a.userId, null);
});

test('fetchFreshness', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const ok = async (url, init) => { calls.push([url, init]); return { ok: true, status: 200, json: async () => page0Stats1 }; };
  const r = await fetchFreshness(ok, { signal });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], SITE.FRESHNESS_URL);
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(calls[0][1].signal, signal);
  assert.equal(r.total, 13522);
  await assert.rejects(fetchFreshness(async () => ({ ok: false, status: 500, json: async () => ({}) })));
});

test('FRESHNESS_URL : tri « Date d\'ajout », page 0, stats', () => {
  assert.equal(SITE.FRESHNESS_URL, '/api/my-collection?sort=added&page=0&stats=1');
});

test('readFreshness : newest = plus grand obtained_at (ms), template inchangé', () => {
  const r = readFreshness(page0Stats1);
  assert.equal(r.newest, Date.parse('2026-11-02T11:46:45.895091+00:00'));
  assert.equal(r.template, page0Stats1);
  const mixed = readFreshness({ collection: [
    makeEntry({ obtainedAt: '2026-10-01T00:00:00+00:00' }), makeEntry({ obtainedAt: '2026-11-01T00:00:00+00:00' }),
    makeEntry({ obtainedAt: 'pas une date' }),
  ], total: 3, rarityCounts: {} });
  assert.equal(mixed.newest, Date.parse('2026-11-01T00:00:00+00:00'));
});

test('readFreshness : aucune entrée lisible -> newest null', () => {
  assert.equal(readFreshness({ collection: [], total: 0, rarityCounts: {} }).newest, null);
  assert.equal(readFreshness({ total: 3 }).newest, null);
  assert.equal(readFreshness({ collection: [{ obtained_at: 'x' }, {}], total: 2 }).newest, null);
});
