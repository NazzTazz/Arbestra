# Synchronisation village — candidate et contre-recette

## Confirmation compacte et cible de 500 ms — 11 octobre, base d40a43bbeb3c76853b91ea1a581fd88c4f5ff63c

**Statut : optimisations implémentées et vérifiées techniquement ; candidate pour essai interactif.** Tristan précise en fin de tranche que 500 ms est un ordre de grandeur, et que les optimisations SQL et de trafic suffisent pour cette livraison. Les temps observés restent documentés ; ce repère ne devient pas une garantie de production. Les sections datées suivantes conservent les preuves historiques. Aucune fluidité en production ni ouverture publique validée. La démo reçoit la candidate ; son essai visuel est réparti avec Tristan, sans navigateur agent.

### Trames effectivement nécessaires

| Échange | Contenu et utilité |
| --- | --- |
| Intention HTTP | Deux points X/Y (trois avec coude), largeur en subdivisions, matériau, trottoir/opération, révision du plan, devis affiché, UUID commande/session. 391–392 octets sur les portions mesurées. Z vient du terrain serveur courant. Le relâchement n'attend pas un devis HTTP ; la commande revalide le devis présenté, droits et collisions sous verrou. |
| Confirmation HTTP | InfrastructureConfirmation négociée : monde/village, UUID, heure conservée dans le reçu, révisions de InfrastructurePlan, devis et changements du plan. 617–3 402 octets ; les captures automatiques expliquent les grandes confirmations. Envoyée après commit, sans snapshot ni syncRevision/heure de projection globale. |
| SSE | Convergence du village canonique, stocks et transitions. La présentation du plan confirmé résiste aux anciennes trames, puis disparaît au rattrapage. Elle n'avance ni économie ni révision mondiale. |
| Snapshot/repli | Initialisation, reconnexion, trou et clients historiques ; les équipements Infrastructure gardent la projection complète. Aucun snapshot ne conditionne l'accusé normal d'une route ou son undo sans déplacement d'équipement. |

beginVillageEconomy, borne H, verrous, revalidation, finaliseur et rollback restent communs. Retry/undo utilisent les plans/devis/date des reçus : H pour les nouveaux, date de création conservée pour les historiques. Terre/gravats ne provoquent plus de débit nul. Le serializer ACK dédié passe par le cache Fastify de compileSerializationSchema, sans premier parcours du schéma complet du village.

### Capacités communes effectivement raccordées

- synchronizationChanges/applySynchronizationChanges servent VillageFrame et InfrastructureConfirmation, avec ordre des collections seulement si nécessaire ; application immuable et validation finale atomique, doublons/trous/contextes/générations protégés.
- App possède le village canonique ; infrastructurePresentationState sert VillageScene et InfrastructureTools jusqu'au rattrapage SSE. La portion suivante emploie la révision acceptée du plan.
- readRc1Ground réutilise champ/troncs/échantillons après vérification d'identité immuable et lectures dynamiques courantes. Quatre contextes, 32 768 échantillons chacun, patches isolés monde/dimensions/source. Aucun stock, occupation ou droit caché.
- readRc1Ground et naturalFeaturesQuery utilisent des recherches corrélées LATERAL LIMIT 1 par monde/feature, uniques, afin d'éviter le balayage répété d'un nouveau monde mal estimé par les statistiques PostgreSQL. La localisation canonique économique et ses filtres restent identiques.
- InfrastructureRenderer découpe terre/gravats en secteurs de huit cases avec halos/coutures ; TerrainStore change groundRevision à la réception avant admission du renderer. Couches manuelle/automatique consultent la même identité de hauteur, disponibilité et éviction. Sans identité fiable, probes exacts conservés.
- materializeWoodlands groupe les projections sans retour physique dû au même H. Stocks, cursors, réserves, seuils et occupations sont équivalents ; les retours dus restent chronologiques dans materializeWoodland.

### Mesures décisives et limites

Copie privée UUID de la géographie réelle : 128 chunks, 36 voies manuelles, 18 héritées, 34 bâtiments physiques (33 bâtiments dans la projection), 2 018 features/éditions, six terrasses, 105 bosquets locaux dont huit partiels. Source capturée READ ONLY ; copie à stocks fixes et 15 habitants idle, sans missions actives copiées. Vrais HTTP localhost, une instance API, aucun SSE/browser/GPU. Toutes les copies nettoyées ; aucune commande sur Bressuire.

**Mesure représentative des relâchements successifs :** snapshot HTTP normal une fois, puis quatre commandes sans devis serveur, sans nouvelle lecture du contexte et sans instrumentation SQL. Le client de mesure conserve le plan confirmé ; le plan appliqué est strictement égal au plan persisté après chaque portion. Premier snapshot 7 771 ms / 189 098 octets, mesuré séparément.

