# Streaming du terrain autour de la caméra

Date : 30 septembre 2026. Base relue : `main`, `0a0873a`.
Statut : **implémentée dans le worktree le 1er octobre 2026 ; correction du délai des arbres et des refreshs validée par tests ciblés et navigateur local, recette humaine à reprendre**.

Suite autorisée et en cours d'implémentation : [Vues Village, Région et Monde torique](SPEC-VUES-TERRAIN-REGION-MONDE-TORIQUE.md). Elle remplace la limite visuelle fixe de 48 cases par un terrain régional simplifié et un donut ; le rayon de 48 cases reste un budget de résidence du détail. Les exclusions de la présente tranche décrivent son étape historique. Voir le [handoff](../SESSION-HANDOFF.md) pour l'état vérifié de la suite.

## Résultat joueur

Déplacer la caméra au-delà de la région initiale du village révèle progressivement le vrai terrain du monde, ses côtes, son eau et ses éléments naturels. Revenir sur une zone récemment visitée réutilise les données en mémoire. Les bâtiments, Jardins et interactions du village continuent à fonctionner pendant le chargement.

Cette première tranche porte la navigation et le rendu local. Elle ne constitue pas une livraison de la découverte des autres villages ni de toutes les interactions mondiales.

## Base vérifiée avant la tranche

- PostgreSQL contient déjà `world_chunks`, indexés par `(world_id, chunk_x, chunk_y)`, avec terrains et élévations générés. Les mondes actuels utilisent des chunks de 32 × 32 cellules et un tore de 2048 × 1024 cellules ; lire les dimensions du monde, sans les coder en dur.
- `snapshot()` dans `apps/api/src/modules/villages/service.ts` assemble une région fixe de 64 × 64 autour de l'ancre du village. La route `GET /api/worlds/:worldSlug/village` ne prend aucun viewport et réconcilie l'économie.
- `App.tsx` rafraîchit ce snapshot pour les transitions métier. Le callback actuel de déplacement caméra ferme les panneaux ; il n'effectue aucun chargement spatial.
- `BabylonVillageScene.#updateTerrain()` recrée les meshes de sol et d'eau quand la région change. Ses sous-meshes de rendu font 8 × 8 cellules, distincts des chunks de stockage de 32 × 32.
- Les côtes lisent les voisins cardinaux et diagonaux. Les bosquets et gisements viennent des features serveur ; les cailloux décoratifs sont déterministes et disparaissent sur les occupations.
- Les bâtiments du snapshot appartiennent au village courant. Le contrat de terrain ne doit pas être présenté comme un contrat de visibilité des bâtiments de tous les joueurs.

## Périmètre autorisé

1. Une lecture HTTP bornée des chunks demandés, distincte du snapshot économique.
2. Une sélection de chunks autour de l'emprise visible de la caméra, avec une couronne de préchargement.
3. Un cache mémoire de session, des requêtes dédupliquées et un rendu incrémental.
4. Des raccords de relief, côte et eau aux limites des chunks et du tore.
5. Les éléments naturels des chunks chargés et le maintien de l'inspection pierre existante par UUID.
6. Le maintien des interactions et des figurants du village lors d'un aller-retour de caméra.

Hors scope : génération à la volée, modification du terrain, niveaux de détail, vue planète, WebSocket, cache persistant, brouillard de guerre, colonisation, bâtiments des autres villages et extension du calcul des chemins. Aucun changement de vitesse, durée de travail, crédit économique ou constructibilité.

## Décisions et limites

**Validé dans la session précédente :** temps de transport séparé du travail, 1 seconde par case ; autorité serveur sur les occupations et autorisations ; tore canonique.

**Autorisé par Tristan le 1er octobre :** navigation libre du terrain avec les éléments naturels déjà visibles dans le snapshot, sans nouveau mécanisme de découverte. Les requêtes exigent une session et un accès au monde via un village possédé.

**Ouvert, distinct de cette tranche :** visibilité des bâtiments des autres joueurs. Le terrain distant ne prétend pas représenter un monde complet sans bâtiments : cette limite doit être indiquée dans la recette et le bilan. Les occupations distantes servent uniquement à éviter de placer du décor sur une emprise réservée ; elles n'accordent aucun droit et n'exposent ni stocks ni population.

