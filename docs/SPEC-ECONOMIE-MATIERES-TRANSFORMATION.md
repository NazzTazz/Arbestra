# Économie — matières brutes et transformation

Date : 6 octobre 2026. Base relue : `main`, `3648eab` (tranche graphique du tailleur de pierres). Statut : **implémentée et validée dans le worktree**. Migrations 031–033 appliquées sur test puis au village de développement autorisé ; preuves et limites de recette dans [SESSION-HANDOFF.md](../SESSION-HANDOFF.md). Le complément du 6 octobre réserve le bois brut aux maisons en troncs, construction et amélioration. Aucun commit/push demandé pour cette tranche.

## 1. Intention et arbitrages

**Demandé par Tristan :** une tranche économie distinguant bois et pierre bruts, bois d’œuvre et pierre taillée, intégrant le tailleur de pierres. Son apparence et son intégration décorative dans Construire → Production sont déjà validées. Cela ne valide pas les rendements, les coûts ou une mécanique de travail.

**Proposition de cette spec :** deux transformations par lots, réalisées par des habitants ; stocks communs au village ; commandes finies ; premiers ateliers constructibles avec des matières brutes ; premières dépenses raffinées dans les nouvelles habitations et les améliorations de scierie.

Décisions **validées par Tristan le 6 octobre** :

| Décision | Recommandation précise |
|---|---|
| Travail et cadence | Commandes de 1 à 20 lots ; 25 matières brutes → 20 raffinées ; 10 minutes de travail par lot avec un habitant, réparties entre les habitants ; sans qualification obligatoire. |
| Bois gratuit | Arrêter le revenu naturel de 60 bois/h et la production passive des scieries à la bascule. La coupe des bosquets devient la source renouvelable. |
| Premiers usages | Appliquer les substitutions de la section 5 aux nouvelles habitations et améliorations de scierie ; conserver les coûts de voirie pour cette tranche. |
| Transition du village existant | Garder les stocks bruts ; commencer les stocks raffinés à zéro ; activer le tailleur déjà posé sans paiement rétroactif, sans travail automatique. |
| Nombre de scieries | Plusieurs scieries autorisées dans chaque village, sans limite d’instances propre au type. |

Les recommandations de fonctionnement, coûts et transition ci-dessous sont validées par ces réponses. L’application au développement est autorisée après validation sur test. Aucun commit/push de cette nouvelle tranche n’a été demandé.

## 2. Résultat joueur

Le joueur coupe du bois ou extrait de la pierre, voit ces matières arriver dans les stocks bruts, puis demande à une scierie ou au tailleur de les transformer. La fiche affiche le rendement, la quantité commandée, les habitants nécessaires, la durée du prochain lot et la raison d’un arrêt. Le résultat rejoint le stock raffiné du village à l’achèvement du lot.

Un exemple avec un habitant : demander deux lots de pierre taillée consomme 25 pierres brutes au départ ; dix minutes plus tard, vingt pierres taillées sont créditées. Le second lot consomme alors 25 autres pierres brutes, s’il reste des matières et un habitant apte. Sinon l’ordre attend une reprise explicite. Une nouvelle habitation peut utiliser le résultat.

Le jeu ne confond jamais « stock disponible », « matière déjà engagée dans un lot » et « résultat encore en fabrication ». Aucune animation ne crédite de ressource.

## 3. Existant vérifié et écarts

Cette section décrit la base relue avant implémentation. Les sections suivantes fixent les règles de la tranche désormais livrée.

Sources : migrations `004_world_economy_foundation.ts` et `030_stonemason_catalog.ts` ; modules `villages/economy.ts`, `villages/reconcile-economy.ts`, `villages/infrastructure.ts`, `population/work.ts` et `deposits/stone-extractions.ts` sous `apps/api/src` ; [architecture économique](architecture/economy.md).

- Les stocks sont génériques dans `village_resources`. `wood` et `stone` existent ; les ressources publiques sont des entiers. Les carottes et les buffers de Jardin restent indépendants.
- Le bois possède un flux naturel de 60 unités/h. La scierie ajoute une production directe de bois de 60, 108 ou 194,4 unités/h suivant son niveau, sans intrant ni habitant affecté. Remplacer seulement son libellé créerait donc du bois d’œuvre gratuitement.
- La coupe et l’extraction réservent les matières dans les gisements ; le crédit au village intervient au retour. Cette séparation physique/économique reste inchangée.
- Le tailleur actuel est décoratif, niveau 1, une instance par village, non constructible par la voie publique du catalogue. Son installation gratuite passe par une exception DEV. Il ne produit rien.
- Les affectations communes couvrent récolte, extraction et science. Leur éligibilité, énergie, fractionnement des cohortes et libération existent ; aucune affectation de transformation n’existe encore.
- La réconciliation ordonne les achèvements construction, expansion, récolte, extraction et science. Une fin de lot devra rejoindre ce même ordre.
- La voirie consomme actuellement de la pierre brute, avec une réserve fractionnaire prépayée : une pierre vaut 256 unités d’infrastructure. Ses reçus et annulations ne doivent pas changer implicitement de matière.

