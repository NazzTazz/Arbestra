# Université, science et connaissance du monde

Socle implémenté dans le worktree le 3 octobre 2026 ; [spec produit et réglages](../SPEC-UNIVERSITE-SCIENCES-DECOUVERTE.md). Première représentation du campus acceptée par Tristan puis intégrée pour recette humaine : terrain 5 × 6 herbeux, trois départements, sept arbres décoratifs, six braseros nocturnes au niveau 3. La composition est commune au jeu et à l'atelier ; capacités scientifiques inchangées. Extensions médicales, militaires, météorologiques et topologiques hors scope.

## Autorité et temps

Migration additive 025 : catalogue Université, `player_science`, programmes, contributions, activités, lieux relevés, rapports datés et qualification cartographe des cohortes. Toutes les clés scientifiques comportent le monde ; la connaissance et les programmes appartiennent au joueur dans ce monde. Le campus apporte des centres et une capacité locale, sans conférer de maîtrise scientifique.

Les commandes passent par `POST /api/worlds/:worldSlug/villages/:villageId/science`. Authentification et ownership précèdent `beginVillageEconomy()`. Après le village et les verrous de gisements existants, une ligne joueur/monde sérialise les contributions scientifiques. Aucune opération sous ce verrou ne prend un autre village. Une contribution mobilise uniquement les cohortes du village courant ; centres, effectifs locaux et plafond du programme sont vérifiés ensemble. Recherche, formation et missions réutilisent affectation/énergie/repos du système commun ; les qualifications survivent aux fragmentations et aux repas/repos.

Les échéances scientifiques rejoignent les transitions chronologiques de l’économie. `science.wake` réconcilie le village et admet de nouveaux lots ; le handler n’acquitte aucune notification. Seul le scheduler acquitte sa tâche. Les lots déjà engagés conservent leurs échéances ; les prochains commencent à la borne actuelle après les commandes manuelles. Progrès, pauses et réservations sont persistants. Les lots de recherche durent au plus une minute dans cette première réalisation ; leur travail s’exprime en millisecondes-personnes. Attente de preuves : limite théorique à 75 %, centres libérés, reprise sans préemption ni levée d’une pause.

## Parcours et observations

Un cartographe formé parcourt un itinéraire sur le terrain praticable réel, avec aller/relevé/retour dans son budget. Rapports intégrés uniquement au retour : cellules réellement visitées, lieu effectivement relevé, éventuel extérieur de village. Un rappel ne révèle pas le reste de l’objectif. Les implantations étrangères sont des rapports datés, sans flux de bâtiments ou d’occupations live. Les gisements connus restent actualisables ; le modèle scientifique ne change pas la règle de construction historique.

Géographie 1 ouvre les accès distants relevés et reconnus. `deposit-access.ts` revalide le chemin : avant Astronomie, accès empirique rapporté ; après, recherche des meilleurs trajets sur le graphe connu. Une mission engagée conserve son trajet et sa durée de travail. Le calcul de navigation est borné à 8 192 cellules examinées par demande, limite technique conduisant à proposer un objectif intermédiaire, pas nouveau rayon métier.

Les premières observations solaires commencent à l’achèvement de la première Université, persistent hors connexion et couvrent 24 heures. Le rapport mesure la géométrie déterministe commune à `contracts/cosmology`. Astronomie 1 apparaît après Mathématiques 3, Géographie 2 et cette campagne locale ; lancement spontané avec un habitant dès qu’un centre est libre, sans dépense matérielle automatique.

## Connaissance et représentation

Le snapshot comprend `science` et sa révision géographique. La carte serveur masque les cellules inconnues, y compris features, relief et occupancies. Les overviews partagés sont clonés puis masqués par joueur ; une maille agrégée partiellement connue ne révèle pas le reste. Les périmètres historiques des villages restent connus. Aucune découverte scientifique ne dévoile toute la surface.

Le client invalide les chunks masqués lors d’un nouveau rapport et recharge leur terrain complet. Il réutilise la représentation torique lors d’une mise à jour de connaissance pour éviter un reset caméra. Astronomie 1 change la borne de zoom, sans remplacer le repère local, la rotation ou la phase lumineuse. Boutons, molette, V, C et debug cosmologique respectent cette condition. Connexion/V adoptent un profil local, régional ou global issu de la connaissance ; la vue globale exige toujours Astronomie 1.

En développement uniquement, `?sciencePreview=1` et le header associé autorisent la recette visuelle complète. Ce contournement n’accorde aucune recherche et aucune autorisation métier ; le serveur ignore le header en production. Les cartographes visibles sont des représentants des missions serveur ; les animations ne créent aucune connaissance.

## Limites de première passe

L’objectif des expéditions utilise encore des coordonnées, avec reprise du gisement sélectionné. Le dessin détaillé des itinéraires et l’ergonomie des objectifs restent à recetter. La première composition factory est acceptée ; son intégration sur la carte et les monuments provisoires restent à recetter. Les mesures solaires complètes n’ont pas été attendues pendant 24 heures en navigateur : les transitions temporelles sont couvertes par les tests ciblés PostgreSQL. Voir le [handoff](../../SESSION-HANDOFF.md) pour les résultats effectivement exécutés.
