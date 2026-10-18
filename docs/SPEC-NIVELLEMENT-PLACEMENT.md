# Nivellement préalable à la construction

Décisions Tristan du 18 octobre 2026. Implémentation et vérifications locales achevées ; recette utilisateur acceptée pour débloquer les joueurs. Publiée sur alpha et staging sous les tags `alpha-2026.10.18.5` et `staging-2026.10.18.5` (commit `2674375`), migration et contrôles publics réussis. Le parcours pourra encore être amélioré.

## Périmètre validé

L’Université et le Tailleur de pierre proposent un chantier lorsque leur emprise est libre mais non plane. La hauteur cible automatique équilibre déblais et remblais. Après les travaux, le joueur construit manuellement.

Barème confirmé, révisé par Tristan le 19 octobre 2026 : **1 minute de travail d’un habitant par case et par quart d’unité de hauteur déplacé**, divisée par l’effectif, avec la fatigue habituelle. Cette réduction remplace les cinq minutes de la version publiée ; elle est disponible localement, pas encore déployée. Pelouse/terre : aucune pierre consommée ni produite. Pour les autres sols, Tristan indique 100 pierres brutes excavées/remblayées par case.

RC1 expose les sols secs libres comme pelouse/terre ; les rochers sont des obstacles/gisements à extraire, pas une seconde catégorie de sol constructible. Cette tranche prépare les emprises libres sèches sans débit/crédit de pierre. Le barème des autres sols est conservé pour une tranche qui les rendra modifiables ; il n’est pas implémenté ici. Arbres, gisements, eau, voies et équipements restent hors emprise. Pas d’outil libre, de modification hydraulique ni de construction automatique.

## Aperçu et parcours

Une fonction partagée vérifie toutes les hauteurs de l’emprise : écart maximal d’un centième d’unité, comme la règle serveur existante. Le client normalise les coordonnées sur le tore et refuse une hauteur non chargée. Une emprise libre non plane devient orange : un clic sur la carte ouvre directement « Préparer le terrain », en figeant l’ancre et l’orientation choisies jusqu’au retour ou au lancement. Les obstacles restent rouges.

Le devis serveur présente l’emprise, le temps total avec aller-retour, le coût et les boutons illustrés 1/2/3 habitants. Le changement d’effectif recalcule le devis ; aucune interrogation périodique ne fait clignoter sa mise en page. Un résultat de commande inconnu conserve son identifiant pour rejouer la même demande.

Le chantier réserve ses cases, visibles par des contours orange et des piquets. Les habitants rejoignent son périmètre, travaillent puis reviennent. La fin autoritaire applique le relief et libère l’équipe ; les animations ne déclenchent aucune mutation économique.

Le déplacement visuel retire les détours collinéaires qui retracent une partie du passage validé, sans couper les angles ni modifier le trajet économique. Les terrassiers quittent la voie avant sa zone de dégagement pour rejoindre des postes distincts au bord du chantier.

## Calcul et protections

Chaque case fournit 8 × 8 échantillons de même aire. La hauteur commune est leur moyenne ; le volume déplacé est la somme des écarts absolus à cette hauteur. Seule la durée finale est arrondie à la milliseconde. Le devis est recalculé à la validation et comprend une empreinte des échantillons, de la demande et du trajet.

Les règles de construction protègent portée du village, clairières, occupations, eau, arbres, gisements, infrastructures et passages engagés de tous les villages du monde. Le devis vérifie aussi que le sol final reste sec, que les fondations voisines gardent leur hauteur et que les accès existants et celui du futur bâtiment restent praticables. Le trajet des habitants évite l’emprise. Construire ou démarrer un autre chantier contre le bord d’un chantier actif attend sa fin : une fondation nouvelle ne peut ainsi être affectée par un devis antérieur.

## Persistance et transactions

Migration additive `047_leveling` : `leveling_jobs`, affectation exclusive `population_cohorts.leveling_job_id`, type temporaire `leveling-site`, notification `leveling.complete` et signalement SSE. Demande, devis, équipe, trajet et échéances sont persistés pour le rejeu et les redémarrages.

Une feature représente le chantier avec plusieurs occupations. Les projections et caches graphiques distinguent ses localisations par `(id, x, y)`. La navigation commerciale, les itinéraires locaux et l’installation de nouveaux joueurs respectent ces réservations. Les chemins des terrassiers rejoignent les passages protégés.

Ordre des verrous : village, navigation, gisements et économie. Si un village possède un chantier actif, `beginVillageEconomy` choisit le verrou de navigation exclusif avant les gisements et avant sa borne temporelle. Le commerce à deux villages fait ce choix après avoir verrouillé les deux villages, avant sa borne partagée. Aucune promotion tardive de verrou partagé.

La fin participe à la liste chronologique des transitions. Elle écrit les hauteurs dans `world_spawn_terraces`, retire les occupations et libère les habitants dans la même transaction. Les déclencheurs invalident navigation et chunks. La réconciliation n’acquitte aucune notification ; le scheduler acquitte uniquement sa tâche.

## Vérifications

Régression de l’aperçu constatée rouge avant correction, puis verte. Tests purs du calcul, du tore et des hauteurs inconnues. Intégration RC1 dans `127.0.0.1/arbestra_test` : devis, double validation retenue derrière un verrou PostgreSQL observé, réservation, rejeu, énergie, fin unique, rollback après écritures prouvées, terrain persisté et construction manuelle finale. Tests des cellules du chantier dans le cache et des habitants visibles. Résultats définitifs et recette navigateur dans `SESSION-HANDOFF.md`.
