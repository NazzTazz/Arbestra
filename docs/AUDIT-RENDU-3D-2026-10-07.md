# Profil du village après restauration des fenêtres — 7 octobre 2026

Suite de session : Tristan a autorisé l'implémentation d'optimisations ciblées après ce profil. La dernière section décrit les changements et leurs mesures ; les sections d'étude conservent leur contexte antérieur.

## Résultat

Étude demandée par Tristan, sans implémentation d'optimisations. Le rendu du village reste le poste principal : **15.4–18.0 FPS en production**, 417 appels de dessin par image, 691 meshes actifs, environ 1.52 million de sommets logiques. L'objectif de 45 FPS n'est pas atteint. Les fenêtres transparentes ne ressortent pas comme cause dominante.

Les profils CPU convergent vers les soumissions des objets opaques, l'évaluation des meshes actifs, la préparation des matériaux et leur liaison aux lumières. Les requêtes de temps GPU montrent également un coût important du rendu ; diminuer seulement le travail JavaScript ou seulement la résolution ne suffit pas à démontrer 45 FPS.

## Conditions et méthode

- Base `f9fc28d`, avec correction locale du verre à alpha .22 et cache des miniatures révisé. Modifications préexistantes conservées.
- Village Clairière de développement, Chrome headless matériel : Intel Iris Plus / ANGLE Direct3D11, vérifié dans chaque résultat. Aucune commande gameplay, migration ou réinitialisation.
- Viewport 1440 × 900, rendu normal 1200 × 750, plafond moteur 45 FPS. `terrainPerf=1` en développement ; `navigator.webdriver` masqué dans la seule page de mesure en production pour éviter le profil automatique 5 FPS.
- Caméra maintenue : cible [32.5, .45, 51.25], alpha −.6707963267948965, beta 1, rayon 36, focale .501. Même pose pour toutes les variantes. Vue diurne avec pluie ; météo et habitants continuent d'évoluer.
- 20 secondes de chauffe, puis 3 secondes de stabilisation après chaque variante et fenêtres de 8 secondes. Baselines intercalées et restauration finale. Profils CPU CDP collectés séparément après les comparaisons.
- Intervalles entre débuts de frames ; temps synchrones du callback et de `scene.render()` ; appels de dessin comptés aux entrées `drawElementsType` / `drawArraysType`, évitant les compteurs cumulatifs/reset de Babylon.
- GPU : requêtes WebGL2 `EXT_disjoint_timer_query_webgl2` autour du rendu village, lecture asynchrone, résultats disjoints rejetés, au plus quatre requêtes en vol. Il s'agit d'un temps écoulé GPU entre commandes, susceptible d'inclure des attentes de soumission ; **pas d'un taux d'occupation des unités GPU**, ni d'un temps à additionner au CPU. Quelques résultats différés peuvent provenir des dernières frames de stabilisation.
- Production reconstruite avec succès depuis le worktree courant, servie temporairement sur 5177 puis serveur arrêté. Avertissement habituel de gros chunks. Aucun test applicatif requis pour cette étude documentaire.

La compétence agent-browser a servi à ouvrir/vérifier le navigateur isolé ; les séries utilisent Playwright/CDP pour réutiliser les scripts locaux, instrumenter Babylon et collecter les requêtes GPU dans une même page. Une première tentative d'instrumentation GPU appelait une extension Babylon non chargée : échec explicite, puis remplacement par les requêtes WebGL directes ; cet essai n'est pas une mesure.

## Production : comparaison principale

Toutes les variantes ci-dessous gardent 417 draws et 691 meshes actifs. Les valeurs sont des observations locales, pas des gains garantis.

| Variante chronologique | Frames | Frame moyenne | P95 frame | FPS calculés | Rendu synchrone moyen | GPU moyen |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal | 133 | 60.1 ms | 89.7 ms | 16.6 | 52.0 ms | 42.9 ms |
| Lumières désactivées | 159 | 50.3 ms | 72.7 ms | 19.9 | 43.2 ms | 37.1 ms |
| Normal restauré | 144 | 55.5 ms | 73.9 ms | 18.0 | 47.7 ms | 39.8 ms |
| Rendu 600 × 375 | 167 | 47.8 ms | 90.1 ms | 20.9 | 42.2 ms | 29.0 ms |
| Normal final | 123 | 65.0 ms | 91.4 ms | 15.4 | 56.2 ms | 47.3 ms |

Le temps hors `scene.render()` dans le callback est d'environ 4.5–5.4 ms en production normale. Zéro rendu des autres scènes et zéro custom render target du village pendant les mesures. Le tore ne fournit donc pas ici une passe cachée à supprimer.

Diviser les pixels par quatre améliore le résultat, mais laisse près de 48 ms par frame. Cela confirme une composante sensible à la résolution, avec un travail résiduel important de préparation/soumission et de rendu indépendant de cette résolution. La coupure totale des lumières aide, plus modestement en production que dans la série de développement : ne pas promettre le gain de la série la plus favorable.

## Expériences de développement

Première série très variable : baselines normales 132–289 ms/frame, rendu 83–133 ms ; elle sert à identifier des postes, pas à comparer le niveau de performance absolu à la production.

- **Verre opaque** : 190.1 ms/frame, contre 192.3 ms après retour transparent immédiat. Rendu 121.6 contre 128.1 ms ; 417 draws dans les deux cas. Aucun gain net de cadence démontré par cette expérience unique. Conserver le voile accepté par Tristan.
- **Éléments de parcelles masqués** (`metadata.siteId`, donc bâtiments, jardins et accessoires associés) : environ 122–125 draws, 119 actifs, rendu 37.7 ms et frame 68.8 ms. Les baselines encadrantes restent beaucoup plus lentes. Cette expérience ne distingue pas encore une famille de bâtiments particulière et n'autorise pas à attribuer tout le coût à l'hôtel.
- **Appel au rendu village sauté** : callback 3.8 ms, frame 24.7 ms, zéro draw. Le coût principal disparaît avec le rendu. Cela retire aussi les observateurs/animations exécutés dans `scene.render()` ; ce n'est pas une mesure exclusive des draw calls.
- **Ombres puis postprocess coupés** : 417 draws conservés et aucune amélioration nette dans cette série bruitée. `shadowsEnabled=false` ne retire pas les meshes d'ombres de contact. Ce test ne prouve pas que toutes les formes d'ombres coûtent zéro.

