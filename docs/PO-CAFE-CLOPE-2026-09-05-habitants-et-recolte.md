# Quinze habitants, du café et des carottes

Version product owner. Compagnon de la [spec pour Terra](./SPEC-TERRA-2026-09-05-habitants-et-recolte.md).

> Ce document décrit la tranche initiale. La [direction produit consolidée](./DIRECTION-PRODUIT.md) porte les évolutions futures : repas automatiques liés à l'humeur, croissance par petits groupes et limite de couchages. Elles ne sont pas encore livrées ; la durée de récolte d'une minute reste un réglage de POC.

## Ce qu'on construit

Le village accueille quinze habitants. Ils arrivent en forme, avec dix points d'énergie chacun. L'Hôtel de ville offre trente places pour dormir : on a donc de la marge. Une maison terminée ajoute cinq places, mais personne ne surgit spontanément du plâtre frais. L'arrivée de nouveaux habitants attendra une autre tranche.

Quelques petits bonshommes se promènent. Le serveur compte des groupes d'habitants partageant le même état ; le joueur voit un village qui vit. On ne calcule pas les pas de dix-huit millions de personnes en base de données.

Chaque groupe garde son village d'origine, distinct de son rattachement actuel. On prépare ainsi les histoires futures sans fabriquer aujourd'hui des prisonniers, des capitaines et des arbres généalogiques.

## Le rythme de vie

| Situation | Énergie |
|---|---|
| Disponible, il vaque à ses occupations | Dix points consommés en 22 heures |
| Il travaille | Un point consommé par heure |
| Il dort | Deux points récupérés par heure |
| Il mange une carotte | Un point récupéré |
| Il combat, plus tard | Quatre points consommés par heure |

À zéro, il se repose jusqu'à dix. Ensuite, il reprend son affectation si elle existe ou redevient disponible. Une carotte aide à tenir, mais ce n'est pas une autorisation de supprimer le sommeil : deux points alimentaires maximum, puis cinq heures de vrai repos continu pour remettre ce quota à zéro.

Le repas, son ciblage et le repos volontaire ont encore un petit choix d'interface à confirmer, plus bas. Rien ne mangera automatiquement le stock sans qu'on ait décidé cette règle.

## Le trésor de la mairie

Dans le menu de l'Hôtel de ville, une réserve attend qu'on la découvre : **2 000 carottes**. Elles ne sont pas encore disponibles pour nourrir qui que ce soit. On fouille, on trouve, elles rejoignent le stock.

Une seule fois. Ouvrir dix onglets ne transforme pas la mairie en distributeur de légumes. Les carottes déjà présentes dans la partie sont conservées ; la réserve cachée vient en plus.

## Le moment important : le pitit bonhomme

Le Jardin a dix parcelles actives ? Il faut dix personnes pour le récolter.

La proposition est de mobiliser les dix ensemble pendant une minute. Elles vont dans le champ, récoltent et reviennent avec leur chargement. Les carottes arrivent dans le stock **au retour**, pas au clic. On voit dix récolteurs, un par parcelle.

Le contenu du Jardin serait mis de côté au départ pour ce voyage. Pendant ce temps, de nouvelles carottes continuent de pousser. On ne récolte donc pas deux fois le même panier et on ne perd pas les suivantes.

Actualiser la page à mi-chemin ne téléporte ni les légumes ni les gens : on retrouve la récolte en cours. Si une extension termine entre-temps, elle sert à la prochaine récolte ; on ne réclame pas soudain un onzième travailleur au milieu du champ.

## Quatre petites cases à cocher avant de lâcher Terra

Ces points sont des recommandations, pas des règles décidées à ta place :

1. **Tout le Jardin ou rien pour commencer.** Dix parcelles demandent dix personnes ; s'il n'y en a que neuf de disponibles, on explique pourquoi le départ est impossible. On réserve les carottes au départ. Pas d'annulation ni de récolte partielle pour cette version.
2. **On part avec assez d'énergie pour tenir la minute.** On évite qu'un récolteur s'endorme à mi-parcours et transforme la petite tranche en gestion de relève.
3. **On garde les bouts de fatigue.** Une minute de travail ne coûte pas un point entier, mais soixante récoltes ne sont pas gratuites. Le serveur conserve cette progression même si la jauge reste graduée de zéro à dix. Cela peut créer davantage de groupes que onze : on ne triche pas en fusionnant des gens qui n'ont pas la même fatigue.
4. **Repas et repos par commandes collectives simples.** Choisir combien de personnes disponibles mangent une carotte chacune ou partent se reposer. Arbitrage du 7 septembre : ils se réveillent dès qu'ils atteignent dix d'énergie ; ceux qui sont exactement pleins restent disponibles. Une sieste courte ne restaure pas le quota alimentaire : il faut cinq heures continues pour cela. Pas de repas automatiques pour cette première version.

## Ce qui attend dehors

Les bosquets et la pierre restent pour la tranche suivante. On n'oublie pas le travail collectif, le bois qui repousse, la pierre qui disparaît et le défrichement depuis le bord des îlots. On construit d'abord les habitants capables d'y aller.

Même attente pour la caserne, les prisonniers nostalgiques, les naissances et le maire avec un prénom. Les déplacements des figurants restent une animation locale ; on ne démarre pas un simulateur de circulation piétonne.

## Comment tu diras « accepté »

Tu ouvres ton village : quinze habitants, trente couchages. Tu trouves les 2 000 carottes dans l'Hôtel de ville. Tu lances une récolte sur dix parcelles : dix petits récolteurs travaillent, tu peux actualiser la page, ils reviennent et le stock augmente une seule fois. Les habitants ont passé une minute à travailler, et le Jardin a continué à produire.

Pendant ce temps, les tests vérifient qu'une seconde requête ou un autre onglet ne fabrique ni habitants ni carottes. La seule ressource dont cette tranche ne promet pas de limiter la consommation, c'est le café du product owner.
