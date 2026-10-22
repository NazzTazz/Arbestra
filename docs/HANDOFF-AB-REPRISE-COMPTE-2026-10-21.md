# Passation courante — 22 octobre 2026, arrêt demandé pour quota

Tristan demande de finir rapidement la tranche en cours et de préparer la reprise après renouvellement du quota. **A/B restent incomplets.** Cette section prévaut sur tous les points historiques ci-dessous. Aucun déploiement, commit, push ni migration de développement. Branche `main`, HEAD `4966379`, modifications non commitées ; conserver la spec documentaire initiale et les fichiers personnels non suivis.

## Tranche serveur et transport

- Routes V2 réellement enregistrées : GET bootstrap, POST sync/read et sync/stream, négociation `x-arbestra-protocol: 2`, authentification, captures cohérentes, fermeture SSE et reprise par curseurs. Bootstrap conserve une réconciliation explicite avant capture. Inventaire porté à 109 routes.
- Atelier V2 : commande bornée, publication terminale, ACK typé avec effets privés projetés à H dans la transaction, reçu original au rejeu sans nouvelle publication. Les effets ACK n'avancent pas le curseur canonique.
- Rattrapage : rollback complet de la commande dépassant son budget, réveil économique distinct durable/dédupliqué, 503 `SCOPE_CATCHING_UP` + Retry-After, même UUID à réessayer. Worker raccordé, continuations bornées ; aucune intention métier pending. `lastTransitionAt` n'est pas une frontière de complétude.
- Terrain ciblé : lecture du chunk et halo, sans agrégat géométrique global ni lecture des ressources naturelles. Parité aux coutures du tore testée sur les deux modèles RC1.
- Transport client autonome ajouté (`sync-v2-transport.ts`) : bootstrap, session SSE, resynchronisation, génération/abort, intentions atelier conservées en sessionStorage après 503 ou interruption. **Pas raccordé à React**. Le prototype de projection de vue incomplet a été retiré ; ne pas chercher un adaptateur prêt à brancher.
- **053–056 enregistrées et appliquées uniquement à 127.0.0.1/arbestra_test.** La couverture complète et la recette de B restent à prouver avant toute activation hors test.

## Corrections et précautions pour la reprise

054 reconstruisait chaque feature en relisant le gros artefact RC1 : remplacé par un backfill ensembliste par monde, réutilisé lors du remplacement de source. 053 vérifiait répétitivement les touches au COMMIT : sortie immédiate quand la publication terminale est déjà faite ; les mutations tardives restent interdites. Après application initiale de 053 en test, sa fonction `game_sync_assert_published` a été réalignée sur le SQL corrigé du fichier, sans nouvelle migration ni changement du registre. Revalider une installation fraîche des migrations avant clôture.

Les resets globaux deviennent coûteux avec les triggers actifs ; le test atelier HTTP utilise un monde isolé 64 × 64. Éviter de charger tout `game_sync_changes` pour comparer un rejeu : comparer les compteurs bornés du monde. Deux requêtes de test bloquant longtemps ont été annulées après vérification de leur PID et requête ; aucun processus utilisateur n'a été arrêté.

## Preuves acquises (passes distinctes)

Artefacts ignorés sous `test-results/command-sync/`, ne pas les committer.
- Atelier/rattrapage : 26/26 puis 2/2, code 0, avant activation finale des triggers (`catchup-processing-retry.log`, `catchup-command-validation.log`).
- Terrain RC1 + spatial : 15/15, code 0 (`v2-ground-validation.log`).
- Écrivains partagés 7, routes 2 et inventaire 1 ont passé dans une exécution globale échouée sur le timeout de l'ancienne fixture atelier : ne pas annoncer cette exécution entièrement verte.
- ACK/rejeu au niveau service : 1/1, code 0 (`v2-processing-bounded-validation.log`), avant passage du test aux routes HTTP.
- Session/transport client : 6/6, code 0 (`v2-client-transport-retry.log`).
- Dernière validation HTTP/SSE et vérifications de types : résultat final consigné dans la note de clôture ci-après. Les premiers essais ont révélé des conflits de fixtures avec les triggers d'initialisation et un argument `current` manquant dans le lecteur SSE du test ; corrigés.

