'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('manifeste MV3, un seul content script MAIN au document_start', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts.length, 1);
  const cs = manifest.content_scripts[0];
  assert.equal(cs.world, 'MAIN');
  assert.equal(cs.run_at, 'document_start');
  assert.deepEqual(cs.matches, ['https://www.wiki-masters.com/*']);
});

test('aucune permission', () => {
  assert.equal('permissions' in manifest, false);
  assert.equal('host_permissions' in manifest, false);
});

test('chaque fichier js existe, main.js en dernier', () => {
  const js = manifest.content_scripts[0].js;
  for (const f of js) assert.ok(fs.existsSync(path.join(root, f)), f);
  assert.equal(js[js.length - 1], 'src/main.js');
});
