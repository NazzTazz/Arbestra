# Audit global et audit des trajets

22 novembre 2026, sur `4ec44e4`, branche `wip/v2-commandes-bornees`. Audit en lecture seule : aucun code modifié, aucun test lancé. Demandé par Tristan au moment où il envisage une pause (« chaque nouvelle feature apporte des régressions et X nouveaux choix à faire »).

Méthode : lecture du code des trajets et requêtes en lecture sur la base de dev par l'auteur ; deux audits délégués (serveur et contrats, client et processus). **[V]** : vérifié par l'auteur dans le code ou la base. **[D]** : rapporté par un audit délégué, non revérifié. **[I]** : inférence.

## 1. Constat d'ensemble

Le dépôt compte 115 000 lignes de source et 75 000 de tests, écrites en 650 commits sur moins de trois mois, dont 476 en octobre [V]. Le rythme d'ajout a dépassé le rythme de consolidation. Les régressions viennent de quatre causes structurelles, pas de la qualité de chaque tranche.

### 1.1 Des migrations empilées, jamais terminées

Chaque refonte a laissé l'ancien système vivant à côté du nouveau. Toute feature traverse donc deux chemins.

- **État du village** : le serveur construit toujours l'ancien `VillageState` complet (`state()`, `villages/service.ts:1037-1445`), le client reçoit les flux V2 puis les recombine en `VillageState` (`sync-v2-village-state.ts:26`). Un champ visible se déclare à six endroits tenus ensemble par un test de parité [D].
- **Trajets** : en mode 0, le serveur calcule encore le réseau « tous buts » (`presentation.ts:232-239`) [V]. Le mode 0 s'ajoute donc au coût qu'il devait supprimer.
- **Terrain** : deux modèles (`terraces`, `vertices`) et `generationVersion === 3` dans une quarantaine de branches [D].
- **Restes** : trames V1 gardées pour le seul NOC, `assertSyncV2Available` à chaque commande [D]. Deux restes annoncés par l'audit délégué se sont révélés vivants à la relecture du 22 novembre : les schémas de nivellement servent à la terraformation, et le code « Until S3 » des braseros d'ancrage évite encore un double feu avec les braseros automatiques.

### 1.2 Des tests qui valident un autre produit

- Le monde de seed `aube` est en génération 2 et en terrasses ; l'alpha est en RC1 à sommets partagés. La majorité des tests d'intégration couvre la branche que les joueurs n'utilisent pas [D].
- `spatial-locks.ts:403` : sous `process.env.VITEST`, quand la transaction ne tient aucun verrou spatial, le code de production prend lui-même les zones manquantes au lieu de refuser [V]. Un chemin qui oublierait tout verrou spatial passerait donc les tests ; un chemin qui en prend une partie reste détecté.
- `legacy-commands.fixture.ts` (851 lignes, 24 fichiers de test) réimplémente l'orchestration des commandes à côté des routes HTTP réelles [D].
- Aucun test n'instancie `BabylonVillageScene` [D]. Les 31 specs Playwright ne tournent pas en CI (`.github/workflows/test.yml` ne lance que vitest) [V].
- Les régressions réelles sont exactement dans ces trous : boucle de redimensionnement, braseros fantômes, hôtel de ville blanc puis noir, nappe régionale corrigée quatre fois [D].

### 1.3 Trois objets qui concentrent tout

- `BabylonVillageScene.ts` : 5 716 lignes, environ 250 champs privés, une boucle d'image de 390 lignes, 12 clés d'invalidation [D]. État mutable partagé et ordre implicite : une feature lit l'état d'une autre au mauvais moment.
- `App.tsx` : un composant de 2 450 lignes, 54 `useState` [D].
- `villages/service.ts` : 3 051 lignes, `state()` à 8 paramètres positionnels [D].
- La réconciliation économique finit par un `else` qui envoie tout type de transition non prévu vers `completeStoneExtractionAt` (`reconcile-economy.ts:448`) [V].

