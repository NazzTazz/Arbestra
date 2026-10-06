# Place de marché et Oracle

Date : 6 octobre 2026. Base relue : `3648eab` et worktree économique courant. Statut : **plomberie et prototype implémentés, parcours Chromium validé**. Tristan autorise la plomberie et un prototype d’interface ; il conserve la réflexion sur présentation et UX.

## Décisions validées

- La place de marché ouvre au second étage de l’hôtel de ville, au niveau 2. Elle n’est pas un bâtiment autonome à construire.
- L’amélioration vers l’hôtel de ville niveau 2 coûte **500 bois d’œuvre et 120 pierres taillées** et dure **10 minutes**.
- L’Oracle peut se substituer aux joueurs pour permettre les échanges lorsque le commerce entre joueurs ne suffit pas. Barème validé : valeur de référence 1 pour bois brut/pierre brute, 1,5 pour bois d’œuvre/pierre taillée ; commission de 30 %, réception arrondie à l’unité inférieure.
- Le troc convient à Tristan ; sa présence ne supprime pas la future monnaie.
- Les carottes doivent être achetables et vendables au marché dès cette tranche, en plus des quatre matières. Leur valeur Oracle est **0,25**, validée séparément.
- Les échanges doivent être définis par ressource cataloguée, sans liste de quatre matières figée dans le mécanisme. Extensions futures demandées : champignons forestiers ramassés pendant la coupe des arbres, poisson pêché, pommes ramassées. Leurs productions et barèmes ne font pas partie de la tranche initiale.
- Le délai de livraison de l’Oracle est fixe : **10 minutes**. Ce délai ne dépend pas d’une distance vers un village fictif.
- L’Oracle dispose de **capacités illimitées** : aucun plafond de stock ou de volume commercial de sa part. Les stocks réellement détenus par le joueur restent nécessaires pour payer l’échange.
- L’Oracle vit à l’intérieur du tore et emprunte cet intérieur pour livrer rapidement. Cette explication de monde accompagne le délai fixe ; elle n’impose pas une simulation de trajet intérieur.
- La monnaie s’appelle **Anneaux**. Elle est cataloguée (`rings`) avec un stock initial nul. À terme, elle proviendra des mines et des ventes et servira à acheter l’armée ; support matériel, émission, ventes monétaires, mines et armée restent hors tranche.
- Les services actuels de l’hôtel de ville restent accessibles pendant son amélioration. Les échanges Oracle ne mobilisent aucun habitant, peuvent être simultanés et sont définitifs après confirmation ; règles explicitement validées.

## Existant vérifié

La migration 034 ajoute l’hôtel de ville niveau 2, sans extension, aux coût/durée validés, et le marché Oracle. Le catalogue historique ne définissait que son niveau 1 (`004_world_economy_foundation.ts`). Le rendu actuel est conservé pour le prototype ; le second étage visuel reste à concevoir avec Tristan. L’économie distingue bois brut, pierre brute, bois d’œuvre et pierre taillée ; les transformations consomment 25 brutes et produisent 20 raffinées par lot de travail.

## Barème Oracle validé

Pour une quantité offerte `q`, la réception vaut `floor(q × valeur_offerte × 0,70 / valeur_demandée)`. Calcul exact livré en bigint avec valeurs entières équivalentes 1 (carotte), 4 (brut) et 6 (raffiné), et coefficient 7/10 ; aucun arrondi intermédiaire.

| Quantité offerte | Quantité reçue |
|---|---|
| 100 bois bruts | 70 pierres brutes |
| 100 bois bruts | 46 bois d’œuvre |
| 100 pierres brutes | 46 pierres taillées |
| 100 bois d’œuvre | 105 bois bruts |
| 100 bois d’œuvre | 70 pierres taillées |

Les transformations restent avantageuses : 100 bois bruts produisent 80 bois d’œuvre en atelier, contre 46 chez l’Oracle. Un lot de 25 bois bruts produit 20 bois d’œuvre, revendables contre 21 bois bruts ; la transformation suivie de cette revente ne renouvelle donc pas ses intrants. Chaque troc réduit la valeur de référence d’au moins 30 %, ce qui interdit tout cycle profitable composé uniquement de trocs. Les taux sont fixes dans ce barème ; pas de cours variable initial.

## Première tranche implémentée

