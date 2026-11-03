'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatSummary, formatLoaded, formatProgress, formatInterrupted, LABELS } = require('../extension/src/format.js');

test('formatSummary : pluriel, singulier, aucun', () => {
  assert.equal(formatSummary({ cards: 23, extra: 61 }), '23 cartes en double · 61 exemplaires en trop');
  assert.equal(formatSummary({ cards: 1, extra: 1 }), '1 carte en double · 1 exemplaire en trop');
  assert.equal(formatSummary({ cards: 0, extra: 0 }), 'Aucun doublon');
});

test('formatLoaded : instant, minutes, heures, jours', () => {
  const t = 1_000_000_000_000;
  assert.equal(formatLoaded(t, t + 30_000), "chargé à l'instant");
  assert.equal(formatLoaded(t, t + 5 * 60_000), 'chargé il y a 5 min');
  assert.equal(formatLoaded(t, t + 2 * 3_600_000), 'chargé il y a 2 h');
  assert.equal(formatLoaded(t, t + 3 * 86_400_000), 'chargé il y a 3 j');
  assert.equal(formatLoaded(t, t - 5000), "chargé à l'instant");
});

test('formatProgress', () => {
  assert.equal(formatProgress({ phase: 'full', pagesRead: 4, pageCount: 271 }), 'Lecture de ta collection… page 4 / 271');
  assert.equal(formatProgress({ phase: 'full', pagesRead: 4, pageCount: null }), 'Lecture de ta collection… page 4');
  assert.equal(formatProgress({ phase: 'incremental', pagesRead: 1, pageCount: null }), 'Mise à jour… page 1');
});

test('LABELS : valeurs exactes', () => {
  assert.equal(LABELS.option, 'Doublons');
  assert.equal(LABELS.refresh, '↻ rafraîchir');
  assert.equal(LABELS.loadingNote, "Une seule fois, ensuite c'est gardé en cache.");
  assert.equal(LABELS.updating, 'Mise à jour…');
  assert.equal(LABELS.stale, 'Ta collection a changé depuis le dernier chargement');
  assert.equal(LABELS.unexpected, 'Erreur inattendue : le site reste utilisable.');
});

test('formatInterrupted et formatProgress avec attente', () => {
  assert.equal(formatInterrupted({ page: 97, pageCount: 271 }), 'Lecture interrompue à la page 97 / 271 : le serveur ne répond pas. Les pages déjà lues sont gardées.');
  assert.equal(formatProgress({ phase: 'full', pagesRead: 97, pageCount: 271, retryInMs: 14200 }), 'Lecture de ta collection… page 97 / 271 — le serveur ne répond pas, nouvel essai dans 15 s');
  assert.equal(formatProgress({ phase: 'full', pagesRead: 97, pageCount: 271, retryInMs: null }), 'Lecture de ta collection… page 97 / 271');
  assert.equal(LABELS.resume, '↻ Reprendre');
});
