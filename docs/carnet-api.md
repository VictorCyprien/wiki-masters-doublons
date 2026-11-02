# Carnet de sonde — wiki-masters.com, page collection

Sonde faite le 2026-11-02 dans le Chrome de Victor (console DevTools), son compte, 13 522 entrées. Scripts dans `probe/`, résultats bruts (sans secret, `user_id` masqué en `user-A`) dans `probe/out/`.

## Faits observés (2026-11-02)

### API

- Page : `/collection`. Son URL ne change jamais (tri, page, recherche, filtres) : tout passe par des appels `fetch`.
- Chaque changement de tri, de page ou de filtre déclenche **deux** appels, en parallèle :
  - liste : `GET /api/my-collection?sort=<tri>[&q=<recherche>][&rarity=<R>][&tag_id=<uuid>]&page=<n>&stats=0`
  - totaux : `GET /api/my-collection/stats?sort=<tri>[&q=…][&rarity=…][&tag_id=…]`
- Authentification : cookies de session, aucun en-tête particulier. Un `fetch` same-origin depuis la page réussit (H1).
- Réponse liste (`stats=0`) : `{ collection: Entry[50], total: null, rarityCounts: {}, tagOptions: [], pendingTradeCardIds: [] }`. Avec `stats=1` : `total` et `rarityCounts` remplis, `tagOptions` aussi.
- Réponse totaux : `{ total: 13522, totalUnique: 13498, rarityCounts: { C: 9643, L: 9, R: 850, PC: 2635, SR: 335, UR: 50 }, tagOptions: [{ id, user_id, name, color, created_at, cardCount }] }`. Avec `rarity=L` : `total: 9`, `totalUnique: null`, `rarityCounts` inchangé (toutes raretés).
- Le site calcule « Page 1 / N » avec `N = ceil(total / 50)` de l'appel totaux.
- Valeurs de tri : Rareté `rarity`, Nom `name`, Favoris `starred`, Date d'ajout `added`.
- Hébergement Vercel (`x-vercel-cache: MISS`, `cache-control: public, max-age=0, must-revalidate`). Aucun en-tête de limite de débit (`RateLimit-*`, `Retry-After`) observé ; aucun 429 sur environ 300 appels espacés de 400 ms.
- **Lenteur** : 1,7 à 3,7 s par page lors des premières mesures ; 4,4 s en moyenne et 9,2 s au maximum pendant la lecture complète (271 pages en 1 548 s, soit environ 26 min).

### Entrées

- Forme : `{ id, card: { id, atk, def, lang, rarity, q_score, category, image_url, pageviews, created_at, hide_image, wikipedia_url, wikipedia_title }, tags, count, card_id, starred, user_id, is_shiny, obtained_at }`.
- Lecture complète : 13 522 entrées, 13 522 `id` uniques, **13 498 `card_id` uniques**, somme des `count` = 13 522, **`count` = 1 pour toutes les entrées**, 0 shiny, un seul `user_id`.
- 24 `card_id` apparaissent dans deux entrées chacune (toutes deux normales). `totalUnique` = nombre de `card_id` distincts. **Un exemplaire supplémentaire est une entrée supplémentaire**, pas un `count` plus grand.
- `tags` : tableau d'objets `{ id, name, color, user_id, created_at }`.

### Recherche et filtres

