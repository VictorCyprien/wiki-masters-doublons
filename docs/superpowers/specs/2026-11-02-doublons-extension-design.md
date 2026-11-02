# Vue « Doublons » pour Wiki Masters : extension Chrome — design

Date : 2026-11-02
Statut : en relecture

## Intention

Sur wiki-masters.com, la page collection ne permet pas de trier ni de filtrer les cartes possédées en plusieurs exemplaires. Victor veut **voir ses doublons**, triés du plus grand nombre d'exemplaires au plus petit, directement dans la page collection du site, comme s'il s'agissait d'une fonction native.

L'API du site renvoie déjà le nombre d'exemplaires (`count`) pour chaque carte. Le projet est une extension Chrome, publiée sur le Chrome Web Store, qui exploite ce champ. *(Amendé : `count` vaut toujours 1 ; les exemplaires se comptent en regroupant les entrées, voir « Amendements ».)*

Le script sera partagé avec d'autres joueurs, dont les collections peuvent être bien plus petites ou bien plus grandes que celle de Victor.

## Amendements après la sonde (2026-11-02)

La sonde a fait tomber H3 : `count` vaut toujours 1 et un doublon est une **carte présente en plusieurs entrées**. Victor a tranché la nouvelle règle, l'affichage d'une carte par groupe et le rafraîchissement incrémental ; les sections ci-dessous sont mises à jour. Résultats détaillés : `docs/carnet-api.md`. La recherche du site se reproduit exactement (H8 tient) : le repli « recherche approximative » ne sert plus.

## Objectifs