## 4. Ressources et fabrication proposées

### Stocks

| Code | Libellé | Entrée dans le stock |
|---|---|---|
| `wood` | Bois brut | Retour de coupe ; stock brut historique conservé. |
| `stone` | Pierre brute | Retour d’extraction ; stock brut historique conservé. |
| `timber` | Bois d’œuvre | Achèvement d’un lot de scierie. |
| `cut-stone` | Pierre taillée | Achèvement d’un lot du tailleur. |

Les codes historiques ne sont pas renommés. Ajouter deux types et deux stocks à zéro par village, y compris dans la création des futurs villages. Ne pas transformer le stock historique en ressource raffinée. Les unités sont des unités de jeu, pas une mesure de masse ; aucune capacité d’entrepôt nouvelle dans cette tranche.

### Recettes et capacités

| Atelier | Entrée par lot | Sortie par lot | Travail | Maximum d’habitants |
|---|---|---|---|---|
| Scierie niveau 1 | 25 bois bruts | 20 bois d’œuvre | 10 minutes-habitant | 1 |
| Scierie niveau 2 | Identique | Identique | Identique | 2 |
| Scierie niveau 3 | Identique | Identique | Identique | 3 |
| Tailleur niveau 1 | 25 pierres brutes | 20 pierres taillées | 10 minutes-habitant | 3 |

Avec `n` habitants, durée = `ceil(600000 / n)` millisecondes. Le niveau augmente le nombre de postes, pas le rendement matière. Les habitants demandés doivent tous être disponibles et aptes à terminer le lot ; aucun remplacement silencieux par une équipe plus petite. La recette et la durée d’un lot démarré sont figées. Il n’y a ni sortie fractionnaire ni crédit partiel.

### Cycle d’une commande

Une commande choisit un nombre entier de lots (1–20) et un nombre d’habitants. Un seul ordre non terminal par atelier ; pas de file supplémentaire. Chaque lot reçoit un identifiant propre et un numéro dans l’ordre.

1. **Démarrage :** atelier achevé, équipe et matière du premier lot disponibles ; affecter l’équipe et débiter exactement les intrants de ce lot dans la même transaction. Un refus initial ne crée ni ordre ni débit. Ne pas réserver les matières des lots futurs.
2. **Fabrication :** habitants occupés jusqu’à l’échéance, énergie suivant les règles communes. Pas de trajets ni de transport simulés pour ce travail sur place : matières et sorties utilisent le stock abstrait du village. Ce raccourci appartient au périmètre validé.
3. **Achèvement :** créditer la sortie une seule fois, matérialiser l’énergie et libérer l’équipe à cette échéance. Si l’ordre continue, réévaluer immédiatement les intrants et l’éligibilité pour le lot suivant à cette même date ; réutiliser les mêmes habitants s’ils sont aptes. Une relève n’est choisie qu’à la reprise explicite.
4. **Blocage :** faute de matière ou d’équipe apte, aucun nouveau débit ; libérer les habitants et garder le nombre de lots restant. Afficher `missing-input` ou `missing-workers`. Une livraison ultérieure ne relance pas automatiquement l’ordre : « Reprendre » réévalue à la borne de la commande.
5. **Pause :** pendant un lot, demander l’arrêt après ce lot. Il termine normalement ; les lots restants sont conservés. À l’arrêt, reprendre peut modifier l’effectif. Ne pas remettre à zéro un travail en cours.
6. **Annulation :** pendant un lot, terminer ce lot puis supprimer les lots non commencés ; aucune restitution des matières transformées. À l’arrêt, annuler immédiatement les lots restants. Pas de destruction d’un lot déjà payé et pas de remboursement permettant un double crédit.