La grille reste celle des cellules `canBuild` du snapshot. Un terrain nouvellement chargé n'est pas implicitement constructible. Les gisements chargés restent soumis aux règles actuelles des détails et commandes ; leur présence ne garantit pas leur accessibilité.

## Contrat et lecture serveur

Contrats partagés dans `packages/contracts` et lecture initiale :

`GET /api/worlds/:worldSlug/terrain?chunks=chunkX,chunkY;chunkX,chunkY`

Pour un chunk encore présent dans le cache, lire ensuite uniquement ses listes évolutives :

`GET /api/worlds/:worldSlug/terrain/updates?chunks=chunkX,chunkY;chunkX,chunkY`

Cette seconde réponse conserve identité/version/dimensions du monde et coordonnées/origine de chaque chunk, features et occupations complètes. Elle ne contient **ni `terrainCodes`, ni `elevations`**, et ne lit pas `world_chunks`. Les deux lectures partagent authentification, autorisation, bornes, normalisation et transaction read-only repeatable-read. Une éviction ou une nouvelle version nécessite à nouveau une lecture initiale complète ; une revalidation à cinq secondes ou un retour après quinze secondes n'envoie pas le terrain fixe si le chunk est conservé.

- Liste de 1 à 16 entrées par requête, borne vérifiée avant déduplication ; coordonnées entières sûres validées puis normalisées sur le tore, doublons supprimés après normalisation. Refuser les entrées mal formées et les lots au-delà de la borne.
- Réponse : identité du monde, version de génération, dimensions, taille des chunks et liste de chunks canoniques.
- Chaque chunk contient terrains et élévations en ordre ligne-major, la liste **complète** des features naturelles de son intérieur et la liste **complète** des coordonnées occupées de cet intérieur, nécessaires au décor. Réutiliser les types partagés existants des gisements, dont `revision`. Dédupliquer les features par UUID et leur attribuer un chunk propriétaire par leur cellule canonique de référence ; aucune feature n'est publiée depuis le halo.
- Fournir également un halo de **1 cellule** sur les quatre côtés, coins compris, pour lire les voisins du relief. Pour une taille intérieure `S`, chaque tableau terrain/élévation contient exactement `(S + 2)²` valeurs ; l'index `(y + 1) * (S + 2) + x + 1` couvre les coordonnées locales `-1 <= x,y <= S`. L'origine intérieure est `(chunkX * S, chunkY * S)` ; les cellules du halo sont normalisées aux dimensions du monde. Le halo n'est pas rendu comme un second intérieur.
- Toutes les lectures et jointures sont contraintes par `world_id`. Les features de pierre épuisée restent retrouvables par `stone_deposits`, même après retrait de leur occupation.
- Monde non prêt ou chunk intérieur/halo manquant : erreur explicite `WORLD_NOT_READY`, sans inventer de prairie de remplacement ni relancer la génération.
- Lecture de présentation dans une transaction courte **READ ONLY / REPEATABLE READ**, pour que features et occupations de tous les chunks du lot viennent du même snapshot PostgreSQL. Aucun `beginVillageEconomy`, crédit, tâche différée ni verrou métier. Les détails/commandes de pierre conservent leur transaction autoritative actuelle. Cette isolation est locale au lecteur terrain, pas un changement global de l'économie.
- Les terrains générés sont stables ; features et occupations sont évolutives. Les distinguer dans le cache. Réponses privées, sans cache partagé entre comptes.

Aucune migration n'est prévue : les tables nécessaires existent. Une optimisation SQL éventuelle devra être motivée par une mesure, puis validée sur test.

## R1 — Propriété, fraîcheur et fusion des données

Un store spatial client est l'unique propriétaire de la vue fusionnée des features et occupations utilisée par Babylon. Le snapshot village garde l'autorité sur les bâtiments du joueur et les cellules interactives. Une réponse de terrain n'écrit jamais dans le snapshot économique.

### Portée et ordre des réponses

