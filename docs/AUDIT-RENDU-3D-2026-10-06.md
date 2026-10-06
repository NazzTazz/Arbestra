# Audit du pipeline de rendu — 6 octobre 2026

## Résultat

Suite du 6 octobre : la première tranche d'optimisation est maintenant implémentée, après le commit/push de sauvegarde `d0596a4`. Le texte d'étude ci-dessous conserve les mesures antérieures ; les résultats nouveaux sont dans la dernière section. La suppression de l'introduction automatique est aussi demandée et réalisée.

Le village cumule deux coûts importants : une nouvelle passe de toute la scène pour le verre dépoli et un rendu détaillé comportant beaucoup de meshes et de géométrie. Supprimer la ReflectionProbe de la vitrine ne supprimait pas la capture `campus-glass-background`. Celle-ci porte les appels de dessin de **559 à 1 264 par frame** dans la scène stabilisée mesurée. Même sans cette capture, cette scène reste très loin de la cible de 45 FPS.

Le tore possède un autre point de ralentissement : ses postprocess, dont le brouillard volumétrique. Leur désactivation expérimentale porte le débit observé d'environ **18–22 à 28 FPS**. Ce résultat concerne l'ensemble des postprocess ; il ne mesure pas isolément le shader du brouillard.

Étude uniquement : aucun correctif du rendu, migration, reset, commande gameplay, commit ou push. Les manipulations concernent une page de mesure temporaire, fermée à la fin. Les modifications utilisateur déjà présentes sont conservées.

## Conditions et méthode

- Worktree courant, dernier commit `3648eab`, nombreux changements non committés préexistants.
- Serveurs de développement existants, compte de développement, village Clairière réel ; pas de fixture modifiée.
- Intel Core i7-1065G7, 4 cœurs / 8 threads, Intel Iris Plus Graphics, contexte ANGLE **Direct3D11** explicitement vérifié.
- Chrome headless matériel, viewport 1 440 × 900, rendu village 1 200 × 750, facteur de résolution normal 1.2.
- URL `terrainPerf=1` : désactive la réduction automatique propre à `navigator.webdriver`. Cadence moteur vérifiée à 45 FPS. Sans cette option le code impose 5 FPS et un facteur de résolution 4, impropres à mesurer l'usage normal.
- Échantillons de 10 secondes après 2.5 secondes d'attente ; caméra village identique : alpha −0.6708, beta 1, rayon 36. Retrait/restauration du render target dans la page, sans modification du dépôt.
- Temps de frame mesuré entre `onBeginFrameObservable`, temps synchrone de callback entre début et fin de frame, enveloppe de `scene.render()`. FPS du tableau calculés comme `1000 / intervalle moyen`, plutôt que le compteur instantané lissé du moteur.
- Profil CPU CDP après les comparaisons village ; passage Région puis Monde par les commandes clavier du canvas, suivi d'une comparaison avec/sans/restauration des postprocess.
- Première tentative SwiftShader **écartée** des conclusions de cadence. Premier échantillon village matériel encore en chargement, également écarté des comparaisons stabilisées.

Les chronométrages CPU incluent les appels au pilote WebGL et leurs éventuelles attentes. **Aucun temps GPU isolé par timestamp GPU n'a été mesuré.** La charge des autres applications, la fréquence et la température de la machine ne sont pas contrôlées. Les restaurations montrent une variation importante : les chiffres sont des observations locales, pas un gain garanti ni un benchmark de production. La capture finale du village a été examinée ; aucune erreur `pageerror` dans la série finale. Le processus de mesure final s'est terminé avec succès.

## Mesures du village stabilisé

Même scène pour les trois lignes suivantes : 1 319 meshes, 641 actifs, 3 371 161 sommets selon le compteur Babylon, 1 200 × 750. Le nombre de sommets est un compte logique de scène ; il ne représente ni la mémoire GPU unique ni le nombre de sommets effectivement dessinés, notamment en présence de géométries partagées et de thin instances.

| Variante, dans l'ordre mesuré | Intervalles | Frame moyenne | P95 frame | Débit calculé | Callback synchrone moyen | `scene.render()` moyen | Appels de dessin observés |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Capture restaurée | 63 | 158.0 ms | 215.4 ms | 6.3 FPS | 148.7 ms | 141.9 ms | 1 264 |
| Capture retirée, répétition | 99 | 100.9 ms | 147.1 ms | 9.9 FPS | 92.7 ms | 86.4 ms | 559 |
| Capture restaurée, répétition | 27 | 367.3 ms | 457.9 ms | 2.7 FPS | 330.1 ms | 312.2 ms | 1 264 |

