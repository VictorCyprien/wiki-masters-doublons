(() => {
  const LABELS = Object.freeze({
    option: 'Doublons',
    refresh: '↻ rafraîchir',
    loadingNote: "Une seule fois, ensuite c'est gardé en cache.",
    updating: 'Mise à jour…',
    stale: 'Ta collection a changé depuis le dernier chargement',
    incompleteKept: 'Lecture incomplète : affichage du dernier chargement complet.',
    incompleteNone: 'Lecture incomplète : rien à afficher. Réessaie plus tard.',
    freshness: "Impossible de joindre wiki-masters pour l'instant.",
    unexpected: 'Erreur inattendue : le site reste utilisable.',
  });

  function formatSummary({ cards, extra }) {
    if (cards === 0) return 'Aucun doublon';
    const c = cards === 1 ? 'carte en double' : 'cartes en double';
    const e = extra === 1 ? 'exemplaire en trop' : 'exemplaires en trop';
    return `${cards} ${c} · ${extra} ${e}`;
  }

  function formatLoaded(loadedAt, now) {
    const s = Math.max(0, Math.floor((now - loadedAt) / 1000));
    if (s < 60) return "chargé à l'instant";
    const min = Math.floor(s / 60);
    if (min < 60) return `chargé il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `chargé il y a ${h} h`;
    return `chargé il y a ${Math.floor(h / 24)} j`;
  }

  function formatProgress({ phase, pagesRead, pageCount }) {
    const head = phase === 'incremental' ? LABELS.updating : 'Lecture de ta collection…';
    const of = pageCount === null || pageCount === undefined ? '' : ` / ${pageCount}`;
    return `${head} page ${pagesRead}${of}`;
  }

  const api = { LABELS, formatSummary, formatLoaded, formatProgress };
  globalThis.__wmDoublons = Object.assign(globalThis.__wmDoublons || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})();