- Recherche `q` : le total serveur égale, sur 6 requêtes (`Léman`, `leman`, `australienne`, `eman`, `Paris`, `ACTRICE`), le nombre d'entrées dont le titre **ou** la catégorie contient la requête, **sans tenir compte de la casse ni des accents** (NFD, diacritiques retirés). Avec les accents, 2 écarts sur 6 ; titre seul, 6 écarts sur 6.
- Étiquette `tag_id=<uuid>` : total serveur = entrées dont `tags[].id` vaut l'uuid (1 = 1).
- Rareté `rarity=<R>` : une seule valeur vue (puces exclusives ou non : non vérifié).
- Aucun tri ni filtre serveur sur `count` (`sort=count`, `-count`, `duplicates`, `quantity`, `min_count=2`, `duplicates=1`, `count_gte=2` : réponses identiques au tri par défaut).
- Aucun paramètre de taille de page (`limit`, `per_page`, `size`, `page_size`, `pageSize` = 200 : toujours 50).
- Ordre stable : `rarity` et `name` (page 100 lue deux fois) ; `added` (pages 0 et 1 lues deux fois), `obtained_at` décroissant, pages enchaînées. Plusieurs entrées peuvent partager le même `obtained_at` (ouverture d'un paquet).

### Page

- Next.js (app router). Cartes sans nombre d'exemplaires affiché.
- Liste déroulante de tri : `button[aria-haspopup="listbox"]` (le **dernier** des deux de la barre de filtres ; le premier est celui des étiquettes), `aria-controls` vers la liste. La liste est un `ul[role="listbox"]` ajouté à `body` (position fixe), **recréé à chaque ouverture**, `aria-labelledby` = `id` du bouton. Options : `li[role="none"] > button[role="option"][aria-selected]`, libellé dans `span > span`. Les `id` sont générés par React (`_r_a_`) : instables.
- Grille : `div.flex.flex-wrap.justify-center.gap-3`, 50 enfants `div.relative.isolate.group` (une carte chacun). Pagination : un `div` contenant « ← Précédent », un `span` « Page x / y », « Suivant → ».
- Clic sur une carte : une fenêtre de détail s'ouvre par-dessus la page.

### Interception (sonde 5)

- `window.fetch` remplacé depuis la console : les réponses substituées (3 cartes, `total: 3`) sont affichées par le site (3 cartes, « Page 1 / 1 ») ; la fenêtre de carte s'ouvre normalement ; une fois l'interception coupée, la vraie grille et « Page 1 / 271 » reviennent.
- Un élément « Doublons (test) » ajouté à la liste ouverte reste visible et cliquable ; il disparaît quand la liste est recréée.
- Re-choisir le tri déjà actif : **aucun appel**. Choisir un autre tri puis revenir : un couple d'appels à chaque changement (pas de cache côté client). Basculer une puce de rareté deux fois : idem.

## Verdicts des hypothèses de la spec

| # | Verdict | Résumé |
|---|---|---|
| H1 | tient | Cookies de session, `fetch` same-origin suffit. |
| H2 | tient | Base 0, 50 par page, fin = `ceil(total / 50)` (appel totaux), ordre stable. |
| H3 | **tombe** | `count` toujours 1 ; un doublon = plusieurs entrées de même (`card_id`, `is_shiny`). Nouvelle règle tranchée par Victor (spec, « Amendements »). |
| H4 | expliquée | Pas de carte non possédée : la collection de Victor compte vraiment 13 522 entrées. |
| H5 | tombe | Aucun tri ni filtre serveur sur `count`. |
| H6 | tombe | Aucune taille de page acceptée. |
| H7 | tient | Le site affiche les réponses substituées, clic et pagination compris. |
| H8 | tient | Recherche exacte reproductible ; étiquette par `tag_id` ; rareté par `rarity`. |
| H9 | observée | Ni 429 ni en-tête de débit sur environ 300 appels à 400 ms ; serveur lent (4,4 s / page). |
| H10 | tient | `stats=1` ajoute `total`, `rarityCounts`, `tagOptions` à la réponse liste. |
| H11 | tient | Choix injecté visible et cliquable ; à réinjecter à chaque ouverture. |
| H12 | déduite | `total` compte les entrées, donc les exemplaires : un exemplaire gagné ou perdu le change. Non observé sur un vrai changement. Limite : un échange un-contre-un de même rareté ne change ni `total` ni `rarityCounts`. |
| H13 | tient, en partie | Contrôles repérables sans libellé (rôles ARIA, ordre des boutons) ; grille et carte seulement par classes Tailwind. |
| H14 | sans objet | Preuves dans le Chrome de Victor. |

## Valeurs pour le code

| Clé | Valeur |
|---|---|
| `LIST_KEY` | `collection` |
| `TOTAL_KEY` | `total` (`null` en `stats=0` ; rempli en `stats=1` et dans l'appel totaux) |
| `PAGE_COUNT_KEY` | `null` (le site calcule `ceil(total / 50)`) |
| `PAGE_BASE` | `0` |
| `PAGE_SIZE` | `50` |
| `LOAD_PAGE_SIZE_PARAM` / `LOAD_PAGE_SIZE` | `null` |
| `LOAD_SORT` | `rarity` |
| `DATE_SORT` | `added` (plus récentes d'abord) |
| `STOP_RULE` | `pageCount` = `ceil(total / 50)`, page vide en garde-fou |
| `STATS_PATH` | `/api/my-collection/stats` (mêmes paramètres de filtre, sans `page` ni `stats`) |
| `SEARCH_PARAM`, `TAGS_PARAM`, `RARITY_PARAM` | `q`, `tag_id` (un uuid), `rarity` (une valeur vue ; accepter aussi plusieurs, séparées par `,` ou répétées) |
| `SEARCH_RULE` | `exact` : `normalize(q)` sous-chaîne de `normalize(card.wikipedia_title)` ou de `normalize(card.category)`, `normalize` = minuscules + NFD + diacritiques retirés |
| `TAG_MATCH` | `entry.tags.some(t => t.id === tag_id)` |
| `FRESHNESS_URL` / `FRESHNESS_FIELD` | `/api/my-collection?sort=rarity&page=0&stats=1` / `total + '|' + JSON.stringify(rarityCounts)` |
| `TRANSPORT` | `fetch` |
| `COUNT_SHOWN_BY_SITE` | `false` |
| `REFETCH_TRIGGER` | choisir un **autre** tri natif, puis revenir au tri courant (un couple d'appels à chaque fois) ; re-choisir le tri courant ne déclenche rien |
| `SORT_DROPDOWN` | dernier `button[aria-haspopup="listbox"]` de la barre de filtres |
| `SORT_OPTION` | dans `ul[role="listbox"][aria-labelledby=<id du bouton>]` (enfant de `body`) : `li[role="none"] > button[role="option"]`, `aria-selected`, libellé `span > span` |
| `GRID` / `CARD` | parent commun des cartes / enfants `div.relative.isolate.group`, dans l'ordre de la réponse |
| `STATUS_ANCHOR` | juste avant le bloc de pagination (le `div` qui contient le `span` « x / y » entre deux boutons) |
| `INJECTION` | `extension` (Chrome de Victor, non empaquetée) |