| Portion | HTTP | Transaction | Projection complète | Demande / confirmation |
| --- | --- | --- | --- | --- |
| Terre 1 | 1 498 ms | 1 424,1 ms | 0 ms | 391 / 3 392 octets |
| Terre 2 | 2 165 ms | 2 150,9 ms | 0 ms | 391 / 3 402 octets |
| Gravats | 1 026 ms | 1 002 ms | 0 ms | 392 / 617 octets |
| Terre 3 | 1 791 ms | 1 780,6 ms | 0 ms | 391 / 2 567 octets |

Ajouts 172/192/64/64 pixels ; captures 5/5/0/0 voies héritées. Ces durées sont antérieures à la finition des clés de passages documentée ci-dessous. **500 ms non atteints même avant rendu.** Une série précédente donnait 3 038/491/340/426 ms, mais réchauffait le réseau via readContext et un devis avant chaque commande : elle ne démontre pas la fluidité des tracés consécutifs. Le SSE réel peut également réchauffer le réseau ; son coût et la contention du monolithe ne sont pas mesurés ici.

Attributions causales terminées :

- **SQL sur nouveau monde :** l'ancien plan estimait une ligne puis rescannait le monde pour chaque feature, près de quatre millions de buffers hit. Comparaison du vrai SELECT Kysely ancien/nouveau dans une même copie et transaction : EXPLAIN 6 931,82 → 25,333 ms, SELECT ordinaire 3 893 → 32 ms ; 2 018 lignes ordonnées strictement égales, 3 994 576 → 18 107 buffers. Aucun JIT, lecture disque, ANALYZE global ou migration. Rollback connu et absence de toutes les lignes de fixture prouvés. Le premier diagnostic à 3,65 s confirme le même plan ; la lenteur n'est plus une hypothèse de driver.
- **Serializer froid :** Fastify réel en mémoire, même ACK 673 octets, cache de compilation conservé : premier inject union complète 1 392,3 ms → schéma ACK dédié 165,7 ms ; deuxième 2,36/1,84 ms. Corps strictement égaux, un serializer compilé par schéma puis réutilisé. Hors DB/port/rendu, ces durées ne sont pas des latences de commande RC1.
- **Calcul restant :** profil CPU sur deux commandes réelles sans réchauffage, avec surcoût du profiler : deuxième buildTravelNetwork environ 1 115 ms, dont refineTravelRoute 607 ms et closure passageInspector 372 ms. Le nouveau tracé change réellement raster/poids ; cache miss légitime. L'ACK supprime la projection postcommit, donc la portion suivante peut calculer ce réseau pour la première fois sous verrou. Aucun effacement explicite du cache à l'écriture, et l'échantillonnage du générateur n'apparaît pas comme dominant. Le profiler ajoute du coût : ses totaux HTTP ne servent pas de benchmark.
- **Finition navigation :** passageInspector emploie des clés numériques exactes pour les seules arêtes adjacentes canoniques de grille ⅛, avec clés textuelles pour les portes continues et segments plus longs. Mêmes bornes et scopes. Trois tests ciblés verts (18 ignorés) : quatre orientations aux coutures X/Y/coin, portes continues .36/.37 distinguées, terrain changé bloquant, DTO froid/chaud. Comparaison pure du même snapshot de 19 voies sur terrain sec plat, ancien d’abord : initial 416,3 → 308,6 ms ; trois nouvelles voies 301,6 → 297,1 / 316,7 → 200,9 / 388,3 → 302,2 ms. DTO complets identiques, 34 trajets/792 points. Pas de DB ni relief RC1 réel dans ce microbenchmark ; ce gain ne remesure pas la série HTTP précédente.
- **Bois :** neuf bosquets, 60 → 20 requêtes, dont 12 conservées pour les retours chronologiques et huit groupées. Les premières séries HTTP après batch étaient paradoxalement plus lentes (5,5/4,3/1,9 s) à cause du plan SQL sur copie ; la suppression de requêtes seule ne prouvait aucun gain de délai.
- **Renderer manuel isolé :** même snapshot de 19 routes, sol constant/NullEngine, ancien d'abord : trois ajouts 178,6/195,7/148,5 → 127,7/90,5/54,7 ms CPU, environ 17 000 → 179 probes ; seuls secteurs touchés remplacés. Froid 765 → 965 ms, sans gain froid revendiqué. Couche automatique complète, React et GPU exclus.
- **Cache géométrique pur :** 15 029 arbres, 382,12 → 0,345 ms froid/chaud, terrasse réelle 421,65 ms ; SQL/réseau exclus.

Ne pas additionner des composants de fixtures différentes pour revendiquer 500 ms.

### Preuves terminées

