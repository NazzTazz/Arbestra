# Paysage visible, connaissance acquise — handoff

## Implémentation du 5 octobre 2026 — à valider visuellement

Correction implémentée sur `main`, base `ffb6707`, sans commit/push. Worktree antérieur conservé. Le cadrage initial ci-dessous est historique.

- Agrégats géographiques/végétaux et sol détaillé visibles sans masque scientifique ; éléments naturels inconnus sans données de gisement ni occupations. `knownGeography` et les permissions métier restent en place. Lecture de fiche de gisement désormais refusée si la position est inconnue, avant réconciliation économique : l’ID visible ne suffit pas à obtenir ses richesses.
- Silhouettes étrangères anonymes : ancre et rectangles bâtis seulement, sans ID de village, Jardin ou travaux. Rapports acquis conservés sans doublon ni actualisation implicite ; identité et date restent dans `science.villageReports`. Budgets et verrou Astronomie inchangés.
- Tests terminés : les 9 tests scientifiques et 10 tests terrain existants adaptés sont passés ; le nouveau test HTTP silhouette/rapport est passé après correction de deux erreurs de fixture (membership et targetLevel). Après la protection des fiches : régression paysage/fiches, accès bois connu et rendu Babylon anonyme passent (3 tests ciblés). Typecheck monorepo final et lint ciblés verts. Aucun E2E large.
- Reproductions rétrospectives isolées : anciens `terrain.ts`/`terrain-villages.ts` rétablis temporairement depuis HEAD → deux assertions échouent (sol masqué, silhouette absente), puis repassent après restauration. Suppression temporaire du garde de fiche → lecture inconnue réussit à tort ; garde restauré et test vert. Tous les fichiers restaurés avec leurs changements antérieurs.
- Navigateur isolé sur `127.0.0.1:5432/arbestra_test`, API sans worker : Région accessible, dézoom global refusé sans Astronomie, tore accessible après acquisition dans la fixture, sans sciencePreview. Terrain distant inspecté : 13 éléments naturels, aucun payload de gisement. Captures `test-results/paysage-*.png`, ignorées par Git. Captures nocturnes et qualité réduite : **aspect diurne et silhouettes étrangères en navigateur restent à valider** ; pas de preuve de performance. Les essais d’aperçu diurne n’ont pas fourni une capture diurne valide.
- Aucun reset, seed ou migration en développement. Les tests ont réinitialisé uniquement la base de test vérifiée ; la fixture Astronomie a été effacée par le reset de la régression suivante. Serveurs et navigateur de recette arrêtés. Specs sciences/vues et architecture scientifique mises à jour.

Préférence de session : réduire fortement les appels et essais supplémentaires ; Tristan a signalé une consommation de quota excessive. Ne pas relancer les suites vertes sans nouvelle raison.

5 octobre 2026 — **arbitrage validé, correction non implémentée**. Reprise bornée pour une nouvelle session. Branche `main`, dernier commit relu `ffb6707`. Nombreuses modifications antérieures non commitées : les conserver, ne pas englober le worktree dans un commit automatique.

## Décision produit

La caméra permet de découvrir le paysage ; les missions permettent de le connaître et d'y agir.

- En Région et sur le tore, montrer relief, eaux, forêts et grandes zones rocheuses même sans exploration scientifique. Supprimer le masquage visuel des territoires inconnus.
- Montrer les silhouettes des implantations d'autres joueurs observables à la caméra. Leur identité, leur fiche et leurs renseignements restent acquis par reconnaissance. Les renseignements actualisés relèveront notamment de l'espionnage ultérieur.
- Voir ne rapporte aucun relevé, aucune preuve scientifique et aucune connaissance métier. Ne pas révéler les stocks, réservations, effectifs, activités ou richesses des gisements par simple navigation.
- Astronomie 1 reste nécessaire à la représentation torique globale. Ne pas contourner le verrou de zoom ni convertir le bypass DEV en règle joueur.
- Conserver les droits, portées et prérequis actuels d'exploitation, de construction et de missions. Aucune modification économique.

## Existant vérifié dans le code

