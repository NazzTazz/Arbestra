# Économie

## Première récolte — accomplissement

La finalisation d'une récolte positive insère `first-harvest` dans `village_accomplishments`, dans la même transaction que le crédit des carottes et à l'échéance logique de la récolte. L'unicité monde/village/code empêche les doublons. Aucun bonus économique supplémentaire ni rattrapage historique : les villages existants débloquent l'entrée à leur prochaine récolte positive. Le Grimoire affiche « Première récolte » ; un snapshot révélant une nouvelle entrée déclenche un bref message Oracle, sans célébration au chargement initial. Implémenté le 2 octobre 2026, à valider en recette ; aucun test exécuté pour cette passe.

## Déplacements liés aux travaux (016)

Terre battue : bandes brunes mates suivant la hauteur de chaque case, scindées aux frontières avec face verticale aux marches ; pas d'interpolation traversant le terrain ni de chevauchement des cases pavées. Texture à grain atténué avec mipmaps, UV continus ancrés au monde et hauteur +0,012.

Les meshes routiers sont conservés quand une révision du streamer ne change pas leur réseau, projection ou terrain disponible. Jardins terminés/réservés : surface unique à hauteur du terrain +0,16, sans face de socle superposée ; texture à filtrage trilinéaire. Stabilité au mouvement caméra à confirmer en recette interactive.

Recette du pavage : dalles désormais deux fois moins longues, dessus à -0,025 sous l'herbe, coins arrondis (rayon maximal 0,035) et petit chanfrein supérieur. Les bordures se raccordent par faces en onglet aux angles ; aucune rallonge systématique en « + ». Cette recette remplace l'affleurement et la longueur nominale décrits dans la première version ci-dessous.

Présentation des missions Jardin/pierre : le chemin visuel est raccordé au seuil de la porte de l'hôtel de ville, avec dégagement du porche et contournement de sa façade. Les habitants ressortent/rentrent par ce seuil ; interpolation par longueur des segments, sans modifier le chemin persisté ni les échéances serveur. Les groupes se resserrent près de la porte.

Habillage des routes pavées : excavation réelle du terrain à -0,06 unité, topologie canonique commune au terrain et aux dalles. Dalles géométriques de proportions nominales 2×5×0,2 adaptées aux raccords (épaisseur 0,047), dessus à fleur (-0,002). Bordures gris clair irrégulières enfouies à 90 % (hauteur 0,085, dépassement 0,0085), contour complet avec ouvertures aux intersections. Dalles et bordures regroupées chacune dans un mesh ; terre conservée sur les branches de ressources, fondu vers Région, aucun effet sur le routage. Les unités de terrain concernées sont reconstruites quand la topologie change.

Les flammes possèdent des phases, tempos, débits et préchauffages distincts dérivés de leur emplacement canonique, pour éviter une animation synchronisée entre braseros tout en restant stable au rebase.

Recette des flammes : largeur des sprites et dispersion horizontale divisées par deux, hauteur et mouvement vertical conservés.

L'habillage du réseau s'arrête avant les cases occupées par les bâtiments/emprises : aucune branche décorative jusqu'au bâtiment. Un tracé interrompu par une emprise est scindé, sans raccourci ; excavation, dalles, bordures et foyers partagent ce réseau décoratif. Routes métier et sortie des habitants par la porte inchangées. Braseros uniquement aux angles rentrants, entre deux branches perpendiculaires : un au coude, deux au T, quatre au croisement complet, aucun en ligne droite ou extrémité (±0,96 unité du centre). Phases distinctes conservées.

Budget lumineux des foyers : six lumières actives maximum, choisies près de la caméra, et toujours deux au maximum par objet. Les autres flammes restent visibles. Aucune affectation recalculée de jour/hors détail ; la sélection nocturne reste à 1 Hz, conserve les listes identiques et ne dégèle que les matériaux gelés. Les foyers inchangés sont conservés lors de l'arrivée de chunks, au lieu de reconstruire tout le réseau.

Réglage artistique des braseros : échelle des pierres 0,085 unité, blocs amincis gris clair avec sommets irréguliers et normales recalculées. La dernière division par trois concerne uniquement la flamme. Les proportions initiales 3:1:1 sont affinées par cette recette (longueur 3,25, hauteur 0,65, profondeur 0,75). Petites flammes en ParticleSystem natif, 24 particules maximum par foyer et texture alpha partagée. Lumière de portée 5, intensité nominale 0,9 modulée légèrement. Extinction et remise à zéro des particules au jour et hors vue détaillée.

