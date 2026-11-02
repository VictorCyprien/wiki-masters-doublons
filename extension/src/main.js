(() => {
  // Seul fichier qui lit les autres modules et les branche. Tout échec laisse le site utilisable.
  const W = globalThis.__wmDoublons;
  const log = W.createLogger(W.debugEnabled());
  const onCollection = () => location.pathname === '/collection';
  const now = () => Date.now();

  let controller = null;
  let labelOn = false; // « Doublons » affiché dans le bouton de tri
  let lastState = null;
  const waiters = new Set();

  // --- Intercepteur : installé tout de suite (document_start) ---
  const interceptor = W.installInterceptor({
    target: window,
    shouldIntercept: (u) => onCollection() && controller !== null && controller.shouldIntercept(u),
    respond: (u) => W.controller.respond(u),
    isWatched: (u) => W.classifyUrl(u) === 'list',
    onSettled: () => { waiters.forEach((w) => w()); },
    log,
  });

  // Résout peu après la fin de l'appel liste (le site doit lire et rendre la réponse), au plus 15 s.
  function waitSettled() {
    return new Promise((resolve) => {
      let timer = null;
      const finish = () => {
        clearTimeout(cap);
        clearTimeout(timer);
        waiters.delete(onSettle);
        resolve();
      };
      const onSettle = () => { if (timer === null) timer = setTimeout(finish, 300); };
      const cap = setTimeout(finish, 15000);
      waiters.add(onSettle);
    });
  }

  function realSleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('abandonné'));
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('abandonné')); }, { once: true });
    });
  }

  // --- Réseau : tout passe par le fetch d'origine, un appel à la fois ---
  const serialFetch = W.createSerialFetch({ fetchFn: interceptor.originalFetch.bind(window), sleep: realSleep, now });
  const readOpts = (signal) => ({ credentials: 'same-origin', signal });
  const loaderBase = { parseList: W.parseList, sleep: realSleep, now, log };

  controller = W.createController({
    site: { ...W, PAGE_SIZE: W.SITE.PAGE_SIZE },
    dup: W,
    cache: W.createCache(W.indexedDbStore()),
    now,
    log,
    IncompleteLoadError: W.IncompleteLoadError,
    fetchFreshness: () => W.fetchFreshness(serialFetch),
    loadAll: (o) => W.loadAllPages({
      ...loaderBase, ...o,
      fetchPage: (page, signal) => serialFetch(W.buildPageUrl(page, W.SITE.LOAD_SORT), readOpts(signal)),
    }),
    loadNew: (o) => W.loadNewEntries({
      ...loaderBase, ...o,
      fetchPage: (page, signal) => serialFetch(W.buildPageUrl(page, W.SITE.DATE_SORT), readOpts(signal)),
    }),
    onState: (s) => {
      lastState = s;
      try {
        if (s.mode === 'off' && labelOn) {
          labelOn = false;
          W.showTriggerLabel(W.findSortTrigger(document), null);
          W.badgeCards(document, null);
        }
        sweep();
      } catch (err) { log('state:error', { error: String(err && err.message || err) }); }
    },
  });
  W.controller = controller;

  const active = () => controller.getState().mode !== 'off';

  function scheduleRefetch() {
    setTimeout(() => {
      W.triggerSiteRefetch(document, { waitSettled, log }).catch((err) => log('refetch:error', { error: String(err && err.message || err) }));
    }, 0);
  }

  function afterLoad() {
    const s = controller.getState();
    if (s.mode !== 'ready') return;
    labelOn = true;
    W.showTriggerLabel(W.findSortTrigger(document), W.LABELS.option);
    scheduleRefetch();
  }

  function selectDoublons() {
    W.findSortTrigger(document)?.click(); // referme la liste (clic programmé : ignoré plus bas)
    if (active()) return;
    controller.enter().then(afterLoad, (err) => log('enter:error', { error: String(err && err.message || err) }));
  }

  function refresh() {
    controller.refresh().then(() => {
      if (controller.getState().mode === 'ready') scheduleRefetch();
    }, (err) => log('refresh:error', { error: String(err && err.message || err) }));
  }

  // Phase de capture : le choix d'une option native de la liste de tri (clic réel) ferme le mode avant le site.
  document.addEventListener('click', (e) => {
    try {
      if (!e.isTrusted || !onCollection() || !active()) return;
      const trigger = W.findSortTrigger(document);
      const listbox = trigger && W.findSortListbox(document, trigger);
      if (!listbox || !listbox.contains(e.target)) return;
      const opt = W.nativeOptionOf(e.target);
      if (!opt) return;
      const same = opt.getAttribute('aria-selected') === 'true';
      controller.exit();
      W.showTriggerLabel(trigger, null);
      W.badgeCards(document, null);
      labelOn = false;
      if (same) scheduleRefetch(); // le site ne relira pas de lui-même
    } catch (err) { log('click:error', { error: String(err && err.message || err) }); }
  }, true);

  // Balayage : appelé au départ, à chaque mutation utile et à chaque état.
  function sweep() {
    try {
      if (!onCollection()) {
        if (active()) controller.exit();
        return;
      }
      const state = lastState || controller.getState();
      const trigger = W.findSortTrigger(document);
      const listbox = trigger && W.findSortListbox(document, trigger);
      if (listbox) W.injectOption(listbox, { label: W.LABELS.option, selected: state.mode !== 'off', onSelect: selectDoublons });
      W.renderStatus(document, state, now(), { onRefresh: refresh });
      W.badgeCards(document, state.mode === 'ready' ? state.pageCounts : null);
    } catch (err) { log('sweep:error', { error: String(err && err.message || err) }); }
  }

  function start() {
    try {
      sweep();
      W.watch(document, sweep);
      setInterval(sweep, 30000); // « chargé il y a … » vieillit
    } catch (err) { log('start:error', { error: String(err && err.message || err) }); }
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
