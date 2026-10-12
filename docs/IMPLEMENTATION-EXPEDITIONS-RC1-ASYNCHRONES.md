# Expéditions RC1 asynchrones — preuves du 12 octobre 2026

Implémentation de [la spec](SPEC-EXPEDITIONS-RC1-ASYNCHRONES.md), base main be6532d. Code et vérifications ciblées terminés ; recette visuelle complète encore à valider. Commit/push demandés par Tristan après les mesures.

## Résultat livré

Survey/explore enregistrent une intention UUID durable (202), puis une admission ou un refus durable (HTTP/GET/SSE). FIFO par village sans réservation, quatre demandes par village/64 par base, trois tentatives, bail renouvelé seulement par son propriétaire et expiration30s. Le départ revalide les moyens à H, le contexte physique et le candidat sous les verrous existants ; activité, affectation et reçu partagent la transaction.

Le solveur A→B TypeScript est indépendant de la science. Pool persistant1–2, accès/points, géographie RC1 complète, segments orthogonaux contrôlés, cache et recherche bornés. Le contexte SQL est fermé avant le CPU. Durée/budget/rappel et rapports consomment les distances/préfixes réellement parcourus ; le terrain RC1 édité reste autoritaire. Le reçu compact peut partir pendant une projection village en attente. Aucun nouveau HUD, Rust, combat, commerce ni foule.

## Vérifications terminées

Les suites DB utilisent des mondes privés de arbestra_test, séquentiellement, sans reset ni altération du monde de recette utilisateur. Commands vitest avec --configLoader runner et build contracts préalable ; shim os.userInfo ignoré nécessaire au bootstrap TSX de ce bac Windows.

| Suite | Dernier résultat terminé |
|---|---:|
| science/expeditions.integration.test.ts |18/18|
| villages/sync.integration.test.ts |24/24|
| navigation/rc1-navigation.integration.test.ts |1/1|
| database/connection.integration.test.ts |1/1|
| world-generator/artifact.test.ts |2/2|
| route-planner + expeditions contrats, travel, sync client et représentants/circulation |67/67|

Les tests forcent notamment FIFO, concurrentité entre deux villages/deux lanes, accès au village pendant CPU suspendu, attente réelle du verrou navigation, rollback après mutations observées, réponse de bail obsolète, quatre portes et refus sans révision. Une barrière retient la projection initiale tandis que le reçu SSE est livré. Les reproductions rouges puis vertes couvrent cible fractionnaire, exemption historique de cible occupée et fermeture PG17 d’un client emprunté entre deux requêtes (25P04), sans arrêt du serveur après correction.

Types API/contracts/client, lint ciblé et builds API/client terminés verts. Vite runner contourne l’accès esbuild aux parents Windows ; avertissement habituel de chunks volumineux. La finition RepresentativePanel modifie seulement le texte ancien sur l’inspection, lint vert. Pas de suite globale réinitialisant la base partagée.

## Méthode de performance

Machine locale : i7-1065G7@1,30GHz,8 cœurs logiques,32Gio,Windows,Node24.19.0,PostgreSQL17. API compilée, pool1 worker ; RC1 canonique512×256, artefact8,53Mio,43 bâtiments et terrasses/portes copiés dans une fixture privée. Le monde utilisateur est lu seulement pour cette copie. Probes sur127.0.0.1:3198 ; navigateur de recette laissé disponible, son activité n’est pas contrôlée dans la dernière campagne. Aucune latence Internet incluse.

Charge :1000 retries HTTP idempotents, six clients, avec probes santé et recherche continue rendue fermée par un anneau d’emprises de test. Distinguer202 pending et200 terminal : ces probes mesurent l’accusé/relecture, pas1000 nouveaux ordres économiquement admis. Les vrais ordres sont également observés jusqu’au terminal ; aucune pending ne reste. L’anneau et le trigger de mesure sont supprimés en fin de campagne.

Décisions :101 vrais ordres HTTP→terminal sur16 destinations certifiées (6,05–35,05cases), le premier non mis en cache puis100 essais chauds. Les cohortes/activités de cette seule fixture sont remises au repos hors chaque intervalle mesuré ; cela ne simule pas101 voyages terminés. Un worker séparé certifie aussi le trajet distant140,20→124,39 et les coutures X(510,6→1,6)/Y(9,254→9,1), chaque segment contre le terrain/occupations.