États exposés : `running`, `pause-requested`, `cancel-requested`, `paused`, `blocked`, `completed`, `cancelled`, avec motif de blocage séparé. La raison terminale et les résultats restent consultables. L’effectif peut changer à la reprise, jamais pendant le lot engagé. L’amélioration du bâtiment attend la clôture de l’ordre ; le joueur le termine ou l’annule d’abord. La priorité entre ateliers est l’ordre chronologique des transitions, puis ID et type, sans priorité cachée du tailleur.

Le serveur poursuit les lots disponibles hors connexion, jusqu’au maximum commandé. Il ne fabrique jamais avant le démarrage de l’ordre, ni pendant une période bloquée avant une reprise. Les lots bornés évitent une boucle de rattrapage infinie.

## 5. Construction, usages et démarrage

| Action nouvelle après bascule | Coût validé | Durée validée |
|---|---|---|
| Construire la scierie niveau 1 | 50 bois bruts, coût actuel conservé | 60 s, durée actuelle conservée |
| Construire le tailleur niveau 1 | 50 bois bruts + 25 pierres brutes | 60 s |
| Améliorer la scierie niveau 2 / 3 | Remplacer le bois du coût catalogue par du bois d’œuvre, quantité inchangée (actuellement 75 / 113) | Durées catalogue conservées |
| Construire une habitation | Troncs : 25 bois bruts ; madriers : 25 bois d’œuvre ; pierre : 25 bois d’œuvre + 10 pierres taillées | Durée catalogue conservée |
| Améliorer une habitation | Troncs : 300 bois bruts ; madriers/pierre : 300 bois d’œuvre au niveau 2 ; pas de supplément pierre ajouté à cette amélioration | Durée catalogue conservée |
| Jardin, autres bâtiments, infrastructure et braseros | Recettes actuelles conservées | Règles actuelles conservées |

Ces substitutions sont un premier barème, à recetter ; aucune conversion universelle des recettes. Les devis et commandes utilisent les coûts autoritaires du catalogue. Un devis antérieur à la bascule est refusé comme périmé si ses coûts diffèrent ; le joueur revoit le nouveau prix. Les reçus déjà admis restent rejouables sans nouveau débit.

Le premier tailleur ne demande pas de pierre taillée, la première scierie ne demande pas de bois d’œuvre : pas de dépendance circulaire. Conserver les dotations initiales actuelles, dont le bois brut ; pas de cadeau raffiné. L’extraction de pierre reste accessible avant le premier tailleur. Vérifier ce parcours sur un village neuf avec la population réellement disponible, pas seulement un seed riche.

Le tailleur devient constructible dans **Construire → Production**, avec devis, délai, emprise 2 × 2, rotation et limites d’occupation existantes. Maintenir une instance de tailleur par village et le seul niveau 1 ; supprimer la limite d’instances des scieries, y compris l’index unique historique. Supprimer l’accès gratuit décoratif une fois la voie économique activée ; ne pas laisser une commande DEV contourner le prix. Le modèle validé est conservé, avec présentation des travaux via les mécanismes existants.

La voirie raffinée est une suite explicite : elle nécessitera de versionner la matière de réserve et les reçus avant toute substitution. Dans cette tranche, `stoneReserve`, les coûts et les remboursements restent adossés à `stone`. Ni les routes ni les maisons existantes ne changent d’apparence en fonction du stock.

## 6. Bascule et compatibilité

Prévoir une bascule économique explicite par village, enregistrée et idempotente, dans le chemin transactionnel existant. La migration ajoute les structures et la nouvelle configuration ; elle ne doit pas appliquer rétroactivement une cadence nouvelle à un ancien curseur. La réconciliation utilise la configuration historique pour les villages non basculés.

Sous verrou village et à une borne `H` :

1. Réconcilier les transitions historiques dues et matérialiser le flux de bois historique jusqu’à `H`, avec les règles de production anciennes.
2. Conserver le bois brut entier acquis et son reste numérique historique. Fermer le flux passif à `H` sans convertir ce reste en intrant raffiné ; le conserver comme reliquat dormant pour audit. Aucun arrondi ni crédit de fraction entière inventée.
3. Activer les recettes de transformation, mettre les deux stocks raffinés à zéro s’ils n’existent pas et enregistrer la bascule. Aucun ordre n’est créé automatiquement.
4. Conserver les bâtiments, niveaux, occupants, missions, réservations de gisements, infrastructure et reçus. Le tailleur décoratif déjà achevé devient un atelier disponible, sans débit rétroactif. Une scierie existante conserve son niveau mais doit recevoir un ordre pour travailler.

