# Jardins — récolte par parcelle, fusion et agrandissement tolérant

Date : 7 septembre 2026. Base vérifiée : `master`, `b148f37`. **Statut : prête à implémenter.** Les décisions gameplay ci-dessous sont validées par Tristan ; les propositions de structure sont des recommandations techniques. Cette rédaction ne livre aucun code ni migration.

## Résultat joueur et décisions validées

- La parcelle, soit une cellule de la grille, devient l'unité de récolte. Un habitant éligible est envoyé par parcelle récoltée. Balayer quatre parcelles mobilise quatre habitants ; les autres continuent de produire.
- Une parcelle est récoltable dès qu'elle contient au moins une carotte entière. Un symbole au-dessus d'une parcelle pleine signale la saturation ; il ne conditionne pas la récolte.
- Un clic sur une première parcelle, puis maintien du clic et déplacement, lance les récoltes des parcelles traversées dans l'ordre du passage. Une parcelle n'est comptée qu'une fois par geste.
- Si les habitants éligibles viennent à manquer, les départs déjà acceptés continuent et les parcelles suivantes restent intactes. Un retour discret explique le manque. Aucun départ différé automatique lorsque des habitants se libèrent.
- Deux Jardins du même village contigus par un côté fusionnent automatiquement. Les diagonales seules ne fusionnent pas. Une construction ou extension ne relie les Jardins qu'à l'achèvement de ses parcelles ; les trajets déjà partis continuent normalement.
- Lors d'un agrandissement, le rectangle peut recouvrir des parcelles de Jardin existantes du même village. Elles sont conservées sans être refacturées ni reconstruites. Seules les nouvelles cases constituent le chantier. Les bâtiments d'un autre type, arbres, gisements et possessions étrangères restent des obstacles.
- L'aperçu distingue les parcelles existantes, les ajouts et les obstacles ; coût et surface à construire concernent seulement les ajouts. Exemple : passer d'une case à un rectangle de 3 × 2 ajoute cinq cases et coûte 250 bois avec le catalogue actuel.

La direction graphique générale prend Age of Empires IV comme référence. Les marqueurs de saturation et le geste de récolte prennent Elvenar comme référence d'UX. Cette tranche adapte les Jardins à ces intentions ; elle n'engage pas une refonte artistique générale ni la copie d'assets.

## Existant prouvé par lecture

Les références décrivent l'existant, pas la cible :

- `apps/api/src/modules/population/garden-harvest.ts` : `startGardenHarvest()` demande autant d'habitants que de cellules actives, vide le buffer global, réserve les carottes et crée un trajet de 60 secondes. Une seule récolte active par bâtiment est admise. `completeGardenHarvestAt()` crédite les carottes réservées et libère les habitants.
- `apps/api/src/modules/villages/economy.ts` et `service.ts` : buffer, projection et résumé Jardin à l'échelle du bâtiment. Les ancres et emprises associent toutes les cellules au même bâtiment.
- `apps/api/src/modules/villages/spatial-selection.ts` : `normalizeSpatialSelection()` exige un rectangle plein ; le maximum technique actuel est 100 cellules par commande. Le rectangle doit être validé avant de lui soustraire les cellules existantes.
- `apps/world-web/src/scene/construction-selection.ts` : `previewArea()` exige actuellement que chaque case soit libre, puis vérifie le contact avec le Jardin ciblé. Cela explique le rectangle avec une case accolée signalé par Tristan.
- `apps/world-web/src/scene/VillageScene.tsx`, `App.tsx` et `ui/PlayerPanels.tsx` : picking vers un bâtiment, sélection rectangulaire et commande de récolte globale. Les nouvelles interactions devront conserver le déplacement de caméra et un accès aux détails du Jardin.
- Migrations 008/010 et `packages/contracts/src/villages.ts` : emprises, extensions, buffers et trajets portent des références bâtiment. Supprimer un bâtiment absorbé sans traiter ces références risquerait de supprimer des données encore utiles.

## Économie et cycle de la parcelle

Conserver les valeurs actuelles : 50 bois par ajout, 60 carottes/h et capacité 600 par parcelle active, un habitant capable de tenir le trajet de 60 secondes. Ce sont les réglages actuels du POC, pas un nouvel arbitrage d'équilibrage.

Chaque parcelle active possède son stock, son reliquat et sa borne de production autoritatifs. À la récolte, réserver uniquement ses carottes entières, conserver sa fraction et reprendre sa production sur place. Pendant le trajet, elle continue de pousser mais ne peut pas faire partir une seconde récolte. Les autres parcelles du même Jardin restent indépendamment récoltables. À l'arrivée, créditer une seule fois la quantité réservée et libérer un habitant.

Une parcelle en chantier ne produit pas, n'est pas récoltable et ne crée pas de liaison de fusion. Une nouvelle parcelle commence sa production à son échéance d'achèvement, avec le stock initial prévu par le comportement actuel de construction ; cette tranche n'ajoute pas de cadeau de carottes au chantier. L'état de départ du village et son Jardin préexistant relèvent du cadrage d'onboarding distinct.