- Chaque liste de chunks est complète uniquement pour les intérieurs explicitement retournés. L'absence d'un UUID hors de ces intérieurs ne dit rien sur son existence. L'absence d'un gisement distant dans `state.region.features` ne le supprime jamais du store spatial.
- Les features du snapshot, des détails et des commandes alimentent le store par UUID. Pour les gisements, conserver la plus grande `revision`, quel que soit l'ordre d'arrivée ; une égalité est idempotente. Conserver l'état `depleted` comme tombstone tant que le chunk est retenu. À son éviction, rejeter également toutes ses réponses encore en vol via son jeton d'incarnation.
- Une entrée de chunk possède un numéro de requête et un compteur local d'invalidation. Une seule lecture de données évolutives par chunk est en vol, même si deux lots globaux peuvent être actifs. Au départ, capturer identité session/monde/version, incarnation et compteur ; au retour, vérifier ces valeurs avant application. Annuler n'est pas une preuve suffisante : les gardes sont obligatoires même si le transport livre une réponse tardive.
- Construction, extension, nouvelle occupation observée dans un snapshot accepté, nouvelle révision de gisement, début/fin de mission ou résultat de commande invalident les chunks affectés. Une réponse lancée avant cette invalidation peut encore fournir le terrain immuable à une entrée toujours valide, mais ses features/occupations sont rejetées et une revalidation est mise en attente.
- Accepter ensemble les listes complètes de features et d'occupations d'un chunk. Si un gisement du lot est plus ancien qu'une révision déjà connue, rejeter sa partie évolutive et revalider le chunk ; ne pas associer un gisement nouveau à une occupation ancienne. La réception d'une nouvelle révision extérieure au lecteur provoque aussi cette invalidation.
- Les occupations du village issues du dernier snapshot accepté masquent immédiatement le décor des cellules concernées. Leur présence prime sur une liste terrain ancienne. Une absence dans `state.cells` n'est pas une preuve de liberté mondiale. Lors du retrait d'une emprise connue, invalider et attendre une lecture complète du chunk avant de réafficher le décor susceptible d'être occupé par un autre acteur.
- Les listes de features non révisionnées et d'occupations sont remplacées à la portée du chunk après les gardes ci-dessus. Leur fraîcheur repose sur la sérialisation des lectures et les invalidations, sans inventer un ordre global à partir de l'heure d'arrivée HTTP ou de `serverTime` provenant d'endpoints différents.
- Un snapshot village inchangé ne provoque ni invalidation ni reconstruction. Comparer les emprises/révisions utiles, pas son seul horodatage. Une liste vide complète peut supprimer des éléments de son intérieur ; elle ne purge pas le store mondial.

### Rafraîchissement sans déplacement

Revalider les données évolutives des chunks **visibles** toutes les 5 secondes via `/terrain/updates` tant que l'onglet est visible, en répartissant les demandes sur cet intervalle. Les chunks de la seule couronne ne sont pas pollés ; ils sont revalidés lorsqu'ils deviennent visibles si leur dernière lecture a plus de 5 secondes. Une réponse identique ne recrée pas les meshes. Garder les mêmes tableaux immuables du cache ; grouper séparément les lectures complètes et les refreshs dans les deux lots simultanés.

À une échéance de mission connue, déclencher le rafraîchissement métier existant puis invalider le chunk de destination lorsque sa fin est confirmée. Une horloge locale ne déclare jamais elle-même un gisement épuisé. Si la confirmation tarde, le polling reste actif. Après construction/extension ou commande pierre, invalider les intérieurs concernés, même s'ils sont hors de la région initiale. Au retour au premier plan ou en ligne, revalider les chunks visibles ; ne pas accumuler de ticks durant l'absence.

Le polling est coalescé avec les invalidations, respecte les deux requêtes concurrentes et ne double jamais une lecture en vol. Avec une latence de lot au plus 1 seconde et sans erreur, toutes les données évolutives visibles doivent être renouvelées en au plus 7 secondes. En erreur, conserver la dernière vue connue, indiquer son chargement dégradé et réessayer après 2, 5 puis au plus 10 secondes ; pas de boucle immédiate. Une action manuelle de reprise relance prioritairement le visible.

## Caméra, réseau et cache

Babylon expose un événement spatial séparé de `onCameraMoved`, avec les coordonnées canoniques et l'emprise utile au sol. Pan, zoom, rotation et redimensionnement recalculent la demande ; ils ne déclenchent pas une requête à chaque frame.

