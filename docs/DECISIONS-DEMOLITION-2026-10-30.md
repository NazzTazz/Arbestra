# Démolition — décisions du 30 octobre 2026

Complète [SPEC-DEMOLITION.md](SPEC-DEMOLITION.md), écrite sur la branche `refactor/hud-infrastructure` et encore absente de cette branche. Ces décisions tranchent ses points ouverts et proposés ; elles seront reportées dans la spec à la fusion.

## Décisions de Tristan (validées)

1. **Routes et braseros : démolition instantanée**, à l'admission de la commande, sans durée. Les bâtiments gardent la règle du dixième.
2. **Équipe** : 3 villageois disponibles et reposés, choisis comme pour le nivellement ; durée indépendante de l'effectif ; sans villageois disponible, refus explicite, sans file d'attente.
3. **Ressources stockées perdues** (tampons, lots en cours) : un **avertissement à côté de l'annulation**, sans blocage ni confirmation supplémentaire.
4. **Dormeurs** : ils restent couchés pendant le chantier et sont **réveillés à l'achèvement**, pas à l'admission.
5. **Braseros automatiques** : le balayage les supprime aussi.
6. **Jardins fusionnés** : seules les **parcelles touchées** sont supprimées, pas le jardin logique entier.
7. **Annulation** possible jusqu'à l'achèvement, idempotente, sans coût ni restitution.

## Organisation

- Le serveur de la démolition est implémenté dans la session de la synchronisation V2, après la sous-tranche 5c (voirie sans `state()`), directement en V2 : journal, snapshot, lectures bornées.
- Le client (geste, marques, fiche) reste sur la branche `refactor/hud-infrastructure`.
- Ordre : 5a (exploitation avec jardins) → 5c (voirie) → démolition serveur → 5b (nivellement).