## Validation finale de la tranche

- HTTP atelier + vraie socket SSE : **2/2, code 0**, `v2-processing-http-sse-final.log`. Start/pause/cancel, ACK inversés, rejeu et delta après coupure entre lecture et connexion vérifiés.
- Lint ciblé serveur/contrats/transport : **code 0**, `handoff-lint.log`. `git diff --check` : code 0.
- Vérification des types : champ obligatoire `constructionDurationOverrideMs` absent de la fixture HTTP, puis valeur `undefined` refusée ; corrigé à `null` conformément au type. **Relance encore en cours lors du handoff**, session outil `32901`, logs `handoff-api-typecheck-null.log` puis `handoff-client-typecheck.log`. Ne pas annoncer ces contrôles verts sans code final. Aucun autre test DB en cours. Cette dernière correction de fixture ne constitue pas une nouvelle validation HTTP.

## Ordre de reprise

1. Lire AGENTS, cette tête de passation et la spec ; vérifier Git et les logs finaux. Ne pas repartir des anciens statuts « migrations non enregistrées » ou « aucune route V2 ».
2. Raccorder React avec une projection complète : composants privés/spatiaux, horloges par composant, cohortes, terrain, jardins, placement et autorisations serveur. Implémenter la récupération groupée des reçus après coupure/rechargement ; le transport expose les intentions mais cette récupération n'est pas encore branchée.
3. Étendre les ACK V2 à la pose/construction ; couvrir reprise/completion worker, concurrence, expiration et reprise des abonnements. Tester le parcours navigateur ordinateur/tactile.
4. Résoudre les plafonds de snapshots (4096 références, 1024 par composant), la pagination et le nombre de scopes (64 courant, 128 spatial dans la spec) sans snapshot faussement complet ; traiter les gros groupes ACK, la rétention et les reçus de rejet.
5. Revalider les écrivains privés après l'optimisation 053, migrations fraîches, rollback métier/journal, concurrence et budgets sous charge. Aucun test DB en parallèle avec un autre partageant ses fixtures.
6. Mesures V2 : 30 répétitions chaudes SQL/temps/octets et coût SSE réellement induit, comparaison aux mesures V1 déjà conservées. **Aucune mesure V2 finale ni validation navigateur V2 acquise.** Puis suites connexes, documentation et bilan.

Les timeouts locaux 2 s verrou / 5 s instruction et le budget 64 transitions / 200 ms doivent encore être éprouvés sous charge. La limite de temps est contrôlée entre transitions ; une première transition peut finir après un préfixe SQL lent. Les validations historiques ne valent pas validation complète des modifications actuelles.

---

# Reprise A/B sur un autre compte — 21 octobre 2026

## Demande et statut

Demande autorisée : lire `AGENTS.md`, `SESSION-HANDOFF.md` et `docs/SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md`, puis **implémenter les lots A puis B avec validations serveur, client, SSE et mesures**. Les modifications documentaires initiales constituent la spec à conserver. **Ne pas déployer.** L'utilisateur a contesté un arrêt prématuré et demandé plusieurs fois de continuer. Le présent arrêt correspond uniquement à sa demande explicite de handoff pour changer de compte ; ce n'est pas une livraison.

**Statut : en cours. B incomplet et non activé. Dernier build API en échec.** Pas de blocage produit identifié : continuer les corrections et l'implémentation sans demander une confirmation de routine. La phrase initiale de la spec « autorise la spécification, pas l'implémentation » est historique et remplacée par la demande courante. Les anciens paragraphes de publication dans le handoff ne donnent pas d'autorisation pour cette tranche.

## Workspace et précautions de reprise