- Sélectionner les chunks qui couvrent le terrain visible, puis une couronne de chunks autour. La projection doit tenir compte du relief et de l'angle rasant : un rayon qui ne rencontre pas le sol ne doit pas produire une demande infinie.
- Appliquer la couverture finie et les budgets R4 ci-dessous aux vues rasantes comme aux autres cadrages. Un rayon sans intersection ne déclenche aucun chargement au-delà de cette couverture.
- Priorité aux chunks visibles manquants, puis au préchargement. Réglages initiaux proposés : 2 requêtes concurrentes, au plus 16 chunks par lot, consolidation des changements de demande sur environ 100 ms.
- Dédupliquer par `(world_id, generation_version, chunk_x, chunk_y)`. Une réponse tardive pour un chunk retenu peut alimenter le cache selon R1, mais ne remet pas la caméra sur une ancienne position. À la destruction de scène ou au changement de monde/session, annuler et invalider l'ensemble des réponses restantes, puis vider le store.
- Garder les terrains immuables jusqu'à éviction selon R4 ; gérer séparément la revalidation des données évolutives selon R1. L'ordonnanceur est client et n'utilise aucune tâche économique serveur.
- Le snapshot initial assure le premier affichage. Il peut amorcer les cases connues du cache, mais sa région 64 × 64 n'est pas nécessairement alignée sur les chunks ; ne pas marquer complet un chunk seulement couvert en partie.
- Les rafraîchissements économiques continuent indépendamment. Un mouvement de caméra ne déclenche pas `getVillage()`.

En cas d'erreur réseau, conserver le terrain déjà présent dans les limites R4, montrer un indicateur discret si une zone visible manque et proposer une reprise du chargement. Couvrir les trous par un fond de chargement neutre non sélectionnable, distinct des terrains métier, sans inventer une prairie ou de l'eau. Un délai long ne doit pas laisser un écran uniformément bleu ni bloquer les panneaux du village. Les zones encore inconnues ne deviennent jamais sélectionnables comme cases libres.

## Rendu Babylon

- Gérer les meshes par chunk de stockage, avec subdivision de rendu si nécessaire. Ajouter/retirer les seuls chunks concernés ; ne pas reconstruire tout le sol ou la végétation à chaque déplacement.
- Partager atlas et matériaux à l'échelle de la scène. Éviction : détruire meshes/buffers du chunk sans détruire les ressources partagées. Destruction de scène : retirer callbacks, requêtes et ressources partagées.
- Les UV, couleurs, végétation et cailloux dépendent des coordonnées mondiales, pas de l'ordre d'arrivée. L'eau conserve une phase d'animation commune à tous les chunks.
- Utiliser le halo pour les flancs et coins des côtes ; un chunk rend uniquement son intérieur. Ni trous, ni surfaces doubles, ni flanc artificiel au bord d'un lot réseau.
- Utiliser le repère commun R3 pour tous les meshes, marqueurs et conversions de clics. Les données métier restent canoniques.
- Séparer les données de terrain servant au rendu des `state.region` utilisés actuellement par le calcul des routes serveur. Mettre à jour les projections des chemins et figurants selon R2, indépendamment de leur état métier.
- Le snapshot métier conserve bâtiments, Jardins, occupations interactives et grille. Ne pas dupliquer le sol, la végétation ou les gisements entre snapshot initial et chunks streamés. Ne pas réinitialiser une sélection ou une mission lorsqu'un chunk arrive.

## R2 — Projections des chemins et figurants

Conserver les cellules canoniques du chemin serveur et les dates/temps de transport de chaque mission. Les points Babylon sont une projection dérivée, invalidée par l'arrivée/retrait d'un chunk nécessaire et par la version du repère R3. Mettre à jour les points des missions existantes ; leurs IDs, instances de figurants et progression temporelle sont conservés. La frame d'animation suivante doit utiliser cette projection mise à jour.

La hauteur vient d'une lecture commune du terrain chargé, snapshot initial compris, avec les décalages de pieds/surface actuels. Aucun repli à une hauteur arbitraire zéro sur un sol inconnu. Une portion debug est affichée seulement si son sol est disponible ; un figurant sur une portion inconnue est temporairement masqué, sa mission continuant côté serveur. Il réapparaît à la position correspondant à l'heure serveur lorsque le sol arrive, sans repartir du village. Si une hauteur est encore connue dans le cache mais que le mesh de sol a été évincé, ne pas afficher un figurant suspendu au-dessus du fond de chargement.