- Ajouter « Doublons » comme cinquième choix dans la liste déroulante de tri existante (Rareté, Nom, Favoris, Date d'ajout, **Doublons**).
- En mode Doublons, afficher uniquement les cartes possédées en au moins 2 exemplaires, triées par nombre d'exemplaires décroissant. **Règle (Victor, 2026-11-02, après la sonde 3)** : les entrées se regroupent par (`card_id`, `is_shiny`) ; le nombre d'exemplaires N d'un groupe est la somme des `count` de ses entrées ; un doublon est un groupe avec N ≥ 2. (Sur le compte de Victor, chaque exemplaire est une entrée séparée avec `count: 1`.)
- Les cartes affichées ont **exactement le rendu des cartes du site**, plus un badge `×N`. **Une seule carte par groupe** (décision de Victor) : une entrée représentante du groupe ; le clic ouvre la fenêtre de cet exemplaire-là. Un clic sur une carte fait **la même chose que sur le site**.
- Une ligne de résumé au-dessus de la grille : « X cartes en double · Y exemplaires en trop » (X = nombre de groupes en double, Y = somme de N − 1). À droite : date du dernier chargement et bouton « ↻ rafraîchir ».
- En mode Doublons, la recherche (« Rechercher par titre ou catégorie… »), le filtre d'étiquettes (« Toutes les étiquettes ») et les filtres de rareté (L, UR, SR, R, PC, C) continuent de fonctionner, combinés au filtre doublon.
- La pagination du site reflète la liste de doublons filtrée (nombre de pages juste).
- Fonctionner pour des collections de quelques dizaines à plus de 10 000 entrées.

## Non-objectifs

- Échanger, recycler, vendre ou fusionner des cartes.
- Toute écriture vers l'API (le script ne fait que des `GET` sur `my-collection`).
- Mobile, Firefox, Safari. Seuls les navigateurs Chromium (Chrome, Arc, Brave) sont visés pour cette version.
- Fusionner shiny et normale : **une carte shiny et la même carte normale sont deux cartes distinctes**. Un doublon, c'est un groupe (`card_id`, `is_shiny`) d'au moins 2 exemplaires.
- Un serveur, une page séparée.
- Un userscript (Tampermonkey, Violentmonkey) : écarté le 2026-11-02 par Victor, car il oblige chaque joueur à installer un gestionnaire de scripts et à activer une option de Chrome. Une extension du Chrome Web Store s'installe en un clic.

## Anti-objectifs

Le projet est raté, même si la vue Doublons fonctionne, si l'un de ces cas se produit :

1. **Le site casse.** Hors mode Doublons, les tris, filtres, la pagination et les clics du site se comportent autrement que sans le script. Une erreur du script dégrade le site.
2. **Trop d'appels API.** Le script charge le serveur au point de risquer un blocage du compte du joueur.
3. **Résultat faux.** Un doublon manque, un `count` est faux, ou un résultat partiel est affiché comme s'il était complet.

Un premier chargement lent (une minute ou plus pour une grosse collection) est **acceptable**. Victor préfère la politesse envers le serveur à la vitesse.

## Ce que l'on sait

### Faits observés (par Victor, le 2026-11-02)

- Endpoint : `GET https://www.wiki-masters.com/api/my-collection?sort=rarity&page=0&stats=0`.
- Une entrée de la réponse ressemble à ceci (champs utiles) :

  ```json
  {
    "id": "50ea6ed8-…",
    "card": {
      "id": "efef6932-…",
      "atk": 9739, "def": 7973, "lang": "fr", "rarity": "L",
      "category": "actrice australienne",
      "image_url": "https://…",
      "wikipedia_title": "Margot Robbie",
      "wikipedia_url": "https://fr.wikipedia.org/wiki/Margot_Robbie"
    },
    "tags": [],
    "count": 1,
    "card_id": "efef6932-…",
    "starred": false,
    "user_id": "user-A",
    "is_shiny": false,
    "obtained_at": "2026-10-27T17:56:32.52341+00:00"
  }
  ```

  L'enveloppe de la réponse autour de la liste (total, nombre de pages, etc.) n'est pas encore connue.
- Page collection (capture d'écran) : barre de recherche, liste déroulante « Toutes les étiquettes », liste déroulante de tri (Rareté, Nom, Favoris, Date d'ajout), puces de rareté L / UR / SR / R / PC / C, pagination « ← Précédent · Page 1 / 270 · Suivant → ».
- Environ **50 cartes par page**, et **270 pages** sur le compte de Victor, soit environ 13 500 entrées. Victor estimait sa collection à 200–1000 cartes : l'écart n'est pas expliqué.
- La liste déroulante de tri semble être un composant maison, pas un `<select>` natif.

### Hypothèses à vérifier par la sonde

L'API n'est pas documentée. Conformément à la conviction de Victor « Sonde d'abord quand le tiers est mal documenté », le premier lot est une sonde qui vérifie ces hypothèses avant d'écrire le vrai script.

| # | Hypothèse | Si elle tombe |
|---|---|---|
| H1 | L'API s'authentifie par les cookies de session du site ; un appel same-origin depuis la page réussit sans jeton à fabriquer (ou avec un en-tête que le script peut reprendre des appels du site). | **Arrêt**, retour vers Victor. |
| H2 | La pagination est stable : pages indexées à partir de 0, taille fixe, fin détectable (total ou nombre de pages dans l'enveloppe, ou page vide). | Adapter la boucle de lecture ; si la fin n'est pas détectable de façon fiable, retour vers Victor. |
| H3 | Il y a une entrée par couple (`card_id`, `is_shiny`), et `count` est le nombre d'exemplaires de cette version. | Revoir la règle de doublon avec Victor. |
| H4 | Expliquer les 270 pages : l'API renvoie-t-elle des cartes non possédées (`count` = 0) ? | Rien à changer côté design, mais le fait va au carnet. *(Expliquée : pas de carte non possédée.)* |
| H5 | L'API accepte-t-elle un tri ou un filtre côté serveur sur `count` (ex. `sort=count`) ? | Si oui : utiliser le serveur plutôt que tout lire, le script devient bien plus léger. Si non : lecture complète + cache, comme décrit ici. |
| H6 | L'API accepte-t-elle un paramètre de taille de page (ex. `limit`, `per_page`, `size`) pour réduire le nombre d'appels ? | Si non : 50 par page. |
| H7 | Le script de l'extension, exécuté dans le contexte de la page (content script avec `world: "MAIN"`, `run_at: "document_start"`), peut intercepter l'appel du site à `my-collection` (`fetch` ou `XMLHttpRequest`) et lui substituer une réponse ; le site affiche alors ces cartes lui-même (rendu, clic, pagination). | **Repli décidé** : le script dessine sa propre grille en clonant le HTML d'une carte rendue par le site et en reproduisant son comportement au clic. |
| H8 | Relever comment le site encode recherche, étiquettes et rareté dans la requête, et la règle exacte de la recherche (titre et/ou catégorie, casse, accents, sous-chaîne). | Le script doit reproduire ces règles sur son cache ; sans elles, le résultat filtré serait faux. |
| H9 | Comportement du serveur face à des appels rapprochés (429, `Retry-After`, 5xx). | Ajuster l'espacement. |
| H10 | Ce que renvoie `stats=1`. | Information seulement. |
| H11 | La liste déroulante de tri accepte qu'on y injecte un choix ; on peut détecter sa sélection, afficher « Doublons » comme libellé sélectionné, et revenir proprement aux autres tris. | Repli : un bouton « Doublons » juste à droite de la liste déroulante. |
| H12 | Il existe un signal de fraîcheur peu coûteux (un seul appel) qui change quand un `count` change, pas seulement quand une nouvelle carte entre : par exemple un total d'exemplaires dans `stats=1`, ou le `obtained_at` le plus récent sous le tri « Date d'ajout » s'il est mis à jour à chaque nouvel exemplaire. | Repli : comparer le seul total d'entrées. La limite (un exemplaire de plus d'une carte déjà possédée passe inaperçu) est alors écrite dans le README et rappelée par la date « chargé il y a … ». |
| H13 | Les contrôles de la page (liste déroulante de tri, recherche, étiquettes, puces de rareté) se repèrent par la structure de la page, sans dépendre de leurs libellés français. | Repérer par libellés français, et le noter comme limite dans le README. |
| H14 | *Sans objet depuis le 2026-11-02 : les preuves se font dans le Chrome de Victor, extension chargée non empaquetée.* Verdict peut lancer son navigateur avec l'extension non empaquetée chargée. | Pendant le développement, injecter le code du script dans la page via Verdict (`verdict js`) avant de choisir « Doublons » : l'interception doit seulement être en place avant le prochain appel du site à `my-collection`. Le comportement au tout premier chargement de la page est alors vérifié par Victor dans son Chrome. |

La sonde journalise des métadonnées (statuts HTTP, formes des réponses, noms de paramètres, en-têtes utiles), jamais de cookie ni de jeton. Ses résultats vont dans un carnet versionné du dépôt (`docs/carnet-api.md`), faits datés d'un côté, hypothèses de l'autre.

## Comportement attendu

### Entrée

« Doublons » apparaît comme cinquième choix de la liste déroulante de tri. Le sélectionner active le mode Doublons ; choisir un autre tri le désactive et rend la main au site sans trace.

### Premier chargement

Si aucun cache n'existe pour le compte, le script lit toutes les pages de `my-collection`, une à la fois, en les espaçant. Il affiche une progression (« Lecture de ta collection… page 4 / 270 ») et précise que c'est une fois, ensuite gardé en cache.

### Vue chargée

- Ligne de résumé en haut : « X cartes en double · Y exemplaires en trop », puis « chargé il y a … · ↻ rafraîchir ».
- Grille de cartes au rendu natif du site : une carte par groupe en double, triée par N décroissant, avec badge `×N`.
- Les totaux du résumé suivent les filtres actifs (recherche, étiquettes, rareté).

Maquette de référence : `.superpowers/brainstorm/…/content/vue-a-v2.html` (non versionnée). L'apparence finale suit le style du site.

### Filtres

Recherche, étiquettes et rareté s'appliquent sur le cache, avec les mêmes règles que le site (relevées en H8). La pagination affichée correspond à la liste filtrée.

*(Caduc depuis la sonde : la règle exacte est reproduite.)* Si la sonde ne parvient pas à reproduire exactement la règle de recherche du site (décision de Victor) : la recherche en mode Doublons devient une recherche locale approchée (sous-chaîne sur titre et catégorie, sans tenir compte de la casse ni des accents), et la vue l'indique (« recherche approximative »). Pas d'appel serveur supplémentaire pour la recherche.

### Cache

- Stocké localement dans le navigateur, dans un stockage sans la limite de 5 Mo de `localStorage` (13 500 entrées peuvent la dépasser) : IndexedDB, ou `chrome.storage.local` avec la permission `unlimitedStorage`, au choix du constructeur.
- Rattaché au compte (`user_id`) : deux comptes sur le même navigateur ne se mélangent pas.
- N'expire jamais seul. Le bouton « ↻ rafraîchir » le met à jour.
- **Rafraîchissement incrémental** (décision de Victor, 2026-11-02) : une lecture complète prend environ 26 minutes sur la collection de Victor (13 522 entrées, 4,4 s par page en moyenne). « ↻ rafraîchir » lit donc les pages sous le tri « Date d'ajout » (les plus récentes d'abord) jusqu'à retomber sur une entrée déjà en cache, et ajoute les nouvelles. Puis il compare le nombre d'entrées du cache au `total` du serveur : s'ils diffèrent (une carte est partie : échange, vente…), il relance une lecture complète. La lecture complète n'a donc lieu qu'à la première ouverture et quand une carte a quitté la collection.
- Garde la date du dernier chargement complet.

### Fraîcheur (décision de Victor : vérification légère)

À chaque entrée en mode Doublons avec un cache existant, le script fait **un seul appel** pour lire le signal de fraîcheur (H12) et le compare à celui enregistré avec le cache. S'il a changé, la vue affiche les doublons du cache avec un bandeau « Ta collection a changé depuis le dernier chargement » et le bouton « ↻ rafraîchir ». Le script ne relance jamais de lecture complète sans clic. Si l'appel de vérification échoue, la vue s'affiche quand même, avec la date du cache.

### Erreurs

- Sur 429 ou 5xx : le script respecte `Retry-After` s'il est présent, sinon il s'arrête. Il ne martèle jamais.
- Une lecture incomplète (page en échec, total lu ≠ total annoncé par l'API) **n'est jamais affichée comme un résultat complet**. Le script le dit clairement et garde l'ancien cache s'il en existe un.
- Toute exception du script est attrapée. Le site doit continuer à marcher comme sans le script.

### Hors mode Doublons

Chaque appel du site passe tel quel, sans modification ni retard. Le script n'ajoute que le choix « Doublons » dans la liste déroulante.

## Contraintes

- **Support** : extension Chrome Manifest V3, pour les navigateurs Chromium (Chrome, Arc, Brave installent depuis le Chrome Web Store).
- **Livrable** : un dossier d'extension en JavaScript simple, sans étape de build, zippé pour le store.
- **Permissions** : le strict minimum. Accès au seul site `https://www.wiki-masters.com/*`. Pas de permission `tabs`, `history` ni accès à d'autres sites. Aucun code chargé à distance (interdit en Manifest V3 de toute façon).
- **Réseau** : uniquement des `GET` same-origin vers `wiki-masters.com`. Aucun appel vers un tiers, aucune donnée envoyée ailleurs, aucun mot de passe ni jeton stocké.
- **Politesse** : appels séquentiels, jamais en parallèle, espacés d'environ 300 à 500 ms.
- **Distribution** : Chrome Web Store, sous le compte développeur de Victor (5 $ une fois ; Victor crée et paie le compte lui-même). Mises à jour automatiques par le store : `version` du manifest incrémentée à chaque publication, chaque version relue par Google (de quelques heures à quelques jours).
- **Fiche du store** : description, icône 128 px, captures d'écran, déclaration d'usage des données, et une page de confidentialité publique (hébergée sur le dépôt GitHub). Elle dit : l'extension lit la collection du joueur sur wiki-masters.com ; les données restent dans le navigateur ; rien n'est transmis, vendu ni partagé.
- **Code source** : dépôt GitHub public, avec un README (installation depuis le store, limites connues).
- **Soumission** : Claude prépare le zip, les textes de la fiche et la page de confidentialité. **Victor soumet lui-même** depuis son compte : c'est une publication, donc une action publique.

## Accès au site et tests

- **Accès** (décision de Victor, révisée le 2026-11-02) : Cloudflare Turnstile refuse la connexion dans le navigateur automatisé de Verdict, et on ne cherche pas à le contourner. La sonde et les preuves de bout en bout se font donc **dans le Chrome de Victor**, où il est connecté normalement : Claude écrit de courts scripts que Victor colle dans la console DevTools ; chacun ne collecte que des métadonnées et rend son résultat par `copy(...)`, que Victor dépose dans `probe/out/` avec `! pbpaste > probe/out/<étape>.json`. Ce qui se voit à l'écran, Victor le décrit ou le capture. Ni cookie ni jeton ne transitent.
- **Un seul compte** (celui de Victor, environ 270 pages). Conséquences :
  - H9 (limite de débit) est **observée sans être provoquée** : aucune rafale volontaire pour déclencher un 429. L'espacement de 300 à 500 ms reste une valeur prudente, non validée par un test de charge.
  - La séparation du cache par `user_id` et le cas des petites collections se testent hors navigateur, sur des données d'exemple (fonctions pures), pas sur un second compte réel.
  - La lecture complète des 270 pages se fait le moins souvent possible pendant le développement : une fois pour la sonde si nécessaire, puis depuis le cache.
- **Charger l'extension pendant le développement** : voir H14. Vérification finale par Victor dans son propre Chrome, avec l'extension chargée en mode développeur, avant la soumission au store.
- **Langue** : le texte affiché par le script est en français pour la v1 ; le repérage des contrôles ne dépend pas de la langue du site si H13 tient.

## Lots proposés

1. **Sonde** : vérifier H1 à H13 dans le Chrome de Victor (console DevTools), remplir le carnet. Arrêt si H1 tombe ; si H2 ou H3 tombe, retour vers Victor.
2. **Script** : le mode Doublons complet, vérifié en vrai sur le site avec le compte de Victor.
3. **Publication** : dépôt GitHub public, README, zip de l'extension, textes de la fiche du store, page de confidentialité. Soumission au Chrome Web Store par Victor.

## Décisions prises par Claude (à vérifier par Victor)

- Interception de l'appel API pour que le site affiche lui-même les doublons (H7), avec repli sur le clonage du HTML d'une carte.
- Cache local par `user_id`, sans expiration automatique.
- Extension en JavaScript simple sans étape de build, permission limitée à `wiki-masters.com`.
- Soumission au store faite par Victor, jamais par Claude.
- Espacement de 300 à 500 ms, arrêt sur 429/5xx, `Retry-After` respecté.
- Lecture incomplète jamais affichée comme complète.
- Repli sur un bouton à côté de la liste déroulante si l'injection d'un choix échoue (H11).
- Signal de fraîcheur cherché par la sonde (H12), avec repli sur le total d'entrées et la limite écrite dans le README.
- Contrôles repérés par la structure de la page plutôt que par leurs libellés (H13) ; texte du script en français pour la v1.
- Avec un seul compte : limite de débit jamais provoquée ; isolation du cache et petites collections testées sur données d'exemple.

## Laissé au constructeur

- L'espacement exact dans la fourchette, le nom du dépôt, la licence.
- L'organisation interne du code et le schéma du cache, IndexedDB ou `chrome.storage.local`.
- L'icône de l'extension et les captures de la fiche du store.
- Le style exact du badge `×N` et de la ligne de résumé, en cohérence avec le site.
- La stratégie de test (fonctions pures testables hors navigateur ; vérification de bout en bout sur le vrai site).
