# Politique de confidentialité : Doublons pour Wiki Masters (non officiel)

Dernière mise à jour : 2026-11-03

Auteur : Victor Cyprien. Cette extension est non officielle et n'a aucun lien avec Wiki Masters.

En bref : tout reste dans ton navigateur. Rien n'est envoyé à l'auteur ni à un tiers. Il n'y a ni serveur, ni statistiques, ni suivi.

## Ce que l'extension lit

- **Ta collection.** Sur wiki-masters.com, l'extension demande la liste de tes cartes au site, comme le fait la page elle-même, avec ta session ouverte. L'extension ne lit pas tes cookies : c'est le navigateur qui les joint à la demande, comme pour n'importe quelle page du site. Ces demandes vont uniquement à wiki-masters.com.
- **Tes étoiles et étiquettes, quand tu les changes.** L'extension regarde les demandes du site qui ont **réussi** quand tu mets ou retires une étoile (favori) ou une étiquette sur une carte. Elle en retient l'adresse, la méthode, le contenu et le statut, pour garder ses cartes à jour. Elle ne regarde jamais les en-têtes des demandes, ni les clés ou jetons d'accès. Cette information ne sert qu'à mettre à jour la copie locale de ta collection et n'est pas conservée en dehors d'elle.

## Où c'est gardé

Dans le stockage local de ton navigateur (la base IndexedDB du site wiki-masters.com), séparément pour chaque compte. On y trouve les cartes de ta collection telles que le site les donne (identifiants des cartes, nombre d'exemplaires, étoiles, étiquettes) et l'identifiant de ton compte Wiki Masters, qui sert à garder une copie par compte. Rien n'est stocké ailleurs.

## À quoi ça sert

Uniquement à trouver tes doublons, à les afficher et à retrouver ta collection instantanément à la visite suivante.

## Ce qui n'est pas fait

- Aucune donnée n'est envoyée à l'auteur, à un serveur de l'extension ou à un tiers. Il n'y a pas de serveur de l'extension.
- Aucune donnée n'est vendue, partagée ni utilisée pour autre chose que le fonctionnement de l'extension.
- Pas de statistiques d'usage, pas de publicité, pas de suivi, pas de service tiers.
- Pas de code chargé depuis Internet.
- L'extension ne demande aucune permission du navigateur.

## Journal de débogage

Il est éteint par défaut. Si tu l'allumes toi-même (`localStorage['wm-doublons:debug'] = '1'`), l'extension écrit des messages dans la console du navigateur, sur ton ordinateur. Ils ne contiennent ni cookie, ni jeton, ni en-tête.

## Fenêtre de l'extension et liens de soutien

La fenêtre qui s'ouvre au clic sur l'icône contient deux liens de soutien (Buy Me a Coffee et tip.md) et un lien vers le code source. Ils s'ouvrent seulement si tu cliques dessus, et l'extension ne leur transmet aucune donnée. Une fois sur ces sites, leurs propres règles s'appliquent.

## Conserver, effacer

La copie locale reste dans ton navigateur jusqu'à ce que tu l'effaces. Pour la supprimer : supprime l'extension, ou efface les données du site wiki-masters.com dans les paramètres de Chrome (Confidentialité et sécurité, Paramètres des sites, Afficher les autorisations et données stockées sur les sites).

## Changements

Si la façon de traiter les données change, cette page sera mise à jour avant la sortie de la version concernée, et la date ci-dessus changera.

## Contact

Une question sur la vie privée : ouvre une issue sur https://github.com/A-REMPLACER/wiki-masters-doublons/issues