- Workspace : `C:\Users\trist\PhpstormProjects\Arbestra`, PowerShell, branche `main`, HEAD `496637925666b6474a04231d15c368a2d2f8c8a6` (`docs: clarify negotiated command transport and pending client wiring`). Tout le travail A/B est **non commité**, aucun push/déploiement.
- Lire `git status --short`, le dernier commit, AGENTS, cette note puis la spec. Vérifier le code réel avant de poursuivre. Ne pas remettre le worktree à zéro.
- Modifications déjà présentes avant implémentation : `SESSION-HANDOFF.md`, `docs/architecture/{README,economy,village-synchronization}.md` et la spec non suivie. Leur contenu initial doit être conservé. Les nouvelles notes en tête du handoff s'ajoutent à cet historique.
- Fichiers personnels non suivis à laisser intacts : `%SystemDrive%/` et `codex-session-01a07944-0d99-7ab3-9983-b16b69419275.md`.
- `docs/IMPLEMENTATION-COMMANDES-BORNEES-AB.md` est **obsolète** : il décrit encore un prototype plus petit et d'anciens états des migrations. Cette note prévaut pour l'avancement, le code et la spec pour leurs rôles respectifs.
- Base utilisée pour les tests : **127.0.0.1 / arbestra_test**. Aucun reset/migration développement. Vérifier la cible sans afficher les secrets ; ne pas lire les `.env` complets. Aucune suite réinitialisant cette base en parallèle.
- 051/052 enregistrées dans `migrate.ts` et appliquées uniquement à la base de test. **053/054 écrites, non enregistrées**, testées dans des schémas isolés. Ne pas les activer avant fermeture de la couverture et backfill.
- Les processus de développement de l'utilisateur ont été conservés. Ne pas les arrêter au hasard. Les identifiants de sessions outils de l'ancien compte ne sont pas un mécanisme de reprise fiable.
- Les artefacts sont ignorés sous `test-results/command-sync/` et restent locaux au même workspace. La redirection PowerShell produit souvent des logs UTF-16 ; lire avec l'encodage approprié. Ne pas les committer.
- Aucun sous-agent utilisé/autorisé par cette demande. L'implémenteur valide lui-même. Les commandes pnpm ont parfois nécessité une escalade sandbox à cause d'esbuild ; aucun rejet d'approbation à résoudre n'a été constaté.

## Premier point à corriger

Le dernier patch multi-flux est présent : `serveSyncV2Stream` / `serveBatches` dans `sync-v2-stream.ts`, événement `expired` côté serveur et `SyncV2SessionExpired` côté client.

Le dernier build contracts ne montre pas d'erreur et la commande enchaînée a atteint le build API. Celui-ci **échoue avec statut 2** dans `test-results/command-sync/multistream-api-build.log` :

- `sync-v2-capture.ts:33` : deux TS2345, `{ kind: string; key: string }` incompatible avec `SyncScope`.
- `sync-v2-capture.ts:40` : TS2345 sur le curseur, même élargissement de `kind` en `string` au lieu de l'union village/offers/spatial/knowledge/manifest.

Corriger le contrat/typage à la source après lecture, sans contourner la validation runtime. Puis compiler contracts/API et valider capture multi-flux, lecteurs partagés et SSE générique. Les anciens builds verts ne couvrent pas ces derniers changements.

## A — Inventaire, oracle, mesures déjà préparés

