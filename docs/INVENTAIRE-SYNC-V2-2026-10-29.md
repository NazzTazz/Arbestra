# Inventaire de la synchronisation V2 — 29 octobre 2026

Lecture du code sur `e8ee981` (aucun test lancé) ; comptage des références sur alpha en lecture seule. Référence : [SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md](SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md) §10 et §14, [AUDIT-SYNC-V2-2026-10-23.md](AUDIT-SYNC-V2-2026-10-23.md).

## Schéma commun

Chaque route mutante a deux branches : V2 si l'en-tête `x-arbestra-protocol: 2` est présent (`routes.ts:186-200`, `command-v2.ts:10-31`), V1 sinon. Le client prend la V1 quand la V2 n'est pas prête, quand `arbestra:sync-v2=0`, et pendant toute l'installation (`villageV2Mode = SYNC_V2_VILLAGE && !starterActive`, `App.tsx:426`).

## État par lot

- **E (récoltes, exploitation)** : intentions de récolte et annulation en reçus compacts ; ordres d'exploitation et chantiers en V2 avec repli V1. `prepareExploitation` et son aperçu appellent encore `state()` complet dès qu'il y a des jardins (`service.ts:2610`).
- **F (marchés)** : V2 avec repli V1 ; ancien marché 034 à nettoyer (`reconcile-economy.ts:131`, `market.deliver`).
- **G (science, découvertes)** : V2 avec repli V1 ; reçus d'expédition encore sur le SSE V1 en mode V1.
- **H (lectures pures)** : réveil économique (`reconcileVillageForRead`, `service.ts:1724`) dans `GET /village`, les bootstraps, chaque tick de `sync/stream` (sous condition) et de `/events` V1. Aperçus, `features`, `offers`, `trade-preview`, `presentation` et `sync/read` sont purs.
- **I (retrait V1)** : branches V1 serveur et replis client partout ; projections V1 et `preSerialization` actifs ; révision COUNT mondiale encore utilisée (HUD, `state()`, NOC) ; pas de réponse 426.
- **Hors lots, bloquant pour I** : voirie hors routes (équipement, déplacement, suppression) en trame V1 et `state()` complet ; relecture `GET /village` après un refus de voirie ; nivellement et terraformation V2 préparés avec `state()` ; HUD ordonné par la révision COUNT.

Appelants restants de `GET /village` : repli du chargement initial (404 ou session expirée, V2 désactivée), rafraîchissement sans V2, refus de voirie, `setFactoryEnabled`.

## Autonomie des workers (préalable du lot H)

Avancent seuls : constructions, extensions, jardins, extractions, science, atelier, marché, offres et livraisons, nivellement, arrivées, admission des chantiers et de la science.

**Ne progressent qu'à la lecture d'un client ou à une commande** : les changements d'activité dus à l'énergie (fatigue, fin de repos ; `sync.ts:63`), l'attribution des lits (`reconcileRestHousing`), et, par inférence, la reprise d'un habitant après son repos.

## Audit sync

A fait ; C1 fait (503 `SYNC_SCOPE_TOO_LARGE` avec `Retry-After`, relectures espacées par le client : `25b2ea0`, `447b455`) ; C2 largement fait (restent succès à 128, ancres de la couverture de connaissance à 1 024) ; C3 fait pour le snapshot privé (29 octobre, ci-dessous) ; B fait (`06ed9c6`).