Instrumentation temporaire ignorée, sans changement du code livré : temps entre fin du dernier SQL d’échéance et appel SAVEPOINT pour majorer la validation d’identité/intégrité sans SQL/reconciliation ; temps d’acquisition des verrous incluant RTT SQL ; durée de détention jusqu’à COMMIT. Les messages du vrai worker séparent livraison/préparation du début de recherche et comptent les visites. RSS échantillonnée pour le processus API et ses workers, à distinguer de la limite de vieille génération V8 par worker.

SSE : connexion active, timestamp clock_timestamp dans un trigger juste avant COMMIT, offset d’horloge calibré par intervalle. Le délai publié est donc un majorant précommit→réception, pas une mesure exacte du commit. Les six premières mesures ont donné260ms au p95 pour une cible250ms ; elles restent rapportées. La campagne complémentaire termine20/20 reçus, sans retirer les valeurs lentes : majorant p95 157ms, maximum392ms, offset[-8,-6]ms. Les1000 probes donnent384 réponses202 et616 réponses200 ; les20 vrais ordres finissent ROUTE_BUDGET_EXCEEDED, aucune pending restante.

## Résultats

| Indicateur | Mesure terminée | Cible |
|---|---:|---:|
| Dernière charge1000 : ack p95 / p99 |175,9 /421,9ms|200 /500ms|
| Santé sous cette charge, p95 |66,3ms|100ms|
| SSE,20 reçus, majorant p95 / maximum |157 /392ms|p95≤250ms|
|100 décisions chaudes,16 objectifs, p95 / p99 |820,7 /1159,1ms|p95≤3000ms|
| Décision la plus lente de ces100 |1329,2ms|—|
| Validation finale,101 admissions, p95 |0,46ms|25ms|
| Transaction finale, p95 |489,4ms|borne totale2s|
| Village / navigation détenus, p95 |476,1 /473,3ms|publication requise|
| Acquisition village / navigation, p95 (RTT compris) |3,75 /2,15ms|publication requise|
| Worker séparé : initialisation puis premier calcul froid |3116,9 puis1944,7ms|calcul≤8000ms|
| Premier HTTP avec cache froid, campagne précédente |6214,3ms|8000ms|

Les16 calculs village du corpus et les deux coutures sont found et certifiés ;16 destinations trouvées sont toutes admises dans les101 essais. Les scénarios fermés restent des échecs de budget technique, sans faux inaccessible.

## Limites et recette

RSS API+worker échantillonnée465 fois : maximum633,4Mio, fin562,3Mio, intervalle561,6–577,1Mio sur la dernière minute. Cela décrit une campagne courte, pas une preuve d’endurance ni une limite RSS256Mio ;256Mio borne la vieille génération V8 du worker.

Le corpus chronométré est élargi au village dense et aux coutures, mais n’est pas une couverture exhaustive de toutes les forêts/eaux/pentes RC1. Les régressions contrôlent passage fin et obstacle distant ; aucun benchmark local ne prouve une charge production. Le délai commit→apparition effective du figurant n’est pas chronométré, seulement le reçu et la décision. La mesure de détention inclut économie/admission existantes. L’endurance mémoire et la famine du scheduler à longue durée ne sont pas démontrées par ces campagnes courtes.

Navigateur réellement observé : connexion5297→village5298, préparation puis admission,3 disponibles/1 au travail, un rapport revenu après durée réelle. Tristan a pris la vue Population pour suivre le cartographe ; son picking/POV ne constitue pas une action automatisée. Son retour sur virages, mobilité sélectionnée et retour à la porte reste à recevoir. Parcours : lancer depuis la mairie250,195 vers230,180,budget3min, suivre en Population puis contrôler retour/rapport ; rappel et reprise réseau sont couverts par les tests ciblés, pas attestés comme recette complète navigateur.

Migration042 appliquée seulement à arbestra_test. Développement et production non migrés/redémarrés. Travaux ressources IG, transcript et artefacts locaux exclus de la tranche Git.
