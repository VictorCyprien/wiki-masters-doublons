// Sonde 4 — à coller dans la console DevTools, sur /collection.
// Au collage : note les appels du site à /api/my-collection. Victor choisit Tri → « Date d'ajout »,
// puis Tri → « Favoris », puis Tri → « Rareté », puis tape __wmProbe4.run().
// run() : lit 2 fois les pages 0 et 1 sous le tri « Date d'ajout » (4 appels, 400 ms d'écart)
// et vérifie l'ordre (obtained_at décroissant ?) et sa stabilité. Fin : télécharge wm-04-date-sort.json.
(() => {
  if (window.__wmProbe4) return 'sonde 4 déjà chargée';
  const P = (window.__wmProbe4 = { siteCalls: [] });
  const origFetch = window.fetch;
  window.fetch = function (input) {
    try {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
      if (url.includes('/api/my-collection?')) P.siteCalls.push(url.replace(location.origin, ''));
    } catch (e) { /* rien */ }
    return origFetch.apply(this, arguments);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.run = async () => {
    const sorts = [...new Set(P.siteCalls.map((u) => new URL(u, location.origin).searchParams.get('sort')))];
    const OUT = { when: new Date().toISOString(), siteCalls: P.siteCalls.slice(), sorts, reads: {} };
    const dateSort = sorts.find((s) => s && !['rarity', 'name'].includes(s) && /date|recent|obtain|new|added|created/i.test(s)) || sorts.find((s) => s && !['rarity', 'name'].includes(s));
    OUT.dateSort = dateSort || null;
    if (dateSort) {
      for (const pass of ['a', 'b']) for (const page of [0, 1]) {
        const res = await origFetch('/api/my-collection?sort=' + encodeURIComponent(dateSort) + '&page=' + page + '&stats=0', { credentials: 'same-origin' });
        const j = await res.json();
        const l = j.collection || [];
        const dates = l.map((e) => e.obtained_at);
        OUT.reads[pass + page] = {
          status: res.status,
          len: l.length,
          ids: l.map((e) => e.id).slice(0, 10),
          firstDates: dates.slice(0, 5),
          lastDate: dates[dates.length - 1],
          descending: dates.every((d, i) => i === 0 || dates[i - 1] >= d),
          ascending: dates.every((d, i) => i === 0 || dates[i - 1] <= d),
        };
        await sleep(400);
      }
      OUT.stable = JSON.stringify(OUT.reads.a0.ids) === JSON.stringify(OUT.reads.b0.ids) && JSON.stringify(OUT.reads.a1.ids) === JSON.stringify(OUT.reads.b1.ids);
      OUT.pagesChain = OUT.reads.a0.lastDate >= OUT.reads.a1.firstDates[0];
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(OUT, null, 2)], { type: 'application/json' }));
    a.download = 'wm-04-date-sort.json';
    a.click();
    return 'sonde 4 terminée : tri date = ' + OUT.dateSort;
  };
  return 'sonde 4 prête : Tri → Date d\'ajout, puis Favoris, puis Rareté, puis tape __wmProbe4.run()';
})();
