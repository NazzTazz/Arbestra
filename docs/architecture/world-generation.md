# Génération d’un monde

État courant du 10 octobre : [installation RC1, vue village et dossier de contre-recette](../IMPLEMENTATION-INSTALLATION-RC1.md). Les mentions de pose non raccordée ci-dessous décrivent la tranche atlas antérieure. La candidate reste à valider avant ouverture publique.

Statut : **spécification autoritaire implémentée — génération v2**.

RC1 : [prédiagnostic interne de spawn](../IMPLEMENTATION-CARTE-SPAWN-RC1.md) en cours. Les accès au champ immuable, protections privées et calcul de dotation sont raccordés en lecture seule sur copie de test ; aucune projection économique naturelle ni installation persistante n’est acquise. La règle RC1 de pente piétonne (¼ de case verticale par case parcourue) reste séparée de `canTraverseLandscape()` historique. Le garde d’ouverture v3 reste conservé.

Le prédiagnostic RC1 lit un snapshot repeatable-read par monde puis libère la transaction avant le calcul dans un worker CPU de l'application Fastify. Ce worker est distinct du scheduler et du générateur : aucune connexion DB, au plus quatre demandes admises, calcul actif inclus. Son cache immuable exige l'égalité du texte JSONB effectivement lu et validé ; voisins et protections viennent de chaque nouveau snapshot. Voir les [corrections de réactivité](../CORRECTIONS-CARTE-SPAWN-RC1-2026-10-09.md).

L'[atlas d'accueil](../IMPLEMENTATION-ATLAS-RC1.md) sépare désormais les métadonnées de présentation (`spawn-atlas`) du champ géographique détaillé (`spawn-map`). Le fond SVG est préparé depuis les octets RC1 signés ; il n'autorise aucune pose. Le diagnostic ne construit plus de maillage Babylon. Migration additive 037 : textes par monde éditables par les opérateurs existants et contour de territoire par village. Le propriétaire trace un contour simple contenant son HDV, rayon maximal 30, sans chevauchement ; éditions sérialisées sous le verrou spatial du monde après verrou du village. Les contrôles de terrain/dotation relisent ces territoires. Cercle de diagnostic 8 et bande de terrassement ±2 niveaux ; pente piétonne inchangée. Le plan de nettoyage est calculé sans mutation ; son application transactionnelle au spawn reste à réaliser.

Le [World generator alpha](../SPEC-WORLD-GENERATOR-ALPHA.md) a ses **tranches A/B implémentées** : candidats fermés, exécuteur isolé, preview opérateur et relief/climat v3 exploratoires. Hydrologie et spawn aménageur restent C/D ; v3 ne peut pas être ouvert. Le gameplay des univers ouverts conserve le générateur v2 ci-dessous. Voir [la recette A/B](../RECETTE-WORLD-GENERATOR-AB-2026-10-07.md).

Complément : [recette géographique r6](../GEOGRAPHIE-MONDE-2026-10-08.md), réservée aux candidats fermés. Descripteur échantillonnable et réseau global persistés dans l’artefact ; la projection entière des chunks ne pilote pas leur géométrie. Tore et inspection locale partagent le modèle. Aucune intégration aux univers jouables.

Complément r7 : les nouveaux candidats ajoutent un descripteur forestier décoratif versionné, produit une fois par colonisation/compétition. Positions indépendantes des cellules ; r6 conserve son ancien placement. Habitat projeté et population graphique sont distincts, sans intégration aux ressources ou au pathfinding.

Complément r8 : `amplitude` représente désormais les bornes symétriques ±A (défaut ±16), distinguées par la révision de recette. Le descripteur géographique porte les paramètres de cette normalisation ; des `stoneSites` décoratifs sont persistés dans le même artefact, sans stock ni occupation économique. Les anciens artefacts et la génération v2 restent inchangés.

