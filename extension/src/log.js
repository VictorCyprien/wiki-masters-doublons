(() => {
  // Chemin et requête seulement : jamais d'hôte, de cookie ni de jeton dans les journaux.
  function createLogger(enabled) {
    if (!enabled) return () => {};
    return (event, data) => {
      try {
        if (data === undefined) console.log('[wm-doublons]', event);
        else console.log('[wm-doublons]', event, data);
      } catch { /* ignoré */ }
    };
  }

  function debugEnabled() {
    try {
      return globalThis.localStorage?.getItem('wm-doublons:debug') === '1';
    } catch {
      return false;
    }
  }

  const api = { createLogger, debugEnabled };
  globalThis.__wmDoublons = Object.assign(globalThis.__wmDoublons || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})();
