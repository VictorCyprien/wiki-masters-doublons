# Vue « Doublons » Wiki Masters — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une extension Chrome (Manifest V3) qui ajoute « Doublons » au tri de la page collection de wiki-masters.com et affiche, avec le rendu natif du site, les cartes possédées en `count ≥ 2`, triées par `count` décroissant.

**Architecture:** un content script exécuté dans le contexte de la page (`world: "MAIN"`, `document_start`) remplace `fetch` par une version qui, en mode Doublons, répond elle-même aux appels du site à `/api/my-collection` à partir d'un cache local de toute la collection. Le site dessine donc lui-même les cartes, les clics et la pagination. Tout ce qui ne dépend pas du DOM est en fonctions pures testées sous Node ; le DOM et l'intégration se prouvent en vrai, via Verdict.

**Tech Stack:** JavaScript simple (scripts classiques, sans build, sans dépendance), Manifest V3, IndexedDB, tests `node --test` (Node 24, installé : v24.22.1), Verdict pour le navigateur.

**Spec:** `docs/superpowers/specs/2026-11-02-doublons-extension-design.md`

## Global Constraints

- Extension Manifest V3 ; un seul bloc `content_scripts` : `matches: ["https://www.wiki-masters.com/*"]`, `run_at: "document_start"`, `world: "MAIN"`. Aucun champ `permissions` ni `host_permissions`. Aucun code chargé à distance.
- JavaScript simple, sans étape de build, sans dépendance npm (ni runtime ni dev). `package.json` ne contient que `name`, `private: true`, `scripts.test = "node --test tests/"`.
- Chaque fichier de `extension/src/` est enveloppé dans `(() => { ... })();`, publie son API dans `globalThis.__wmDoublons` (objet partagé, créé s'il manque) et, si `module` existe, dans `module.exports` (pour les tests Node en CommonJS). Aucun fichier n'en `require` un autre : les dépendances sont injectées, seul `main.js` assemble.
- Réseau : uniquement des `GET` same-origin vers `/api/my-collection`. Jamais deux appels en parallèle. Espacement entre deux pages : **400 ms**.
- Sur 429 ou 5xx : respecter `Retry-After` (secondes ou date HTTP) s'il vaut au plus 60 s, réessayer **une seule fois** la même page ; sinon arrêter la lecture.
- Une lecture incomplète n'est jamais affichée comme complète.
- Hors mode Doublons, chaque appel du site passe tel quel. Toute exception de notre code retombe sur le `fetch` d'origine (échec ouvert).
- Journaux et carnet : jamais de cookie, d'en-tête d'authentification ni de jeton. Les URL journalisées gardent chemin et requête seulement.
- Texte affiché en français. Libellés exacts : option `Doublons` ; résumé `X cartes en double · Y exemplaires en trop` ; `chargé il y a … · ↻ rafraîchir` ; progression `Lecture de ta collection… page 4 / 270` et `Une seule fois, ensuite c'est gardé en cache.` ; bandeau `Ta collection a changé depuis le dernier chargement` ; mention `recherche approximative`.
- Doublon = une entrée avec `count ≥ 2`. Shiny et normale sont deux entrées distinctes, jamais additionnées.
- Les valeurs propres au site (noms de champs, paramètres, sélecteurs) viennent **uniquement** du tableau « Valeurs pour le code » de `docs/carnet-api.md` (Task 1). Ne jamais les deviner.
- Chaque commit se termine par la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Collection vide ou sans doublon** : la vue affiche `Aucun doublon`, pas une grille vide muette ni une erreur. Tests : Task 3 (`computeDuplicates([])`), Task 7 (`respond` sans doublon), Task 8 (`formatSummary`).
2. **Singulier** : `1 carte en double · 1 exemplaire en trop`, pas `1 cartes`. Test : Task 8.
3. **Quitter le mode, ou la page, pendant la lecture** : la lecture s'arrête, plus aucun appel, le site reprend la main. Tests : Task 4 (abandon par `AbortSignal`), Task 7 (`exit()` pendant `loading`).
4. **Double clic sur « ↻ rafraîchir » ou réentrée pendant une lecture** : une seule lecture à la fois. Test : Task 7.
5. **Page hors limites après un filtre** (le joueur était page 5, le filtre ne laisse que 2 pages) : réponse avec une liste vide et les bons totaux, pas de plantage. Test : Task 2 (`buildPageResponse`).

---

### Task 1: Sonde de l'API et de la page (fil principal, avec Victor)

Ce lot se fait dans le fil principal. Ce n'est pas du TDD : le livrable est le carnet, une fixture et les scripts de sonde.

> **Amendement 2026-11-02 (décision de Victor).** Cloudflare Turnstile refuse la connexion dans le navigateur de Verdict ; on ne le contourne pas. Toute la sonde passe par **la console DevTools du Chrome de Victor** : chaque `verdict …` des steps ci-dessous devient un script `probe/NN-*.js` que Victor colle dans la console ; le script ne renvoie que des métadonnées, Victor lance `copy(...)` puis `! pbpaste > probe/out/NN-*.json`, et Claude lit le fichier. Ce qui se voit (rendu, clic) est décrit ou capturé par Victor. Step 1 et Step 9 sont sans objet ; `INJECTION = extension` (Chrome de Victor). `probe/out/` est versionné seulement après vérification qu'aucun secret n'y figure.

**Files:**
- Create: `probe/NN-*.js` (scripts collés dans la console de Victor, renvoient un JSON de métadonnées), `probe/out/NN-*.json`
- Create: `docs/carnet-api.md`
- Create: `tests/fixtures/page0.json`

**Interfaces:**
- Produces: `docs/carnet-api.md` avec, pour chaque hypothèse H1 à H14 de la spec, un verdict (`tient` / `tombe` / `non vérifiée`), les faits datés, puis le tableau **« Valeurs pour le code »** avec exactement ces clés :

  | Clé | Contenu |
  |---|---|
  | `LIST_KEY` | clé de la liste d'entrées dans l'enveloppe |
  | `TOTAL_KEY` | clé du total d'entrées, ou `null` |
  | `PAGE_COUNT_KEY` | clé du nombre de pages, ou `null` |
  | `PAGE_BASE` | `0` ou `1` |
  | `PAGE_SIZE` | entrées par page renvoyées par le site |
  | `LOAD_PAGE_SIZE_PARAM` / `LOAD_PAGE_SIZE` | paramètre de taille de page accepté (H6) et valeur retenue, ou `null` |
  | `LOAD_SORT` | valeur de `sort` à ordre **déterministe** pour la lecture complète |
  | `STOP_RULE` | `pageCount` ou `emptyPage` |
  | `SEARCH_PARAM`, `TAGS_PARAM`, `RARITY_PARAM` | noms et encodage (répété, virgules…) relevés sur les appels réels du site |
  | `SEARCH_RULE` | `exact` (avec la règle décrite) ou `approx` |
  | `TAG_MATCH` | comment une valeur du filtre d'étiquettes se compare à `entry.tags` |
  | `FRESHNESS_URL` / `FRESHNESS_FIELD` | appel unique et champ du signal de fraîcheur (H12), ou repli `total` |
  | `TRANSPORT` | `fetch` ou `xhr` |
  | `COUNT_SHOWN_BY_SITE` | `true` si le site affiche déjà le nombre d'exemplaires sur la carte |
  | `REFETCH_TRIGGER` | geste qui fait relire `my-collection` au site (ex. clic page 1, changement d'URL) |
  | `SORT_DROPDOWN`, `SORT_OPTION`, `GRID`, `CARD`, `STATUS_ANCHOR` | sélecteurs structurels (rôles ARIA, structure), sans libellé français si H13 tient |
  | `INJECTION` | `extension` si Verdict charge l'extension (H14), sinon `verdict-js` |

- Produces: `tests/fixtures/page0.json` : une vraie réponse page 0, enveloppe complète, réduite à 6 entrées dont au moins une en `count ≥ 2`, une shiny et une avec étiquette ; `user_id` remplacé par `"user-A"`.

- [ ] **Step 1: Connexion.** Lancer `verdict goto https://www.wiki-masters.com`, puis `verdict handoff`. Victor se connecte dans le Chrome visible. Lancer ensuite `verdict resume` et `verdict auth-save wikimasters`. Les sessions suivantes repartent de `verdict goto-auth <url> --profile wikimasters`.
- [ ] **Step 2: Appels du site (H1, H7, H8).** Ouvrir la page collection et vider le journal réseau. Changer tri, page, recherche (`Léman`), étiquette et rareté (L), un geste à la fois. Après chaque geste, `verdict network`. Noter l'URL exacte de chaque appel à `my-collection`, son type (`fetch` ou `xhr`), et les en-têtes d'authentification (présence seulement, jamais la valeur). Recopier les URL d'exemple dans le carnet : Task 2 s'en sert telles quelles.
- [ ] **Step 3: Enveloppe et pagination (H1, H2, H4, H6, H9, H10).** Écrire `probe/sonde.js`. Il fait des `fetch` same-origin espacés de 400 ms, et renvoie seulement des métadonnées : statut, clés de l'enveloppe, longueur de la liste, total, en-têtes `RateLimit-*` et `Retry-After`. Appels, un par variante : page 0 ; `stats=1` ; une taille de page (`limit`, `per_page`, `size`, `page_size` = 200). Pour `LOAD_SORT` : relire deux fois la même page au milieu de la collection avec chaque tri candidat, et retenir un tri dont l'ordre ne change pas. Ne jamais déclencher volontairement de 429.
- [ ] **Step 4: Tri serveur (H5).** Essayer `sort=count`, `sort=-count` et `min_count=2` (un appel chacun). Noter si le résultat change vraiment.
- [ ] **Step 5: Lecture complète, une fois (H2, H3, H4).** Avec `sonde.js` : lire toutes les pages avec `LOAD_SORT`, à 400 ms. Relever le nombre d'entrées, d'`id` uniques et de couples (`card_id`, `is_shiny`) uniques, la répartition des `count` (combien à 0, 1, ≥ 2), et la concordance avec le total annoncé. Ne garder dans le carnet que ces chiffres, pas les données.
- [ ] **Step 6: Interception (H7).** Avec `verdict js`, remplacer `window.fetch` dans la page : pour `my-collection`, renvoyer l'enveloppe réelle avec la liste inversée et un total réduit. Déclencher une relecture par le site. Vérifier dans la page, avec `verdict snapshot -i` et `verdict screenshot` :
  - le site dessine les cartes substituées ;
  - un clic sur une carte se comporte comme d'habitude ;
  - la pagination affiche le total substitué.

  Noter `REFETCH_TRIGGER` et `COUNT_SHOWN_BY_SITE`.
- [ ] **Step 7: Liste déroulante et contrôles (H11, H13).** Avec `verdict inspect` et `verdict snapshot -i`, relever la structure de la liste déroulante de tri (rôles ARIA, éléments), de la recherche, des étiquettes, des puces de rareté, de la grille et d'une carte. Injecter un élément « Doublons » dans la liste ouverte, cliquer dessus. Noter si le site plante, si la liste se referme, et si le libellé sélectionné peut être réécrit.
- [ ] **Step 8: Fraîcheur (H12).** Relever les candidats : un total d'exemplaires dans `stats=1`, et le `obtained_at` le plus récent sous le tri « Date d'ajout ». Si Victor peut gagner ou recycler une carte pendant la séance, relire les candidats avant et après. Sinon, marquer H12 `non vérifiée` et retenir le repli `total`.
- [ ] **Step 9: Extension dans Verdict (H14).** Vérifier si Verdict sait lancer Chrome avec une extension non empaquetée (README de Verdict, options de lancement). Sinon, `INJECTION = verdict-js`.
- [ ] **Step 10: Carnet et fixture.** Écrire `docs/carnet-api.md` : faits datés en haut, hypothèses à part, tableau « Valeurs pour le code » complet. Écrire `tests/fixtures/page0.json`. Vérifier : `grep -iE "cookie|authorization|bearer|token" docs/carnet-api.md tests/fixtures/page0.json probe/sonde.js` ne renvoie aucune valeur de secret.
- [ ] **Step 11: Commit**

```bash
git add probe/sonde.js docs/carnet-api.md tests/fixtures/page0.json
git commit -m "docs: carnet de sonde de l'API my-collection"
```

### Point d'arrêt après Task 1 (fil principal)

- H1 tombe : arrêt, retour vers Victor.
- H2 ou H3 tombe : retour vers Victor avant toute suite.
- H5 tient (tri ou filtre serveur sur `count`) : la lecture complète devient inutile. Réécrire les Tasks 4, 5 et 7 dans ce plan et les faire valider par Victor.
- H7 tombe : appliquer le repli de la spec (grille clonée depuis le HTML d'une carte). Réécrire les Tasks 6 et 8 dans ce plan et les faire valider par Victor.
- Sinon : un agent `opus` en lecture seule relit le plan entier contre la spec et le carnet. Il dresse le tableau des conflits entre tâches : fichiers et interfaces partagés, valeurs du carnet mal reportées. Chaque correction s'écrit **dans ce plan** avant Task 2.

---

### Task 2: Squelette et adaptateur du site (`site-api.js`)

**Files:**
- Create: `package.json`, `tests/helpers.js`
- Create: `extension/src/site-api.js`
- Modify: `.gitignore` (ajouter `dist/`)
- Test: `tests/site-api.test.js`

**Interfaces:**
- Consumes: carnet « Valeurs pour le code » ; `tests/fixtures/page0.json`.
- Produces (`extension/src/site-api.js`) :
  - `SITE` : objet figé portant les valeurs du carnet (mêmes noms de clés).
  - `isCollectionUrl(url: string) -> boolean` : chemin `/api/my-collection`, même origine.
  - `parseSiteQuery(url: string) -> { page: number, search: string, tags: string[], rarities: string[] }` (`page` ramené en base 0).
  - `buildPageUrl(page: number) -> string` : URL relative de lecture complète (`LOAD_SORT`, `stats=0`, taille de page si `LOAD_PAGE_SIZE_PARAM`).
  - `parsePage(json: object) -> { entries: Entry[], total: number|null, pageCount: number|null }`
  - `buildPageResponse(template: object, entries: Entry[], page: number) -> object` : copie de l'enveloppe `template`, liste remplacée par la tranche `page` (taille `SITE.PAGE_SIZE`), total et nombre de pages recalculés.
  - `fetchFreshness(fetchFn: (url: string) => Promise<Response>) -> Promise<{ userId: string|null, freshness: string, template: object }>` : un seul appel à `FRESHNESS_URL` ; `userId` = `user_id` de la première entrée, ou `null`.
- Produces (`tests/helpers.js`) : `makeEntry({ id, title, category, rarity, count, shiny, tags }) -> Entry`, au format de la spec (champs absents remplis par défaut, `card_id` dérivé de `title`).
- `Entry` : la forme d'entrée de la spec (`id`, `card_id`, `count`, `is_shiny`, `tags`, `user_id`, `card.{rarity, wikipedia_title, category, …}`).

- [ ] **Step 1: Écrire les tests qui échouent**

```js
// tests/site-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../extension/src/site-api.js');
const page0 = require('./fixtures/page0.json');
const { makeEntry } = require('./helpers.js');

test('parsePage lit la fixture réelle', () => {
  const { entries, total } = api.parsePage(page0);
  assert.equal(entries.length, page0[api.SITE.LIST_KEY].length);
  if (api.SITE.TOTAL_KEY) assert.equal(total, page0[api.SITE.TOTAL_KEY]);
});

test('parseSiteQuery décode les URL réelles du carnet', () => {
  // Une assertion de cette forme par URL d'exemple recopiée du carnet (Task 1, Step 2),
  // URL et valeurs attendues copiées telles quelles :
  // assert.deepEqual(api.parseSiteQuery('<URL du carnet : recherche Léman + rareté L + page 3>'),
  //   { page: 2, search: 'Léman', tags: [], rarities: ['L'] });   // page 2 si PAGE_BASE = 1
  // + une URL avec une étiquette, + une URL sans aucun filtre → { page: 0, search: '', tags: [], rarities: [] }
});

test('buildPageResponse découpe et recalcule les totaux', () => {
  const entries = Array.from({ length: api.SITE.PAGE_SIZE + 3 }, (_, i) => makeEntry({ id: `e${i}`, title: `T${i}`, count: 2 }));
  const p1 = api.buildPageResponse(page0, entries, 1);
  assert.equal(p1[api.SITE.LIST_KEY].length, 3);
  if (api.SITE.TOTAL_KEY) assert.equal(p1[api.SITE.TOTAL_KEY], entries.length);
});

test('buildPageResponse hors limites renvoie une liste vide et les bons totaux', () => {
  const entries = [makeEntry({ id: 'a', title: 'A', count: 3 })];
  const p5 = api.buildPageResponse(page0, entries, 5);
  assert.deepEqual(p5[api.SITE.LIST_KEY], []);
  if (api.SITE.TOTAL_KEY) assert.equal(p5[api.SITE.TOTAL_KEY], 1);
});

test('buildPageResponse ne modifie pas le template', () => {
  const before = JSON.stringify(page0);
  api.buildPageResponse(page0, [], 0);
  assert.equal(JSON.stringify(page0), before);
});

test('isCollectionUrl', () => {
  assert.equal(api.isCollectionUrl('/api/my-collection?page=0'), true);
  assert.equal(api.isCollectionUrl('https://www.wiki-masters.com/api/my-collection'), true);
  assert.equal(api.isCollectionUrl('/api/boosters'), false);
  assert.equal(api.isCollectionUrl('https://evil.example/api/my-collection'), false);
});

test('fetchFreshness fait un seul appel et lit userId', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return new Response(JSON.stringify(page0)); };
  const r = await api.fetchFreshness(fetchFn);
  assert.equal(calls, 1);
  assert.equal(r.userId, 'user-A');
  assert.equal(typeof r.freshness, 'string');
});
```

- [ ] **Step 2: Lancer et voir échouer** — Run : `node --test tests/site-api.test.js`. Attendu : FAIL, `Cannot find module '../extension/src/site-api.js'`.
- [ ] **Step 3: Écrire `package.json`, `tests/helpers.js` et `extension/src/site-api.js`** selon les Interfaces et le wrapper des Global Constraints. `isCollectionUrl` résout l'URL contre `https://www.wiki-masters.com` (ou `location.origin` si défini) et compare l'origine.
- [ ] **Step 4: Lancer et voir passer** — Run : `npm test`. Attendu : tous PASS.
- [ ] **Step 5: Commit** — `git add package.json .gitignore tests/ extension/src/site-api.js && git commit -m "feat: adaptateur de l'API my-collection"`

### Task 3: Calcul des doublons et filtres (`duplicates.js`)

**Files:**
- Create: `extension/src/duplicates.js`
- Test: `tests/duplicates.test.js`

**Interfaces:**
- Consumes: `Entry`, `makeEntry` (Task 2) ; `SEARCH_RULE`, `TAG_MATCH` du carnet.
- Produces:
  - `RARITY_ORDER = ['L', 'UR', 'SR', 'R', 'PC', 'C']`
  - `computeDuplicates(entries: Entry[]) -> Entry[]` : `count ≥ 2`, tri `count` décroissant, puis rang dans `RARITY_ORDER` (raretés inconnues à la fin), puis `card.wikipedia_title` en `localeCompare(…, 'fr')`, puis normale avant shiny.
  - `summarize(entries: Entry[]) -> { cards: number, extra: number }` (`extra` = somme de `count − 1`).
  - `normalizeText(s: string) -> string` : minuscules, accents retirés (NFD, suppression des diacritiques).
  - `filterEntries(entries: Entry[], filters: { search: string, tags: string[], rarities: string[] }, opts: { approximate: boolean }) -> Entry[]` : ET entre filtres ; filtre vide = sans effet. `approximate: true` : sous-chaîne de `normalizeText(search)` dans titre ou catégorie normalisés. `approximate: false` : la règle exacte `SEARCH_RULE` du carnet.

- [ ] **Step 1: Écrire les tests qui échouent** (`tests/duplicates.test.js`) :
  - `computeDuplicates` garde seulement `count ≥ 2` : entrées de count 1, 2, 7 → `[7, 2]`.
  - Shiny séparée : même `title`, normale `count: 2` + shiny `count: 1` → une seule entrée, la normale. Normale `count: 1` + shiny `count: 1` → `[]`.
  - Égalité de count : `{L, 'Zola'}`, `{C, 'Albert'}`, `{L, 'Abba'}`, tous à `count: 3` → ordre `Abba (L)`, `Zola (L)`, `Albert (C)`.
  - `computeDuplicates([])` → `[]` ; `summarize([])` → `{ cards: 0, extra: 0 }`.
  - `summarize` sur des counts 7 et 2 → `{ cards: 2, extra: 7 }`.
  - `filterEntries` approximatif : `'leman'` trouve `'Lac Léman'` ; `'AUSTRAL'` trouve la catégorie `'actrice australienne'` ; `rarities: ['L', 'UR']` exclut `C` ; filtres vides → liste inchangée ; recherche + rareté combinées → intersection.
  - `filterEntries` sur les étiquettes, suivant `TAG_MATCH` : une entrée qui a l'étiquette passe, une entrée sans étiquette est exclue.
  - `filterEntries` avec `approximate: false` : un cas tiré de la règle exacte relevée au carnet (sauter ce test si `SEARCH_RULE = approx`).
- [ ] **Step 2: Lancer et voir échouer** — `node --test tests/duplicates.test.js` → FAIL, module introuvable.
- [ ] **Step 3: Écrire `extension/src/duplicates.js`** selon les Interfaces.
- [ ] **Step 4: Lancer et voir passer** — `npm test` → tous PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: calcul des doublons et filtres"` (fichiers de la tâche seulement).

### Task 4: Lecture complète polie (`loader.js`)

**Files:**
- Create: `extension/src/loader.js`
- Test: `tests/loader.test.js`

**Interfaces:**
- Consumes: `parsePage` (Task 2), passé en paramètre.
- Produces:
  - `class IncompleteLoadError extends Error` avec `page: number`, `status: number|null`, `reason: 'http'|'network'|'retry-after'|'mismatch'`.
  - `class AbortedLoadError extends Error`.
  - `parseRetryAfter(value: string|null, now: number) -> number|null` : millisecondes ; accepte des secondes ou une date HTTP ; `null` si absent ou illisible.
  - `loadAllPages({ fetchPage: (page: number, signal: AbortSignal) => Promise<Response>, parsePage, stopRule: 'pageCount'|'emptyPage', pageBase: 0|1, delayMs = 400, maxRetryAfterMs = 60000, sleep: (ms: number, signal) => Promise<void>, now: () => number, onProgress: ({ pagesRead: number, pageCount: number|null }) => void, signal: AbortSignal, log = () => {} }) -> Promise<{ entries: Entry[], total: number|null }>`
  - Règles :
    - pages lues une à une, `sleep(delayMs)` entre deux pages (jamais avant la première) ;
    - entrées dédoublonnées par `id` ;
    - si le total est connu et que le nombre d'`id` uniques diffère : `IncompleteLoadError('mismatch')`.

- [ ] **Step 1: Écrire les tests qui échouent** (`tests/loader.test.js`). `fetchPage` factice renvoie des `new Response(JSON.stringify(...), { status, headers })` ; `sleep` factice enregistre ses durées ; un compteur vérifie qu'il n'y a jamais plus d'un appel en cours.
  - 3 pages puis fin selon `stopRule` → toutes les entrées ; `sleeps` vaut `[400, 400]` ; au plus 1 appel simultané ; `onProgress` reçoit `pagesRead` 1, 2, 3.
  - Même `id` sur deux pages, total annoncé = nombre d'entrées brutes → rejet `IncompleteLoadError`, `reason: 'mismatch'`.
  - Total annoncé 10, 9 entrées lues → `mismatch`.
  - 429 avec `Retry-After: 2` puis 200 → `sleep(2000)`, la page est réessayée une fois, succès.
  - 429 deux fois de suite sur la même page → `IncompleteLoadError`, `status: 429`.
  - 503 sans `Retry-After` → `IncompleteLoadError`, `status: 503`, un seul appel pour cette page.
  - `Retry-After: 120` → `IncompleteLoadError`, `reason: 'retry-after'`, aucun `sleep(120000)`.
  - 401 → `IncompleteLoadError`, `status: 401`. Un `fetchPage` qui lève une exception → `reason: 'network'`.
  - `parseRetryAfter('Wed, 21 Oct 2026 07:28:02 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))` → `2000` ; `parseRetryAfter('3', 0)` → `3000` ; `parseRetryAfter(null, 0)` → `null`.
  - Abandon : le signal est déclenché pendant la 2e page → rejet `AbortedLoadError`, aucun appel à la page 3.
- [ ] **Step 2: Lancer et voir échouer** — `node --test tests/loader.test.js` → FAIL.
- [ ] **Step 3: Écrire `extension/src/loader.js`** selon les Interfaces. Journaliser `load:page` (`{ page, status, ms }`) et `load:stop` (`{ reason }`) via `log`.
- [ ] **Step 4: Lancer et voir passer** — `npm test` → tous PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: lecture complète espacée de la collection"`

### Task 5: Cache par compte (`cache.js`)

**Files:**
- Create: `extension/src/cache.js`
- Test: `tests/cache.test.js`

**Interfaces:**
- Produces:
  - `CacheRecord = { entries: Entry[], total: number|null, freshness: string, template: object, loadedAt: number }`
  - `memoryStore() -> { get(key: string): Promise<any>, set(key: string, value: any): Promise<void> }`
  - `indexedDbStore(dbName = 'wm-doublons', storeName = 'kv') -> même forme` (IndexedDB de l'origine de la page)
  - `createCache(store) -> { get(userId: string): Promise<CacheRecord|null>, put(userId: string, record: CacheRecord): Promise<void>, getLastUserId(): Promise<string|null>, setLastUserId(userId: string): Promise<void> }` (clés : `user:<userId>`, `lastUserId`)

- [ ] **Step 1: Écrire les tests qui échouent** (avec `memoryStore`) :
  - `put('A', rec)` puis `get('A')` → `rec` (contenu égal).
  - `put('A', rec)` puis `get('B')` → `null` (séparation par compte).
  - `get` sur un cache vide → `null` ; `getLastUserId()` vide → `null` ; `setLastUserId('A')` puis `getLastUserId()` → `'A'`.
  - `put('A', rec1)` puis `put('A', rec2)` → `get('A')` rend `rec2`.
- [ ] **Step 2: Lancer et voir échouer** — `node --test tests/cache.test.js` → FAIL.
- [ ] **Step 3: Écrire `extension/src/cache.js`.** `indexedDbStore` ouvre la base paresseusement, avec un seul object store clé-valeur. Il n'est pas testé sous Node : il est prouvé en Task 8 (rechargement de la page → `chargé il y a …`).
- [ ] **Step 4: Lancer et voir passer** — `npm test` → tous PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: cache local par compte"`

### Task 6: Interception de `fetch` (`interceptor.js`)

**Files:**
- Create: `extension/src/interceptor.js`
- Test: `tests/interceptor.test.js`

**Interfaces:**
- Produces: `installInterceptor({ target: { fetch: Function }, shouldIntercept: (url: string) => boolean, respond: (url: string) => object | Promise<object>, log = () => {} }) -> { originalFetch: Function, uninstall(): void }`
  - L'URL se lit sur une chaîne, un `URL` ou un `Request` (`input.url`).
  - Interception : `new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })`.
  - Pas d'interception : `originalFetch.apply(target, arguments)` est renvoyé tel quel.
  - Une exception dans `shouldIntercept` ou dans `respond` : retombée sur `originalFetch`, journalisée `intercept:fallback`.
  - Si le carnet dit `TRANSPORT = xhr` : même contrat sur `XMLHttpRequest`, avec les mêmes tests.

- [ ] **Step 1: Écrire les tests qui échouent.** `target` factice : `fetch` renvoie un objet marqueur et enregistre ses arguments.
  - `shouldIntercept` → `false` : `target.fetch('/api/boosters', opts)` renvoie **le même** marqueur (`===`), et l'original a reçu exactement `('/api/boosters', opts)`.
  - `shouldIntercept` → `true` : la réponse a le statut 200 et `await res.json()` vaut la sortie de `respond` ; l'original n'est pas appelé.
  - `respond` lève une exception → l'original est appelé, et la réponse est la sienne.
  - `shouldIntercept` lève une exception → l'original est appelé.
  - Entrée `new Request('https://www.wiki-masters.com/api/my-collection?page=0')` → `shouldIntercept` reçoit l'URL complète.
  - `uninstall()` → `target.fetch === originalFetch`.
- [ ] **Step 2: Lancer et voir échouer** — `node --test tests/interceptor.test.js` → FAIL.
- [ ] **Step 3: Écrire `extension/src/interceptor.js`.**
- [ ] **Step 4: Lancer et voir passer** — `npm test` → tous PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: interception des appels my-collection"`

### Task 7: Contrôleur du mode Doublons (`controller.js`)

**Files:**
- Create: `extension/src/controller.js`
- Test: `tests/controller.test.js`

**Interfaces:**
- Consumes: `fetchFreshness`, `parseSiteQuery`, `buildPageResponse`, `isCollectionUrl` (Task 2) ; `computeDuplicates`, `summarize`, `filterEntries` (Task 3) ; `IncompleteLoadError`, `AbortedLoadError` (Task 4) ; `createCache` (Task 5). Toutes injectées.
- Produces: `createController(deps) -> { enter(): Promise<void>, exit(): void, refresh(): Promise<void>, shouldIntercept(url: string): boolean, respond(url: string): object, getState(): ControllerState }`
  - `deps = { fetchFreshness: () => Promise<{ userId, freshness, template }>, loadAll: ({ onProgress, signal }) => Promise<{ entries, total }>, cache, site: { parseSiteQuery, buildPageResponse, isCollectionUrl }, dup: { computeDuplicates, summarize, filterEntries }, approximateSearch: boolean, now: () => number, onState: (s: ControllerState) => void, log = () => {} }`
  - `ControllerState = { mode: 'off'|'loading'|'ready'|'error', progress: { pagesRead, pageCount }|null, loadedAt: number|null, stale: boolean, freshnessUnknown: boolean, error: null|'incomplete'|'freshness'|'unexpected', summary: { cards, extra }|null, approximate: boolean }`
  - `enter()` :
    1. Un appel `fetchFreshness`, puis lecture du cache.
    2. Cache présent, même `freshness` : `ready`.
    3. Cache présent, `freshness` différente : `ready`, avec `stale: true`.
    4. Pas de cache : `loading`, puis `loadAll`, puis `cache.put` et `setLastUserId` (sauf si `userId` est `null`), puis `ready`.
    5. Si `fetchFreshness` échoue : utiliser le cache de `getLastUserId()`, avec `freshnessUnknown: true`. Sans cache : `error: 'freshness'`, et aucune lecture.
  - Échec de lecture : avec un ancien cache, `ready` sur l'ancien cache avec `error: 'incomplete'`, cache intact. Sans ancien cache : `mode: 'error'`.
  - `shouldIntercept(url)` : vrai seulement si `mode === 'ready'` et `isCollectionUrl(url)`.
  - `respond(url)` : `parseSiteQuery` → `filterEntries` → `computeDuplicates` → `buildPageResponse(record.template, …)`. Met à jour `summary` et `approximate`, puis notifie `onState`.

- [ ] **Step 1: Écrire les tests qui échouent** (fakes pour toutes les dépendances, vraies fonctions de Task 3 pour `dup`) :
  - Pas de cache : `loadAll` est appelé une fois ; `onState` passe par `loading` puis `ready` ; `cache.get(userId)` rend un enregistrement avec `freshness`, `template` et `loadedAt = now()`.
  - Cache avec la même fraîcheur : `loadAll` n'est jamais appelé ; `ready`, `stale: false`.
  - Cache avec une autre fraîcheur : `ready`, `stale: true`, `loadAll` non appelé.
  - `fetchFreshness` rejette, cache de `lastUserId` présent : `ready`, `freshnessUnknown: true`, `loadAll` non appelé. Sans cache : `mode: 'error'`, `error: 'freshness'`.
  - `loadAll` rejette avec `IncompleteLoadError` et un ancien cache : `ready`, `error: 'incomplete'`, le cache est inchangé. Sans ancien cache : `mode: 'error'`, et `shouldIntercept('/api/my-collection')` vaut `false`.
  - `refresh()` deux fois pendant une lecture : `loadAll` n'est appelé qu'une fois, et les deux appels se résolvent.
  - `exit()` pendant `loading` : le `signal` reçu par `loadAll` est `aborted` ; `mode: 'off'` ; `shouldIntercept` vaut `false`.
  - `respond` avec rareté `L` : uniquement les doublons `L`, triés ; `getState().summary` correspond à ce sous-ensemble.
  - `respond` sur une collection sans doublon : liste vide, `summary` vaut `{ cards: 0, extra: 0 }`.
- [ ] **Step 2: Lancer et voir échouer** — `node --test tests/controller.test.js` → FAIL.
- [ ] **Step 3: Écrire `extension/src/controller.js`.** Une seule lecture en cours, gardée dans une promesse partagée, avec son `AbortController`. Journaliser `mode`, `freshness:same|changed|unknown` et `load:done|failed`.
- [ ] **Step 4: Lancer et voir passer** — `npm test` → tous PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: contrôleur du mode Doublons"`

### Task 8: Interface, assemblage et preuve en vrai

**Files:**
- Create: `extension/src/format.js`, `extension/src/log.js`, `extension/src/dom.js`, `extension/src/main.js`, `extension/manifest.json`
- Test: `tests/format.test.js`, `tests/manifest.test.js`

**Interfaces:**
- Consumes: tout ce qui précède ; sélecteurs et `REFETCH_TRIGGER` du carnet.
- Produces:
  - `format.js` :
    - fonctions `formatSummary({ cards, extra }) -> string`, `formatLoaded(loadedAt: number, now: number) -> string`, `formatProgress({ pagesRead, pageCount }) -> string` ;
    - constantes `LABELS = { option: 'Doublons', refresh: '↻ rafraîchir', loadingNote: "Une seule fois, ensuite c'est gardé en cache.", stale: 'Ta collection a changé depuis le dernier chargement', approximate: 'recherche approximative', incompleteKept: 'Lecture incomplète : affichage du dernier chargement complet.', incompleteNone: 'Lecture incomplète : rien à afficher. Réessaie plus tard.', freshness: "Impossible de joindre wiki-masters pour l'instant." }`.
  - `log.js` : `createLogger(enabled: boolean) -> (event: string, data?: object) => void`, préfixe `[wm-doublons]`. Activé si `localStorage['wm-doublons:debug'] === '1'`.
  - `dom.js` (navigateur seulement) :
    - `findSortDropdown(root) -> Element|null`
    - `injectOption(dropdown, { label, onSelect, onOtherSelect })`
    - `showSelected(dropdown, label)`
    - `triggerSiteRefetch()`
    - `renderStatus(state: ControllerState, now: number)` : progression, résumé, date, bouton rafraîchir, bandeau, erreurs, mention approximative, insérés à `STATUS_ANCHOR`
    - `badgeCards(entriesOfPage: Entry[])` : badge `×N` sur chaque carte de `GRID`, sauf si `COUNT_SHOWN_BY_SITE`
    - `watch(root, onChange)` : `MutationObserver`, pour la navigation interne du site
  - `main.js` : installe l'intercepteur dès son exécution, crée cache, chargeur et contrôleur, puis branche la liste déroulante à chaque apparition. Quitter la page collection appelle `controller.exit()`.

- [ ] **Step 1: Écrire les tests qui échouent**
  - `formatSummary({ cards: 23, extra: 61 })` → `'23 cartes en double · 61 exemplaires en trop'` ; `({ cards: 1, extra: 1 })` → `'1 carte en double · 1 exemplaire en trop'` ; `({ cards: 0, extra: 0 })` → `'Aucun doublon'`.
  - `formatLoaded(t, t + 30_000)` → `"chargé à l'instant"` ; `+ 5 min` → `'chargé il y a 5 min'` ; `+ 2 h` → `'chargé il y a 2 h'` ; `+ 3 j` → `'chargé il y a 3 j'`.
  - `formatProgress({ pagesRead: 4, pageCount: 270 })` → `'Lecture de ta collection… page 4 / 270'` ; `pageCount: null` → `'Lecture de ta collection… page 4'`.
  - `tests/manifest.test.js` vérifie le manifeste :
    - `manifest_version === 3` ;
    - un seul content script, avec `world: 'MAIN'`, `run_at: 'document_start'` et `matches` qui vaut exactement `['https://www.wiki-masters.com/*']` ;
    - pas de `permissions` ni de `host_permissions` ;
    - chaque fichier de `js` existe, et `main.js` vient en dernier.
- [ ] **Step 2: Lancer et voir échouer** — `npm test` → les nouveaux tests en FAIL.
- [ ] **Step 3: Écrire `format.js`, `log.js` et `manifest.json`.** Manifeste : nom `Doublons pour Wiki Masters (non officiel)`, `version: "0.1.0"`, `js` dans l'ordre `site-api, duplicates, loader, cache, interceptor, controller, format, log, dom, main`.
- [ ] **Step 4: Lancer et voir passer** — `npm test` → tous PASS.
- [ ] **Step 5: Écrire `dom.js` et `main.js`.** `main.js` fait un balayage initial puis `watch` (le site navigue sans recharger).
> **Amendement 2026-11-02.** Steps 6 et 7 se font dans le Chrome de Victor, extension chargée non empaquetée (`chrome://extensions`, mode développeur). Les `verdict network` deviennent l'onglet Réseau de DevTools (Victor capture ou décrit) ; les journaux `[wm-doublons]` de la console sont copiés par Victor (`! pbpaste > probe/out/preuve-*.txt`).

- [ ] **Step 6: Preuve en vrai**, journaux actifs (`localStorage['wm-doublons:debug'] = '1'`) et lus dans la console de Victor. Cocher chaque point avec sa preuve (capture ou ligne de journal) :
  1. « Doublons » apparaît dans la liste déroulante et peut être sélectionné.
  2. Au premier chargement, la progression défile. `verdict network` montre des appels un par un, espacés d'au moins 400 ms.
  3. La grille montre les doublons au rendu du site, triés par `count`, avec le badge `×N`. Le résumé est juste : à comparer aux chiffres de la sonde.
  4. Un clic sur une carte se comporte comme d'habitude.
  5. Rareté L, recherche et étiquette filtrent ; le résumé et la pagination suivent.
  6. Après rechargement de la page, la vue revient depuis le cache (`chargé il y a …`), au prix d'un seul appel de fraîcheur.
  7. Revenir à « Rareté » rend le site normal. Hors mode, `verdict network` montre les appels réels du site, et le journal ne contient aucun `intercept`.
  8. Une exception forcée dans `respond` (temporairement, via la console) laisse le site fonctionner.
- [ ] **Step 7: Preuve du premier chargement par Victor.** Dans son Chrome : `chrome://extensions`, mode développeur, « Charger l'extension non empaquetée », dossier `extension/`. Victor ouvre la page collection à froid et sélectionne « Doublons ». Points 1 à 3 et 7 refaits.
- [ ] **Step 8: Commit** — `git commit -m "feat: interface du mode Doublons et assemblage de l'extension"`

### Task 9: Publication (fil principal, avec Victor)

**Files:**
- Create: `README.md`, `PRIVACY.md`, `store/listing.md`, `extension/icons/icon128.png`, `tools/package.sh`
- Modify: `extension/manifest.json` (`icons`, `version: "1.0.0"`)

**Interfaces:**
- Produces: `dist/wm-doublons-<version>.zip`, avec `manifest.json` à la racine du zip.

- [ ] **Step 1: Textes.** Écrire les trois fichiers :
  - `README.md` : ce que fait l'extension, installation depuis le store, limites connues (fraîcheur si H12 non vérifiée, recherche approximative si `SEARCH_RULE = approx`, Chromium seulement), mention « non officiel ».
  - `PRIVACY.md` : l'extension lit la collection du joueur sur wiki-masters.com ; les données restent dans le navigateur ; rien n'est transmis, vendu ni partagé.
  - `store/listing.md` : description courte et longue, justification d'usage unique, déclaration d'usage des données.
- [ ] **Step 2: Icône et paquet.** Ajouter une icône PNG de 128 × 128 px dans `extension/icons/`, déclarée dans le manifeste. Écrire `tools/package.sh`, qui zippe le contenu de `extension/` dans `dist/`. Vérifier : `unzip -l dist/wm-doublons-1.0.0.zip` liste `manifest.json` à la racine. Lancer `npm test` : tous PASS.
- [ ] **Step 3: Captures pour la fiche (1280 × 800).** Victor les fait dans son Chrome, en mode Doublons. Victor valide les captures avant usage : elles montrent sa collection.
- [ ] **Step 4: Commit** — `git commit -m "docs: README, confidentialité et fiche du store"`
- [ ] **Step 5: Dépôt GitHub.** Demander l'accord de Victor (nom du dépôt, visibilité publique) avant `gh repo create` et le premier `push`.
- [ ] **Step 6: Soumission par Victor.** Victor crée son compte développeur Chrome Web Store (5 $) et téléverse le zip. Il remplit la fiche depuis `store/listing.md`, avec l'URL de `PRIVACY.md` sur GitHub, puis soumet. Claude ne soumet rien.
