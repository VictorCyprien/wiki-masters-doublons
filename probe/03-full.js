// Sonde 3 — à coller dans la console DevTools, sur /collection.
// Phase 1 (au collage) : note les appels du site à /api/my-collection pendant que Victor choisit
//   son étiquette dans « Toutes les étiquettes », puis revient à « Toutes les étiquettes ».
// Phase 2 : __wmProbe3.run() — lecture complète, une page à la fois, 400 ms après chaque réponse
//   (≈ 271 pages, 10 à 12 min). Arrêt net sur 429 ou 5xx. Puis comparaison des règles de recherche
//   et d'étiquette avec le serveur (≈ 10 appels). Ne garde que des agrégats, plus 5 entrées en double
//   (user_id masqué). Fin : télécharge wm-03-full.json.
(() => {
  if (window.__wmProbe3) return 'sonde 3 déjà chargée';
  const P = (window.__wmProbe3 = { siteCalls: [] });
  const origFetch = window.fetch;
  window.fetch = function (input) {
    try {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
      if (url.includes('/api/my-collection')) P.siteCalls.push(url.replace(location.origin, ''));
    } catch (e) { /* rien */ }
    return origFetch.apply(this, arguments);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  P.run = async () => {
    const OUT = { when: new Date().toISOString(), siteCalls: P.siteCalls.slice(), errors: [], timings: [] };
    let stopped = false;
    const get = async (label, url) => {
      if (stopped) return null;
      const t0 = performance.now();
      let res = null, json = null;
      try { res = await origFetch(url, { credentials: 'same-origin' }); json = await res.json(); } catch (e) { OUT.errors.push({ label, err: e.message }); }
      const ms = Math.round(performance.now() - t0);
      OUT.timings.push(ms);
      if (!res || res.status === 429 || res.status >= 500 || res.status >= 400) {
        OUT.errors.push({ label, status: res && res.status, retryAfter: res && res.headers.get('retry-after') });
        if (!res || res.status === 429 || res.status >= 500) stopped = true;
      }
      await sleep(400);
      return json;
    };

    // Total annoncé par le serveur.
    const st = await get('stats', '/api/my-collection/stats?sort=rarity');
    OUT.stats = st;
    const pages = Math.ceil(((st && st.total) || 0) / 50);
    OUT.pagesPlanned = pages;

    // Lecture complète.
    const all = [];
    const t0 = Date.now();
    for (let p = 0; p < pages && !stopped; p++) {
      const j = await get('p' + p, '/api/my-collection?sort=rarity&page=' + p + '&stats=0');
      const list = (j && j.collection) || [];
      if (!list.length) { OUT.emptyPageAt = p; break; }
      for (const e of list) all.push(e);
      if (p % 10 === 0) console.log('[sonde3] page', p + 1, '/', pages, '—', Math.round((Date.now() - t0) / 1000) + ' s');
    }
    OUT.stopped = stopped;
    OUT.readSeconds = Math.round((Date.now() - t0) / 1000);

    // Agrégats (H2, H3, H4).
    const uniq = (f) => new Set(all.map(f)).size;
    const hist = {};
    for (const e of all) hist[e.count] = (hist[e.count] || 0) + 1;
    const dups = all.filter((e) => e.count >= 2);
    const byRarity = {};
    for (const e of dups) byRarity[e.card.rarity] = (byRarity[e.card.rarity] || 0) + 1;
    OUT.agg = {
      entries: all.length,
      uniqueIds: uniq((e) => e.id),
      uniqueCardIds: uniq((e) => e.card_id),
      uniqueCardShiny: uniq((e) => e.card_id + '|' + e.is_shiny),
      sumCount: all.reduce((s, e) => s + e.count, 0),
      countHist: hist,
      shiny: all.filter((e) => e.is_shiny).length,
      tagged: all.filter((e) => Array.isArray(e.tags) && e.tags.length).length,
      dupEntries: dups.length,
      dupExtra: dups.reduce((s, e) => s + e.count - 1, 0),
      dupByRarity: byRarity,
      users: uniq((e) => e.user_id),
      timingAvgMs: Math.round(OUT.timings.reduce((a, b) => a + b, 0) / OUT.timings.length),
      timingMaxMs: Math.max(...OUT.timings),
    };
    const sameCard = {};
    for (const e of all) (sameCard[e.card_id] = sameCard[e.card_id] || []).push(e.is_shiny);
    OUT.agg.cardIdsWithSeveralEntries = Object.values(sameCard).filter((v) => v.length > 1).map((v) => v.join('+')).slice(0, 30);
    OUT.tagSample = (all.find((e) => Array.isArray(e.tags) && e.tags.length) || {}).tags || null;
    OUT.dupSample = dups.slice(0, 5).map((e) => ({ ...e, user_id: 'user-A' }));

    // Règle de recherche (H8) : total serveur contre règles locales.
    const low = (s) => String(s || '').toLowerCase();
    const norm = (s) => low(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
    const rules = {
      titleOrCat_accents: (e, q) => low(e.card.wikipedia_title).includes(low(q)) || low(e.card.category).includes(low(q)),
      titleOrCat_noAccents: (e, q) => norm(e.card.wikipedia_title).includes(norm(q)) || norm(e.card.category).includes(norm(q)),
      titleOnly_accents: (e, q) => low(e.card.wikipedia_title).includes(low(q)),
    };
    OUT.search = {};
    for (const q of ['Léman', 'leman', 'australienne', 'eman', 'Paris', 'ACTRICE']) {
      const s = await get('q-' + q, '/api/my-collection/stats?sort=rarity&q=' + encodeURIComponent(q));
      const local = {};
      for (const [k, f] of Object.entries(rules)) local[k] = all.filter((e) => f(e, q)).length;
      OUT.search[q] = { server: s && s.total, local };
    }

    // Étiquettes (H8) : paramètre vu pendant la phase 1, total serveur contre correspondance locale.
    OUT.tags = { options: st && st.tagOptions, tests: [] };
    const tagCalls = OUT.siteCalls.filter((u) => /\/api\/my-collection\?/.test(u)).map((u) => new URL(u, location.origin).searchParams);
    const known = new Set(['sort', 'page', 'stats', 'q', 'rarity']);
    const seen = new Set();
    for (const sp of tagCalls) for (const [k, v] of sp) if (!known.has(k) && !seen.has(k + '=' + v)) {
      seen.add(k + '=' + v);
      const s = await get('tag-' + k, '/api/my-collection/stats?sort=rarity&' + encodeURIComponent(k) + '=' + encodeURIComponent(v));
      const localById = all.filter((e) => (e.tags || []).some((t) => String(t && typeof t === 'object' ? t.id : t) === v)).length;
      const localByName = all.filter((e) => (e.tags || []).some((t) => String(t && typeof t === 'object' ? t.name || t.label : t) === v)).length;
      OUT.tags.tests.push({ param: k, value: v, server: s && s.total, localById, localByName });
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(OUT, null, 2)], { type: 'application/json' }));
    a.download = 'wm-03-full.json';
    a.click();
    return 'sonde 3 terminée : ' + all.length + ' entrées' + (stopped ? ' (ARRÊTÉE, voir errors)' : '');
  };
  return 'sonde 3 prête : choisis ton étiquette, reviens à « Toutes les étiquettes », puis tape __wmProbe3.run()';
})();
