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

  // Lit une page. Sur 429, 5xx, rejet réseau/délai ou corps illisible : au plus 3 nouveaux essais espacés.
  async function readPage(page, o) {
    const { fetchPage, parseList, signal, now, maxRetryAfterMs, delayMs, backoffMs, log, onRetry } = o;
    for (let attempt = 0; ; attempt += 1) {
      checkAbort(signal);
      const t0 = now();
      let failure; // { reason, status, retryAfter }
      let res = null;
      try {
        res = await fetchPage(page, signal);
      } catch {
        checkAbort(signal);
        failure = { reason: 'network', status: null, retryAfter: null };
      }
      if (res) {
        checkAbort(signal);
        log('load:page', { page, status: res.status, ms: now() - t0 });
        if (res.ok) {
          try {
            return parseList(await res.json());
          } catch {
            checkAbort(signal);
            failure = { reason: 'network', status: res.status, retryAfter: null };
          }
        } else if (res.status === 429 || res.status >= 500) {
          failure = { reason: 'http', status: res.status, retryAfter: parseRetryAfter(res.headers.get('Retry-After'), now()) };
        } else {
          throw new IncompleteLoadError({ reason: 'http', page, status: res.status });
        }
      }
      const { reason, status, retryAfter } = failure;
      if (retryAfter !== null && retryAfter > maxRetryAfterMs) throw new IncompleteLoadError({ reason: 'retry-after', page, status });
      if (attempt >= backoffMs.length) throw new IncompleteLoadError({ reason, page, status });
      const waitMs = Math.max(retryAfter !== null ? retryAfter : backoffMs[attempt], delayMs);
      log('load:retry', { page, attempt: attempt + 1, waitMs, reason, status });
      onRetry({ page, attempt: attempt + 1, waitMs });
      await pause(waitMs, o);
    }
  }

  // Boucle commune : `visit(list, page)` renvoie true pour s'arrêter.
  async function readPages(opts, maxPages, visit, onEnd) {
    const o = {
      delayMs: 400, maxRetryAfterMs: 60000, backoffMs: [5000, 15000, 45000],
      log: () => {}, onProgress: () => {}, onRetry: () => {}, startPage: 0, ...opts,
    };
    try {
      for (let page = o.startPage; page < maxPages; page += 1) {
        if (page > o.startPage) await pause(o.delayMs, o);
        const list = await readPage(page, o);
        o.onProgress({ pagesRead: page + 1, pageCount: o.pageCount ?? null });
        if (list.length === 0) {
          // page vide alors qu'il en reste à lire : lecture incomplète (reprise possible), pas une fin
          if (o.pageCount !== null && o.pageCount !== undefined && page < o.pageCount) throw new IncompleteLoadError({ reason: 'empty-page', page });
          return onEnd(o, 'empty');
        }
        if (visit(list, page)) return onEnd(o, 'known');
      }
      return onEnd(o, 'end');
    } catch (err) {
      o.log('load:stop', { reason: err.reason ?? err.name });
      throw err;
    }
  }

  async function loadAllPages(opts) {
    const acc = [];
    const ids = new Set();
    const add = (e) => {
      if (!ids.has(e.id)) {
        ids.add(e.id);
        acc.push(e);
      }
    };
    for (const e of opts.initialEntries || []) add(e);
    return readPages(opts, opts.pageCount, (list, page) => {
      list.forEach(add);
      if (opts.onPage) opts.onPage({ page, entries: acc });
      return false;
    }, (o, why) => {
      if (o.expectedTotal !== null && o.expectedTotal !== undefined && acc.length !== o.expectedTotal) {
        throw new IncompleteLoadError({ reason: 'mismatch' });
      }
      o.log('load:stop', { reason: why });
      return { entries: [...acc] };
    });
  }

  async function loadNewEntries(opts) {
    const { knownIds, maxPages = 20 } = opts;
    const entries = [];
    const seen = new Set(); // une carte ajoutée en cours de lecture décale les pages : un id peut revenir
    let sawKnown = false;
    return readPages({ ...opts, pageCount: null, startPage: 0 }, maxPages, (list) => {
      for (const e of list) {
        if (knownIds.has(e.id)) sawKnown = true;
        else if (!seen.has(e.id)) {
          seen.add(e.id);
          entries.push(e);
        }
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
  function createSerialFetch({ fetchFn, minGapMs = 400, timeoutMs = 20000, sleep, now, locks = null }) {
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

    // Verrou partagé entre onglets (navigator.locks) : un seul appel de l'extension à la fois, tous onglets
    // confondus. Le verrou reste tenu minGapMs après l'appel, ce qui espace aussi les onglets entre eux.
    // L'attente du verrou s'interrompt dès que `signal` se déclenche.
    async function withLock(signal, fn) {
      if (!locks) return fn();
      let release;
      const held = new Promise((r) => { release = r; });
      try {
        await new Promise((resolve, reject) => {
          const opts = signal ? { signal } : {};
          Promise.resolve(locks.request('wm-doublons:net', opts, () => { resolve(true); return held; })).catch(reject);
        });
      } catch (err) {
        // Un abandon reste un abandon ; verrou indisponible (ex. SecurityError) : on appelle sans verrou.
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        return fn();
      }
      try {
        return await fn();
      } finally {
        Promise.resolve().then(() => sleep(minGapMs)).then(release, release);
      }
    }

    function run(url, init) {
      const caller = init?.signal;
      if (caller?.aborted) return Promise.reject(abortError());
      return withLock(caller, () => runLocked(url, init));
    }

    async function runLocked(url, init) {
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
