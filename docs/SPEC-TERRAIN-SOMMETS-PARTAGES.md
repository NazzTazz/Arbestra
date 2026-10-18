# Terrain de village à sommets partagés

18 octobre 2026 — base relue : `50955d4`. **Statut : proposition technique, non implémentée.** La demande porte sur un terrain dont les cases se raccordent par leurs coins, avec une hauteur par coin commune au rendu et aux règles. L’extension progressive à huit cases est livrée séparément.

## Résultat attendu et périmètre

Un coin déplacé modifie les surfaces de toutes les cases qui le partagent. Le sol visible, le placement, le nivellement, les accès et la hauteur des habitants utilisent la même surface triangulée. Les limites de chunks et la couture du tore ne créent aucune marche artificielle.

Conserver le parcours actuel : clic sur une emprise non plane, devis « Préparer le terrain », chantier avec habitants, puis construction manuelle. Cette tranche concerne le terrain RC1 de la vue village et ses consommateurs métier. Un outil de sculpture libre, une simulation d’écoulement d’eau, les murs de soutènement et une refonte du générateur régional sont hors scope.

**Décisions déjà validées :** terrain défini par ses coins ; chantier distinct avant construction ; hauteur automatique équilibrant déblais et remblais ; cinq minutes de travail par case et quart d’unité déplacé, divisées par l’effectif ; pas de coût en pierres sur pelouse/terre. La portée de huit cases demeure.

**Propositions de cette spec :** triangulation fixe, modifications persistées par sommet, raccord sur les cases voisines, comptabilisation du volume de ce raccord et activation par monde après audit. Le traitement d’éventuelles plateformes historiques incompatibles reste ouvert jusqu’au résultat de l’audit ; aucun déplacement de bâtiment ni changement de fondation n’est implicitement autorisé.

## Existant vérifié

- `packages/contracts/src/spawn-installation.ts` définit `SpawnTerrace` par case et `terraceHeight()` par appartenance à son carré fermé. Deux terrasses adjacentes peuvent donc imposer des hauteurs différentes au même bord.
- `apps/api/src/modules/worlds/rc1-ground.ts` combine le substrat généré et les terrasses ; les patches graphiques échantillonnent le substrat au demi-pas et transmettent les terrasses séparément.
- `apps/world-web/src/scene/rc1-terrain.ts` produit huit triangles par case ; une terrasse remplace leur hauteur et ajoute des flancs vers le substrat. `rc1Height()` possède sa propre interpolation graphique.
- `packages/contracts/src/leveling.ts` calcule aujourd’hui une hauteur moyenne et un volume approché par échantillons ; la planéité des snapshots utilise des hauteurs de centres de cases en centièmes.
- `apps/api/src/modules/villages/leveling.ts` réserve l’emprise, protège fondations et accès voisins, puis écrit `worldSpawnTerraces` en fin de chantier. Les devis et échéances sont persistants.

Passer à quatre coins et deux triangles par case change aussi le relief naturel entre les échantillons : ce n’est pas une simple substitution de mesh.

## Modèle géométrique commun

Une cellule conserve ses coordonnées entières et son rôle d’occupation. Le sommet entier `(vx, vy)` correspond au point `(vx − 0,5 ; vy − 0,5)` dans le repère actuel. La cellule `(x, y)` utilise les sommets `(x, y)`, `(x+1, y)`, `(x, y+1)`, `(x+1, y+1)`, tous canoniques modulo les dimensions du monde. Un monde de W × H cellules possède W × H sommets uniques, coutures comprises.

Une fonction partagée dans `packages/contracts` porte la normalisation, les sommets incidents, la triangulation et l’échantillonnage barycentrique. Diagonale proposée : coin `(x,y)` vers `(x+1,y+1)` pour chaque case, indépendante de la caméra et du chunk. Les hauteurs restent en unités métier ; le facteur graphique 2,5 s’applique uniquement à la projection Babylon. Définir une précision commune avant persistance et calcul des signatures ; éviter les arrondis différents côté client et serveur.

La hauteur naturelle d’un sommet vient du substrat signé à cette coordonnée ; une surcharge persistée la remplace. Les normales ou UV peuvent nécessiter des sommets graphiques dupliqués, mais leur position provient toujours de cette unique hauteur logique.

Un chunk de N × N cases transmet (N+1) × (N+1) hauteurs. Les bords sont dupliqués dans le transport, jamais dans l’autorité. Les éventuels halos pour normales sont bornés et canoniques. Inclure version du modèle et révision dans les clés du cache ; une ancienne réponse ne doit pas rétablir une géométrie périmée.

## Nivellement et voisins

Pour une emprise, réunir tous ses sommets, y compris ceux de l’intérieur. Les amener à une hauteur cible unique. Les sommets extérieurs restent inchangés ; les cellules incidentes aux sommets modifiés forment l’aire réellement affectée, au plus une couronne de cases autour de l’emprise. Montrer cette aire dans l’aperçu et la réserver pendant le chantier.

Calculer la hauteur cible qui annule le volume signé entre l’ancienne surface et la surface projetée sur toute l’aire affectée, raccord compris. Avec une triangulation fixe, chaque hauteur projetée est constante ou affine en la hauteur cible : l’équilibre se résout sans recherche itérative. Le volume travaillé est l’intégrale de la valeur absolue de la différence ; découper les triangles traversés par une différence de signe, sans facturer deux fois un sommet partagé. Appliquer ensuite le barème existant et l’arrondi final de durée. Ce calcul remplace l’échantillonnage approximatif, sans ajouter de coût en pierres aux sols actuellement admis.