- Contrats : sept cas ciblés verts, quatre ignorés, diff commun/order, retry/gap/undo/échec atomique ; build/lint ciblés verts.
- Frontend : neuf cas ciblés verts, trente ignorés, HTTP/fallback, présentation/génération, secteurs/coutures, vrais chunks et rc1Edits reçus avant demand/tick, disponibilité/éviction et secteurs conservés ; types/lint/build verts.
- Commande API réelle : confirmation/retry/undo/fallback rejouée verte après le serializer dédié (un passé, 23 ignorés), finaliseur/transitions dues/débits préservés, aucune projection complète. Rollback avec mutations préalablement observées et erreur injectée exacte prouvé lors de la première validation ; pas attribué au dernier replay.
- Bois : cas final rejoué vert après finition types, neuf bosquets, états complets identiques au chemin historique via savepoint, réserves/restes/seuil/retour puis repousse, pas de livraison anticipée. Ancien code reproduit rétrospectivement rouge au plafond de requêtes ; fixture annulée et absence compte/monde vérifiée.
- Cache RC1 : trois cas purs verts après LATERAL, identité/source/terrasse/retraits/monde/bornes couverts. naturalFeaturesQuery : cas DB réel vert, égalité ancien/nouveau au même H et snapshot READ ONLY, coutures, positions canoniques, autres mondes, dépôts absents/partiels. Builds API/contrats finaux et lint ciblés verts.

Aucune suite globale/e2e, reset DB, migration ni commande utilisateur. Essai visuel interactif encore à Tristan. Le coût restant est notamment le calcul des trajets automatiques sur nouvelle géométrie, encore sous le verrou de commande. La mesure du rendu réel avec SSE/GPU et charge de staging/production reste différée ; après la précision de Tristan, elle ne bloque pas la livraison de ces optimisations. Il ne justifie ni une pose déclarée réussie avant commit ni la suppression de contrôles spatiaux.

Démo : frontend 5278 HMR conservé. API 3102 actualisée seule avec le build final SQL/serializer et les contrats finaux, PID 12108/session 17327, remplace PID 48048/session 43762 ; /api/health 200. Client 5278 servi en HTTP 200 avec x-infrastructure-confirmation. Préserver absolument parent fixture PID 8212/session 48641 et frontend PID 45084/session 25278. Rechargement conseillé ; données utilisateur et parent préservés. Rapports/scripts/profils ignorés dans test-results ; transcript utilisateur exclu du commit.

---


## Clic → voie confirmée — 11 octobre, base cc43b9ca8857ab742da291a501291f57b08b08d1

Tristan précise le délai après validation sur terre/gravats. Deux frontières vérifiées : TerrainRenderer invalidait toutes les unités sol visibles à chaque révision Infrastructure, même si buildRc1TerrainUnit ne consulte ni routes ni plan ; buildTravelNetwork invalidait son réseau sur des matériaux/IDs de strokes sans changement de géométrie. L’aperçu accéléré ne supprimait pas ces coûts de confirmation.

Correction terrain minimale RC1 : setInfrastructure/setRoads ne réadmettent plus le sol RC1, et sa signature ignore ces décorations. Une lecture renouvelée du même chunk ne réintroduit pas l’invalidation. Les terrasses restent dans la signature ; le chemin historique non-RC1 est conservé. Le rendu de chaussée/trottoirs reste dans InfrastructureRenderer/VillageRoads, avec les mêmes hauteurs et matériaux.

Navigation : signature sur raster manuel effectivement consulté, barrières et positions d’équipements, dimensions, champ fin, troncs, accès et occupations. Le raster, les obstacles et le maillage fin de base sont préparés une fois pour les destinations du réseau ; les portails propres à chaque destination sont séparés. Coarse et refinement partagent les contrôles de segments. Cache de booléens géométriques borné à 262 144 segments au total et quatre contextes LRU ; périmètre world.id/dimensions/TravelGround.revision. Une révision de champ doit changer pour toute modification de hauteur/eau/obstacles/troncs. RC1 relit et vérifie les données courantes avant de fournir cette identité. Aucun stock, permission, occupation ou snapshot économique n’est gardé dans ce cache. Une nouvelle géométrie de route continue à replanifier et à être validée côté serveur.

Mesures comparatives terminées avant finition du raccourci de hit chaud ; ce dernier est vérifié séparément ci-dessous :

