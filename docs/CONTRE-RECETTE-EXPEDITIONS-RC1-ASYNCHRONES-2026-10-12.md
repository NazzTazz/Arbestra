# Contre-recette — Expéditions RC1 asynchrones — 12 octobre 2026

Base contrôlée : main, **7fa926fab5a2e69258b0906a9f7d92b37e7513f8**, également présent dans origin/main local. [Spec](SPEC-EXPEDITIONS-RC1-ASYNCHRONES.md), [preuves de l’implémentation](IMPLEMENTATION-EXPEDITIONS-RC1-ASYNCHRONES.md).

**Verdict historique sur 7fa926f : non acceptée en l’état.** Le protocole asynchrone et le solveur passent les suites témoins, mais quatre reproductions adverses confirment trois écarts métier. Revue seule : aucune correction applicative, aucun commit/push dans cette contre-recette. Les travaux ressources IG de Tristan sont préservés.

## Réserves confirmées

### R1 — P1 — Un retour ultérieur peut effacer l’accès reconnu d’un lieu déjà relevé

Sources : [service.ts](../apps/api/src/modules/science/service.ts), lignes 103–107 et 174 ; [deposit-access.ts](../apps/api/src/modules/science/deposit-access.ts), lignes 28–29.

À chaque retour, recordPlaces remplace sourceActivityId par la nouvelle activité, même pour une cellule seulement traversée ; surveyed reste vrai. recognizedDepositRoute exige ensuite que la cible soit un sommet exact du trajet de cette nouvelle activité. Une cellule traversée par un segment comprimé ou décalé dans la cellule n’est pas nécessairement un sommet entier.

Deux reproductions DB terminées :
- Relevé initial de (10,8), accès reconnu non nul ; retour suivant par (8,8) → (9,8) → (12,8). La cellule (10,8) conserve surveyed=true, sa provenance est remplacée et l’accès devient null.
- Même résultat pour (10,7), après passage par (8,8) → (8,7.125) → (12,7.125) → (12,8).

Aucun obstacle ni droit n’a changé. La régression vient de l’interaction entre l’expansion des cellules parcourues et le consommateur historique de provenance. Le test utilise un monde plat privé et les fonctions métier réelles ; le refus arrive avant le branchement spécifique RC1. Ce n’est pas une recette HTTP complète sur relief RC1.

Attendu : préserver une preuve de relevé et un accès utilisables lorsqu’un nouveau passage ne les invalide pas. Ne pas assimiler cellule traversée et sommet du trajet. Ajouter les deux cas au contrat de compatibilité de recognizedDepositRoute (§3, §9 et §13 de la spec).

### R2 — P1 — La protection des emprises ignore la largeur du trajet engagé

Sources : [infrastructure.ts](../apps/api/src/modules/villages/infrastructure.ts), ligne 205 ; [spawn-access.ts](../packages/contracts/src/spawn-access.ts), lignes 13–25 ; appel avant réservation dans [service.ts](../apps/api/src/modules/villages/service.ts), ligne 986.

assertNoInfrastructure teste la ligne centrale contre une boîte de demi-largeur 0.499. Le solveur certifie une bande de largeur 1/8, avec échantillons latéraux à ±1/16. Leurs règles divergent à la frontière d’une cellule.

Reproduction DB terminée : activité en cours avec un segment (9.5,7) → (9.5,10). Pour une emprise en (10,8), le contrôle réel renvoie « allowed ». Le même segment, valide avant la pose, échoue ensuite dans canWalkSpawnSegment avec l’occupation de cette cellule, selon le calcul d’occupation du worker.

Portée exacte : contrôle métier de protection exécuté, géométrie avant/après vérifiée ; aucune construction HTTP réellement persistée dans ce test. Les autres conditions de construction restent nécessaires, mais ce contrôle ne protège pas la bande engagée. La lecture du chemin de construction ne révèle pas de seconde certification de cette bande.

Attendu : protéger le passage balayé avec les mêmes marges et règles de frontière que la navigation, y compris sur les coutures. Ajouter un cas où une construction touche seulement le bord du passage fin. La réserve enfreint la protection du trajet complet demandée au §3.8.

### R3 — P2 — Un deuxième rappel prolonge un retour déjà commencé

Source : [service.ts](../apps/api/src/modules/science/service.ts), lignes 343–356.

Le premier rappel raccourcit pathCells et supprime les surveyCells, mais conserve startedAt. Le garde « déjà au retour » ajoute encore les 60 secondes de relevé au trajet raccourci. Un rappel supplémentaire pendant ce retour recalcule donc une nouvelle échéance.

Reproduction DB terminée sur le trajet fractionnaire du test existant : rappel à H+5.2 s → retour prévu à H+10.4 s ; nouveau rappel à H+7 s → échéance repoussée à H+12.2 s. Le test vérifie d’abord la première échéance, puis échoue sur sa conservation. Il ne s’agit pas d’une erreur de fixture ou d’un timeout.

Attendu : un rappel déjà engagé conserve son échéance et son préfixe parcouru. Tester aussi une répétition réseau de la commande. Cet écart subsiste dans le rappel livré ; il n’est pas présenté comme entièrement introduit par cette tranche.

## Exécutions de cette contre-recette

Les quatre tests adverses ont depuis été intégrés et renforcés dans [expeditions.integration.test.ts](../apps/api/src/modules/science/expeditions.integration.test.ts). Le [rapport de correction](CORRECTIONS-EXPEDITIONS-RC1-ASYNCHRONES-2026-10-12.md) donne leur résultat après correction.