Le devis refuse toute modification d’une fondation occupée, d’un accès protégé, d’un passage engagé ou d’une réservation concurrente. Un bord commun avec une fondation peut rester inchangé ; s’il doit bouger pour atteindre la hauteur cible, refuser avec un motif précis. Ne pas agrandir automatiquement le chantier jusqu’à trouver un raccord possible. La couronne doit respecter les droits d’aménagement ; une proximité géométrique ne donne aucun droit sur le voisin.

Le niveau d’eau reste inchangé. Vérifier les intersections avec l’eau sur les triangles affectés, pas uniquement au centre des cases. Conserver les refus actuels de nivellement en eau et de relief qui ferait entrer l’eau. Les règles de pente et les coûts de déplacement existants s’appliquent à la nouvelle surface commune.

## Persistance, commandes et invalidation

Migration additive : version du modèle par monde et table de surcharges à clé `(world_id, vertex_x, vertex_y)`. Garder le substrat et les terrasses historiques pour l’audit et la compatibilité ; après activation, toutes les écritures de terrain du monde, installation initiale comprise, passent par le modèle à sommets. Ne pas entretenir deux autorités géométriques concurrentes.

Le devis signe le modèle, les hauteurs de départ pertinentes, la cible, l’aire affectée et les accès. La validation recalcule sous les verrous métier actuels et réserve toute l’aire affectée. La fin de chantier écrit les sommets, libère les réservations et habitants, puis publie les révisions dans la même transaction. Préserver l’ordre village/métier, la borne temporelle après verrou, l’idempotence et la réconciliation existants.

Invalider tous les chunks incidents aux sommets changés, y compris aux coutures, et transmettre ces changements au mécanisme existant d’invalidation de navigation. Une invalidation limitée au chunk contenant la clé du sommet serait incorrecte. Ne pas reconstruire une seconde infrastructure générale de cache de chemins pour cette tranche.

Les consommateurs à basculer ensemble : champ RC1 serveur, installation initiale, planéité et aperçu de placement, nivellement, navigation fine et hiérarchique, patches terrain, sol/grille/picking client, ancrage des bâtiments et figurants. Les centres de cases peuvent rester une projection de compatibilité ; ils ne prouvent plus la planéité d’une emprise. Vérifier tous ses sommets avec une tolérance unique exprimée en unités métier.

## Conversion des mondes existants

Première étape : audit en lecture seule, rapport par monde. Énumérer les contraintes des plateformes et bâtiments existants sur chaque sommet ; détecter les hauteurs contradictoires sur les bords partagés. Comparer aussi les accès, routes et niveaux d’eau avant/après conversion. Deux plateformes contiguës de hauteurs différentes ne peuvent pas conserver toutes deux leur forme actuelle avec un seul sommet commun : ce cas doit apparaître dans le rapport, sans moyenne silencieuse.

Construire une conversion déterministe de tous les sommets contraints, puis vérifier les invariants sur la géométrie candidate. Ne pas activer un monde comportant un conflit non résolu. Le résultat de cet audit permettra de décider si une correction locale explicitement approuvée suffit ou si une compatibilité particulière est nécessaire.

L’activation ne doit pas réinterpréter un chantier ou trajet engagé. Prévoir une fenêtre contrôlée sans nouveaux travaux, achever les chantiers anciens selon leur contrat et contrôler les déplacements actifs avant bascule. La stratégie exacte d’activation dépend du rapport de compatibilité ; aucune conversion distante ni modification de devis engagé dans cette phase de cadrage. L’activation et les révisions doivent être atomiques. Un retour au modèle ancien après de nouvelles modifications de sommets demande une conversion inverse prouvée ; un simple changement de version ne suffit pas.

## Réalisation et preuves attendues

1. Audit de conversion et tests de la géométrie pure : tore, diagonale, interpolation, sommets intérieurs, intégrales de volume et raccords. Présenter les éventuels conflits réels avant de choisir leur traitement.
2. Persistance et champ serveur versionnés, puis conversion sur base de test. Préserver les anciens mondes tant que le chemin complet n’est pas prêt.
3. Basculer les consommateurs métier et le protocole de chunks ; prouver la parité entre le sol serveur et la hauteur graphique en plusieurs points de chaque triangle.
4. Adapter mesh, grille, picking et aperçu. Vérification navigateur sur terrain cabossé, raccord entre chunks et couture torique, campus, habitants et bâtiments voisins.
5. Régression PostgreSQL : deux chantiers aux emprises disjointes mais partageant un sommet ne peuvent pas modifier ce sommet concurremment ; entrelacement forcé avec attente observée. Prouver idempotence, fin unique, rollback après écritures et invalidation des deux côtés d’une frontière.
6. Recette : emprise orange non plane, devis conforme à l’aire visible, chantier, terrain raccordé, puis université constructible. Mesurer taille des patches et coût de génération sur un même parcours avant/après, sans annoncer un gain théorique comme mesuré.

Critère de clôture : mêmes hauteurs et mêmes refus entre aperçu et serveur, aucune fissure aux limites, aucun bâtiment voisin déplacé, aucune conversion silencieuse incompatible, parcours navigateur validé. Les tests et mesures restent à réaliser ; cette spec ne constitue pas une preuve de livraison.
