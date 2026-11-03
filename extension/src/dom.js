(() => {
  // Navigateur seulement. Sélecteurs : carnet (« Valeurs pour le code »). Aucun libellé français ici :
  // les textes viennent de format.js et de main.js. Chaque opération DOM échoue sans casser le site.
  const MARK = 'data-wm-doublons'; // option injectée
  const STATUS = 'data-wm-doublons-status';
  const BADGE = 'data-wm-doublons-badge';
  const CARD = 'div.relative.isolate.group';
  const TRIGGERS = 'button[aria-haspopup="listbox"]';
  const noop = () => {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs, stepMs = 50) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      let v = null;
      try { v = fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() >= end) return null;
      await sleep(stepMs);
    }
  }

  const inDialog = (el) => !!el.closest('[role="dialog"]');

  // Dernier bouton de tri de la ligne qui contient le champ de recherche (hors fenêtres de détail).
  function findSortTrigger(doc) {
    try {
      const all = [...doc.querySelectorAll(TRIGGERS)].filter((b) => !inDialog(b));
      if (all.length === 0) return null;
      const input = [...doc.querySelectorAll('input')].find(
        (i) => !inDialog(i) && !['hidden', 'checkbox', 'radio', 'file'].includes(i.type));
      for (let el = input && input.parentElement; el && el !== doc.body; el = el.parentElement) {
        const inRow = all.filter((b) => el.contains(b));
        if (inRow.length) return inRow[inRow.length - 1];
      }
      return all[all.length - 1];
    } catch {
      return null;
    }
  }

  // Comparaison d'attributs (pas de sélecteur construit avec l'id).
  function findSortListbox(doc, trigger) {
    try {
      if (!trigger || !trigger.id) return null;
      return [...doc.querySelectorAll('ul[role="listbox"]')].find(
        (ul) => ul.getAttribute('aria-labelledby') === trigger.id) || null;
    } catch {
      return null;
    }
  }

  const nativeOptions = (listbox) => [...listbox.querySelectorAll('[role="option"]')].filter((o) => !o.hasAttribute(MARK));

  // L'option native visée par un clic (ou null : option à nous, ou pas une option).
  function nativeOptionOf(target) {
    const el = target && target.closest ? target.closest('[role="option"]') : null;
    return el && !el.hasAttribute(MARK) ? el : null;
  }

  function stripIds(root) {
    if (root.removeAttribute) root.removeAttribute('id');
    root.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  }

  function setLabel(btn, label) {
    const inner = btn.querySelector('span span') || btn.querySelector('span') || btn;
    inner.textContent = label;
  }

  function injectOption(listbox, { label, selected, onSelect }) {
    try {
      const state = selected ? 'selected' : 'idle';
      const existing = listbox.querySelector(`[${MARK}]`);
      if (existing && existing.getAttribute(MARK) === state && existing.isConnected) return;
      if (existing) (existing.closest('li') || existing).remove();
      const natives = nativeOptions(listbox);
      if (natives.length === 0) return;
      const template = (selected
        ? natives.find((o) => o.getAttribute('aria-selected') === 'true')
        : natives.find((o) => o.getAttribute('aria-selected') !== 'true')) || natives[natives.length - 1];
      const li = template.closest('li') || template;
      const copy = li.cloneNode(true);
      stripIds(copy);
      const btn = copy.matches('[role="option"]') ? copy : copy.querySelector('[role="option"]');
      btn.setAttribute(MARK, state);
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      setLabel(btn, label);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { onSelect(e); } catch { /* ignoré */ }
      });
      (li.parentElement === listbox ? listbox : li.parentElement || listbox).appendChild(copy);
    } catch (err) {
      try { console.warn('[wm-doublons] injectOption', err); } catch { /* ignoré */ }
    }
  }

  // --- Libellé du bouton de tri -------------------------------------------------------------
  const labels = new WeakMap(); // trigger -> { node, original, label, observer }

  function findLabelNode(trigger) {
    const w = trigger.ownerDocument.createTreeWalker(trigger, 4 /* SHOW_TEXT */);
    const texts = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.data.trim()) texts.push(n);
    return texts.find((n) => n.parentElement && n.parentElement.matches('span span')) || texts[texts.length - 1] || null;
  }

  function showTriggerLabel(trigger, label) {
    try {
      if (!trigger) return;
      let st = labels.get(trigger);
      if (label === null) {
        if (!st) return;
        st.observer.disconnect();
        if (st.node.isConnected && st.node.data === st.label) st.node.data = st.original;
        labels.delete(trigger);
        return;
      }
      if (st && st.node.isConnected) {
        st.label = label;
        if (st.node.data !== label) st.node.data = label;
        return;
      }
      if (st) st.observer.disconnect();
      const node = findLabelNode(trigger);
      if (!node) return;
      st = { node, original: node.data, label, observer: null };
      const reapply = () => {
        const cur = labels.get(trigger);
        if (!cur) return;
        if (!cur.node.isConnected) {
          const n = findLabelNode(trigger);
          if (!n) return;
          cur.node = n;
          cur.original = n.data;
        }
        if (cur.node.data !== cur.label) cur.node.data = cur.label;
      };
      st.observer = new MutationObserver(reapply);
      st.observer.observe(trigger, { characterData: true, childList: true, subtree: true });
      labels.set(trigger, st);
      node.data = label;
    } catch (err) {
      try { console.warn('[wm-doublons] showTriggerLabel', err); } catch { /* ignoré */ }
    }
  }

  // --- Relecture par le site ----------------------------------------------------------------
  let refetchTail = Promise.resolve();

  function triggerSiteRefetch(doc, { waitSettled, log = noop, shouldContinue = () => true } = {}) {
    const run = () => refetchOnce(doc, waitSettled || (() => Promise.resolve()), log, shouldContinue);
    const p = refetchTail.then(run, run);
    refetchTail = p.catch(noop);
    return p;
  }

  async function refetchOnce(doc, waitSettled, log, shouldContinue) {
    let trigger = null;
    const listbox = () => findSortListbox(doc, trigger);
    // aria-expanded quand il existe, sinon présence de la liste.
    const isOpen = () => {
      const a = trigger.getAttribute('aria-expanded');
      return a === 'true' || a === 'false' ? a === 'true' : !!listbox();
    };
    const bail = (reason) => {
      try { if (trigger && isOpen()) trigger.click(); } catch { /* ignoré */ }
      log('refetch:abort', { reason });
    };
    try {
      trigger = findSortTrigger(doc);
      if (!trigger) return log('refetch:abort', { reason: 'no-trigger' });
      if (!shouldContinue()) return log('refetch:abort', { reason: 'stopped' });
      if (isOpen()) {
        trigger.click();
        if (!(await waitFor(() => !isOpen() && !listbox(), 2000))) return log('refetch:abort', { reason: 'close-timeout' });
      }
      const open = async () => {
        if (!isOpen()) trigger.click();
        return waitFor(listbox, 2000);
      };
      if (!shouldContinue()) return log('refetch:abort', { reason: 'stopped' });
      const ul = await open();
      if (!ul) return bail('open-timeout');
      const natives = nativeOptions(ul);
      const rank = natives.findIndex((o) => o.getAttribute('aria-selected') === 'true');
      const other = natives.findIndex((_, i) => i !== rank);
      if (rank === -1 || other === -1) return bail('no-option');
      if (!shouldContinue()) return bail('stopped');
      let settled = waitSettled();
      natives[other].click();
      await settled;
      if (!shouldContinue()) return bail('stopped');
      const ul2 = await open();
      if (!ul2) return bail('reopen-timeout');
      const back = nativeOptions(ul2)[rank];
      if (!back) return bail('rank-lost');
      if (!shouldContinue()) return bail('stopped');
      settled = waitSettled();
      back.click();
      await settled;
      log('refetch:done');
    } catch (err) {
      log('refetch:error', { error: String((err && err.message) || err) });
    }
  }

  // --- Barre d'état -------------------------------------------------------------------------
  const el = (doc, tag, text, attrs) => {
    const n = doc.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  const findGrid = (doc) => {
    const card = doc.querySelector(CARD);
    return card ? card.parentElement : null;
  };

  // Bloc de pagination : l'élément qui contient directement le span « x / y » (hors barre à nous et cartes).
  function findPagination(doc) {
    const span = [...doc.querySelectorAll('span')].find((x) => !x.children.length
      && /^\D*\d+\s*\/\s*\d+\s*$/.test(x.textContent) && !x.closest(`[${STATUS}]`) && !x.closest(CARD));
    return span ? span.parentElement : null;
  }

  // Avant la pagination, sinon avant la grille, sinon après la ligne de filtres (`after`).
  function placeBefore(doc) {
    const pag = findPagination(doc);
    if (pag && pag.parentElement) return { parent: pag.parentElement, before: pag };
    const grid = findGrid(doc);
    if (grid && grid.parentElement) return { parent: grid.parentElement, before: grid };
    const trigger = findSortTrigger(doc);
    const row = trigger && trigger.parentElement && trigger.parentElement.parentElement;
    if (row && row.parentElement) return { parent: row.parentElement, after: row };
    return null;
  }

  const inPlace = (bar, spot) => bar.parentElement === spot.parent
    && (spot.after ? bar.previousSibling === spot.after : bar.nextSibling === spot.before);

  // Lignes : { text, refresh } ; le bouton suit la date sur la même ligne.
  function statusRows(state, now, f) {
    const { LABELS, formatProgress, formatSummary, formatLoaded } = f;
    const rows = [];
    let refreshPlaced = false;
    if (state.mode === 'loading') {
      const p = state.progress;
      rows.push({ text: p ? formatProgress(p) : LABELS.updating });
      if (p && p.phase === 'full') rows.push({ text: LABELS.loadingNote });
    } else if (state.mode === 'ready') {
      if (state.summary) rows.push({ text: formatSummary(state.summary) });
      let when = state.loadedAt ? formatLoaded(state.loadedAt, now) : '';
      if (state.freshnessUnknown) when = `${when}${when ? ' · ' : ''}${LABELS.freshness}`;
      if (when) {
        rows.push({ text: when, refresh: true });
        refreshPlaced = true;
      }
    }
    const err = state.error;
    if (err) {
      const ra = state.resumeAt;
      if (state.mode === 'error' && err === 'incomplete' && ra && typeof f.formatInterrupted === 'function') {
        rows.push({ text: f.formatInterrupted(ra), refresh: true, label: LABELS.resume });
        refreshPlaced = true;
      } else if (state.mode === 'error') rows.push({ text: err === 'freshness' ? LABELS.freshness : err === 'incomplete' ? LABELS.incompleteNone : LABELS.unexpected });
      else rows.push({ text: err === 'incomplete' ? LABELS.incompleteKept : LABELS.unexpected });
    }
    if (state.mode === 'ready' && state.stale) rows.push({ text: LABELS.stale });
    if ((state.mode === 'ready' || state.mode === 'error') && !refreshPlaced) rows.push({ text: '', refresh: true });
    return rows;
  }

  function renderStatus(doc, state, now, { onRefresh, formats } = {}) {
    try {
      let bar = doc.querySelector(`[${STATUS}]`);
      if (state.mode === 'off') {
        if (bar) bar.remove();
        return;
      }
      const f = formats || globalThis.__wmDoublons;
      const rows = statusRows(state, now, f);
      const sig = JSON.stringify(rows);
      const spot = placeBefore(doc);
      if (!spot) return;
      if (bar && bar.getAttribute(STATUS) === sig && inPlace(bar, spot)) return;
      if (!bar || bar.getAttribute(STATUS) !== sig) {
        const fresh = el(doc, 'div', undefined, { [STATUS]: sig, role: 'status' });
        fresh.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:center;padding:8px 12px;margin:8px auto;font-size:14px;text-align:center;';
        for (const r of rows) {
          const row = el(doc, 'div');
          if (r.text) row.appendChild(el(doc, 'span', r.text));
          if (r.refresh) {
            if (r.text) row.appendChild(el(doc, 'span', ' · '));
            const b = el(doc, 'button', r.label || f.LABELS.refresh, { type: 'button' });
            b.style.cssText = 'cursor:pointer;text-decoration:underline;background:none;border:0;color:inherit;font:inherit;';
            b.addEventListener('click', (e) => {
              e.preventDefault();
              try { onRefresh && onRefresh(e); } catch { /* ignoré */ }
            });
            row.appendChild(b);
          }
          fresh.appendChild(row);
        }
        if (bar) bar.remove();
        bar = fresh;
      }
      spot.parent.insertBefore(bar, spot.after ? spot.after.nextSibling : spot.before);
    } catch (err) {
      try { console.warn('[wm-doublons] renderStatus', err); } catch { /* ignoré */ }
    }
  }

  // --- Badges ×N ----------------------------------------------------------------------------
  function badgeCards(doc, counts) {
    try {
      const wanted = counts ? counts.map((n) => `×${n}`) : [];
      const cards = counts ? [...doc.querySelectorAll(CARD)] : [];
      const have = [...doc.querySelectorAll(`[${BADGE}]`)];
      const ok = have.length === wanted.length && have.every((b, i) => b.textContent === wanted[i] && b.parentElement === cards[i]);
      if (ok) return;
      have.forEach((b) => b.remove());
      wanted.forEach((text, i) => {
        if (!cards[i]) return;
        const b = el(doc, 'span', text, { [BADGE]: '1' });
        // Haut, au centre : entre la pastille de rareté (gauche) et l'étoile favori (droite).
        // z-index élevé : sinon le calque photo de la carte passe par-dessus.
        b.style.cssText = 'position:absolute;top:4px;left:50%;transform:translateX(-50%);z-index:50;padding:1px 7px;border-radius:9999px;background:#111;color:#fff;font-size:12px;font-weight:700;white-space:nowrap;pointer-events:none;';
        cards[i].appendChild(b);
      });
    } catch (err) {
      try { console.warn('[wm-doublons] badgeCards', err); } catch { /* ignoré */ }
    }
  }

  // --- Observation --------------------------------------------------------------------------
  const ours = (node) => !!(node && node.closest && node.closest(`[${STATUS}],[${BADGE}]`));

  function watch(doc, onChange) {
    let timer = null;
    const fire = () => {
      timer = null;
      try { onChange(); } catch (err) { try { console.warn('[wm-doublons] watch', err); } catch { /* ignoré */ } }
    };
    const obs = new MutationObserver((records) => {
      const mine = (r) => {
        if (ours(r.target.nodeType === 1 ? r.target : r.target.parentElement)) return true;
        const moved = [...r.addedNodes, ...r.removedNodes];
        return moved.length > 0 && moved.every((n) => n.nodeType === 1 && ours(n));
      };
      if (records.every(mine)) return;
      if (timer === null) timer = setTimeout(fire, 30);
    });
    obs.observe(doc.body, { childList: true, subtree: true });
    return () => { obs.disconnect(); if (timer !== null) clearTimeout(timer); };
  }

  const api = { findSortTrigger, findSortListbox, nativeOptionOf, injectOption, showTriggerLabel,
    triggerSiteRefetch, renderStatus, badgeCards, watch };
  globalThis.__wmDoublons = Object.assign(globalThis.__wmDoublons || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})();
