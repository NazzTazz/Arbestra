# Contre-recette terrain et relief RC1 — 11 octobre 2026

Base : `5e23577f36f111c98b96f0ea7b3c7e83a33bd4ae`, branche `main`. Irritants signalés par Tristan sur son village Bressuire. **Corrections implémentées, intégrées à la démo et vérifiées techniquement ; aspect à valider produit.** Pas de nouvelle règle économique, de migration ou de modification de la géographie signée.

## Écarts et raccords effectifs

| Irritant | Cause vérifiée et correction |
|---|---|
| Routes absentes | RC1 n'effectue pas l'excavation du rendu historique. Les pavés de `VillageRoads` restaient sous sa surface. Le chemin RC1 conserve la même topologie, drape les vertices sur la hauteur continue et relève les surfaces ; le rendu des mondes historiques garde son excavation. |
| Scieries coupées | Racine à Y = 0,09 indépendamment du terrain. Les modèles sans recette reçoivent maintenant la base de leur emprise ; `planForSite` accepte le terrain courant pour les recettes. Les arrivées de chunks et changements de terrasse déplacent les racines conservées, sans régénérer leurs modèles. Ombres de contact et marqueur de sélection suivent cette base. |
| Herbe uniforme | `buildRc1TerrainUnit` utilisait un matériau distinct, sans atlas ni UV. Il utilise le matériau terrain existant, ses textures/météo et les huit variantes déterministes partagées avec le terrain historique par `grassVariant`. Relief, eau et terrasses restent inchangés. |
| Chemins brisés sur pente | Les branches de terre suivaient deux plateaux par cellule. `VillageRoads` drape désormais terre, pavés et bordures sur RC1 ; `InfrastructureRenderer` échantillonne les coordonnées continues pour l'aperçu et la voirie confirmée. Chemins de diagnostic et altitude des figurants lisent aussi la hauteur continue. Navigation autoritaire et délais restent inchangés. |
| Chargement terrain interrompu | Les expirations ne libéraient leurs tickets que si la promesse de transport terminait. Le store race explicitement transport et annulation : ticket/place libérés même pour une promesse bloquée, retour tardif inoffensif, backoff conservé. Lots client de quatre chunks, deux en vol, délai de 30 s. Aucun arrêt du serveur terrain n'a été établi dans cette recette. |
| Blocs au dézoom | `RegionalOverview` inventait des cuboïdes de forêt/roche à partir de densités agrégées. Ces volumes anonymes sont supprimés pour RC1 ; le relief régional et la couverture colorée restent présents. Les silhouettes des autres villages conservent leur contrat de visibilité existant. |
| Blocs sans ressources | Les masses régionales précédentes n'étaient pas des gisements. Complément après capture utilisateur : des blocs sélectionnables sont aussi de vraies roches RC1 dont le stock est masqué faute de relevé ; voir le complément ci-dessous. Lecture SQL du monde utilisateur : **32 roches économiques, 32 dépôts, 32 raccords RC1**, aucun dépôt manquant. Les quatre dépôts de dotation lus près du village étaient effectivement épuisés. Les stocks hors connaissance restent masqués ; aucune quantité n'est inventée ou dévoilée. |

Capacités partagées : `grassVariant` sert effectivement `buildTerrainUnit` et `buildRc1TerrainUnit` ; `planForSite` sert recettes confirmées et connexions d'entrée depuis le même fournisseur terrain ; `InfrastructureRenderer.update` sert aperçu et confirmation avec la même option de relief ; `drapePositions` sert les trois lots routiers existants. React/App, SSE et commandes HTTP de construction continuent leurs chemins actuels.

## Refresh RC1 borné

La lecture initiale garde les tableaux immuables du champ fin. Sur `/terrain/updates`, le nouveau client annonce `x-arbestra-terrain-edits: 1`. Le serveur fournit `rc1Edits.terraces` et les listes complètes de features/occupations ; le tableau vide supprime aussi les anciennes terrasses. Le store remplace ces seules modifications tout en conservant les mêmes tableaux de hauteur/eau. Monde, génération, dimensions, incarnation et invalidation restent vérifiés. Sans ce header, le format RC1 complet reste compatible ; le nouveau client accepte également ce format historique.