Seconde série, avec chronométrage GPU, plus stable : normales 72.3–93.0 ms/frame, GPU 51.7–68.3 ms. Sans lumières : frame 49.0 ms, GPU 27.7 ms ; restauration suivante 93.0 / 68.3 ms. Sans particules : frame 56.0 ms, GPU 39.1 ms et 414 draws contre 418. Résolution 600 × 375 : 48.1 / 28.7 ms ; normale finale 72.3 / 51.7 ms. Particules et éclairage constituent des pistes secondaires, à isoler plus finement avant de modifier pluie ou flammes.

## Profil CPU et lecture du code

Profil production final : 13.27 s échantillonnées. Pourcentages inclusifs, **non additionnables** car plusieurs fonctions sont imbriquées :

| Poste | Part des échantillons |
| --- | ---: |
| Enveloppe du rendu village | 78.6 % |
| Branche de rendu opaque `_renderOpaqueSorted` | 54.5 % |
| Liaison des matériaux `bindForSubMesh` | 17.6 % |
| Évaluation des objets actifs `_evaluateActiveMeshes` | 16.1 % |
| Préparation des matériaux `isReadyForSubMesh` | 15.1 % |

La branche transparente `_RenderSorted` représente environ 3.5 % dans ce profil, contre 54.3 % pour la branche opaque. Cela concorde avec la comparaison du verre. La catégorie `(program)` reste non attribuée (11.5 %), sans être assimilée à du temps GPU.

Le premier profil développement contenait environ 18 % sous le scheduler React et de nombreuses comparaisons `addObjectDiffToProperties`. Le second n'en contient plus qu'environ 3.9 % sous ce scheduler. Lecture de React livré : ces comparaisons servent notamment aux diagnostics User Timing des composants. C'est un surcoût observé et variable, **pas une explication suffisante des bas FPS de production**.

Code relu :

- `building-assets.ts` utilise déjà des instances natives ; il ne suffit donc pas de proposer « activer l'instanciation ». Il faut identifier les lots/matériaux encore séparés et les objets qui restent soumis individuellement.
- `BabylonVillageScene.ts` réapplique des visibilités et parcourt les descendants à chaque frame ; `village-workers.ts` fait aussi ce travail pour les habitants. Les mesures actuelles placent ces coûts après le rendu.
- `village-braziers.ts` peut dégeler les matériaux pour intégrer l'éclairage groupé ou local. Le profil justifie d'étudier les invalidations et vérifications répétées, **sans geler globalement les matériaux** au risque de casser jour/nuit et les lumières.
- Les fenêtres partagent un StandardMaterial alpha .22 et une texture statique ; aucun retour de la capture historique du décor.

## Prochaine tranche recommandée — proposée, non implémentée

1. Instrumenter les lots opaques par famille et matériau pour réduire les soumissions et les objets actifs sans changer la silhouette ni les ouvertures. Cibler ensuite des regroupements bornés et les caches des données statiques réellement invariantes ; garder picking et cycle de vie individuels.
2. Examiner la préparation/liaison des matériaux et les invalidations dues aux lumières. Limiter le travail répété sans supprimer l'éclairage ni casser ses transitions ; valider dans une comparaison isolée avant généralisation.
3. Mesurer séparément pluie et flammes, puis envisager une qualité de résolution adaptable si souhaitée. La baisse de résolution seule ne règle pas le problème observé.

Ne pas refaire une simplification esthétique du verre pour cette tranche. Ne pas choisir un nombre de sommets comme unique indicateur : le profil demande aussi de réduire les draws et les préparations par objet.

## Limites, preuves et artefacts

Machine partagée : autres processus Chrome présents, charge/fréquence/température non contrôlées. Météo, animations et snapshots continuent ; variation résiduelle visible même en production. La première capture de développement affiche « Terrain : connexion interrompue » ; la capture finale production n'affiche plus cet état. Aucun diagnostic réseau exhaustif réalisé. Les premières fenêtres ont une légère variation du terrain résident ; les séries GPU et production gardent 691 actifs et des comptes stables.

Les trois processus de mesure finaux sont terminés avec succès, sans erreur `pageerror`. Captures développement et production examinées. Pas de déplacement prolongé, profil nocturne, mobile, ni benchmark exclusif de la machine ; pas de promesse de FPS après une optimisation encore non réalisée.

Artefacts locaux ignorés dans `test-results/` : `profile-current.mjs`, `profile-gpu.mjs`, `profile-production.mjs`, résultats JSON correspondants, profils `.cpuprofile`, captures `*-village.png`, générateurs des scripts et `summarize-profile.mjs`. Les scripts de génération production découvrent le nom du bundle courant après build. Les variantes temporaires sont restaurées avant la fermeture des navigateurs. Aucun correctif de rendu supplémentaire, commit ou push dans cette étude.

## Optimisations ciblées implémentées après le profil

Autorisation : « je te laisse implémenter des optimisations ciblées et mesurées ». Deux changements conservés, sans changement de résolution, de matériau, de silhouette, ni du verre accepté :