Le retrait réduit les appels de dessin de **705, soit 55.8 %** ; le nombre de meshes et la caméra ne changent pas. La différence de temps avant/après est nette dans cette répétition, mais l'amplitude varie trop pour annoncer un pourcentage universel de gain. La restauration confirme le coût supplémentaire de la passe.

Première série matérielle, baisse de résolution 1 200 × 750 → 720 × 450 avec capture conservée : 192.7 → 157.0 ms de frame moyenne, puis 342.3 ms après retour à la résolution initiale. Le rendu à 720 × 450 traite 36 % des pixels du rendu initial ; la capture reste à 512 × 512 et les appels de dessin autour de 1 264. Cette mesure exploratoire est trop variable pour isoler le coût des pixels. Elle ne suffit pas à conclure que le village est exclusivement limité par le CPU ou le GPU.

## Points de ralentissement

### 1. Verre dépoli : une capture globale à chaque frame — confirmé par expérience

[`frosted-glass.ts`](../apps/world-web/src/scene/frosted-glass.ts) crée une `RenderTargetTexture` de 512 × 512 partagée entre les vitres. Sa liste contient tous les meshes avec sommets, à l'exception de son propre matériau. La liste finale observée compte **1 199 meshes**, `refreshRate = 1`. Dès qu'au moins une vitre existe, la capture reste dans `scene.customRenderTargets` ; son admission n'est pas conditionnée à la visibilité des vitres à l'écran.

Le cache de liste évite déjà sa reconstruction systématique : ce coût historique n'est pas réintroduit. Le problème restant est le **rendu supplémentaire** de la scène et ses préparations de matériaux/lumières. Les vitres de l'hôtel et du campus utilisent toujours ce chemin. La vitrine du rez-de-chaussée emploie séparément une cubemap statique ; son remplacement précédent n'a donc pas éliminé la capture du verre dépoli.

Recommandation proposée : commencer par éviter la capture lorsque ses vitres n'ont aucune contribution visible, puis borner la capture aux objets nécessaires ou espacer sa mise à jour. Le choix d'un verre simplifié modifie l'apparence et demande un arbitrage visuel. Ne pas annoncer qu'une fréquence réduite résout à elle seule les 559 draws résiduels.

### 2. Géométrie et nombre de soumissions du village — volume mesuré, gain de simplification à démontrer

Principaux meshes observés :

| Mesh | Sommets |
| --- | ---: |
| `hall-market-upper-room-hall-cut-stone` | 435 069 |
| Université, maçonnerie du hall Mathématiques | 178 640 |
| `hall-market-ground-floor-hall-cut-stone` | 147 855 |
| Université, maçonnerie Médecine | 140 672 |
| `market-rounded-masonry` | 84 640 |
| Université, plateforme Mathématiques | 75 376 |
| `hall-market-clock-pavilion-hall-cut-stone` | 55 104 |
| Plusieurs maçonneries de maisons précompilées | 52 192 chacune |

La seule salle haute de l'hôtel représente environ **12.9 %** du compte logique de sommets de la scène. [`town-hall-market-factory.ts`](../apps/world-web/src/scene/town-hall-market-factory.ts) impose des pierres `.14 × .07`, 18 assises et un profil arrondi à trois segments. [`timber-thatch.ts`](../apps/world-web/src/scene/timber-thatch.ts) fabrique les facettes et les extrémités de chaque pierre avant fusion : une pierre arrondie standard de ce profil comporte 224 sommets avant les découpes. La fusion diminue les meshes, mais pas ce volume géométrique.

Les bâtiments précompilés partagent déjà les géométries en cache de scène. [`building-assets.ts`](../apps/world-web/src/scene/building-assets.ts) demande cependant `doNotInstantiate:true`, donc des clones et des soumissions séparées ; ce cache ne constitue pas un batching des draws. L'hôtel niveau 2 passe par le générateur local pour ses éléments animés. Le LOD des arbres existe ; les chemins de bâtiments étudiés ne proposent pas de variante simplifiée par distance.

