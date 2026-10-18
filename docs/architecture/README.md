# Architecture autoritaire

**Implémentation validée en développement :** [pathfinding hiérarchique et cache durable HDV–HDV](../SPEC-PATHFINDING-HIERARCHIQUE.md). Le marché combine un index compact d'arêtes physiques, un essai de graphe de portails borné et le repli `coarseFirst`. La migration 046 persiste routes, traversées, index et versions locales ; les chemins sont recertifiés ou réparés autour des obstacles, puis revalidés avant acceptation. `NAVIGATION_HIERARCHICAL=0` restitue l'ancienne stratégie. Recettes ordinateur/mobile vertes ; aucun déploiement distant de cette tranche. Mesures et limites courantes dans le handoff.

Tranche NOC **déployée en staging et alpha, release `74d33e2`** : [observation d’un village et assistance en direct](../SPEC-NOC-OBSERVATION-VILLAGE.md). Le NOC ouvre la scène du client monde par un jeton à usage unique, échangé contre un accès de lecture isolé. Rendu partagé avec le joueur, suivi de caméra et diagnostic des commandes, sans réconciliation économique. Le [dossier d’implémentation](../IMPLEMENTATION-NOC-OBSERVATION-VILLAGE-2026-10-17.md) porte les preuves et limites, dont le budget de charge non certifié. Le [handoff](../../SESSION-HANDOFF.md) consigne les workflows réussis, les contrôles publics et les vérifications de lecture.

Les [déploiements natifs OVH](../DEPLOIEMENT-VPS.md) séparent staging et alpha : workflows GitHub par tags, PostgreSQL natif, services systemd et passerelle Caddy existante. Les deux environnements sont actifs en HTTPS ; le handoff donne les preuves de déploiement, de restauration et les préparatifs du premier monde.

La [croissance de population](../SPEC-CROISSANCE-POPULATION.md) vise 50 % des couchages à un habitant par minute, avec rattrapage progressif des anciens villages, sous le verrou économique et via le scheduler existant. Le handoff porte les preuves de validation et d'activation de la migration 043.

Les [corrections de streaming au mouvement du 15 octobre](../SPEC-STREAMING-TERRAIN.md) conservent le support de voirie hors masque caméra, limitent les remplacements de pavés/trottoirs à des secteurs locaux et réutilisent leur topologie. Les dépendances locales du sol évitent les sondes distantes à chaque publication de terrain. L'overlay DEV ventile aussi les phases de chaque image, avec moyenne et maximum récents. Les tests de réutilisation et de géométrie passent ; la fluidité générale reste à mesurer séparément, avec preuves et limites courantes dans le [handoff](../../SESSION-HANDOFF.md).

