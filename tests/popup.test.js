'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'extension', 'popup');
const html = fs.readFileSync(path.join(dir, 'popup.html'), 'utf8');

const LINKS = [
  'https://buymeacoffee.com/victorcyprien',
  'https://www.tip.md/VictorCyprien',
  'https://github.com/A-REMPLACER/wiki-masters-doublons',
];

test('aucun script en ligne, aucun gestionnaire on…=', () => {
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /^<script src="popup\.js"><\/script>$/);
  assert.doesNotMatch(html, /\son\w+\s*=/i);
});

test('http seulement dans les trois liens attendus', () => {
  const urls = html.match(/https?:\/\/[^"'\s<)]+/g) || [];
  assert.deepEqual(urls.sort(), [...LINKS].sort());
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'popup.css'), 'utf8'), /https?:|@import|url\(\s*['"]?(?!\.\.\/icons)/);
});

test('A-REMPLACER seulement dans le lien GitHub', () => {
  const stripped = html.replace(/href="[^"]*A-REMPLACER[^"]*"/g, '');
  assert.doesNotMatch(stripped, /A-REMPLACER/);
  assert.equal((html.match(/A-REMPLACER/g) || []).length, 1);
  assert.match(html, /href="https:\/\/github\.com\/A-REMPLACER\/wiki-masters-doublons"/);
});

test('textes exacts', () => {
  assert.match(html, /<html lang="fr">/);
  for (const t of [
    'Doublons pour Wiki Masters',
    "Le site ne sait pas trier tes cartes en double. L'extension ajoute un choix « Doublons » dans le tri de ta collection.",
    'Comment faire',
    'Ouvre ta collection sur wiki-masters.com.',
    'Dans le menu de tri, choisis « Doublons ».',
    "La première fois, l'extension lit toute ta collection : compte environ 2 minutes pour 1 000 cartes, en gardant l'onglet visible. Ensuite, c'est immédiat.",
    "Tes cartes restent dans ton navigateur : rien n'est envoyé ailleurs que sur wiki-masters.com.",
    'Soutenir',
    "L'extension est gratuite et le restera. Si elle te rend service, tu peux m'offrir un café.",
    '☕ Buy Me a Coffee',
    'Laisser un pourboire',
    'Extension non officielle, sans lien avec Wiki Masters.',
    'Code source',
  ]) {
    assert.ok(html.includes(t), t);
  }
  assert.match(html, /<ol>[\s\S]*<li>[\s\S]*<li>[\s\S]*<li>[\s\S]*<\/ol>/);
  assert.match(html, /<img[^>]*src="\.\.\/icons\/icon-48\.png"/);
});

test('liens : target _blank et rel noopener noreferrer', () => {
  const anchors = html.match(/<a\b[^>]*>/g) || [];
  assert.equal(anchors.length, 3);
  for (const a of anchors) {
    assert.match(a, /target="_blank"/);
    assert.match(a, /rel="noopener noreferrer"/);
  }
});

test('popup.js : remplit la version, sans échouer hors extension', () => {
  const src = fs.readFileSync(path.join(dir, 'popup.js'), 'utf8');
  const els = { version: { textContent: '' } };
  const run = (g) => new Function('document', 'chrome', src)(
    { getElementById: (id) => els[id] }, g);
  run({ runtime: { getManifest: () => ({ version: '1.2.3' }) } });
  assert.equal(els.version.textContent, '1.2.3');
  els.version.textContent = '';
  assert.doesNotThrow(() => run(undefined));
  assert.equal(els.version.textContent, '');
});
