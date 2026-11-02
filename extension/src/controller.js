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
      error: null, summary: null, pageCounts: null,
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
    async function step(mine, promise) {
      const v = await promise;
      if (gen !== mine) throw STALE;
      return v;
    }

    async function rawFresh(mine) {
      const f = await step(mine, (async () => deps.fetchFreshness())());
      if (!f || f.total === null || f.total === undefined) throw new Error('freshness');
      return f;
    }

    async function afterFresh(mine, f) {
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
      setState({ mode: 'ready', progress: null, loadedAt: record.loadedAt ?? null, stale, freshnessUnknown, error });
    }

    function progressFn(mine, phase) {
      return (p) => {
        if (gen !== mine) return;
        setState({ progress: { phase, pagesRead: p.pagesRead, pageCount: p.pageCount ?? null } });
      };
    }

    // Lecture complète puis vérification : cartes gagnées pendant la lecture, total frais.
    async function fullRead(mine, f) {
      const pageCount = Math.ceil(f.total / site.PAGE_SIZE);
      setState({ mode: 'loading', error: null, progress: { phase: 'full', pagesRead: 0, pageCount } });
      const signal = ctrl.signal;
      const onProgress = progressFn(mine, 'full');
      const { entries } = await step(mine, deps.loadAll({ pageCount, expectedTotal: null, onProgress, signal }));
      const extra = await step(mine, deps.loadNew({ knownIds: new Set(entries.map((e) => e.id)), onProgress, signal }));
      const merged = [...extra.entries, ...entries];
      const f2 = await strictFresh(mine);
      const sameUser = f.userId == null || f2.userId == null || f.userId === f2.userId;
      if (!sameUser || merged.length !== f2.total) throw mkError('mismatch');
      const rec = { entries: merged, total: f2.total, freshness: f2.freshness, template: f2.template, loadedAt: now() };
      const uid = f2.userId ?? null;
      if (uid !== null) await step(mine, cache.put(uid, rec));
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
          setState({ mode: 'error', error: 'freshness', progress: null });
          return;
        }
        adopt(cached, uid);
        setReady({ freshnessUnknown: true });
        return;
      }
      await afterFresh(mine, f);
      const cached = f.userId == null ? null : await step(mine, cache.get(f.userId));
      if (cached) {
        cached.template = f.template;
        adopt(cached, f.userId);
        const stale = cached.freshness !== f.freshness;
        log(`freshness:${stale ? 'changed' : 'same'}`);
        setReady({ stale });
        return;
      }
      await fullRead(mine, f);
    }

    async function refreshBody(mine) {
      if (!record) {
        log('refresh:full');
        await fullRead(mine, await strictFresh(mine));
        return;
      }
      setState({ mode: 'loading', error: null, progress: { phase: 'incremental', pagesRead: 0, pageCount: null } });
      const known = record.entries;
      let extra;
      try {
        extra = await step(mine, deps.loadNew({
          knownIds: new Set(known.map((e) => e.id)),
          onProgress: progressFn(mine, 'incremental'),
          signal: ctrl.signal,
        }));
      } catch (err) {
        if (err !== STALE && err?.name === 'IncompleteLoadError' && err.reason === 'too-many-new') {
          log('refresh:full');
          await fullRead(mine, await strictFresh(mine));
          return;
        }
        throw err;
      }
      const f = await strictFresh(mine);
      const merged = [...extra.entries, ...known];
      if (f.userId != null && recordUserId != null && f.userId !== recordUserId) {
        log('refresh:full');
        await fullRead(mine, f);
        return;
      }
      if (merged.length === f.total) {
        log('refresh:incremental');
        const rec = { entries: merged, total: f.total, freshness: f.freshness, template: f.template, loadedAt: now() };
        const uid = f.userId ?? recordUserId;
        if (uid != null) await step(mine, cache.put(uid, rec));
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
        error: null, summary: null, pageCounts: null,
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
