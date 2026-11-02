# Reprise — état au 31 octobre 2026

Index court : une ligne par chantier, le détail est dans la spec ou l'inventaire liés. Preuves, mesures et incidents des tranches : [archive du 30 octobre](docs/HANDOFF-ARCHIVE-2026-10-30.md) (et [celle du 23](docs/HANDOFF-ARCHIVE-2026-10-23.md)). Changelog des versions alpha : [docs/CHANGELOG-ALPHA.md](docs/CHANGELOG-ALPHA.md).

## Environnements

- Branche `wip/v2-commandes-bornees`, poussée, `main` à jour. **Alpha** : `alpha-2026.11.01.1` (1er novembre, `e2eeec4` : route automatique masquée sous les cases de route, plus de périmètre fixe des routes) sur `alpha-2026.10.31.1` (31 octobre : voirie à la case, démolition, terraformation instantanée, migrations 070 à 078 ; conversion 076 : 7 villages, 359 cases de route, 1 case refusée (GemussGarten, terrain), braseros manuels supprimés 100 sur 121 (Catmark 89 sur 90), 21 déplacés ou gardés ; bilan dans `road_conversion_backups`). **Staging** : `staging-2026.10.30.2` ; village Test forgé à 4 509 cohortes, à garder.
- **Prochaine étape** : refonte des réseaux et du pathfinding ([diagnostic](docs/DIAGNOSTIC-NAVIGATION-2026-10-31.md)), puis le backlog ci-dessous.
- **Dev local** : API lancée avec `JOURNEY_ENABLED=1` (journal des parcours actif) ; migrations jusqu’à 081 ; `rc1-dev` converti en sommets partagés le 31 octobre comme l'alpha (sauvegarde préalable dans `../arbestra-backups/`).

## Backlog (après l'alpha du 31 octobre)

- **Voirie** : S5 (factory : buissons, tonneau, modèles de placette 2 × 2 et de place 3 × 3 avec leurs ancrages ; Tristan modélise les éléments dans Blender), S6 (achat des places dans le HUD), un accessoire manuel peut remplacer un brasero automatique (souhait validé), raccord des routes de terre en pente ([dette](docs/DETTE-TECHNIQUE.md)).
- **Synchro V2** ([inventaire](docs/INVENTAIRE-SYNC-V2-2026-10-29.md)) : installation en V2 faite et validée le 1er novembre, lot I ([inventaire du 1er novembre](docs/INVENTAIRE-LOT-I-2026-11-01.md), décisions de Tristan du 1er novembre ; ordre : reçus V2, I.1 et I.2 (validés), I.3 (faite, à valider), I.4, migrations ensuite ; retrait de la V1, 426, migrations de nettoyage ; ancienne voirie, nivellement et terraformation différés retirés le 1er novembre, composante `levelingJobs` retirée ; table `leveling_jobs` et type `leveling-site` à la migration de nettoyage), pagination des snapshots de trafic et spatial, couverture de connaissance (1 024 ancres). Proposé, non tranché : tri des autres appels à `state()` (construction, marché, présentation).
- **Trajets : diagnostic d'architecture rendu** ([diagnostic](docs/DIAGNOSTIC-NAVIGATION-2026-10-31.md), [invariants](docs/DECISIONS-NAVIGATION-2026-10-31.md)) : décisions de game design ouvertes au §7, directions au §8 ; aucun code de navigation modifié.
- **Économie / trajets / responsabilités — étude rendue, propositions en cadrage, mesures à valider** : [complément du 1er novembre](docs/ETUDE-COHERENCE-ECONOMIE-TRAJETS-RESPONSABILITES-2026-11-01.md).
- **Sortir le worker du processus de l'API** (décision du 29 octobre) : service à part, sans pool. Idée : jauge de retard par village façon RCI.
- **Observabilité des parcours** ([conception](docs/DESIGN-OBSERVABILITE-PARCOURS.md)) : A et C validés ; restent B (présence par minute, prochain numéro de migration libre : 082) et D (événements client) ; purge des `sessions` expirées, flux V2 dans la télémétrie du NOC. Activation sur alpha : feu vert de Tristan.
- **Défrichage plus rapide** : le plafond de 8 chantiers contraint le défrichage arbre par arbre.
- **Performance du rendu** : le rendu Babylon de base fait 50 à 80 ms par image sur la machine de Tristan ; principale source des images > 100 ms restantes. [Audit des mécanismes natifs de Babylon](docs/AUDIT-BABYLON-NATIF-2026-10-31.md) : premier prototype proposé, un seul système de particules pour les braseros.
- **Étude karma, territoire et combat** : [docs/ETUDE-KARMA-VOISINAGE.md](docs/ETUDE-KARMA-VOISINAGE.md), arbitrages ouverts au §5.