- `scripts/audit-command-dependencies.mjs` : inventaire AST direct.
- `scripts/audit-command-closure.mjs` : graphe via TypeScript checker, imports/appels résolus, lectures/écritures/finaliseurs transitifs, cas SQL/callbacks non résolus explicites. `scripts/command-scope-inventory.mjs` classe les tables et projections secondaires. Dernier relevé : 174 sources, 2 311 fonctions, 61 tables écrites ; **de nouveaux fichiers sont apparus depuis**, recalculer en finition.
- `tests/fixtures/command-inventory.json` et `command-inventory.integration.test.ts` : 106 routes réelles, comparaison avec Fastify `onRoute`.
- `scripts/prepare-command-oracle.mjs` extrait avec `git archive` API/contrats du HEAD de départ dans `test-results/command-sync/oracle-4966379`, compile les contrats isolés puis API et réutilise seulement les dépendances tierces.
- `processing-reference.integration.test.ts`, activé par `ARBESTRA_HISTORICAL_ORACLE=1` : compare moteur actuel et historique à H fixe (stocks/cohortes/lots/ordres/tâches, start/pause/completion/resume/cancel/shortage/rejeu), puis projections sélectionnées et snapshot privé dans une même vue READ ONLY. Deux tests précédemment verts. Une seule cohorte éligible dans la fixture évite une différence de départage UUID aléatoire.
- `server-costs.integration.test.ts` : échelles 1/10/100, backlog, variantes avec 30/300 bâtiments réellement placés, vraies sockets Fastify/fetch SSE et reçus. Trente répétitions après chauffe. `scripts/summarize-command-costs.mjs` calcule médiane/p95/max. Relire les options du test avant lancement.

Quelques mesures V1 acquises (Windows local parfois chargé, pas VPS ; SQL = appels driver, pas chaque instruction interne de trigger) :

| Cas | SQL | Octets | Médiane / p95 |
|---|---:|---:|---:|
| Pause V1, 30 bâtiments placés | 81 | 132 691 | 349 / 927 ms |
| Pause V1, 300 bâtiments placés | 81 | 313 560 | 206 / 542 ms |
| Pause avec vraie socket SSE | 138 | 66 727 | 2 122 / 2 332 ms |
| Start avec vraie socket SSE | 147 | 67 433 | 2 141 / 2 462 ms |
| Resume avec vraie socket SSE | 150 | 66 751 | 2 096 / 2 424 ms |
| Reçu connu | 6 | 309 | 31 / 46 ms |
| Reçu inconnu | 6 | 115 | 29 / 37 ms |

Les mesures socket incluent authentification/navigation et polling 2 s. Artefacts : `bounded-baseline-socket-small.json`, `socket-small.log`, `bounded-receipts.json`, `receipts-cost.log` et variantes spatiales medium/large. Ne pas présenter ces nombres comme les performances V2 finales.

Le parcours Playwright `tests/e2e/material-processing.spec.ts` avait terminé 1/1, code 0, sur le transport historique, avec mesures CDP et absence de GET supplémentaire après commandes. **Ce n'est pas une validation navigateur V2.**

## B — Code existant et limites

### Préparation atelier et reçus

`beginProcessingCommand` dans `reconcile-economy.ts` prend le village, relit H et le reçu après verrou. Un rejeu concurrent exact ne réconcilie pas de nouveau ; payload différent refusé. Pause/cancel sans lot échu ne réveillent pas les activités étrangères. Start/resume activés sans transition due évitent terrain/gisements et avancent seulement la population nécessaire. Les prédécesseurs dus passent encore par la fermeture chronologique historique **non bornée**.

`service.ts` emploie ce chemin en mode commit, appelle `commandProcessing`, et ne lance plus le finaliseur d'admissions étrangères. Le mode snapshot historique reste disponible. `processing.ts` conserve orderId/H dans les nouveaux reçus ; sélection d'ordres bornée, ordres terminaux retournés comme valeurs par V2. 052 ajoute le résultat nullable : les anciens reçus sans preuve d'identité restent NULL.

`command-receipts.ts` côté API/contrats et route `POST commands/receipts/read` : max 32 requêtes processing/construction, ownership/world, READ ONLY, résultat/H nullable, inconnus omis, aucun payload métier brut. Validation stricte avant suppression des champs inconnus par AJV. H construction reste null faute de borne historique démontrable.

### Journal et écrivains

051 crée compteurs epoch/révision/floor, collecte transactionnelle, journal par batch/dépendances. Publication explicite terminale avec acquisition triée de tous les compteurs après les écritures/verrous métier. Savepoint/rollback transactionnels, mutation après publication rejetée.