Les lectures restent read-only/repeatable-read, avec les mêmes permissions et filtres. Aucun cache de stocks/occupations serveur ajouté, ni terrain généré à nouveau. Les trames du village ne deviennent pas une autorité client sur le terrain.

## Preuves terminées

- **53 tests client/Babylon/API client**, sur neuf fichiers : store, renderer, maillage/picking RC1, infrastructures, plans, routes, silhouettes et client HTTP. Après finitions : **25 tests ciblés** verts, sans les additionner au premier compte.
- **4 tests SQL isolés** de `rc1-ground.integration.test.ts`, dont refresh compact, terrasse persistante, substrat conservé et compatibilité. Cible vérifiée : `127.0.0.1/arbestra_test`. Mondes UUID dédiés nettoyés ; aucun reset ni suppression de données utilisateur.
- Rouge avant correction observé pour l'admission réseau bloquée, le matériau d'herbe RC1, la voirie sur pente et les masses régionales. Une première fixture de plan avait omis son ancre dans l'emprise : erreur de fixture corrigée, pas revendiquée comme preuve du défaut.
- Routes réelles sous NullEngine : pavés/terre/bordures au-dessus d'une pente traversant X `511 ↔ 0` puis Y `255 ↔ 0`, réutilisation des meshes pour terrain identique et invalidation locale. Picking/hauteur sur pente et terrasse au coin conservés. Voirie d'aperçu et confirmée contrôlée vertex par vertex.
- `tests/browser/rc1-relief.mjs` : vrai App/Babylon, transport contrôlé RC1 ; première lecture échouée puis reprise, scierie à **0,09 → 2,77316 → 5,09** lors de l'arrivée du terrain puis d'une terrasse. Même mesh conservé. Routes pavées/terre présentes, atlas utilisé, masses anonymes absentes, zéro erreur JS. Aucune commande persistante.
- `tests/browser/village-sync.mjs` et `construction-http.mjs` rejoués verts sur le build final : bâtiment ciblé, caméra/meshes inchangés conservés, doublon HTTP/SSE ignoré, trou repris, ancien abonnement neutralisé.
- Builds contrats et API, typecheck client, build Vite e2e final isolé, lint racine final : code 0. Les avertissements Vite de taille de bundles préexistants restent présents. Pas de suite DB globale ou de nouveau déploiement public.
- **Navigateur réel Bressuire**, skill `agent-browser` : build `main-CmoqeKHX`, 33 bâtiments ; trois scieries à **Y = 0,715 sur une base 0,625**, routes pavées visibles, herbe alternée. Dézoom région à rayon 162,95 : aucun volume anonyme, aucune silhouette concurrente dans ce monde. Retour par `+` : reprise des chunks, file vidée et absence d'indicateur terrain dégradé. Aucun ordre économique envoyé par l'agent. Captures avant/après, région et fixture inspectées, conservées dans `test-results/` ignoré.

## Mesures et limites

HTTP réel, même fenêtre de quatre chunks, API compilée 3102 via preview 5280, compte de fixture de Bressuire ; workers/démos locaux et compilation concurrents. Refresh historique : **387 779 octets** ; compact : **105 971 octets**, soit **72,7 % de moins**, hors compression HTTP. Première paire après relance : 7 991 / 935 ms ; caches/charge différents, aucun gain causal de latence attribué à cette paire. À chaud, alternance historique/compact : **519 / 236 / 260 / 248 ms**. Pas un budget de production.

Dans le navigateur réel, derniers refreshs village avant dézoom : HTTP 200, environ 277–1 200 ms ; après retour : HTTP 200, 987–1 306 ms. Fin de recette : zéro lot en vol et zéro unité graphique en attente. Sous le navigateur headless, qualité adaptative réduite, frame P95 d'environ 440 ms et stream P95 87 ms pendant la session : cette tranche ne prétend pas régler la fluidité GPU générale. Ni endurance réseau/LAN, ni panne réelle prolongée du serveur, ni proxy production recettés.

