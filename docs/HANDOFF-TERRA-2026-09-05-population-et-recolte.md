# Handoff — habitants par cohortes et récolte différée du Jardin

Date : 5 septembre 2026. Statut : implémentation hors UI React terminée dans le worktree, non commitée et non poussée.

## Résultat

La migration 010 introduit la population par cohortes, le coffre de l'Hôtel de ville et les récoltes persistantes ; 011 ajoute les reçus idempotents des commandes population. Un village démarre à 15 habitants, énergie 10, origine et rattachement identiques. L'Hôtel de ville offre 30 couchages ; une maison terminée en ajoute 5 dans le snapshot.

L'énergie est calculée sans tick : idle consomme 10 points en 22 h, travail 1/h, repos 2/h. Les fractions sont conservées dans une unité entière divisible par les rythmes. À zéro, une cohorte passe au repos ; un cycle complet 10 → idle 22 h → repos 5 h revient à 10 et réinitialise le quota alimentaire. Le repos volontaire reste actif à pleine énergie jusqu'à cinq heures. Les repas et repos collectifs sont idempotents par `commandId` ; un repas coûte une carotte et donne un point, dans la limite de deux repas entre deux repos qualifiants.

Une récolte réserve le buffer du Jardin et les habitants requis (une personne par cellule active), puis crée `garden.harvest.complete` à H+60 s. Le worker conserve `SKIP LOCKED`; son handler rejoint la réconciliation du village. À l'échéance, la réservation est créditée une fois, les travailleurs sont libérés et la production du trajet reste dans le buffer. Une seconde récolte concurrente reçoit `GARDEN_HARVEST_IN_PROGRESS`.

L'UI React reste au product owner. [Le mock-up et les contrats HTTP](./UI-MOCKUP-2026-09-05-habitants-et-recolte.md) sont à jour. Babylon affiche un petit cube-figurant par parcelle active pendant la récolte, animé entre le village et la parcelle à partir des dates serveur. Ce sont des figurants, pas des habitants persistants individuels.

## API livrée

- `POST .../buildings/:buildingId/harvest` avec `{ commandId }`.
- `POST .../buildings/:buildingId/discover-supplies`.
- `POST .../population/feed` et `POST .../population/rest`, avec `{ commandId, count }`.

Chaque réponse est un `VillageState` enrichi de `village.population` et de `garden.harvest`. Les nouvelles commandes exigent une migration 010/011 appliquée : ne démarrer ni l'API de développement ni l'UI contre une base restée à 009.

## Preuves obtenues

- Migration 010 puis 011 appliquées avec succès à `arbestra_test` seulement.
- `apps/api/src/modules/population/energy.test.ts` : cinq cas verts : frontières, soixante minutes de travail, repos qualifiant et deux cycles longs.
- `apps/api/src/modules/population/population.integration.test.ts` : quatre cas PostgreSQL verts : population/capacité initiales, repas idempotent et conservation de l'effectif, repos collectif, coffre concurrent.
- `apps/api/src/modules/villages/economy.integration.test.ts` : 21 cas verts, adaptés au transit de récolte ; notamment buffer réservé, reprise idempotente avec le même `commandId`, double récolte refusée, extension échue et plafonnement.
- `corepack pnpm test` : 48 tests verts. Le lancement ciblé final (économie, population et énergie) compte 30 tests verts.
- `corepack pnpm typecheck`, `corepack pnpm lint` et `corepack pnpm build` : verts.

## Limites de validation

### Correctif du raccord HTTP après signalement joueur

Les migrations 010 et 011 ont depuis été appliquées au développement, sur demande de Tristan (succès du migrateur). L'adaptateur `apps/world-web/src/api/client.ts` envoyait encore la récolte sans corps ; il envoie maintenant le JSON `{ commandId }`, avec UUID optionnel fourni par l'appelant pour un retry. Aucun composant React modifié. Un test du client et un parcours Fastify/PostgreSQL (connexion, construction, récolte, sérialisation du snapshot) couvrent le raccord. Sur l'API dev observée, l'appel sans corps renvoie 400 `VALIDATION_ERROR` : le 500 signalé par le joueur n'a pas été reproduit. Ne pas présenter cette correction comme une preuve que tous les menus ont été validés.

Les validations visuelles Babylon et l'intégration React sont explicitement à la charge du product owner ; elles ne font pas partie des tests automatisés de cette tranche. Le product owner branche l'UI à partir du mock-up. Aucune migration n'a été appliquée à la base de développement et aucun commit/push n'a été fait.
