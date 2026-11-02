'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEntry } = require('./helpers');
const {
  RARITY_ORDER, groupDuplicates, summarize, normalizeText, filterGroups, rarityCounts,
} = require('../extension/src/duplicates');

const pair = (o = {}) => [makeEntry(o), makeEntry(o)];

test('RARITY_ORDER', () => {
  assert.deepEqual(RARITY_ORDER, ['L', 'UR', 'SR', 'R', 'PC', 'C']);
});

test('deux entrées de même carte forment un groupe n=2', () => {
  const a = makeEntry({ id: 'a', title: 'X' });
  const b = makeEntry({ id: 'b', title: 'X' });
  const groups = groupDuplicates([a, b]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].n, 2);
  assert.deepEqual(groups[0].ids, ['a', 'b']);
  assert.deepEqual(groups[0].members, [a, b]);
  assert.equal(groups[0].key, 'card-X|false');
});

test('count 3 seul : groupe n=3 ; count 1 seul : aucun', () => {
  assert.equal(groupDuplicates([makeEntry({ count: 3 })])[0].n, 3);
  assert.deepEqual(groupDuplicates([makeEntry()]), []);
});

test('normale et shiny ne fusionnent pas', () => {
  assert.deepEqual(
    groupDuplicates([makeEntry({ title: 'X' }), makeEntry({ title: 'X', shiny: true })]),
    [],
  );
});

test('représentante : non starred de préférence, puis la plus récente', () => {
  const starredNew = makeEntry({ id: 's', title: 'X', starred: true, obtainedAt: '2026-11-02T00:00:00+00:00' });
  const plain = makeEntry({ id: 'p', title: 'X', obtainedAt: '2026-10-01T00:00:00+00:00' });
  assert.equal(groupDuplicates([starredNew, plain])[0].entry.id, 'p');
  const old = makeEntry({ id: 'o', title: 'Y', obtainedAt: '2026-10-01T00:00:00+00:00' });
  const recent = makeEntry({ id: 'r', title: 'Y', obtainedAt: '2026-10-05T00:00:00+00:00' });
  assert.equal(groupDuplicates([old, recent])[0].entry.id, 'r');
});

test('représentante : dates comparées numériquement, pas en chaînes', () => {
  const a = makeEntry({ id: 'a', title: 'X', obtainedAt: '2026-11-01T10:00:00.5+00:00' });
  const b = makeEntry({ id: 'b', title: 'X', obtainedAt: '2026-11-01T10:00:00.123456+00:00' });
  assert.equal(groupDuplicates([a, b])[0].entry.id, 'a');
});

test('tri par n décroissant', () => {
  const es = [
    ...Array.from({ length: 2 }, () => makeEntry({ title: 'A' })),
    ...Array.from({ length: 5 }, () => makeEntry({ title: 'B' })),
    ...Array.from({ length: 3 }, () => makeEntry({ title: 'C' })),
  ];
  assert.deepEqual(groupDuplicates(es).map((g) => g.n), [5, 3, 2]);
});

test('à n égal : rareté, titre, normale avant shiny', () => {
  const es = [
    ...pair({ title: 'Zola', rarity: 'L' }),
    ...pair({ title: 'Albert', rarity: 'C' }),
    ...pair({ title: 'Abba', rarity: 'L' }),
    ...pair({ title: 'Inconnue', rarity: '??' }),
  ];
  assert.deepEqual(
    groupDuplicates(es).map((g) => g.entry.card.wikipedia_title),
    ['Abba', 'Zola', 'Albert', 'Inconnue'],
  );
  const mixed = [...pair({ title: 'Q', shiny: true }), ...pair({ title: 'Q' })];
  assert.deepEqual(groupDuplicates(mixed).map((g) => g.entry.is_shiny), [false, true]);
});

test('vides et summarize', () => {
  assert.deepEqual(groupDuplicates([]), []);
  assert.deepEqual(summarize([]), { cards: 0, extra: 0 });
  assert.deepEqual(summarize([{ n: 5 }, { n: 2 }]), { cards: 2, extra: 5 });
});

test('normalizeText', () => {
  assert.equal(normalizeText('Léman'), 'leman');
  assert.equal(normalizeText('Cœur'), 'coeur');
  assert.equal(normalizeText('Æon'), 'aeon');
});

const none = { search: '', tagId: null, rarities: [] };

test('filterGroups : recherche', () => {
  const groups = groupDuplicates([
    ...pair({ title: 'Lac Léman' }),
    ...pair({ title: 'Nicole', category: 'actrice australienne' }),
  ]);
  const titles = (f) => filterGroups(groups, { ...none, ...f }).map((g) => g.entry.card.wikipedia_title);
  assert.deepEqual(titles({ search: 'leman' }), ['Lac Léman']);
  assert.deepEqual(titles({ search: 'Léman' }), ['Lac Léman']);
  assert.deepEqual(titles({ search: 'eman' }), ['Lac Léman']);
  assert.deepEqual(titles({ search: 'ACTRICE' }), ['Nicole']);
});

test('filterGroups : étiquette', () => {
  const tagged = groupDuplicates([
    makeEntry({ id: 'a', title: 'X', tags: [{ id: 't1', name: 'n' }] }),
    makeEntry({ id: 'b', title: 'X' }),
  ]);
  const untagged = groupDuplicates(pair({ title: 'Y' }));
  const all = [...tagged, ...untagged];
  assert.deepEqual(filterGroups(all, { ...none, tagId: 't1' }).map((g) => g.key), ['card-X|false']);
});

test('filterGroups : tagId renvoie une copie dont entry porte l\'étiquette', () => {
  const [g] = groupDuplicates([
    makeEntry({ id: 'p', title: 'X', obtainedAt: '2026-11-02T00:00:00+00:00' }),
    makeEntry({ id: 'q', title: 'X', obtainedAt: '2026-10-01T00:00:00+00:00', tags: [{ id: 't1' }] }),
  ]);
  assert.equal(g.entry.id, 'p');
  const [out] = filterGroups([g], { ...none, tagId: 't1' });
  assert.equal(out.entry.id, 'q');
  assert.notEqual(out, g);
  assert.equal(g.entry.id, 'p');
});

test('filterGroups : rareté, vide, intersection', () => {
  const groups = groupDuplicates([
    ...pair({ title: 'A', rarity: 'L' }),
    ...pair({ title: 'B', rarity: 'UR' }),
    ...pair({ title: 'C', rarity: 'C' }),
  ]);
  const rar = filterGroups(groups, { ...none, rarities: ['L', 'UR'] });
  assert.deepEqual(rar.map((g) => g.entry.card.rarity), ['L', 'UR']);
  assert.deepEqual(filterGroups(groups, none), groups);
  const both = filterGroups(groups, { ...none, search: 'b', rarities: ['L', 'UR'] });
  assert.deepEqual(both.map((g) => g.entry.card.wikipedia_title), ['B']);
});

test('rarityCounts', () => {
  const groups = groupDuplicates([
    ...pair({ title: 'A', rarity: 'C' }),
    ...pair({ title: 'B', rarity: 'C' }),
    ...pair({ title: 'D', rarity: 'L' }),
  ]);
  assert.deepEqual(rarityCounts(groups), { C: 2, L: 1 });
});