| Frontière | Résultat observé et conditions |
| --- | --- |
| Terrain après route | Fixture RC1 pure 32 × 32, NullEngine : 64 → 0 unités remplacées, +64 → 0 changements de version et admissions ; CPU 66,9 → 1,0 ms. Révision seule 91,5 → 0,5 ms. Terrasse réelle : reconstruction toujours active, sommet 3,125 vérifié. Aucun temps GPU ou délai réseau déduit. |
| Recalcul réel des chemins | Même snapshot Bressuire/ground en lecture seule, R40/26 routes/33 bâtiments. Nouvelle voie terre courte ajoutant 384 pixels : ancien 3 804 ms → nouveau 1 098 ms. Repaint de géométrie identique : 1 508 → 79 ms. Courant froid 3 399 → 3 122 ms ; premier calcul reste coûteux. 34 trajets/1 035 points et DTO complets strictement identiques dans les trois variantes. Terrain déjà amorcé par la lecture, ancienne version mesurée d’abord ; chargement initial 8 022 ms hors comparaison. Ajouts hypothétiques : aucune commande ni validation de terrain/pose/persistance sur le village utilisateur. |
| Endpoint commande valide | Fixture UUID v1 plate 512 × 256, un seul test ciblé sans reset : chaude incrémentale 178 ms, transaction 98,1/projection postcommit 75,6 ms ; legacy chaud 173 ms. Premiers totaux 2 150/1 008 ms, largement hors spans transaction/projection ; ces spans excluent authentification, hooks, initialisation et sérialisation, sans attribution mesurée du reliquat. Ne représente pas une pose RC1 réelle. |

Un raccourci borné relie la signature spatiale brute exacte à cette clé canonique : 16 alias, clé brute au plus 131 072 caractères et stockage brut+canonique au plus 2 097 152 caractères. Il ne contient ni raster ni état, et un hit exige que le résultat soit encore présent dans le cache réseau (8 réseaux/50 000 points). Il évite de rasteriser de nouveau une entrée identique ; une autre entrée passe toujours par la géométrie effective. La première version mesurée ci-dessus ajoutait 46–90 ms sur les hits identiques, détectés et corrigés avant intégration.

Mesure pure du raccourci final, hors DB : fixture 512 × 256, 26 voies/53 248 pixels, un trajet/41 points ; trois hits chauds 0,825/1,206/1,099 ms (cc43b9c : 0,940/0,822/2,408 ms), DTO strictement égaux et zéro échantillon terrain. Cette preuve retire le coût de raster répété ; elle ne remesure pas les trois variantes Bressuire ni le clic complet.

Server-Timing sur les réponses Infrastructure réussies distingue road_tx (transaction, incluant snapshot pour legacy) et road_sync (révision/projection postcommit pour réponse négociée). Authentification et sérialisation finale sont hors de ces spans. Corps HTTP, UUID, devis attendu, trames/reprises SSE et garanties transactionnelles inchangés. Le diff de transport nécessite encore une projection complète autoritaire après commit.

Preuves ciblées : terrain rouge avant/vert après, identités/queue/version conservées et vraie terrasse reconstruite ; navigation repaint rouge avant, champ fin/révision/monde/largeur/équipement et DTO froid/chaud ; comparaison READ ONLY précédente ; endpoint de mesure avec assertions de durées terminé vert. Trois cas navigation terminés verts après le raccourci final (17 ignorés), un cas terrain vert (3 ignorés), un cas DB de mesure vert (22 ignorés). Build contrats/API, types client et lint ciblé verts. Pas de navigateur agent ou de campagne globale, conformément au mode interactif. Validation de la durée complète clic → affichage dans le navigateur encore à Tristan ; coûts froids et projection finale restent des limites.

Contrôle de démo après relance finale API 3102 (session 10588/PID 51804) : health 200, parent fixture et frontend 5278 conservés. Lecture authentifiée 12 674 ms/200 490 octets/R3747/29 voies ; deux devis refusés pour équipement en 3 130 puis 747 ms/153 octets, HTTP 200. Reprise après redémarrage, données et charge différentes des mesures précédentes : aucun ratio de pose valide déduit. Aucun ordre envoyé sur Bressuire. Le premier chargement reste lent.

---

## Réactivité Voirie — complément actuel du 11 octobre

Base eb6c4506bedc5568eafe00c92bb9ff7cd18b931e. Implémenté/intégré ; validation interactive encore à Tristan. Les anciennes limites « assemblage complet avant validation Voirie » ci-dessous sont levées pour les routes et leur annulation sans équipement déplacé. Les autres opérations gardent leur contexte complet. La projection HTTP/SSE après commit reste complète et potentiellement coûteuse.

Chemins effectivement partagés :

- createInfrastructureEditContext/prepareInfrastructureEdit : baseline spatiale HUD, raster final transmis à Babylon et validation API, capture automatique et historique des largeurs ; aucun second propriétaire d’état village.
- flatRoadGeometry : aperçu et chemins terre/gravats confirmés ; sommets communs et seulement parois exposées. InfrastructureRenderer : caches par matériau/repère/hauteurs, trottoirs et pavage issus des mêmes helpers, invalidation sur leurs lectures effectives. Meshes inchangés conservés lors d’un ajout ailleurs ou d’une révision non géométrique.
- readVillageOccupancies/groupVillageOccupancies : snapshot complet et readInfrastructureSpatialState. Même terrain, emprises, accès, navigation et stocks projetés à H. Prévisualisation read-only et commande autoritaire revalident les données courantes ; géographie immuable préchauffée avant verrou village. Pas de cache des droits, stocks ou occupations.
- TravelNetworkState : données géométriques utiles au moteur existant ; destinations identiques à froid/chaud, sans objets économiques supplémentaires dans le DTO.