### 1.4 Trop de chantiers et de décisions ouverts à la fois

- 11 chantiers dans le backlog, environ 8 items « à valider » en même temps [D].
- Au moins 50 décisions numérotées demandées à Tristan en un mois. Les huit propositions du §8 de la spec trajets ont été validées telles quelles : elles pouvaient être prises par défaut [D].
- Sur les 300 derniers commits, 134 sont documentaires ; le handoff est touché par 113. Plusieurs documents se contredisent sur les statuts [D].

## 2. Audit des trajets, des sentiers et du pathfinding

### 2.1 Ce qui est solide

- **Agrégation des sentiers** (`worlds/desire-paths.ts`) : hors des commandes, registre des missions comptées, fenêtre à marge, lots triés. Vérifié sur la base de dev : les passages de la recette du 22 novembre sont comptés exactement une fois, en moins de deux minutes [V].
- **Coût = durée** (T1) et **issues explicites** `found` / `unreachable` / `budget` (T2b) : règle unique, lisible.
- **Flux V2 des sentiers** : seuil unique en base (`world_desire_visible_passages()`), diffusion par transition de seuil.

### 2.2 Le défaut de fond : les sentiers sont le sous-produit d'un optimiseur de durée

Le tracé affiché en mode 0 est le chemin calculé pour chaque mission. Ce planificateur minimise une durée ; rien ne le pousse à dessiner un chemin plausible.

1. **Aucune attraction vers les sentiers existants** [V]. L'ancien réseau affiché réutilisait les arêtes déjà prises (`shared`, 0,7 : `travel-paths.ts:607`). La recherche fine des missions ne connaît que les cases de route (`:1313-1326`). Mesuré le 22 novembre : trois cibles voisines donnent trois colonnes parallèles (x = 257, 259, 262) au lieu d'un tronc commun. Une vraie ligne de désir se renforce ; celles-ci ne convergent pas.
2. **Aucune pénalité de virage** [V]. L'ancien réseau en avait une (0,05, `:609`), la recherche fine non. Les trajets font des escaliers : 6 coudes sur les 12 premières cases du trajet mesuré.
3. **Seuil par bord** [V]. Un sentier apparaît bord par bord dès 3 passages : des tronçons isolés surgissent là où les trajets se recouvrent (capture de Tristan du 22 novembre). Les dernières cases restent à 1 passage, chaque arbre étant à un endroit différent : le sentier n'arrive jamais à destination.
4. **Braseros à chaque coude** [V]. `automaticBraziers` pose un brasero à tout nœud qui a un bras horizontal et un vertical. Sur les sentiers tracés depuis le 15 novembre, 13 nœuds à brasero sur 14 sont de simples coudes, pas des carrefours. Cause probable, non démontrée, du passage de Petibonom de 151 à 520 braseros.
5. **Aucun oubli** [V]. Un bord compté ne disparaît jamais (hors scope de la spec). `rc1-dev` : 699 bords, 680 visibles. Chaque zone de défrichage laissera ses traces pour toujours.
6. **Bâtiments sans sentier** (décision §8.2) [V]. Une maison neuve reste isolée dans l'herbe, sans promenade de loisir : visible sur la même capture.

Les points 1 à 4 se corrigent dans le planificateur, pas dans le rendu.

### 2.3 Complexité du calcul

