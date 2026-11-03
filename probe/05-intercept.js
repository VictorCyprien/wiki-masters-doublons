// Sonde 5 — à coller dans la console DevTools, sur /collection. Teste H7 (le site affiche une réponse
// substituée) et H11 (un choix « Doublons (test) » dans la liste de tri), et la façon de faire relire
// le site. En mode actif, les réponses my-collection sont les vraies, réduites aux 3 premières cartes
// inversées, et stats dit total = 3. Rien n'est écrit côté serveur.
// Commandes : __wmP5.on('same' | 'resort' | 'chip'), __wmP5.off('resort' | 'chip'), __wmP5.done().
(() => {
  if (window.__wmP5) return 'sonde 5 déjà chargée';
  const P = (window.__wmP5 = { active: false, log: [], listboxes: [] });
  const now = () => Math.round(performance.now());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
    const isList = url.includes('/api/my-collection?');
    const isStats = url.includes('/api/my-collection/stats');
    if (!isList && !isStats) return origFetch.apply(this, arguments);
    const rec = { t: now(), url: url.replace(location.origin, ''), intercepted: P.active };
    P.log.push(rec);
    if (!P.active) return origFetch.apply(this, arguments);
    try {
      const real = await origFetch.apply(this, arguments);
      const j = await real.json();
      if (isList && Array.isArray(j.collection)) j.collection = j.collection.slice(0, 3).reverse();
      if (isStats) { j.total = 3; j.totalUnique = 3; }
      return new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (e) { rec.error = e.message; return origFetch.apply(this, arguments); }
  };

  const triggers = () => [...document.querySelectorAll('button[aria-haspopup="listbox"]')];
  const sortTrigger = () => triggers()[triggers().length - 1];
  const waitListbox = async () => { for (let i = 0; i < 20; i++) { const ul = document.querySelector('ul[role="listbox"]'); if (ul) return ul; await sleep(100); } return null; };
  const optionsOf = (ul) => [...ul.querySelectorAll('[role="option"]')];
  const selectSort = async (pred) => {
    sortTrigger().click();
    const ul = await waitListbox();
    if (!ul) return 'pas de listbox';
    const opt = optionsOf(ul).find(pred);
    if (!opt) return 'option introuvable';
    opt.click();
    return opt.textContent.trim();
  };
  const chips = () => [...document.querySelectorAll('button')].filter((b) => /^(L|UR|SR|R|PC|C)$/.test(b.textContent.trim()) && b.className.includes('rounded-full'));

  const refetch = async (strategy) => {
    const before = P.log.length;
    const current = sortTrigger().textContent.trim();
    if (strategy === 'same') P.log.push({ t: now(), step: 'same', picked: await selectSort((o) => o.getAttribute('aria-selected') === 'true') });
    if (strategy === 'resort') {
      P.log.push({ t: now(), step: 'resort-1', picked: await selectSort((o) => o.getAttribute('aria-selected') === 'false' && !o.dataset.wmTest) });
      await sleep(1500);
      P.log.push({ t: now(), step: 'resort-2', picked: await selectSort((o) => o.textContent.trim() === current) });
    }
    if (strategy === 'chip') {
      const c = chips().find((b) => !b.className.includes('opacity-50')) || chips()[0];
      P.log.push({ t: now(), step: 'chip', chip: c && c.textContent.trim() });
      c.click(); await sleep(1500); c.click();
    }
    await sleep(5000);
    const calls = P.log.slice(before).filter((r) => r.url).length;
    return strategy + ' : ' + calls + ' appel(s) my-collection déclenché(s) — regarde la grille et la pagination';
  };
  P.on = async (strategy = 'same') => { P.active = true; P.log.push({ t: now(), step: 'ON' }); return refetch(strategy); };
  P.off = async (strategy = 'resort') => { P.active = false; P.log.push({ t: now(), step: 'OFF' }); return refetch(strategy); };

  // H11 : injecter « Doublons (test) » dans la liste de tri quand elle s'ouvre.
  new MutationObserver(() => {
    const ul = document.querySelector('ul[role="listbox"]');
    if (!ul || ul.dataset.wmSeen) return;
    ul.dataset.wmSeen = '1';
    const trig = document.getElementById(ul.getAttribute('aria-labelledby'));
    const opts = optionsOf(ul);
    P.listboxes.push({ t: now(), parent: ul.parentElement && ul.parentElement.tagName, triggerIsLast: trig === sortTrigger(), options: opts.length });
    if (trig !== sortTrigger() || ul.querySelector('[data-wm-test]')) return;
    const li = opts[opts.length - 1].closest('li').cloneNode(true);
    const btn = li.querySelector('[role="option"]');
    btn.dataset.wmTest = '1';
    btn.setAttribute('aria-selected', 'false');
    btn.querySelector('span span').textContent = 'Doublons (test)';
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); P.log.push({ t: now(), step: 'injected-click' }); sortTrigger().click(); setTimeout(() => P.on('same').then((m) => console.log('[sonde5]', m)), 300); });
    ul.appendChild(li);
    setTimeout(() => P.listboxes.push({ t: now(), injectedStillThere: !!document.querySelector('[data-wm-test]') }), 1000);
  }).observe(document.body, { childList: true, subtree: true });

  P.done = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ when: new Date().toISOString(), log: P.log, listboxes: P.listboxes }, null, 2)], { type: 'application/json' }));
    a.download = 'wm-05-intercept.json';
    a.click();
    return 'téléchargé';
  };
  return 'sonde 5 prête';
})();
