# Audit Astra — priorités métier et frontières React, pour Sol

Date : 6 septembre 2026. Base examinée : `master`, HEAD `4dfd494`, avec le worktree non commité préexistant.

## Demande et portée

Tristan a demandé un audit en lecture seule et des suggestions de tranches métier prioritaires. Il avait déjà envisagé avec Sol, en chat, de séparer `App.tsx` suivant les frontières réelles (HUD, panneau construire, etc.). Il demande ensuite d'enregistrer cet audit pour Sol, qui aura exceptionnellement le clavier.

Ce document transmet les constats et recommandations ; il n'approuve pas automatiquement les nouvelles mécaniques proposées. Sol reprend le clavier selon les instructions courantes de Tristan. La répartition historique « React à Tristan » ne doit pas être interprétée comme interdisant ce relais explicite à Sol.

Preuves : lecture du code, contrats, migrations, tests et documents pertinents ; inférences indiquées ci-dessous. Aucun test exécuté, aucune reproduction runtime, aucune requête métier, aucune inspection de la base de développement. Les anciens comptes de tests des handoffs ne sont pas une validation actuelle. L'audit n'est pas une revue exhaustive des transactions/concurrences.

## Diagnostic

Le backend a pris de l'avance sur le jeu accessible au joueur. Priorité recommandée : rendre les boucles population/récolte/pierre cohérentes et jouables, puis ajouter une progression. Un découpage limité d'App.tsx facilite cette intégration.

## Constats prioritaires

### 1. Jardin surdimensionné : impasse métier possible

La construction et l'extension n'imposent pas de borne liée à la population. La récolte exige un habitant par cellule active. Le village démarre à 15 habitants et aucun mécanisme actuel n'augmente cet effectif ; les maisons augmentent uniquement la capacité de logement.

Conséquence inférée : un Jardin de 16 cellules actives devient impossible à récolter dans le périmètre actuel. Ce scénario n'a pas été reproduit.

Sources : [constructBuildingArea / expandGarden](../apps/api/src/modules/villages/service.ts), [startGardenHarvest, needed = active.count](../apps/api/src/modules/population/garden-harvest.ts), [initialisation](../apps/api/src/database/seed.ts). Le calcul `housingCapacity` est dans `service.ts`.

Recommandation proposée : afficher avant construction/extension le besoin total en habitants, l'effectif actuel et un avertissement explicite. Cela informe mais ne résout pas l'impasse. Interdire le dépassement, permettre une récolte partielle ou ouvrir une croissance démographique sont des choix produit **ouverts**, pas des correctifs techniques déjà approuvés.

### 2. Récolte différée mal présentée et retour non actualisé automatiquement

Dans [App.tsx](../apps/world-web/src/App.tsx) :

- `onHarvest` annonce immédiatement « +X carottes récoltées », alors que le serveur réserve le lot et le crédite à l'échéance.
- `BuildingDetails` n'affiche pas le travail `garden.harvest` et ne désactive pas le bouton selon cette affectation ; après la réponse HTTP, une nouvelle tentative peut donc recevoir le refus serveur « récolte déjà en cours ».
- Le polling dépend seulement de `hasConstruction` (construction ou extension). Sans chantier, une récolte arrivée à échéance ne déclenche pas de récupération automatique du stock. L'intervalle qui met à jour `now` n'effectue aucune requête.
- Le retour de visibilité appelle directement `applySnapshot`, sans la protection contre les snapshots anciens présente dans le polling. Risque de régression d'affichage en cas de réponses entrelacées, non reproduit.

La scène ne fournit pas de callback de fin métier au composant React. Les animations ne doivent jamais créditer le stock ; elles peuvent au plus contribuer à demander une actualisation dédupliquée.

### 3. Population et pierre partiellement accessibles

Les routes repas/repos/découverte du coffre existent dans [routes.ts](../apps/api/src/modules/villages/routes.ts), mais leurs adaptateurs manquent dans le [client React](../apps/world-web/src/api/client.ts) et leurs commandes ne sont pas branchées dans l'interface active.

Pour la pierre, `getStoneDepositDetails` et `startStoneExtraction` existent déjà dans ce client, ainsi que le picking et le pont Babylon. Le menu d'App.tsx affiche encore « Les détails d'exploitation arriveront ici ». Le HUD actif ne montre ni pierre ni population.

### 4. Contrats et intentions à finir

- **Coffre :** `discoverBuildingSupplies` persiste `claimedAt`, mais [VillageState / Building](../packages/contracts/src/villages.ts) n'exposent pas l'état découvert/non découvert. Un menu ne peut donc pas reconstruire cet état après F5 à partir du snapshot. La commande répétée renvoie un conflit, elle ne constitue pas une lecture de détail.
- **Récolte, serveur :** `startGardenHarvest` retrouve le travail par monde/village/commandId et retourne son ID sans vérifier que `buildingId` correspond toujours. Réutiliser l'intention sur un autre Jardin ne déclenche donc pas le conflit de paramètres attendu. Constat de lecture, non reproduit.
- **Récolte, client :** l'adaptateur accepte un commandId explicite, mais App.tsx ne le conserve pas ; chaque nouvel appel utilise l'UUID par défaut. Après une réponse perdue, une nouvelle tentative ne réutilise pas l'intention initiale. Le test de l'adaptateur avec ID explicite ne prouve pas le comportement du composant.

