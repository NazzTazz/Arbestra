# Marché entre joueurs et parcours tactile

17 octobre 2026, transport précisé le 18 octobre · base relue : `main`, `d107ff2`.
Statut : **implémenté et validé localement ; publication alpha/staging autorisée par Tristan le 18 octobre**. Tristan a autorisé l’implémentation après confirmation de la réservation à la publication, de la restitution par annulation avant acceptation et de l’acceptation entière par un seul joueur. Migration appliquée en base test, puis en développement local après signalement du login le 18 octobre. État Git et résultats de déploiement dans le handoff courant.

## Résultat attendu et décisions de session

Le joueur entre au marché pour chercher une ressource. Le marché propose trois onglets : **Consulter les offres**, **Publier une offre**, **Mes offres**.

Les actualisations périodiques gardent la fiche stable : « Préparation du marché… » occupe un emplacement de hauteur fixe sous le titre, annoncé comme statut accessible. Une liste vide conserve la place de « Aucune offre » pendant la requête, en masquant son texte jusqu’à la réponse. L’apparition ou la disparition du chargement ne déplace donc ni les offres ni les convois.

Le parcours de publication est orienté besoin, avec une ressource recherchée contre une ressource offerte. Pas de paiement composé de plusieurs ressources dans cette première version.

1. Choisir la ressource recherchée parmi les représentations factory : bois brut, bois d’œuvre, pierre brute, pierre taillée et carottes. La sélection est la seule action de cet écran ; toucher une ressource avance.
2. Choisir la quantité recherchée sans clavier.
3. Choisir la ressource offerte et la quantité maximale consentie.
4. Afficher le récapitulatif avec le paramètre **Temps de trajet maximum** et les boutons **Retour** et **Valider**. Valider publie l’annonce ; ce n’est pas une recherche suivie d’une sélection automatique d’offre.

Les quantités utilisent de grands boutons tactiles aux paliers **50, 100, 250, 500, 1 000, 2 500, 5 000 et 10 000**. La sélection apparaît en grand avec le visuel factory et une courte animation. Les boutons **− / +** parcourent les mêmes paliers. Pour la contrepartie offerte, les paliers dépassant le stock disponible sont désactivés et **Tout mon stock** sélectionne le montant exact disponible. Ce choix peut donc être hors des paliers. Aucun clavier nécessaire. Le temps de trajet utilise une tirette crantée ; ses valeurs restent à fixer. Ces contrôles tactiles ont été explicitement acceptés par Tristan.

## Transport joueur : décisions du 18 octobre

- Trajet d’hôtel de ville à hôtel de ville, à **1 case par seconde**.
- Mobilisation de **1 habitant pour 250 ressources** transportées ; l’effectif doit couvrir les ressources à faire transiter à l’aller et au retour.
- Les villageois sont **visibles pendant leur déplacement**. Leur représentation suit la mission serveur ; l’animation ne déclenche aucun transfert économique.

Le joueur qui accepte fournit les porteurs et effectue l’aller-retour : il part avec la ressource recherchée par l’auteur de l’annonce, puis revient avec la contrepartie offerte. Les habitants sont mobilisés pendant toute cette boucle. Décision explicitement confirmée le 18 octobre.

L’effectif utilise la **charge maximale** des deux trajets, avec capacité réutilisée au retour : `ceil(max(quantité aller, quantité retour) / 250)`. Décision explicitement confirmée le 18 octobre. Exemples : 500 unités à l’aller et 250 au retour mobilisent deux habitants ; 250 et 251 en mobilisent également deux. Les mêmes porteurs assurent les deux trajets.

Raccord retenu pour l’implémentation et annoncé en session : trajet praticable entre les accès des hôtels de ville, sur le tore, via le solveur piéton existant. Le maximum est explicitement libellé **aller simple** dans l’UI. La ressource recherchée par l’annonce est créditée chez son auteur à l’arrivée ; la contrepartie réservée est créditée chez l’acceptant au retour, puis ses porteurs sont libérés. L’énergie doit couvrir toute la boucle selon les règles communes de population.

## Oracle

Les offres permanentes de l’Oracle apparaissent dans la consultation, avec des quantités variées : 50, 100, 250, 1 000, 2 500, 5 000, etc. La liste complète n’est pas encore fixée ; elle est distincte de la liste de paliers de saisie.

Une annonce joueur bénéficie de **10 minutes de priorité aux joueurs**. Ensuite l’Oracle l’accepte automatiquement si elle satisfait au moins son taux de change, avec **livraison instantanée**. L’attente avant acceptation est distincte du trajet. Le temps de trajet maximum s’applique au transport des échanges entre joueurs. Le récapitulatif annonce l’éligibilité à la reprise Oracle. Une offre non éligible reste disponible aux joueurs ; la durée de publication n’est pas fixée.

