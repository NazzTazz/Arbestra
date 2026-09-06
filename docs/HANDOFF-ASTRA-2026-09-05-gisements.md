# Handoff Astra — finition de l’exploitation de pierre

Date : 5 septembre 2026. Base Git : `4dfd494` + worktree antérieur habitants/Jardins et première implémentation Terra. **Livraison technique hors UI React terminée ; intégration React et acceptation visuelle à Tristan.** Aucun commit/push. La migration de développement a été appliquée ensuite à la demande explicite de Tristan, sans reset ni seed.

Références : [spec approuvée](SPEC-ASTRA-2026-09-05-EXPLOITATION-GISEMENTS.md), [appels et branchement React](API-EXPLOITATION-GISEMENTS.md). Le présent handoff remplace la déclaration de clôture prématurée de Terra. Les modifications antérieures du worktree ne doivent pas toutes être attribuées à cette finition.

## Ce qui fonctionne dans le code livré

- Pierre non renouvelable, quantité initiale déterministe 750–1250, lot jusqu’à100, N=1..10, durée ceil(600000/N) ms, dernier lot partiel accepté à durée identique.
- Réservation atomique, travail persistant, notification dédiée, achèvement idempotent dans la réconciliation commune. R restant, S engagé, disponible R−S ; débit R/S et crédit village dans la même transaction.
- Village verrouillé, H pris après acquisition, tous les gisements dus et cible triés par UUID canonique et verrouillés avant traitement chronologique. Aucun verrou de notification existante depuis le métier ; aucun village adverse acquis.
- `population/work.ts` partage matérialisation, disponibilité, split et libération entre Jardin et pierre. Effectifs/origines/restes conservés ; exact zéro déclenche le repos, reste positif sous un point laisse idle. Repas/repos et les deux travaux s’excluent correctement. Les compteurs du snapshot utilisent l’activité projetée.
- Le GET détail calcule accès, bord, protection, lot et options selon l’énergie actuelle. Les extensions encore réservées ne donnent pas de portée. POST strict, UUID d’intention stable et détection des paramètres conflictuels.
- **POST = `{ villageState, extraction, deposit }`**. Le travail et la cible sont renvoyés même hors viewport ou après retry d’un travail terminé. Les travaux actifs exposent leurs coordonnées serveur pour les figurants. La pierre reste dans `village.resources`.
- La feature épuisée conserve identité et position ; son occupation disparaît et sa trace ne bloque plus `canBuild`. Les conditions SQL des fenêtres toriques sont parenthésées pour préserver le filtrage du monde.
- Babylon : picking `{featureId}`, callback distinct `onFeatureSelected`, sélection par UUID, groupes par pierre, invalidation unitaire, terrain indépendant, roche entamée réduite et roche épuisée retirée. N cubes par extraction propre, aller/travail/retour selon dates serveur, reprise après reconnexion. Les meshes ne créditent rien.

Le pont `VillageScene.tsx` expose le callback optionnel. **`App.tsx` et les menus React n’ont pas été modifiés.** Sans branchement par Tristan, aucun menu d’exploitation n’apparaît encore. La doc API décrit également polling, réponses obsolètes, erreurs et conservation du commandId ; elle ne prétend pas que ces comportements React sont déjà branchés.

## Corrections par rapport à Terra

La signature des révisions avait été ajoutée au terrain au lieu des features : elle reconstruisait le terrain tout en conservant le rocher obsolète. Cette inversion est corrigée, et la fusion entre toutes les pierres remplacée par des groupes par ID. Le picking et les figurants d’extraction, absents, sont ajoutés.

Le snapshot traitait les traces depleted comme des obstacles. Le détail proposait des travailleurs à partir d’une énergie ancienne sans tenir compte des refus du gisement. Le POST ne fournissait pas sa cible hors région. Ces comportements sont corrigés.

La duplication de l’affectation a été remplacée par la petite extraction population prévue. La migration 012 vérifie avant écriture les features existantes : exactement une occupation par pierre available ; données ambiguës, réservées ou épuisées inattendues exigent un diagnostic, pas un backfill arbitraire. Les entiers de pierre sont contrôlés avant sérialisation/crédit.

## Preuves exécutées

`corepack pnpm test` : **77 tests verts, 12 fichiers**, processus terminé avec code0. Comprend les 23 nouveaux tests PostgreSQL de `apps/api/src/modules/deposits/stone-proofs.integration.test.ts`, les suites économiques/Jardin/population antérieures et les tests client/invalidation. Les cinq tests initiaux insuffisants de Terra ont été remplacés par cette suite de preuves.

