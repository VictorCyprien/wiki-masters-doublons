(() => {
  const STALE = Symbol('stale-generation');

  function createController(deps) {
    const { site, dup, cache, now, onState } = deps;
    const log = deps.log || (() => {});
    const mkError = (reason) => {
      const E = deps.IncompleteLoadError;
      return E ? new E({ reason }) : Object.assign(new Error(`Lecture incomplète (${reason})`), { name: 'IncompleteLoadError', reason });
    };

    let state = {
      mode: 'off', progress: null, loadedAt: null, stale: false, freshnessUnknown: false,
      error: null, summary: null, pageCounts: null, resumeAt: null,
    };
    let gen = 0;
    let record = null; // enregistrement servi (CacheRecord)
    let recordUserId = null;
    let inflight = null;
    let ctrl = null;
    let memo = { record: null, groups: null };

    function setState(patch) {
      const prevMode = state.mode;
      state = { ...state, ...patch };
      if (state.mode !== prevMode) log('mode', { mode: state.mode });
      onState({ ...state });
    }

    // Toute attente passe par ici : si la génération a changé, la suite s'arrête.
    function guard(mine) {
      if (gen !== mine) throw STALE;
    }

    async function step(mine, promise) {
      try {
        return await promise;
      } finally {
        guard(mine); // aussi quand la promesse rejette après un changement de génération
      }
    }

    async function rawFresh(mine) {
      const f = await step(mine, (async () => deps.fetchFreshness())());
      if (!f || f.total === null || f.total === undefined) throw new Error('freshness');
      return f;
    }

    async function afterFresh(mine, f) {
      guard(mine);
      if (f.userId !== null && f.userId !== undefined) await step(mine, cache.setLastUserId(f.userId));
      if (record && (f.userId == null || f.userId === recordUserId)) record.template = f.template;
    }

    // Même chose dans les chemins de rafraîchissement : un échec devient une lecture incomplète.
    async function strictFresh(mine) {
      let f;
      try {
        f = await rawFresh(mine);
      } catch (err) {
        if (err === STALE) throw err;
        throw mkError('freshness');
      }
      await afterFresh(mine, f);
      return f;
    }

    function adopt(rec, userId) {
      record = rec;
      recordUserId = userId;
    }

    function setReady({ stale = false, freshnessUnknown = false, error = null } = {}) {
      setState({ mode: 'ready', progress: null, loadedAt: record.loadedAt ?? null, stale, freshnessUnknown, error, resumeAt: null });
    }

    function progressFn(mine, phase) {
      return (p) => {
        if (gen !== mine) return;
        setState({ progress: { phase, pagesRead: p.pagesRead, pageCount: p.pageCount ?? null, retryInMs: null } });
      };
    }

    // Attente avant un nouvel essai : « le serveur ne répond pas, nouvel essai dans … ».
    function retryFn(mine, phase) {
      return ({ waitMs }) => {
        if (gen !== mine) return;
        const p = state.progress;
        setState({ progress: { phase: p?.phase ?? phase, pagesRead: p?.pagesRead ?? 0, pageCount: p?.pageCount ?? null, retryInMs: waitMs } });
      };
    }

    const DAY_MS = 24 * 3600 * 1000;

    // Aucune carte retirée depuis la sauvegarde : le total et chaque rareté n'ont pas baissé (les ajouts sont sûrs).
    function noRemoval(partial, f) {
      const was = partial.rarityCounts;
      if (typeof partial.total !== 'number' || !was || typeof was !== 'object') return false;
      if (typeof f.total !== 'number' || f.total < partial.total) return false;
      const now_ = f.template?.rarityCounts ?? {};
      return Object.keys(was).every((r) => (now_[r] ?? 0) >= was[r]);
    }

    // Lecture reprise d'un enregistrement partiel valide (moins de 24 h, page encore à lire), sinon null.
    async function loadPartial(mine, uid, pageCount, f) {
      if (uid == null) return null;
      let partial = null;
      try {
        partial = await step(mine, cache.getPartial(uid));
      } catch (err) {
        if (err === STALE) throw err;
      }
      if (!partial) return null;
      const valid = Array.isArray(partial.entries) && Number.isInteger(partial.nextPage) && partial.nextPage >= 0
        && partial.nextPage < pageCount && now() - partial.savedAt <= DAY_MS && noRemoval(partial, f);
      if (valid) return partial;
      await dropPartial(mine, uid);
      return null;
    }

    async function dropPartial(mine, uid) {
      if (uid == null) return;
      try {
        await step(mine, cache.clearPartial(uid));
      } catch (err) {
        if (err === STALE) throw err;
      }
    }

    // Lecture complète puis vérification : cartes gagnées pendant la lecture, total frais.
    async function fullRead(mine, f) {
      const pageCount = Math.ceil(f.total / site.PAGE_SIZE);
      const uid0 = f.userId ?? null;
      const partial = await loadPartial(mine, uid0, pageCount, f);
      const startPage = partial ? partial.nextPage : 0;
      const initialEntries = partial ? partial.entries : [];
      setState({ mode: 'loading', error: null, resumeAt: null, progress: { phase: 'full', pagesRead: startPage, pageCount, retryInMs: null } });
      const signal = ctrl.signal;
      const onProgress = progressFn(mine, 'full');
      let latest = initialEntries; // entrées lues jusqu'ici (référence du chargeur)
      let writes = Promise.resolve(); // sauvegardes en file : une à la fois, et avant tout effacement
      const save = (entries, nextPage) => {
        const snapshot = { entries: entries.slice(), nextPage, pageCount, savedAt: now(), total: f.total, rarityCounts: { ...(f.template?.rarityCounts ?? {}) } };
        writes = writes.then(() => {
          if (gen !== mine) return undefined;
          return cache.putPartial(uid0, snapshot);
        }).catch(() => {});
      };
      const onPage = ({ page, entries }) => {
        if (gen !== mine) return;
        latest = entries;
        if (uid0 !== null && (page + 1) % 10 === 0 && page + 1 < pageCount) save(entries, page + 1);
      };
      let entries;
      try {
        ({ entries } = await step(mine, deps.loadAll({
          pageCount, expectedTotal: null, startPage, initialEntries, onPage, onProgress, onRetry: retryFn(mine, 'full'), signal,
        })));
      } catch (err) {
        if (err?.name === 'IncompleteLoadError' && Number.isInteger(err.page) && err.reason !== 'mismatch' && uid0 !== null) {
          guard(mine);
          await step(mine, writes);
          guard(mine);
          if (latest.length > 0) {
            let saved = false;
            try {
              await step(mine, cache.putPartial(uid0, {
                entries: latest.slice(), nextPage: err.page, pageCount, savedAt: now(), total: f.total,
                rarityCounts: { ...(f.template?.rarityCounts ?? {}) },
              }));
              saved = true;
            } catch (werr) {
              if (werr === STALE) throw werr;
            }
            guard(mine);
            if (saved) setState({ resumeAt: { page: err.page + 1, pageCount } });
          }
        }
        throw err;
      }
      const clearRetry = progressFn(mine, 'full');
      const extra = await step(mine, deps.loadNew({
        knownIds: new Set(entries.map((e) => e.id)),
        onProgress: (p) => clearRetry({ pagesRead: state.progress?.pagesRead ?? p.pagesRead, pageCount }),
        onRetry: retryFn(mine, 'full'),
        signal,
      }));
      const merged = [...extra.entries, ...entries];
      const f2 = await strictFresh(mine);
      const sameUser = f.userId == null || f2.userId == null || f.userId === f2.userId;
      if (!sameUser || merged.length !== f2.total) {
        await step(mine, writes);
        await dropPartial(mine, uid0);
        throw mkError('mismatch');
      }
      const rec = { entries: merged, total: f2.total, freshness: f2.freshness, template: f2.template, loadedAt: now() };
      const uid = f2.userId ?? null;
      if (uid !== null) await step(mine, cache.put(uid, rec));
      await step(mine, writes);
      await dropPartial(mine, uid0);
      guard(mine);
      adopt(rec, uid);
      log('load:done', { entries: merged.length });
      setReady();
    }

    async function enterBody(mine) {
      let f = null;
      try {
        f = await rawFresh(mine);
      } catch (err) {
        if (err === STALE) throw err;
      }
      if (!f) {
        log('freshness:unknown');
        const uid = await step(mine, cache.getLastUserId());
        const cached = uid == null ? null : await step(mine, cache.get(uid));
        if (!cached) {
          guard(mine);
          setState({ mode: 'error', error: 'freshness', progress: null });
          return;
        }
        guard(mine);
        adopt(cached, uid);
        setReady({ freshnessUnknown: true });
        return;
      }
      await afterFresh(mine, f);
      const cached = f.userId == null ? null : await step(mine, cache.get(f.userId));
      if (cached) {
        guard(mine);
        cached.template = f.template;
        adopt(cached, f.userId);
        const stale = cached.freshness !== f.freshness;
        log(`freshness:${stale ? 'changed' : 'same'}`);
        setReady({ stale });
        return;
      }
      await fullRead(mine, f);
    }

    // Autre compte : plus rien de l'ancien n'est servi pendant la lecture.
    function dropIfOtherAccount(f) {
      if (f.userId != null && recordUserId != null && f.userId !== recordUserId) adopt(null, null);
    }

    async function refreshBody(mine) {
      if (!record) {
        setState({ mode: 'loading', error: null, progress: null });
        let f0;
        try {
          f0 = await rawFresh(mine);
        } catch (err) {
          if (err === STALE) throw err;
          guard(mine);
          setState({ mode: 'error', error: 'freshness', progress: null });
          return;
        }
        await afterFresh(mine, f0);
        log('refresh:full');
        await fullRead(mine, f0);
        return;
      }
      setState({ mode: 'loading', error: null, progress: { phase: 'incremental', pagesRead: 0, pageCount: null, retryInMs: null } });
      const known = record.entries;
      let extra;
      try {
        extra = await step(mine, deps.loadNew({
          knownIds: new Set(known.map((e) => e.id)),
          onProgress: progressFn(mine, 'incremental'),
          onRetry: retryFn(mine, 'incremental'),
          signal: ctrl.signal,
        }));
      } catch (err) {
        guard(mine);
        if (err?.name === 'IncompleteLoadError' && err.reason === 'too-many-new') {
          log('refresh:full');
          const f1 = await strictFresh(mine);
          dropIfOtherAccount(f1);
          await fullRead(mine, f1);
          return;
        }
        throw err;
      }
      const f = await strictFresh(mine);
      const merged = [...extra.entries, ...known];
      if (f.userId != null && recordUserId != null && f.userId !== recordUserId) {
        log('refresh:full');
        dropIfOtherAccount(f);
        await fullRead(mine, f);
        return;
      }
      if (merged.length === f.total) {
        log('refresh:incremental');
        const rec = { entries: merged, total: f.total, freshness: f.freshness, template: f.template, loadedAt: now() };
        const uid = f.userId ?? recordUserId;
        if (uid != null) await step(mine, cache.put(uid, rec));
        guard(mine);
        adopt(rec, uid);
        log('load:done', { entries: merged.length });
        setReady();
        return;
      }
      log('refresh:full');
      await fullRead(mine, f);
    }

    function fail(err) {
      const aborted = err?.name === 'AbortedLoadError';
      const code = err?.name === 'IncompleteLoadError' ? 'incomplete' : 'unexpected';
      log('load:failed', { error: aborted ? 'aborted' : code, reason: err?.reason ?? err?.name });
      if (aborted) {
        setState({ mode: 'off', progress: null, error: null });
      } else if (record) {
        setReady({ stale: state.stale, freshnessUnknown: state.freshnessUnknown, error: code });
      } else {
        setState({ mode: 'error', progress: null, error: code });
      }
    }

    function start(mine, body) {
      let p;
      p = (async () => {
        try {
          await body(mine);
        } catch (err) {
          if (err === STALE || gen !== mine) return;
          fail(err);
        }
      })().finally(() => {
        if (inflight === p) inflight = null;
      });
      inflight = p;
      return p;
    }

    function enter() {
      if (inflight) return inflight;
      const mine = ++gen;
      ctrl = new AbortController();
      record = null;
      recordUserId = null;
      memo = { record: null, groups: null };
      setState({ mode: 'loading', error: null, progress: null, stale: false, freshnessUnknown: false });
      return start(mine, enterBody);
    }

    function refresh() {
      if (inflight) return inflight;
      if (state.mode === 'off') return Promise.resolve();
      ctrl = new AbortController();
      return start(gen, refreshBody);
    }

    function exit() {
      gen += 1;
      ctrl?.abort();
      ctrl = null;
      inflight = null;
      record = null;
      recordUserId = null;
      memo = { record: null, groups: null };
      setState({
        mode: 'off', progress: null, loadedAt: null, stale: false, freshnessUnknown: false,
        error: null, summary: null, pageCounts: null, resumeAt: null,
      });
    }

    function shouldIntercept(url) {
      return state.mode !== 'off' && record !== null && site.classifyUrl(url) !== null;
    }

    function groupsOf(rec) {
      if (memo.record !== rec) memo = { record: rec, groups: dup.groupDuplicates(rec.entries) };
      return memo.groups;
    }

    function respond(url) {
      if (!record) throw new Error('aucun enregistrement chargé');
      const kind = site.classifyUrl(url);
      const f = site.parseSiteQuery(url);
      const groups = groupsOf(record);
      const filtered = dup.filterGroups(groups, f);
      if (kind === 'list') {
        const body = site.buildListResponse(record.template, filtered.map((g) => g.entry), f.page);
        const start = f.page * site.PAGE_SIZE;
        setState({
          summary: dup.summarize(filtered),
          pageCounts: filtered.slice(start, start + site.PAGE_SIZE).map((g) => g.n),
        });
        return body;
      }
      if (kind === 'stats') {
        return site.buildStatsResponse(record.template, {
          total: filtered.length,
          rarityCounts: dup.rarityCounts(dup.filterGroups(groups, { ...f, rarities: [] })),
        });
      }
      throw new Error('URL non gérée');
    }

    return { enter, exit, refresh, shouldIntercept, respond, getState: () => ({ ...state }) };
  }

  const api = { createController };
  globalThis.__wmDoublons = Object.assign(globalThis.__wmDoublons || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})();
