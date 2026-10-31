# Terraformation instantanée — 31 octobre 2026

Statut : **en cours** (reprise : §7). Remplace, pour les nouveaux gestes, le chantier de nivellement de [SPEC-TERRAFORMATION-LIBRE.md](SPEC-TERRAFORMATION-LIBRE.md) et de [SPEC-NIVELLEMENT-PLACEMENT.md](SPEC-NIVELLEMENT-PLACEMENT.md). Décisions : [DECISIONS-TERRAFORMATION-2026-10-31.md](DECISIONS-TERRAFORMATION-2026-10-31.md). Statuts : **validé** (Tristan), **proposé** (recommandation dans le cadre validé), **hors périmètre**.

## 1. Validé

- Terraformation libre et nivellement d'emprise : **instantanés, gratuits, sans villageois, sans confirmation**.
- Lot côté client : chaque geste s'ajoute au lot, montré en aperçu ; **Annuler N s** en haut à droite ; le décompte repart à **10 s** à chaque geste ; au terme, le lot part et s'applique ; Annuler abandonne tout le lot.

## 2. Commande (proposé)

`POST /worlds/:slug/villages/:villageId/terrain-edits`, V2 seulement, idempotente par `commandId` (table `terrain_edit_receipts`, migration 078, forme de `demolition_receipts`).

```
{ commandId, gestures: [
    { buildingType: 'terrain', anchor, cells, height }          // terraformation libre
  | { buildingType: <bâtiment>, anchor, quarterTurns }           // nivellement d'emprise
] }
```

- Au plus 32 gestes et 1 024 cases au total ; au moins un geste.
- Les gestes s'appliquent **dans l'ordre** : un sommet partagé prend la hauteur du dernier geste qui le touche. Chaque geste est validé contre le terrain laissé par les précédents.
- **Tout ou rien** : un geste refusé refuse le lot entier, sans écriture, avec le code du premier refus et l'index du geste (`gesture`). Le client valide localement avant d'ajouter un geste au lot (cases constructibles, eau, hauteur déjà atteinte), donc un refus serveur reste rare (concurrence, données périmées).
- Un geste sans effet (terrain déjà à cette hauteur, emprise déjà plane) n'est pas un refus : il est compté `unchanged`.
- Réponse : `{ protocol: 2, worldId, villageId, commandId, status: 'applied', commandTime, result: { gestures, unchanged, vertices }, effects? }`.

## 3. Admission (proposé)

