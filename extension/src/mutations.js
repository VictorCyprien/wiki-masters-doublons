(() => {
  // Reconnaît, dans un appel réseau du site déjà abouti, un changement de favori ou d'étiquette.
  // Ne regarde que le chemin, la requête, la méthode, un corps texte et le statut. Jamais d'en-tête.
  function parseMutation({ url, method, body, status } = {}) {
    try {
      if (typeof status !== 'number' || status < 200 || status >= 300) return [];
      const m = String(method || '').toUpperCase();
      const u = new URL(String(url), 'https://placeholder.invalid');
      const params = u.searchParams;
      const eq = (name) => {
        const v = params.get(name);
        if (typeof v !== 'string' || !v.startsWith('eq.')) return null;
        const id = v.slice(3);
        return id === '' ? null : id;
      };
      const json = () => {
        if (typeof body !== 'string') return undefined;
        try { return JSON.parse(body); } catch { return undefined; }
      };
      const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

      if (u.pathname.endsWith('/rest/v1/user_cards') && m === 'PATCH') {
        const entryId = eq('id');
        const data = json();
        if (entryId === null || !isObj(data) || typeof data.starred !== 'boolean') return [];
        return [{ kind: 'starred', entryId, value: data.starred }];
      }
      if (u.pathname.endsWith('/rest/v1/user_card_tags')) {
        if (m === 'POST') {
          const data = json();
          const items = Array.isArray(data) ? data : [data];
          return items
            .filter((o) => isObj(o) && typeof o.user_card_id === 'string' && o.user_card_id !== '' && typeof o.tag_id === 'string' && o.tag_id !== '')
            .map((o) => ({ kind: 'tagAdd', entryId: o.user_card_id, tagId: o.tag_id }));
        }
        if (m === 'DELETE') {
          const entryId = eq('user_card_id');
          const tagId = eq('tag_id');
          return entryId === null || tagId === null ? [] : [{ kind: 'tagRemove', entryId, tagId }];
        }
      }
      return [];
    } catch {
      return [];
    }
  }

  const api = { parseMutation };
  const root = (globalThis.__wmDoublons ??= {});
  Object.assign(root, api);
  if (typeof module !== 'undefined') module.exports = api;
})();