Recommandation proposée : mesurer séparément hôtel, campus et maisons, puis fournir une représentation plus simple de la maçonnerie aux distances où les petits chanfreins ne sont plus visibles. Tester aussi le regroupement/instanciation des modèles répétés. La simplification de façade doit préserver le dessin validé de près. Aucun de ces gains n'est considéré acquis ici.

### 3. Préparation Babylon et appels WebGL — profil CPU

Profil stable de 18.8 secondes effectives, demandé sur une fenêtre de 10 secondes ; l'attente des commandes CDP allonge la fenêtre sur cette machine lente. Temps propres échantillonnés, non additionnables à des durées inclusives de frame :

- `Mesh.render` : environ 1.086 s.
- Liaison des lumières : `_bindLight` 0.664 s et `BindLights` 0.249 s.
- Matériaux : `StandardMaterial.isReadyForSubMesh` 0.583 s, `ShaderMaterial.isReady` 0.509 s, `bindForSubMesh` 0.283 s.
- Tri `_RenderSorted` : 0.466 s ; sélection `_evaluateActiveMeshes` : 0.265 s.
- `computeWorldMatrix` : 0.135 s ; appels WebGL de matrices, dessin et vertex arrays également présents.
- `(program)` : 8.855 s, environ 47 % de la fenêtre ; catégorie **non attribuée**, pas une preuve de temps GPU.

Les piles montrent le coût de soumettre et préparer beaucoup de sous-meshes à deux passes. Elles ne désignent pas les animations d'habitants comme premier responsable dans ce cadrage. Il reste possible que les appels au pilote bloquent sur le GPU. Réduire les passes et les soumissions est mieux étayé que lancer un refactor général React ou du streamer.

### 4. Tore : postprocess et brouillard volumétrique — confirmé pour le groupe de postprocess

| Variante | Intervalles | Frame moyenne | P95 | Débit calculé | Callback synchrone moyen |
| --- | ---: | ---: | ---: | ---: | ---: |
| Monde normal | 214 | 46.4 ms | 71.8 ms | 21.6 FPS | 11.0 ms |
| Postprocess désactivés | 285 | 35.2 ms | 59.3 ms | 28.4 FPS | 14.0 ms |
| Postprocess restaurés | 184 | 54.3 ms | 87.3 ms | 18.4 FPS | 14.5 ms |

Le village ne se rend pas pendant ces échantillons : zéro appel à son `scene.render()`. Sa capture de verre demeure résidente mais ne s'exécute pas. Le tore contient 32 meshes dans sa scène. Le petit callback synchrone et les intervalles plus longs sont compatibles avec un coût GPU/composition/cadence ; ce n'est pas un chronométrage GPU direct.

[`torus-fog.ts`](../apps/world-web/src/scene/torus-fog.ts) ajoute une passe de profondeur, une copie pleine résolution, un volume à demi-résolution et une composition. Le volume autorise 96 pas par pixel ; chaque pas dense peut appeler un calcul d'occultation solaire de 20 itérations. Le groupe est coûteux sur Iris Plus. [`cosmology-world.ts`](../apps/world-web/src/scene/cosmology-world.ts) ajoute aussi une ombre de lumière ponctuelle 512, rafraîchie toutes les quatre frames. Son coût isolé n'a pas été mesuré.

Recommandation proposée : profiler le volume seul et ses paramètres de pas/résolution, puis adapter sa qualité. La comparaison désactive tous les postprocess de la scène, y compris les éventuels autres effets : ne pas attribuer l'intégralité du gain au brouillard.

### 5. Chargement et travail par frame — lecture du code, preuves limitées

La préparation observée des meshes de l'hôtel arrive après environ 25–30 secondes depuis le début du script matériel, mais cette durée inclut login, navigation, imports Vite, téléchargement, construction et cinématique. **Ce n'est pas un temps réseau ou de génération isolé.** La résidence continue d'augmenter au début des séries, d'où l'exclusion de ces échantillons des comparaisons stabilisées.

`#advanceBuildings()` possède un budget de 8 ms entre les unités ; un `steps.next()` long n'est pas interruptible. L'hôtel est composé localement, contrairement aux assets précompilés : mesurer son temps de fabrication isolé et ses uploads avant de recommander sa précompilation. Le budget du streamer est distinct et ne garantit pas celui de chaque bâtiment.