## À valider (recette de Tristan)

- **Serveur sans synchronisation V1, 426 pour un ancien onglet** (I.3, 1er novembre, [inventaire](docs/INVENTAIRE-LOT-I-2026-11-01.md)) : un onglet resté ouvert sur l'ancien client doit recevoir « Une nouvelle version d'Arbestra est disponible. Rechargez la page. » sur ses commandes et ses lectures, puis fonctionner après rechargement ; parcours complet en V2 recetté sur dev le 2 novembre (deux expéditions de cartographie, récolte de carottes, constructions) ; reste l'ancien onglet.
- **Défrichage plus rapide** (1er novembre, recette restante) : retirer une souche prend une minute de travail pour un habitant, plus le trajet (au lieu de 10 minutes).
- **Flux V2 réveillé par NOTIFY** (2 novembre, migration 080 appliquée sur dev, [inventaire](docs/INVENTAIRE-SYNC-V2-2026-10-29.md#réveil-du-flux-par-notify-2-novembre)) : un changement du worker ou d'une commande arrive au client en quelques dizaines de ms au lieu d'environ 1,5 s ; recette navigateur restante.
- **Nouveautés présentées par l'Oracle** (2 novembre, migration 081 appliquée sur dev, [spec](docs/SPEC-NOUVEAUTES-ORACLE.md)) : à la première connexion d'un compte alpha, une modale de l'Oracle liste ce qui a changé depuis `alpha-2026.11.01.1` ; « Compris » (ou Échap) la ferme pour de bon ; textes à relire ; recette navigateur restante.
- **Marché : liste relue par l'index des offres, plus de minuterie de 5 s** (2 novembre, [inventaire](docs/INVENTAIRE-SYNC-V2-2026-10-29.md#marché--relecture-par-lindex-des-offres-2-novembre)) : à valider sur dev avec deux comptes (une offre publiée ou annulée apparaît dans la liste ouverte de l'autre).
- **Retour immédiat des labels de récolte** (2 novembre, client seul, [spec §6](docs/SPEC-GRAMMAIRE-GESTUELLE.md)) : le « +500 » s'affiche dès le relâchement du geste, le reçu ne montre qu'un correctif (« Raison +0 ») ; recette navigateur restante.

Validés le 1er novembre sur dev : HUD des habitants au contrat V2 (I.1), client sans V1 (I.2, écran de connexion après environ une minute), reçus d'expédition et de récolte par le flux V2 (migration 079), NOC sur les lecteurs V2 (récolte en cours et villageois visibles), installation en V2, installation plus rapide (plan hors du verrou mondial ; le reste des poses du kit est dans la [dette technique](docs/DETTE-TECHNIQUE.md)).

Validés le 30 octobre sur staging : pagination du snapshot privé, énergie et repos par le worker. Validés le 30 octobre sur dev : routes à la case S1, S2a-d, ancrages S4a-b, conversion des routes S3 (076), exploitation des jardins sans `state()` (5a), image longue après publication V2 et réconciliation paresseuse, journal des parcours et page « Parcours » du NOC (A, C).

## Règles et repères durables

- Pas de remboursement par défaut (retrait, style moins cher, démolition, conversion). Les accessoires bloquent le passage.
- Migrations strictement ordonnées (pas d'`allowUnorderedMigrations`). Prettier seulement sur ses fichiers ; `.claude/` est ignoré.
- Agents en parallèle sur la branche : `git commit -- <fichiers>`, jamais deux suites qui réinitialisent `arbestra_test` en même temps.
- Chaîner commit, push et tag avec `&&`, jamais `;`. Tests sensibles à l'ordre des lignes : toujours un `ORDER BY`.
- Diagnostic : `localStorage['arbestra:timing']='1'` (Server-Timing V2), `localStorage['arbestra:dev']='1'` (laboratoire de rendu en production), source maps publiées, profil JS sur les pages monde. VPS : session PuTTY `VPS` via `plink`.
- Suite complète en CI (4 tranches) ; les déploiements rejouent la suite sur le commit taggé.