En Exploitation, cliquer l’hôtel de ville ouvre sa fiche avec le prototype Marché. Niveau 1 : devis et bouton d’amélioration ; niveau 2 achevé : ressources offerte/demandée, quantité, devis serveur, confirmation et livraisons. Le périmètre initial comporte les quatre matières et les carottes. Le stock offert est débité au départ et le stock reçu crédité une seule fois à l’échéance serveur. Le commerce entre joueurs et les usages monétaires suivront dans des tranches séparées.

Le catalogue `resource_types` et les stocks par `resource_code` existaient déjà ; certains champs de snapshot restent nommés explicitement. Le marché utilise `oracle_market_resources` pour l’éligibilité et la valeur des codes catalogués ; le serveur refuse les autres codes. Ajouter une ressource et son tarif ne demande pas de réécrire le moteur de troc. Les stocks manquants sont initialisés à zéro dans la transaction avant leur usage. Pas de refactor général des récoltes ou du HUD.

`POST .../market/preview` calcule disponibilité et quantité reçue ; `POST .../market` exige `commandId` et `expectedReceivedAmount`. `market_exchanges` conserve demande, débit, quantité reçue figée et échéance ; le même ID rejoue sans débit supplémentaire, un payload différent est refusé. Livraison intégrée à la réconciliation par échéance/ID/type ; `market.deliver` ne finalise que sa propre notification. Snapshot : catalogue négociable, déblocage, toutes les livraisons actives et 20 échanges livrés récents. Le client rafraîchit l’état toutes les deux secondes lorsqu’une livraison reste active, même sans autre activité. Quantités techniques : entiers 1 à 1 milliard par commande ; zéro reçu et échanges de même ressource refusés. Ce plafond de représentation par commande ne plafonne pas la capacité globale de l’Oracle.

Tarifs Oracle stables, publics, avec marge défavorable et produits raffinés valorisés pour leur travail. Aucun aller-retour ni cycle d’échanges ne doit créer de ressources. Recourir à l’Oracle explicitement est recommandé ; pas de conversion automatique d’une annonce joueur en échange défavorable sans accord préalable.

Commerce joueur futur : offres libres, stockage/revente et circuits triangulaires proposés, non encore spécifiés ni implémentés. La contrepartie Oracle illimitée fournit une alternative permanente à ses taux fixes : les joueurs peuvent influencer les offres entre eux, mais une pénurie entretenue ne supprime pas ce recours. Le délai et les modalités des échanges joueurs restent à arbitrer.

## Arbitrages ouverts

- Présentation et UX finales, apparence du second étage de l’hôtel de ville : réflexion de Tristan ; prototype actuel conserve le bâtiment existant.
- Déclenchement du recours à l’Oracle depuis une offre joueur : mécanisme futur, recours explicite proposé.
- Support matériel des Anneaux, moment de leur émission ; ventes monétaires à l’Oracle ou aux joueurs, cours, mines et règles d’achat de l’armée à spécifier ultérieurement.

## Invariants à conserver pour l’implémentation future

Autorité serveur et isolation par `world_id`, village verrouillé avant les opérations économiques, borne commune après verrou, commandes idempotentes, crédit à échéance intégré aux transitions chronologiques et indépendant du rendu. Preuves terminées : 8 tests PostgreSQL Marché verts, 2 tests purs de tarifs/cycles verts ; suites connexes Transformation (16) et Couchages (6) vertes. Régression des 30 couchages de l’hôtel constatée en échec avant correction. Concurrence : deux commandes observées en attente PostgreSQL derrière un verrou de village, puis un seul débit admis ; rollback prouvé après débit/échange/notification avant erreur identifiée. Migration 034 appliquée sur test puis développement identifié `127.0.0.1:5432/arbestra`, 47 bâtiments et stocks précédents identiques, Anneaux initialisés à zéro, aucun échange lancé dans le village utilisateur. Chromium : 1 parcours vert, clic réel de l’hôtel, amélioration, devis, débit de 100 bois, réception de 280 carottes après échéance accélérée uniquement en test, devis de 40 carottes contre 7 pierres, aucune erreur JavaScript. La régression de rafraîchissement sans autre activité a été constatée puis corrigée dans ce parcours. Mobile et UX finale non validés ; résultats de finition dans le handoff courant.
