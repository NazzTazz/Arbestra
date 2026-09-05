# Économie

Les stocks joueurs sont des `bigint` entiers : aucune fraction de planche ou de carotte n’est visible ni dépensable. Les coûts sont entiers ; le coût théorique 112,5 de la Scierie niveau 3 est arrondi explicitement à 113.

Les taux sont des `numeric` exacts. Chaque flux conserve un reliquat fractionnaire `[0,1[` et un curseur temporel :

- `village_resource_flows` pour la production directe vers un stock ;
- `building_resource_buffers` pour une production interne plafonnée.

Une lecture projette `stock entier + floor(reliquat + taux × temps)` sans écrire. Une commande qui dépense, récolte ou change un taux matérialise d’abord jusqu’au timestamp PostgreSQL de la transaction, puis conserve le nouveau reliquat.

Valeurs initiales :

- bois 2000, carottes 50 ;
- bois naturel 60/h ;
- Scierie : 60, 108, 194,4 bois/h aux niveaux 1–3 ;
- Jardin : 60 carottes/h et 600 de capacité par cellule active ; 50 bois par cellule construite.

La récolte verrouille le buffer, le matérialise, transfère ses unités entières au stock et le vide dans une transaction. Deux récoltes concurrentes ne peuvent pas transférer les mêmes unités.