1. Rejeu du reçu hors transaction ; `ownedVillage` ; `beginVillageEconomy(…, true)` (verrou de navigation exclusif, `statement_timestamp()` après acquisition) ; rejeu concurrent.
2. Par geste, dans l'ordre, sur le champ courant (sol RC1 plus les sommets des gestes précédents) : monde RC1 ; sélection valide ; limite d'instances (emprise) ; `assertBuildableCells` sur les cases puis sur l'anneau des cases touchées ; eau (surface et raccords) ; fondations voisines inchangées (`LEVELING_FOUNDATION`, lecture des fondations bornée au voisinage).
3. Une fois tous les gestes appliqués en mémoire : **accès** — aucun bâtiment existant ne perd son accès, et une emprise nivelée reste accessible (`LEVELING_ACCESS`). Le contrôle « pendant les travaux », le chemin des villageois, les durées, le devis et sa signature disparaissent.
4. **Sans `state()`** (étape 5b) : géométrie de commande `readInfrastructureSpatialState`, voirie de navigation, voisins comme obstacles dans la fenêtre de la région.
5. Écritures : hauteurs des sommets (`world_terrain_vertices`), terrasses pour un monde sans sommets partagés (nivellement d'emprise seulement) ; reçu ; `villageCommandResult` et publication V2. Les triggers existants invalident la navigation et publient le sol partagé.

## 4. Chantiers existants (proposé)

Les routes `/leveling` et `/terraform` et les chantiers en cours restent intacts jusqu'au lot I : un chantier admis avant la mise à jour se termine normalement (`completeLevelingAt`, protections `LEVELING_NEARBY`). Le nouveau client ne les appelle plus. Retrait des routes, de la table et du composant `levelingJobs` après vérification qu'aucun chantier n'est en cours sur alpha.

## 5. Client (proposé)

- Lot tenu par l'App (comme la démolition) : survit aux changements de mode du HUD ; un changement de village l'abandonne.
- Terraformation : un trait relâché, valide localement, s'ajoute au lot ; plus de choix d'habitants ni de devis. Aperçu de tous les gestes du lot (le dernier l'emporte sur un sommet partagé).
- Nivellement d'emprise (université, tailleur de pierre sur une pente) : le geste s'ajoute au lot sans fenêtre ; le bâtiment se place une fois le lot appliqué.

## 6. Vérifications

Tests d'intégration : lot appliqué dans l'ordre (sommet partagé), tout ou rien avec index du geste, geste sans effet, nivellement d'emprise, rejeu et `COMMAND_REUSED`, effets V2 (sol), rollback après écritures constatées, concurrence avec une construction voisine. Navigateur : traits successifs, décompte remis à 10 s, Annuler, application, nivellement d'emprise puis placement ; mesure du temps de commande sur Bressuire.

## 7. État au 31 octobre, nuit (reprise)

Fait :
- Serveur : `terrainEditsCommandV2` (`apps/api/src/modules/villages/terrain-edits.ts`), route `POST …/terrain-edits`, migration 078 (`terrain_edit_receipts`, appliquée à la base de dev), contrat `packages/contracts/src/terrain-edits.ts`. Sans `state()` (géométrie `readInfrastructureSpatialState`). Les routes `/leveling` et `/terraform` restent intactes (§4).
- Tests : `terrain-edits.integration.test.ts`, 5 verts sur la base de test (ordre et sommet partagé, geste sans effet, tout ou rien avec index, nivellement d'emprise, rollback) ; mutation « le premier geste l'emporte » rouge. `tsc` API et client verts.
- Client : lot tenu par l'App (`ui/PendingTerrain.tsx`, 10 s remis à zéro par geste, bouton « Annuler N s » empilé avec celui de la démolition via `CountdownCancelButton`) ; `TerraformPanel` réécrit (hauteur prélevée au premier trait puis conservée, ↑ ↓, Échap) ; nivellement d'emprise ajouté au lot sans fenêtre (`footprintTerraformVisual`) ; `LevelingPanel` supprimé ; aperçu fusionné (`mergeTerraformVisuals`).

Constaté dans le navigateur :
- Sur `rc1-dev` (Bressuire), lot envoyé au terme du décompte, refusé `LEVELING_UNAVAILABLE` : ce monde est au modèle **terrasses**, la terraformation libre exige les sommets partagés (limite antérieure, l'ancien chantier refusait aussi). Seul `recette-sommets` (« Les Collines », même compte) est au modèle sommets. Aperçu et décompte fonctionnaient.

À faire demain :
1. ~~Vérifier eslint et les tests du client~~ : eslint sans erreur, `tsc` client vert, tests `apps/world-web/src` 127 fichiers verts (fin de session, après le commit `64378a0`).
2. Recette navigateur sur `?world=recette-sommets` : traits, décompte remis à 10 s, Annuler, application et rafraîchissement du sol, nivellement d'emprise puis placement. Mesurer le temps de la commande.
3. ~~Modèle du monde alpha~~ : **sommets partagés** (Tristan, 31 octobre), rien à convertir. Recette en dev : sur `recette-sommets`, ou après conversion de `rc1-dev` (`activateTerrainVertices`, sauvegarde `pg_dump` avant) pour la faire sur Bressuire comme sur l'alpha.
4. Le refus serveur n'est montré que par une notification brève : envisager de garder l'aperçu en rouge.
5. Commit final, handoff « à valider ».
