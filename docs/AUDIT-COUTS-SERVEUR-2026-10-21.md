# Audit des coûts serveur — 21 octobre 2026

**Publié en staging et alpha : `a3ae90d5953e9e26313cbd2d143a6722d7f5de43`, tags `staging-2026.10.21.3` / `alpha-2026.10.21.3`.** Commit et déploiements autorisés par Tristan, base d'audit `67c8d6c`. Réutilisation des règles et du transport existants ; Rust/WASM non engagé. La sonde de `../codex-github-pilot` indiquait **27 % hebdomadaires restants à 15:52 UTC**, contre 51 % au début de l'audit. Réserve demandée : environ 6 % ; aucun changement de compte.

Déploiements [staging](https://github.com/NazzTazz/Arbestra/actions/runs/39629365750) et [alpha](https://github.com/NazzTazz/Arbestra/actions/runs/39629711139) réussis. Six contrôles publics par environnement réussis ([staging](https://github.com/NazzTazz/Arbestra/actions/runs/39629610533), [alpha](https://github.com/NazzTazz/Arbestra/actions/runs/39630051094)). SHA, trois services et sauvegarde pré-déploiement vérifiés directement sur le VPS ; aucune migration nouvelle. CPU API ponctuel sur dix secondes : 1,9 % d'un cœur en staging, 2,0 % en alpha, hors qualification de charge. Les validations métier ci-dessous sont locales ; aucune nouvelle recette joueur authentifiée distante pendant cette publication.

## Résultats et limites de portée

Les devis ne déclenchent plus de rattrapage économique. Les principales économies viennent de la projection commune des cohortes/stocks, du regroupement des lectures d'échéances, des rejeux consultatifs et de la réutilisation des sérialiseurs JSON. Le résolveur TypeScript écarte maintenant les branches qui ne peuvent plus rejoindre leur cible dans le détour déjà autorisé.

**Les commandes historiques ne sont pas toutes ramenées à trois SQL.** Jardin, pierre, anciens chantiers, commerce, améliorations et extensions conservent des transactions et réponses complètes coûteuses. Les parcours négociés marché/atelier/science libèrent leurs verrous avant la projection, mais une trame exige encore une projection serveur. **Rectification après relecture du client :** ce support est livré côté serveur ; `commandMarket`, `commandProcessing` et `commandScience` utilisent encore `requestState()` sans `x-village-sync`, donc la réponse historique complète. Leur raccord au transport négocié reste à faire. Les limites ci-dessous sont distinguées des optimisations réalisées.

## Mesures V2 comparées — 22 octobre 2026 (branche `wip/v2-commandes-bornees`, local)

Même harness, même fixture répétée (3 bâtiments, 30 habitants, monde isolé), **30 itérations mesurées après chauffe** par série, base `127.0.0.1/arbestra_test`. Série V1 : `ARBESTRA_AUDIT_REPEATED=1` ; série V2 : en plus `ARBESTRA_AUDIT_V2=1` (commandes négociées, rejeux exacts, lecture delta induite après chaque commande, bootstrap par monde et présentation à chaque itération). Artefacts ignorés `test-results/server-costs/v1-repeated-2026-10-22.json` et `v2-repeated-2026-10-22.json`, synthèse `node scripts/summarize-command-costs.mjs <fichiers>`.

| Opération (médiane, p95 ms) | V1 | V2 |
|---|---|---|
| Démarrer sans matière | 114 (136) ms · 90 appels · 65 Ko | 44 (55) ms · 34 appels · 1,9 Ko |
| Pause / annulation | 97 (113) ms · 81 appels · 65 Ko | 17 (22–25) ms · 18 appels · 1,0 Ko |
| Reprise | 115 (128) ms · 93 appels · 65 Ko | 45 (61) ms · 37 appels · 1,9 Ko |
| Rejeu exact | 93–94 ms · 78 appels · 65 Ko | 9 (12–13) ms · 10 appels · 0,3 Ko |
| Synchronisation induite par commande | SSE 57–58 ms · 49 appels · 1,7–2,4 Ko | delta 11–17 ms · 11–16 appels · 1,2–2,1 Ko |
| Synchronisation après un rejeu | SSE 1 ms · 1 appel | delta 8 ms · 8 appels · 0,9 Ko |
| Premier chargement | (GET village, non répété ici) | bootstrap 82 (101) ms · 75 appels · 16 Ko + présentation 61 (87) ms · 49 appels · 45 Ko |

Lecture : la commande V2 ne projette plus le village (coût proportionnel à la commande), et la synchronisation induite lit les seules clés touchées. Le delta à vide coûte 8 appels (authentification, propriété, journal) contre 1 pour la SSE V1 sur révision inchangée : c'est le coût de chaque relève V2 sans changement, à surveiller pour la cadence de 2 s. Mesures locales Windows, pas une qualification de charge ; la latence navigateur reste mesurée par les parcours Playwright.

## Méthode reproductible

`apps/api/src/modules/villages/server-costs.integration.test.ts`, activé par `ARBESTRA_SERVER_COST_AUDIT=1`, crée et nettoie son propre monde. `ARBESTRA_AUDIT_LABEL` nomme le fichier JSON ignoré sous `test-results/server-costs/`. Le driver Kysely enregistre chaque SQL sans ses paramètres, sa durée, le contrôle de transaction, le statut HTTP et la taille de réponse. Les phases finales utilisent l'en-tête DEV et son parseur partagé ; les premières traces enveloppaient `inject()` et n'isolaient pas correctement ces phases.

Les chiffres comptent les **appels au driver**, authentification comprise. La colonne « contrôle » compte `BEGIN/COMMIT/SET TRANSACTION`, pas les instructions internes aux CTE, vues et triggers. Un `UNION ALL` réduit les allers-retours ; ses dix lectures indexées restent du travail PostgreSQL. Les triggers d'invalidation/synchronisation, les volumes de lignes et le CPU doivent donc être considérés séparément.

Cible exclusive : `127.0.0.1/arbestra_test`. Aucun reset développement ni mutation alpha/staging. Fixture initiale : monde ancien 512×256, trois bâtiments achevés, trente habitants, six stocks à 2 000, sans gisement ni worker économique. La phase étendue ajoute trois gisements et une Université. Ce n'est ni un grand village RC1 ni un benchmark réseau de production. Les latences ponctuelles Windows ne constituent pas un engagement de capacité.

Commande de mesure :

```powershell
$env:ARBESTRA_SERVER_COST_AUDIT='1'
$env:ARBESTRA_AUDIT_LABEL='final'
corepack pnpm exec vitest run apps/api/src/modules/villages/server-costs.integration.test.ts --hookTimeout 60000
```

## Appels SQL mesurés

Dernière trace complète : `test-results/server-costs/final.json`, **52 appels HTTP réussis et nettoyage terminé**, le 21 octobre à 12:20 UTC. La phase étendue inclut les nouvelles commandes avec une base de trame fraîche.

| Parcours | Avant | Après | Contrôle inclus après |
|---|---:|---:|---:|
| Village froid / chaud | 115 / 104 | 91 / 80 | 5 |
| Village avec activités | 113 | 89 | 5 |
| Liste des offres | 27 | 9 | 3 |
| Devis Oracle / atelier | 33 / 35 | 10 / 11 | 3 |
| Ajouter / ajuster l'effectif d'un chantier HUD | 56 / 50 | 47 / 41 | 2 |
| Repas / repos HUD | 48 / 48 | 39 / 39 | 2 |
| Rejeu d'un geste HUD | 17 | 17 | 3 |
| Échange Oracle, réponse historique | 120 | 94 | 2 |
| Démarrage / pause atelier, réponse historique | 138 / 112 | 106 / 90 | 2 |
| Rejeu marché / atelier, réponse historique | 109 / 109 | 87 / 87 | 2 |
| Rejeu marché / atelier négocié, snapshot de repli | 90 / 90¹ | 53 / 53 | 3 |
| Pose maison, ACK / rejeu | 7 / 6 | 7 / 6 | 2 |
| Amélioration maison, confirmation | — | 99 | 5 |
| Détail gisement / devis chantier / devis exploitation pierre | — | 25 / 21 / 23 | 3 |
| Extraction pierre / rejeu | — | 118 / 92 | 2 |
| Démarrer / pauser un ancien chantier | — | 139 / 92 | 2 |
| Lancer exploitation pierre | — | 154 | 2 |
| Publier / annuler une annonce joueur | — | 110 / 108 | 4 |
| Démarrer / pauser une recherche | — | 126 / 105 | 5 |
| Échange Oracle / annulation atelier, trame fraîche² | — | 108 / 104 | 5 |
| Rejeu de ces deux commandes, trame fraîche² | — | 54 / 54 | 3 |
| Reçus récolte / expédition | 5 / 6 | 5 / 6 | 2 |
| Session / mondes disponibles | — | 2 / 2 | 0 |
| Terrain, deux chunks / actualisation mutable | — | 12 / 11 | 3 |
| Aperçu mondial froid / cache / ETag inchangé | — | 15 / 2 / 2 | 3 / 0 / 0 |
| Végétation / silhouettes des villages | — | 8 / 10 | 3 |

¹ Deuxième passe, avant le raccourci de rejeu ; ces deux cas n'existaient pas dans la trace initiale. « — » signifie absence de mesure initiale comparable.

² Phase étendue avec les gisements, l'Université et les activités déjà créées : ces comptes ne se comparent pas directement aux commandes historiques de la phase initiale. Les trames font **2 087 et 2 085 octets**, contre environ 74 ko pour leur snapshot de base. Elles libèrent le verrou avant projection mais ne suppriment pas cette projection serveur. Le harness envoie explicitement les en-têtes de négociation ; les appels actuels du client Oracle/atelier/science ne les envoient pas encore. Ces tailles ne décrivent donc pas leurs réponses HTTP courantes dans l'interface livrée.

Tailles sur cette fixture : confirmations HUD ~620 octets, pose ~1,8 ko, états historiques ~60–74 ko. Le repli moderne sans nouvelle révision est un snapshot valide ; il ne doit pas être présenté comme une trame vide.

## CPU et transport

Les phases mesurées avant/après la sélection du schéma concret expliquent plusieurs secondes perdues au premier geste, sans rapport avec le nombre de SQL :

| Premier appel dans le même scénario | Sérialisation avant → après | Durée HTTP locale avant → après |
|---|---:|---:|
| Échange Oracle historique après le GET | 2 333 → 43 ms | 2 548 → 243 ms |
| Rejeu moderne avec snapshot de repli | 3 299 → 797 ms | 3 523 → 918 ms |
| Recherche scientifique | 5 194 → 74 ms | 5 423 → 347 ms |

Sources : `serialization-before.json` et `serialization-after.json`. Le serveur sélectionne le schéma de réponse déjà connu : village, trame ou snapshot. Le compilateur et le filtrage de champs existants restent utilisés. Le premier snapshot enveloppé conserve un coût de compilation ; les appels chauds sont moins chers. Aucun cache de réponse métier n'est ajouté.

Le profil V8 de navigation identifie `buildTravelNetwork`, sa file et ses clés. La borne admissible `pas parcourus + distance torique restante ≤ maximum de pas` réduit le cas de cible enfermée de **65 534 à 3 009 visites**, sans réduire le détour autorisé. Les clés d'arêtes et les voisins sont réutilisés. Comparaison isolée de 103 terrains (trois cas dirigés et cent terrains déterministes) : accessibilité conservée, segments cardinaux secs, coût en pas/virages équivalent ou meilleur ; certains ex æquo choisissent un autre chemin. Exemple ponctuel : 198→12 ms pour la cible enfermée. Artefacts : `compare-network.mjs`, `network-comparison.json`, profil sous `test-results/server-costs/`. Rust/WASM non engagé.

## Changements communs et invariants

- Dix catégories d'échéances lues en un `UNION ALL`, tri identique par date milliseconde/ID/type ; successeurs d'atelier réinsérés dans cet ordre. Préverrouillage pierre groupé par UUID après le village, avant les transitions. Le scheduler reste seul à acquitter sa tâche.
- Un stock matérialisé en un SQL : verrou flux puis stock, arithmétique PostgreSQL `numeric`, crédit entier, reliquat et curseur monotone. Projection et matérialisation partagent le taux. Pas d'écriture de solde sans crédit ni de curseur identique.
- `projectCohorts()` partage exactement le calcul d'énergie des départs sans persistance/logement. Les matérialisations successives à la même borne n'écrivent plus une nouvelle version physique de cohorte identique.
- Devis marché, atelier, chantier, exploitation, nivellement, commerce, détail gisement et liste des offres : projection cohérente `REPEATABLE READ READ ONLY`. La préparation de trajet commercial peut encore alimenter son cache géométrique ; elle n'affecte pas les stocks ni les habitants.
- Exploitation bois/pierre : cohortes et chemins ciblés ; état/réseau complet seulement lorsqu'un Jardin doit être planifié. Détail/départ d'un gisement : suppression de l'état complet préparé uniquement pour chercher ce trajet.
- Sélection de chantiers : emprises et clairières lues une seule fois, contrôle spatial partagé avec le détail de gisement, sans calculer dix devis d'effectif inutilisés par cible. Comparaison rétrospective isolée de l'ancien algorithme sur trois bosquets et un doublon : même sélection, 21→11 appels ; cohortes 3→0, emprises 3→1, clairières 3→1. Préparation exploitation : lecture d'un dépôt réutilisée entre estimation et premier lot. Aucune réutilisation entre commandes.
- Les endpoints marché/atelier/science acceptent le transport négocié partagé, déjà utilisé par la construction et l'infrastructure. Leur raccord client reste à faire. Avec négociation : mutation et finalisation à H, commit, puis projection dans le pool CPU existant. Rejeux modernes marché/atelier : propriété, reçu durable et égalité stricte ; aucune nouvelle réconciliation. Admission concurrente recontrôlée sous verrou pour un identifiant encore inconnu.
- Réveil de lecture village : un rattrapage à H, puis admissions et logement. La finalisation de commande conserve le rattrapage nécessaire aux transitions créées par la commande.
- Science : agrégation des preuves, réutilisation à l'admission, lecture d'activité évitée sans programme en attente. Connaissances du streamer limitées aux chunks canoniques demandés, détail gisement à sa case ; graphe scientifique global conservé pour les trajets.
- Mondes disponibles : un SELECT avec deux `EXISTS`, au lieu de `1 + 2 × mondes`. Installation ancienne : hauteurs lues une fois et réutilisées. Atlas : population agrégée en SQL, sans transporter chaque cohorte.
- Mesures DEV : opt-in étendu aux GET/POST du village, hors SSE, jamais en production. Aucun SQL, paramètre ou secret dans l'en-tête.

## Inventaire des autres chemins et bornes

Cette inspection du code couvre toutes les familles d'entrées ; elle ne prétend pas avoir exécuté chaque branche ni chaque taille de monde.

| Famille / source | Coût, borne et décision |
|---|---|
| Construction, amélioration, extension — `construction.ts`, `service.ts` | Pose déjà bornée : autorité, occupation, coûts, insertion et ACK. Améliorations/extensions restent sur le finaliseur général ; ne pas confondre leur coût avec la pose. |
| Jardin, coffre, Chat, anciens repas/repos — `service.ts` | Débit/crédit/affectation puis état complet. Réconciliation historique encore présente. Les gestes HUD utilisent déjà une confirmation limitée. |
| Intentions récolte — `harvest-submissions.ts`, `harvest-intents.ts` | Réception durable sans verrou économique, puis admission worker. Jusqu'à 64 cibles en attente dans les files compatibles. Backoff livré précédemment, vérification métier et trajets conservés. |
| Expéditions — `science/expeditions.ts` | Réception bornée, quatre attentes locales/64 globales, worker CPU et reçus paginés. Lecture des reçus sans réconciliation. |
| Commerce joueurs — `trade-service.ts` | Préparation CPU avant transaction, cache de route certifié. Acceptation : deux villages canoniques puis dépôts communs avant transitions ; ces deux autorités sont nécessaires. |
| Nivellement/terraformation — `leveling.ts` | Devis consultatif ; validation de parcelle, des accès et des trajets engagés, puis modification atomique. Plusieurs recherches peuvent être nécessaires. |
| Routes/équipements — `infrastructure.ts` | Aperçu spatial consultatif, validation des passages engagés et confirmation compacte existante. Les contrôles de sûreté des trajets restent nécessaires. |
| GET village / SSE — `service.ts`, `sync.ts` | GET effectue encore un réveil économique, puis projection ; SSE projette sur révision modifiée et réconcilie aux échéances détectées. Tick inactif : authentification/reçus, heure, cohortes et révision, environ neuf appels dans le chemin lu. Ce dernier chiffre est une inspection, pas une trace HTTP. |
| Révisions — `sync-revision.ts` | Compte les transactions visibles du monde, index monde/transaction. Coût croissant avec l'historique, et invalidation conservatrice entre villages. `max(id)` est incorrect avec des commits désordonnés. Compaction éventuelle à concevoir avec preuve MVCC ; aucun compteur global bloquant ajouté. |
| Terrain — `worlds/terrain*.ts` | Transactions consultatives, au plus seize chunks par demande, ETag/cache bornés. Aperçu mondial froid proportionnel au terrain ; chaud réutilisé. Aucun rattrapage économique. |
| Atlas / installation — `onboarding/*` | Lecture cohérente avant calcul worker ; installation unique sous verrou spatial. La pose des éléments restants garde sa transaction/réveil. |
| Authentification / factory — `auth/service.ts`, `factory-settings.ts` | Session/droits ciblés, mot de passe haché. Pas de cache d'autorisation nouveau. |
| NOC / observation — `admin/service.ts`, `observation-reads.ts` | Consultation protégée avec limites/timeouts ; réutilisation d'une projection fraîche ou lecture sans navigation spéculative, cache deux secondes. |
| Génération — `world-generator/*` | Worker et files propres ; hors boucle des gestes joueur. Aucun calcul de monde déplacé dans une lecture village. |
| Triggers PostgreSQL — migrations 041, 042, 046, 048, 050 | Marqueurs de synchronisation, invalidation géométrique et notifications. Non comptés comme appels driver ; éviter les écritures identiques réduit aussi leur travail. Aucune désactivation ni migration de cette tranche. |

Les plafonds de sélection ne bornent pas à eux seuls le coût d'une grande population, d'un long historique ou du terrain RC1 entier. Les projections complètes, le compteur de révision et les anciens retours de commande restent les prochaines cibles ; leurs simplifications exigent des preuves distinctes de la présente optimisation.

## Priorités restantes

| Priorité | Constat et preuve | Suite proposée |
|---|---|---|
| 1 — commandes encore générales | Amélioration : 99 appels driver ; ancien chantier : 139 ; exploitation pierre : 154, sur la fixture décrite. Une projection complète et un rattrapage général restent présents. | Étendre les confirmations ciblées existantes, puis limiter les dépendances économiques de chaque commande avec preuves temporelles et concurrentes. |
| 2 — lecture complète du village | 80 appels à chaud sur la petite fixture ; géométrie/navigation et assemblage restent proportionnels au village. | Mesurer des villages RC1 représentatifs, réutiliser davantage les données stables et séparer les lectures réellement nécessaires à chaque écran. |
| 3 — historique des révisions | Inspection : le comptage des transactions visibles croît avec les marqueurs append-only. Pas de mesure d'endurance de production dans cet audit. | Concevoir une compaction compatible MVCC et la reprise SSE ; ne pas remplacer le compteur par un simple maximum d'identifiant. |
| 4 — chargement et rendu client | Une ouverture froide dépasse 40 s en Chromium sans fenêtre sur le monde complet. Ce constat ne localise pas encore toute la latence et ne mesure pas un joueur réel. | Profiler une ouverture représentative, du clic au rendu, et borner l'intégration initiale du terrain. |

Ces points restent ouverts ; les gains locaux ne constituent pas une qualification de charge de la production. Le benchmark du résolveur porte sur 103 terrains synthétiques avec un passage par version et par cas, sans médiane/p95 sur grands villages RC1 réels.

## Validation et recette

Preuves ciblées déjà observées : régressions consultatives rouges puis vertes ; matérialisation d'un stock 6/5/2→1 appels, fractions et rollback identifié ; préverrouillage entre villages et H après attente ; barrières marché/atelier/science confirmant commit avant projection ; rejeux sans achever un bâtiment étranger à la commande ; lecture terrain limitée aux deux chunks d'une couture ; navigation 67 tests et comparaison de 103 terrains.

Première suite générale : 1 282 succès, 12 échecs et deux tests opt-in ignorés. Les préparations anciennes qui remplissaient des Jardins avant leur achèvement ont été corrigées, ainsi que trois attentes de tests devenues obsolètes (faux Kysely, rotation de fixture, décoration des routes). La sélection optimisée ajoutée pendant cette exécution a été reprise dans un processus neuf. **Reprise : 88/88 dans huit fichiers**, **4/4 présentation RC1**, **1/1 livraison réelle bois/pierre RC1**, puis harness **52 appels HTTP et nettoyage réussis**. Les processus de clôture ont tous renvoyé 0 ; les scripts capturent explicitement le code natif sous PowerShell.

La contre-recette navigateur a trouvé un vrai blocage : le showroom Récolte interceptait le clic sur « Produire ». Les menus contextuels utilisent maintenant tous le niveau d'affichage déjà employé par le marché. Le parcours atelier vérifie le clic ordinaire, la pause, le débit et le crédit exact d'un seul lot. Les anciens tests d'inspection ont été remis sur le geste de récolte actuel et contrôlent le départ réel, sans inspection préalable. Le seuil graphique tient compte du modèle existant équipé : huit boîtes de corps, deux d'outil et une de panier, soit 264 sommets par habitant.

Limite observée en Chromium sans fenêtre, monde complet de seed : une ouverture a dépassé l'ancienne attente de 40 s pendant le rendu des 71 unités initiales. La trace associe un GET village de 4,3 s à froid et deux chargements terrain de 2,1–2,5 s ; le reste du parcours inclut chargement client et rendu. L'attente de préparation des tests est alignée à 90 s, comme les autres parcours, mais les clics restent bornés. Ce constat ne certifie pas la fluidité du rendu ni le chargement des grands villages en production.

Suite générale finale terminée : **1 293 succès, un échec, deux tests opt-in ignorés**, 224 fichiers, 1 841 secondes (`verified-full-tests.log`). Le seul échec concernait l'ordre des cellules dans un test d'amélioration : le diff présente les mêmes trente coordonnées, dans un autre ordre. L'assertion compare maintenant les coordonnées triées et vérifie aussi l'emprise attendue de l'Université. **Reprise du fichier infrastructure : 15/15, code 0**, 64 secondes (`verified-infrastructure.log`). Les 1 294 tests ordinaires sont couverts par ces deux passes ; la suite générale n'a pas été relancée après cette seule correction de test. Les deux ignorés sont le harness de coûts opt-in, exécuté séparément avec succès, et le benchmark hiérarchique facultatif.

Build complet, reconstruction du client après la finition CSS, lint racine et lint ciblé du dernier test réussis. **Sept parcours navigateur réussis** : HUD et marché sur ordinateur/mobile, atelier sur ordinateur, pierre sur ordinateur/mobile. L'atelier mobile reste explicitement ignoré par son test existant. Le geste tactile pierre est vérifié après recadrage de la cible au-dessus de la carte des chantiers, avec contrôle du point réellement touchable. Captures Population, atelier et pierre mobile relues ; logs `final-e2e.log`, `final-e2e-verified.log`, `final-e2e-mobile.log`, premières passes rouges conservées. L'API de développement sert la nouvelle compilation (health 200), interface locale également HTTP 200. Ces preuves précèdent la publication décrite en tête ; aucun reset ni migration de développement.

Parcours de recette depuis `http://localhost:5173`, ou désormais les lobbies [staging](https://play-beta.arbestra.world) et [alpha](https://play.arbestra.world) :

1. Recharger le village existant et poser deux maisons successives : confirmation rapide, coût appliqué une fois, première maison conservée à la seconde pose.
2. Ouvrir un devis de marché ou d'atelier, changer les paramètres, fermer : aucun débit ni départ pour cette opération avant confirmation. Confirmer ensuite une opération et vérifier les stocks et son avancement.
3. Ajouter plusieurs chantiers, changer de mode et revenir pendant les confirmations : consignes et gestes conservés. Régler les habitants et désigner un gisement ; observer le départ effectif.
4. Nourrir les actifs et envoyer des disponibles au repos depuis Population : compteurs cohérents après confirmation et après retour dans le mode.
5. Ouvrir un atelier depuis Exploitation, cliquer « Produire » puis « Pause après ce lot » : commandes accessibles au-dessus du showroom, lot engagé livré une fois puis pause.
