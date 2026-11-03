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

test('src/mutations.js présent, avant src/controller.js', () => {
  const js = manifest.content_scripts[0].js;
  assert.ok(js.includes('src/mutations.js'));
  assert.ok(js.indexOf('src/mutations.js') < js.indexOf('src/controller.js'));
});

test('Chrome 111 au minimum (world MAIN ignoré avant)', () => {
  assert.equal(manifest.minimum_chrome_version, '111');
});

test('icônes et action : fichiers présents, tailles PNG exactes', () => {
  const size = (rel) => {
    const b = fs.readFileSync(path.join(root, rel));
    assert.equal(b.subarray(1, 4).toString(), 'PNG', rel);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  assert.deepEqual(Object.keys(manifest.icons).sort(), ['128', '16', '32', '48']);
  for (const [n, rel] of Object.entries(manifest.icons)) {
    assert.deepEqual(size(rel), [Number(n), Number(n)], rel);
  }
  assert.deepEqual(Object.keys(manifest.action.default_icon).sort(), ['16', '32']);
  for (const [n, rel] of Object.entries(manifest.action.default_icon)) {
    assert.deepEqual(size(rel), [Number(n), Number(n)], rel);
  }
  assert.equal(manifest.action.default_title, 'Doublons pour Wiki Masters');
  assert.ok(fs.existsSync(path.join(root, manifest.action.default_popup)));
});

test('description exacte', () => {
  assert.equal(
    manifest.description,
    'Trouve tes cartes en double sur Wiki Masters : un choix « Doublons » apparaît dans le tri de ta collection.'
  );
});

test('icônes : make-icons.js est déterministe et reproduit les fichiers versionnés', () => {
  const { execFileSync } = require('node:child_process');
  const script = path.join(__dirname, '..', 'tools', 'make-icons.js');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-icons-'));
  try {
    execFileSync(process.execPath, [script, tmp]); // n'écrit jamais dans les fichiers versionnés
    for (const n of [16, 32, 48, 128]) {
      const committed = fs.readFileSync(path.join(root, 'icons', `icon-${n}.png`));
      assert.ok(committed.equals(fs.readFileSync(path.join(tmp, `icon-${n}.png`))), `icon-${n}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
