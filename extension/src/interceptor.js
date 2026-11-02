(() => {
  function readUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    if (input && typeof input.href === 'string') return input.href;
    return String(input);
  }

  function pathOf(url) {
    try {
      const base = typeof location !== 'undefined' && location.origin ? location.origin : 'https://www.wiki-masters.com';
      const u = new URL(url, base);
      return u.pathname + u.search;
    } catch {
      return '';
    }
  }

  const isThenable = (v) => v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';

  function installInterceptor({
    target, shouldIntercept, respond,
    isWatched = () => false, onSettled = () => {}, log = () => {},
  }) {
    const originalFetch = target.fetch;
    const safeLog = (...a) => { try { log(...a); } catch { /* ignoré */ } };

    function replacement(input, init) {
      const self = this;
      const args = arguments;
      let url = '';
      let watched = false;

      const settle = (intercepted) => {
        if (!watched) return;
        try { onSettled(url, intercepted); } catch { /* ignoré */ }
      };

      const passthrough = () => {
        const result = originalFetch.apply(self, args);
        if (watched) {
          if (isThenable(result)) {
            // branche latérale : la valeur et le rejet vus par le site restent ceux de `result`
            result.then(() => settle(false), () => settle(false));
          } else {
            settle(false);
          }
        }
        return result;
      };

      const fallback = (err) => {
        safeLog('intercept:fallback', { path: pathOf(url), error: String((err && err.message) || err) });
        return passthrough();
      };

      const serve = (body) => {
        const res = new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
        safeLog('intercept:serve', { path: pathOf(url) });
        settle(true);
        return res;
      };

      let out;
      let intercepting = false;
      try {
        url = readUrl(input);
        try { watched = !!isWatched(url); } catch { watched = false; }
        intercepting = !!shouldIntercept(url);
        if (intercepting) {
          out = respond(url);
          if (!isThenable(out)) return serve(out);
        }
      } catch (err) {
        return fallback(err);
      }
      // hors interception : un échec synchrone de l'original n'est pas rejoué
      if (!intercepting) return passthrough();
      return Promise.resolve(out).then(serve).catch(fallback);
    }

    target.fetch = replacement;
    return {
      originalFetch,
      uninstall() { if (target.fetch === replacement) target.fetch = originalFetch; },
    };
  }

  const api = { installInterceptor };
  globalThis.__wmDoublons = Object.assign(globalThis.__wmDoublons || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})();