Les portions de routes rendues sont filtrées sur la couverture de terrain effectivement affichée, et non plus sur la région fixe 64 × 64. Leur signature comprend les données de route, la couverture/hauteur et la version du repère. L'arrivée d'un chunk ne recalcule aucun itinéraire métier et ne crée pas une route absente du contrat serveur.

## R3 — Repère torique commun et picking

Définir un module ciblé de conversion utilisé par le terrain, les bâtiments, les features, les figurants, les chemins, la grille, les previews, les marqueurs de récolte/sélection et le picking. Le repère porte une origine canonique `O` en cellules et une version ; l'échelle de rendu reste `TILE_SIZE`.

- Projeter une cellule isolée `C` par `wrappedDelta(C, O, tailleMonde) * TILE_SIZE`, avec une règle déterministe au demi-tour exact. La conversion inverse d'un point local est `normalize(O + local / TILE_SIZE)` ; conserver la partie fractionnaire durant le glissement, arrondir seulement pour choisir une cellule.
- Projeter un chunk depuis une seule image torique de son origine, puis ajouter ses offsets locaux. Projeter un chemin ou un bâtiment de plusieurs cases à partir d'un point de référence puis dérouler ses cellules voisines avec des deltas toriques continus ; ne pas projeter indépendamment deux sommets adjacents de part et d'autre d'une coupure.
- À chaque franchissement de chunk par la cible caméra, choisir l'origine canonique du chunk de cette cible comme nouveau `O`. Translater position/cible caméra et objets affichés dans la même frame, avant rendu et picking ; conserver zoom, angles, inertie et intentions de sélection. Reprojeter les chemins stockés, pas seulement déplacer leurs figurants.
- Un événement pointeur est converti avec la version du repère de la frame courante. Les points de geste déjà acquis restent des coordonnées mondiales ; une preview est reprojetée après changement de repère. Les positions d'écran des panneaux/ancres sont recalculées ou fermées par le comportement caméra existant.
- Retirer l'ancien réenveloppement caméra indépendant de cette conversion. Aucun mélange entre coordonnées relatives à l'ancre du village et coordonnées relatives à `O` n'est permis dans un même rendu.

La couverture R4 reste inférieure à une demi-dimension mondiale pour éviter d'afficher deux copies interactives d'une cellule. Les tests utilisent une ancre non centrale et franchissent séparément les frontières canoniques zéro/dimension et l'ancienne coupure opposée à l'ancre, dans les deux sens et aux coins.

## R4 — Couverture, budgets et intégration progressive

Paramètres initiaux, centralisés côté client et mesurés pendant la recette :

| Paramètre | Borne initiale |
| --- | --- |
| Rayon de couverture au sol | 48 cellules de Chebyshev autour de la cible caméra |
| Petite dimension mondiale | Rayon réduit à au plus un quart de la plus petite dimension |
| Préchargement | 1 couronne de chunks autour des intérieurs visibles retenus |
| Données retenues | 64 chunks maximum, données évolutives et travaux associés compris |
| Résidence graphique | 16 chunks résidents, réserve transitoire d'une unité (borne conservatrice de 17) |
| Réseau | 2 lots simultanés, 16 chunks maximum par lot |
| Construction CPU des meshes | Tranches de travail de 4 ms maximum visées par frame, mesures obligatoires |

Intersecter l'emprise visible avec le carré de couverture avant de sélectionner les chunks. Pour les chunks actuels de 32 cellules, ce carré touche au plus 4 × 4 chunks, puis 6 × 6 avec la couronne : la demande tient dans 36 entrées. Seules les tuiles visibles et leur marge déclenchent une construction ; les préchargements restent des données. Les tuiles déjà construites d'un résident survivent à une rotation ou un zoom qui les masque : elles sont réutilisées au retour et libérées avec le chunk, pas à chaque changement du masque caméra. Les listes complètes continuent à supprimer les features disparues, même retenues hors champ. Le plafond de 16 résidents compte aussi les anciens chunks, même s'ils appartiennent encore à la couronne de données. Sur une autre taille de chunk, réduire d'abord la couronne, puis le rayon avant d'émettre la demande pour garantir les plafonds. Définir une limite lointaine visuelle avec un fondu sur les 8 dernières cellules de couverture ; la limite des chargements ne doit pas apparaître comme une falaise ou une étendue d'eau fictive. Ce fondu graphique ne crée pas de brouillard de guerre persistant.

