# Reprise — état au 31 octobre 2026

Index court : une ligne par chantier, le détail est dans la spec ou l'inventaire liés. Preuves, mesures et incidents des tranches : [archive du 30 octobre](docs/HANDOFF-ARCHIVE-2026-10-30.md) (et [celle du 23](docs/HANDOFF-ARCHIVE-2026-10-23.md)). Changelog des versions alpha : [docs/CHANGELOG-ALPHA.md](docs/CHANGELOG-ALPHA.md).

## Environnements

- Branche `wip/v2-commandes-bornees`, poussée. **Alpha** : `alpha-2026.10.29.1` (bois par arbre, migrations jusqu'à 069). **Staging** : `staging-2026.10.30.2` (`d7eb743` : pagination du snapshot V2, énergie et repos par le worker, migrations 070-071), validé par Tristan ; village Test forgé à 4 509 cohortes, à garder.
- **Prochain alpha** : une seule grosse mise à jour (décision de Tristan du 31 octobre) : démolition des bâtiments, nouvelle voirie (S1-S4), terraformation reprise. Elle portera les migrations 070 à 076 (075 n'existe pas : migrations strictement ordonnées) et deux conversions à répéter sur une copie de l'alpha : routes en cases (076, comptage `apps/api/src/road-conversion-count.ts`, lecture seule, accord de Tristan requis) et réseau de trajets `network-3` (recalcul une fois par village).
- **Dev local** : API lancée avec `JOURNEY_ENABLED=1` (journal des parcours actif) ; migrations jusqu'à 076 appliquées (routes de Bressuire, Clairière, Les Collines converties ; Bressuire garde 1 pierre rendue par la répétition, avant la décision « on ne rend rien »).

## Avant la mise à jour alpha, dans l'ordre (31 octobre)

1. **Démolition immédiate** ([spec §9](docs/SPEC-DEMOLITION.md), [décisions](docs/DECISIONS-DEMOLITION-2026-10-30.md)) : livrée le 31 octobre, **à valider** en recette sur le dev (migration 077 appliquée). Indisponible pendant l'installation (V1).
2. **Terraformation : reprise de l'UX** (à spécifier avec Tristan), avec 5b, nivellement et terraformation sans `state()` ([inventaire](docs/INVENTAIRE-SYNC-V2-2026-10-29.md), étape 5).
3. **Voirie** ([spec](docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md)) : S1 à S4 validés le 30 octobre ; épaisseur de la terre manuelle corrigée sur sol plat, à revoir en recette.
4. **Préparer la mise à jour** : répéter les conversions 076 et `network-3` sur une copie de l'alpha, puis déployer.

## Après la mise à jour (backlog)

- **Voirie** : S5 (factory : buissons, tonneau, modèles de placette 2 × 2 et de place 3 × 3 avec leurs ancrages ; Tristan modélise les éléments dans Blender), S6 (achat des places dans le HUD), un accessoire manuel peut remplacer un brasero automatique (souhait validé), raccord des routes de terre en pente ([dette](docs/DETTE-TECHNIQUE.md)).
- **Synchro V2** ([inventaire](docs/INVENTAIRE-SYNC-V2-2026-10-29.md)) : installation en V2, NOC sur les lecteurs V2, lot I (retrait de la V1, 426, migration de nettoyage ; voirie hors routes à passer en V2 avant), pagination des snapshots de trafic et spatial, couverture de connaissance (1 024 ancres). Proposé, non tranché : tri des autres appels à `state()` (construction, marché, présentation).
- **Tranche trajets** (validée, à spécifier) : le coût ×30 des jardins pousse des trajets vers la recherche fine complète (2,3 à 6,2 s, 32 000 à 37 000 nœuds sur Bressuire, cases 216,213 et 229,220).
- **Sortir le worker du processus de l'API** (décision du 29 octobre) : service à part, sans pool. Idée : jauge de retard par village façon RCI.
- **Observabilité des parcours** ([conception](docs/DESIGN-OBSERVABILITE-PARCOURS.md)) : A et C validés ; restent B (présence par minute, prochain numéro de migration libre après 076) et D (événements client) ; purge des `sessions` expirées, flux V2 dans la télémétrie du NOC. Activation sur alpha : feu vert de Tristan.
- **Reçus de récolte par le flux V2** : le « +500 » dès que le worker a traité l'intention, sans la relève à la seconde de `readHarvestReceipts`.
- **Défrichage plus rapide** : le plafond de 8 chantiers contraint le défrichage arbre par arbre.
- **Performance du rendu** : le rendu Babylon de base fait 50 à 80 ms par image sur la machine de Tristan ; principale source des images > 100 ms restantes.
- **Étude karma, territoire et combat** : [docs/ETUDE-KARMA-VOISINAGE.md](docs/ETUDE-KARMA-VOISINAGE.md), arbitrages ouverts au §5.

## À valider (recette de Tristan)

Aucune tranche en attente.

Validés le 30 octobre sur staging : pagination du snapshot privé, énergie et repos par le worker. Validés le 30 octobre sur dev : routes à la case S1, S2a-d, ancrages S4a-b, conversion des routes S3 (076), exploitation des jardins sans `state()` (5a), image longue après publication V2 et réconciliation paresseuse, journal des parcours et page « Parcours » du NOC (A, C).

## Règles et repères durables

- Pas de remboursement par défaut (retrait, style moins cher, démolition, conversion). Les accessoires bloquent le passage.
- Migrations strictement ordonnées (pas d'`allowUnorderedMigrations`). Prettier seulement sur ses fichiers ; `.claude/` est ignoré.
- Agents en parallèle sur la branche : `git commit -- <fichiers>`, jamais deux suites qui réinitialisent `arbestra_test` en même temps.
- Chaîner commit, push et tag avec `&&`, jamais `;`. Tests sensibles à l'ordre des lignes : toujours un `ORDER BY`.
- Diagnostic : `localStorage['arbestra:timing']='1'` (Server-Timing V2), `localStorage['arbestra:dev']='1'` (laboratoire de rendu en production), source maps publiées, profil JS sur les pages monde. VPS : session PuTTY `VPS` via `plink`.
- Suite complète en CI (4 tranches) ; les déploiements rejouent la suite sur le commit taggé.