Le barème existant reste la référence : valeurs 1 pour les matières brutes, 1,5 pour les matières transformées, 0,25 pour les carottes, avec commission Oracle de 30 %. La nouvelle règle de reprise remplace pour les nouvelles annonces le transport Oracle de 10 minutes de la tranche précédente. Le traitement des anciens échanges Oracle déjà engagés doit préserver leurs quantités et échéances figées.

## Base vérifiée avant la tranche (`d107ff2`)

- `apps/world-web/src/ui/MarketPanel.tsx` : formulaire prototype Oracle, débit d’une quantité offerte contre une quantité calculée, confirmation et liste des livraisons. Aucun onglet ni annonce joueur.
- `packages/contracts/src/market.ts` : contrats Oracle et calcul bigint `oracleAmount()`, délai courant de 600 000 ms. La saisie actuelle porte sur la quantité offerte ; le nouveau parcours porte d’abord sur la quantité recherchée.
- `apps/api/src/modules/villages/market.ts` : catalogue Oracle, devis, commande idempotente, débit, échéance et livraison. Pas de transfert entre deux villages.
- Migration 034 : catalogue Oracle et `market_exchanges`, sans annonces joueur.
- `apps/world-web/src/scene/resource-factory.ts` : générateurs pierre brute, pierre taillée, bois brut, rondins et bois d’œuvre. Les rondins ne sont pas un stock commercial distinct ; aucune recette carotte dans cette factory.
- Le cache et renderer communs de miniatures acceptent les présentations de matières `resource:<code>` ; `BuildingThumbnail.tsx` fournit un composant d’affichage réutilisable. Pas besoin d’images IA pour ces modèles natifs.

La spec Oracle précédente décrit la tranche livrée : [SPEC-MARCHE-ORACLE.md](SPEC-MARCHE-ORACLE.md). Elle ne constitue pas une preuve de commerce joueur existant.

## Règles de la première version

- Réservation intégrale à la publication et restitution par annulation avant acceptation : **validé explicitement**.
- Acceptation entière par un seul joueur, sans fractionnement : **validé explicitement**.
- Le maximum choisi devient la quantité exacte affichée au récapitulatif et publiée. Le lot est accepté entier au prix annoncé, y compris par l’Oracle s’il est éligible ; pas de contre-proposition ou de remboursement d’un écart au tarif de référence.
- Les offres permanentes Oracle demandent une confirmation explicite : tarif exact arrondi au supérieur, débit et livraison immédiats, sans habitants. La priorité de dix minutes concerne les annonces publiées par les joueurs.
- Tirette : 30 s, 1, 2, 5, 10, 20, 30 et 60 minutes, valeur initiale dix minutes, borne aller simple. Quantités Oracle : mêmes paliers que la saisie tactile.
- Annonces ouvertes jusqu’à acceptation ou annulation ; plafond technique de vingt annonces ouvertes par village. Consultation paginée par cinquante, historique dans Mes offres.
- Pas d’acceptation par le village auteur ; les autres villages d’un même compte ne reçoivent pas d’exception commerciale particulière.

Les deux premières règles sont confirmées par Tristan ; les précisions de libellé, de bornes de sélecteur et de traitement du lot sont les choix de réalisation explicités ici. Monnaie, contre-propositions et fractionnement restent hors scope.

## Implémentation en worktree

Migration additive **044_player_market** : annonces, reçus idempotents, convois, livraisons locales et affectation exclusive `trade_journey_id`. Les ressources offertes quittent le stock disponible et restent réservées par l’annonce jusqu’à annulation ou engagement. L’acceptation débite le chargement aller et crée deux livraisons figées.

`trade-service.ts` prépare le trajet hors transaction économique via le worker de navigation, puis revalide sa révision sous le verrou de navigation. Les deux villages sont verrouillés par UUID canonique avant tout verrou métier. `beginVillageEconomy()` prépare l’union des gisements et bois des villages déjà verrouillés ; leurs réconciliations partagent une borne post-verrou. Aucune transition locale n’acquiert un autre village.

Reprise Oracle et livraisons rejoignent l’ordre commun date/ID/type. `trade.wake` relit l’état métier, le scheduler n’acquitte que sa tâche et les commandes ne modifient pas les notifications préexistantes. Les anciens `market_exchanges` conservent leur délai figé de dix minutes ; leurs routes restent compatibles.

Le snapshot expose les annonces ouvertes propres et les convois actifs du monde. Les échéances locales réveillent aussi la synchronisation SSE. Le rendu réutilise les figures des habitants, reconstruites sur les chemins et horaires serveur après rechargement, avec panier dans les deux directions. Aucune animation ne crédite les stocks.

