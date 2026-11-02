# Vue « Doublons » Wiki Masters — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une extension Chrome (Manifest V3) qui ajoute « Doublons » au tri de la page collection de wiki-masters.com et affiche, avec le rendu natif du site, une carte par groupe (`card_id`, `is_shiny`) d'au moins 2 exemplaires (N = somme des `count`), triés par N décroissant, avec un badge `×N`.

**Architecture:** un content script exécuté dans le contexte de la page (`world: "MAIN"`, `document_start`) remplace `fetch` par une version qui, en mode Doublons, répond elle-même aux appels du site à `/api/my-collection` à partir d'un cache local de toute la collection. Le site dessine donc lui-même les cartes, les clics et la pagination. Tout ce qui ne dépend pas du DOM est en fonctions pures testées sous Node ; le DOM et l'intégration se prouvent en vrai, via Verdict.

**Tech Stack:** JavaScript simple (scripts classiques, sans build, sans dépendance), Manifest V3, IndexedDB, tests `node --test` (Node 24, installé : v24.22.1), Verdict pour le navigateur.

**Spec:** `docs/superpowers/specs/2026-11-02-doublons-extension-design.md`

## Global Constraints

- Extension Manifest V3 ; un seul bloc `content_scripts` : `matches: ["https://www.wiki-masters.com/*"]`, `run_at: "document_start"`, `world: "MAIN"`. Aucun champ `permissions` ni `host_permissions`. Aucun code chargé à distance.
- JavaScript simple, sans étape de build, sans dépendance npm (ni runtime ni dev). `package.json` ne contient que `name`, `private: true`, `scripts.test = "node --test \"tests/*.test.js\""` (sous Node 24, `node --test tests/` échoue : `Cannot find module …/tests`).
- Chaque fichier de `extension/src/` est enveloppé dans `(() => { ... })();`, publie son API dans `globalThis.__wmDoublons` (objet partagé, créé s'il manque) et, si `module` existe, dans `module.exports` (pour les tests Node en CommonJS). Aucun fichier n'en `require` un autre : les dépendances sont injectées, seul `main.js` assemble.
- Réseau : uniquement des `GET` same-origin vers `/api/my-collection` et `/api/my-collection/stats`, toujours via le `fetch` d'origine (jamais via notre propre interception). Jamais deux appels de l'extension en parallèle. Au moins **400 ms** entre la fin d'un appel de l'extension et le début du suivant, quel qu'il soit (pages, fraîcheur). Délai maximal par appel : **20 s**.
- Portée : interception et injection seulement quand `location.pathname === '/collection'`.
- Les clics programmés par l'extension (`element.click()`, donc `event.isTrusted === false`) ne sont jamais pris pour des choix de Victor.
- Sur 429 ou 5xx : respecter `Retry-After` (secondes ou date HTTP) s'il vaut au plus 60 s, réessayer **une seule fois** la même page ; sinon arrêter la lecture.
- Une lecture incomplète n'est jamais affichée comme complète.
- Hors mode Doublons, chaque appel du site passe tel quel. Toute exception de notre code retombe sur le `fetch` d'origine (échec ouvert).
- Journaux et carnet : jamais de cookie, d'en-tête d'authentification ni de jeton. Les URL journalisées gardent chemin et requête seulement.
- Texte affiché en français. Libellés exacts : option `Doublons` ; résumé `X cartes en double · Y exemplaires en trop` ; `chargé il y a … · ↻ rafraîchir` ; progression `Lecture de ta collection… page 4 / 271` et `Une seule fois, ensuite c'est gardé en cache.` ; bandeau `Ta collection a changé depuis le dernier chargement`.
- Doublon (règle de Victor, 2026-11-02) : les entrées se regroupent par (`card_id`, `is_shiny`) ; N = somme des `count` du groupe ; doublon si N ≥ 2. Shiny et normale ne s'additionnent jamais. La vue montre **une carte par groupe** avec un badge `×N`.
- En mode Doublons, **deux** appels du site sont servis depuis le cache : la liste `/api/my-collection?…` et les totaux `/api/my-collection/stats?…` (le site en tire « Page x / N »).
- Les valeurs propres au site (noms de champs, paramètres, sélecteurs) viennent **uniquement** du tableau « Valeurs pour le code » de `docs/carnet-api.md` (Task 1, fait). Ne jamais les deviner.
- Chaque commit se termine par la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Chaque commit fait un `git add` explicite des fichiers de la tâche ; jamais `git add -A` ni `git add .`.

## Review Focus

1. **Collection vide ou sans doublon** : la vue affiche `Aucun doublon`, pas une grille vide muette ni une erreur. Tests : Task 3 (`groupDuplicates([])`), Task 7 (`respond` sans doublon), Task 8 (`formatSummary`).
2. **Singulier** : `1 carte en double · 1 exemplaire en trop`, pas `1 cartes`. Test : Task 8.
3. **Quitter le mode, ou la page, pendant la lecture** : la lecture s'arrête, plus aucun appel, le site reprend la main. Tests : Task 4 (abandon par `AbortSignal`), Task 7 (`exit()` pendant `loading`).
4. **Double clic sur « ↻ rafraîchir », ou ↻ pendant la première lecture, ou réentrée** : une seule lecture à la fois. Tests : Task 7 (`refresh()` × 2 ; `refresh()` pendant le `loadAll` d'`enter()`).
5. **Page hors limites après un filtre** (le joueur était page 5, le filtre ne laisse que 2 pages) : réponse avec une liste vide et les bons totaux, pas de plantage. Test : Task 2 (`buildListResponse`).

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

- [x] **Step 1: Connexion.** Lancer `verdict goto https://www.wiki-masters.com`, puis `verdict handoff`. Victor se connecte dans le Chrome visible. Lancer ensuite `verdict resume` et `verdict auth-save wikimasters`. Les sessions suivantes repartent de `verdict goto-auth <url> --profile wikimasters`.
- [x] **Step 2: Appels du site (H1, H7, H8).** Ouvrir la page collection et vider le journal réseau. Changer tri, page, recherche (`Léman`), étiquette et rareté (L), un geste à la fois. Après chaque geste, `verdict network`. Noter l'URL exacte de chaque appel à `my-collection`, son type (`fetch` ou `xhr`), et les en-têtes d'authentification (présence seulement, jamais la valeur). Recopier les URL d'exemple dans le carnet : Task 2 s'en sert telles quelles.
- [x] **Step 3: Enveloppe et pagination (H1, H2, H4, H6, H9, H10).** Écrire `probe/sonde.js`. Il fait des `fetch` same-origin espacés de 400 ms, et renvoie seulement des métadonnées : statut, clés de l'enveloppe, longueur de la liste, total, en-têtes `RateLimit-*` et `Retry-After`. Appels, un par variante : page 0 ; `stats=1` ; une taille de page (`limit`, `per_page`, `size`, `page_size` = 200). Pour `LOAD_SORT` : relire deux fois la même page au milieu de la collection avec chaque tri candidat, et retenir un tri dont l'ordre ne change pas. Ne jamais déclencher volontairement de 429.
- [x] **Step 4: Tri serveur (H5).** Essayer `sort=count`, `sort=-count` et `min_count=2` (un appel chacun). Noter si le résultat change vraiment.
- [x] **Step 5: Lecture complète, une fois (H2, H3, H4).** Avec `sonde.js` : lire toutes les pages avec `LOAD_SORT`, à 400 ms. Relever le nombre d'entrées, d'`id` uniques et de couples (`card_id`, `is_shiny`) uniques, la répartition des `count` (combien à 0, 1, ≥ 2), et la concordance avec le total annoncé. Ne garder dans le carnet que ces chiffres, pas les données.
- [x] **Step 6: Interception (H7).** Avec `verdict js`, remplacer `window.fetch` dans la page : pour `my-collection`, renvoyer l'enveloppe réelle avec la liste inversée et un total réduit. Déclencher une relecture par le site. Vérifier dans la page, avec `verdict snapshot -i` et `verdict screenshot` :
  - le site dessine les cartes substituées ;
  - un clic sur une carte se comporte comme d'habitude ;
  - la pagination affiche le total substitué.

  Noter `REFETCH_TRIGGER` et `COUNT_SHOWN_BY_SITE`.
- [x] **Step 7: Liste déroulante et contrôles (H11, H13).** Avec `verdict inspect` et `verdict snapshot -i`, relever la structure de la liste déroulante de tri (rôles ARIA, éléments), de la recherche, des étiquettes, des puces de rareté, de la grille et d'une carte. Injecter un élément « Doublons » dans la liste ouverte, cliquer dessus. Noter si le site plante, si la liste se referme, et si le libellé sélectionné peut être réécrit.
- [x] **Step 8: Fraîcheur (H12).** Relever les candidats : un total d'exemplaires dans `stats=1`, et le `obtained_at` le plus récent sous le tri « Date d'ajout ». Si Victor peut gagner ou recycler une carte pendant la séance, relire les candidats avant et après. Sinon, marquer H12 `non vérifiée` et retenir le repli `total`.
- [x] **Step 9: Extension dans Verdict (H14).** Vérifier si Verdict sait lancer Chrome avec une extension non empaquetée (README de Verdict, options de lancement). Sinon, `INJECTION = verdict-js`.
- [x] **Step 10: Carnet et fixture.** Écrire `docs/carnet-api.md` : faits datés en haut, hypothèses à part, tableau « Valeurs pour le code » complet. Écrire `tests/fixtures/page0.json`. Vérifier : `grep -iE "cookie|authorization|bearer|token" docs/carnet-api.md tests/fixtures/page0.json probe/sonde.js` ne renvoie aucune valeur de secret.
- [x] **Step 11: Commit**

```bash
git add probe/sonde.js docs/carnet-api.md tests/fixtures/page0.json
git commit -m "docs: carnet de sonde de l'API my-collection"
```

### Point d'arrêt après Task 1 (fil principal)

> **Fait le 2026-11-02.** H3 est tombée : Victor a tranché la règle (groupes), l'affichage (une carte par groupe) et le rafraîchissement incrémental ; H5 et H6 sont tombées sans changer l'architecture ; H7 tient. Tasks 2, 3, 4, 7 et 8 réécrites en conséquence.

- H1 tombe : arrêt, retour vers Victor.
- H2 ou H3 tombe : retour vers Victor avant toute suite.
- H5 tient (tri ou filtre serveur sur `count`) : la lecture complète devient inutile. Réécrire les Tasks 4, 5 et 7 dans ce plan et les faire valider par Victor.
- H7 tombe : appliquer le repli de la spec (grille clonée depuis le HTML d'une carte). Réécrire les Tasks 6 et 8 dans ce plan et les faire valider par Victor.
- Sinon : un agent `opus` en lecture seule relit le plan entier contre la spec et le carnet. Il dresse le tableau des conflits entre tâches : fichiers et interfaces partagés, valeurs du carnet mal reportées. Chaque correction s'écrit **dans ce plan** avant Task 2.

---

### Task 2: Squelette et adaptateur du site (`site-api.js`)

> Réécrite le 2026-11-02 après la sonde (carnet `docs/carnet-api.md`). Les valeurs ci-dessous sont celles du carnet.

**Files:**
- Create: `package.json`, `tests/helpers.js`
- Create: `extension/src/site-api.js`
- Modify: `.gitignore` (ajouter `dist/`)
- Test: `tests/site-api.test.js` (fixtures déjà présentes : `tests/fixtures/page0.json`, `page0-stats1.json`, `stats.json`)

**Interfaces:**
- Produces (`extension/src/site-api.js`) :
  - `SITE = Object.freeze({ LIST_PATH: '/api/my-collection', STATS_PATH: '/api/my-collection/stats', LIST_KEY: 'collection', PAGE_SIZE: 50, LOAD_SORT: 'rarity', DATE_SORT: 'added', FRESHNESS_URL: '/api/my-collection?sort=rarity&page=0&stats=1' })`
  - `classifyUrl(url: string) -> 'list' | 'stats' | null` : même origine que `https://www.wiki-masters.com` (ou `location.origin` si défini), chemin exact `LIST_PATH` → `'list'`, `STATS_PATH` → `'stats'`, sinon `null`.
  - `parseSiteQuery(url: string) -> { page: number, search: string, tagId: string | null, rarities: string[] }` : `page` (défaut 0), `q`, `tag_id`, `rarity` (toutes les occurrences, chacune découpée sur `,`, vides retirés).
  - `buildPageUrl(page: number, sort: string) -> string` : `/api/my-collection?sort=<sort>&page=<page>&stats=0`.
  - `parseList(json: object) -> Entry[]` : `json.collection`, ou `[]` si absent.
  - `buildListResponse(template: object, cards: Entry[], page: number) -> object` : forme d'une réponse liste `stats=0` du site : `{ ...template, collection: <tranche page de cards, PAGE_SIZE>, total: null, rarityCounts: {}, tagOptions: [] }` ; `pendingTradeCardIds` et toute autre clé du template conservées. Page hors limites → `collection: []`.
  - `buildStatsResponse(template: object, { total: number, rarityCounts: object }) -> object` : `{ total, totalUnique: total, rarityCounts, tagOptions: template.tagOptions ?? [] }`.
  - `readFreshness(json: object) -> { userId: string | null, total: number | null, freshness: string, template: object }` : `freshness = total + '|' + JSON.stringify(rarityCounts)` ; `userId` = `user_id` de la première entrée de `collection`, ou `null` ; `template` = `json`.
  - `fetchFreshness(fetchFn: (url: string, init?: object) => Promise<Response>) -> Promise<ReturnType<readFreshness>>` : un seul appel à `FRESHNESS_URL` avec `{ credentials: 'same-origin' }` ; statut non 2xx → rejet.
- Produces (`tests/helpers.js`) : `makeEntry({ id, cardId, title = 'Titre', category = 'catégorie', rarity = 'C', count = 1, shiny = false, starred = false, tags = [], obtainedAt = '2026-11-01T00:00:00+00:00' }) -> Entry`, même forme que les entrées de `tests/fixtures/page0.json` (`cardId` par défaut dérivé de `title` ; `user_id: 'user-A'`).
- `Entry` : la forme réelle de `tests/fixtures/page0.json` (`id`, `card_id`, `count`, `is_shiny`, `starred`, `tags: { id, name, color, user_id, created_at }[]`, `user_id`, `obtained_at`, `card.{ rarity, wikipedia_title, category, … }`).

- [ ] **Step 1: Écrire les tests qui échouent** (`tests/site-api.test.js`, `node:test` + `node:assert/strict`, CommonJS) :
  - `classifyUrl` : `'/api/my-collection?sort=rarity&page=0&stats=0'` → `'list'` ; `'/api/my-collection/stats?sort=rarity&q=L%C3%A9man'` → `'stats'` ; `'https://www.wiki-masters.com/api/my-collection'` → `'list'` ; `'/api/cards?page=0&sort=rarity'` → `null` ; `'https://evil.example/api/my-collection'` → `null`.
  - `parseSiteQuery` sur les URL réelles du carnet :
    - `'/api/my-collection?sort=rarity&q=L%C3%A9man&page=0&stats=0'` → `{ page: 0, search: 'Léman', tagId: null, rarities: [] }`
    - `'/api/my-collection?sort=rarity&rarity=L&page=0&stats=0'` → `{ page: 0, search: '', tagId: null, rarities: ['L'] }`
    - `'/api/my-collection?sort=rarity&tag_id=92158624-7aba-4e00-832d-e5d5571d2c52&page=0&stats=0'` → `tagId: '92158624-7aba-4e00-832d-e5d5571d2c52'`
    - `'/api/my-collection?sort=rarity&page=2&stats=0'` → `page: 2`
    - `'/api/my-collection/stats?sort=rarity&rarity=L,UR'` → `rarities: ['L', 'UR']`
  - `buildPageUrl(3, 'added')` → `'/api/my-collection?sort=added&page=3&stats=0'`.
  - `parseList(page0)` → 6 entrées ; `parseList({})` → `[]`.
  - `buildListResponse(page0, 53 cartes, 1)` → `collection` de 3 cartes, `total: null`, `rarityCounts: {}`, `tagOptions: []`, `pendingTradeCardIds: []`.
  - `buildListResponse(page0, 1 carte, 5)` → `collection: []` (page hors limites).
  - `buildListResponse` ne modifie pas `template` (`JSON.stringify` avant/après égal).
  - `buildStatsResponse(page0Stats1, { total: 24, rarityCounts: { C: 20, R: 4 } })` → `{ total: 24, totalUnique: 24, rarityCounts: { C: 20, R: 4 }, tagOptions: <les 1 tagOptions de la fixture> }`.
  - `readFreshness(page0Stats1)` → `userId: 'user-A'`, `total: 13522`, `freshness: '13522|' + JSON.stringify(page0Stats1.rarityCounts)`.
  - `fetchFreshness` : un seul appel, à `SITE.FRESHNESS_URL` ; une réponse 500 → rejet.
- [ ] **Step 2: Lancer et voir échouer** — `node --test tests/site-api.test.js` → FAIL, `Cannot find module '../extension/src/site-api.js'`.
- [ ] **Step 3: Écrire `package.json`, `tests/helpers.js`, `extension/src/site-api.js`** selon les Interfaces et le wrapper des Global Constraints.
- [ ] **Step 4: Lancer et voir passer** — `npm test` → tous PASS.
- [ ] **Step 5: Commit** — `git add package.json .gitignore tests/helpers.js tests/site-api.test.js extension/src/site-api.js && git commit -m "feat: adaptateur de l'API my-collection"`

> **Corrections pré-vol (2026-11-02) — prévalent sur le texte de la tâche :**
> - La forme réelle des `tags` (`{ id, name, color, user_id, created_at }`) est dans `tests/fixtures/page0-stats1.json` (2e entrée), pas dans `page0.json` (aucune étiquette ni shiny ni doublon).
> - Test en plus : les clés de `buildStatsResponse(page0Stats1, …)` sont exactement celles de `tests/fixtures/stats.json` (`total`, `totalUnique`, `rarityCounts`, `tagOptions`).
> - `readFreshness` : `freshness = total + '|' + JSON.stringify(<rarityCounts aux clés triées>)`, pour ne pas dépendre de l'ordre des clés renvoyé par le serveur ; test avec un `rarityCounts` aux clés dans un autre ordre → même `freshness`.
> - `makeEntry` : `id` par défaut = compteur (`'e1'`, `'e2'`, …) ; `cardId` par défaut dérivé de `title` — **deux entrées de même titre forment un groupe** (le dire en commentaire du helper).
> - `fetchFreshness(fetchFn, { signal } = {})` transmet `signal` à `fetchFn`.

### Task 3: Groupes de doublons et filtres (`duplicates.js`)

> Réécrite le 2026-11-02 : `count` vaut toujours 1 sur le compte de Victor ; un doublon est une carte présente en plusieurs entrées (décision de Victor).

**Files:**
- Create: `extension/src/duplicates.js`
- Test: `tests/duplicates.test.js`

**Interfaces:**
- Consumes: `Entry`, `makeEntry` (Task 2).
- Produces:
  - `RARITY_ORDER = ['L', 'UR', 'SR', 'R', 'PC', 'C']`
  - `Group = { key: string, entry: Entry, n: number, ids: string[], tagIds: string[] }` (`key = card_id + '|' + is_shiny` ; `n` = somme des `count` du groupe ; `entry` = représentante ; `tagIds` = union des `tags[].id` du groupe)
  - `groupDuplicates(entries: Entry[]) -> Group[]` : groupes avec `n ≥ 2` seulement ; tri `n` décroissant, puis rang dans `RARITY_ORDER` (inconnues à la fin), puis `card.wikipedia_title` en `localeCompare(…, 'fr')`, puis normale avant shiny. Représentante : une entrée non `starred` de préférence, puis la plus récente (`obtained_at`).
  - `summarize(groups: Group[]) -> { cards: number, extra: number }` (`extra` = somme de `n − 1`).
  - `normalizeText(s: string) -> string` : minuscules, NFD, diacritiques retirés.
  - `filterGroups(groups: Group[], { search: string, tagId: string | null, rarities: string[] }) -> Group[]` : ET entre filtres ; filtre vide = sans effet. Recherche : `normalizeText(search)` sous-chaîne de `normalizeText(card.wikipedia_title)` ou de `normalizeText(card.category)` (règle exacte du site, 6/6 au carnet). Étiquette : `group.tagIds.includes(tagId)`. Rareté : `rarities.includes(card.rarity)`.
  - `rarityCounts(groups: Group[]) -> Record<string, number>` : nombre de groupes par rareté.

- [ ] **Step 1: Écrire les tests qui échouent** (`tests/duplicates.test.js`) :
  - Deux entrées de même `cardId`, `count: 1` chacune → un groupe, `n: 2`, `ids` des deux.
  - Une entrée `count: 3` seule → un groupe, `n: 3`. Une entrée `count: 1` seule → aucun groupe.
  - Même carte, une normale + une shiny, `count: 1` chacune → aucun groupe (versions séparées).
  - Représentante : groupe de 2 entrées dont une `starred` plus récente et une non `starred` → `entry` est la non `starred` ; deux non `starred` → la plus récente.
  - Tri : groupes `n` 2, 5, 3 → ordre 5, 3, 2 ; à `n` égal, `{L, 'Zola'}`, `{C, 'Albert'}`, `{L, 'Abba'}` → `Abba`, `Zola`, `Albert`.
  - `groupDuplicates([])` → `[]` ; `summarize([])` → `{ cards: 0, extra: 0 }` ; `summarize` sur `n` 5 et 2 → `{ cards: 2, extra: 5 }`.
  - `filterGroups`, recherche : `'leman'` et `'Léman'` trouvent `'Lac Léman'` ; `'ACTRICE'` trouve la catégorie `'actrice australienne'` ; `'eman'` trouve `'Lac Léman'`.
  - `filterGroups`, étiquette : groupe dont une seule des deux entrées porte `{ id: 't1' }` → passe avec `tagId: 't1'` ; groupe sans étiquette → exclu.
  - `filterGroups`, rareté : `['L', 'UR']` exclut `C` ; filtres vides → liste inchangée ; recherche + rareté → intersection.
  - `rarityCounts` sur 2 groupes `C` et 1 `L` → `{ C: 2, L: 1 }`.
- [ ] **Step 2: Lancer et voir échouer** — `node --test tests/duplicates.test.js` → FAIL, module introuvable.
- [ ] **Step 3: Écrire `extension/src/duplicates.js`** selon les Interfaces.
- [ ] **Step 4: Lancer et voir passer** — `npm test` → tous PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: groupes de doublons et filtres"` (fichiers de la tâche seulement).

> **Corrections pré-vol (2026-11-02) — prévalent sur le texte de la tâche :**
> - `Group` porte aussi `members: Entry[]` (toutes les entrées du groupe).
> - Représentante : comparer les dates avec `Date.parse(obtained_at)` (le nombre de décimales varie), pas les chaînes.
> - `filterGroups` avec `tagId` : renvoie des copies dont `entry` est un membre portant l'étiquette (la carte affichée correspond au filtre). Test : groupe de 2 dont seule l'entrée non représentante porte `t1` → avec `tagId: 't1'`, `entry.id` est celle qui porte `t1`.
> - `normalizeText` traite aussi `œ` → `oe` et `æ` → `ae` (comme un `unaccent` serveur). Test : `normalizeText('Cœur')` → `'coeur'`.

### Task 4: Lecture polie, complète et incrémentale (`loader.js`)

> Réécrite le 2026-11-02 : le serveur répond en 4,4 s par page en moyenne (26 min pour 271 pages) ; Victor a choisi le rafraîchissement incrémental par le tri `added`.

**Files:**
- Create: `extension/src/loader.js`
- Test: `tests/loader.test.js`

**Interfaces:**
- Consumes: `parseList` (Task 2), passé en paramètre.
- Produces:
  - `class IncompleteLoadError extends Error` avec `page: number`, `status: number | null`, `reason: 'http' | 'network' | 'retry-after' | 'mismatch' | 'too-many-new'`.
  - `class AbortedLoadError extends Error`.
  - `parseRetryAfter(value: string | null, now: number) -> number | null` : millisecondes ; secondes ou date HTTP ; `null` si absent ou illisible.
  - Options communes `common = { fetchPage: (page: number, signal: AbortSignal) => Promise<Response>, parseList, delayMs = 400, maxRetryAfterMs = 60000, sleep: (ms: number, signal: AbortSignal) => Promise<void>, now: () => number, onProgress: ({ pagesRead: number, pageCount: number | null }) => void, signal: AbortSignal, log = () => {} }`.
  - `loadAllPages({ ...common, pageCount: number, expectedTotal: number | null }) -> Promise<{ entries: Entry[] }>` : pages `0 … pageCount − 1`, arrêt anticipé sur une page vide ; entrées dédoublonnées par `id` ; si `expectedTotal` n'est pas `null` et diffère du nombre d'`id` uniques → `IncompleteLoadError('mismatch')`.
  - `loadNewEntries({ ...common, knownIds: Set<string>, maxPages = 20 }) -> Promise<{ entries: Entry[] }>` : pages `0, 1, …` (le `fetchPage` fourni lit le tri `added`) ; garde les entrées dont l'`id` n'est pas dans `knownIds` ; s'arrête après la première page qui contient un `id` connu, ou sur une page vide ; `maxPages` atteint sans `id` connu → `IncompleteLoadError('too-many-new')`.
  - Règles communes : une page à la fois ; `sleep(delayMs)` entre deux pages, jamais avant la première ; 429 ou 5xx avec `Retry-After` ≤ `maxRetryAfterMs` → `sleep` puis **une** nouvelle tentative de la même page ; sinon `IncompleteLoadError` ; autre non-2xx → `IncompleteLoadError('http')` ; exception de `fetchPage` → `'network'` ; signal déclenché → `AbortedLoadError`, plus aucun appel.

- [ ] **Step 1: Écrire les tests qui échouent** (`tests/loader.test.js`). `fetchPage` factice : `new Response(JSON.stringify({ collection: [...] }), { status, headers })` ; `sleep` factice qui enregistre ses durées ; compteur d'appels simultanés.
  - `loadAllPages`, `pageCount: 3`, `expectedTotal: 150` → 150 entrées ; `sleeps` = `[400, 400]` ; au plus 1 appel simultané ; `onProgress` reçoit `pagesRead` 1, 2, 3 avec `pageCount: 3`.
  - `loadAllPages`, page 2 vide alors que `pageCount: 3` → s'arrête ; avec `expectedTotal: 150` et 100 lues → `mismatch`.
  - Même `id` sur deux pages, `expectedTotal` = nombre brut → `mismatch`.
  - 429 avec `Retry-After: 2` puis 200 → `sleep(2000)`, une nouvelle tentative, succès.
  - 429 deux fois sur la même page → `IncompleteLoadError`, `status: 429`.
  - 503 sans `Retry-After` → `IncompleteLoadError`, `status: 503`, un seul appel pour cette page.
  - `Retry-After: 120` → `reason: 'retry-after'`, aucun `sleep(120000)`.
  - 401 → `reason: 'http'`, `status: 401` ; `fetchPage` qui lève → `reason: 'network'`.
  - `parseRetryAfter('Wed, 21 Oct 2026 07:28:02 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))` → `2000` ; `parseRetryAfter('3', 0)` → `3000` ; `parseRetryAfter(null, 0)` → `null`.
  - Abandon pendant la 2e page → `AbortedLoadError`, aucun appel à la page 3.
  - `loadNewEntries` : page 0 = 50 nouvelles, page 1 = 10 nouvelles puis 40 connues → 60 entrées, 2 appels, pas de page 2.
  - `loadNewEntries` : page 0 commence par un `id` connu → `[]`, 1 appel.
  - `loadNewEntries` : `maxPages: 2`, aucune page ne contient d'`id` connu → `reason: 'too-many-new'`.
- [ ] **Step 2: Lancer et voir échouer** — `node --test tests/loader.test.js` → FAIL.
- [ ] **Step 3: Écrire `extension/src/loader.js`.** Journaliser `load:page` (`{ page, status, ms }`) et `load:stop` (`{ reason }`) via `log`.
- [ ] **Step 4: Lancer et voir passer** — `npm test` → tous PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: lecture complète et incrémentale de la collection"`

> **Corrections pré-vol (2026-11-02) — prévalent sur le texte de la tâche :**
> - Erreurs : `new IncompleteLoadError({ reason, page = null, status = null })` avec `name = 'IncompleteLoadError'` ; `new AbortedLoadError()` avec `name = 'AbortedLoadError'`. Les autres modules les reconnaissent par `err.name` (et `err.reason`), sans `instanceof`.
> - `loadAllPages` : `expectedTotal` peut être `null` → aucun contrôle de concordance dans le chargeur (le contrôleur vérifie après, voir Task 7).
> - Abandon : un rejet de `fetchPage` alors que `signal.aborted` est vrai → `AbortedLoadError`, pas `'network'` ; le `sleep` fourni rejette sur abandon. Tests pour les deux.
> - Nouveau : `createSerialFetch({ fetchFn, minGapMs = 400, timeoutMs = 20000, sleep, now }) -> (url: string, init?: { signal?: AbortSignal }) => Promise<Response>` : un seul appel à la fois (file d'attente), au moins `minGapMs` entre la fin d'un appel et le début du suivant, abandon après `timeoutMs` (combiné au `signal` de l'appelant). Tests : deux appels lancés ensemble s'exécutent l'un après l'autre ; l'écart mesuré avec `now` factice ≥ 400 ; un appel qui dépasse `timeoutMs` rejette. `main.js` (Task 8) fait passer **tous** les appels de l'extension par cette fonction.

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

> **Corrections pré-vol (2026-11-02) — prévalent sur le texte de la tâche :**
> - `memoryStore` stocke et rend des copies (`structuredClone`), comme IndexedDB. Test : modifier l'objet rendu par `get` ne change pas le contenu du cache.

### Task 6: Interception de `fetch` (`interceptor.js`)

**Files:**
- Create: `extension/src/interceptor.js`
- Test: `tests/interceptor.test.js`

**Interfaces:**
- Produces: `installInterceptor({ target: { fetch: Function }, shouldIntercept: (url: string) => boolean, respond: (url: string) => object | Promise<object>, isWatched: (url: string) => boolean = () => false, onSettled: (url: string, intercepted: boolean) => void = () => {}, log = () => {} }) -> { originalFetch: Function, uninstall(): void }`
  - `onSettled` est appelé quand un appel pour lequel `isWatched(url)` est vrai se termine (réponse substituée, réponse réelle ou erreur réseau) ; une exception dans `onSettled` est ignorée.
  - L'URL se lit sur une chaîne, un `URL` ou un `Request` (`input.url`).
  - Interception : `new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })`.
  - Pas d'interception : `originalFetch.apply(target, arguments)` est renvoyé tel quel.
  - Une exception dans `shouldIntercept` ou dans `respond` : retombée sur `originalFetch`, journalisée `intercept:fallback`.

- [ ] **Step 1: Écrire les tests qui échouent.** `target` factice : `fetch` renvoie un objet marqueur et enregistre ses arguments.
  - `shouldIntercept` → `false` : `target.fetch('/api/boosters', opts)` renvoie **le même** marqueur (`===`), et l'original a reçu exactement `('/api/boosters', opts)`.
  - `shouldIntercept` → `true` : la réponse a le statut 200 et `await res.json()` vaut la sortie de `respond` ; l'original n'est pas appelé.
  - `respond` lève une exception → l'original est appelé, et la réponse est la sienne.
  - `shouldIntercept` lève une exception → l'original est appelé.
  - Entrée `new Request('https://www.wiki-masters.com/api/my-collection?page=0')` → `shouldIntercept` reçoit l'URL complète.
  - `uninstall()` → `target.fetch === originalFetch`.
  - `isWatched` vrai : `onSettled(url, false)` est appelé après la réponse de l'original, et `onSettled(url, true)` après une réponse substituée ; `isWatched` faux → jamais appelé.
- [ ] **Step 2: Lancer et voir échouer** — `node --test tests/interceptor.test.js` → FAIL.
- [ ] **Step 3: Écrire `extension/src/interceptor.js`.**
- [ ] **Step 4: Lancer et voir passer** — `npm test` → tous PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: interception des appels my-collection"`

> **Corrections pré-vol (2026-11-02) — prévalent sur le texte de la tâche :**
> - Un `respond` asynchrone qui rejette retombe aussi sur `originalFetch` (test).
> - Chaque réponse substituée est journalisée `intercept:serve` avec `{ path }` (chemin et requête seulement).

### Task 7: Contrôleur du mode Doublons (`controller.js`)

> Réécrite le 2026-11-02 après la sonde : groupes de doublons, appel `stats` intercepté aussi, rafraîchissement incrémental.

**Files:**
- Create: `extension/src/controller.js`
- Test: `tests/controller.test.js`

**Interfaces:**
- Consumes (injectés) : `classifyUrl`, `parseSiteQuery`, `buildListResponse`, `buildStatsResponse`, `SITE.PAGE_SIZE` (Task 2) ; `groupDuplicates`, `filterGroups`, `summarize`, `rarityCounts` (Task 3) ; `IncompleteLoadError`, `AbortedLoadError` (Task 4) ; `createCache` (Task 5).
- Produces: `createController(deps) -> { enter(): Promise<void>, exit(): void, refresh(): Promise<void>, shouldIntercept(url: string): boolean, respond(url: string): object, getState(): ControllerState }`
  - `deps = { fetchFreshness: () => Promise<{ userId, total, freshness, template }>, loadAll: ({ pageCount, expectedTotal, onProgress, signal }) => Promise<{ entries }>, loadNew: ({ knownIds, onProgress, signal }) => Promise<{ entries }>, cache, site: { classifyUrl, parseSiteQuery, buildListResponse, buildStatsResponse, PAGE_SIZE }, dup: { groupDuplicates, filterGroups, summarize, rarityCounts }, now: () => number, onState: (s: ControllerState) => void, log = () => {} }`
  - `ControllerState = { mode: 'off' | 'loading' | 'ready' | 'error', progress: { phase: 'full' | 'incremental', pagesRead, pageCount } | null, loadedAt: number | null, stale: boolean, freshnessUnknown: boolean, error: null | 'incomplete' | 'freshness' | 'unexpected', summary: { cards, extra } | null, pageCounts: number[] | null }`
  - `CacheRecord` (Task 5) rempli ainsi : `{ entries, total, freshness, template, loadedAt }`.
  - `enter()` :
    1. Un appel `fetchFreshness`, puis `cache.get(userId)`.
    2. Cache présent, même `freshness` → `ready`, `stale: false`. Cache présent, autre `freshness` → `ready`, `stale: true` ; aucune lecture.
    3. Pas de cache → `loading` (`phase: 'full'`), `loadAll({ pageCount: Math.ceil(total / PAGE_SIZE), expectedTotal: total })`, puis `cache.put` et `setLastUserId` (sauf `userId` `null`), puis `ready`.
    4. `fetchFreshness` échoue → cache de `getLastUserId()` en `ready` avec `freshnessUnknown: true` ; sans cache → `mode: 'error'`, `error: 'freshness'`, aucune lecture.
  - `refresh()` : une seule lecture à la fois (promesse partagée).
    1. Sans cache → comme l'étape 3 d'`enter()` (après un `fetchFreshness`).
    2. Avec cache → `loading` (`phase: 'incremental'`), `loadNew({ knownIds: <ids du cache> })`, fusion (nouvelles + anciennes), puis `fetchFreshness`. Si le nombre d'entrées fusionnées égale le `total` frais → `cache.put` de la fusion (nouvelle `freshness`, nouveau `template`, `loadedAt = now()`) → `ready`, `stale: false`. Sinon (une carte est partie) → lecture complète (`phase: 'full'`) avec ce `total`.
    3. `loadNew` rejette `IncompleteLoadError('too-many-new')` → lecture complète.
  - Échec de lecture (`IncompleteLoadError` autre) : avec ancien cache → `ready` sur l'ancien cache, `error: 'incomplete'`, cache intact ; sans ancien cache → `mode: 'error'`. `AbortedLoadError` → `mode: 'off'`, sans erreur.
  - `exit()` : déclenche l'abandon de la lecture en cours ; `mode: 'off'`.
  - `shouldIntercept(url)` : vrai seulement si `mode === 'ready'` et `classifyUrl(url) !== null`.
  - `respond(url)` : `f = parseSiteQuery(url)` ; groupes = `groupDuplicates(record.entries)` (calculés une fois par enregistrement) ; `filtered = filterGroups(groupes, f)`.
    - `'list'` → `buildListResponse(record.template, filtered.map(g => g.entry), f.page)` ; met à jour `summary = summarize(filtered)` et `pageCounts` = les `n` des groupes de la page `f.page` ; notifie `onState`.
    - `'stats'` → `buildStatsResponse(record.template, { total: filtered.length, rarityCounts: rarityCounts(filterGroups(groupes, { ...f, rarities: [] })) })`.

- [ ] **Step 1: Écrire les tests qui échouent** (fakes pour `fetchFreshness`, `loadAll`, `loadNew`, `onState` ; `createCache(memoryStore())` réel ; vraies fonctions des Tasks 2 et 3 pour `site` et `dup` ; entrées via `makeEntry`) :
  - Pas de cache : `loadAll` appelé une fois avec `pageCount: 271, expectedTotal: 13522` quand `total` vaut 13522 ; `onState` passe par `loading` (`phase: 'full'`) puis `ready` ; le cache contient `freshness`, `template`, `loadedAt = now()`.
  - Cache, même fraîcheur → ni `loadAll` ni `loadNew` ; `ready`, `stale: false`. Cache, autre fraîcheur → `ready`, `stale: true`, aucune lecture.
  - `fetchFreshness` rejette, cache de `lastUserId` → `ready`, `freshnessUnknown: true`. Sans cache → `mode: 'error'`, `error: 'freshness'`.
  - `refresh()` incrémental : cache de 3 entrées, `loadNew` rend 2 nouvelles, `total` frais = 5 → cache de 5 entrées, `loadAll` non appelé, `stale: false`.
  - `refresh()` avec carte partie : cache de 3, `loadNew` rend 0, `total` frais = 2 → `loadAll` appelé avec `expectedTotal: 2`.
  - `refresh()` : `loadNew` rejette `too-many-new` → `loadAll` appelé.
  - `refresh()` deux fois pendant une lecture → `loadNew` appelé une fois, les deux promesses se résolvent.
  - `loadAll` rejette `IncompleteLoadError('mismatch')` avec ancien cache → `ready`, `error: 'incomplete'`, cache inchangé ; sans ancien cache → `mode: 'error'` et `shouldIntercept('/api/my-collection?page=0')` vaut `false`.
  - `exit()` pendant `loading` → le `signal` reçu est `aborted`, `mode: 'off'`, `shouldIntercept` vaut `false`.
  - `respond('/api/my-collection?sort=rarity&rarity=L&page=0&stats=0')` : seuls les groupes `L`, une entrée par groupe, triés ; `getState().summary` et `pageCounts` correspondent.
  - `respond('/api/my-collection/stats?sort=rarity&rarity=L')` → `total` = nombre de groupes `L` ; `rarityCounts` compte toutes les raretés (filtre de rareté ignoré).
  - Collection sans doublon → liste vide, `summary: { cards: 0, extra: 0 }`, `stats.total: 0`.
- [ ] **Step 2: Lancer et voir échouer** — `node --test tests/controller.test.js` → FAIL.
- [ ] **Step 3: Écrire `extension/src/controller.js`.** Une `AbortController` par lecture. Journaliser `mode`, `freshness:same|changed|unknown`, `refresh:incremental|full`, `load:done|failed`.
- [ ] **Step 4: Lancer et voir passer** — `npm test` → tous PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: contrôleur du mode Doublons"`

> **Corrections pré-vol (2026-11-02) — prévalent sur le texte de la tâche :**
> - **Générations (C3).** Chaque `enter()` et chaque `exit()` incrémente un compteur de génération ; toute suite asynchrone (`fetchFreshness`, `loadAll`, `loadNew`, `cache`) vérifie que sa génération est toujours la courante avant de toucher l'état ; sinon elle s'arrête sans rien changer. « Mode actif » = `mode !== 'off'`. Tests : `exit()` pendant `fetchFreshness` → l'état reste `off`, `loadAll` n'est jamais appelé ; `exit()` puis `enter()` pendant une lecture → l'abandon tardif de la première ne touche pas l'état de la seconde.
> - **Une seule lecture (I1).** Une seule promesse en cours pour `enter()` et `refresh()` ensemble : `refresh()` pendant le `loadAll` d'`enter()` rend la même promesse (test : `loadAll` appelé une fois). `enter()` pendant une lecture rend aussi la promesse en cours.
> - **Interception pendant un rafraîchissement (I2).** `shouldIntercept(url)` = mode actif **et** un enregistrement est chargé **et** `classifyUrl(url) !== null`. Pendant `refresh()`, l'ancien enregistrement reste servi ; pendant la toute première lecture (pas d'enregistrement), rien n'est intercepté. Test : pendant `refresh()`, `shouldIntercept('/api/my-collection?page=0')` vaut `true` et `respond` sert l'ancien enregistrement.
> - **Lecture complète vérifiée (I11).** `loadAll` reçoit `expectedTotal: null`. Après lui : `loadNew({ knownIds })` (cartes gagnées pendant la lecture), fusion, puis `fetchFreshness` ; si le nombre d'entrées fusionnées égale le `total` frais → enregistrement ; sinon `IncompleteLoadError({ reason: 'mismatch' })` (traitée comme tout échec de lecture). Test : `loadAll` rend 3, `loadNew` rend 1, `total` frais 4 → `ready` avec 4 entrées.
> - **Compte (I10).** `setLastUserId(userId)` après **chaque** `fetchFreshness` réussi avec un `userId` non `null`. `refresh()` : si le `userId` frais diffère de celui de l'enregistrement → lecture complète pour le nouveau compte, sans fusion (test).
> - **Modèle (M23).** Après chaque `fetchFreshness` réussi, `record.template` = le modèle frais (en mémoire ; persisté au prochain `put`).
> - **Sortie (I6).** `exit()` remet `summary` et `pageCounts` à `null`.
> - **Erreurs (M7, M9).** Les erreurs du chargeur se reconnaissent par `err.name`. Toute autre exception (IndexedDB…) → `error: 'unexpected'` (`ready` si un enregistrement existe, sinon `mode: 'error'`).
> - **`deps` (M8).** `deps.cache` est une instance rendue par `createCache(store)` ; `deps.site` = `{ classifyUrl, parseSiteQuery, buildListResponse, buildStatsResponse, PAGE_SIZE: SITE.PAGE_SIZE }`.

### Task 8: Interface, assemblage et preuve en vrai

**Files:**
- Create: `extension/src/format.js`, `extension/src/log.js`, `extension/src/dom.js`, `extension/src/main.js`, `extension/manifest.json`
- Test: `tests/format.test.js`, `tests/manifest.test.js`

> Réécrite en partie le 2026-11-02 d'après le carnet (sélecteurs, relecture du site, preuve dans le Chrome de Victor).

**Interfaces:**
- Consumes: tout ce qui précède ; sélecteurs et `REFETCH_TRIGGER` du carnet.
- Produces:
  - `format.js` :
    - fonctions `formatSummary({ cards, extra }) -> string`, `formatLoaded(loadedAt: number, now: number) -> string`, `formatProgress({ phase, pagesRead, pageCount }) -> string` ;
    - constantes `LABELS = { option: 'Doublons', refresh: '↻ rafraîchir', loadingNote: "Une seule fois, ensuite c'est gardé en cache.", updating: 'Mise à jour…', stale: 'Ta collection a changé depuis le dernier chargement', incompleteKept: 'Lecture incomplète : affichage du dernier chargement complet.', incompleteNone: 'Lecture incomplète : rien à afficher. Réessaie plus tard.', freshness: "Impossible de joindre wiki-masters pour l'instant." }`.
  - `log.js` : `createLogger(enabled: boolean) -> (event: string, data?: object) => void`, préfixe `[wm-doublons]`. Activé si `localStorage['wm-doublons:debug'] === '1'`.
  - `dom.js` (navigateur seulement ; sélecteurs du carnet, aucun libellé français) :
    - `findSortTrigger(doc) -> HTMLButtonElement | null` : dernier `button[aria-haspopup="listbox"]` de la barre de filtres.
    - `findSortListbox(doc, trigger) -> HTMLUListElement | null` : `ul[role="listbox"]` dont `aria-labelledby` vaut `trigger.id`.
    - `injectOption(listbox, { label, selected: boolean, onSelect })` : clone la dernière option native, libellé `label`, `aria-selected` et style « sélectionné » selon `selected` ; idempotent (marqueur `data-wm-doublons`). À rappeler à **chaque** ouverture (la liste est recréée).
    - `showTriggerLabel(trigger, label | null)` : réécrit le libellé du bouton (`span > span`) tant que le mode est actif, et le réapplique si React le réécrit ; `null` rend la main.
    - `triggerSiteRefetch(doc, { waitSettled: () => Promise<void> }) -> Promise<void>` : choisit une **autre** option native que celle `aria-selected="true"`, attend `waitSettled()` (fin de l'appel liste), puis re-choisit l'option d'origine et attend de nouveau. Ouvre la liste par `trigger.click()` et choisit par `option.click()`.
    - `renderStatus(doc, state: ControllerState, now: number, { onRefresh })` : barre insérée juste avant le bloc de pagination (`STATUS_ANCHOR`), retirée en `mode: 'off'` : progression (`formatProgress` + `LABELS.loadingNote` en `phase: 'full'`, `LABELS.updating` en `phase: 'incremental'`), résumé, `formatLoaded`, bouton `LABELS.refresh`, bandeau `LABELS.stale`, erreurs.
    - `badgeCards(doc, counts: number[])` : badge `×N` sur la i-ème carte de la grille (`GRID` / `CARD`), dans l'ordre ; retire les badges si `counts` est `null`.
    - `watch(doc, onChange)` : `MutationObserver` sur `body` (ouverture de la liste, rendu de la grille, navigation interne).
  - `main.js` : installe l'intercepteur dès son exécution (`document_start`), avec `isWatched` = appel liste, et `onSettled` qui résout les attentes de `triggerSiteRefetch`. Crée cache (`indexedDbStore`), chargeur, contrôleur. Branche :
    - ouverture de la liste de tri → `injectOption` (« Doublons », `selected` = mode actif) ;
    - clic sur « Doublons » → `controller.enter()`, puis, une fois `ready`, `showTriggerLabel(trigger, 'Doublons')` et `triggerSiteRefetch` ;
    - clic sur une option native **en phase de capture**, mode actif → `controller.exit()` et `showTriggerLabel(trigger, null)` **avant** que le site ne réagisse ; si l'option cliquée est celle déjà `aria-selected="true"` (le site ne relira pas), `triggerSiteRefetch` ;
    - « ↻ rafraîchir » → `controller.refresh()`, puis `triggerSiteRefetch` ;
    - chaque état → `renderStatus` ; chaque rendu de la grille en mode actif → `badgeCards(state.pageCounts)` ;
    - départ de `/collection` (navigation interne) → `controller.exit()`.

- [ ] **Step 1: Écrire les tests qui échouent**
  - `formatSummary({ cards: 23, extra: 61 })` → `'23 cartes en double · 61 exemplaires en trop'` ; `({ cards: 1, extra: 1 })` → `'1 carte en double · 1 exemplaire en trop'` ; `({ cards: 0, extra: 0 })` → `'Aucun doublon'`.
  - `formatLoaded(t, t + 30_000)` → `"chargé à l'instant"` ; `+ 5 min` → `'chargé il y a 5 min'` ; `+ 2 h` → `'chargé il y a 2 h'` ; `+ 3 j` → `'chargé il y a 3 j'`.
  - `formatProgress({ phase: 'full', pagesRead: 4, pageCount: 271 })` → `'Lecture de ta collection… page 4 / 271'` ; `pageCount: null` → `'Lecture de ta collection… page 4'` ; `phase: 'incremental'` → `'Mise à jour… page 1'`.
  - `tests/manifest.test.js` vérifie le manifeste :
    - `manifest_version === 3` ;
    - un seul content script, avec `world: 'MAIN'`, `run_at: 'document_start'` et `matches` qui vaut exactement `['https://www.wiki-masters.com/*']` ;
    - pas de `permissions` ni de `host_permissions` ;
    - chaque fichier de `js` existe, et `main.js` vient en dernier.
- [ ] **Step 2: Lancer et voir échouer** — `npm test` → les nouveaux tests en FAIL.
- [ ] **Step 3: Écrire `format.js`, `log.js` et `manifest.json`.** Manifeste : nom `Doublons pour Wiki Masters (non officiel)`, `version: "0.1.0"`, `js` dans l'ordre `site-api, duplicates, loader, cache, interceptor, controller, format, log, dom, main`.
- [ ] **Step 4: Lancer et voir passer** — `npm test` → tous PASS.
- [ ] **Step 5: Écrire `dom.js` et `main.js`** selon les Interfaces. `main.js` fait un balayage initial puis `watch`.
- [ ] **Step 6: Preuve en vrai, dans le Chrome de Victor** (fil principal). Extension chargée non empaquetée (`chrome://extensions`, mode développeur, dossier `extension/`), journaux actifs (`localStorage['wm-doublons:debug'] = '1'`, puis rechargement). Victor rapporte ce qu'il voit et dépose les journaux dans `probe/out/preuve-*.txt`. Cocher chaque point avec sa preuve :
  1. « Doublons » apparaît dans la liste de tri à chaque ouverture et se sélectionne.
  2. Premier chargement : la progression défile jusqu'à 271 pages (environ 26 min) ; l'onglet Réseau montre des appels un par un, espacés d'au moins 400 ms.
  3. La grille montre une carte par groupe, au rendu du site, avec `×N` ; résumé attendu d'après la sonde : `24 cartes en double · 24 exemplaires en trop` (si la collection n'a pas changé) ; la pagination dit « Page 1 / 1 ».
  4. Un clic sur une carte ouvre la fenêtre habituelle.
  5. Rareté, recherche (`leman`) et étiquette filtrent ; résumé et pagination suivent.
  6. Rechargement de la page puis « Doublons » : vue depuis le cache (`chargé il y a …`), un seul appel de fraîcheur.
  7. « ↻ rafraîchir » : mise à jour incrémentale en quelques appels (`refresh:incremental` au journal), pas 271.
  8. Choisir « Nom » puis « Rareté » : le site redevient normal, aucun `intercept` au journal hors mode ; re-choisir le tri déjà actif en sortant rend aussi la vraie grille.
  9. Une exception forcée dans `respond` (temporairement, via la console) laisse le site fonctionner.
- [ ] **Step 7: Retouches.** Chaque défaut vu en Step 6 est corrigé, testé quand c'est une fonction pure, puis le point est refait.
- [ ] **Step 8: Commit** — `git commit -m "feat: interface du mode Doublons et assemblage de l'extension"`

> **Corrections pré-vol (2026-11-02) — prévalent sur le texte de la tâche :**
> - **Clics programmés (C2).** L'écouteur de capture de `main.js` ignore tout événement avec `event.isTrusted === false`, et ne réagit qu'aux options de la **liste de tri** (`findSortListbox(doc, trigger).contains(event.target)`), jamais à celles d'une autre liste (I5).
> - **Relecture du site (I4).** `triggerSiteRefetch` : appelée hors de l'écouteur (`setTimeout(…, 0)`), et sérialisée (une seule à la fois) ; ferme d'abord la liste si elle est ouverte ; attend l'ouverture de la liste (≤ 2 s, sinon abandon journalisé) ; mémorise le **rang** de l'option `aria-selected="true"` et la retrouve par ce rang à la réouverture (la liste est recréée) ; `waitSettled` a un délai maximal de 15 s. Après un clic sur « Doublons », la liste se ferme (`trigger.click()`).
> - **Fetch d'origine (I3).** `main.js` construit `serialFetch = createSerialFetch({ fetchFn: interceptor.originalFetch.bind(window), … })` ; `fetchFreshness` = `() => site.fetchFreshness(serialFetch)` ; `loadAll` lit `buildPageUrl(page, SITE.LOAD_SORT)` et `loadNew` lit `buildPageUrl(page, SITE.DATE_SORT)`, tous deux via `serialFetch` avec `{ credentials: 'same-origin', signal }`.
> - **Portée (I8).** `shouldIntercept: (u) => location.pathname === '/collection' && controller.shouldIntercept(u)` ; injection seulement sur `/collection`.
> - **Démarrage (I7).** L'intercepteur s'installe tout de suite ; `watch` attend `document.body` (`DOMContentLoaded` si besoin).
> - **Sortie (I6).** À la sortie : `badgeCards(doc, null)` retire tous les badges ; `badgeCards` retire toujours les anciens badges avant d'en poser.
> - **Ancre (I9).** `renderStatus` : avant le bloc de pagination ; s'il n'existe pas, avant la grille ; sinon, après la ligne de filtres. Point de preuve en plus : un filtre qui ne laisse aucun doublon affiche « Aucun doublon ».
> - **Libellé du bouton (M14).** Le texte natif du bouton se déduit à l'exécution (nœud texte égal au libellé de l'option sélectionnée), se mémorise et se restaure à `null`.
> - **Sélecteurs (M15, M16 bis).** Comparer `aria-labelledby` à `trigger.id` par égalité d'attributs (pas de sélecteur CSS construit avec l'`id`). Ignorer les `button[aria-haspopup="listbox"]` situés dans `[role="dialog"]` ; prendre le dernier de la ligne qui contient le champ texte de recherche de la page.
> - **DOM (M19).** `injectOption`, `renderStatus`, `badgeCards` sont idempotents et ignorent leurs propres mutations ; nœuds construits par `createElement` / `textContent`, jamais `innerHTML` ; retirer les `id` des options clonées ; ne jamais modifier l'`aria-selected` des options natives.
> - **Console (M17).** `main.js` publie `globalThis.__wmDoublons.controller` et passe `respond: (u) => globalThis.__wmDoublons.controller.respond(u)` (résolu à l'appel), pour que le point 9 de la preuve soit faisable.
> - **Libellés (M9, M10).** `LABELS.unexpected = 'Erreur inattendue : le site reste utilisable.'` ; `freshnessUnknown` affiche `LABELS.freshness` à côté de la date. `renderStatus` n'ajoute pas `LABELS.updating` en plus de `formatProgress` ; test : `formatProgress({ phase: 'incremental', pagesRead: 1, pageCount: null })` → `'Mise à jour… page 1'`.
> - **Ordre des steps (I12).** Step 4 lance seulement `node --test tests/format.test.js` ; le test du manifeste passe à la fin du Step 5, quand `dom.js` et `main.js` existent (`npm test` → tous PASS).
> - **Preuve (M20).** Ajouter au Step 6 : recherche `coeur` comparée au site ; totaux par rareté sous une recherche comparés au site.

### Task 9: Publication (fil principal, avec Victor)

**Files:**
- Create: `README.md`, `PRIVACY.md`, `store/listing.md`, `extension/icons/icon128.png`, `tools/package.sh`
- Modify: `extension/manifest.json` (`icons`, `version: "1.0.0"`)

**Interfaces:**
- Produces: `dist/wm-doublons-<version>.zip`, avec `manifest.json` à la racine du zip.

- [ ] **Step 1: Textes.** Écrire les trois fichiers :
  - `README.md` : ce que fait l'extension, installation depuis le store, limites connues (premier chargement long : environ 4 s par page de 50 cartes côté serveur, soit environ 26 min pour 13 500 cartes ; un échange un-contre-un de même rareté n'est vu qu'au prochain « ↻ rafraîchir » ; Chromium seulement), mention « non officiel ».
  - `PRIVACY.md` : l'extension lit la collection du joueur sur wiki-masters.com ; les données restent dans le navigateur ; rien n'est transmis, vendu ni partagé.
  - `store/listing.md` : description courte et longue, justification d'usage unique, déclaration d'usage des données.
- [ ] **Step 2: Icône et paquet.** Ajouter une icône PNG de 128 × 128 px dans `extension/icons/`, déclarée dans le manifeste. Écrire `tools/package.sh`, qui zippe le contenu de `extension/` dans `dist/`. Vérifier : `unzip -l dist/wm-doublons-1.0.0.zip` liste `manifest.json` à la racine. Lancer `npm test` : tous PASS.
- [ ] **Step 3: Captures pour la fiche (1280 × 800).** Victor les fait dans son Chrome, en mode Doublons. Victor valide les captures avant usage : elles montrent sa collection.
- [ ] **Step 4: Commit** — `git commit -m "docs: README, confidentialité et fiche du store"`
- [ ] **Step 5: Dépôt GitHub.** Demander l'accord de Victor (nom du dépôt, visibilité publique) avant `gh repo create` et le premier `push`.
- [ ] **Step 6: Soumission par Victor.** Victor crée son compte développeur Chrome Web Store (5 $) et téléverse le zip. Il remplit la fiche depuis `store/listing.md`, avec l'URL de `PRIVACY.md` sur GitHub, puis soumet. Claude ne soumet rien.

> **Corrections pré-vol (2026-11-02) — prévalent sur le texte de la tâche :**
> - **Historique (I13).** Avant le premier `push` : l'historique contient le préfixe de 8 caractères du `user_id` de Victor (exemple de la spec, commits `9a9ecf8` à `6274536`, masqué depuis `19abc53`). Proposer à Victor, avec AskUserQuestion : pousser un historique réécrit (un seul commit initial) ou tel quel. Rien n'est poussé avant sa réponse.
> - **README (M24).** « un échange un-contre-un est vu au prochain ↻ » suppose qu'une carte reçue a un nouvel `id` et un `obtained_at` récent : l'écrire comme hypothèse non vérifiée.
> - **Commits (M13).** Chaque tâche fait un `git add` explicite de ses fichiers ; jamais `git add -A` (un `test.json` non suivi traîne à la racine, à Victor).
