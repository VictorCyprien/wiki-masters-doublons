# Doublons pour Wiki Masters (non officiel)

Une extension Chrome qui retrouve tes cartes en double sur [Wiki Masters](https://www.wiki-masters.com).

> Extension **non officielle**, faite par Victor Cyprien. Elle n'a aucun lien avec Wiki Masters.

Le site ne sait pas trier les cartes que tu as en plusieurs exemplaires. Avec l'extension, un choix « Doublons » apparaît dans le menu de tri de ta collection.

## Ce qu'elle fait

- Ajoute « Doublons » au menu de tri de la page `/collection`.
- Montre une seule carte par doublon, avec un badge `×N` (le nombre d'exemplaires).
- La recherche, les étiquettes et les raretés marchent comme d'habitude en mode Doublons.
- Un clic sur une carte fait la même chose que sur le site.
- Affiche un résumé : « N cartes en double · M exemplaires en trop ».
- Un bouton « ↻ rafraîchir » rattrape tes nouvelles cartes (et relit tout si une carte est partie).

Un doublon, c'est la même carte en plusieurs exemplaires. Une carte brillante (shiny) compte à part : une brillante et une normale ne s'additionnent pas.

## Installation

Depuis le Chrome Web Store : _lien à venir après la publication_.

Pour essayer le code à la main : télécharge ce dépôt, ouvre `chrome://extensions`, active le « Mode développeur », clique sur « Charger l'extension non empaquetée » et choisis le dossier `extension/`.

## Utilisation

1. Ouvre ta collection sur wiki-masters.com.
2. Dans le menu de tri, choisis « Doublons ».
3. La première fois, l'extension lit toute ta collection. Compte environ 2 minutes pour 1 000 cartes (jusqu'à 26 minutes pour 13 500 cartes). Garde l'onglet visible pendant ce temps.
4. Ensuite, c'est immédiat : ta collection est gardée dans ton navigateur.

## Limites connues

- **Première lecture longue.** Environ 2 minutes pour 1 000 cartes. Si le serveur coupe en route, la lecture reprend là où elle s'est arrêtée (les pages déjà lues sont gardées 24 heures).
- **Onglet caché = plus lent.** Chrome ralentit les onglets cachés, la première lecture prend donc plus de temps. Le résultat n'est jamais faux, seulement plus long.
- **Étoiles et étiquettes changées ailleurs.** Si tu poses ou retires une étoile ou une étiquette depuis un autre appareil ou un autre navigateur, l'extension ne le voit qu'à la prochaine lecture complète. Même chose si tu as deux onglets ouverts en même temps sur ta collection.
- **Échanges un-contre-un.** Un échange d'une carte contre une autre de même rareté ne change pas tes totaux. Il devrait être vu au prochain « ↻ rafraîchir », mais je ne l'ai pas vérifié.
- **Changement de compte.** Si tu changes de compte au moment où le site ne répond pas, l'extension peut montrer brièvement la collection du compte précédent, jusqu'au prochain « ↻ rafraîchir ».
- **Chrome seulement.** Chrome et les navigateurs Chromium récents (version 111 ou plus).
- **Si le site change.** Si Wiki Masters change son fonctionnement, l'extension peut cesser de marcher. Elle se retire alors sans casser le site (message « Erreur inattendue : le site reste utilisable. »).

## Respect du site

L'extension fait une requête à la fois, avec au moins 400 ms entre deux requêtes, même si tu as plusieurs onglets ouverts. Si le serveur ne répond pas, elle réessaie 3 fois au plus, après 5, 15 puis 45 secondes.

## Vie privée

Ta collection est lue sur wiki-masters.com avec ta session, puis gardée dans le stockage local de ton navigateur. Elle n'est envoyée nulle part. Pas de serveur à nous, pas de statistiques, pas de suivi. Le détail est dans [PRIVACY.md](PRIVACY.md).

## Pour les curieux

- Aucune permission demandée. Un seul script de page, sur `https://www.wiki-masters.com/*`.
- Pas de build, pas de dépendance. Le code est dans `extension/src/`.
- Pour lire les messages de débogage dans la console : `localStorage['wm-doublons:debug'] = '1'` puis recharge la page. Ils ne contiennent aucune donnée sensible.
- Tests : `npm test`. Paquet pour le Store : `npm run package` (écrit `dist/wm-doublons-<version>.zip`).

## Soutenir

L'extension est gratuite et le restera. Si elle te rend service, tu peux m'offrir un café : [Buy Me a Coffee](https://buymeacoffee.com/victorcyprien) ou [tip.md](https://www.tip.md/VictorCyprien) (pourboire en crypto).

## Un souci, une idée

Ouvre une « issue » sur [le dépôt](https://github.com/VictorCyprien/wiki-master-doublons/issues).