Le cache de données évince d'abord les chunks hors demande les moins récemment utilisés. Les entrées de la demande courante sont protégées, dont le nombre est borné en amont ; aucun chemin de mission ne retient tous ses chunks éloignés. Snapshot initial et chunks streamés partagent le budget de résidence graphique après leur transfert, sans double couverture.

En erreur ou pendant une nouvelle demande, garder en priorité les meshes déjà visibles. Les anciens chunks non visibles occupent seulement les places restantes du plafond de 16, puis sont évincés en commençant par les plus éloignés. La poursuite d'un pan hors ligne n'accumule donc pas l'historique de navigation. Une zone manquante utilise le fond de chargement décrit plus haut ; les données et interactions métier ne sont pas effacées pour libérer un mesh.

Les callbacks réseau placent les données acceptées dans une file ; ils ne construisent pas tous les meshes reçus immédiatement. La file est dédupliquée par chunk/version et bornée à la demande courante. Construire d'abord le sol sous la cible caméra, puis progresser par bandes de distance de quatre cellules : sol de la bande, gisements et bosquets de la bande, puis cailloux décoratifs. Les arbres proches ne doivent pas attendre que tout le sol et tous les cailloux lointains soient terminés. Un bosquet partage la priorité spatiale de sa tuile de sol, laquelle est publiée avant lui. La couronne est uniquement une priorité de lecture réseau, sans construction graphique. Annuler les travaux devenus inutiles ou invalidés avant leur exécution et contrôler leur version avant publication.

Subdiviser le travail en tuiles de rendu 4 × 4 et lots bornés de features, en affinant si une unité dépasse le budget. L'admission réserve 1 milliseconde et tient compte du coût récent de chaque recette. Tester le budget entre unités ; une opération GPU non interruptible peut déborder, elle doit être mesurée. Publier les sous-meshes complets progressivement ; lors d'un remplacement, conserver l'ancien sous-mesh jusqu'à disponibilité du nouveau puis l'échanger, sans double affichage. Compter aussi ces allocations transitoires dans les métriques et limiter le remplacement à une unité à la fois.

Objectif de recette : aucune tâche principale de plus de 50 ms imputable au streamer ; temps CPU d'intégration par frame au percentile 95 au plus 4 ms. Mesurer aussi le percentile 95 des intervalles de frames, avec une dégradation au plus de 20 % face au même parcours préchargé, sur le même navigateur et la même machine. Capturer ces mesures sur 60 secondes de pan avec arrivées simultanées de lots, puis 60 secondes stationnaires. Utiliser un navigateur à cadence normale : le mode automatisé actuel limité à 5 FPS ne prouve pas la fluidité. Le profil mobile Chromium prouve le parcours responsive, pas les performances d'un téléphone physique. Si les objectifs échouent, réduire la granularité/marge/rayon et documenter les valeurs finales avant de déclarer la tranche validée.

Le percentile par frame inclut toutes les frames de la période, y compris celles sans intégration. Publier séparément le percentile des seules frames avec travaux (`integrationActiveP95`) pour ne pas masquer le coût d'une arrivée de meshes. Les maxima d'intégration et du streamer complet restent contrôlés sur toutes les phases, sans retirer les pics.

## Étapes d'implémentation

1. Contrats, lecteur serveur et tests d'accès, de bornes et de halo torique.
2. Sélection caméra/cache/réseau et tests de réponses retardées, déduplication et éviction.
3. Adaptation ciblée du rendu terrain/features en chunks indépendants ; intégration avec le premier snapshot et les commandes pierre.
4. Parcours navigateur, réglage de la distance/marge/budgets et correction des raccords.
5. Mise à jour de l'architecture et du handoff avec mesures, preuves et limites réelles.

Ne pas commencer par refactorer toute la scène ou tout le service village. Extraire uniquement les lectures et recettes que cette tranche doit partager.

## Preuves et critères d'acceptation