053 couvre les sources privées : village, stocks/flux, cohortes/population, bâtiments/expansions/buffers, jardins/récoltes, extractions/chantiers/cibles/pools/consignes, terrassements, atelier/lots, marché/offres/convois/livraisons, science, accomplissements, infrastructure/installation. Collecte OLD/NEW et propriétaires, publication différée au commit, écritures sans effet filtrées. Emprises d'extension et coordonnées des gisements propagent aussi leurs dépendances. Les reçus sont hors journal de rendu.

054 couvre connaissance/espace/catalogue/offres : occupation, features/gisements/RC1, chunks/sommets/terrasses, bâtiments/villages, science/cartographes/lieux, offres, monde/configuration/catalogues. Coordonnées toriques/chunks canoniques, halos terrain, apparences publiques anonymisées. Changements de visibilité invalidant les cellules/features de portée 16/32 : coût proportionnel à la zone, **ne pas annoncer un coût constant**. Une construction non terminée ne déclenche pas une expansion de connaissance.

**Dernières modifications non revalidées** : activation économique du village invalide le bois ; transitions de bâtiment invalident jardins et ressources dépendant de `building_level_production` ; modification du catalogue invalide stocks/libellés/parcelles concernés. `privateSyncLookupTables` exporte la table catalogue nécessaire aux schémas de test. Les derniers tests verts de 053/054 sont antérieurs à ces ajouts.

Couverture à fermer : lieux scientifiques révélant des gisements sans occupation, dépendances secondaires des suppressions/changements de propriétaire, sources comme clearings/spawn territories/infrastructure selon leurs effets réels sur les lecteurs. Ne pas supposer que le nombre de triggers suffit. Backfill des compteurs et activation complète **absents**. Les mondes/comptes/chunks sans mutation doivent aussi disposer d'epochs stables ; éviter toute prise de compteur au milieu des verrous métier.

### Lecteurs et capture

`sync-v2-readers.ts` couvre 23 composants privés : resources, processingOrders, cohorts, populationSummary, restHousing, buildings, accomplishments, extractionPools, gardenPlots, gardenHarvests, buildingExpansions, extractions, worksites, exploitationOrders, levelingJobs, marketExchanges, tradeOffers, tradeJourneys, scienceActivities, scienceContributions, identity, infrastructure, installation.

Les lecteurs existants economy/pools/extractions/worksites/exploitation/leveling/trade acceptent des sélections. `population/projection.ts` mutualise la projection historique. Snapshot privé explicite distinct du delta, énumération des clés puis lectures communes. Garde-fous 4 096 références / 1 024 par composant ; **pagination pas implémentée**, pas de troncature silencieuse acceptable.

`sync-v2-spatial-readers.ts` : spatialCells/features/ground/exteriors. Pas d'identifiant privé voisin ; extérieur opaque SHA256, géométrie publique autorisée. Sélection de features filtrée avant projection dans `natural-features.ts`. `worlds/terrain.ts` expose `readTerrainProjection` réutilisable dans la transaction de capture. Nouveau snapshot spatial complet par chunk **encore à tester**.

`sync-v2-shared-readers.ts` et contrats associés : knowledgeScience/Places/Coverage ; gameManifest ; offerIndex (invalidation des pages d'offres, pas prétention d'avoir reçu leur contenu). Lecteurs partagés récents **à tester**.

`sync-v2-journal.ts` lit compteur/journal dans la même capture MVCC, détecte epoch/floor/trous/limites, filtre dépendances privées non autorisées. Nouveau `readSubscribedJournal` lit les compteurs de tous les abonnements autorisés en un SQL, puis seulement les journaux modifiés ; capture un sur-ensemble borné de la fermeture (max 64 abonnements). Un trou force un snapshot cohérent de tous ces abonnements. Le caller doit sélectionner les chunks pertinents ; cela ne remplace pas la vérification d'autorisation.

`capturePrivateSync` est une primitive READ ONLY repeatable read, validée sur périmètre privé. Nouveau `captureSyncV2` multi-flux impose private/knowledge/manifest, valide scopes/cursors et capture entités/journal à H commun, avec GUC `arbestra.economy_through`. **Nouveau code non validé, erreurs de compilation décrites plus haut.** Aucune route bootstrap/read/stream de jeu n'est encore raccordée.