Décor des voies en Village : des braseros bordent les angles et intersections du réseau canonique (pas les extrémités ni les tronçons droits). Chaque foyer comporte deux rangs de quatre blocs au ratio 3:1:1, assemblés autour d'un vide central avec joints inversés. Les flammes et lumières ponctuelles Babylon suivent la nuit à l'ancrage du village ; aucun combustible ni effet économique. Deux lumières de foyer au maximum par objet proche, sans ombres portées supplémentaires ; effacement avec le détail local, ressources libérées avec la scène.

Pour les nouvelles récoltes de parcelles et extractions de pierre, le trajet aller-retour s'ajoute au travail sur place : une seconde par case parcourue dans chaque sens, puis 60 secondes au Jardin ou `600 secondes / travailleurs` à la pierre. L'itinéraire et `transport_ms` sont figés sur la mission au départ ; une construction ultérieure ne décale pas sa fin. Le crédit et la libération des travailleurs restent atomiques à l'échéance totale. Les missions antérieures à 016 conservent leur échéance et ont un trajet vide avec un transport nul. Les temps montrés pour choisir l'effectif d'extraction incluent le transport.

Les routes partent de l'ancrage du village, passent par des cases cardinalement adjacentes et peuvent faire des détours pour contourner les occupations ou rejoindre un tracé partagé. Le terrain et les occupations sont lus côté serveur ; pour un gisement hors du viewport jusqu'à 128 cases, le calcul lit un corridor de chunks et d'occupations du monde. Au-delà, un trajet torique cardinal direct préserve la portée mondiale des commandes : son contournement du terrain reste à traiter dans une tranche de navigation à grande distance. En Village, `village-roads.ts` habille le réseau reçu : pavés sur les routes de bâtiments, terre sur les branches jardins/gisements ; un tronçon partagé conserve les pavés. Ce décor permanent, limité au terrain affiché, s'efface vers Région et ne change aucune durée ni autorité économique. La surcouche debug reste distincte pour inspecter les trajets.

Les stocks joueurs sont des `bigint` entiers : aucune fraction de planche ou de carotte n’est visible ni dépensable. Les coûts sont entiers ; le coût théorique 112,5 de la Scierie niveau 3 est arrondi explicitement à 113.

Les taux sont des `numeric` exacts. Chaque flux conserve un reliquat fractionnaire `[0,1[` et un curseur temporel :

- `village_resource_flows` pour la production directe vers un stock ;
- `building_resource_buffers` pour les productions internes historiques et non spatiales ;
- `garden_plots` pour le stock, le reliquat et le curseur de chaque parcelle de Jardin active.

Une lecture sans transition due projette `stock entier + floor(reliquat + taux × temps)` sans écrire. Une commande qui dépense, récolte ou change un taux matérialise d’abord jusqu’à sa borne PostgreSQL, puis conserve le nouveau reliquat.

Toute opération économique verrouille d’abord la ligne du village. Sa borne est lue avec `statement_timestamp()` après ce verrou, puis toutes les constructions et extensions dues sont appliquées par `(échéance, identifiant, type)`. Un worker peut donc détenir sa tâche via `SKIP LOCKED` puis attendre le village ; il ne verrouille jamais les autres tâches pendant la réconciliation.

Invariant de développement : dans une même transaction, `village → verrous métier` ; ressources et buffers sont parcourus par `resourceCode`, les réservations de cellules par `(cellX, cellY)`. La réconciliation et les commandes ne verrouillent, n'acquittent ni ne modifient une notification existante. Seul le scheduler acquitte ou replanifie sa propre tâche, déjà verrouillée avant le village. L'insertion d'une nouvelle notification de construction est permise sans unicité pending sur son sujet (migration 009). Le contexte de `beginVillageEconomy()` reste dans sa transaction ; commande et snapshot réutilisent sa borne, y compris pour une transition de durée nulle. À état initial, événements et borne finale identiques, l'ordre de découverte des échéances ne doit pas changer le résultat économique.

Valeurs initiales :

- bois 2000, carottes 50 ;
- bois naturel 60/h ;
- Scierie : 60, 108, 194,4 bois/h aux niveaux 1–3 ;
- Jardin : 60 carottes/h et 600 de capacité par cellule active ; 50 bois par cellule construite.

La récolte du Jardin accepte désormais une sélection de coordonnées canoniques : une tournée, un habitant, une minute de travail par parcelle et un seul retour final. Sous le verrou village et sa borne H, `startGardenTour()` verrouille les parcelles dans l'ordre des coordonnées, vérifie leur disponibilité et l'énergie nécessaire pour toute la durée, matérialise et réserve toutes leurs unités entières. Les étapes et le retour sont figés sur la mission (migration additive 021). La sélection est atomique ; le reçu vérifie son contenu et son ordre, y compris après fusion. Les cibles intermédiaires sont protégées par le contrôle des étapes actives sous verrou village, au-delà de l'unicité partielle qui protège la première cible. L'ancien endpoint unitaire consulte également ces étapes.

