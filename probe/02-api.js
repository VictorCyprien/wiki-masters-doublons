// Sonde 2 — à coller dans la console DevTools, sur /collection, APRÈS la sonde 1 (même onglet, sans recharger).
// Interroge /api/my-collection, un appel à la fois, 400 ms entre deux appels (≈ 30 appels, 1 à 2 min).
// S'arrête net sur 429 ou 5xx. Ne renvoie que des métadonnées (clés, longueurs, counts, en-têtes de débit)
// et une fixture de 6 entrées avec user_id remplacé par "user-A". Aucun cookie, aucun jeton.
// Fin : télécharge wm-02-api.json dans Téléchargements.
(async () => {
  const OUT = { when: new Date().toISOString(), calls: [], notes: [] };
  window.__wmProbe2 = OUT;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const HDRS = ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'ratelimit', 'ratelimit-policy', 'cf-cache-status', 'cache-control', 'age', 'x-vercel-cache', 'server', 'content-type'];
  let stopped = false;
  let last = 0;

  async function get(label, url) {
    if (stopped) return null;
    const wait = 400 - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    const t0 = performance.now();
    let res, json = null, err = null;
    try {
      res = await fetch(url, { credentials: 'same-origin' });
      try { json = await res.json(); } catch (e) { err = 'json: ' + e.message; }
    } catch (e) { err = 'fetch: ' + e.message; }
    last = Date.now();
    const rec = { label, url, status: res ? res.status : null, ms: Math.round(performance.now() - t0), err, headers: {} };
    if (res) for (const h of HDRS) { const v = res.headers.get(h); if (v !== null) rec.headers[h] = v.slice(0, 120); }
    OUT.calls.push(rec);
    if (res && (res.status === 429 || res.status >= 500)) { stopped = true; OUT.notes.push('ARRÊT sur ' + res.status + ' à ' + label); }
    console.log('[sonde2]', label, rec.status, rec.ms + ' ms');
    return json;
  }

  // Forme d'une réponse : clés, types, scalaires de l'enveloppe, liste repérée.
  const listOf = (j) => {
    if (Array.isArray(j)) return { key: '(racine)', list: j };
    if (j && typeof j === 'object') for (const [k, v] of Object.entries(j)) if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] && 'count' in v[0]) return { key: k, list: v };
    if (j && typeof j === 'object') for (const [k, v] of Object.entries(j)) if (Array.isArray(v)) return { key: k, list: v };
    return { key: null, list: [] };
  };
  const shape = (j) => {
    if (j === null || typeof j !== 'object') return { type: typeof j };
    const s = {};
    for (const [k, v] of Object.entries(j)) {
      if (Array.isArray(v)) s[k] = { array: v.length, itemKeys: v[0] && typeof v[0] === 'object' ? Object.keys(v[0]) : typeof v[0] };
      else if (v && typeof v === 'object') s[k] = { object: Object.keys(v).slice(0, 30) };
      else s[k] = typeof v === 'string' ? v.slice(0, 60) : v;
    }
    return s;
  };
  const summary = (j) => {
    const { key, list } = listOf(j);
    const counts = list.map((e) => e.count);
    const hist = {};
    for (const c of counts) hist[c] = (hist[c] || 0) + 1;
    return { listKey: key, length: list.length, firstCounts: counts.slice(0, 12), countHist: hist, firstIds: list.slice(0, 5).map((e) => e.id), shinyInPage: list.filter((e) => e.is_shiny).length, tagged: list.filter((e) => Array.isArray(e.tags) && e.tags.length).length };
  };
  const base = (params) => '/api/my-collection?' + new URLSearchParams(params).toString();

  // 0. Valeurs de tri vues par la sonde 1 (Victor a cliqué Date d'ajout et Favoris avant).
  const seenSorts = new Set(['rarity']);
  for (const h of (window.__wmProbe && window.__wmProbe.headers) || []) { const m = /[?&]sort=([^&]+)/.exec(h.url || ''); if (m) seenSorts.add(decodeURIComponent(m[1])); }
  OUT.seenSorts = [...seenSorts];

  // 1. Page 0 de référence (H1, H2).
  const p0 = await get('page0', base({ sort: 'rarity', page: 0, stats: 0 }));
  OUT.page0 = { shape: shape(p0), summary: summary(p0) };
  const { key: LK, list: L0 } = listOf(p0);
  OUT.entryKeys = L0[0] ? Object.keys(L0[0]) : null;
  OUT.cardKeys = L0[0] && L0[0].card ? Object.keys(L0[0].card) : null;
  OUT.tagSample = (L0.find((e) => Array.isArray(e.tags) && e.tags.length) || {}).tags || null;

  // 2. Endpoint stats (pagination ? totaux ?) et stats=1.
  const st = await get('stats', '/api/my-collection/stats?sort=rarity');
  OUT.stats = { shape: shape(st), raw: JSON.stringify(st).slice(0, 3000) };
  const st1 = await get('page0-stats1', base({ sort: 'rarity', page: 0, stats: 1 }));
  OUT.page0stats1 = { shape: shape(st1) };
  const stL = await get('stats-rarityL', '/api/my-collection/stats?sort=rarity&rarity=L');
  OUT.statsRarityL = JSON.stringify(stL).slice(0, 1500);

  // 3. Taille de page (H6).
  OUT.pageSize = {};
  for (const p of ['limit', 'per_page', 'size', 'page_size', 'pageSize']) {
    const j = await get('size-' + p, base({ sort: 'rarity', page: 0, stats: 0, [p]: 200 }));
    OUT.pageSize[p] = summary(j).length;
  }

  // 4. Tri ou filtre serveur sur count (H5).
  OUT.serverCount = {};
  for (const [label, params] of [
    ['sort=count', { sort: 'count' }], ['sort=-count', { sort: '-count' }], ['sort=duplicates', { sort: 'duplicates' }], ['sort=quantity', { sort: 'quantity' }],
    ['min_count=2', { sort: 'rarity', min_count: 2 }], ['duplicates=1', { sort: 'rarity', duplicates: 1 }], ['count_gte=2', { sort: 'rarity', count_gte: 2 }],
  ]) {
    const j = await get('srv-' + label, base({ ...params, page: 0, stats: 0 }));
    OUT.serverCount[label] = summary(j);
  }

  // 5. Ordre déterministe (LOAD_SORT) : même page lue deux fois, pour chaque tri vu.
  OUT.determinism = {};
  for (const s of seenSorts) {
    const a = summary(await get('det-' + s + '-a', base({ sort: s, page: 100, stats: 0 })));
    const b = summary(await get('det-' + s + '-b', base({ sort: s, page: 100, stats: 0 })));
    OUT.determinism[s] = { sameOrder: JSON.stringify(a.firstIds) === JSON.stringify(b.firstIds), lenA: a.length, lenB: b.length };
  }

  // 6. Fraîcheur (H12) : premier obtained_at sous chaque tri vu, page 0.
  OUT.freshness = {};
  for (const s of seenSorts) {
    const j = await get('fresh-' + s, base({ sort: s, page: 0, stats: 0 }));
    const l = listOf(j).list;
    OUT.freshness[s] = l.slice(0, 3).map((e) => e.obtained_at);
  }

  // 7. Fixture : 6 entrées de la page 0 (count ≥ 2, shiny, étiquette en priorité), user_id masqué.
  const pick = [];
  const add = (e) => { if (e && !pick.includes(e) && pick.length < 6) pick.push(e); };
  add(L0.find((e) => e.count >= 2)); add(L0.find((e) => e.is_shiny)); add(L0.find((e) => Array.isArray(e.tags) && e.tags.length));
  for (const e of L0) add(e);
  const fixture = JSON.parse(JSON.stringify(p0 || {}));
  const mask = (e) => ({ ...e, user_id: 'user-A' });
  if (LK && LK !== '(racine)') fixture[LK] = pick.map(mask);
  OUT.fixture = LK === '(racine)' ? pick.map(mask) : fixture;

  // Téléchargement du résultat.
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(OUT, null, 2)], { type: 'application/json' }));
  a.download = 'wm-02-api.json';
  a.click();
  return 'sonde 2 terminée : ' + OUT.calls.length + ' appels' + (stopped ? ' (ARRÊTÉE, voir notes)' : '');
})();