La fusion ne répartit pas à nouveau les stocks des parcelles, ne remplit pas les nouvelles cases et ne déplace aucune carotte déjà réservée dans un trajet. Les sommes affichées au niveau du Jardin sont des agrégats des parcelles, pas une seconde source de crédits.

## Fusion et identité — recommandation technique

Le Jardin logique est la composante de parcelles actives contiguës du même village et du même type, avec voisinage torique. La fusion couvre aussi les Jardins déjà juxtaposés dans les données de départ.

Recommandation : conserver une identité canonique déterministe pour l'ensemble et des références internes permettant de résoudre les anciennes identités. Le choix précis de table/champ appartient à l'implémenteur. Les anciennes ancres ne doivent plus produire plusieurs panneaux, exploitations ou symboles concurrents pour le même ensemble. Une ancre technique peut subsister pour le rendu sans déterminer l'unité de récolte.

Ne pas supprimer en cascade les bâtiments sources tant que des extensions, récoltes ou reçus les référencent. Une fusion peut réunir des Jardins ayant chacun une récolte ou une extension en cours : conserver ces opérations, leurs échéances et leurs quantités. Adapter l'ancienne unicité d'extension par bâtiment si nécessaire, sans annuler ni retarder une opération pour permettre la fusion. Les nouvelles commandes doivent résoudre la cible courante ; un retry d'une ancienne commande doit retrouver son résultat après fusion.

Les notifications worker existantes restent inchangées. Le handler d'une ancienne notification résout son opération métier ou constate qu'elle est déjà terminée ; la fusion ne réécrit ni n'acquitte les tâches en attente. Pas de mécanisme générique de fusion de tous les bâtiments.

## Agrandissement tolérant

Le serveur reçoit le rectangle complet dessiné, normalise les coordonnées sur le tore, déduplique/valide sa géométrie, puis classe ses cases :

| Case | Traitement |
|---|---|
| Parcelle de Jardin active du même village, même Jardin ou voisin | Existant toléré, coût nul, production et récolte conservées |
| Case libre et constructible | Ajout facturé et réservé |
| Parcelle encore réservée par un chantier | Obstacle explicite ; ne pas traiter un chantier comme une parcelle achevée |
| Autre bâtiment, décor occupant, autre village, hors portée | Obstacle ; rejet de la construction proposée |

La différence rectangle moins existant peut être en L ou comporter des trous : elle n'a pas à être rectangulaire. Elle doit, avec les parcelles existantes, former un agrandissement connecté au Jardin ciblé par un côté. Le rectangle ne supprime ni ne découpe les parcelles déjà existantes hors de la sélection.

Un rectangle sans ajout est un no-op explicite, sans débit ni tâche. Une case invalide rejette toute cette commande d'agrandissement, sans débit partiel. Conserver les règles actuelles de portée avant commande : les nouveaux chantiers n'étendent pas eux-mêmes leur rayon constructible. Facturer uniquement les ajouts ; à leur achèvement, fusionner les composantes qu'ils relient, y compris à travers une couture du tore.

## Contrats et geste de récolte — recommandation technique

Étendre les contrats partagés avec les états nécessaires par parcelle : coordonnées canoniques, appartenance au Jardin logique, quantité/projection, capacité, état actif/chantier et éventuel trajet. Ne pas déduire les carottes d'une animation, d'un symbole ou d'une moyenne calculée côté client.

Recommandation bornée : commandes de récolte ciblant une parcelle par coordonnées stables, avec `commandId` conservé jusqu'à réponse certaine. Une file client séquentielle respecte l'ordre du passage et évite que des requêtes concurrentes inversent les affectations. Un contrat batch est acceptable s'il garde les mêmes garanties et retours par parcelle, sans transformer le geste en réservation atomique de toute la surface. Le serveur décide de l'éligibilité et du nombre d'habitants réellement engagés.

- À l'appui, envoyer la première parcelle éligible ; en déplacement, parcourir les cellules traversées par le segment, pas seulement les points rares des événements pointeur. Canonicaliser les coordonnées avant déduplication.
- Ignorer une case vide, en chantier, déjà en récolte ou déjà visitée pendant le geste ; ne pas vider un Jardin entier en retombant sur son ancre.
- Arrêter les nouveaux départs de ce geste après manque d'habitants. Les réponses déjà acceptées ne sont pas annulées. Un nombre borné de notifications remplace un message par parcelle refusée.
- En cas de réponse perdue, conserver l'intention et réessayer avec le même identifiant ; ne pas supposer qu'une erreur réseau signifie absence de départ. Libérer le bouton ou annuler le geste arrête la collecte de nouvelles cibles, pas les opérations serveur déjà acceptées.
- Distinguer prévisualisation, requête en attente et récolte effectivement partie. Montrer les parcelles concernées sans faire disparaître leur nouvelle production.

Le geste doit fonctionner au tactile avec maintien/glissement. Réserver le geste de récolte au départ sur une parcelle récoltable ; préserver un moyen clair de déplacer la caméra et d'ouvrir les détails du Jardin. Le choix des raccourcis et de l'accès secondaire aux détails est une décision locale d'UX, à vérifier sur desktop/mobile. Un contrôle explicite accessible au clavier doit permettre de récolter une parcelle sans geste de glissement.

