# Corrections des expéditions RC1 — 12 octobre 2026

Base : main 7fa926f. Demande : corriger les bugs de la [contre-recette](CONTRE-RECETTE-EXPEDITIONS-RC1-ASYNCHRONES-2026-10-12.md), chercher des optimisations locales, vérifier puis commit/push.

## Résultat

Les trois réserves fonctionnelles sont corrigées :

- **R1 — provenance du relevé.** Un passage actualise les observations mais conserve la mission qui a réellement relevé le lieu. Un nouveau relevé terminé renouvelle cette provenance. Les accès reconnus survivent aux trajets ultérieurs comprimés et fractionnaires.
- **R2 — passage engagé.** Construction et équipements protègent la bande piétonne, avec la demi-largeur 1/16 partagée avec le solveur. La marge ferme les frontières de cellules ; les coutures X/Y/coin et une voie adjacente libre sont testées. La vraie commande de construction refuse l’emprise litigieuse, sans débit ni réservation.
- **R3 — rappel répété.** La liste de lieux à relever, vidée par le premier rappel, identifie un retour déjà engagé. Un deuxième rappel conserve toute l’activité et son échéance : le retour reste à H+10.4 s, au lieu de passer à H+12.2 s. Le retour naturel après un relevé conserve aussi son rapport.

Aucune migration, règle de population, nouvelle interaction ou modification du solveur A*.

## Optimisations et mesures

Mesure par plugin Kysely sur les vraies transactions d’un monde privé, avec vérification du rapport produit. Même cas exécuté avant correction (échec attendu au plafond de requêtes), puis après :

| Travail ciblé | Avant | Après |
| --- | ---: | ---: |
| Lectures des lieux connus pendant la commande explore | 2 | 1 |
| Lectures de chunks pour le rapport de retour | 2 | 1 |
| Écritures des lieux pour ce rapport de cinq cellules | 2 | 1 |

La lecture supprimée au départ chargeait toute la connaissance du joueur. Survey utilise maintenant la clé monde/joueur/coordonnées ; explore n’effectue plus cette lecture. L’initialisation locale conserve son contrôle ponctuel de l’ancre.

Au retour, cellules traversées et lieu relevé sont dédupliqués puis écrits ensemble, toujours par lots de 500. Le terrain RC1 est préparé une fois pour ce rapport ; chaque mesure de cellule est calculée une fois. L’expansion du trajet en cellules parcourues est également réutilisée pour les observations de villages étrangers.

Ces gains portent sur les opérations mesurées ; ils ne signifient pas une division par deux de la latence totale de l’API.

## Vérifications exécutées

- Quatre régressions intégrées : échecs observés avant correction, puis réussites après. Elles couvrent les deux formes de trajet pour R1, l’emprise de R2 et le rappel de R3.
- 25 tests DB expéditions verts : protocole, concurrence, rollback, SSE, rappel, provenance et mesure SQL. Contrôle de construction renforcé ensuite et rejoué vert.
- Tests purs : 3 protection de passage, 8 accès terrain, 21 infrastructure/navigation, 10 solveur, 4 travel et 2 reçus, tous verts.
- 24 tests de représentants Babylon NullEngine verts.
- Trajet réel RC1 (140,20) → (124,39), chaque segment certifié contre le terrain autoritaire : vert en replay isolé, premier intervalle compute.run 3 481 ms, puis 9.45/7.53/9.24 ms avec cache.
- Build contracts, types API/client et builds API/client verts ; lint ciblé vert. Vite signale les gros chunks habituels.

**Exécution initiale groupée : 97 réussites et un échec RC1 par budget CPU dépassé**, avec des compilations concurrentes. Après leur fin, replay du seul RC1 et du contrôle de construction renforcé : 2 réussites, sortie 0. Aucun budget ni assertion du solveur n’a été relâché. Les 98 cas distincts ont donc passé ; la première campagne n’est pas présentée comme entièrement verte.

Commandes : corepack pnpm --filter @arbestra/contracts build ; vitest run --configLoader runner avec les fichiers ci-dessus ; API typecheck/build ; world-web typecheck ; eslint des six fichiers TypeScript touchés. Client construit par vite build --configLoader runner après son typecheck. Le shim Windows os.userInfo reste local et ignoré. Logs détaillés dans apps/world-web/test-results/expedition-fixes-*.log et expedition-sql-before.log.

DB : fixtures UUID privées de arbestra_test, nettoyées, suites exécutées séquentiellement, aucun reset global. Les anciennes suites infrastructure/garden-review réinitialisent la base partagée : elles n’ont pas été lancées ; le contrôle de construction réel et les suites géométriques ont été vérifiés dans la fixture privée.

## Limites et état de livraison

Cette correction clôt les réserves fonctionnelles R1–R3. Les réserves de preuve de la tranche globale restent distinctes : plafond de données de navigation 256 Mio, endurance/équité sous saturation, corpus froid complet et délai commit→activité visible. Pas de nouvelle campagne de charge à 1 000 probes ni de recette navigateur complète dans cette correction serveur ; les contrôles NullEngine ne prouvent pas le picking/réseau réel.

La protection des emprises inclut une petite marge conservatrice aux extrémités du trajet. Les rapports existants ne sont pas réécrits par migration ; un nouveau relevé réel renouvelle sa preuve d’accès.

API QA privée 3198 relancée sur le build corrigé ; /api/health HTTP 200 vérifié. La recette utilisateur 5278 et les bases dev/production sont préservées. Migration 042 reste appliquée en test uniquement.

Publication sur main vers origin/main autorisée par Tristan. Les changements ressources IG, le transcript et le cache préexistants sont exclus. Le hash final et le résultat du push sont donnés à la livraison.
