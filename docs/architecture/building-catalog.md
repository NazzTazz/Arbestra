# Catalogue de bâtiments

`building_types` décrit un type stable ; `building_type_levels`, ses niveaux, durées, coûts et productions. Ajouter un type connu ne nécessite pas de modifier le schéma. `CONSTRUCTION_DURATION_MS` remplace temporairement les durées du catalogue en développement/test seulement.

Stratégies fermées :

- progression : `vertical`, `spatial`, `fixed-footprint` ;
- production : `none`, `direct`, `buffered`.

`buildings` est l’instance métier. `building_cells` est son emprise : une cellule `anchor`, puis éventuellement des cellules `extension`. Une extension réservée pendant un chantier appartient déjà au même bâtiment.

Les limites d’instance sont validées transactionnellement. La Scierie est limitée à une instance par village et protégée aussi par un index unique partiel. Le Jardin n’est pas une entité spéciale : c’est un bâtiment `spatial + buffered`, avec une action de récolte exposée par le domaine village.

Le client lit libellés, niveaux, coûts et productions depuis le catalogue renvoyé par l’API ; il ne recalcule pas les règles.