- **Cinq recherches** [V] : A* grossier par case de `buildTravelNetwork` ; A* fin au huitième de case de `refineTravelRoute` ; `planRoute` (commerce, expéditions) ; `planHierarchicalRoute` (portails de chunks) ; parcours en largeur du loisir côté client.
- `refineTravelRoute` : une fonction de 535 lignes, récursive, avec deux raccourcis avant la recherche complète (queue certifiée, témoin `planRoute`).
- `stoneTravelPath` (`service.ts:360-529`) : six branches selon la distance et le monde, dont une jambe en L au-delà de 128 cases.
- **Quatre caches en mémoire** à signatures `JSON.stringify` (`networkCache`, alias, `passageCaches`, `refinementCaches`), plus trois en base (routes de l'hôtel de ville, réseau stocké, versions de chunks).
- Le calcul des chantiers automatiques se fait encore dans la transaction d'admission (`service.ts:727`) : T5 et T6 ne sont pas faites.
- Environ 26 000 lignes, tests compris, portent sur les trajets, les routes et les braseros.

### 2.4 État de la refonte

T1, T2a, T2b validées. T3 (mode 0) à valider, recette interrompue. T4, la suppression du réseau « tous buts », n'est pas commencée : c'est elle qui porte le gain de charge (présentation saturée dès 5 bots) et la simplification. Tant que T4 n'est pas faite, le projet paie les deux systèmes.

## 3. Recommandations

Principe : aucune nouvelle fonctionnalité tant que les points A et B ne sont pas soldés. Presque tout est de la suppression et ne demande aucune décision de gameplay.

### A. Trajets : finir ou revenir, ne pas rester entre les deux

1. **Rendre les sentiers naturels dans le planificateur** : départage à coût égal en faveur du moins de virages, puis des bords déjà marchés. La durée, calculée sur le chemin, ne change pas. Effets attendus : troncs communs, moins de coudes, moins de braseros, moins de fragments.
2. **Braseros aux carrefours et aux extrémités seulement**, plus aux simples coudes.
3. **Recette du mode 0** sur ce résultat, puis **T4** : retrait du réseau « tous buts », de `travelRoutes`, de `village_travel_networks`, du drapeau.
4. Si le mode 0 ne convainc pas après 1 et 2 : revenir au mode 1 et supprimer le code des sentiers. Garder les deux est le pire des trois choix.
5. Plus tard, après T4 : oubli des sentiers non parcourus, simplification de `stoneTravelPath`.

### B. Suppressions sans décision

État au 22 novembre au soir :

1. **Fait** (`2111268`, `2f3557a`) : réconciliation exhaustive ; un type de transition inconnu échoue au lieu de finir en extraction.
2. **Fait** (mêmes commits) : `assertSyncV2Available` retirée, une requête de moins par commande.
3. **Fait, réduit** : l'exception `VITEST` de `spatial-locks.ts` n'existe plus. Cinq fichiers de tests qui admettent des trajets sans aucun verrou la demandent explicitement (`takeFixtureZones`) ; les 80 autres passent le contrôle strict de la production. La retirer de ces cinq fichiers demande de réécrire environ 45 transactions de fixtures, dont des tests de concurrence : non fait.
4. **Écarté** : restes du nivellement et code « Until S3 », vivants à la relecture (§1.1).
5. **Reporté** : NOC sur les lots V2. Ce n'est pas une suppression mais une réécriture du flux d'observation ; sans elle, retirer les trames V1 enverrait l'état complet du village à chaque changement.

### C. Filets de sécurité

1. Un smoke Playwright en CI : village prêt, changement de mode, une commande, une pose de route.
2. Monde de seed et tests d'intégration en RC1 à sommets ; retrait du modèle terrasses ensuite. Risque moyen à élevé, gain le plus fort.
3. Sondes de dev et d'e2e sorties de la boucle d'image : les mesures deviennent représentatives.

### D. Processus

1. Pas de nouvelle tranche au-delà de deux items « à valider ».
2. Décision par défaut : l'agent applique sa recommandation quand elle est réversible et la consigne ; Tristan ne tranche que l'irréversible et l'économie des joueurs.
3. Une spec décrit la cible ; le journal de livraison va dans les commits. Archiver les specs supplantées.

## 4. Limites

- Les constats [D] n'ont pas été revérifiés un par un. Un constat délégué faux a été écarté (fichier dit supprimé, présent).
- Le lien entre coudes et braseros de Petibonom n'est pas démontré sur la copie de l'alpha.
- Aucune mesure de performance nouvelle ; les chiffres de charge viennent de `docs/TEST-DE-CHARGE.md`.
