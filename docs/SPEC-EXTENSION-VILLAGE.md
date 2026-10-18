# Extension progressive du village

Décision Tristan du 18 octobre 2026, base `809c85b`. Tranche clôturée : implémentation, validations locales et recette de Tristan achevées ; commit `50955d4` poussé sur `main`, SHA distant vérifié. Aucun déploiement alpha/staging demandé dans cette clôture.

La construction reste progressive, avec une portée de **8 cases** (distance maximale sur les deux axes du tore) depuis chaque case d’un bâtiment terminé. Toute l’emprise du nouveau bâtiment doit être à portée. Les extensions encore en chantier ne donnent pas de portée supplémentaire ; le HDV en amélioration conserve sa portée. Le kit de départ partage ce rayon.

Le rectangle initial de 64 × 64 cases devient un minimum de présentation, sans plafond d’extension. Le serveur calcule un rectangle torique contenant les emprises du village et une marge de 16 cases pour l’exploitation. Chaque axe utilise l’intervalle circulaire le plus court, limité uniquement à la taille du monde pour éviter les doublons. Les dimensions accompagnent les tableaux de terrain, les ressources, la navigation et le nivellement. Les commandes RC1 lisent le terrain réel de la cible, indépendamment de ce rectangle ; les règles de portée, occupations et protections restent autoritaires.

La connaissance locale s’étend à 16 cases des emprises terminées appartenant au joueur dans le monde, en plus de la zone initiale et des lieux reconnus. La portée d’exploitation existante reste à 16 cases, avec un trajet praticable et les protections habituelles. Charger un terrain ou le connaître n’accorde pas de droit de construction.

Le réseau local part de l’emprise physique du HDV identifié et affine les accès sur la région courante, au lieu du carré historique de 32 cases de rayon. Le repli fin après échec de la grille grossière suit cette même région ; ses budgets de recherche restent bornés. Les cibles lointaines reconnues conservent leur trajet externe.

Validation : portée 8/9, campus et extension, coutures X/Y, projection agrandie, construction réelle au-delà de l’ancien bord, refus hors portée, connaissance locale et devis de nivellement RC1 éloigné. Le rectangle reste une projection dense : son coût augmente avec l’étendue du village ; cette tranche ne refond pas le protocole en projection clairsemée. Résultats effectifs dans le handoff.