La correction de non-libération d'admission est déterministe ; la cause exacte de toutes les interruptions vécues par Tristan n'est pas établie. Les annulations au changement d'échelle restent normales, avec reprise automatique vérifiée. Les features naturelles inconnues peuvent garder un stock masqué suivant le contrat existant.

**Verdict : prête pour validation produit de ces corrections visuelles et de reprise.** La stabilité prolongée reste à observer ; aucune nouvelle certification globale d'ouverture alpha.

## Démo et préservation

Démo actualisée : http://localhost:5278/spawn?world=rc1-receipt-0ea92d24-c5c8-418b-8292-2781d0413536. Client `test-results/terrain-relief-final-dist`, API compilée avec worker. API 3102 : session **99447 / PID 47620** ; front 5278 : session **87579 / PID 16980**.

**Préserver parent fixture session 48641 / PID 8212 et enfants 3101 / PID 22268, 5275 / PID 44552 : leur fermeture nettoie le monde utilisateur.** Autres services utilisateur conservés. Ancien build gardé ; aucune migration. Transcript utilisateur non suivi hors commit. Référence exacte de la candidate au bilan Git ; cette section du relais appartient au commit livré.

## Complément — roches visibles non relevées

La capture utilisateur après livraison de 5189a4e établit que les blocs sélectionnables et le message « Gisement inconnu » ne sont pas tous le décor régional retiré. Le diagnostic précédent était incomplet. Le rendu RC1 représente les volumes rocheux de l'artefact par des boxes, avec les identifiants des vrais gisements.

Lecture seule de Bressuire : ancre (250,195), connaissance initiale X [218,282[ / Y [163,227[. Le gisement proche (258,227) existe ; certains de ses volumes sont à Y 221–226, mais sa cellule canonique est hors connaissance. La vraie lecture terrain renvoie sa géométrie et deposit:null ; la vraie route /features/:id répond 404 DEPOSIT_NOT_FOUND. Aucun manque de dépôt ni nouveau crédit n'est établi. Les quatre gisements connus de dotation sont épuisés. Les règles de Géographie/Université et la portée économique de 16 cases restent conservées.

App identifie désormais une sélection non relevée depuis les features effectivement streamées, même hors du snapshot régional. DepositPanel affiche « Ressource non relevée · Relevé géographique nécessaire. », sans quantité ni action, et App évite la requête vouée au refus. Changer de ressource vide les anciens détails et invalide les réponses d'inspection retardées avant leur application au store/rendu. Une panne d'inspection d'une ressource connue conserve le chemin d'erreur existant.

Preuves actuelles de ce complément : recette réelle App/Babylon contrôlée rc1-deposit-inspection.mjs, rouge sur 5189a4e avec les deux messages de la capture, verte sur la candidate : inconnu → connu → inconnu, zéro lecture privée pour l'inconnu, une pour le connu, aucun stock ancien dans la fiche, zéro erreur JS. Les premiers essais de fixture étaient recouverts par le HUD/la fiche ou repliaient le mode ; ces échecs de geste ne constituent pas une preuve du bug. Capture verte inspectée. Quatre tests navigation/visuels de dépôt, typecheck client, build Vite e2e et lint ciblé verts. Pas de nouvelle suite SQL mutante, pas de migration, aucun ordre économique dans le village utilisateur.

Client de démo 5278 actualisé vers test-results/deposit-inspection-dist, build main-agXVISZu ; frontend session 35986/PID 51600. API 3102/session 99447/PID 47620 conservée. Parent fixture 8212 et enfants 22268/44552 conservés ; ne jamais les fermer pour remplacer le client. Cette correction explicite la connaissance existante ; elle n'autorise pas l'exploitation hors des règles serveur.