Complément r10 : `world-circulation.ts` consomme les fonctions du contrat cosmologique et persiste une copie de ses paramètres dans le descripteur géographique. Un proxy de pluie intégré sur 24 phases pondère l'accumulation du drainage global ; le relief ne varie pas avec l'heure d'inspection. `solarTransport` pilote les nuages du preview et `solarCurrent` fournit le champ tangent diagnostique. Dans un lit fluvial, la direction aval prime et le soleil module une vitesse toujours positive. Modèle stylisé, sans simulation gravitationnelle ni conservation des débits. `lakeSurface` et les profils transversaux continus remplacent les seuils visuels r9 pour les nouveaux candidats uniquement. Les contrats métier des univers ouverts ne changent pas. Voir le [bilan r10](../GEOGRAPHIE-MONDE-2026-10-08.md#circulation-solaire-et-berges-r10).

Complément r11 : `world-oceans.ts` fournit l'ossature périodique des deux bassins et `geography.oceans` ses paramètres/plateaux. `geography.connections` contient une inspection échantillonnée mer/terre et un masque d'affichage ; **ce n'est pas le graphe de déplacement autoritaire**. Le masque n'influence pas la forme du relief. Les candidats v3 restent fermés et les anciennes recettes utilisent leurs branches historiques. Voir le [contrat r11](../GEOGRAPHIE-MONDE-2026-10-08.md#deux-océans-et-continuité-terrestre-r11).

## But

La création d’un monde exécute une génération déterministe une seule fois. Son résultat persiste dans PostgreSQL et reste identique après déploiement, redémarrage ou évolution d’un futur générateur.

Configuration initiale : tore rectangulaire `2048 × 1024`, chunks `32 × 32`, objectif de 500 grands villages.

## Cycle de vie

`worlds` reçoit `generation_version`, `generation_status` (`pending`, `generating`, `ready`, `failed`) et `generated_at`.

- Aucun spawn n’est possible avant `ready`.
- `generateWorld(worldId)` prend un verrou advisory par monde.
- Un monde `ready` n’est jamais régénéré implicitement.
- Terrain, clairières, features et occupations sont écrits dans une transaction unique, puis le monde passe à `ready`.
- Un crash annule tout. Une relance avec la même seed et la même version produit le même monde.
- `scheduled_tasks` n’est pas détourné en queue de génération.

Le générateur utilise un PRNG non cryptographique stable et explicite. `Math.random()` est interdit.

## Terrain par chunks

`world_chunks` contient : `world_id`, `chunk_x`, `chunk_y`, `generation_version`, `terrain_codes`, `elevations`, timestamps. La clé est `(world_id, chunk_x, chunk_y)`.

- Chaque tableau contient 1 024 entiers en ordre `local_y * 32 + local_x`.
- Les valeurs d’élévation sont quantifiées et raccordées entre chunks.
- Le générateur est périodique sur les deux axes : aucune couture aux bords du rectangle.
- Une future modification locale du terrain utilisera des overrides clairsemés ; elle ne régénérera pas le chunk.

Types initiaux :

- `grassland` : constructible ;
- `water` : non constructible ;
- `rocky_ground` : non constructible avant futur terrassement.

`rocky_ground` est un terrain. `stone_outcrop` est une feature exploitable : les deux notions ne doivent pas être confondues.

## Clairières de spawn

`world_clearings` contient : monde, centre canonique, rayon intérieur, rayon de transition, statut et éventuel village attributaire.

Version actuelle :

- 600 clairières pour un objectif de 500 villages ;
- rayon intérieur aplani : 12 cellules ;
- noyau de spawn `5 × 5` garanti libre de toute feature ;
- distance torique minimale entre centres : 40 cellules ;
- rayon de transition configurable par le générateur v1.

La clairière est aplatie et convertie en prairie. La génération v2 conserve son noyau central `5 × 5` vide et place quatre gisements déterministes et espacés entre les distances 3 et 8 : trois `woodland` et un `stone_outcrop`. La transition réduit progressivement la densité des features naturelles extérieures.

Une clairière non attribuée est protégée contre toute construction ordinaire. L’[onboarding joueur](../SPEC-ONBOARDING-JOUEUR.md) lui attribue maintenant le premier village d’un compte dans un monde ouvert, après vérification du modèle figé et sans retirer de feature. La colonisation de villages supplémentaires reste hors scope ; aucun système générique de permissions n’est introduit.

## Features générées

Types initiaux :

- `woodland` : une cellule métier affichant une petite recette de 2 à 4 arbres ;
- `stone_outcrop` : une cellule ou petite emprise rocheuse.

Les features sont persistées dans `world_features` et réclament leurs cellules dans `world_cell_occupancies`. Elles ne sont jamais placées dans le noyau central `5 × 5`. Les quelques gisements de clairière invitent à la future exploitation sans compromettre le spawn.

L’extraction et les rendements sont reportés. Cette tranche garantit seulement existence, emprise, collision et rendu.

## Décor non exploitable

Fleurs, herbes, petits cailloux et variations mineures sont générés côté client par une fonction déterministe de `(world seed, generation version, coordonnées)`.

- Ils ne bloquent jamais une cellule.
- Ils disparaissent sur terrain incompatible ou cellule occupée.
- Tout arbre visible comme arbre et tout rocher visiblement bloquant doivent provenir d’une feature serveur.

## Pipeline v2

1. Produire des champs périodiques d’élévation et d’humidité.
2. Classifier prairie, eau et terrain rocheux.
3. Sélectionner 600 centres suffisamment espacés ; échouer explicitement si la garantie est impossible.
4. Aménager les clairières et leurs transitions.
5. Placer déterministiquement les gisements naturels puis quatre gisements légers hors du noyau `5 × 5` de chaque clairière.
6. Persister chunks, clairières, features et occupations.
7. Marquer le monde `ready`.

Les seuils visuels et densités appartiennent au fichier de configuration du générateur, pas au schéma SQL.

## Contrat de lecture initial

Le snapshot du village conserve une région fixe de `64 × 64` cellules autour de son ancre : origine canonique, terrains, élévations et features. Le [streamer terrain](../SPEC-STREAMING-TERRAIN.md) ajoute une lecture indépendante des chunks persistés, avec halo diagonal d'une cellule, contrôle de session/village et cohérence SQL repeatable-read read-only. Le premier chargement lit `/terrain` ; la revalidation d'un chunk conservé utilise `/terrain/updates`, qui ne lit pas `world_chunks` et ne transfère ni terrains ni élévations. Il ne génère rien et ne réconcilie pas l'économie ; les listes complètes de features/occupations ne couvrent que les intérieurs demandés. La position des gisements épuisés vient de `stone_deposits` même après libération de leur occupation.

Babylon :

- construit le sol depuis les données reçues ;
- instancie les recettes `woodland` et `stone_outcrop` ;
- conserve React hors du rendu 3D ;
- ne recalcule aucune collision ou constructibilité.

## Monde de développement existant

La migration crée uniquement le schéma. Une commande explicite génère `aube`. Les villages déjà présents deviennent des clairières revendiquées obligatoires : leur voisinage est aplani et aucune feature ne peut recouvrir une occupation existante.

`db:seed` peut garantir la génération d’un monde absent ou `pending`, mais ne modifie jamais un monde `ready`. La migration v2 enrichit explicitement les mondes v1 avec les seuls gisements de clairière ; terrain, bâtiments et features existantes sont conservés.

## Validation ciblée

- même seed/version : résultat identique ; seed différente : résultat différent ;
- raccord parfait sur les quatre bords du tore ;
- tableaux de chunks complets et coordonnées canoniques ;
- 600 clairières espacées et protégées ;
- noyau `5 × 5` libre et quatre gisements hors noyau par clairière ;
- aucune feature sur une occupation existante ;
- transaction atomique et retry après échec ;
- lecture/rendu de la région autour du village existant.

## Hors scope

La génération seule ne crée pas de joueur : le premier spawn relève de l’[onboarding](../SPEC-ONBOARDING-JOUEUR.md). Colonisation supplémentaire, terrassement, biomes avancés, déplacements, brouillard de guerre et planète-donut restent hors scope. Streaming et exploitation sont traités dans leurs tranches distinctes.

## Stock des bosquets (017)

Chaque feature `woodland` générée reçoit un `woodland_deposits` dans la même transaction : 300 bois et une période de repousse de base de 14 jours, avec curseur serveur. La migration 017 initialise conservativement les bosquets existants depuis leurs occupations sans régénérer le monde ni toucher aux bâtiments/stocks villages. Un monde `ready` n'est jamais réapprovisionné par la génération. Les coordonnées du bosquet restent dans cette table quand son occupation disparaît ; les lectures terrain et aperçus de végétation suivent son stock, indépendamment des occupations.

## World generator A/B (7 octobre 2026)

La migration 035 ajoute `worlds.is_open` et le suivi `world_generation_candidates`. Le lobby/onboarding exige ready **et** ouvert ; les anciens mondes ready sont conservés ouverts par la migration. Les nouveaux candidats ne rejoignent pas le lobby avant ouverture explicite.

Le module API `world-generator` persiste paramètres, état/tentative/heartbeat/révision, métriques et artefact JSONB. L’exécuteur détient un verrou PostgreSQL global et lance le calcul dans un child séparé de l’API HTTP. La sortie est publiée dans une transaction qui vérifie la tentative courante. Reprise explicite après interruption ; aucun recalcul d’un candidat prêt. Le résultat du preview est signé par SHA256 d’un JSON canonique, indépendant de l’ordre des clés JSONB.

La recette v3 r2 exploratoire réside dans contracts : régions de Voronoï périodiques irrégulières (espacement nominal18 cases), contours à la case, altitudes −8/+8, marches2×4 (maximum produit2×5), unité verticale¼ case. Un réseau d'accès relie les régions sèches ; les paliers d'escaliers sont protégés et la couverture boisée préserve les connexions. L'isolement est calculé par terre ; les détours/bottlenecks affichés sont échantillonnés, sans garantie de détour maximal global. Les chunks terrain et l'artefact sont persistés ; la végétation n'est pas encore matérialisée en features économiques. Le graphe v3 n'a pas encore remplacé les trajets v2.

La migration036 ajoute la révision de recette : révision distincte (r2 au départ de B, r3 depuis C), anciens candidats historiques r0 sans modification d'artefact. Les nouveaux artefacts v2 portent une signature complète (features, occupations, stocks, curseurs et modèle de départ), contrôlée à la copie sous snapshot et avant ouverture. Le chemin historique conserve ses garanties plus limitées. L'aperçu utilise les cases canoniques, conserve le cadrage et partage la palette d'altitude avec sa légende. [Recette et limites](../RECETTE-WORLD-GENERATOR-CORRECTIONS-2026-10-08.md).

Un candidat v2 retenu peut être ouvert ; un candidat v3 reste interdit d’ouverture avant D/E. Le spawn local, les mises à jour du streamer et des caches de trajet restent à réaliser. Les contrôles de recette et mesures sont dans [le bilan A/B](../RECETTE-WORLD-GENERATOR-AB-2026-10-07.md). Configuration et commandes de lancement : [README](../../README.md#world-generator-alpha--tranches-ab).

## Hydrologie C — recette v3 r3 (8 octobre 2026)

La recette r3 ajoute au relief r2 une couche hydrologique persistée dans l'artefact JSONB signé : tronçons, bassins, fond/surface, connexions, sorties secondaires descendantes, fronts de cascade, enveloppe des plus hautes eaux et métriques. Le dispatch garde r0/r2 ; aucun recalcul d'un artefact prêt. Pas de nouvelle migration en C.

Les chenaux ont une largeur réellement creusée ; les rivières suivent un drainage périodique sans boucle, avec sélection de berges qui contiennent l'eau. Les paliers sont protégés, la continuité terrestre est vérifiée après creusement, puis la forêt est recalibrée. Les objectifs irréalisables restent signalés.

Le plus grand bassin est la mer de référence ; les eaux de niveau0 qui lui sont connectées suivent la même marée bornée ±0,25. Les eaux perchées restent fixes, les pieds côtiers suivent leur aval. Une marge sèche de0,25 est conservée ; aucun recalcul de trajet selon la phase. Les courants marins et d'estuaire partagent les conventions solaires avec le rendu. Il ne s'agit pas d'une simulation de fluides.

Le preview utilise des lots partagés et une déformation GPU du niveau d'eau ; les nappes fines et l'écume sont limitées à la vue locale proche. Les données hydrologiques ne sont pas encore branchées sur un univers v3 ouvert : D porte le spawn/streamer et E sa recette d'ouverture. [Bilan C](../RECETTE-WORLD-GENERATOR-HYDROLOGIE-2026-10-08.md).

### Correction des largeurs — r4

La correction r4 utilise ces corridors ; r3 reste explicitement reproductible. `world-hydrology-rivers.ts` cherche des corridors complets de 5 à 8 cases, vérifie leurs berges et la continuité terrestre avant de creuser. Chaque section partage une surface, sa largeur et son aval. Les fronts persistés regroupent les paires de cases amont/aval dans `Waterfall.lanes` ; le rendu dessine ces seules faces et conserve le format historique sans `lanes`. Les lots GPU et la marée partagée sont conservés.

Limite exploratoire : ces corridors sont rectilignes, longs de 8 à 64 cases ; ils ne constituent pas encore un réseau de rivières sinueuses. Aucun tracé étroit de remplacement n’est créé lorsqu’un corridor large ne tient pas. Les artefacts prêts et les règles d’ouverture restent inchangés.

### Courbes de rivière — r5

`world-hydrology-meanders.ts` remplace le routage rectiligne pour les nouvelles recettes. Une recherche bornée conserve jusqu’à six trajectoires par section ; un guide à variation lente, la continuité de direction, les berges et le coût de creusement départagent les passages. Une simple diagonale ne suffit pas : le tracé doit présenter une déviation réelle. Les sections se recouvrent sur au moins cinq cases et limitent le rétrécissement transversal dans les virages. La largeur évolue progressivement, et une tête arrondie termine la source.

Les cascades gardent un front entièrement alimenté : la section est stabilisée au passage d’un changement de niveau. `WaterReach.flowTo` est optionnel et décrit l’aval de chaque case d’une section, y compris les épaules des virages. Les représentations anciennes utilisent leur drainage historique. L’inspection « Voir une rivière » cadre le milieu du cours d’eau.

Cette passe reste bornée : progression selon une direction principale, jusqu’à96 sections (moins sur les petites dimensions), sans nouvelle gestion générale des confluences ni érosion simulée. Les obstacles peuvent réduire le nombre de rivières admissibles. R0/r2/r3/r4 restent reproductibles ; aucune migration ni modification d’artefact prêt.

Complément r9 : substrat et couverture de sol échantillonnables, exposition liée aux pentes/crêtes/ruptures, affleurements sculptés dans le terrain unique. Blocs et éboulis persistés avec provenance en amont, sans stock économique. `sampleWorldGeology` porte la stratigraphie immuable ; les futures excavations devront la découper, sans la recalculer depuis la surface excavée. Voir [modèle, preuves et limites r9](../GEOGRAPHIE-MONDE-2026-10-08.md). Les anciens artefacts r8 ne changent pas ; nouveau candidat requis.