- API : session absente refusée ; accès au monde contrôlé ; chunks d'un autre monde jamais renvoyés ; lots invalides/trop grands refusés ; normalisation torique et halo diagonal exacts ; monde incomplet refusé.
- Lecture de présentation : terrain consulté sans mutation des ressources, occupations, missions ou tâches. Les tests comparent les données avant/après lecture.
- Cache : pan dans un chunk chargé sans requête superflue ; lot en vol dédupliqué ; priorité au visible ; réponses inversées sans retour à une ancienne fenêtre ; budgets bornés et éviction des chunks éloignés ; changement de monde sans réemploi de données étrangères.
- R1 : retarder une réponse terrain avant construction/extraction puis la délivrer après la commande ; vérifier qu'elle ne restaure ni décor occupé ni ancienne révision. Un snapshot fixe ne supprime aucun gisement distant. Vérifier le remplacement d'une liste complète vide uniquement dans son chunk et le rejet d'une réponse d'une incarnation évincée.
- R1 : caméra immobile hors région initiale, faire évoluer un gisement depuis une autre session et terminer une mission connue ; obtenir l'état serveur actualisé dans la borne de revalidation. Tester le retour au premier plan, le réseau dégradé et l'absence de lectures concurrentes d'un même chunk. Forcer une mutation entre deux lectures SQL pour vérifier la cohérence features/occupations du lot.
- Navigateur ordinateur et profil mobile : sortir de la fenêtre initiale 64 × 64, voir de vrais chunks supplémentaires, revenir au village et utiliser Construire, un Jardin et l'inspection pierre.
- Raccords : captures au passage d'une côte entre chunks et aux deux jointures du tore ; eau continue, aucun flanc parasite ni doublon de feature. Tester une vue rasante et le dézoom maximal, y compris le fondu lointain et un rayon ne rencontrant pas le sol.
- R3 : ancre non centrale, passages canoniques et opposés à l'ancre sur chaque axe/coin ; vérifier l'identité canonique réellement sélectionnée, une preview/glissade en cours, les marqueurs et la continuité des chemins après changement de repère.
- Réseau : retard et erreur injectés sur des chunks visibles ; interface utilisable et reprise réussie. Les premières données encore dans la couverture retenue restent présentes pendant l'attente ; un pan prolongé hors ligne respecte les plafonds et montre explicitement les zones manquantes.
- R2 : retarder un chunk élevé pendant une récolte/extraction ; vérifier la bonne hauteur dès publication et une progression calculée depuis les mêmes dates. Retirer puis recharger le chunk : masquage contrôlé sur terrain inconnu, réapparition à la progression courante, pas de recréation de mission ni retour au départ. Les portions debug suivent la couverture réellement affichée.
- R4 : mesurer sur une navigation prolongée les chunks de données (<= 64), résidents graphiques (<= 16, réserve transitoire conservatrice <= 17), unités/meshes en cours, volume transféré et temps CPU/frame. Livrer les mesures de fluidité selon R4 et les valeurs finales des paramètres. Un snapshot économique inchangé ne reconstruit pas le terrain ; deux lots de 16 chunks reçus ensemble sont intégrés progressivement. Une destruction de scène libère aussi les travaux en attente.
- Délai perceptible : scénario zoom-in → déplacement vers un bosquet connu → rotation → zoom-out, premier bosquet dans le viewport en moins de 5 s sur le navigateur local à cadence normale. Revenir après 15 s ne retélécharge pas le sol d'un chunk encore en cache ; des refreshs évolutifs réussis restent possibles. Contrôler les réponses HTTP et l'absence de statut dégradé, pas seulement compter les requêtes. La mesure de temps/frame seule ne prouve pas ce délai d'apparition.
- Surveiller console Babylon et requêtes de repli `.fx`, en plus des `pageerror`. Terminer builds, typecheck, lint et suites ciblées nécessaires ; ne pas réinitialiser la base de développement pour la recette.

## Références

- [Monde et grille](architecture/world-grid.md)
- [Génération du monde](architecture/world-generation.md)
- [Occupation et constructibilité](architecture/world-space-and-occupancy.md)
- [Workflow](AGENT-WORKFLOW.md)
- [Revue R1–R4 et suivi des corrections](REVIEW-STREAMING-TERRAIN.md)

La lecture serveur et le streamer client sont implémentés dans le worktree. Le handoff consigne les tests API/client, les parcours navigateur, la régression d'éviction et les mesures mémoire/fluidité locales, ainsi que les points de recette humaine restants. Les bornes ci-dessus ont été réduites après le signalement de plantages mémoire. Les performances locales sont mesurées sur Intel Iris Plus / Direct3D11 ; le profil mobile et les essais SwiftShader ne valent pas une preuve de fluidité sur téléphone physique ou rendu logiciel.
