# Reprise — état au 9 novembre 2026

Index court : une ligne par chantier, le détail est dans la spec ou l'inventaire liés. Preuves, mesures et incidents des tranches : [archive du 30 octobre](docs/HANDOFF-ARCHIVE-2026-10-30.md) (et [celle du 23](docs/HANDOFF-ARCHIVE-2026-10-23.md)). Changelog des versions alpha : [docs/CHANGELOG-ALPHA.md](docs/CHANGELOG-ALPHA.md). Rapports, incidents et specs clos : [docs/old/](docs/old/README.md).

## Environnements

- Branche `wip/v2-commandes-bornees`, poussée, `main` à jour. **Alpha** : `alpha-2026.11.05.1` (5 novembre : routes en pente, verrous par zone, R3 et R1, sans migration) sur `alpha-2026.11.04.1` (4 novembre, `5dbfeee` : fin de la synchro V2, I.3 et I.4, terraformation au pinceau, nouveautés de l'Oracle, migrations 079 à 081, [changelog](docs/CHANGELOG-ALPHA.md)) sur `alpha-2026.11.01.1` (1er novembre, `e2eeec4` : route automatique masquée sous les cases de route, plus de périmètre fixe des routes) sur `alpha-2026.10.31.1` (31 octobre : voirie à la case, démolition, terraformation instantanée, migrations 070 à 078 ; conversion 076 : 7 villages, 359 cases de route, 1 case refusée (GemussGarten, terrain), braseros manuels supprimés 100 sur 121 (Catmark 89 sur 90), 21 déplacés ou gardés ; bilan dans `road_conversion_backups`). **Staging** : `staging-2026.11.05.2` (`688c420` : verrous de zone, R3 et R1, routes qui suivent le terrain pierre comprise, outil de test de charge ; depuis le 3 novembre, correctifs de rendu terraformation et vue régionale, campagne de mesures dans le tiroir de dev, [guide](docs/GUIDE-DEVELOPPEUR.md) §6) ; village Test forgé à 4 509 cohortes, à garder.
- **Prochaine étape** : refonte des réseaux et du pathfinding ([diagnostic](docs/DIAGNOSTIC-NAVIGATION-2026-10-31.md)), puis le backlog ci-dessous.
- **Dev local** : API lancée avec `JOURNEY_ENABLED=1` (journal des parcours actif) ; migrations jusqu’à 081 ; `rc1-dev` converti en sommets partagés le 31 octobre comme l'alpha (sauvegarde préalable dans `../arbestra-backups/`).
- **Poste de secours (PC de Marie, à partir du 9 novembre)** : installation par `scripts/dev-setup-windows.ps1` ([guide](docs/GUIDE-DEVELOPPEUR.md) §9) ; base dev du 9 novembre dans `../arbestra-backups/dev-2026-11-09-pc-marie.dump` (39 Mo, hors dépôt, à copier à la main ; option `-Dump`) ; études herbe et scierie poussées sur `etude/tuiles-herbe` et `etude/scierie-factory`.

## Backlog (après l'alpha du 31 octobre)

Ordre proposé et dépendances : [feuille de route](docs/ROADMAP.md) (4 novembre).

- **Test de charge** (à faire : passage sur staging, branche `load-test`) : outil `apps/load-test` validé en local le 4 novembre ; procédure staging et décisions de Tristan dans [docs/TEST-DE-CHARGE.md](docs/TEST-DE-CHARGE.md) §7 et §9.

- **Voirie** (S5 et S6 après l'alpha, décision du 3 novembre) : S5 (factory : buissons, tonneau, modèles de placette 2 × 2 et de place 3 × 3 avec leurs ancrages ; Tristan modélise les éléments dans Blender), S6 (achat des places dans le HUD), un accessoire manuel peut remplacer un brasero automatique (souhait validé).
- **Synchro V2** ([inventaire](docs/INVENTAIRE-SYNC-V2-2026-10-29.md)) : installation en V2 faite et validée le 1er novembre, lot I ([inventaire du 1er novembre](docs/INVENTAIRE-LOT-I-2026-11-01.md), décisions de Tristan du 1er novembre ; ordre : reçus V2, I.1 et I.2 (validés), I.3 (validée le 3 novembre), I.4 (faite, à valider), migrations ensuite ; retrait de la V1, 426, migrations de nettoyage ; ancienne voirie, nivellement et terraformation différés retirés le 1er novembre, composante `levelingJobs` retirée ; table `leveling_jobs` et type `leveling-site` à la migration de nettoyage), pagination des snapshots de trafic et spatial, couverture de connaissance (1 024 ancres). Proposé, non tranché : tri des autres appels à `state()` (construction, marché, présentation).
- **Trajets : diagnostic d'architecture rendu** ([diagnostic](docs/DIAGNOSTIC-NAVIGATION-2026-10-31.md), [invariants](docs/DECISIONS-NAVIGATION-2026-10-31.md)) : décisions de game design du §7 tranchées le 10 novembre ([décisions 7 à 11](docs/DECISIONS-NAVIGATION-2026-10-31.md#décisions-de-game-design-du-10-novembre-2026)) ; [spec de la refonte](docs/SPEC-REFONTE-TRAJETS-2026-11-10.md) proposée et auditée le 10 novembre, 8 points à valider par Tristan (§8) ; aucun code de navigation modifié.
- **Économie / trajets / responsabilités — étude rendue, propositions en cadrage, mesures à valider** : [complément du 1er novembre](docs/ETUDE-COHERENCE-ECONOMIE-TRAJETS-RESPONSABILITES-2026-11-01.md).
- **Sortir le worker du processus de l'API** (décision du 29 octobre) : service à part, sans pool. Idée : jauge de retard par village façon RCI.
- **Observabilité des parcours** ([conception](docs/DESIGN-OBSERVABILITE-PARCOURS.md)) : A et C validés ; restent B (présence par minute, prochain numéro de migration libre : 082) et D (événements client) ; purge des `sessions` expirées, flux V2 dans la télémétrie du NOC. Activation sur alpha : feu vert de Tristan.
- **Défrichage plus rapide** : le plafond de 8 chantiers contraint le défrichage arbre par arbre.
- **Performance du rendu** : le rendu Babylon de base fait 50 à 80 ms par image sur la machine de Tristan ; principale source des images > 100 ms restantes. [Audit des mécanismes natifs de Babylon](docs/AUDIT-BABYLON-NATIF-2026-10-31.md) : premier prototype proposé, un seul système de particules pour les braseros.
- **Vue Régions comme carte du monde** (orientation du 3 novembre, [spec](docs/SPEC-VUES-TERRAIN-REGION-MONDE-TORIQUE.md) en tête) : tore inchangé ; prochaine tranche visuelle après la V2 : Régions détaillée (brume, villageois en transit), HUD monde, expéditions depuis la carte ; cinématique Astronomie 1 proposée.
- **Étude karma, territoire et combat** : [docs/ETUDE-KARMA-VOISINAGE.md](docs/ETUDE-KARMA-VOISINAGE.md), arbitrages ouverts au §5.

## À valider (recette de Tristan)

- **Campagne de mesures dans le tiroir de dev** (3 novembre, staging et alpha, [guide](docs/GUIDE-DEVELOPPEUR.md) §6) : à lancer par Tristan (MX230) et sur la machine d'un ami ; comparer les JSON.

Validés le 5 novembre et déployés sur l'alpha : verrous par zone, R3 et R1 ([carte](docs/VERROUS-2026-11-04.md), relus deux fois en contre-revue ; R2 lié à la refonte des trajets) ; sur staging, routes manuelles qui suivent le terrain, pierre comprise, et jonction avec les routes automatiques ([spec voirie §4.6](docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md)). Validés le 3 novembre sur dev : outil de terraformation (§7 à §7.14, correctifs de rendu et vue régionale compris), serveur sans V1 et 426 (I.3), défrichage à une minute par souche, flux V2 réveillé par NOTIFY (080), nouveautés de l'Oracle (081), marché relu par l'index des offres, retour immédiat des labels de récolte.

Validés le 1er novembre sur dev : HUD des habitants au contrat V2 (I.1), client sans V1 (I.2, écran de connexion après environ une minute), reçus d'expédition et de récolte par le flux V2 (migration 079), NOC sur les lecteurs V2 (récolte en cours et villageois visibles), installation en V2, installation plus rapide (plan hors du verrou mondial ; le reste des poses du kit est dans la [dette technique](docs/DETTE-TECHNIQUE.md)).

Validés le 30 octobre sur staging : pagination du snapshot privé, énergie et repos par le worker. Validés le 30 octobre sur dev : routes à la case S1, S2a-d, ancrages S4a-b, conversion des routes S3 (076), exploitation des jardins sans `state()` (5a), image longue après publication V2 et réconciliation paresseuse, journal des parcours et page « Parcours » du NOC (A, C).

## Règles et repères durables

- Pas de remboursement par défaut (retrait, style moins cher, démolition, conversion). Les accessoires bloquent le passage.
- Migrations strictement ordonnées (pas d'`allowUnorderedMigrations`). Prettier seulement sur ses fichiers ; `.claude/` est ignoré.
- Agents en parallèle sur la branche : `git commit -- <fichiers>`, jamais deux suites qui réinitialisent `arbestra_test` en même temps.
- Chaîner commit, push et tag avec `&&`, jamais `;`. Tests sensibles à l'ordre des lignes : toujours un `ORDER BY`.
- Diagnostic : `localStorage['arbestra:timing']='1'` (Server-Timing V2), `localStorage['arbestra:dev']='1'` (laboratoire de rendu en production), source maps publiées, profil JS sur les pages monde. VPS : session PuTTY `VPS` via `plink`.
- Suite complète en CI (4 tranches) ; les déploiements rejouent la suite sur le commit taggé.
