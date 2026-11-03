# Chrome Web Store Listing — Doublons pour Wiki Masters (non officiel)

> Last Updated: 2026-11-03

## Store Listing

**Extension Name**

Doublons pour Wiki Masters (non officiel)

**Short Description**

Trouve tes cartes en double sur Wiki Masters : un choix « Doublons » apparaît dans le tri de ta collection.

(Le tableau de bord la lit dans le champ `description` du manifeste : elle ne se modifie qu'avec une nouvelle version.)

**Detailed Description**

Ajoute un choix « Doublons » dans le menu de tri de ta collection sur Wiki Masters, pour retrouver d'un coup les cartes que tu as en plusieurs exemplaires.

FONCTIONS
• Un nouveau choix « Doublons » dans le menu de tri de ta collection
• Une seule carte par doublon, avec un badge ×N qui indique le nombre d'exemplaires
• La recherche, les étiquettes et les raretés marchent comme d'habitude
• Un résumé en haut : « N cartes en double · M exemplaires en trop »
• Un bouton « ↻ rafraîchir » pour rattraper tes nouvelles cartes
• Une carte brillante (shiny) compte à part de la version normale

COMMENT FAIRE
1. Ouvre ta collection sur wiki-masters.com.
2. Dans le menu de tri, choisis « Doublons ».
3. La première fois, l'extension lit toute ta collection : compte environ 2 minutes pour 1 000 cartes, en gardant l'onglet visible. Ensuite, c'est immédiat.

VIE PRIVÉE
Ta collection est lue sur wiki-masters.com avec ta session, puis gardée dans ton navigateur. Elle n'est envoyée nulle part : pas de serveur, pas de statistiques, pas de suivi. L'extension ne demande aucune permission particulière. Elle repère aussi quand tu mets ou retires une étoile ou une étiquette sur le site, pour garder ses cartes à jour.

ACCÈS AU SITE
Chrome affiche « Lire et modifier tes données sur wiki-masters.com ». C'est nécessaire pour ajouter le choix « Doublons » à la page de ta collection. L'extension ne fonctionne que sur ce site.

À SAVOIR
• Extension non officielle, sans lien avec Wiki Masters, faite par Victor Cyprien.
• Si Wiki Masters change son fonctionnement, l'extension peut cesser de marcher, sans gêner le site.
• Fonctionne avec Chrome 111 ou plus.

SUPPORT
Un souci, une idée ? Ouvre une issue : https://github.com/VictorCyprien/wiki-masters-doublons/issues
L'extension est gratuite. Si elle te rend service, tu peux m'offrir un café depuis sa fenêtre.

Version 1.0.0 : première version.

**Category**

Fun (jeux). Alternative : Productivity.

**Single Purpose**

Ajouter un tri « Doublons » à la page de collection de wiki-masters.com, pour retrouver les cartes que le joueur possède en plusieurs exemplaires.

**Primary Language**

Français

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | extension/icons/icon-128.png |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | store/screenshot-1-doublons.png |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | store/screenshot-2-tri.png |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | store/screenshot-3-fenetre.png |
| Small Promo Tile [RECOMMENDED] | 440×280 | ✅ Ready | store/promo-440x280.png |

### Screenshot Notes

Faites à partir des captures de Victor (sa collection), avec fond sombre et titre ; modèles dans `tools/store-assets/`.
1. « Tous tes doublons d'un coup d'œil » : la collection en mode Doublons, cartes avec badge ×N.
2. « Un choix de plus dans le tri » : le menu de tri ouvert, avec le choix « Doublons ».
3. « Rien à configurer, rien qui sort » : la fenêtre de l'extension (clic sur l'icône).

## Permissions Justification

L'extension ne déclare **aucune** entrée `permissions` ni `host_permissions` dans son manifeste.