La boucle réénumère aussi à chaque frame les descendants des bâtiments (`getChildMeshes()`), les meshes du terrain (`meshes()` produit de nouveaux tableaux), et les descendants des groupes d'habitants pour réappliquer les visibilités. Ces allocations/parcours sont de bonnes cibles secondaires après les passes et les draws, mais leur gain isolé n'est pas mesuré. La météo possède déjà une génération répartie sur 2 ms et un rafraîchissement de champ toutes les deux secondes. La scène de transition nuageuse ne se rend pas lorsque son alpha est nul ; elle n'explique pas les mesures stabilisées.

## Ordre de travail proposé

1. Borner et conditionner la capture de verre dépoli ; comparer à nouveau le parcours normal et vérifier l'apparence.
2. Mesurer puis réduire les draws et le détail géométrique des bâtiments, en commençant par l'hôtel et les maisons répétées ; garder le rendu détaillé de près.
3. Isoler le coût du brouillard du tore et régler sa qualité sur Iris Plus.
4. Mesurer à part la fabrication/upload de l'hôtel, puis les allocations récurrentes de visibilité si elles restent significatives.

Le budget cible est 22.2 ms/frame à 45 FPS ; la spec des vues vise un P95 d'intervalle ≤ 40 ms sur matériel de référence. Aucun des parcours mesurés avec les effets normaux ne satisfait cette dernière cible. Les essais sans capture ou sans postprocess sont des diagnostics, pas une livraison acceptable telle quelle.

## Artefacts locaux et limites restantes

Artefacts ignorés par Git dans `test-results/` : `render-audit.mjs`, `render-audit-results.json`, `render-audit-first-hardware.json`, `render-audit-cpu-stable.json`, `render-audit-village.png`. Le script utilise les identifiants publics du compte de développement du seed ; aucun secret d'environnement n'est copié. Reproduction : serveurs dev existants puis `node test-results/render-audit.mjs` ; nécessite Chrome et une session de développement compatible.

Restent à mesurer : timings GPU par passe, build de production, profils jour/nuit et mouvement/picking, coût isolé de chaque famille de bâtiments et des ombres, API/réseau/décodage, mémoire prolongée, mobile réel. Aucun test applicatif lancé pour cette étude sans changement d'implémentation. La vérification effectuée porte sur les expériences navigateur, leurs résultats, le code lié et la documentation.

## Première tranche réalisée et remesurée

Dépoli : StandardMaterial opaque, petit reflet ciel/sol statique partagé 32 × 16, Fresnel et spéculaire. Une première variante diffuse était trop sombre, signalée par Tristan ; elle est remplacée par ce reflet statique. Aucun render target/probe ni dessin supplémentaire de scène. Le reflet suit les lumières, niveau .7 de jour et .238 de nuit dans le parcours vérifié (soleil .85 → 0, ambiante .34 la nuit). Les captures jour/nuit montrent des fenêtres gris bleuté et le contraste nocturne ; vitrine et six stocks exposés restent distincts et visibles.

Géométrie : blocs droits à 24 sommets, bois à 48 sommets avec chanfrein de section conservé, petit chanfrein des extrémités supprimé. Joints et réservations restent géométriques ; pas de LOD nouveau. Instanciation native des recettes précompilées, transforms/UUID/culling individuels, matériaux communs conservés au retrait. Sources masquées enregistrées pour les lumières ; chemin alternatif des braseros adapté. Ombres de contact instanciées. Modèles et miniatures régénérés.

Manifeste vérifié : 20 modèles, 10 miniatures de 384 × 240 ; tailles de fichiers et copies de production cohérentes. Total des modèles compressés : **18 359 710 → 8 064 007 octets (−56.1 %)**. Cela mesure les fichiers à transférer, pas la VRAM ni les temps de décodage.

| Partie | Avant | Après |
| --- | ---: | ---: |
| Salle haute, lot pierre | 435 069 | 42 537 |
| Campus Mathématiques, lot pierre | 178 640 | 38 280 |
| Campus Médecine, lot pierre | 140 672 | 30 144 |
| Socle Mathématiques | 75 376 | 16 152 |