Ils ont été exécutés dans apps/api/src/modules/science/expeditions.counter-review.test.ts : **4 échecs attendus sur les assertions métier, code de sortie 1**. Fichier temporaire retiré après la revue ; cas désormais intégrés à la suite normale. La fixture vérifie explicitement 127.0.0.1/arbestra_test, crée ses UUID et nettoie ses lignes ; aucun reset global ni modification des mondes utilisateur.

Contrats reconstruits : **corepack pnpm --filter @arbestra/contracts build**, sortie 0. Suites témoins ensuite terminées :

| Suite | Résultat de cette revue |
| --- | ---: |
| science/expeditions.integration.test.ts | 18/18 |
| navigation/rc1-navigation.integration.test.ts | 1/1 |
| contracts/route-planner.test.ts | 10/10 |
| contracts/expeditions.test.ts | 2/2 |
| contracts/travel-paths.test.ts | 4/4 |
| world-web/api/village-sync.test.ts | 7/7 |
| world-web/scene/village-workers.test.ts | 24/24 |
| Total | **66/66, sortie 0** |

Commande témoin, après le build contracts :

~~~powershell
$env:NODE_OPTIONS='--require=C:/Users/trist/PhpstormProjects/Arbestra/apps/world-web/test-results/tsx-user-info.cjs'
corepack pnpm exec vitest run --configLoader runner apps/api/src/modules/science/expeditions.integration.test.ts apps/api/src/modules/navigation/rc1-navigation.integration.test.ts packages/contracts/src/route-planner.test.ts packages/contracts/src/expeditions.test.ts packages/contracts/src/travel-paths.test.ts apps/world-web/src/api/village-sync.test.ts apps/world-web/src/scene/village-workers.test.ts
~~~

Pour rejouer les régressions courantes : exécuter science/expeditions.integration.test.ts avec la commande ciblée ci-dessus. Le shim os.userInfo est le contournement local Windows déjà utilisé par la livraison, pas un prérequis du produit. Arrêter d’abord le coordinateur QA 3198, qui acquiert les demandes globalement dans cette base, et ne pas lancer une autre suite DB en parallèle.

Le témoin RC1 trouve (140,20) → (124,39), et certifie chaque segment contre le terrain autoritaire courant. Son intervalle compute.run initial vaut 2 893 ms, puis 7.6/5.0/8.2 ms avec cache. Ces chiffres comprennent le chemin de ce test, pas HTTP→décision ni une nouvelle campagne de charge. Logs locaux ignorés : apps/world-web/test-results/expeditions-counter-review.log et expeditions-counter-review-baseline.log.

## Couverture et preuves encore manquantes

Le replay confirme notamment idempotence des intentions, FIFO, absence de réservation, revalidation des moyens et de révision, rollback observé, réponse de bail obsolète, concurrence inter-villages et reçu SSE livré pendant une projection retenue. Les tests purs couvrent détour distant, passage fin, coutures et extrémités génériques. Ils ne remplacent pas les consommateurs métier testés ci-dessus.

- **Mémoire : écart de contrat à traiter.** La spec demande 256 Mio de données de navigation conservées par worker. Le code borne la vieille génération V8 à 256 et la taille textuelle de chaque artefact à 256 Mio, puis limite les nombres de sources/contextes/routes. Il ne comptabilise pas leur empreinte cumulée conservée. Le bilan reconnaît cette autre portée ; ni une équivalence avec le plafond demandé ni un dépassement effectif ne sont démontrés ici. Il faut prouver la borne demandée ou faire accepter explicitement sa reformulation.
- **Performance : preuve partielle.** Les campagnes antérieures sont documentées, non rejouées sous charge pendant cette revue. Les 1 000 requêtes étaient des probes/retries idempotents, ce que la spec autorise ; elles ne mesurent pas 1 000 nouvelles intentions. Le corpus complet à froid, l’endurance mémoire, l’équité sous saturation et la famine du scheduler restent à prouver. Le délai commit→activité réellement visible manque aussi.
- **Navigateur : non rejoué dans cette contre-recette.** La recette précédente ne couvre pas complètement rappel, rechargement pendant préparation, coupure/reprise SSE autour de l’admission et parcours sélectionné jusqu’à la porte. Le geste Population effectué par Tristan ne constitue pas une validation automatisée. Les 24 tests NullEngine ne prouvent pas le rendu/picking réel.
- Types/lint/builds API et client restent des preuves de la livraison précédente : cette revue documentaire, sans correction applicative, ne les annonce pas nouvellement exécutés.

## Suite et état de l’environnement au moment de la contre-recette

Corriger R1–R3 localement, transformer les reproductions en régressions vertes, puis compléter les preuves mémoire et la recette réseau/visuelle ciblée. Aucun besoin démontré de Rust, d’un nouveau bus/store ou d’une extension combat/commerce.

L’API QA privée 3198 a été arrêtée le temps des tests, puis relancée avec son lanceur propre ; /api/health répond HTTP 200, vérifié après relance. Les frontends 5297/5298 et la recette utilisateur 5278 ne sont pas modifiés. Migration 042 toujours appliquée seulement en test ; aucune migration ni relance du dev dans cette revue.

Git : code livré inchangé à 7fa926f. Cette contre-recette ajoute son rapport/fixture et actualise le statut de la spec et le handoff ; non commités. Les fichiers ressources IG, le transcript et le cache préexistants restent hors de cette revue.