### Client et SSE

`packages/contracts/src/sync-v2.ts` : batch atomique, epochs UUID, révisions décimales bornées bigint, contexte/génération, registre de composants par scope, ACK overlay par clé sans avancer le curseur canonique. Doublons/epochs/groupes incomplets ou mélangés invalides rejetés. Groupe dépassé combiné à un groupe en attente => resync. Batch entièrement couvert => ignored. Reprise avec epoch différente exige nouvelle génération/base vide. Les interactions complexes d'overlays ACK multi-groupes restent à vérifier.

`packages/contracts/src/sse-reader.ts` : UTF-8 fatal incrémental, CR/LF, commentaires/multilignes, limites mémoire, abort/cancel/release, garde de génération, fin de trame tronquée ignorée, aucun curseur dérivé de l'id SSE. Réexport web.

`apps/world-web/src/api/sync-v2-session.ts` : session fetch POST, credentials, content-type, application atomique, curseurs issus de la base appliquée, abort lors de fermeture/remplacement. Dernier ajout scopes et événement expired non revalidé. **Module pas branché à App/React** ; orchestration reconnect/receipts/restauration encore à faire.

`sync-v2-stream.ts` : primitive SSE réelle, capture avant hijack, polling single-flight 2 s, pas de transaction DB maintenue sur socket, backpressure/drain borné, frame 256 KiB / queue 1 MiB, reset explicite, récupération sans NOTIFY. Primitive privée testée en vraie socket. Dernière généralisation multi-flux et expired **à tester**. Les routes utilisées par le test sont un harness, pas les routes V2 de l'application.

## Preuves acquises, sans extrapolation aux derniers patches

Comptes distincts, ne pas les additionner pour fabriquer une suite globale. Les résultats ci-dessous correspondent à leurs étapes, pas à une campagne finale sur le diff courant.

| Validation | Résultat acquis / trace locale |
|---|---|
| Atelier, pause/cancel sans admissions, concurrence forcée et H post-attente | 24/24, code 0, `processing-preparation.log` ; régression rouge avant correction |
| Reçus/inventaire/journal à cette étape | 30/30, code 0 ; test HTTP strict corrigé puis vert séparément |
| Oracle historique et lecteurs privés, chantiers | `private-readers-fixed.log`, 26/26 (19 chantiers, 2 oracle, 5 écrivains) ; sixième écrivain ensuite vert |
| Capture privée/auth/isolation/commit sans NOTIFY + vraie socket | 3/3, code 0, `private-real-socket.log` |
| Collecte partagée et capture journal avec dépendances | `shared-closure-validation.log` : 4 tests shared-writers + 9 journal réussis ; résumé final du log relu pendant ce handoff, pas de nouveau run |
| Lecteurs spatiaux, confidentialité voisin, halo terrain, tore | 3/3, code 0, `spatial-readers-clean.log` |
| Contrats spatiaux + session cliente | 12 tests verts à cette étape, `spatial-batch-validation.log` ; modifications ultérieures à revalider |
| Parser SSE partagé | 5 tests verts lors de son introduction |
| Builds/lint antérieurs | Verts sur des sous-ensembles antérieurs ; **build API courant rouge** |

Quatre échecs chantiers ont été reproduits rétrospectivement avec les modules historiques (`worksites-historical-reproduction.log`, `scripts/prepare-worksite-regression.mjs`). Cause : `resetE2eState` ne remet pas l'ancre village à (1024,512). Correction **de fixture seulement**, ancre fixée dans une transaction rollbackée. Pas de changement gameplay attribué à ces échecs.

Premiers échecs spatiaux : fixture sans membership voisin, puis nettoyage monde bloqué par FK gisement. Corrigés avant les 3/3 verts. Premiers échecs shared-writers : fixture utilisant une colonne inexistante `economy_through` ; remplacement par un vrai champ de bookkeeping (`created_at`), `economy_activated_at` étant une dépendance économique réelle. Les nouvelles invalidations dérivées qui en découlent restent à revalider.

