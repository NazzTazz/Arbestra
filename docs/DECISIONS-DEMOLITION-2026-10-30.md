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
8. **Commande mixte** : routes et braseros disparaissent à l'admission ; les bâtiments de la même commande gardent leur chantier.
9. **Dormeurs à l'achèvement** : réveillés, ils redeviennent disponibles avec l'énergie récupérée jusque-là ; ils ne sont pas recouchés dans une autre maison.

Côté client (branche `refactor/hud-infrastructure`) : l'avertissement du point 3 et le marquage des braseros automatiques du point 5 (`demolition-selection.ts` ne marque aujourd'hui que les braseros manuels).

## Organisation

- Le serveur de la démolition est implémenté dans la session de la synchronisation V2, après la sous-tranche 5c (voirie sans `state()`), directement en V2 : journal, snapshot, lectures bornées.
- Le client (geste, marques, fiche) reste sur la branche `refactor/hud-infrastructure`.
- Ordre : 5a (exploitation avec jardins) → 5c (voirie) → démolition serveur → 5b (nivellement).

## Révision du 31 octobre (Tristan, validée)

- **Démolition immédiate pour toutes les cibles**, bâtiments compris, à l'admission de la commande : pas de durée, pas de chantier, **aucun villageois mobilisé**. Remplace la règle du dixième et les points 1, 2, 4, 7, 8 et 9 ci-dessus.
- **Filet contre l'erreur côté client** : après **Démolir**, un délai d'annulation (sur le modèle des 15 s du défrichage) avant l'envoi de la commande ; une fois envoyée, plus d'annulation serveur.
- Les dormeurs d'une maison démolie sont relogés immédiatement par la réallocation des lits existante.
- Inchangés : aucun remboursement, avertissement des ressources stockées perdues (point 3), braseros automatiques supprimés par le balayage (point 5), seules les parcelles touchées d'un jardin fusionné (point 6), hôtel de ville jamais démoli.
- Conséquence technique : ni table de chantier, ni tâche du worker, ni route d'annulation, ni entité V2 nouvelle ; une commande V2 idempotente qui publie les suppressions.

## Ajustements du 31 octobre (Tristan, validés)

- Délai d'annulation de **10 s** ; affichage réduit à un bouton **Annuler** comme pour le défrichage.
- L'ordre en attente persiste à travers les changements de mode du HUD.
- Les outils « Pas de route » et « Retirer » (éclairage) sont retirés de la palette Infrastructure : Détruire les remplace.
