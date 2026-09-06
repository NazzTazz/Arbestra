# Économie

Les stocks joueurs sont des `bigint` entiers : aucune fraction de planche ou de carotte n’est visible ni dépensable. Les coûts sont entiers ; le coût théorique 112,5 de la Scierie niveau 3 est arrondi explicitement à 113.

Les taux sont des `numeric` exacts. Chaque flux conserve un reliquat fractionnaire `[0,1[` et un curseur temporel :

- `village_resource_flows` pour la production directe vers un stock ;
- `building_resource_buffers` pour une production interne plafonnée.

Une lecture sans transition due projette `stock entier + floor(reliquat + taux × temps)` sans écrire. Une commande qui dépense, récolte ou change un taux matérialise d’abord jusqu’à sa borne PostgreSQL, puis conserve le nouveau reliquat.

Toute opération économique verrouille d’abord la ligne du village. Sa borne est lue avec `statement_timestamp()` après ce verrou, puis toutes les constructions et extensions dues sont appliquées par `(échéance, identifiant, type)`. Un worker peut donc détenir sa tâche via `SKIP LOCKED` puis attendre le village ; il ne verrouille jamais les autres tâches pendant la réconciliation.

Invariant de développement : dans une même transaction, `village → verrous métier` ; ressources et buffers sont parcourus par `resourceCode`, les réservations de cellules par `(cellX, cellY)`. La réconciliation et les commandes ne verrouillent, n'acquittent ni ne modifient une notification existante. Seul le scheduler acquitte ou replanifie sa propre tâche, déjà verrouillée avant le village. L'insertion d'une nouvelle notification de construction est permise sans unicité pending sur son sujet (migration 009). Le contexte de `beginVillageEconomy()` reste dans sa transaction ; commande et snapshot réutilisent sa borne, y compris pour une transition de durée nulle. À état initial, événements et borne finale identiques, l'ordre de découverte des échéances ne doit pas changer le résultat économique.

Valeurs initiales :

- bois 2000, carottes 50 ;
- bois naturel 60/h ;
- Scierie : 60, 108, 194,4 bois/h aux niveaux 1–3 ;
- Jardin : 60 carottes/h et 600 de capacité par cellule active ; 50 bois par cellule construite.

La récolte du Jardin verrouille le buffer, le matérialise et réserve ses unités entières pour un trajet d'une minute. Le stock village est crédité à l'échéance, dans la même transition qui termine la récolte et libère les cohortes affectées. La production survenue pendant le trajet reste dans le buffer. Deux récoltes concurrentes ne peuvent ni réserver ni transférer les mêmes unités.


## Exploitation de pierre (012)

`stone_deposits` conserve I initial, R restant et S engagé. Disponible = R−S ; réservation Q=min(100,R−S), puis à échéance R−=Q, S−=Q et stock village stone+=Q dans la même transaction. La réservation garantit le lot malgré les travaux adverses. Pas de flux automatique stone. Les quantités sont des entiers sûrs dans les contrats.

Verrous : tâche déjà acquise (worker seulement) → un village → tous les gisements dus et la cible éventuelle, triés par UUID canonique → métier local. Cet ensemble est préparé avant réconciliation ; ne jamais attendre un second village ni une notification existante après un gisement. `beginVillageEconomy` garde H lu après le verrou village, même après attente d’un gisement. Construction, extension, Jardin et pierre restent mêlés par échéance, ID, type. Les opérations atomiques d’extraction supposent cet ensemble préverrouillé.

`population/work.ts` partage énergie, sélection, split et libération. Aucun membre doublement affecté ; un reste positif sous un point ne déclenche pas de repos à la libération. Les quantités publiques sont l’état mondial matérialisé identifié par révision ; une lecture ne réconcilie que son village.
