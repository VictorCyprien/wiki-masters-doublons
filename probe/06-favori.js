// Sonde 6 — favori et étiquette : quelle requête part, et quel exemplaire change.
// À coller dans la console de /collection, en tri normal (pas en mode Doublons).
// Ne garde ni cookie ni valeur d'en-tête : seulement les noms d'en-têtes. user_id masqué.
(() => {
  if (window.__wmProbe6) { console.log('sonde 6 déjà installée'); return; }
  const P = { log: [] };
  const original = window.fetch;
  const mask = (v) => {
    if (v == null) return v;
    const s = typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();
    return s.replace(/("user_id"\s*:\s*")[^"]+/g, '$1user-A').slice(0, 3000);
  };
  const pathOf = (u) => { try { const x = new URL(u, location.href); return x.pathname + x.search; } catch { return String(u); } };
  const headerNames = (h) => {
    try { return [...new Headers(h || {}).keys()]; } catch { return []; }
  };

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const res = await original.apply(this, arguments);
    if (method !== 'GET') {
      let body = null;
      try { body = await res.clone().text(); } catch { body = '(illisible)'; }
      const reqBody = init && init.body;
      P.log.push({
        t: new Date().toISOString(), via: 'fetch', method, path: pathOf(url), status: res.status,
        reqHeaderNames: headerNames(init && init.headers),
        reqBody: typeof reqBody === 'string' ? mask(reqBody) : reqBody ? `(${Object.prototype.toString.call(reqBody)})` : null,
        // seules les réponses des tables de cartes sont gardées (pas le profil, par exemple)
        resBody: /\/rest\/v1\/user_card/.test(pathOf(url)) ? mask(body) : '(non gardé)',
      });
      console.log('[sonde6]', method, pathOf(url), res.status);
    }
    return res;
  };

  const xOpen = XMLHttpRequest.prototype.open;
  const xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__p6 = { method: String(method).toUpperCase(), url }; return xOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    const m = this.__p6;
    if (m && m.method !== 'GET') {
      this.addEventListener('loadend', () => {
        P.log.push({ t: new Date().toISOString(), via: 'xhr', method: m.method, path: pathOf(m.url), status: this.status,
          reqBody: typeof body === 'string' ? mask(body) : null,
          resBody: /\/rest\/v1\/user_card/.test(pathOf(m.url)) ? mask(this.responseText) : '(non gardé)' });
        console.log('[sonde6] xhr', m.method, pathOf(m.url), this.status);
      });
    }
    return xSend.apply(this, arguments);
  };

  // Les exemplaires d'une carte, lus sur le serveur (une seule requête).
  P.copies = async (q) => {
    const r = await original(`/api/my-collection?sort=name&q=${encodeURIComponent(q)}&page=0&stats=0`, { credentials: 'same-origin' });
    const j = await r.json();
    return (j.collection || []).map((e) => ({
      id: e.id, card_id: e.card_id, title: e.card && e.card.wikipedia_title, starred: e.starred,
      is_shiny: e.is_shiny, tags: (e.tags || []).map((t) => t.name), obtained_at: e.obtained_at,
    }));
  };

  P.done = async (q) => {
    const copies = q ? await P.copies(q) : null;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ when: new Date().toISOString(), q, log: P.log, copies }, null, 2)], { type: 'application/json' }));
    a.download = 'wm-06-favori.json';
    a.click();
    console.log('[sonde6] fichier téléchargé :', P.log.length, 'requête(s),', copies ? copies.length : 0, 'exemplaire(s)');
  };

  window.__wmProbe6 = P;
  console.log('sonde 6 prête');
})();
