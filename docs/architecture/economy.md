# Économie

## Déplacements liés aux travaux (016)

Pour les nouvelles récoltes de parcelles et extractions de pierre, le trajet aller-retour s'ajoute au travail sur place : une seconde par case parcourue dans chaque sens, puis 60 secondes au Jardin ou `600 secondes / travailleurs` à la pierre. L'itinéraire et `transport_ms` sont figés sur la mission au départ ; une construction ultérieure ne décale pas sa fin. Le crédit et la libération des travailleurs restent atomiques à l'échéance totale. Les missions antérieures à 016 conservent leur échéance et ont un trajet vide avec un transport nul. Les temps montrés pour choisir l'effectif d'extraction incluent le transport.

Les routes partent de l'ancrage du village, passent par des cases cardinalement adjacentes et peuvent faire des détours pour contourner les occupations ou rejoindre un tracé partagé. Le terrain et les occupations sont lus côté serveur ; pour un gisement hors du viewport jusqu'à 128 cases, le calcul lit un corridor de chunks et d'occupations du monde. Au-delà, un trajet torique cardinal direct préserve la portée mondiale des commandes : son contournement du terrain reste à traiter dans une tranche de navigation à grande distance. La surcouche de carte est une aide de débogage, sans autorité économique.

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

La récolte du Jardin cible une coordonnée canonique, verrouille cette parcelle, la matérialise et réserve ses unités entières pour un travail sur place d'une minute avec un habitant, auquel s'ajoute le transport défini ci-dessus. Le stock village est crédité à l'échéance, dans la même transition qui termine la récolte et libère la cohorte affectée. La parcelle repart immédiatement de zéro avec son reliquat conservé et continue donc de produire pendant le travail et le trajet ; ses voisines ne changent pas. L'unicité partielle des trajets actifs par `(world_id, cell_x, cell_y)` et le verrou village empêchent une double réservation. Les trajets antérieurs à la migration 015 gardent leur crédit, leur échéance et leur reçu global.

La migration 015 verrouille les villages dans l'ordre monde/UUID, puis lit sa borne commune avec `statement_timestamp()`. Elle matérialise l'ancien producteur à chaque construction/extension échue dans l'ordre échéance/ID/type, en appliquant le plafond avant chaque agrandissement, puis à la borne finale. Elle répartit ensuite le stock entier par quotient/reste dans l'ordre canonique des coordonnées et place le reliquat exact sur la dernière parcelle. Stocks villages, trajets globaux et notifications existantes restent inchangés. Après la bascule, les anciens buffers Jardin sont des archives passives : seule `garden_plots` produit les nouvelles carottes. La [recette historique](../REVIEW-2026-09-07-JARDINS.md) décrit le défaut corrigé le 30 septembre.

Cette correction de 015 concerne ses prochaines exécutions. Une base ayant déjà appliqué l'ancienne version conserve ses parcelles ; ne pas rejouer la répartition sur leurs stocks et ne pas créditer une perte historique impossible à attribuer exactement.

## Accomplissement du coffre (014)

`village_accomplishments` conserve le journal autoritatif du village, unique par `(world_id, village_id, code)`. Pour `town-hall-supplies`, l'insertion de l'accomplissement, la réclamation de `building_hidden_supplies` et le crédit de 2 000 carottes partagent la transaction et la borne économique du village. Le verrou village sérialise concurrence et retry ; un accomplissement existant retourne l'état courant sans second crédit. La migration reprend les coffres déjà réclamés à leur date sans toucher aux stocks. Les notifications et le texte de l'Oracle restent une présentation sans autorité économique.


## Exploitation de pierre (012)

`stone_deposits` conserve I initial, R restant et S engagé. Disponible = R−S ; réservation Q=min(100,R−S), puis à échéance R−=Q, S−=Q et stock village stone+=Q dans la même transaction. La réservation garantit le lot malgré les travaux adverses. Pas de flux automatique stone. Les quantités sont des entiers sûrs dans les contrats.

Verrous : tâche déjà acquise (worker seulement) → un village → tous les gisements dus et la cible éventuelle, triés par UUID canonique → métier local. Cet ensemble est préparé avant réconciliation ; ne jamais attendre un second village ni une notification existante après un gisement. `beginVillageEconomy` garde H lu après le verrou village, même après attente d’un gisement. Construction, extension, Jardin et pierre restent mêlés par échéance, ID, type. Les opérations atomiques d’extraction supposent cet ensemble préverrouillé.

`population/work.ts` partage énergie, sélection, split et libération. Aucun membre doublement affecté ; un reste positif sous un point ne déclenche pas de repos à la libération. Les quantités publiques sont l’état mondial matérialisé identifié par révision ; une lecture ne réconcilie que son village.
