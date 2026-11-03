// Sonde 1 — à coller dans la console DevTools, sur la page collection de wiki-masters.
// Observe les appels du site à /api/ (URL, type fetch/xhr, NOMS d'en-têtes seulement),
// les gestes de Victor (texte de l'élément cliqué), l'URL de la page après chaque geste,
// et la structure de la page (liste déroulante, recherche, puces, carte, pagination).
// Ne lit jamais de cookie, ni de valeur d'en-tête, ni de jeton.
// Fin : copy(__wmProbe.done())
(() => {
  if (window.__wmProbe) return 'sonde 1 déjà active';
  const P = (window.__wmProbe = { events: [], headers: [] });
  const t = () => Math.round(performance.now());
  const rel = (u) => String(u).replace(location.origin, '');

  // 1. Appels réseau vus par Resource Timing (inclut ceux d'avant la sonde).
  const seen = new Set();
  const grab = () => {
    for (const e of performance.getEntriesByType('resource')) {
      if (!e.name.includes('/api/')) continue;
      const k = e.name + '@' + e.startTime;
      if (seen.has(k)) continue;
      seen.add(k);
      P.events.push({ kind: 'call', t: Math.round(e.startTime), url: rel(e.name), type: e.initiatorType, ms: Math.round(e.duration) });
    }
  };
  grab();
  new PerformanceObserver(grab).observe({ type: 'resource', buffered: true });

  // 2. Noms d'en-têtes envoyés par le site (jamais les valeurs).
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const isReq = typeof Request !== 'undefined' && input instanceof Request;
      const url = isReq ? input.url : String(input);
      if (url.includes('/api/')) {
        const h = new Headers((init && init.headers) || (isReq ? input.headers : undefined));
        P.headers.push({ t: t(), via: 'fetch', url: rel(url), method: (init && init.method) || (isReq ? input.method : 'GET'), headerNames: [...h.keys()], credentials: (init && init.credentials) || (isReq ? input.credentials : null) });
      }
    } catch (e) { P.headers.push({ error: String(e) }); }
    return origFetch.apply(this, arguments);
  };
  const X = XMLHttpRequest.prototype;
  const xOpen = X.open, xSet = X.setRequestHeader, xSend = X.send;
  X.open = function (m, u) { this.__wm = { via: 'xhr', method: m, url: rel(u), headerNames: [] }; return xOpen.apply(this, arguments); };
  X.setRequestHeader = function (n) { if (this.__wm) this.__wm.headerNames.push(String(n).toLowerCase()); return xSet.apply(this, arguments); };
  X.send = function () { if (this.__wm && this.__wm.url.includes('/api/')) P.headers.push({ t: t(), ...this.__wm }); return xSend.apply(this, arguments); };

  // 3. Gestes : texte de l'élément cliqué, saisie dans la recherche, URL 400 ms après.
  const label = (el) => {
    const c = el && el.closest && el.closest('button,a,[role],li,label,select,input');
    const n = c || el;
    return { tag: n.tagName, role: n.getAttribute && n.getAttribute('role'), text: (n.textContent || n.value || '').trim().replace(/\s+/g, ' ').slice(0, 50) };
  };
  const afterUrl = (ev) => setTimeout(() => { ev.urlAfter = location.pathname + location.search; }, 400);
  document.addEventListener('click', (e) => { const ev = { kind: 'click', t: t(), ...label(e.target) }; P.events.push(ev); afterUrl(ev); }, true);
  document.addEventListener('change', (e) => { const ev = { kind: 'change', t: t(), ...label(e.target), value: String(e.target.value || '').slice(0, 30) }; P.events.push(ev); afterUrl(ev); }, true);
  let typing;
  document.addEventListener('input', (e) => {
    clearTimeout(typing);
    typing = setTimeout(() => { const ev = { kind: 'input', t: t(), tag: e.target.tagName, value: String(e.target.value || '').slice(0, 30) }; P.events.push(ev); afterUrl(ev); }, 600);
  }, true);

  // 4. Structure de la page, relevée au moment de done().
  const brief = (el, max = 2500) => (el ? el.outerHTML.replace(/\s+/g, ' ').slice(0, max) : null);
  const path = (el) => { const out = []; for (let n = el, i = 0; n && n !== document.body && i < 6; n = n.parentElement, i++) out.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.getAttribute('role') ? '[role=' + n.getAttribute('role') + ']' : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 4).join('.') : '')); return out.join(' < '); };
  const byText = (txt) => [...document.querySelectorAll('body *')].filter((e) => e.childElementCount <= 2 && e.textContent.trim() === txt).slice(0, 5);
  const describe = (els) => els.map((e) => ({ path: path(e), html: brief(e, 800) }));
  const dom = () => {
    const img = [...document.images].find((i) => /wikimedia|wikipedia/.test(i.src));
    let card = null, grid = null;
    if (img) { for (let n = img; n && n.parentElement; n = n.parentElement) { if (n.parentElement.childElementCount >= 8) { card = n; grid = n.parentElement; break; } } }
    const pager = [...document.querySelectorAll('body *')].find((e) => e.childElementCount === 0 && /Page \d+ \/ \d+/.test(e.textContent));
    return {
      framework: { nextRoot: !!document.querySelector('#__next'), nextData: !!window.__NEXT_DATA__, nextFlight: !!self.__next_f },
      sortTrigger: describe(byText('Rareté')),
      listbox: brief(document.querySelector('[role="listbox"]'), 3000),
      tagsTrigger: describe(byText('Toutes les étiquettes')),
      search: describe([...document.querySelectorAll('input')].filter((i) => /Rechercher/i.test(i.placeholder || ''))),
      rarityChip: describe(byText('UR')),
      pager: pager ? { path: path(pager), html: brief(pager.parentElement, 1500) } : null,
      grid: grid ? { path: path(grid), children: grid.childElementCount } : null,
      card: card ? { path: path(card), text: card.textContent.trim().replace(/\s+/g, ' ').slice(0, 200), html: brief(card, 3000) } : null,
    };
  };

  P.done = () => { grab(); return JSON.stringify({ when: new Date().toISOString(), page: location.pathname + location.search, events: P.events.sort((a, b) => a.t - b.t), headers: P.headers, dom: dom() }, null, 2); };
  return 'sonde 1 prête';
})();