| Permission | Type | Justification |
|------------|------|---------------|
| (aucune) | permissions | Aucune permission demandée. |
| (aucune) | host_permissions | Aucune permission d'hôte demandée. |
| Script de contenu sur `https://www.wiki-masters.com/*` | content_scripts | Chrome le présente comme un accès aux données de wiki-masters.com. Il sert à une seule chose : ajouter le choix « Doublons » au menu de tri de la page /collection et afficher les cartes en double. Le script lit la liste des cartes du joueur auprès de wiki-masters.com (même site, avec la session du joueur) pour repérer les doublons, et observe les demandes du site qui ont réussi lors d'un changement d'étoile ou d'étiquette afin de garder la copie locale à jour. Il n'agit que sur la page /collection, et n'a aucun accès à d'autres sites. Aucun code distant n'est chargé. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Oui, en local seulement (rien ne quitte l'appareil).

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | Non | Non | | Non |
| Health info | Non | Non | | Non |
| Financial info | Non | Non | | Non |
| Authentication info | Non (les cookies ne sont pas lus ; aucun jeton ni en-tête n'est gardé) | Non | | Non |
| Personal communications | Non | Non | | Non |
| Location | Non | Non | | Non |
| Web history | Non | Non | | Non |
| User activity | Oui : étoiles et étiquettes posées ou retirées sur le site (demandes réussies observées) | Non | Garder la copie locale de la collection à jour | Non |
| Website content | Oui : la collection du joueur (cartes, nombre d'exemplaires, étoiles, étiquettes, identifiant du compte), lue sur wiki-masters.com et gardée dans le stockage local du navigateur | Non (jamais envoyée ailleurs ; les lectures vont uniquement à wiki-masters.com, le site d'origine) | Trouver et afficher les doublons | Non |

À cocher dans le formulaire : « Website content » et « User activity ». Rien d'autre.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**

https://github.com/VictorCyprien/wiki-masters-doublons/blob/main/PRIVACY.md

(doit être en ligne et accessible avant la soumission)

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name**: Victor Cyprien

**Trader Status (UE)**: Non professionnel (non-trader), déclaré le 2026-11-03 : extension gratuite, projet personnel hors de la micro-entreprise, tips occasionnels. À revoir au transfert vers le compte pro, ou si l'extension entre dans la micro-entreprise (facturation, chiffre d'affaires, version payante).

**Contact Email**: l'adresse pro de Victor (affichée publiquement ; à surveiller). Nom visible : Victor Cyprien.

**Support URL**: https://github.com/VictorCyprien/wiki-masters-doublons/issues

**Homepage URL**: https://github.com/VictorCyprien/wiki-masters-doublons

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-11-03 | Première version : tri « Doublons », badge ×N, résumé, rafraîchir. | Envoyée pour examen le 2026-11-03 (examen approfondi : accès à l'hôte) |

## Test Instructions

Champ « Instructions de test » du tableau de bord (en anglais pour les relecteurs). Ne jamais y mettre les identifiants de Victor.

```
The extension only acts on https://www.wiki-masters.com/collection, for a signed-in player.
1. Sign in to wiki-masters.com (a free account works) and open https://www.wiki-masters.com/collection.
2. In the sort menu, choose "Doublons" (duplicates).
3. The first time, the extension reads the collection page by page and shows its progress. It then shows one card per duplicate, with a ×N badge. A new account with no card owned twice shows "Aucun doublon" (no duplicates).
4. Choosing another sort option returns to the site's normal view.
5. Clicking the toolbar icon opens a small information popup with optional support links.
No permissions are requested, no remote code is loaded, and no data leaves the browser.
```

## Review Notes

### Known Issues / Limitations
- Le script de contenu sur wiki-masters.com est déclaré dans « Accès au site » ; aucune permission déclarée.
- Extension non officielle : le nom contient « (non officiel) » et « Wiki Masters » sert à dire pour quel site elle est faite. Risque de remarque sur la marque : si demandé, répondre qu'elle est indépendante et le dit partout.
- Première lecture longue (environ 2 minutes pour 1 000 cartes) : indiqué dans la description.
- Les liens de soutien (Buy Me a Coffee, tip.md) sont seulement dans la fenêtre de l'extension, ouverts au clic.
- Première publication depuis le compte développeur étudiant de Victor (le compte pro ne passe pas encore la vérification). Transfert prévu vers le compte pro par le formulaire de transfert du Chrome Web Store, avant la fin du compte étudiant.
- Le zip 1.0.0 envoyé garde, dans la fenêtre, le lien « Code source » vers l'ancien nom du dépôt (`wiki-master-doublons`, redirigé par GitHub) ; corrigé sur `develop` pour la version suivante.

### Rejection History
Aucune pour l'instant.
