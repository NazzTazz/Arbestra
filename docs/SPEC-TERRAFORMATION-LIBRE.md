# Terraformation libre — 19 octobre 2026

Tranche autorisée par Tristan après discussion. Outil recetté positivement par Tristan le 20 octobre, tolérance de durée de 10 % intégrée et vérifiée. Première publication en staging : release `8f31f55`, tag `staging-2026.10.20.1`. **Désormais déployée en alpha et staging avec le HUD Population accepté**, sur confirmation explicite de Tristan le 20 octobre : release `a32c1fe`, tags `alpha-2026.10.20.2` et `staging-2026.10.20.2`. La restriction initiale à staging est levée. Preuves des publications dans le [handoff](../SESSION-HANDOFF.md). Développée depuis `main` / `d30fcfe`, avec le correctif des jardins publié dans la même release. Cette tranche étend le [nivellement](SPEC-NIVELLEMENT-PLACEMENT.md) sur les mondes RC1 à [sommets partagés](SPEC-TERRAIN-SOMMETS-PARTAGES.md), sans convertir les mondes historiques.

## Décisions validées

- Outil Terraformation dans la palette Constructions, avec sa grille, sans entrée supplémentaire dans les modes principaux. Un pinceau d'une case prélève la hauteur sous le premier appui, arrondie au quart de case. Cet appui initie le swipe : les deux triangles jaunes apparaissent immédiatement depuis les données du terrain rendu, sans requête ni attente de snapshot. Le glissement étend la même sélection ; les swipes suivants ajoutent des cases au même devis, sans double facturation. Le calcul complet des raccords ne bloque pas le geste initial.
- Une hauteur unique pour tout le devis. Boutons −/+ et flèches bas/haut : pas de ¼ de case pour toute la sélection.
- Le premier relâchement ouvre une fiche latérale du côté opposé à l'origine, stable pendant le devis et laissant la carte interactive. Raccourcis 5/20/50 habitants, coût éventuel en pierre, durée, Annuler et Valider. Un effectif disponible inférieur à cinq reste sélectionnable.
- Aperçu des deux triangles de chaque case à leur hauteur future : origine jaune, sélection gris clair, raccords moins opaques ; obstacles en rouge. Les quatre coins d'une case peinte prennent la cible ; la couronne incidente fait partie du chantier et du volume travaillé.
- Annuler retire tout le devis ; Valider engage le chantier après contrôle autoritaire. Pas de modification immédiate du terrain, ni de construction automatique.
- Décision après recette du 19 octobre : les reliefs très abrupts sont conservés. Une nouvelle fondation ne peut pas être construite sur leurs flancs : tous les coins de son emprise doivent être plans selon la tolérance existante de 0,01 unité. Maison, scierie et autres bâtiments suivent cette règle en aperçu et à la commande, même sur une seule case. Le sommet plat reste constructible sous les autres conditions habituelles ; jardins et voies continuent d’épouser le sol. Aucun déplacement ni retrait des bâtiments déjà posés.
- Calcul local pendant les gestes et changements d'effectif. Aucun appel de devis par swipe. Partage du calcul de volume, de durée de travail et des coûts entre client et serveur.

## Admission et limites explicites

Le trajet local est une estimation géométrique signalée comme telle. Le serveur certifie le chemin réel des habitants, relit terrain, droits, occupations, aménagements et énergie sous les verrous village/navigation existants. Il recalcule le devis entier. Si seuls le trajet et la durée totale diffèrent, une variation de durée totale de ±10 % du devis client, bornes incluses, est acceptée sans second clic : 20 secondes estimées et 21 ou 22 secondes serveur engagent directement le chantier à la durée serveur. Travail, terrain, emprise, hauteur, signature et coûts restent strictement identiques. Au-delà de cette tolérance ou pour toute autre différence, le devis autoritaire demande un clic de confirmation, avec rollback de la transaction précédente ; aucune réservation ou affectation n’est conservée. Le transport aller-retour est compris dans la durée confirmée. Le nivellement préalable à un bâtiment conserve sa comparaison stricte.

Un résultat réseau inconnu conserve exactement la commande et son identifiant, y compris en sessionStorage pour une reprise après fermeture de la fiche/rechargement. Rejouer une commande admise ne crée aucun second chantier ; réutiliser son identifiant avec une autre demande est refusé.

Barème inchangé : 60 secondes de travail par case et quart de hauteur déplacé, volume exact des triangles et raccords, divisé par l'effectif. Les sols actuellement admissibles sont pelouse/terre : zéro pierre consommée ou produite. Les arbres, gisements, eau, fondations, voies, équipements, passages engagés et réservations restent protégés. Un tracé est limité techniquement à 256 cases sélectionnées par chantier ; les coordonnées sont canoniques sur le tore. La couronne doit également être libre et à portée.

## Réalisation

`terraforming.ts` porte les contrats et le calcul partagé. `vertexLeveling` accepte une hauteur explicite et jusqu'à cinquante habitants pour ce mode ; le nivellement préalable à un bâtiment conserve sa cible équilibrée et ses trois habitants maximum. `POST .../terraform` renvoie soit un devis corrigé, soit le snapshot après admission.

Les chantiers utilisent `leveling_jobs`, leurs notifications, affectations et achèvements existants. Migration additive 049 : élargissement de la contrainte d'effectif de 3 à 50, conservation des données. Les missions antérieures gardent leurs paramètres et échéances. Aucune nouvelle simulation hydraulique ou tarification de sols rocheux.

## Vérifications

Calcul pur : cible explicite, quarts de hauteur, effectifs, doublons, raccords et couture torique. PostgreSQL : devis local/autoritaire, refus sans mutation sur divergence, reprise exacte, effectif de 50, achèvement unique et persistance des sommets ; suites du nivellement existant. Navigateur : swipe, fiche latérale, second swipe, touches/boutons, zéro requête de devis pendant l'édition, annulation, mobile et aperçu triangulé. Résultats et réserves courants dans le handoff.