Preuves terminées dans cette tranche : cas contexte partagé/périmé et concordance complète aux coutures/largeurs/croisements ; trois régressions navigation connexes ; DTO de destination froid/chaud. Sept cas renderer verts, puis trois cas ciblés rejoués après cache final : reconstruction du seul matériau changé, conservation des pavés/trottoirs par identité, modification de relief locale et parois externes au coin torique. Une ancienne attente renderer obsolète a été confrontée au HEAD initial avant correction (joint périphérique : largeur 2,4890625 et sommet +0,064). Cinq tests DB de sync.integration.test.ts verts : devis pendant verrou village acquis, HTTP après commit + SSE/retry/undo, rollback observé avec erreur identifiée, commandes valides mesurées et concordance contexte léger/complet sans lectures science/cohortes/chantiers/marché/catalogue. Fixture UUID isolée dans 127.0.0.1/arbestra_test, aucun reset ; timing rejoué séparément. Lecture réelle Bressuire en même vue et même H : 67 cellules occupées, 33 bâtiments et accès, 34 trajets/1 035 points, deux parcelles groupées ; plans, prix et surfaces concordants pour capture nouvelle/existante et coutures X/Y/coin. Aucun ordre Voirie envoyé dans ce village. Golden de 40 variantes sur snapshot conservé : nouveaux résultats identiques à l’ancien préparateur. Build contrats/API/world-web, types API/client et lint ciblé verts ; pas de tests navigateur agent ou de suite globale.

| Mesure actuelle | Conditions et résultat |
| --- | --- |
| Préparation au pointeur | Même snapshot conservé, 19 voies manuelles/18 héritées, 438 cellules, 11 068 pixels, 40 positions. Médiane 108,6 → 22,8 ms ; p95 optimisée 47,7 ms. |
| Aperçu rendu | NullEngine, même snapshot et terrain constant : médiane 52,8 → 8,2 ms, p95 optimisée 23,8 ms. Ne mesure pas le GPU ni la fluidité du navigateur. |
| Réseau confirmé | Base : 9 meshes/162 570 sommets avant, 6 meshes/63 255 sommets après. Trois vrais ajouts de voies terre après dernier cache : 4 192 ms à froid, 722 puis 517 ms, 6 meshes/63 602 à 64 296 sommets. Charge locale variable ; le froid reste perceptible. Les temps 143/82 ms d’essais de révision sans changement géométrique ne représentent pas une nouvelle pose. |
| Devis direct Bressuire | Ancien chemin : 63 requêtes, 1 884/1 074 ms ; nouveau : froid 15 requêtes/2 714 ms, puis 14 requêtes/709/422/334 ms. Même voie refusée pour équipement, aucune écriture ; charge et état courant variables, pas de ratio garanti. |
| HTTP démo actualisée | Après relance finale API 3102 : lecture 2 793 ms, 198 377 octets, R3605/20 voies ; devis refusés 313/249 ms, 153 octets. Le snapshot peut être préchauffé par le flux utilisateur déjà ouvert. Mesure précédente pendant compilations : lecture 6 032 ms, devis 989/1 255 ms. Aucune pose réelle RC1 chronométrée. |
| Commandes valides | Fixture v1 plate 512 × 256, quatre voies courtes distinctes, legacy/frame alternés : 11 545/5 762 ms à froid puis 525/524 ms ; ~40 Ko legacy et 2 523–2 655 octets frame, devis 92–111 ms. Froid/réconciliation/projection et charge non contrôlée : réserve restante, pas un temps garanti pour Bressuire. |

Limites actuelles : projection complète postcommit et premier calcul froid encore lents ; pas de mesure GPU ni de confirmation visuelle manuelle par l’agent, conformément au partage interactif demandé. Les commandes, devis autoritaires et stocks ne sont pas rendus optimistes pour masquer ce coût. Aucun changement produit ou migration. Candidate vérifiable techniquement ; validation de la réactivité réelle à Tristan.

---

Extension Voirie du 11 octobre, base 9b325703729dafd4057acecf8ac5403206b20d92 : implémentée et intégrée, validation interactive par Tristan. Même négociation HTTP que les constructions, même projection exacte de base, mêmes trames HTTP/SSE et reprise par snapshot. UUID/session/reçu/devis/undo conservés. Le finaliseur partagé villageCommandResult termine les écritures avant commit ; projection de réponse ensuite hors verrou village. Les devis utilisent withVillageProjection (REPEATABLE READ READ ONLY), sans réconciliation ni verrou économique. prepareInfrastructureEdit fournit la surface finale réellement retenue au renderer et à la validation serveur, y compris le cas sans effet.