1. **Jardins** : les bordures de terre, surfaces par stade et marqueurs pleins utilisent des sources partagées et des instances natives. Les surfaces restent ouvertes dessous, à la même hauteur, avec les mêmes textures/matériaux météo. Au plus onze sources dans une scène (sol, huit stades, deux marqueurs), réutilisées aux remplacements. Parents et identifiants de parcelles restent individuels ; déplacement du repère et suppression n'affectent pas les voisines.
2. **Scieries** : les pièces statiques de chaque bâtiment sont fusionnées par matériau avant application de sa position. Fondation et identité du bâtiment conservées ; aucune fusion entre bâtiments. Au plus neuf meshes par scierie, contre quarante pour le niveau présent dans le cadrage. Aucun changement du nombre de triangles.

Le profil par mesh a conduit à privilégier ces lots identifiés plutôt qu'un gel global des matériaux ou des listes actives, qui demanderait de nouvelles règles d'invalidation pour les lumières et le streaming.

### Mesures avant/après

Ancien build complet conservé localement avant modification, puis build optimisé servi séparément. Même Chrome matériel Iris Plus / D3D11, viewport 1440 × 900, rendu 1200 × 750, plafond 45, caméra du profil. Exécution séquentielle, sans build/test simultané aux fenêtres de performance. Les autres applications de la machine restent non contrôlées.

| Poste, cadrage stabilisé | Avant | Après |
| --- | ---: | ---: |
| Dessins des jardins visibles | 68 | 4 |
| Dessins des trois scieries | 120 | 27 |
| Total de la scène, première série stabilisée | 417 | 260 |
| Total, répétition à heure solaire 9:00 | 418 | 261 |
| Meshes actifs | 691 | 613 |

**157 dessins en moins par frame, soit environ 38 %**, retrouvés dans les deux séries. L'écart de un draw entre séries correspond à d'autres éléments animés ; jardins et scieries expliquent exactement les 157 supprimés. Les triangles gardent leur forme et leur nombre : le compteur logique de sommets reste proche de 1.52 million, et ne mesure pas les octets GPU uniques.

Première série : les deux premières fenêtres de l'ancien build ont encore un nombre d'actifs variable (681 puis 690), donc exclues comme baselines stabilisées. Dernière fenêtre ancienne : 199.9 ms/frame ; nouvelles : 82.9, 81.2 et 54.5 ms. Ces temps très variables ne justifient pas un facteur de gain de FPS.

Répétition : chauffe 30 s, heure solaire fixée à 9:00 par le contrôle réel, trois fenêtres de 6 s après 3 s de stabilisation. Soleil constant à .85 ; météo/ambiante et habitants continuent d'évoluer. Pas de gel économique ni de modification serveur.

| Variante | Frames | Frame moyenne | P95 frame | FPS calculés | GPU écoulé moyen |
| --- | ---: | ---: | ---: | ---: | ---: |
| Avant 1 | 78 | 75.9 ms | 135.2 ms | 13.2 | 57.9 ms |
| Avant 2 | 63 | 95.2 ms | 168.8 ms | 10.5 | 65.5 ms |
| Avant 3 | 59 | 100.5 ms | 134.6 ms | 9.9 | 73.1 ms |
| Après 1 | 118 | 51.0 ms | 65.2 ms | 19.6 | 36.3 ms |
| Après 2 | 88 | 67.9 ms | 122.6 ms | 14.7 | 48.0 ms |
| Après 3 | 58 | 101.9 ms | 177.3 ms | 9.8 | 65.4 ms |

Les deux premières fenêtres montrent une amélioration, la dernière recouvre le niveau précédent. **Gain structurel établi, gain de FPS non garanti ; 45 FPS et P95 ≤ 40 ms non atteints.** Pas de comparaison en pourcentage avec le profil précédent, dont la charge machine différait.

### Vérifications

- Suite de scène terminée : **40 fichiers / 158 tests verts**. Nouveaux tests : partage par stade, récolte simulée par remplacement graphique, picking des voisines, suppression, rebase, sources libérées à la destruction de scène ; niveaux 1–3 des scieries, nombre de triangles, implantation/rotation et picking indépendant.
- Comparaison isolée ancienne/nouvelle scierie, aux trois niveaux et avec translation/rotation : 780 / 728 / 776 triangles conservés, mêmes affectations de matériaux et UV, écart maximal des positions 4.77 × 10⁻⁷ unité. Première comparaison par hash quantifié trop stricte : remplacée par une comparaison numérique à tolérance 10⁻⁵ ; aucune modification de géométrie pour satisfaire ce contrôle.
- Build world-web final et lint ciblé terminés avec succès ; avertissement de gros chunks conservé. Une assertion de test utilisait initialement une propriété Material inexistante : typecheck l'a détectée, assertion corrigée avant le build vert. Un premier lancement du contrôle isolé était exclu par la configuration Vitest ; relancé avec configuration locale dédiée.
- Première recette navigateur production : quatre positions nocturnes du cycle, alpha verre .22, zéro capture, sources de jardins actives ; picking natif des parcelles `1094:18` et scierie `1106:20`, rotation/zoom par pointeur, aucune erreur de page et aucune commande gameplay. Captures nuit et vues rapprochées examinées. Recette finale terminée : nuit à 0:00 (soleil 0), jour à 9:00 (soleil .85), mêmes identités au picking, rotation/zoom et passage Village → Région → Village vérifiés. Zéro erreur navigateur, zéro commande métier ; capture finale de jour examinée.

Artefacts ignorés : `optimization-before-dist/`, `measure-targeted.mjs`, `targeted-{before,after,before-repeat,after-repeat}-results.json`, scripts générés et captures, `sawmill-geometry-comparison.json`, `check-targeted-visual.mjs` et sa preuve JSON. Aucun commit/push ni migration. Les changements de verre et l'export de session déjà présents sont conservés.

## LOD du campus dans la vue Village

