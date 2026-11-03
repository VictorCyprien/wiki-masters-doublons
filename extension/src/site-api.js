(() => {
  const SITE = Object.freeze({
    LIST_PATH: '/api/my-collection',
    STATS_PATH: '/api/my-collection/stats',
    LIST_KEY: 'collection',
    PAGE_SIZE: 50,
    LOAD_SORT: 'rarity',
    DATE_SORT: 'added',
    FRESHNESS_URL: '/api/my-collection?sort=rarity&page=0&stats=1',
  });

  const SITE_ORIGIN = 'https://www.wiki-masters.com';

  function siteOrigin() {
    return typeof location !== 'undefined' && location.origin ? location.origin : SITE_ORIGIN;
  }

  function parse(url) {
    try {
      return new URL(url, siteOrigin());
    } catch {
      return null;
    }
  }

  function classifyUrl(url) {
    const u = parse(url);
    if (!u || u.origin !== siteOrigin()) return null;
    if (u.pathname === SITE.LIST_PATH) return 'list';
    if (u.pathname === SITE.STATS_PATH) return 'stats';
    return null;
  }

  function parseSiteQuery(url) {
    const p = (parse(url) || { searchParams: new URLSearchParams() }).searchParams;
    const page = Number.parseInt(p.get('page') ?? '0', 10);
    return {
      page: Number.isFinite(page) ? page : 0,
      search: p.get('q') ?? '',
      tagId: p.get('tag_id'),
      rarities: p.getAll('rarity').flatMap((v) => v.split(',')).filter(Boolean),
    };
  }

  function buildPageUrl(page, sort) {
    return `${SITE.LIST_PATH}?sort=${sort}&page=${page}&stats=0`;
  }

  function parseList(json) {
    return json?.[SITE.LIST_KEY] ?? [];
  }

  function buildListResponse(template, cards, page) {
    const start = page * SITE.PAGE_SIZE;
    return {
      ...template,
      [SITE.LIST_KEY]: cards.slice(start, start + SITE.PAGE_SIZE),
      total: null,
      rarityCounts: {},
      tagOptions: [],
    };
  }

  function buildStatsResponse(template, { total, rarityCounts }) {
    return { total, totalUnique: total, rarityCounts, tagOptions: template.tagOptions ?? [] };
  }

  function readFreshness(json) {
    const counts = json.rarityCounts ?? {};
    const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const total = json.total ?? null;
    return {
      userId: parseList(json)[0]?.user_id ?? null,
      total,
      freshness: total + '|' + JSON.stringify(sorted),
      template: json,
    };
  }

  // Date (ms) de l'entrée la plus récente d'une page triée « Date d'ajout » (sort=added, stats=0 :
  // avec stats=1 le serveur ignore le tri, vu en vrai le 2026-11-03). Repli prudent : page non triée
  // du plus récent au plus ancien, ou date illisible -> null (le contrôle des retraits masqués est sauté).
  function readNewest(json) {
    let newest = null;
    let prev = Infinity;
    for (const e of parseList(json)) {
      const t = Date.parse(e?.obtained_at);
      if (!Number.isFinite(t) || t > prev) return null;
      if (newest === null) newest = t;
      prev = t;
    }
    return newest;
  }

  async function fetchNewest(fetchFn, { signal } = {}) {
    const res = await fetchFn(buildPageUrl(0, SITE.DATE_SORT), { credentials: 'same-origin', signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return readNewest(await res.json());
  }

  async function fetchFreshness(fetchFn, { signal } = {}) {
    const res = await fetchFn(SITE.FRESHNESS_URL, { credentials: 'same-origin', signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return readFreshness(await res.json());
  }

  const api = { SITE, classifyUrl, parseSiteQuery, buildPageUrl, parseList, buildListResponse,
    buildStatsResponse, readFreshness, fetchFreshness, readNewest, fetchNewest };
  globalThis.__wmDoublons = Object.assign(globalThis.__wmDoublons || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})();