Mesure finale : même GPU Iris Plus / D3D11, viewport 1440 × 900, rendu 1200 × 750, plafond 45 FPS. Pose documentée reproduite : alpha −.6707963, beta 1, rayon 36, focale .501, cible locale [32.5, .45, 51.25]. **L'audit initial n'avait pas enregistré la cible/focale ; le cadrage identique ne peut donc pas être prouvé.** Population et météo ont également évolué. Le total logique de 1 519 076 sommets représente environ −55 % face à la référence de 3 371 161, mais inclut les sources/instances et le terrain résident. Ce n'est pas un pourcentage de réduction de mémoire GPU. 270 instances, 661 meshes actifs, 387 draws par frame en développement, zéro capture et zéro rendu de la scène du tore dans les trois fenêtres finales.

Temps de frame, trois fenêtres de 10 s : développement, moyennes 433.7 / 147.9 / 88.5 ms, P95 1047.9 / 249.6 / 156.6 ms ; build de production, moyennes 199.0 / 195.2 / 206.5 ms, P95 687.5 / 377.2 / 384.7 ms. Variation importante, y compris après chargement des modèles : **aucun gain stable de FPS démontré, objectif P95 ≤ 40 ms non atteint**. Production : `navigator.webdriver` masqué uniquement dans la page de mesure pour neutraliser le profil automatique 5 FPS ; résolution et plafond normal vérifiés. L'absence d'instrumentation Babylon en production laisse son compteur interne de draws cumulatif : valeurs brutes 66 668 / 96 932 / 121 376 exclues comme mesures par frame. La première lecture de mémoire utilisant `getVerticesData()` sur tous les formats empaquetés a échoué ; corrigée pour lire les buffers bruts, sans assimiler une exception d'instrumentation à une panne du rendu.

Les budgets proposés de 1.35 million de sommets, 220 draws et 400 meshes actifs ne sont pas atteints sur ce cadrage. Restent notamment la maçonnerie courbe à 84 640 + 40 152 sommets, le lot pierre du Tailleur à 50 556, les soumissions/préparations natives et le coût hors `scene.render()` : CPU du callback production moyen 123–184 ms, invocation de rendu village 109–135 ms. Les chiffres ne sont pas des timings GPU. La suppression de la capture est démontrée ; le problème global de fluidité reste ouvert.

Contrôle distinct en production, même pose et qualité, compteur obtenu par différence début/fin de frame : **30 frames, 353–368 draws, moyenne 363.7**, 642 meshes actifs, 1 501 503 sommets logiques, 270 instances, zéro capture. Le terrain résident explique les petites différences de totaux avec les fenêtres précédentes. Compteur Babylon : 608 412 triangles actifs ; somme des données de buffers vertex uniques et indices : 20 084 260 octets (environ 19.2 Mio), sans textures, matrices d'instances, allocations du moteur ni copies CPU supplémentaires. Pas de mesure mémoire initiale équivalente : aucun gain de VRAM chiffré. La première tentative de ce contrôle utilisait une méthode absente sur le buffer GPU brut ; instrumentation corrigée pour lire les données des VertexBuffer, puis contrôle achevé avec succès.

Factory isolée, capacité d'accès simulée dans la seule page de test : hôtel 2, campus 3, maison pierre 2 et troncs 2, états achevé/travaux, orientations 0°/180°. Zéro capture/probe ; exposition et vitrine présentes achevées et retirées aux travaux ; aucune erreur navigateur. Captures hôtel et maisons examinées. Ce test ne valide pas les autorisations serveur de la factory, inchangées. Première tentative sans authentification arrêtée par le contrôle d'accès, pas comptée comme preuve graphique.

Vérifications : 38 fichiers / 153 tests de scène terminés verts ; test dépoli final relancé vert après ajout du reflet statique, couvrant partage, absence de capture et modulation des lumières. Régression de picking/removal de deux instances et de liaison des braseros. Typecheck racine, lint racine puis lint ciblé final et build world-web terminés verts (avertissement de gros chunks). Entrée/rechargement Chrome matériel : test `village-entry.spec.ts` vert, avec observation des changements de vue/dialogue dès le chargement ; première attente sur une métrique réservée au mode E2E puis mauvais nom de champ corrigés dans le test, sans les compter comme validations du produit. Aucun reset de base ni commande gameplay.

Artefacts locaux ignorés : `render-final-dev-results.json`, `render-final-production-results.json`, captures `render-final-*-village.png` et `glass-final-day/night.png`, scripts de mesure. Les mesures historiques restent conservées. Reste à isoler le temps GPU, la contribution des soumissions/préparations et du callback hors rendu, ainsi qu'à vérifier mobile réel et fluidité prolongée.