Nouvelle tranche demandée le 7 octobre, après les corrections d'Exploitation. La référence est le checkout `main` à `f9fc28d` **avec ses modifications locales antérieures conservées** ; ce n'est ni le commit nu ni les chiffres des audits précédents. Babylon installé et verrouillé : **8.56.2**. Le numéro déclaré dans le package reste une plage `^8.26.0`.

### Coût et choix

Le village de référence contient un campus niveau 3, un hôtel niveau 2, des maisons des trois variantes, jardins, scieries et tailleur. L'hôtel produit 240 044 sommets logiques et 66 meshes géométriques propres ; le campus 188 713 / 40 avec ses monuments. Une maison en pierre niveau 2 représente environ 20 900 sommets mais partage ses sources et ses draws avec les autres exemplaires de sa recette. Le campus statique est donc une première famille pertinente : 39 lots propres avant monuments, tandis que l'hôtel demande de traiter séparément horloge, vitrine, exposition et façade courbe.

Deux résultats distincts : réunir les joints de mortier imperceptibles réduit les sommets/indices ; regrouper localement les pièces par matériau réduit les draws. Ouvertures réelles, charpentes, menuiseries, silhouette, teintes, arbres et différences de niveaux/travaux sont conservés. Les assets proches et miniatures n'ont pas été régénérés.

| Recette campus | Sommets détaillés → distants | Indices détaillés → distants | Lots détaillés → distants | Asset distant gzip |
| --- | ---: | ---: | ---: | ---: |
| Niveau 1 achevé | 82 500 → 45 708 | 130 746 → 75 558 | 26 → 8 | 483 992 o |
| Niveau 1 travaux | 52 948 → 27 964 | 81 282 → 43 806 | 19 → 5 | 268 079 o |
| Niveau 2 achevé | 120 596 → 63 788 | 188 202 → 102 990 | 33 → 8 | 572 873 o |
| Niveau 2 travaux | 91 640 → 46 088 | 139 860 → 71 532 | 28 → 5 | 354 737 o |
| Niveau 3 achevé | 188 268 → 96 036 | 290 394 → 152 046 | 39 → 8 | 722 848 o |
| Niveau 3 travaux | 133 852 → 68 452 | 204 102 → 106 002 | 33 → 5 | 460 353 o |

Ces nombres proviennent des buffers des `.abmesh.gz`, hors monuments communs. Un lot possède un matériau et un sous-maillage. Le campus niveau 3 distant retire **49 % des sommets et 47,6 % des indices**, puis **31 lots**. Cela ne signifie pas −49 % de coût pour l'ensemble du village.