Profil des lectures Bressuire : boucle N+1 dans readWorksites, avec relecture de chaque mission et de son gisement. Lectures groupées en trois requêtes indépendamment du nombre de chantiers (32 maximum), missions actives projetées par readExtractions ; extractionProjection sert également la lecture individuelle. Aucun cache économique. Monde/village explicitement filtrés, cibles dans l’ordre ordinal, chantiers dans l’ordre historique. state utilise aussi readExtractions pour les missions actives.

Preuves ciblées terminées : quatre cas DB Voirie (devis pendant verrou acquis sans écriture due, réponse après commit/verrou libéré + doublons HTTP/SSE/retry/undo, rollback exact après plan/débit/reçu/révision observés, mesures de commandes valides). Un cinquième cas DB, rejoué séparément, prouve trois lectures pour six chantiers, concordance avec la mission individuelle, ordre des cibles, absence de fuite vers un autre village et rollback de fixture. UUID privés, aucun reset de la base partagée. Trois cas purs client/contrat et un cas capture automatique/surface sans effet verts. Build contrats/API, typecheck world-web et lint ciblé ; pas de campagne navigateur agent conformément au mode interactif demandé.

Mesures finales, petit monde isolé v1 plat 512 × 256 : commandes legacy 3163 puis 328 ms / environ 40 Ko ; incrémentales 1815 puis 274 ms / 2523–2655 octets. Devis valides 92–117 ms. Chaque commande ajoute une voie courte distincte, alternance legacy/frame ; mesures locales sous charge variable, pas un benchmark statistique. Réduction de transport proche de 94 %, ne prouve pas une pose Bressuire à 274 ms. Profil direct Bressuire, même voie existante refusée par équipement : avant regroupement 1653/1561 ms et 81 requêtes ; après 677/791 ms et 63 requêtes. Profil CPU activé avant, charge non contrôlée : gain observé, ratio exact non garanti. Aucune commande Voirie envoyée sur Bressuire par l’agent. Contrôle HTTP final sur API actualisée 3102 : première lecture après redémarrage 23070 ms, suivante 2117 ms, 196773 octets ; devis refusés 1051/547 puis 815/1157 ms (14 voies, révisions différentes dues à la vie du village). Aucun temps de pose RC1 déduit de ces lectures.

Limites : base absente/périmée ou révision inchangée = snapshot de repli voulu. Assemblage complet avant validation de commande encore présent sous verrou ; devis encore projection complète en lecture seule. Le froid vérifie l’artefact RC1 et construit les routes fines, coût restant de plusieurs secondes. La réactivité sur le vrai village et le rendu du traceur restent à valider manuellement. Pas de nouvelle migration ni changement de gameplay.

11 octobre 2026, branche `main`, base relue `adda2ed0367c6d99bcc98cb60b118c49e26a68a6`. Candidate : commit contenant ce rapport ; son hash exact est communiqué à la livraison. **Implémentée, intégrée et vérifiée techniquement dans le périmètre ci-dessous ; prête pour validation produit de la synchronisation.** Ce verdict ne lève pas les réserves historiques de latence de l'alpha et n'autorise aucune ouverture publique.

## Existant vérifié et changements effectifs

L'existant fournit les commandes HTTP idempotentes, `state()` et les réconciliations serveur, le pipeline App/VillageScene/Babylon et un cache de meshes par signature. Il ne fournit pas encore de flux SSE ou de révision durable ; App peut lancer des lectures du village entier à 500 ms sans garde, avec des snapshots également conservés dans SpawnPlacement. Le diagnostic précédent avait reproduit huit lectures simultanées ; il n'avait pas encore corrigé ce chemin.

La candidate ajoute la migration additive 041, un lecteur cohérent sans écriture économique, le flux SSE et des trames partagées. App conserve sa copie locale et arrête ce polling. Une lecture initiale et un rafraîchissement de secours ne se chevauchent pas avec eux-mêmes. App et SpawnPlacement utilisent réellement `latestVillageSnapshot()` ; HTTP et SSE partagent les règles de révision et `reconcileVillageSnapshot()`. Le renderer existant conserve ses meshes inchangés et sa caméra.