## Travail restant et ordre conseillé

1. Corriger les trois erreurs TS du dernier build ; tester les derniers changements dérivés 053/054, shared-readers, snapshots et capture/SSE multi-flux. Relire les guards de visibilité et les autorisations, pas uniquement compiler.
2. Fermer l'audit de tous les écrivains des scopes activés (anciens endpoints, workers, catalogues, sources secondaires). Préparer backfill et barrière d'activation ; enregistrer/appliquer les migrations **sur test uniquement** quand leur couverture est prouvée.
3. Exposer les vrais contrats/routes `GET bootstrap`, `POST sync/read`, `POST sync/stream`, avec négociation/capacités. Conserver le réveil économique legacy au bootstrap jusqu'au lot H, sans prétendre toutes les lectures initiales pures. Une capture initiale ne justifie pas un assembleur global sur les deltas ordinaires.
4. Raccorder ACK V2 atelier et création de bâtiment avec H/transaction/publication cohérents, reçus exacts, scopes privé/spatial atomiques. `construction.ts` est déjà borné historiquement : préserver cette propriété.
5. Implémenter le rattrapage borné **64 transitions / 200 ms**, pending durable et reprise worker. Actuellement, les prédécesseurs dus repassent par la fermeture historique non bornée : c'est un manque majeur de B, pas une optimisation facultative. Préserver ordre échéance/ID/type, fractions, verrous village/gisements et tâches propres au scheduler.
6. Brancher réellement React/client : bootstrap, store/adapter de toutes les données mutables, ACK overlays, transport SSE ciblé, reconnexion depuis curseurs appliqués, changement contexte/génération, récupération des reçus. Aucun abonnement V1 concurrent qui annulerait le gain.
7. Prouver parité/intégration workers, concurrence forcée, rollback nommé après mutations observées, trous/coupures/reload/inversions ACK, confidentialité et vrai parcours navigateur App/Babylon. Les harness actuels ne suffisent pas.
8. Mesurer V2 après chauffe (au moins 30 répétitions, médiane/p95/max), commande **et** SSE/lectures induites, tailles/petites-grandes fixtures/backlog. Budgets proposés pause 12 SQL / ACK 4 KiB, delta 12 SQL, reçus 6 SQL / 2 KiB : à confronter aux traces, jamais à annoncer par inférence.
9. Checks pertinents finaux, mise à jour du rapport d'implémentation devenu obsolète et des seules références affectées, handoff/Git réels. Pas de déploiement, commit/push non autorisés pour cette tâche.

## Commandes utiles

Relire les scripts `package.json` et les conditions de skip des tests. Forme usuelle :

```powershell
corepack pnpm --filter @arbestra/contracts build
corepack pnpm --filter @arbestra/api build
corepack pnpm exec vitest run apps/api/src/modules/villages/sync-v2-journal.integration.test.ts apps/api/src/modules/villages/sync-v2-shared-writers.integration.test.ts
```

Exécuter les suites DB séquentiellement. Attendre le code final du processus ; ne pas considérer quelques lignes vertes comme une fin réussie. Aucun nouveau test applicatif n'a été lancé pour cette rédaction documentaire.

## Prompt à coller sur l'autre compte

> Dans `C:\Users\trist\PhpstormProjects\Arbestra`, lis AGENTS.md, la tête de SESSION-HANDOFF.md, docs/HANDOFF-AB-REPRISE-COMPTE-2026-10-21.md et docs/SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md. Reprends le diff non commité existant et termine les lots A puis B avec leurs validations serveur, client réel, SSE et mesures. Commence par les erreurs de typage du dernier build API, puis poursuis les raccordements et manques documentés. Les modifications documentaires initiales sont la spec à conserver. Ne déploie pas, ne migre pas la base de développement et ne commit/push pas. Ne t'arrête pas à une fondation ou à un harness partiel ; vérifie les critères réels et mets à jour le handoff.