- `apps/api/src/modules/worlds/terrain-routes.ts` : overview et végétation passent par `knownOverview` / `knownVegetation`, sauf bypass scientifique DEV. Authentification et autorisation du monde précèdent ces lectures.
- `apps/api/src/modules/science/knowledge.ts` : `knownOverview` masque les agrégats inconnus en mettant leurs altitudes/couvertures à zéro ; `knownVegetation` réemploie le masque. `knownGeography` sert à la connaissance réelle : ne pas supprimer ses usages métier.
- `apps/world-web/src/scene/terrain-overview-view.ts` : `color()` grise les entrées dont `knowledgeCoverage` vaut zéro. Retirer seulement ce gris ne suffit donc pas : les données ont déjà été masquées au serveur.
- `apps/api/src/modules/worlds/terrain-villages.ts` : `getTerrainVillages` lit actuellement les villages propres en direct et ajoute les rapports scientifiques. Lecture bornée à 320 cases par axe, 32 villages, 64 blocs par village, coordonnées toriques, transaction read-only. Le chemin DEV peut lire les extérieurs étrangers. Les blocs exposent notamment `garden` et `underConstruction` : ne pas ouvrir ce payload tel quel sans revoir ce qui constitue une simple silhouette.
- `packages/contracts/src/terrain.ts` : contrats d'overview, végétation et villages. `apps/world-web/src/scene/regional-villages.ts` : représentation régionale des implantations.
- À examiner avant modification : `getTerrain` et `getTerrainUpdates` dans `apps/api/src/modules/worlds/terrain.ts` pour les chunks détaillés ; `apps/api/src/modules/science/deposit-access.ts`, `navigation.ts` et les commandes pour les droits métier. Ces chemins n'ont pas encore été audités exhaustivement pour cette tranche.

## Correction minimale attendue

1. Distinguer la géographie visuelle publique aux membres du monde de la connaissance scientifique persistée. Servir les agrégats nécessaires au paysage sans masquer les zones inconnues. Préserver l'isolation `world_id` et les caches appropriés.
2. Exposer une projection minimale des silhouettes étrangères. Ne pas transmettre des renseignements sensibles puis les cacher en React. Conserver séparément les rapports acquis, leurs dates et leur éventuelle ancienneté ; éviter les doublons silhouette/rapport.
3. Adapter le rendu régional/torique et les contrats concernés, sans refonte du streamer. Ne pas télécharger tout le terrain détaillé pour afficher le tore. Aucun agrandissement gratuit des budgets de chargement.
4. Reporter la nouvelle règle dans `docs/SPEC-UNIVERSITE-SCIENCES-DECOUVERTE.md` et les passages concernés de la spec des vues. Ne pas réécrire l'arbre scientifique.

Le détail exact de la géométrie anonyme est à confronter au code : retenir le minimum permettant une silhouette, sans nouveaux marqueurs de production/travaux. Signaler un vrai choix produit si cette frontière ne peut être tenue ; ne pas lancer un nouveau système d'espionnage.

## Vérification proportionnée

- Joueur sans relevés : paysage visible, données scientifiques et permissions inchangées.
- Village étranger jamais reconnu : silhouette présente, aucune identité/fiche ni renseignement métier dans le JSON ou l'inspection.
- Village reconnu : renseignements issus du rapport conservés, pas d'actualisation implicite par la caméra, pas de doublon.
- Pas de fuite entre mondes/comptes via caches ; jointures et autorisations restent mondiales.
- Astronomie absente : verrou global conservé ; Astronomie acquise : tore complet visible.
- Quelques tests API/contrats ciblés, typecheck/lint concernés et courte recette navigateur Région/Monde. Pas de suite E2E large ; Tristan préfère recetter interactivement.

## Contexte à préserver

- Plus aucune miniature ni bouton LOD dans le HUD : navigation au zoom/dézoom, décision explicite. Ne pas les réintroduire.
- Braseros : essai clustered lighting natif Babylon 8.56.2 implémenté dans `village-braziers.ts`, fallback six lumières/deux par objet pour GPU incompatibles. Tristan a validé le rendu et fourni une capture. Trois tests existants des braseros, typecheck world-web et lint ciblé passés ; pas de benchmark de performance ni validation exhaustive du lifecycle. La recette navigateur agent a été interrompue par un refus d'exécution lié au quota d'approbation automatique, pas une erreur moteur prouvée.
- Nouvelle préférence durable : vérifier d'abord les mécanismes natifs Babylon disponibles dans la version installée avant un développement maison.
- Ne pas réexécuter la remise à zéro de Clairière : Tristan a reconstruit son village depuis. Ne pas migrer/seed/reset la base dev pour cette correction.

## Prompt pour la prochaine session

> Lis AGENTS.md, la tête de SESSION-HANDOFF.md et docs/HANDOFF-PAYSAGE-VISIBLE.md. Implémente la correction bornée « paysage visible, connaissance acquise » selon l'arbitrage validé. Vérifie d'abord les projections serveur et leurs consommateurs. Préserve les renseignements protégés, les règles métier, Astronomie 1 et les budgets du streamer. Tests ciblés légers et courte vérification navigateur ; aucun E2E large ni refonte. Préserve le worktree existant et n'ajoute aucune fonctionnalité hors périmètre. Mets à jour le handoff avec les preuves et limites réelles.
