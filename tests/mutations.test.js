'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMutation } = require('../extension/src/mutations.js');

const ID = 'e6802c13-f7c0-49ee-8a36-cd11aabba3cd';
const TAG = '92158624-7aba-4e00-832d-e5d5571d2c52';

test('favori posé (sonde 6)', () => {
  assert.deepEqual(
    parseMutation({ url: `/rest/v1/user_cards?id=eq.${ID}`, method: 'PATCH', body: '{"starred":true}', status: 204 }),
    [{ kind: 'starred', entryId: ID, value: true }],
  );
});

test('favori retiré (sonde 6)', () => {
  assert.deepEqual(
    parseMutation({ url: `/rest/v1/user_cards?id=eq.${ID}`, method: 'PATCH', body: '{"starred":false}', status: 204 }),
    [{ kind: 'starred', entryId: ID, value: false }],
  );
});

test('étiquette ajoutée (sonde 6)', () => {
  const body = JSON.stringify({ user_card_id: ID, tag_id: TAG });
  assert.deepEqual(
    parseMutation({ url: '/rest/v1/user_card_tags', method: 'POST', body, status: 201 }),
    [{ kind: 'tagAdd', entryId: ID, tagId: TAG }],
  );
});

test('étiquette retirée (sonde 6), ordre libre', () => {
  const expected = [{ kind: 'tagRemove', entryId: ID, tagId: TAG }];
  assert.deepEqual(
    parseMutation({ url: `/rest/v1/user_card_tags?user_card_id=eq.${ID}&tag_id=eq.${TAG}`, method: 'DELETE', body: null, status: 204 }),
    expected,
  );
  assert.deepEqual(
    parseMutation({ url: `/rest/v1/user_card_tags?tag_id=eq.${TAG}&user_card_id=eq.${ID}`, method: 'DELETE', body: null, status: 204 }),
    expected,
  );
});

test('statut hors 2xx, GET, corps invalide ou starred non booléen : rien', () => {
  const u = `/rest/v1/user_cards?id=eq.${ID}`;
  assert.deepEqual(parseMutation({ url: u, method: 'PATCH', body: '{"starred":true}', status: 401 }), []);
  assert.deepEqual(parseMutation({ url: u, method: 'GET', body: null, status: 200 }), []);
  assert.deepEqual(parseMutation({ url: u, method: 'PATCH', body: '{"starred":"yes"}', status: 204 }), []);
  assert.deepEqual(parseMutation({ url: u, method: 'PATCH', body: '{"name":"x"}', status: 204 }), []);
  assert.deepEqual(parseMutation({ url: u, method: 'PATCH', body: 'pas du json', status: 204 }), []);
  assert.deepEqual(parseMutation({ url: u, method: 'PATCH', body: null, status: 204 }), []);
  assert.deepEqual(parseMutation({ url: u, method: 'PATCH', body: { starred: true }, status: 204 }), []);
  assert.deepEqual(parseMutation({ url: u, method: 'PATCH', body: '[{"starred":true}]', status: 204 }), []);
});

test('autres champs du corps ignorés', () => {
  assert.deepEqual(
    parseMutation({ url: `/rest/v1/user_cards?id=eq.${ID}`, method: 'PATCH', body: '{"starred":true,"x":1}', status: 200 }),
    [{ kind: 'starred', entryId: ID, value: true }],
  );
});

test('POST tableau de 2 : 2 mutations ; éléments invalides écartés', () => {
  const body = JSON.stringify([{ user_card_id: 'a', tag_id: 't1' }, { user_card_id: 'b', tag_id: 't2' }, { user_card_id: 'c' }, null]);
  assert.deepEqual(parseMutation({ url: '/rest/v1/user_card_tags', method: 'POST', body, status: 201 }), [
    { kind: 'tagAdd', entryId: 'a', tagId: 't1' },
    { kind: 'tagAdd', entryId: 'b', tagId: 't2' },
  ]);
});

test('DELETE sans tag_id ou sans user_card_id : rien', () => {
  assert.deepEqual(parseMutation({ url: `/rest/v1/user_card_tags?user_card_id=eq.${ID}`, method: 'DELETE', body: null, status: 204 }), []);
  assert.deepEqual(parseMutation({ url: `/rest/v1/user_card_tags?tag_id=eq.${TAG}`, method: 'DELETE', body: null, status: 204 }), []);
});

test('mauvais chemin : rien', () => {
  assert.deepEqual(parseMutation({ url: `/rest/v1/user_tags?id=eq.${ID}`, method: 'PATCH', body: '{"starred":true}', status: 204 }), []);
});

test('URL absolue reconnue, valeurs eq. décodées', () => {
  assert.deepEqual(
    parseMutation({ url: 'https://x.supabase.co/rest/v1/user_cards?id=eq.abc', method: 'PATCH', body: '{"starred":true}', status: 204 }),
    [{ kind: 'starred', entryId: 'abc', value: true }],
  );
  assert.deepEqual(
    parseMutation({ url: 'https://x.supabase.co/rest/v1/user_cards?id=eq.a%20b', method: 'PATCH', body: '{"starred":false}', status: 204 }),
    [{ kind: 'starred', entryId: 'a b', value: false }],
  );
});

test('ne lève jamais', () => {
  assert.deepEqual(parseMutation(), []);
  assert.deepEqual(parseMutation({}), []);
  assert.deepEqual(parseMutation({ url: null, method: 'PATCH', status: 200 }), []);
});