Les constructions et améliorations déjà engagées conservent leur paiement et leur échéance. Une scierie achevée après la bascule ne réactive aucun flux passif. Les anciennes missions livrent toujours leur ressource brute. La création d’un nouveau village utilise directement les nouvelles règles et marque sa version économique ; aucune fenêtre de bois gratuit.

Tester spécialement une bascule après une longue absence et un achèvement de scierie antérieur à `H`. Changer le catalogue global avant de matérialiser les anciens flux serait une perte de crédits : garder une lecture explicite de l’ancienne recette jusqu’à la fin de la bascule. L’application au développement est autorisée après validation sur test.

## 7. Serveur, données et contrats

Extension locale du monolithe, sans nouveau service ni bus :

- Recettes versionnées au catalogue : intrants, sorties, travail et nombre de postes par type/niveau. Les lots figent leur version et leurs quantités ; un changement de barème ne les réécrit pas.
- Ordres et lots persistés avec `world_id`, `village_id`, `building_id`, état, effectif, quantité demandée/achevée et échéances. Unicité d’ordre non terminal par bâtiment ; unicité de numéro de lot par ordre ; un lot terminé ne peut plus débiter/créditer.
- Affectation de transformation intégrée à `population/work.ts`, aux contraintes d’exclusivité et à tous les chemins de libération/repos/éligibilité. Un habitant ne peut pas simultanément scier, récolter, extraire ou étudier. Pas de population artisanale parallèle.
- Commandes authentifiées démarrer/pause/reprise/annulation, identifiant de commande idempotent et payload comparé au reçu. Un même ID avec un autre payload est refusé. Propriétaire et monde contrôlés à chaque commande. Les détails d’atelier et aperçus utilisent les mêmes règles d’éligibilité que l’admission.
- Contrats `packages/contracts` : stocks et recettes, état d’ordre/lot, travailleurs affectés, échéance et motif d’arrêt, devis autoritaire. Les champs historiques `wood` et autres raccourcis restent des alias du stock brut tant que des consommateurs les utilisent ; ne pas y injecter les ressources raffinées.

Chaque commande et snapshot passent par `beginVillageEconomy()`, verrouillage village puis borne `statement_timestamp()` après acquisition. Intrants, sortie, cohortes, reçu et état renvoyé sont atomiques dans cette transaction et à cette borne. Réutiliser l’ordre de verrous métier existant ; les gisements dus/cibles restent verrouillés par UUID canonique avant toute transition. Aucun verrou sur un second village après un gisement.

Les achèvements de transformation rejoignent les transitions dues par échéance, ID et type. Si un achèvement démarre un autre lot déjà dû à `H`, le réinsérer dans l’ordre global des événements, avec les événements déjà présents ; ne pas vider tous les lots d’un atelier avant les retours d’extraction intercalés. Exemple obligatoire : lot fini à 10:00, retour de pierre à 10:05, lot fini à 10:10 ; respecter cet ordre et les matières effectivement disponibles à chaque admission. Si le lot à 10:00 bloque, le retour à 10:05 ne le redémarre pas sans commande.

Ajouter une notification de fin de lot au scheduler existant. Worker : tâche `SKIP LOCKED` → village → métier. Les notifications anciennes ne prouvent pas un travail dû. Commandes et réconciliation n’acquittent ni ne modifient les notifications existantes ; elles peuvent créer celles des nouveaux lots. Le scheduler ne finalise que sa tâche acquise. Préserver l’exception d’unicité `building.complete` de 009. Pas de `SERIALIZABLE` global.

## 8. Interface et rendu

Le HUD distingue les quatre matières par libellé et icône, plus les carottes. Le détail du stock explique sa provenance ; un rendement potentiel d’atelier n’est pas affiché comme un revenu passif garanti.

La fiche de scierie/tailleur permet de choisir lots et effectif, présente entrée/sortie totales prévues et coût immédiat du prochain lot, puis affiche progression datée du serveur et lots restants. Sur blocage : matière manquante ou habitants inaptes, avec reprise explicite. Pendant une fabrication, « Pause après ce lot » et « Annuler après ce lot » annoncent l’effet réel.

L’aperçu local ne décide ni du coût ni des crédits. Les piles de pierres et le brasero du modèle restent décoratifs ; aucune pierre du mesh ne devient une entité persistante. Cette tranche exige un parcours navigateur fonctionnel, mais pas de nouveaux gestes animés ou de transport de matériaux.

## 9. Hors scope proposé