### 5. Preuves visuelles et représentation des récoltes en retard

[tests/e2e/vertical.spec.ts](../tests/e2e/vertical.spec.ts) attend encore une construction depuis une case vide et un Jardin passant au niveau 2. Il ne décrit plus le parcours actuel par panneau construire et extension surfacique. Aucun lancement effectué durant l'audit : incompatibilité constatée à la lecture, pas résultat d'exécution.

Dans [BabylonVillageScene.ts](../apps/world-web/src/scene/BabylonVillageScene.ts), `#updateHarvestPeople` sélectionne `gardens[0]`. Plusieurs petits Jardins peuvent se partager les habitants, mais seul le premier travail est représenté par ce chemin. La vérification future doit inclure des récoltes simultanées et le rechargement en cours de trajet.

## Tranches proposées, dans l'ordre

| Priorité | Tranche | Résultat joueur et périmètre |
|---|---|---|
| 1 | Piloter ses habitants et ses récoltes | Disponibles/travailleurs/repos visibles ; repas/repos/coffre accessibles ; récolte suivie jusqu'au crédit et reprise après F5. Inclure contrats manquants, intentions stables et actualisation cohérente. |
| 2 | Exploiter réellement la pierre | Choisir le gisement et l'effectif, lire lot/durée/refus serveur, lancer, suivre puis constater crédit et libération du terrain à épuisement. Réutiliser le backend et le pont Babylon existants. |
| 3 | Donner une utilité à la progression résidentielle | Première façon bornée d'accueillir des habitants, limitée par le logement. Origine, coût, délai et modalités restent à cadrer avec Tristan. |
| 4 | Donner un premier usage à la pierre | Un seul investissement consommant la pierre avec un bénéfice produit explicite. Le catalogue actuel n'offre pas de débouché économique à cette ressource. |

La tranche 3 est la recommandation pour la prochaine **nouvelle mécanique** : elle donne une raison de construire des maisons et élargit la répartition entre Jardins et pierre. Les tranches 1 et 2 permettent auparavant de jouer les arbitrages déjà implémentés. Ces priorités sont proposées, pas validées par la seule demande d'enregistrement.

Inscription/spawn, exploration avec déplacement de région, combat, transport général et refonte d'infrastructure ne sont pas nécessaires à ces premières tranches. Ils ne sont pas autorisés par cet audit.

## Découpage proposé d'App.tsx

| Frontière | Responsabilité |
|---|---|
| `VillageHud` | Identité, ressources et résumé population. |
| `ConstructionPanel` | Catalogue, sélection, coûts, confirmation et annulation. |
| `BuildingDetails`, puis panneaux Jardin/Hôtel de ville selon le besoin | Présentation et commandes propres à chaque bâtiment. |
| `DepositDetails` | Détail serveur, options d'effectif, refus et extraction. |
| `useVillageSession` | Chargement, application des snapshots, horloge, actualisation et protection contre les réponses anciennes. |

App conserve la composition de la scène, le mode construction et la sélection courante. Garder une seule gestion cohérente des snapshots. Ne pas créer de store global, moteur de commandes ou refonte générale préventive pour cette extraction.

Un [Hud.tsx](../apps/world-web/src/ui/Hud.tsx) non suivi existe déjà : le préserver et comprendre l'intention de Tristan avant intégration. Il n'est pas importé par App.tsx. Son import `./Hud.css` vise un fichier absent dans `ui`, alors que le style présent est [src/hud.css](../apps/world-web/src/hud.css). Corriger le raccord lors de son intégration ; ne pas présenter ce composant comme déjà actif.

Ordre de travail recommandé : petite extraction HUD/panneau construire, puis tranche habitants–récoltes. Ne pas attendre une refonte complète du frontend pour livrer le parcours.

## Vérification à prévoir lors de l'implémentation

- Régressions ciblées sur conflit d'intention Jardin et état persistant du coffre ; vérifier les résultats métier.
- Parcours navigateur : construction/extension actuelles, récolte sans chantier concurrent, état en transit, retour et crédit serveur, F5 à mi-parcours, deux petits Jardins simultanés.
- Réponse perdue/retry avec même intention ; réponse de lecture ancienne arrivant après une commande.
- Pierre : refus lisible, effectif, travail en cours, retour, stock et terrain après épuisement.
- Choix produit du Jardin surdimensionné à expliciter avant d'en changer la règle serveur.

Appliquer les contrôles proportionnés d'[AGENTS.md](../AGENTS.md) et du [workflow](AGENT-WORKFLOW.md) à la tranche réellement choisie. Aucun de ces contrôles n'a été exécuté pour l'audit.

## État Git et passation

Au moment de l'audit : branche `master`, HEAD `4dfd494`, nombreux changements préexistants suivis et non suivis (population, pierre, UI, documents). Ne pas attribuer l'ensemble du diff à cette passation ni l'inclure aveuglément dans un commit.

La demande d'enregistrement ajoute uniquement ce document et son lien dans le handoff courant. Aucun code applicatif, migration ou donnée modifié ; aucun commit/push. Relire l'état Git réel au début de la reprise de Sol.