Le client monde propose [DEV → Statistiques en overlay](operations.md#statistiques-de-développement-village-et-terrain) : ventilation facultative des lectures village/terrain et coûts client/rendu, réservée au développement. Les mesures restent locales et les inconnues explicites ; aucun polling ni changement économique ajouté.

La [console NOC](operations.md) ajoute une application `admin-web` et des endpoints de consultation protégés par identifiants de comptes. La [spec V1](../SPEC-NOC-V1.md) distingue données métier persistées, instrumentation du processus répondant et commandes futures. Les lectures n'exécutent aucune réconciliation économique ; métriques inconnues et portée des observations restent explicites.

Tranche NOC **implémentée et vérifiée fonctionnellement en local, performance à confirmer** : [diagnostic HTTP et corrélation locale V1.1](../SPEC-NOC-V1-1-DIAGNOSTIC-HTTP.md). Identifier les requêtes lentes/5xx et interrompues, expliquer le statut et retrouver une référence dans des journaux expurgés, sans attribution automatique de cause ni mutation du jeu. Le [handoff](../../SESSION-HANDOFF.md) porte les preuves courantes.

Expéditions RC1 asynchrones implémentées le 12 octobre : [spec](../SPEC-EXPEDITIONS-RC1-ASYNCHRONES.md) et [preuves/tests/performance](../IMPLEMENTATION-EXPEDITIONS-RC1-ASYNCHRONES.md). Noyau A→B indépendant, calcul CPU hors transaction, admission FIFO sans réservation et reçus SSE durables. Migration042 validée en test uniquement ; recette visuelle et limites de mesure précisées dans le bilan.

État courant du 10 octobre : [installation RC1, vue village et dossier de contre-recette](../IMPLEMENTATION-INSTALLATION-RC1.md). Les mentions de pose non raccordée ci-dessous décrivent la tranche atlas antérieure. La candidate reste à valider avant ouverture publique.

La [carte de spawn RC1](../SPEC-CARTE-SPAWN-RC1.md) utilise maintenant un [atlas léger, cercle de 8 cases et territoires](../IMPLEMENTATION-ATLAS-RC1.md), au-dessus du [prédiagnostic interne](../IMPLEMENTATION-CARTE-SPAWN-RC1.md) sur copie de test. Il n’autorise aucune installation ; certification du sol/accès, projection économique naturelle, préparation et pose transactionnelle restent à réaliser. Les informations opérationnelles des voisins restent côté serveur. Le garde d’ouverture v3 est conservé.

La [première tranche d'optimisation du rendu](../SPEC-OPTIMISATION-RENDU-BATIMENTS.md) retire la capture du dépoli, réduit la géométrie droite du kit et instancie les recettes répétées. Le village s'ouvre directement, sans survol automatique. Le [rapport mesuré](../AUDIT-RENDU-3D-2026-10-06.md) distingue ces corrections des objectifs de fluidité/budgets encore non atteints.

Le [marché entre joueurs et parcours tactile](../SPEC-MARCHE-JOUEURS.md) est implémenté dans le worktree et validé localement. La migration 044 ajoute annonces réservées, acceptation entière, convois d’habitants et livraisons locales. La priorité joueur dure dix minutes avant une reprise Oracle éligible et instantanée ; ses étals permanents sont aussi disponibles. L’ancien marché 034 et ses livraisons engagées sont conservés. Hôtel de ville niveau 2 et Anneaux initiaux restent inchangés ; monnaie et armée restent futurs. Preuves et statut de recette dans le handoff courant.

Arbestra est un monolithe modulaire TypeScript :

- `play-web` gère compte, lobby et sélection du monde ;
- `world-web` sépare React (état/UI) de Babylon.js (rendu/interactions spatiales) ;
- `api` porte les règles métier, les sessions opaques et le worker ;
- PostgreSQL 17 est la source de vérité, avec `world_id` dans chaque agrégat de monde ;
- `contracts` contient les contrats JSON et la géométrie cosmologique déterministe partagée entre serveur et rendu.

HTTP JSON porte les commandes. La [synchronisation du village](./village-synchronization.md) utilise une copie locale et des trames autoritaires SSE, avec détection durable des modifications et reprise par snapshot cohérent. WebSocket, Redis et queues externes restent absents.

## Direction produit, distincte de l'architecture livrée

Le [World generator / World preview alpha](../SPEC-WORLD-GENERATOR-ALPHA.md) a ses **tranches A/B implémentées et recettées techniquement** : candidats fermés, preview opérateur de production, relief signé, escaliers naturels et climat/végétation. Voir [les preuves et limites](../RECETTE-WORLD-GENERATOR-AB-2026-10-07.md). Hydrologie/cascades et spawn aménageur restent C/D ; les candidats v3 restent fermés. L’onboarding des univers ouverts conserve v2.

La [spec Économie : matières brutes et transformation](../SPEC-ECONOMIE-MATIERES-TRANSFORMATION.md) est **implémentée et validée dans le worktree** au 6 octobre 2026. Elle introduit 25 brutes → 20 raffinées par lot avec habitants, arrêt des revenus passifs, plusieurs scieries et tailleur économique, sans perte de l’existant. Maison en pierre neuve : 25 bois d’œuvre + 10 pierres taillées. Migrations 031/032 appliquées sur test puis au développement autorisé ; [Économie](economy.md) décrit les règles livrées et le handoff leurs preuves et limites.

La [tranche Infrastructure : voirie, équipements et atelier](../SPEC-INFRASTRUCTURE-VOIRIE-ATELIER.md) est **implémentée dans le worktree, recette en cours**. Elle ajoute tracés au huitième de case, réserve de matière prépayée, commandes/annulations atomiques, accès partagés, trajets versionnés et atelier borné. Les ateliers sont activés par DEV, sans rôle administrateur. Les résultats actuels et limites sont dans le handoff. Artisanat, commerce, usure, ères et éditeur de méta-blocs restent hors livraison.

La [reprise du HUD principal](../SPEC-GUI-HUD-MODES.md) a reçu les corrections de contre-recette le 4 octobre 2026 ; la finition reste à valider avec Tristan. La barre prépare, le monde exécute sans formulaire ordinaire après geste. Construction utilise désormais les générateurs réels pour miniatures et ghost ; le cache des miniatures est persistant, versionné et borné (24 images / 2 Mio), consulté avant le chargement du renderer Babylon. L'amélioration exige le devis affiché. Exploitation fige l'aperçu présenté, conserve les cibles déjà admises et reconstruit les paramètres corrigés après refus certain. L'annulation React/native partage le propriétaire du pointeur, et le laboratoire cosmologique est contenu dans DEV. Aménagement/Armée restent « À venir » ; l'éclairage reste joueur en Exploration. Les preuves et limites sont en tête du [handoff](../../SESSION-HANDOFF.md).

Le HUD affiche désormais quatre modes en colonne : Vue libre, Constructions (Bâtiments / Infrastructure), Population et Exploitation. En Vue libre, le clic sur l’hôtel de ville ouvre sa fiche et le marché, sur la scierie ou le tailleur de pierre ouvre la fabrication, et sur l’université ouvre l’arbre des connaissances, sans changement de mode. DEV termine la barre des ressources. Aménagement est donc regroupé sous Infrastructure ; Armée reste hors palette. Le worktree conserve la mémoire du mode Village, les fiches proches des objets, l'aperçu d'éclairage et l'ordre d'exploitation mixte transactionnel à budget commun. Pour les jardins seuls, le plafond Auto connu de 1 habitant permet désormais une commande directe au relâchement, avec validation serveur complète ; les gestes rapprochés sont conservés séparément. Le réseau de trajets utilise une clé de cache géométrique canonique, indépendante de l'ordre des lectures et de l'économie. La reprise a retiré le récapitulatif obligatoire et ajouté la migration 027 pour les reçus idempotents de construction. La migration 026 et l'admission existante sont décrites dans [économie](economy.md) ; leurs preuves historiques ne valident pas les garanties du HUD identifiées par la contre-recette. Les tournées Jardin engagées restent terminées malgré l'échéance.

Le [socle Université et sciences](science.md) est implémenté dans le worktree : capacités locales, connaissances partagées par joueur/monde, programmes, qualifications, relevés, rapports datés et Astronomie 1 spontanée. La [spec](../SPEC-UNIVERSITE-SCIENCES-DECOUVERTE.md) conserve les arbitrages et le barème de recette. Le premier campus graphique, accepté dans l'atelier, est intégré sur une emprise réelle 5 × 6 pour recette humaine ; Médecine, Météorologie, Ballistique et Topologie restent des extensions.

La [factory modulaire des bâtiments](../SPEC-FACTORY-BATIMENTS.md) est implémentée pour le kit de l'hôtel de ville et des maisons : emprise réelle, implantation durable, dimensions en modules, entrée latérale, niveaux habitables/fenêtres et murets. Elle fournit un état intermédiaire de travaux entre recettes de niveaux métier, piloté par l'état serveur, et un atelier visuel isolé. L'hôtel pilote occupe deux cellules ; les bâtiments historiques sans layout conservent leur représentation. La caserne est disponible au catalogue non constructible et dans l'atelier ; l'Université utilise désormais une composition commune atelier/jeu de trois départements sur une emprise 5 × 6, avec le terrain existant pour herbe ; balcons et futurs départements restent à concevoir. Voir le handoff pour les vérifications courantes.

La [tranche première récolte et coupe de bois](../SPEC-SOL-2026-10-02-CLOTURE-RECOLTE-BOIS.md) est implémentée dans le worktree : journal transactionnel, bosquets renouvelables, missions réutilisant cohortes/worker, libération à 90 % d'épuisement et défrichage conservant les lots engagés. La migration 017 est appliquée localement ; [économie](economy.md) décrit les verrous/projections et le [handoff](../../SESSION-HANDOFF.md) les tests ciblés actuels et la recette visuelle restante.

Les [chantiers persistants pierre/bois](../SPEC-CHANTIERS-EXPLOITATION-GISEMENTS.md) sont implémentés dans le worktree avec les migrations 018–020 et restent en validation. L'aperçu de sélection, les lots successifs, les relèves et les réveils serveur prolongent les missions existantes ; voir [économie](economy.md) pour l'autorité et le [handoff](../../SESSION-HANDOFF.md) pour les preuves et limites.

La [spec des déplacements et animations de chantier](../SPEC-DEPLACEMENTS-ET-ANIMATION-CHANTIERS.md) cadre les files/binômes, collisions et priorités locales, apparences variées et postes bois/pierre. La réalisation est branchée dans `worker-motion.ts`, `worksite-layout.ts` et `village-workers.ts`, intégrés à BabylonVillageScene : une seule couche possède les positions, l'économie reste serveur, tous les participants sont conservés. Les tests ciblés couvrent circulation et lifecycle ; dispositions, gestes et seuils visuels restent à recetter.

La tranche [Jardins par parcelle, fusion et agrandissement tolérant](../SPEC-JARDINS-PARCELLES-FUSION.md) est implémentée dans le worktree. Les défauts de migration, de balayage et de collision de la [recette du 7 septembre](../REVIEW-2026-09-07-JARDINS.md) sont corrigés ; la [reprise courante](../../SESSION-HANDOFF.md) porte les preuves du 30 septembre et l'état Git. PostgreSQL porte le stock et le curseur de chaque parcelle ; le snapshot expose les composantes cardinales fusionnées, avec toutes leurs extensions en cours.

La [direction produit consolidée](../DIRECTION-PRODUIT.md) fixe le parcours initial et les intentions population/Oracle/karma, avec leurs points ouverts. Le [lore TRY](../../docs-lore/TRY-SAMSARA.md) pose l'expérience sans inscription et l'isolation du monde persistant. Ces documents ne prescrivent pas une implémentation générale ; une spec bornée reste nécessaire pour chaque tranche.

Le [streaming du terrain autour de la caméra](../SPEC-STREAMING-TERRAIN.md) est implémenté dans le worktree, avec validations ciblées et mesures locales d'apparition des arbres, mémoire et fluidité terminées. La lecture de chunks est indépendante de l'économie ; les refreshs ne retransfèrent pas le sol conservé en cache. Le cache reste borné, Babylon intègre les tuiles par proximité et réutilise les unités construites après rotation/zoom. Les preuves et limites de recette humaine sont dans le [handoff](../../SESSION-HANDOFF.md).

La [spec Village, Région et Monde torique](../SPEC-VUES-TERRAIN-REGION-MONDE-TORIQUE.md) est en cours d'implémentation dans le worktree : trois échelles, aperçu agrégé du terrain persisté, région étendue, brouillard Babylon natif, bosquets en thin instances et donut navigable. Les validations et limites actuelles sont consignées dans le [handoff](../../SESSION-HANDOFF.md) ; les budgets de la spec restent des critères à démontrer avant clôture.

La [cosmologie du tore, du soleil et du Chat](../SPEC-COSMOLOGIE-TORE-SOLEIL-CHAT.md) dispose d'un prototype dans le worktree : rotation et picking Babylon, source ponctuelle, occultation analytique, debug et révélation du Chat. Le huit est dans un plan vertical contenant l'axe, chaque boucle encercle une section du tore, le croisement passe dans le trou et la vitesse linéaire est constante. Les périodes sont distinctes : tore 8 h, soleil 12 h, cycle combiné 24 h. Une borne géométrique et les tests garantissent au moins un passage éclairé pour tout point du grand équateur sur ce cycle ; les comptes lumineux et limites de validation sont dans le handoff. Aucune conséquence économique n'est autorisée.

**Décision visuelle implémentée pour recette humaine** : la [spec des vues](../SPEC-VUES-TERRAIN-REGION-MONDE-TORIQUE.md#décision-visuelle-courante--nuages-et-ciel-1er-octobre-2026) remplace la révélation du décor par un fond noir étoilé, fixe dans le repère solaire, une traversée nuageuse plus épaisse et un voile lié au tore. Meuble, corps du Chat, sol de pièce et cadrage Chat sont retirés du prototype ; seul un regard discret, révélé par un reflet solaire et à chercher dans le noir, est conservé comme exception visuelle. Le lore reste conservé. L'audit a reproduit le blocage des contrôles par échec du shader du masque sur localhost:5174 ; le correctif importe explicitement les shaders Layer/shadowMap, attend leur préparation avant de verrouiller les contrôles et borne l'attente opaque. La caméra garde son ancre et transfère une emprise locale, avec dégagement du tube opposé au besoin.

La découverte du regard doit accomplir la quête cachée **« Les yeux dans les yeux »** : entrée persistante dans le Grimoire, puis question de l'Oracle cherchant son chat, sans réponse proposée au joueur. Ce prolongement narratif est spécifié dans la spec des vues, implémenté via la commande authentifiée discover-cat-eyes et le journal existant, avec unicité monde/village/code et date serveur. Aucun crédit ni migration nouvelle ; déclenchement visuel à recetter.

La cinématique d’arrivée Région → Village est implémentée pour recette : fondu au noir, titre village/heure, atterrissage continu (rayon/inclinaison/focale), révélation avec flou fin et luminosité courante retrouvée sur 3 s, puis disparition du titre. Le profil de caméra habituel est suspendu pendant cette interpolation ; brume nocturne de présentation seulement. L’assombrissement solaire temporaire reste un effet local de présentation ; l’heure affichée est le temps réel écoulé dans une trajectoire solaire de 12 h en production, avec libellés régionaux (1er/2nd matin, crépuscules), Midi à 6 h et Nuit sans heure. Le ratio existant implique une rotation du tore de 8 h et une répétition combinée de 24 h ; ces périodes sont actives dans le code, avec accélération temporaire possible en debug.

La météo environnementale partage un champ canonique déterministe entre les trois LOD (monde/temps serveur) : nuages, humidité visuelle, pluie et vent. Babylon porte les plugins de matériau et un émetteur local borné à 480 gouttes. Aucun effet agricole/économique ; recette humaine en cours. Vue torique : ambiante supprimée, terrain nocturne noir, soleil HDR avec halo/lens flares ; faible lueur bleutée des nuages près de la silhouette pour deviner le tore. `torus-fog.ts` remplace coquilles et sprites par un volume continu : PostProcess à demi-résolution, bruit 3D, profondeur native et raymarching borné. Pas d'auto-ombrage atmosphérique complet ; aspect et coût GPU prolongé à valider.

Le [parcours d’onboarding joueur](../SPEC-ONBOARDING-JOUEUR.md) ajoute l’inscription et l’implantation atomique du premier village depuis le modèle figé de Tristan, avec stocks initiaux indépendants du compte de conception.

Conventions et tranches implémentées :

- [Monde et grille](./world-grid.md)
- [Espace mondial et occupation](./world-space-and-occupancy.md)
- [Génération d’un monde](./world-generation.md)
- [Bâtiments et catalogue](./building-catalog.md)
- [Construction spatiale et Jardin surfacique](./spatial-construction.md)
- [Économie](./economy.md)
- [Temps serveur](./server-time.md)
- [Synchronisation du village](./village-synchronization.md)

## Population et cadrages associés

Le premier accomplissement persistant et le grimoire de l'Oracle sont implémentés par la migration 014 ; voir la section correspondante dans [Économie](./economy.md) et le [handoff](../HANDOFF-SOL-2026-09-07-COFFRE-JOURNAL-ORACLE.md). L'indice validé attend 90 secondes visibles sans action réussie ni découverte du coffre ; son suivi reste une présentation de session côté React, sans autorité économique. Voir la [spec](../SPEC-COFFRE-JOURNAL-ORACLE.md).

- [Habitants par cohortes et récolte différée](../SPEC-TERRA-2026-09-05-habitants-et-recolte.md) — implémentés avec repas, repos et intégration React ; voir la reprise courante pour les preuves et réserves.
- [Version product owner](../PO-CAFE-CLOPE-2026-09-05-habitants-et-recolte.md) — même périmètre, lecture joueur.
- [Brief Exploitation](./Sol-Brief-exploit.md) — cadrage futur des gisements, pas une architecture livrée ni une spec approuvée.

Pour les consignes et preuves de livraison : [AGENTS.md](../../AGENTS.md), [workflow](../AGENT-WORKFLOW.md), [reprise courante](../../SESSION-HANDOFF.md). Les reviews et notes de contexte datées restent historiques ; vérifier le code actuel.


## Mise à jour — gisements pierre

La [spec approuvée](../SPEC-ASTRA-2026-09-05-EXPLOITATION-GISEMENTS.md) remplace le brief prospectif pour cette tranche. Voir le [handoff](../HANDOFF-ASTRA-2026-09-05-gisements.md) et les [appels React](../API-EXPLOITATION-GISEMENTS.md). Le menu React est branché ; Tristan a confirmé la validation humaine du fonctionnement complet le 6 septembre. La reprise courante distingue cette validation des corrections ultérieures de revue et de la suite Playwright historique.