C3, pagination du snapshot privé (29 octobre, [conception](DESIGN-PAGINATION-SNAPSHOT-V2.md)) : un village de plus de 4 096 références se charge en plusieurs pages, chacune dans sa propre capture.
- **Mécanisme** : la page 1 porte les révisions de tous les flux abonnés (l'ancre) et les flux partagés complets ; les pages suivantes, le seul flux privé, dans l'ordre `(component, key)` octet par octet, au plus 4 096 références et la borne de schéma de chaque composant. Le client garde les pages hors de la session, demande un delta depuis l'ancre, l'applique à l'état assemblé, puis publie une seule fois. Opt-in par l'en-tête `x-arbestra-sync-pages: 1` : sans lui, la réponse est celle d'avant, snapshot complet ou 503. Le flux ne lit plus de snapshot : un curseur à reprendre reçoit `reset` sans lecture d'entités.
- **Reprise** : page en échec relue avec le même curseur (3 essais) ; 409 `SYNC_SNAPSHOT_PAGE_EXPIRED` (epoch changée, révision sous l'ancre, ancre sous le plancher) ou pages incohérentes : reprise depuis la page 1 (3 fois au plus) ; epoch changée par rapport à la session : nouvelle génération.
- **Preuves** : `sync-v2-snapshot-pages.integration` (7 tests). Lecture paginée d'un village de 4 600 références, rouge sur l'ancien code (`RangeError`). Union des pages égale à une lecture unique sans borne. Entrelacement forcé : un écrivain validé entre la page 1 et la page 2, un autre ouvert pendant la lecture de la page 2 puis validé avant le delta ; l'état final contient les trois changements (modification, suppression, création), les pages seules non. HTTP : pages servies avec l'en-tête, 503 inchangé sans, curseur forgé 400, epoch remplacée 409. Flux : `reset` au lieu de 503, rouge sur l'ancien code. Client : `sync-v2-transport` (4 nouveaux tests, rouges sur l'ancien transport) : plusieurs pages, une page en 503 relue, rien publié avant le delta ; epoch changée au milieu puis 409, seul l'état cohérent publié ; session expirée en cours de pages, rien publié ; petit village en une seule lecture. Contrats : 3 tests de l'assemblage (pages incohérentes, confirmations plus récentes conservées, epoch remplacée).
- **Mesures** (base de test, 9 916 références, machine chargée) : 3 pages et un delta en 976 ms en médiane, contre 948 ms pour les mêmes lecteurs en une capture sans borne ; pages suivantes 200 ms ; delta 6 ms ; assemblage client 118 ms.
- **Reste** : snapshots de trafic (4 096 convois par monde) et spatial (4 096 et 1 024 par chunk) ; couverture de connaissance (entité unique, ancres 1 024, emprises 65 536) ; demande directe d'un snapshot par le journal quand un delta dépasse la borne de schéma d'un composant.

B, purges concurrentes (`06ed9c6`, 29 octobre) : l'orphelin décrit par l'audit est réel et reproduit. Deux passes de deux processus (chevauchement de déploiement, seconde instance ; un processus n'en lance qu'une à la fois) purgent deux flux dont les lignes expirées partagent un vecteur stocké. En `READ COMMITTED`, chaque suppression du vecteur voit encore la ligne de l'autre, non validée : les deux le gardent, puis plus aucune ligne ne le référence et aucune passe ne le revisite. La référence pendante (« Missing synchronization batch ») reste impossible : la FK 059 refuse de supprimer un vecteur référencé, les lecteurs lisent lignes et vecteurs dans un même instantané `REPEATABLE READ`, et une publication crée toujours un nouveau vecteur.
- **Correctif** : chaque transaction de rétention prend d'abord un verrou consultatif propre à la rétention (`pg_try_advisory_xact_lock`) ; une passe qui le trouve tenu s'arrête, sans attendre. Écrivains et lecteurs ne le prennent jamais. Pas de `SERIALIZABLE` (échecs de sérialisation à rattraper, y compris contre les publieurs au verrouillage du compteur). Un balayage borné (`sweepSyncBatches`, 2 000 vecteurs par passe, curseur sur la clé primaire gardé par la rétention périodique) supprime les vecteurs plus vieux que la rétention qu'aucune ligne ne référence : orphelins hérités et ceux qu'un ancien processus sans verrou laisserait pendant un déploiement. Sans migration.
- **Preuves** (`sync-v2-retention.integration`, 11 tests) : entrelacement forcé par une barrière consultative, attente lue dans `pg_locks` et `pg_blocking_pids` ; sur l'ancien code les deux passes sont en attente ensemble et le vecteur reste (rouge), après correctif la seconde passe rend la main sans attendre et le vecteur part avec la dernière ligne. Nouveau comportement, rouge sur l'ancien code qui purgeait quand même : passe et balayage s'arrêtent tant qu'un autre processus tient le verrou. Rollback : une erreur injectée après la suppression de la ligne, la montée du plancher et celle du vecteur (constatées dans le message d'erreur) restaure les trois tables à l'identique ; ce test passait déjà, la transaction par flux était atomique. Vertes ensuite, une par une : `sync-v2-journal`, `sync-v2-writers`, `sync-v2-shared-writers`, `presentation` ; `tsc --noEmit` API, eslint, prettier.
- **Mesures** (base de test locale, machine chargée, deux séries) : transaction d'un flux qui retire 2 000 lignes, 29 à 54 ms en ligne et 86 à 199 ms avec 2 000 vecteurs ; un publieur du même flux attend cette transaction (97 à 166 ms), comme avant le correctif. Passe de 200 flux × 30 lignes : 2,2 s, soit environ 11 ms par flux. Balayage de 60 000 vecteurs (20 000 orphelins) : 31 appels, médiane 45 ms, maximum 82 ms ; sans orphelin, médiane 21 ms. Passe et balayage qui trouvent le verrou tenu : 135 ms, sans attente (requête des candidats).

Tranché le 29 octobre (`b4e9316`) : risque latent, pas un bug vivant. Toute écriture serveur sur `woodland_trees` met aussi à jour `woodland_deposits`, déjà publié. Un déclencheur V2 sur `woodland_trees` (migration 070) publie désormais la même référence, au cas où une ligne d'arbre changerait seule ; test d'intégration rouge avant, vert après.

## Références par village sur alpha (snapshot privé, limite 4 096)

| Village | Cohortes | Bâtiments (×2) | Parcelles | Total approché | Part |
|---|---|---|---|---|---|
| Pinkystan | 9 | 659 | 524 | 1 866 | 46 % |
| Catmark | 62 | 323 | 510 | 1 237 | 30 % |
| Arkham | 562 | 264 | 90 | 1 195 | 29 % |
| Petibonom | 36 | 148 | 263 | 610 | 15 % |
| GemussGarten | 33 | 160 | 234 | 602 | 15 % |
| Debug | 26 | 5 | 2 | 44 | 1 % |

Les bâtiments comptent deux fois (`buildings` et `restHousing`). Arkham illustre la fragmentation des cohortes d'habitants.

## Ordre proposé

1. ~~Vérifier la publication V2 d'un retrait de souche (S).~~ Fait (`b4e9316`).
2. ~~Audit B~~ fait (`06ed9c6`) ; ~~C1 côté client~~ fait (`25b2ea0`, `447b455`).
3. Références : ~~`restHousing` limité aux logements~~ fait (`ce7a646`) ; ~~pagination du snapshot privé~~ faite le 29 octobre, à valider (section « Audit sync »).
4. Autonomie de l'énergie et du repos (M), puis lectures pures : bootstraps et flux sans réveil (S à M).
5. Commandes V2 sans `state()` : exploitation avec jardins, nivellement, voirie hors routes (L, par famille).
6. Installation en V2 (M), observation NOC sur les lecteurs V2 (M à L).
7. Lot I : retrait des branches et replis V1, `/events`, `GET /village`, projections ; réponse 426 ; migration de nettoyage après la fenêtre de rollback.

Étude séparée : fusion des cohortes identiques (population).