Le symbole « plein » s'appuie sur la projection serveur et l'état de récolte ; il doit être lisible et ne pas intercepter les gestes involontairement. Les éléments visuels sont regroupés/instanciés selon le rendu existant, sans entités décoratives PostgreSQL individuelles.

## Migration conservatrice et concurrence

Une migration additive doit adopter les parcelles actives et les chantiers existants, leurs dates et leurs références. L'ancien buffer ne décrit pas la répartition réelle entre cellules : recommandation de reprise déterministe par quotient/reste des quantités entières, dans l'ordre canonique des coordonnées, avec conservation exacte du reliquat. Aucune création ou perte de carottes, aucun dépassement de capacité. Fixer une borne commune et traiter la production due de façon cohérente ; ne pas conserver deux producteurs actifs pour le même stock après bascule.

Les anciens trajets globaux terminent avec leur quantité déjà réservée, leurs habitants et leur échéance, sans re-réserver le stock migré. Les cellules concernées restent protégées contre un second départ jusqu'à cette fin. Le statut du trajet, pas la notification, décide si le crédit est dû. Les anciens reçus de commandes doivent conserver leur idempotence.

Toutes les mutations et lectures métier restent bornées par `world_id` et le village possédé. `beginVillageEconomy()` prend le village avant les verrous métier et fournit la borne post-verrou commune à commande et snapshot. La réconciliation mélange les échéances construction/extension/récolte/pierre dans l'ordre prescrit. Préserver les règles de verrouillage des gisements et du worker ; les nouveaux verrous de parcelles et de composantes suivent un ordre canonique déterministe après le village. Aucun verrou d'un autre village pour fusionner.

Une récolte concurrente sur la même parcelle ne peut ni vider deux fois son stock ni affecter deux habitants. Des récoltes de parcelles différentes sont permises si les effectifs le permettent. Une fusion ou un achèvement entre deux appels ne doit pas faire perdre une intention, réinitialiser une production ou créer un crédit supplémentaire.

Migration et fixtures sur base de test pour validation. Ne pas appliquer au développement, réinitialiser le village ou adapter des données personnelles sans demande couvrant cette opération. Ne pas retirer les garde-fous de `resetE2eState()` pour faciliter les essais.

## Découpage et acceptation

Implémenter dans cet ordre, en gardant la tranche complète comme objectif :

1. Stocks et récoltes par parcelle, contrats, compatibilité/migration et preuves serveur.
2. Fusion automatique, préservation des trajets/extensions et retries à travers la fusion.
3. Rectangle tolérant côté serveur et aperçu React/Babylon concordant.
4. Symboles, geste ordonné, retours, clavier et tactile ; supprimer les comportements UI qui enverraient encore tout le Jardin par erreur.

Preuves requises :

- Deux parcelles à maturités différentes : récolter l'une ne change pas le stock de l'autre ; un seul habitant affecté ; production pendant trajet et crédit à 60 secondes exacts.
- Parcelle contenant une carotte récoltable sans symbole plein ; zéro carotte, chantier et trajet en cours ignorés sans dépense ni affectation.
- Balayage, retour sur ses pas et déplacement rapide : pas de trou entre événements ni double départ ; manque d'effectifs respecte l'ordre et laisse les cases suivantes intactes ; retry après réponse perdue.
- Fusions chaîne, diagonale exclue, tore, villages distincts, liaison en chantier puis achevée ; trajets et extensions déjà en cours terminent une fois, anciens IDs/reçus utilisables pour retry.
- Rectangle 3 × 2 autour d'une case : cinq ajouts/250 bois ; existant voisin inclus ; aucun ajout ; obstacle réel ; périmètre et coûts identiques client/serveur ; courses entre deux extensions sans double débit.
- Migration depuis stocks inégaux, reliquats et saturation, trajets et chantiers en cours. Comparer les valeurs dans la transaction avant tout rollback de nettoyage. Préserver les stocks villages.
- Concurrence forcée avec barrières bornées et observation d'attente PostgreSQL. Rollback avec erreur identifiée après observation des mutations, comparaison de toutes les données touchées.
- Parcours navigateur desktop et mobile, commandes accessibles au clavier, déplacement caméra, symbole, collecte partielle, agrandissement et fusion visibles. Vérifier une session neuve et un village migré.

L'implémenteur relit et corrige son travail, exécute les suites connexes et lint/typecheck/build selon le diff, puis met à jour le handoff avec les preuves terminées. Aucune boucle de délégation imposée. Ne pas déclarer la tranche livrée tant qu'il ne s'agit que du nouveau stockage ou d'un aperçu fonctionnel.

## Hors scope

Nouvelles quêtes Jardin/première récolte, récompenses supplémentaires, changement des durées/coûts, automatisation permanente de récolte, coupe de bois, nouveau système de population, TRY, fusion entre propriétaires, démolition/scission des Jardins et refonte artistique complète. Les quêtes attendues restent une tranche distincte : ce travail rend les Jardins plus intuitifs sans ajouter implicitement un accomplissement au grimoire.