L'API native a été confrontée au code installé : `Mesh.getLOD()` choisit selon sa sphère ; `InstancedMesh.getLOD()` lui transmet la sphère de l'instance ; `useLODScreenCoverage` compare une couverture normalisée. Un LOD par pièce aurait ici des tailles et bascules incompatibles. La sélection coordonnée de deux variantes du campus évite cette fragmentation, avec un observateur local et des instances classiques, sans remplacer le streamer ni adopter des thin instances collectives. Références : [LOD Babylon](https://doc.babylonjs.com/features/featuresDeepDive/mesh/LOD), [instances](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/instances), [AssetContainer](https://doc.babylonjs.com/features/featuresDeepDive/importers/assetContainers) ; la preuve de comportement est le code 8.56.2 et les essais, les pages documentaires servies en JavaScript n'ayant pas fourni de corps exploitable à la lecture automatisée.

Seuil unique : **diamètre de la sphère du campus < 320 pixels de rendu**. La projection utilise la vraie matrice de caméra, sa profondeur, le viewport et l'échelle du parent ; focale et inclinaison sont donc prises en compte. La bascule porte sur tous les nœuds d'une représentation, en désactivant l'ancienne avant d'activer la suivante. Pas de fondu ; pas d'hystérésis ajoutée sans oscillation observée. Le détail existant reste actif aux cadrages proches et de gestion retenus. Voir [l'intégration](SPEC-OPTIMISATION-RENDU-BATIMENTS.md#6-lod-du-campus-en-village--tranche-du-7-octobre).

### Protocole reproductible

Windows, Intel Core i7-1065G7 (4 cœurs / 8 threads), Chrome / WebGL2 / ANGLE **Intel Iris Plus, Direct3D11 vs_5_0 ps_5_0**. La MX230 également installée n'est pas le renderer utilisé. Viewport 1440 × 900, rendu 1200 × 750, scaling 1,2, plafond normal 45 FPS. Même build Vite de production, même snapshot local enregistré et resservi, mêmes paramètres graphiques, aperçu solaire 9:00 (minute 540). GET seulement après connexion ; aucun ordre métier, migration ni reset. Machine partagée : autres applications et fréquences CPU/GPU non contrôlées.

| Pose | Cible locale XYZ | Rayon | Alpha | Beta | FOV | Diamètre campus après |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Proche | 7,5 ; 0 ; 56,25 | 40 | −0,67 | 1 | 0,505 | 790,7 px, détaillé |
| Gestion | 32,5 ; 0,02 ; 51,25 | 65 | −0,67 | 0,85 | 0,51 | 374,1 px, détaillé |
| Dézoom Village | 32,5 ; 0,02 ; 51,25 | 105 | −0,67 | 0,8 | 0,523 | 244,5 px, distant |

Le campus se trouve en haut/gauche du cadrage de gestion ; le dézoom le montre entièrement, avec le village. La pose proche cible son centre et montre les détails. Le mode est contrôlé comme `village` dans chaque mesure. Les coordonnées de la fixture sont conservées dans les JSON ; après navigation/rebase, le contrôle de cycle utilise la position courante du parent, pas une ancienne coordonnée locale.

Reproduction, depuis la racine (serveurs de développement habituels déjà démarrés, sans seed/reset) :

```powershell
# Avant toute modification : build world-web et copie de son dist vers test-results/lod-before-dist.
node tests/browser/village-lod-server.mjs test-results/lod-before-dist 5188
node tests/browser/village-lod-server.mjs apps/world-web/dist 5189
# Dans un autre terminal, exécutions séquentielles, aucune suite/build simultané :
node tests/browser/village-lod-profile.mjs before-repeat 5188 test-results/lod-before-dist
node tests/browser/village-lod-profile.mjs after-repeat 5189 apps/world-web/dist
node tests/browser/village-lod.mjs
```

Le profil écrit la fixture `test-results/lod-village.json` si absente, puis la réutilise. Les données, builds, JSON et PNG restent ignorés. Il neutralise le seul indicateur d'automatisation pour retrouver le rendu normal et vérifie 45 FPS / 1200 px ; **une première capture bridée à 5 FPS / 360 × 225 a été écartée**. Après chargement des assets : chauffe 20 s, stabilisation de chaque pose, puis fenêtre de 6 s. La répétition ajoute six secondes sans changement de compteurs de ressources et attend la disparition du chargement terrain.

Les draws sont interceptés sur les appels moteur, toutes passes de ce moteur comprises. Les indices soumis sont multipliés par le nombre d'instances ; les sommets des draws non indexés sont comptés séparément. La somme des sommets de sources connues par batch est une estimation partielle, pas un compteur d'invocations GPU. Les temps CPU publiés sont des **durées murales du callback de frame**, susceptibles d'inclure attente pilote/GPU ; ils ne mesurent pas l'occupation CPU exclusive. `EXT_disjoint_timer_query_webgl2` expose le temps GPU autour de `scene.render()`, résultats disjoints écartés ; ce n'est pas le temps du compositeur Chrome. Aucune déduction de temps GPU à partir des draws.

### Résultats avant/après

Comparaison stabilisée finale (`lod-before-repeat.json` / `lod-after-repeat.json`), médianes des compteurs :

| Pose | Draws avant → après | Meshes actifs avant → après | Indices soumis avant → après |
| --- | ---: | ---: | ---: |
| Proche | 158 → 158 | 242 → 242 | 993 255 → 993 255 |
| Gestion | 340 → 340 | 713 → 713 | 2 132 973 → 2 132 973 |
| Dézoom Village | **455 → 424** | **817 → 772** | **2 148 519 → 2 010 171** |

Au dézoom : **−31 draws (−6,8 % de la scène)** et **−138 348 indices (−6,4 %)**, exactement la différence de la recette du campus. Ses 39 sources instanciées sont remplacées par 8 ; les monuments restent dessinés dans les deux cas. Les 45 meshes actifs retirés incluent les nœuds sans géométrie de l'ancienne hiérarchie, ce ne sont pas 45 draws. Les dessins non indexés, notamment la pluie animée, représentent environ 700–1 200 sommets par frame selon la fenêtre et restent distincts des indices ci-dessus. Aucun gain de géométrie/draw recherché ou observé aux deux poses détaillées.

Cadence, première paire puis répétition, moyenne / P95 en millisecondes :

| Série et pose | Frames échantillonnées avant / après | Frame avant → après | GPU avant → après |
| --- | ---: | --- | --- |
| Initiale, proche | 68 / 81 | 88,9 / 117,5 → 74,1 / 104,7 | 43,8 / 69,3 → 36,6 / 66,6 |
| Initiale, gestion | 45 / 50 | 132,3 / 208,8 → 121,2 / 160,1 | 82,0 / 162,8 → 76,5 / 128,6 |
| Initiale, dézoom | 33 / 40 | 185,5 / 223,5 → 152,5 / 205,0 | 117,5 / 215,9 → 91,7 / 138,9 |
| Répétition, proche | 84 / 29 | 71,7 / 99,8 → 149,8 / 251,0 | 42,6 / 60,5 → 97,5 / 286,9 |
| Répétition, gestion | 55 / 43 | 109,5 / 145,8 → 141,5 / 199,4 | 74,1 / 105,6 → 87,5 / 123,7 |
| Répétition, dézoom | 44 / 103 | 140,7 / 214,1 → 58,7 / 81,0 | 88,9 / 141,0 → 34,4 / 47,5 |

Durée murale CPU du callback de frame, répétition, moyenne / P95 : proche 65,1 / 77,2 → 136,9 / 246,4 ms ; gestion 105,5 / 142,7 → 129,6 / 190,7 ms ; dézoom 129,3 / 182,9 → 56,5 / 78,6 ms. La portion `scene.render()` correspondante : 58,8 / 70,4 → 128,1 / 240,9 ; 99,2 / 136,8 → 118,8 / 162,8 ; 121,8 / 170,3 → 53,3 / 73,9 ms. Les mesures CPU/GPU se recouvrent : ne pas les additionner.

**Gain structurel reproduit ; aucun facteur de gain FPS garanti.** Les deux paires améliorent le dézoom, mais leur amplitude varie fortement et la seconde dégrade les poses détaillées à draws/indices identiques. La charge partagée est une cause plausible, pas une attribution exclusive démontrée. Même la meilleure fenêtre distante n'atteint pas 45 FPS ni le P95 ≤ 40 ms global. La première paire proche contenait encore une différence d'un lot terrain ; elle n'est pas utilisée pour attribuer un gain proche. La répétition stabilisée retrouve des compteurs proches/gestion strictement identiques.

### Ressources, chargement et cycle de vie

Au dézoom stabilisé, les géométries uniques passent de **1 087 à 1 095**, et leurs données de buffers retenues estimées de **34 018 252 à 38 515 652 octets**, soit **+4 497 400 octets** pour le campus niveau 3 distant. Déduplication des sources/instances et des données interleavées ; tableaux numériques estimés à 4 octets par élément. Ce n'est ni le heap JS total ni une mesure de VRAM du pilote. Matériaux : 113 → 120 ; textures de scène : 28 → 28. Les sommets *logiques* de `scene.getTotalVertices()` **augmentent** de 1 536 610 à 1 728 682, car source et instance de la variante inactive restent comptées. Ils ne décrivent pas la géométrie effectivement dessinée, qui baisse ci-dessus.

La variante ajoute 722 848 octets compressés au chargement d'un campus niveau 3 achevé. Les six assets représentent 2 862 882 octets compressés et 15 956 088 octets de buffers géométriques supplémentaires si tous sont rencontrés. Le détail est disponible avant le téléchargement/instanciation optionnel du distant ; absence/échec de celui-ci conserve le détail. Pas de géométrie créée, de téléchargement ni de matrice gelée au seuil. Le coût CPU exact du chargement froid/décompression et la VRAM totale n'ont pas été isolés ; le gain mesuré concerne le rendu stabilisé, pas le temps de connexion.

Recette navigateur terminée (`lod-browser.json`, `complete: true`) :

- Picking réel du mesh distant, métadonnée de site `1091:22`, même parent logique pendant les bascules. Panneau Université et contour conservés ; vrai zoom à la molette jusqu'au rayon 87,69, diamètre projeté 345,8 px, puis quatre allers-retours proche/distant.
- Zoom continu : exactement deux changements de représentation sur l'aller-retour observé, sans oscillation à pose fixe ; pas de fondu ni d'hystérésis nécessaire dans ces essais.
- Après zoom : mêmes 48 géométries du campus (39 détaillées + 8 distantes + monument), 64 enfants, 9 meshes géométriques activés au loin, 1 observateur LOD ; matériaux/textures globaux inchangés. Deux requêtes d'assets initiales, aucune nouvelle au zoom.
- Pan de 400 unités provoquant un recentrage, retour dans la zone, Région → Village, puis chantier vers niveau 3 tourné de 90°, niveau 1 achevé tourné de 180°, retour niveau 3. Modifications de snapshots interceptés uniquement, sans commande serveur. Suppression/réapparition puis trois cycles supplémentaires : mêmes compteurs de ressources, 1 observateur ; les recettes nouvellement rencontrées restent volontairement en cache. Six téléchargements au total pour les trois couples détaillé/distant utilisés, aucun aux recréations.
- Nuit 0:00 : soleil à 0, éclairage ambiant et braseros actifs ; vitrage distant alpha .22, non pickable ; zéro render target personnalisé. La scène Village n'installe pas de générateur de shadow map : ombres de contact existantes conservées, pas de nouvelle passe de capture. Images de jour, nuit, chantier et niveau 1 examinées ; silhouettes/ouvertures et éclairage conservés. Zéro erreur de page.

### Preuves et statut

**Implémenté et vérifié sur ce périmètre** : campus niveaux 1–3 / achevé-travaux, deux représentations coordonnées ; gain de draws et de géométrie établi au dézoom Village, détail proche conservé. Build world-web de production (typecheck inclus) et lint ciblé terminés avec succès ; avertissement Vite de gros chunks préexistant. Suite de scène terminée : **42 fichiers / 164 tests verts**. Pas de suite DB nécessaire pour cette tranche graphique.

Régressions : joints sans fermeture des ouvertures, bornes/gabarits et verre identiques aux six recettes, réduction de géométrie et lots, instances partagées, picking de la variante active, déplacement d'origine/rotation, projection/focale/résolution/orthographique, suppression/recréation, chargement différé après suppression, cache et libération de scène, échec de variante conservant le détail. Le picking personnalisé sélectionnant encore la variante désactivée a été reproduit rouge avant correction. La perte du contour à la molette a été reproduite dans le navigateur avant correction. Les premières passes du harness ont nécessité des corrections de collecte de buffers, de suivi du repère local et d'ouverture du panneau solaire ; elles ne sont pas présentées comme validations complètes.

Fichiers de la tranche : `building-lod.ts`, `building-lod-geometry.ts` et leurs tests ; `building-assets.ts` / tests / manifeste, `building-bake.ts`, `timber-thatch.ts`, `BabylonVillageScene.ts`, `scripts/bake-buildings.mjs`, six assets distants ; les trois scripts `tests/browser/village-lod*.mjs`. Spec, catalogue et handoff actualisés. Les modifications d'Exploitation, jardins, scieries, verre et l'export utilisateur déjà présents sont conservés.

Captures comparables (artefacts locaux ignorés) : [proche avant](../test-results/lod-before-repeat-close.png) / [après](../test-results/lod-after-repeat-close.png), [gestion avant](../test-results/lod-before-repeat-management.png) / [après](../test-results/lod-after-repeat-management.png), [dézoom avant](../test-results/lod-before-repeat-far.png) / [après](../test-results/lod-after-repeat-far.png), [sélection distante](../test-results/lod-selected-far.png), [nuit](../test-results/lod-night-far.png), [chantier tourné](../test-results/lod-state-2-under-construction.png).

Limites : première famille seulement ; aucun gain attendu aux poses où le détail reste actif. Pas de recette mobile ni d'évaluation sur un autre backend/GPU. La fusion par matériau élargit les volumes de culling de chaque lot : le gain mesuré avec le campus entièrement cadré ne garantit pas le même gain lorsqu'une petite partie seulement entre à l'écran. Extension aux maisons/hôtel et objectifs globaux restent ouverts. Branche `main`, modifications locales non commitées/non poussées, aucun changement métier ou de dépendance Babylon dans cette tranche.


## LOD de toutes les familles en Village

Extension réalisée le 7 octobre 2026, à la demande de Tristan. Référence : build de production de la tranche campus précédente, copié dans `test-results/lod-general-before-dist` **avant les modifications de cette extension** ; pas le commit public seul, ni le build antérieur au premier LOD. Les autres travaux locaux sont conservés.

### Périmètre et mécanisme livré

Trois niveaux coordonnés par bâtiment, décrits dans la [spec, section 7](SPEC-OPTIMISATION-RENDU-BATIMENTS.md#7-généralisation-à-trois-niveaux-en-village--7-octobre-2026). Défauts **45 / 28 pixels de rendu par mètre de recette** : détail, périphérie, lointain. Le diamètre projeté est normalisé par le diamètre local de la recette, conservant l'effet d'une instance agrandie. Focale, profondeur caméra, résolution, viewport, inclinaison et orthographique pris en compte. Sur le campus centré, avec la caméra de contrôle, les deux changements se situent approximativement aux rayons 35 et 54 ; ce ne sont pas des distances codées en dur.

Campus, maisons pierre/troncs/madriers et mairie 1 : 40 variantes optionnelles précompilées, sources/instances partagées par scène et recette. Les assets proches restent byte-for-byte inchangés. Scieries 1–3, tailleur, caserne DEV : templates statiques partagés. Mairie animée et implantations particulières : variantes conservées sous le parent pendant les zooms, préparées lors de sa création/reconstruction. Horloge et reflets inactifs ne s'actualisent pas ; braseros de mairie et feu du tailleur sont communs. Jardins, anciens modèles et chantiers déjà constitués de quelques primitives restent minimaux.

Le LOD natif mesh par mesh n'est pas retenu pour ces hiérarchies et regroupements différents : une bascule coordonnée garde les pièces cohérentes et le parent logique stable. Aucun fondu, génération ni chargement au franchissement. Pas d'hystérésis ajoutée : pas d'oscillation observée aux poses fixes ou sur les zooms contrôlés. Un zoom rapide peut sauter un palier entre deux frames.

Géométrie par recette achevée, hors monuments et effets communs ; les sommets sont ceux des géométries, pas des invocations GPU :

| Recette | Sommets proche / périphérie / lointain | Meshes géométriques proche / périphérie / lointain |
| --- | ---: | ---: |
| Campus 3 | 188 268 / 90 246 / 68 094 | 39 / 7 / 7 |
| Maison pierre 2 | 20 886 / 9 816 / 6 144 | 5 / 4 / 4 |
| Maison troncs 2 | 15 782 / 11 320 / 7 548 | 4 / 3 / 3 |
| Maison madriers 2 | 15 726 / 12 576 / 6 144 | 4 / 3 / 3 |
| Mairie 1 | 35 706 / 14 544 / 5 280 | 5 / 4 / 4 |

La disparition des clous réduit aussi un lot ; les autres réductions de sommets n'impliquent pas nécessairement autant de draws en moins. Plusieurs niveaux visibles d'une même recette peuvent demander plusieurs lots : les résultats de scène ci-dessous incluent ce coût.

### Protocole et résultats

Windows, Chrome **154.0.8037.93** headless avec rendu matériel, WebGL2 / ANGLE / **Intel Iris Plus D3D11**, CPU **i7-1065G7**. Babylon **8.56.2**, builds de production identiques dans leur mode. Viewport 1440 × 900, rendu 1200 × 750, plafond 45 FPS. Le bridage automatisation est neutralisé et ces paramètres sont assertés. Même snapshot local sauvegardé, incluant 45 bâtiments détaillés, mêmes coordonnées, soleil 9 h en Vue libre, chargement et ressources stabilisés ; aucune autre suite, compilation ou navigateur de test pendant les fenêtres de mesure. La charge des applications utilisateur reste hors contrôle.

`tests/browser/village-lod-profile.mjs` reproduit les poses, enregistre draws réels, indices multipliés par le nombre d'instances, sommets non indexés séparés, CPU mural et requêtes GPU `EXT_disjoint_timer_query_webgl2`. Les données, poses et résultats exacts sont dans `lod-general-before-final.json` et `lod-general-after-final.json`, sous `test-results`.

| Pose | Cible | Rayon / beta / alpha / fov | Draws avant → après | Indices soumis avant → après | Actifs Babylon avant → après |
| --- | --- | --- | ---: | ---: | ---: |
| Très proche | Campus | 25 / 1 / −0,67 / 0,505 | **114 → 114** | **611 304 → 611 304** | 128 → 128 |
| Proche élargie | Campus | 40 / 1 / −0,67 / 0,505 | **158 → 134** | **993 255 → 763 683** | 242 → 191 |
| Gestion | Mairie | 65 / 0,85 / −0,67 / 0,51 | **340 → 271 (−20,3 %)** | **2 132 973 → 771 546 (−63,8 %)** | 713 → 623 |
| Dézoom Village | Mairie | 105 / 0,8 / −0,67 / 0,523 | **424 → 386 (−9,0 %)** | **2 010 171 → 787 092 (−60,8 %)** | 772 → 726 |

Cibles locales enregistrées : campus [7,5 ; 0 ; 56,25], mairie [32,5 ; 0,02 ; 51,25]. Le script les retrouve via leurs racines, plutôt que d'imposer ces coordonnées dans un autre repère. Les quatre poses restent en Village. Au très proche, les 45 bâtiments sont détaillés ; à la pose proche élargie, 39 détaillés / 6 périphériques ; en gestion et dézoom, 45 lointains. Les sommets non indexés des effets restent séparés et variables.

Temps en ms, moyenne / P95, paire finale :

| Pose | Frame avant → après | Callback CPU mural avant → après | GPU avant → après |
| --- | --- | --- | --- |
| Très proche | 41,2 / 51,2 → 70,8 / 89,5 | 37,8 / 47,5 → 64,5 / 80,8 | 20,8 / 44,6 → 40,8 / 63,0 |
| Proche élargie | 52,3 / 74,0 → 41,5 / 52,5 | 48,8 / 65,6 → 39,7 / 49,9 | 31,5 / 58,8 → 16,6 / 21,3 |
| Gestion | 105,4 / 140,8 → 47,2 / 62,5 | 100,0 / 133,5 → 45,0 / 60,1 | 76,7 / 124,1 → 26,1 / 33,7 |
| Dézoom | 73,0 / 92,4 → 64,1 / 95,5 | 69,1 / 83,6 → 61,5 / 84,3 | 42,4 / 52,4 → 36,9 / 53,6 |

Portion `scene.render()`, moyenne/P95 avant → après : très proche 34,1/43,5 → 57,2/70,0 ; proche élargie 44,7/59,5 → 35,0/44,4 ; gestion 94,3/121,1 → 41,1/55,3 ; dézoom 64,6/79,6 → 56,9/78,5. Ces durées se recouvrent avec le GPU et ne s'additionnent pas. Échantillons de frames avant/après : 147/86, 115/145, 59/128, 83/94.

**Gain de géométrie et de draws établi ; pas de facteur FPS garanti.** La première série après donnait 68,8 ms en gestion et 111,7 ms au dézoom, contre 47,2 et 64,1 dans la répétition, avec exactement les mêmes draws/indices. La dégradation de la fenêtre très proche à géométrie dessinée identique est rapportée, pas masquée : charge externe et surcoût de préparation des variantes ne sont pas isolés. L'objectif global 45 FPS/P95 ≤ 40 ms reste non atteint. La première référence proche contenait un lot terrain de moins ; la table utilise la référence répétée à quatre poses, pas ce chiffre initial.

### Mémoire, chargement et cycle de vie

Au dézoom : buffers géométriques uniques **38 515 652 → 51 642 520 octets**, soit **+13 126 868 octets** ; géométries 1 095 → 1 259 ; matériaux 120 → 187 ; textures 28 → 30. Ce sont des buffers attributs/indices accessibles, pas une mesure exhaustive de VRAM, textures, JS ou pilote. Le compteur de sommets logiques monte de 1 728 682 à 2 715 313 parce que sources et instances de variantes restent résidentes ; il ne mesure pas la géométrie dessinée.

Les 40 variantes précompilées représentent **11 123 746 octets gzip** et **33 935 920 octets de buffers** si toutes les recettes/états sont chargés. Elles remplacent les six variantes campus précédentes (2 862 882 octets gzip). Seules les recettes demandées sont chargées. Les caches restent bornés par le catalogue ; les plans particuliers et la mairie animée sont détenus par leur parent, sans cache de toutes les implantations.

Navigation → modèles prêts : 22,0 s avant, 24,1 s après dans la paire finale (28,6 s dans la première série après). Cette fenêtre inclut API, imports et téléchargements ; elle n'isole pas le coût CPU des factories. Les variantes de mairie restent générées à sa création/reconstruction : limite explicite, sans coût de génération au zoom. Le proche précompilé devient utilisable avant le chargement des deux variantes optionnelles.

### Vérification et statut

**Implémenté et vérifié sur ce périmètre.** Build final world-web avec typecheck et lint ciblé terminés avec succès. Campagne de scène : 42 fichiers / 166 tests couverts ; première suite à 165/166 à cause d'une nouvelle fixture plaçant la mairie sur une case, corrigée à deux cases puis fichier à 3/3 ; contrôleur LOD relancé à 3/3 après ajout du cas d'instance agrandie. Les autres 41 fichiers étaient verts. Aucun test DB ni changement de gameplay.

NullEngine : trois niveaux exclusifs, taille/focale/orthographique/échelle, cache statique partagé et libération, picking/identité/rebase, chargement tardif/échec, gabarits et vitrage des recettes, travaux/achevé. Vérification des tailles et hashes des 60 assets du manifeste, toutes géométries décodées.

Chrome production, `tests/browser/village-lod.mjs` et sa passe `--families-only` : vrais modèles instanciés du village ; campus, pierre, troncs, madriers, mairie, scieries et tailleur, poses 25/48/105, sélection et picking réels, zooms répétés, déplacement/recentrage, Région → Village, campus en travaux/niveaux/orientations, suppressions/recréations. Deux cycles par famille sur le build final : matériaux, textures, observateurs, particules et lumières reviennent aux valeurs précédentes. Éclairage nocturne contrôlé ; vitres satinées alpha .22 non pickables ; aucune cible de rendu hors écran ajoutée, zéro erreur de page. Les variantes proches et distantes gardent leur silhouette et leurs ouvertures dans les captures examinées.

Chrome DEV, `tests/browser/village-lod-controls.mjs` : réglages à chaud, persistance après rechargement, remise aux défauts, caserne instanciée aux trois niveaux (83 505 / 52 365 / 37 437 sommets actifs), zéro erreur de page. Les premières tentatives incomplètes des harnesses ne sont pas comptées comme validations finales.

Captures comparables : [très proche avant](../test-results/lod-general-before-final-detail.png) / [après](../test-results/lod-general-after-final-detail.png), [proche élargie avant](../test-results/lod-general-before-final-close.png) / [après](../test-results/lod-general-after-final-close.png), [gestion avant](../test-results/lod-general-before-final-management.png) / [après](../test-results/lod-general-after-final-management.png), [dézoom avant](../test-results/lod-general-before-final-far.png) / [après](../test-results/lod-general-after-final-far.png), [réglages DEV](../test-results/lod-general-controls.png), [caserne périphérique](../test-results/lod-general-barracks-peripheral.png). Artefacts et snapshot locaux ignorés par Git ; scripts de reproduction conservés dans le dépôt.

Limites : autre matériel/backend non testé ; mémoire accrue ; initialisation procédurale de la mairie ; miniatures et atelier restent en détail. Pas de fondu ni d'effacement du bâtiment au loin. Branche `main`, modifications locales non commitées/non poussées ; travaux API/Exploitation antérieurs et export utilisateur préservés.