Le [contrat d'architecture](architecture/village-synchronization.md) détaille les tables couvertes, les consommateurs, la jonction et les limites. Aucune règle de portée, de terrassement, de ressources, de coût ou de délai de construction n'est changée.

## Garanties retenues

- Révision = nombre de marqueurs de transactions validées **dans le monde** ; identité du village également obligatoire. Les écritures métier et leur marqueur valident ou s'annulent ensemble. Le comptage couvre les validations concurrentes dans un ordre différent de leur démarrage, sans compteur mondial verrouillé après les gisements.
- Données et révision du snapshot SSE partagent une vue PostgreSQL `REPEATABLE READ`, `READ ONLY`. Le hook HTTP après commit remplace un snapshot dont l'assemblage ou la révision est devenu incertain.
- Chaque abonnement/reprise commence par un snapshot courant cohérent. Le commit entre lecture HTTP et abonnement est récupéré ; un commit pendant la projection sera récupéré au prochain contrôle. Pas de confiance dans Last-Event-ID comme preuve d'application.
- Une trame est appliquée complètement puis validée avant d'exposer ensemble données/révision. Doublon couvert : ignoré. Trou/chevauchement inexploitable : reprise contrôlée sans changement partiel. Réponses HTTP et callbacks SSE d'une ancienne génération sont neutralisés.
- Le marqueur durable est contrôlé toutes les 2 s après le cycle précédent, même si aucune publication ou mutation suivante ne survient. Le délai inclut ensuite les lectures/attentes/projection ; ce n'est pas un SLA de 2 s. Un flux silencieux est remplacé après 30 s ; une erreur réseau reconnecte après 2 s.
- Les échéances et transitions d'énergie continuent de réveiller les réconciliations existantes. Les contrôles sans changement n'assemblent pas de snapshot complet. Un changement économique n'est jamais crédité par une animation.

## Vérifications terminées

Toutes les suites DB ont été exécutées **séquentiellement**, sur des mondes/comptes UUID isolés dans `127.0.0.1/arbestra_test`, sans reset. Les processus ci-dessous ont terminé avec succès ; les fixtures ont leurs nettoyages bornés. La migration 041 a été appliquée à cette base uniquement.

| Vérification | Résultat et portée |
| --- | --- |
| Contrats/client et suites connexes | **37 tests verts**, six fichiers : `packages/contracts/src/village-sync.test.ts`, `apps/world-web/src/api/village-sync.test.ts`, `api/client.test.ts`, `scene/terrain-store.test.ts`, `ui/exploitation-navigation.test.ts`, `scene/camera-focus.test.ts`. Application immuable complète, doublons, collections, trous/chevauchements, mauvaises données, contexte, génération, watchdog, priorité révision/heure et projection temporelle à révision égale. |
| PostgreSQL/Fastify/SSE réel | **10 tests verts**, `apps/api/src/modules/villages/sync.integration.test.ts` : jonction, marqueur et écritures annulés après observation et erreur sentinelle identifiée, commits inversés avec barrière bornée, commit forcé pendant la lecture MVCC, réponse HTTP devenue incertaine, droits, POST construction/idempotence/doublon SSE, échéance/repos sans worker vivant, publication perdue sans mutation suivante. |
| Pose RC1 | Cas `atomically places the compact kit…` vert dans `installation.integration.test.ts` : source signée, pose atomique, dotation unique, pierre naturelle 2 000. Un test joué, neuf explicitement filtrés. |
| Boucle RC1 bois/pierre | Cas `delivers the first wood and stone lots…` vert dans le même fichier : commandes d'extraction réelles, livraisons et effets économiques au retour. Un test joué, neuf filtrés ; pas la campagne spatiale entière. |
| App + Babylon réels, transport contrôlé | `node tests/browser/village-sync.mjs`, frontend local 5279 : un seul GET initial, un seul bâtiment reconstruit à la complétion, mesh HDV inchangé, même canvas/caméra, panneau Population conservé, doublon et callback ancien ignorés, reprise par snapshot sans reconstruction supplémentaire. Aucune erreur JS. |
| Geste d'exploitation, non-régression | `node tests/browser/harvest-gestures.mjs`, même frontend : quatre gestes, zéro commande au survol, aucune requête preview, réception/reprise idempotentes, sélection de catégorie correcte, zéro erreur JS. Scène substituée/API contrôlée ; pas une preuve du picking Babylon. |
| Navigateur RC1 réel | Frontend de recette 5280/API 3103, connexion et reprise de Bressuire, 13 bâtiments/0 chantier. Sonde SSE authentifiée réelle : snapshot R192 → frame R192→197 (10 changements) → contrôle R197 ; un seul GET village relevé, pas de boucle HTTP. Aucune erreur JS relevée. Aucun ordre économique envoyé dans le village utilisateur. La sonde prouve le transport réel ; la recette contrôlée ci-dessus prouve précisément l'application App/Babylon. |
| Compilation/types/lint | Build contrats, build API, typecheck world-web et build Vite world-web isolé `test-results/village-sync-dist` en mode e2e terminés avec succès ; lint racine vert, puis lint ciblé des deux fichiers serveur affinés. Avertissement Vite existant de chunks >500 Ko, sans échec. Pas de build play-web ou de suite globale DB revendiqués. |

Les captures `test-results/village-sync-render.png` et `test-results/village-sync-rc1.png` ont été inspectées. La première conserve le panneau Population et le retour de fin de construction ; la seconde présente le showroom Constructions sur le vrai village. Ce sont des preuves de continuité de présentation, pas une validation de la charte graphique.

Commandes reproductibles (contrats compilés au préalable) :

```powershell
corepack pnpm exec vitest run packages/contracts/src/village-sync.test.ts apps/world-web/src/api/village-sync.test.ts apps/world-web/src/api/client.test.ts apps/world-web/src/scene/terrain-store.test.ts apps/world-web/src/ui/exploitation-navigation.test.ts apps/world-web/src/scene/camera-focus.test.ts
corepack pnpm exec vitest run apps/api/src/modules/villages/sync.integration.test.ts
corepack pnpm exec vitest run apps/api/src/modules/onboarding/installation.integration.test.ts -t 'atomically places the compact kit'
corepack pnpm exec vitest run apps/api/src/modules/onboarding/installation.integration.test.ts -t 'delivers the first wood and stone lots'
node tests/browser/village-sync.mjs
node tests/browser/harvest-gestures.mjs
```

Les tests navigateur utilisent leur transport contrôlé ; `RC1_BROWSER_URL` permet de pointer un frontend local de recette. Les scripts ne doivent pas être confondus avec une mutation d'un village utilisateur.

## Mesures observées

Dernier passage SQL, fixture simple **generationVersion 1, 512 × 256**, quatre chunks plats et petit village, pendant compilation de l'API :

- Snapshot initial sérialisé : **38 051 caractères** ; trame après complétion : **5 437 caractères**, environ sept fois plus petite. Mesure de `JSON.stringify().length`, pas mesure UTF-8/TCP/compression.
- Rattrapage après le commit du handler de worker : **2 282 ms**. Le test décale son curseur initial pour que le fallback d'échéance ne déclenche pas une autre mutation ; la révision finale est exactement celle du commit observé. Il n'appelle aucune publication.
- Handler/transaction et réception ensemble : **20 220 ms**, dont environ 17,9 s avant la mesure post-commit. La contention/charge de ce passage ne prouve aucun gain du temps d'exécution économique. Un passage antérieur moins chargé, avec fallback d'échéance, donnait 786 ms post-commit ; il ne remplace pas la preuve renforcée finale.
- Contrôle de révision seul : 10 lectures, 13 marqueurs, **médiane 3 ms / maximum 5 ms**. Ne comprend pas droits/cohortes ni projection complète et ne qualifie pas le coût sur une longue histoire de monde.
- Recette de rendu : une seule lecture initiale et un seul bâtiment régénéré. Le délai clic → premier pixel d'une construction RC1 réelle n'est pas remesuré dans cette tranche.

## Limites et verdict

Les points demandés de convergence sont couverts dans les preuves ciblées : continuité, reprise, rollback, perte de publication silencieuse, idempotence et application ciblée. **Candidate prête pour validation produit de la synchronisation.**

Restent à qualifier avant déploiement/ouverture : recette LAN sans TLS et proxy SSE de staging/production ; application de la migration 041 dans l'environnement cible ; charge avec plusieurs villages/abonnements et historique conséquent. Les marqueurs sont append-only et leur comptage croît : pas de qualification de long terme ni de purge implicite. Les payloads HTTP de commande sont toujours complets et le coût de projection/calcul RC1 demeure ; cette livraison ne clôture pas à elle seule les blocages historiques de latence/stabilité sous verrou. Tous les panneaux, la sélection d'une entité supprimée et le tactile ne sont pas recettés au navigateur ici.

Les services de recette 5279/5280/3103 et le navigateur dédié sont fermés en clôture. À la livraison initiale de la candidate, la démo utilisateur 5278/3102 n'avait pas encore été remplacée ; la mise à jour demandée ensuite est décrite ci-dessous. Bressuire, le parent de fixture session 48641/PID 8212 et ses enfants 3101/5275, la démo 3100/5274 et le dev 5174 sont préservés. Le transcript utilisateur non suivi reste exclu du commit ; captures, logs, scripts locaux et builds sous `test-results/` sont ignorés.

## Mise à jour de la démo à la demande de Tristan

La démo 5278 sert désormais le client compilé de `d982f3db29cc2d2e5cf49fa7a4107268e1f49d4e` depuis `test-results/village-sync-dist`, avec API 3102 relancée sur le build courant et son worker. Migration 041 déjà présente dans sa base `127.0.0.1/arbestra_test`, vérifiée avant relance ; aucun reset, seed ou migration supplémentaire. Le parent de fixture et ses enfants sont restés ouverts.

Vérification navigateur sur cette adresse réelle : le EventSource ouvert par App reçoit un snapshot R906, une trame R907, un contrôle R907 puis une trame R908, avec un seul GET village et aucune erreur JS relevée. Le rendu comporte 13 bâtiments ; lecture SQL préalable : 14 lignes bâtiment persistantes du village. L'agent s'est connecté sans envoyer d'ordre économique. Cette preuve confirme l'intégration des builds à la démo existante ; elle ne remplace pas une recette LAN/production ou une validation produit.