| Exigence | Preuve réelle |
|---|---|
| A/B | 1000→900/+100 ; 50→0/+50 ; pas de crédit à D−1ms, crédit à D ; énergie de dix minutes exacte |
| C/I | Deux villages/transactions/PID ; attente constatée par `pg_blocking_pids` ; dernier100 refusé au perdant, 150 répartis100/50 ; deux ordres de fin, mêmes stocks et effectifs |
| D/K | Deux handlers appliquant le même sujet avec attente village ; deux workers sur notifications distinctes ; nouvelle commande termine pendant que l’ancienne tâche est détenue |
| E | Fastify.inject authentifié ; retry avant/après fin, même ID ; conflit de paramètres et corps invalides/extra rejetés ; fetch client conserve l’intention et expose code d’erreur |
| F | Trigger test avant crédit : lit R900/S0 déjà débités puis lève l’erreur identifiée ; comparaison complète gisements/travaux/cohortes/stocks/occupations après rollback ; attempts/availableAt, indisponibilité du retry puis succès après déplacement contrôlé d’availableAt |
| G | Fins construction/Jardin/pierre mêlées et égales ; comparaison chronologique via savepoint des stocks, flux, cohortes exactes, réservations et travaux ; H+1ms exclu ; borne d’une transaction ancienne après attente village |
| H | Cible hors snapshot retournée et acceptée grâce à un bâtiment terminé distant ; chantier refusé ; portée torique ; autre monde refusé et absence de fuite dans une fenêtre torique |
| J/N | État depleted/révision transmis, cellule constructible si admissible, construction réelle après épuisement ; bloc3×3 ouvert depuis bord ; clairière protégée refusée ; diff unitaire des features et terrain inchangé |
| L | Deux villages avec ordres temporels X/Y opposés ; attente PostgreSQL forcée sur X ; terminaison et crédits200/200 |
| M | Jardin/pierre/repas/repos exclusifs ; conservation des15 après splits ; énergie exactement suffisante, un quantum positif et un quantum insuffisant ; projection100h comparée par heure sur plusieurs cycles repos/idle |
| Migration/génération | 012 rejouée dans un schéma isolé puis rollback ; quantités déterministes, données existantes inchangées ; deux nouveaux mondes128×128 de même seed donnent mêmes positions/quantités ; monde ready jamais réapprovisionné |

Tests temporels : dates contrôlées et réconciliation sous les verrous requis, aucune attente réelle de dix minutes. Tests concurrents : barrières bornées, PID distincts, observation du blocage, libération/attente des transactions dans finally. Le retry différé est vérifié par refus avant availableAt puis déplacement de cette date sur la base test ; pas par une attente de soixante secondes.

## Mutations de contrôle réellement exécutées puis restaurées

1. Retirer le verrou préparatoire du gisement : C/I échouent, car le perdant lit l’ancien disponible et échoue au guard au lieu de réserver50 ou d’obtenir le refus métier attendu. Le guard seul évite l’overdraw mais ne suffit pas à respecter le résultat de la commande.
2. Inverser le tri des verrous : L échoue sur un **deadlock PostgreSQL effectivement détecté**.
3. Réintroduire les traces depleted dans les obstacles du snapshot : B/J échoue, cellule absente des cellules constructibles.

Chaque mutation a été restaurée dans un finally avant la suite complète verte. Ce sont des contrôles rétrospectifs ciblés ; aucune affirmation de reproduction avant la toute première implémentation Terra. Aucun test visuel navigateur effectué.

## Validation finale et environnement

- Typecheck des quatre packages : vert, terminé avec code0.
- Lint : vert, terminé avec code0.
- Build de production des quatre packages : vert, terminé avec code0. Avertissement Vite habituel sur la taille du chunk Babylon (~1,16 Mo brut).
- Base test : `arbestra_test` via `.env.test`, suffixe vérifié par le helper existant. Aucun secret copié dans ce handoff. Les schémas/trigger des tests sont supprimés ou annulés dans leurs transactions/finally.
- Migration012 : présente sur test ; son backfill révisé a été rejoué en isolation. Appliquée ensuite à la base de développement à la demande explicite de Tristan, sans seed/reset dev.
- Git : worktree non committé, incluant des changements antérieurs. Aucun commit/push.

## Reprise du Product Owner

Brancher le callback et les appels de la [doc React](API-EXPLOITATION-GISEMENTS.md), puis valider sélection, refus, plusieurs figurants, F5 en cours, crédit et épuisement. L’acceptation du parcours visible dépend de ce branchement et de la validation visuelle, distincts de la clôture technique hors React.
