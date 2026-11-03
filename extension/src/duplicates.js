(() => {
  const RARITY_ORDER = ['L', 'UR', 'SR', 'R', 'PC', 'C'];

  function rarityRank(r) {
    const i = RARITY_ORDER.indexOf(r);
    return i === -1 ? RARITY_ORDER.length : i;
  }

  function time(entry) {
    const t = Date.parse(entry.obtained_at);
    return Number.isNaN(t) ? 0 : t;
  }

  // Favori de préférence, puis la plus récente.
  function pickRepresentative(members) {
    const starred = members.filter((e) => e.starred);
    const pool = starred.length ? starred : members;
    return pool.reduce((best, e) => (time(e) > time(best) ? e : best));
  }

  function compareGroups(a, b) {
    return (
      b.n - a.n ||
      rarityRank(a.entry.card.rarity) - rarityRank(b.entry.card.rarity) ||
      a.entry.card.wikipedia_title.localeCompare(b.entry.card.wikipedia_title, 'fr') ||
      Number(a.entry.is_shiny) - Number(b.entry.is_shiny)
    );
  }

  function groupDuplicates(entries) {
    const byKey = new Map();
    for (const e of entries) {
      const key = `${e.card_id}|${e.is_shiny}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(e);
    }
    const groups = [];
    for (const [key, members] of byKey) {
      const n = members.reduce((sum, e) => sum + e.count, 0);
      if (n < 2) continue;
      groups.push({
        key,
        entry: pickRepresentative(members),
        n,
        ids: members.map((e) => e.id),
        tagIds: [...new Set(members.flatMap((e) => e.tags.map((t) => t.id)))],
        members,
      });
    }
    return groups.sort(compareGroups);
  }

  function summarize(groups) {
    return { cards: groups.length, extra: groups.reduce((sum, g) => sum + g.n - 1, 0) };
  }

  function normalizeText(s) {
    return String(s)
      .toLowerCase()
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  function tagged(members, tagId) {
    const hit = members.filter((e) => e.tags.some((t) => t.id === tagId));
    return hit.length ? pickRepresentative(hit) : null;
  }

  function filterGroups(groups, { search, tagId, rarities }) {
    const q = normalizeText(search || '');
    let out = groups.filter((g) => {
      const { card } = g.entry;
      if (q && !normalizeText(card.wikipedia_title).includes(q) && !normalizeText(card.category).includes(q)) {
        return false;
      }
      if (tagId && !g.tagIds.includes(tagId)) return false;
      if (rarities && rarities.length && !rarities.includes(card.rarity)) return false;
      return true;
    });
    if (tagId) {
      out = out.map((g) => ({
        ...g,
        entry: tagged(g.members, tagId) ?? g.entry,
      }));
    }
    return out;
  }

  function rarityCounts(groups) {
    const counts = {};
    for (const g of groups) counts[g.entry.card.rarity] = (counts[g.entry.card.rarity] || 0) + 1;
    return counts;
  }

  const api = { RARITY_ORDER, groupDuplicates, summarize, normalizeText, filterGroups, rarityCounts };
  const root = (globalThis.__wmDoublons ??= {});
  Object.assign(root, api);
  if (typeof module !== 'undefined') module.exports = api;
})();