Les miniatures viennent des générateurs factory ; une recette carotte complète les quatre matières. Hôtel de ville et réserves restent dans un volet repliable. La hauteur et la superposition du marché empêchent la palette d’exploitation de couvrir ses commandes.

## Invariants et périmètre technique

Préserver l’accès via hôtel de ville niveau 2 et les ressources du catalogue. Pas de monnaie, marché monétaire, armée, qualification commerciale ou système de transport général préventif.

Le serveur décide des quantités et autorisations. Isoler annonces, acceptations, stocks, commandes et tâches par `world_id`. Une acceptation concurrente ne peut engager deux fois la même annonce. Les commandes sont idempotentes, y compris si une réponse HTTP est perdue.

Les transactions entre villages prennent leurs verrous par UUID canonique avant les verrous métier. Les réconciliations préparent l’union des gisements des villages déjà verrouillés. Commande et snapshot utilisent une borne commune post-verrou. Les transitions locales n’acquièrent aucun autre village ; les notifications existantes restent intactes et le scheduler ne finalise que sa propre tâche. Les échéances Oracle rejoignent l’ordre chronologique existant.

Migration additive, conservation des échanges engagés et aucun reset de développement. Ne pas modifier le délai global de la tranche Oracle sans distinguer les anciennes livraisons des nouvelles annonces.

## Preuves requises avant livraison

- Tests métier sur publication, stocks/réservations selon décision, annulation, acceptation, reprise Oracle à dix minutes et crédits uniques.
- Transport : effectif sur charge maximale A/R, seuils 250/251, mobilisation exclusive pendant la boucle complète, vitesse d’une case/seconde et conservation des participants visibles.
- Concurrence forcée : deux acceptations d’une annonce et acceptation joueur face à reprise Oracle ; au plus un engagement économique.
- Isolation monde/propriété, retries exacts et payload réutilisé différent, rollback après écritures prouvées.
- Navigation réelle du parcours tactile, trois onglets, paliers et stock non multiple, retour conservant la saisie, visuels factory dont carottes, erreurs/retry, états de livraison.
- Contrôler les suites Oracle et économie connexes ainsi que les anciens échanges engagés.

## Vérifications observées le 18 octobre 2026

**90 tests distincts / 10 fichiers**, exécutés avec succès : marché joueurs 15, réveils SSE commerciaux 2, tarifs 3, rendu des habitants 29, affectations communes 2, cycle SSE 5, projections 4, couchages 6, marché Oracle historique 8 et transformations 16. Les répétitions ciblées ne sont pas ajoutées à ce compte. Les deux derniers fichiers connexes ont terminé ensemble avec 24/24 verts.

Deux acceptations concurrentes et une acceptation face à l’Oracle sont forcées derrière un verrou de village ; deux attentes PostgreSQL observées, barrières bornées et transactions attendues en `finally`. Rollbacks après écritures effectivement constatées et erreur injectée identifiée : stocks, réservations, annonces, convois, livraisons, notifications, cohortes, curseurs de production et marqueurs de synchronisation comparés. Trajet réel via le worker, normalisation des UUID et refus temporaire sans débit également vérifiés.

**Deux parcours navigateur réels verts**, Chrome desktop et Pixel 7 tactile : connexion, vrai clic hôtel de ville, cinq miniatures factory, paliers, stock non multiple, retour conservant le choix, récapitulatif, publication/réservation, annulation/restitution, achat Oracle instantané, annonce d’un second village, devis de trajet, départ, porteur effectivement activé dans le canvas, retour réel des ressources et libération de l’habitant. Aucune erreur JavaScript et aucun débordement horizontal. Mondes privés 128 × 128 pour le navigateur, 64 × 64 pour les tests métier ; aucun reset du développement.

Après les dernières finitions de disposition, revue `agent-browser` du composant réel sur une fixture visuelle isolée aux largeurs 393 et 1 280 px : grille des cinq ressources, quatre étapes sans clavier, retour en haut, boutons Retour/Valider alignés (157 × 48 px sur mobile), tirette déplacée physiquement au cran 20 minutes, captures relues. Cette fixture ne prétend pas valider un échange économique ; ceux-ci sont couverts par les deux parcours précédents. Fixture et navigateur supprimés/fermés après contrôle.

Migration 044 appliquée sur **`127.0.0.1/arbestra_test` uniquement**. Fixtures privées supprimées et fixture partagée restaurée. Builds contrats/API/monde et lint des sources verts ; typage des cinq projets du workspace vert. Le warning des gros chunks du monde demeure ; aucune certification de charge, de fluidité prolongée ou de budget p95. Pas de suite applicative globale revendiquée.

Code non commité sur `main`, base `d107ff2`. Aucune migration de développement, publication, livraison staging/alpha ou opération de production pour cette tranche.