Qualifications et apprentissage artisanal, Université transmettant un savoir-faire, commerce/importations, entrepôts et logistique, files d’ordres, production perpétuelle avec réveil automatique, nouvelles ères, usure, transformation automatique des maisons historiques, autres différenciations de coûts par matériau, nouveaux niveaux du tailleur et reconception graphique de la scierie. L’ajout validé de 10 pierres taillées à la maison en pierre fait partie de cette tranche.

La [direction artisanale de l’infrastructure](SPEC-INFRASTRUCTURE-VOIRIE-ATELIER.md) reste une perspective. Cette proposition choisit une première transformation par habitants ordinaires ; elle ne prétend pas livrer l’artisan qualifié ni les importations décrits dans cette direction.

## 10. Preuves requises et acceptation

Cette grille décrit les résultats attendus. Les exécutions achevées, reprises ciblées et limites de recette sont consignées dans le handoff ; elle ne constitue pas un compte de tests.

| Cas | Résultat observable attendu |
|---|---|
| Un lot, deux snapshots avant/après échéance | Entrée débitée au départ ; sortie nulle avant, crédit exact après ; relecture et notification répétée ne changent plus rien. |
| Intrants insuffisants / équipe déjà occupée | Aucun débit, affectation ni premier ordre admis ; explication cohérente entre aperçu et commande. |
| Deux lots, matières pour un seul | Premier résultat acquis ; ordre bloqué, intrants restants intacts, habitants libérés ; livraison puis reprise démarre à la date de reprise. |
| Pause/annulation pendant le lot | Lot et échéance conservés, sortie créditée une fois ; aucun prochain débit ; reprise conserve les lots restant à faire. |
| Fatigue et fractionnement | Énergie commune exacte, population conservée, exclusivité avec Jardin/pierre/bois/sciences, aucun habitant bloqué après fin. |
| Hors connexion et événements intercalés | Même stock, énergie et dates finales qu’avec des lectures fréquentes ; pas de démarrage avant livraison ou avant reprise. |
| Deux commandes concurrentes | Barrières bornées forçant l’attente PostgreSQL ; un seul ordre admis ou stock suffisant pour chaque débit ; aucune double affectation. |
| Rollback injecté après débit et affectation | Prouver ces écritures avant l’erreur identifiée, puis comparer stocks, ordres/lots, cohortes, reçus et tâches après rollback. |
| Rejeu, autre propriétaire et autre monde | Même commande rejouée sans double débit ; payload différent refusé ; accès croisés refusés sans mutation. |
| Migration/bascule répétée | Stocks historiques et reliquats conservés ; crédit passif exact jusqu’à `H` seulement ; raffiné zéro, aucun cadeau au second passage. |
| Bâtiments/missions déjà engagés | Échéances et coûts historiques conservés ; scierie tardivement achevée sans production gratuite ; retour livré brut. |
| Ancienne voirie et annulation | Réserve prépayée conservée ; remboursement dans la matière brute d’origine ; aucun crédit raffiné. |
| Village neuf | Coupe/extraction → premiers ateliers bruts → premiers lots → habitation raffinée, sans blocage circulaire. |
| Navigateur | Construction du tailleur, ordre, progression, pause, manque d’intrants, reprise et consommation raffinée lisibles ; pas d’erreur console. |

Validation proportionnée : tests de calcul/contrats, intégrations PostgreSQL pour temporalité/bascule/atomicité et entrelacements ; suites économiques et population connexes, puis lint/typecheck/build et recette navigateur du parcours modifié. Les suites DB partageant la même base de test restent séquentielles. Aucun reset de développement.

Acceptation : les quatre décisions de la section 1 sont incorporées sans ambiguïté ; les quatre stocks sont distincts ; aucune matière raffinée sans intrants et travail ; aucun double crédit ni perte de progrès ; ancien village préservé ; un nouveau village peut démarrer ; preuves achevées et limites restantes consignées dans le handoff.

## 11. Ordre d’implémentation après arbitrage

1. Fixer barème et usages ; ajouter catalogue/contrats et structures conservatrices avec scénario de bascule testable.
2. Réaliser les lots et affectations communes ; prouver débit/crédit, énergie et rollback.
3. Intégrer réconciliation chronologique et scheduler ; prouver rattrapage, idempotence et concurrence.
4. Activer construction économique du tailleur, substitutions de coûts et bascule ; prouver compatibilité historique et démarrage neuf.
5. Brancher HUD/fiches, recetter le parcours navigateur, corriger et documenter les règles effectivement livrées.

Ces étapes bornent le travail autorisé ; l’implémentation et l’application au développement après validation sur test ont reçu le feu vert de Tristan.