Le stock village reçoit la somme réservée au retour final, dans la même transition qui termine la récolte et libère l'unique cohorte affectée. Chaque parcelle repart de zéro avec son reliquat conservé et continue de produire pendant la tournée ; les parcelles non sélectionnées ne changent pas. Une seule notification planifie cette échéance, sans être acquittée par la réconciliation. Les trajets anciens gardent leur crédit, leur échéance et leur reçu ; des étapes vides désignent le parcours unitaire historique.

La migration 015 verrouille les villages dans l'ordre monde/UUID, puis lit sa borne commune avec `statement_timestamp()`. Elle matérialise l'ancien producteur à chaque construction/extension échue dans l'ordre échéance/ID/type, en appliquant le plafond avant chaque agrandissement, puis à la borne finale. Elle répartit ensuite le stock entier par quotient/reste dans l'ordre canonique des coordonnées et place le reliquat exact sur la dernière parcelle. Stocks villages, trajets globaux et notifications existantes restent inchangés. Après la bascule, les anciens buffers Jardin sont des archives passives : seule `garden_plots` produit les nouvelles carottes. La [recette historique](../REVIEW-2026-09-07-JARDINS.md) décrit le défaut corrigé le 30 septembre.

Cette correction de 015 concerne ses prochaines exécutions. Une base ayant déjà appliqué l'ancienne version conserve ses parcelles ; ne pas rejouer la répartition sur leurs stocks et ne pas créditer une perte historique impossible à attribuer exactement.

## Accomplissement du coffre (014)

`village_accomplishments` conserve le journal autoritatif du village, unique par `(world_id, village_id, code)`. Pour `town-hall-supplies`, l'insertion de l'accomplissement, la réclamation de `building_hidden_supplies` et le crédit de 2 000 carottes partagent la transaction et la borne économique du village. Le verrou village sérialise concurrence et retry ; un accomplissement existant retourne l'état courant sans second crédit. La migration reprend les coffres déjà réclamés à leur date sans toucher aux stocks. Les notifications et le texte de l'Oracle restent une présentation sans autorité économique.


## Exploitation de pierre (012)

`stone_deposits` conserve I initial, R restant et S engagé. Disponible = R−S ; réservation Q=min(100,R−S), puis à échéance R−=Q, S−=Q et stock village stone+=Q dans la même transaction. La réservation garantit le lot malgré les travaux adverses. Pas de flux automatique stone. Les quantités sont des entiers sûrs dans les contrats.

Verrous : tâche déjà acquise (worker seulement) → un village → tous les gisements dus et la cible éventuelle, triés par UUID canonique → métier local. Cet ensemble est préparé avant réconciliation ; ne jamais attendre un second village ni une notification existante après un gisement. `beginVillageEconomy` garde H lu après le verrou village, même après attente d’un gisement. Construction, extension, Jardin et pierre restent mêlés par échéance, ID, type. Les opérations atomiques d’extraction supposent cet ensemble préverrouillé.

`population/work.ts` partage énergie, sélection, split et libération. Aucun membre doublement affecté ; un reste positif sous un point ne déclenche pas de repos à la libération. Les quantités publiques sont l’état mondial matérialisé identifié par révision ; une lecture ne réconcilie que son village.

## Repos dans les logements (022, 2 octobre 2026)

`population_cohorts.rest_building_id` réserve un couchage uniquement pendant un repos sans affectation à un travail. Sous le verrou village et à sa borne H, `housing.ts` conserve les placements existants, remplit les maisons (5 places au niveau 1, 25 au niveau 2), puis l'hôtel de ville (30 places). Les cohortes sont fragmentées si nécessaire, sans changer leur total, origine, énergie exacte, curseur, début du repos ou quota alimentaire. L'excédent reste au repos sans logement et est signalé dans le panneau Habitants ; aucune pénalité de récupération n'est introduite. Les places sont libérées au réveil, les nouvelles capacités sont utilisées au prochain traitement du village. Les bâtiments doivent être terminés et appartenir au même monde/village.

Les commandes et échéances conservent leur matérialisation commune dans `work.ts`. Le snapshot réconcilie seulement les transitions d'activité et les placements : il ne réécrit pas tous les curseurs d'énergie lors de chaque poll. Il expose les cohortes disponibles/non affectées, l'occupation de chaque logement et l'effectif sans couchage. La migration additive 022 conserve les anciennes cohortes et impose qu'un groupe logé soit au repos, sans récolte/extraction affectée.

