# Mock-up UI — habitants, Hôtel de ville et récolte

Ce document est destiné au product owner qui réalise l'interface React/HUD. Il ne prescrit pas une structure de composants ni du CSS. Les appels ci-dessous sont livrés par l'API. Le backend renvoie le snapshot après chaque commande ; le client remplace son état avec cette réponse puis l'actualise à l'échéance affichée.

## Barre village

```text
┌──────────────────────────────────────────────────────────────────┐
│ Bois 2 000   Carottes 50     Habitants 15 / 30                    │
│                             5 disponibles · 10 au Jardin          │
└──────────────────────────────────────────────────────────────────┘
```

Afficher `population.total`, `population.housingCapacity`, `population.available` et les compteurs d'activité. Les cohortes restent techniques : le joueur voit des effectifs, pas « cohorte 4f7… ».

## Menu Hôtel de ville

Avant découverte :

```text
Hôtel de ville
30 couchages · 15 habitants

Un vieux coffre est dissimulé dans les réserves.
[ Fouiller les réserves ]
```

Après succès : toast « 2 000 carottes découvertes », stock mis à jour, puis :

```text
Réserves fouillées
Le coffre est vide.
```

Appel : `POST /api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/discover-supplies`.
Le serveur renvoie `VillageState`. Un 409 `SUPPLIES_ALREADY_DISCOVERED` signifie que l'autre onglet est passé avant : recharger le snapshot et afficher l'état vide, sans erreur agressive.

## Panneau Habitants

```text
Habitants
15 / 30 couchages
Disponibles 5 · Au travail 10 · Au repos 0

Énergie : ██████████ 15
          █████████░  0
          ...

[ Faire manger… ] [ Envoyer au repos… ]
```

Les deux boutons ouvrent un choix d'effectif borné par le serveur. Le client n'envoie pas une liste de cohortes, une énergie ni une quantité de carottes décidée localement.

Repas : `POST /api/worlds/:worldSlug/villages/:villageId/population/feed` avec `{ commandId, count }`.
Repos : `POST /api/worlds/:worldSlug/villages/:villageId/population/rest` avec `{ commandId, count }`.

Le client crée un UUID `commandId` au clic et le conserve pour rejouer exactement la même requête après une réponse perdue. Un nouvel essai intentionnel crée un nouvel UUID seulement après résolution du précédent. La réponse est un `VillageState`; les 409 métier affichent le message serveur : effectif indisponible, énergie déjà pleine, quota alimentaire atteint ou carottes insuffisantes.

## Menu Jardin

Avant départ :

```text
Jardin · 10 parcelles actives
100 carottes prêtes
10 habitants nécessaires · 5 disponibles

[ Récolter — 1 min ]   désactivé si l'effectif/énergie manque
```

En cours :

```text
Récolte en cours
10 récolteurs · retour dans 00:34
100 carottes en transit
```

Terminé : le prochain snapshot fait disparaître l'action ; le stock de carottes du village comprend la réservation créditée une seule fois. Une extension achevée pendant la minute n'altère pas les dix récolteurs déjà partis.

Appel : `POST /api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/harvest` avec `{ commandId }`. Réponse : `VillageState`. Le client ne calcule ni le buffer à réserver ni le nombre requis ; il désactive l'action tant que `garden.harvest` est présent.

## Actualisation et scène

`serverTime` sert à afficher le compte à rebours et à positionner la phase visuelle Babylon. Prévoir une actualisation après `garden.harvest.completesAt`, puis en cas de retour d'onglet/focus. Un refresh pendant l'action charge la récolte persistée : il ne doit ni créer une nouvelle commande ni redémarrer l'animation.

La couche Babylon reçoit le snapshot enrichi. Les figurants sont décoratifs : aucun clic sur eux et aucune logique économique dans une animation. La scène montre un figurant par cellule de la récolte active, dans la limite de cette tranche. Elle anime l'aller-retour à partir des timestamps serveur, et recrée seulement ce petit groupe lorsque la récolte change.
