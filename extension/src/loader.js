(() => {
  class IncompleteLoadError extends Error {
    constructor({ reason, page = null, status = null }) {
      super(`Lecture incomplète (${reason}${page === null ? '' : `, page ${page}`}${status === null ? '' : `, HTTP ${status}`})`);
      this.name = 'IncompleteLoadError';
      this.reason = reason;
      this.page = page;
      this.status = status;
    }
  }

  class AbortedLoadError extends Error {
    constructor() {
      super('Lecture abandonnée');
      this.name = 'AbortedLoadError';
    }
  }

  // Millisecondes à attendre, d'après un en-tête Retry-After (secondes ou date HTTP), ou null.
  function parseRetryAfter(value, now) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (/^\d+$/.test(text)) return Number(text) * 1000;
    const date = Date.parse(text);
    return Number.isNaN(date) ? null : Math.max(0, date - now);
  }

  function checkAbort(signal) {
    if (signal?.aborted) throw new AbortedLoadError();
  }

  async function pause(ms, { sleep, signal }) {
    checkAbort(signal);
    try {
      await sleep(ms, signal);
    } catch (err) {
      checkAbort(signal);
      throw err;
    }
    checkAbort(signal);
  }

  // Lit une page : au plus une nouvelle tentative, et seulement sur 429/5xx avec Retry-After raisonnable.
  async function readPage(page, o) {
    const { fetchPage, parseList, signal, now, maxRetryAfterMs, delayMs, log } = o;
    for (let attempt = 0; ; attempt += 1) {
      checkAbort(signal);
      const t0 = now();
      let res;
      try {
        res = await fetchPage(page, signal);
      } catch {
        checkAbort(signal);
        throw new IncompleteLoadError({ reason: 'network', page });
      }
      checkAbort(signal);
      log('load:page', { page, status: res.status, ms: now() - t0 });
      if (res.ok) {
        try {
          return parseList(await res.json());
        } catch {
          checkAbort(signal);
          throw new IncompleteLoadError({ reason: 'network', page, status: res.status });
        }
      }
      const retryable = res.status === 429 || res.status >= 500;
      const wait = retryable ? parseRetryAfter(res.headers.get('Retry-After'), now()) : null;
      if (wait === null || attempt > 0) throw new IncompleteLoadError({ reason: 'http', page, status: res.status });
      if (wait > maxRetryAfterMs) throw new IncompleteLoadError({ reason: 'retry-after', page, status: res.status });
      await pause(Math.max(wait, delayMs), o);
    }
  }

  // Boucle commune : `visit(list, page)` renvoie true pour s'arrêter.
  async function readPages(opts, maxPages, visit, onEnd) {
    const o = { delayMs: 400, maxRetryAfterMs: 60000, log: () => {}, onProgress: () => {}, ...opts };
    try {
      for (let page = 0; page < maxPages; page += 1) {
        if (page > 0) await pause(o.delayMs, o);
        const list = await readPage(page, o);
        o.onProgress({ pagesRead: page + 1, pageCount: o.pageCount ?? null });
        if (list.length === 0) return onEnd(o, 'empty');
        if (visit(list, page)) return onEnd(o, 'known');
      }
      return onEnd(o, 'end');
    } catch (err) {
      o.log('load:stop', { reason: err.reason ?? err.name });
      throw err;
    }
  }

  async function loadAllPages(opts) {
    const byId = new Map();
    return readPages(opts, opts.pageCount, (list) => {
      for (const e of list) {
        if (!byId.has(e.id)) byId.set(e.id, e);
      }
      return false;
    }, (o, why) => {
      if (o.expectedTotal !== null && o.expectedTotal !== undefined && byId.size !== o.expectedTotal) {
        throw new IncompleteLoadError({ reason: 'mismatch' });
      }
      o.log('load:stop', { reason: why });
      return { entries: [...byId.values()] };
    });
  }

  async function loadNewEntries(opts) {
    const { knownIds, maxPages = 20 } = opts;
    const entries = [];
    let sawKnown = false;
    return readPages({ ...opts, pageCount: null }, maxPages, (list) => {
      for (const e of list) {
        if (knownIds.has(e.id)) sawKnown = true;
        else entries.push(e);
      }
      return sawKnown;
    }, (o, why) => {
      if (why === 'end') {
        throw new IncompleteLoadError({ reason: 'too-many-new', page: maxPages - 1 });
      }
      o.log('load:stop', { reason: why });
      return { entries };
    });
  }

  // Un seul appel à la fois, minGapMs entre la fin d'un appel et le début du suivant, délai maximal par appel.
  function createSerialFetch({ fetchFn, minGapMs = 400, timeoutMs = 20000, sleep, now }) {
    let tail = Promise.resolve();
    let lastEnd = null;
    const abortError = () => Object.assign(new Error('Appel abandonné'), { name: 'AbortError' });

    // Rejette dès que `signal` est déclenché, sans annuler `promise`.
    function raceAbort(promise, signal) {
      if (!signal) return promise;
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(abortError());
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
      });
    }

    async function run(url, init) {
      const caller = init?.signal;
      if (caller?.aborted) throw abortError();
      if (lastEnd !== null) {
        const wait = minGapMs - (now() - lastEnd);
        if (wait > 0) await raceAbort(sleep(wait, caller), caller);
      }
      const fetchCtrl = new AbortController(); // abandonné seulement sur délai dépassé ou abandon de l'appelant
      const onAbort = () => fetchCtrl.abort();
      caller?.addEventListener('abort', onAbort, { once: true });
      const timerCtrl = new AbortController(); // sert uniquement à annuler le minuteur
      const timeout = new Promise((_, reject) => {
        sleep(timeoutMs, timerCtrl.signal).then(() => {
          reject(Object.assign(new Error(`Délai dépassé (${timeoutMs} ms)`), { name: 'TimeoutError' }));
          fetchCtrl.abort();
        }, () => {});
      });
      try {
        return await raceAbort(Promise.race([fetchFn(url, { ...init, signal: fetchCtrl.signal }), timeout]), caller);
      } finally {
        caller?.removeEventListener('abort', onAbort);
        timerCtrl.abort();
        lastEnd = now();
      }
    }

    return (url, init) => {
      const prev = tail;
      const p = raceAbort(prev, init?.signal).then(() => run(url, init));
      // La chaîne attend aussi la fin réelle de l'appel précédent, même si celui-ci est abandonné en file.
      tail = Promise.all([prev, p.catch(() => {})]);
      return p;
    };
  }

  const api = { IncompleteLoadError, AbortedLoadError, parseRetryAfter, loadAllPages, loadNewEntries, createSerialFetch };
  const root = (globalThis.__wmDoublons ??= {});
  Object.assign(root, api);
  if (typeof module !== 'undefined') module.exports = api;
})();