La promenade reste une présentation locale dans `VillageWorkers` : au maximum huit représentants des cohortes `idle`, itinéraires déterministes entre portes via les branches existantes et leur rue commune, pauses invisibles à l'intérieur. Ils partagent la circulation, collisions, LOD et cleanup des travailleurs ; une affectation serveur les retire de la population représentée sans attendre leur promenade. Les positions et visites ne sont pas persistées individuellement et ne consomment pas d'énergie supplémentaire. Les effectifs des chantiers observés restent représentés entièrement. L'aspect des portes et la fluidité prolongée restent à recetter.

## Bois renouvelable et premières récoltes (017)

`woodland_deposits` conserve 300 bois initial/maximal par bosquet, stock physique numérique avec fractions, stock réservé entier, période de repousse de base persistée (1 209 600 000 ms), curseur et état défriché. La croissance linéaire neutre revient de zéro au maximum en 14 jours ; météo et soleil n'ont pas encore d'effet économique. Une réservation seule ne réduit pas le stock physique. Une mission réserve au plus 100 bois, prend 10 minutes de travail divisées par 1 à 10 travailleurs, plus les deux transports à une seconde par case. Une mission active par village/bosquet ; plusieurs villages peuvent réserver simultanément.

Les missions utilisent `deposit_extractions.resource_code`, les cohortes et le worker existants. Ordre des verrous : village, pierre par UUID, bois par UUID, puis transitions métier locales. Avant réconciliation, les bosquets ciblés, dus, voisins du snapshot et nécessaires à la construction sont verrouillés. `woodland_stock_at` projette les coupes physiques dues de tous les villages par échéance/ID et intègre la repousse entre elles. La matérialisation marque ces débits via `wood_debited_at`, sans créditer ni libérer les cohortes étrangères. Les crédits, libérations et accomplissements de notre village restent mêlés aux constructions/Jardins/pierre par échéance/ID/type. Aucune notification existante n'est modifiée ; le scheduler acquitte seulement sa tâche.

`resource_deposits` est une vue de lecture pierre/bois, jamais une cible de mutation. Dans une commande, sa projection utilise H conservé dans une configuration transactionnelle ; hors commande, elle utilise `statement_timestamp()`. Les stocks publics restent entiers, mais `blocksCell` compare le stock physique exact au seuil de 10 %, pour éviter qu'un arrondi de 30,1 à 30 rende la case libre. Les chemins vers les bosquets sont calculés à la demande ; les snapshots réutilisent les chemins de missions actives.

À ≤10 %, occupation libérée et repousse conservée tant que la case reste inutilisée. Défrichage public dans la portée/protection existante : instantané, sans récompense, suppression du reliquat non engagé et arrêt permanent de repousse ; les lots engagés sont livrés normalement. Une construction autorisée sur la case libérée arrête également la repousse dans sa transaction. Ni libération ni défrichage n'étendent les droits de construction.

La première récolte positive de Jardin inscrit `first-harvest` au moment du crédit ; la première livraison de bois inscrit `first-woodcut`. Unicité monde/village/code, date de l'échéance, aucun bonus ni backfill déduit des stocks. Crédit et entrée du journal partagent le rollback. Les notifications de l'Oracle restent une présentation.

## Chantiers d’exploitation persistants (018–020, en validation)

`extraction_worksites` stocke l’ordre, son plafond simultané et son état ; `extraction_worksite_targets` conserve les cibles et le franchissement du seuil. Les lots restent dans `deposit_extractions`, avec une référence nullable au chantier : les anciens lots et crédits ne sont pas réécrits. Le serveur borne un ordre à 64 cibles et un village à 8 chantiers ouverts, avec un seul lot engagé par chantier. Les nouveaux départs se font à la borne serveur réelle, après les commandes manuelles ; les échéances engagées sont réconciliées avant admission. Une tâche de réveil distincte et versionnée relance les attentes sans navigateur et rend les anciennes tâches inoffensives.

La matière bois est débitée au retour. `materializeWoodland` plie les retours dus à leurs propres dates, enregistre la première traversée du seuil sur les cibles déjà admises, puis poursuit la repousse. Un défrichage faisant partie du lot engagé est appliqué à cette date, même si pause/arrêt intervient entre départ et retour. La projection étrangère ne crédite et ne libère jamais les cohortes d’un autre village. L’interface reçoit l’état autoritatif et affiche le gain seulement après livraison. Cette tranche est en validation ciblée ; voir la spec et le handoff pour les preuves et limites restantes.
