# Transition complète vers des commandes bornées et une synchronisation ciblée

Date : 21 octobre 2026. Base relue : main, 496637925666b6474a04231d15c368a2d2f8c8a6. Application publiée : a3ae90d5953e9e26313cbd2d143a6722d7f5de43.

Statut : **spécification complète proposée, prête à découper en tranches d'implémentation**. Ce document décrit la cible ; aucun des changements V2 ci-dessous n'est livré par sa rédaction. La demande courante autorise la spécification, pas l'implémentation ni un nouveau déploiement.

## 1. Décisions, résultat et périmètre

**Validé dans la session :** alléger les actions et les transports, supprimer les réconciliations générales sans rapport avec une action, privilégier la réutilisation et spécifier une transition totale. La création de bâtiment bornée est déjà livrée. Les règles de gameplay précédemment validées restent inchangées.

**Proposé ici :** contrats de commande explicites, lecteurs ciblés communs, journal transactionnel de changements par périmètre, protocole V2 partagé entre HTTP et SSE, lectures sans mutation économique, migration progressive puis retrait du protocole historique.

**Ouvert :** ajustement des budgets de performance après la première mesure V2 sur le VPS. Les nombres proposés en section 12 sont des critères initiaux, pas des résultats acquis. Aucun arbitrage produit n'est nécessaire pour écrire cette cible. Toute découverte imposant un changement d'ordre d'admission, de réservation ou de règle de dépense doit être remontée comme une décision produit ; elle ne peut être cachée dans une optimisation.

**Hors scope :** microservices, Redis, broker externe, WebSocket, moteur générique de workflows, event sourcing de toute l'économie, refonte du rendu ou des illustrations, portage Rust/WASM du solveur. Le pool de navigation et le scheduler existants sont réutilisés.

Résultat attendu :

- Poser, nourrir, régler ou mettre en pause produit une confirmation rapide et autoritaire.
- Un changement de mode conserve les gestes non résolus et les effets déjà confirmés.
- La taille et le coût d'une action dépendent de ses cibles et de ses dépendances réelles.
- Les autres onglets et les voisins concernés reçoivent les changements sans reconstruire le village entier.
- Une reconnexion reprend les changements manquants ou les seuls périmètres périmés.
- La progression économique continue sans navigateur connecté.

Une petite réponse n'est pas une preuve de traitement borné. Le budget comprend la commande, sa confirmation, le travail de synchronisation induit et les éventuelles relectures du client.

## 2. Existant vérifié et écarts

Références : [audit du 21 octobre](AUDIT-COUTS-SERVEUR-2026-10-21.md), [synchronisation actuelle](architecture/village-synchronization.md), [économie](architecture/economy.md), [temps serveur](architecture/server-time.md).

| Chemin réel | Existant | Transition nécessaire |
|---|---|---|
| [construction.ts](../apps/api/src/modules/villages/construction.ts) | Création bornée, reçu, cellules/ressources ciblées ; aucun rattrapage général. | Conserver cette propriété ; adapter confirmation et publication V2. |
| [service.ts](../apps/api/src/modules/villages/service.ts), state / villageCommandResult | Assembleur général ; nombreuses commandes réconcilient et retournent encore le village complet. | Extraire les lectures nécessaires ; retirer les appels de commande à state et au finaliseur général. |
| readConstructionConfirmation | Amélioration/extension utilisent encore un assemblage large en mode construction. | Lecteurs limités au bâtiment, à son emprise et aux stocks concernés. |
| [hud-workforce.ts](../apps/api/src/modules/villages/hud-workforce.ts) | Confirmation compacte ; beginVillageEconomy reste large. | Conserver les gestes/reçus ; limiter préparation économique et synthèse. |
| Oracle, processing, science | Serveur négociant déjà des trames après commit ; projection complète derrière. | Commandes et projections ciblées V2. |
| [client.ts](../apps/world-web/src/api/client.ts) | Oracle/atelier/science appellent encore requestState sans négociation. | Raccord réel du client dans chaque tranche ; un test de harness seul ne suffit pas. |
| [sync.ts](../apps/api/src/modules/villages/sync.ts), VillageSyncSession | Nouvelle projection complète quand la révision change ; snapshot à chaque ouverture SSE ; réveil économique depuis la lecture. | Journal ciblé, reprise depuis le curseur appliqué, lectures pures. |
| [sync-revision.ts](../apps/api/src/modules/villages/sync-revision.ts) | COUNT des marqueurs du monde ; croissance historique et invalidations conservatrices. | Curseurs par périmètre, lectures indexées et rétention bornée. |
| [sync-projections.ts](../apps/api/src/modules/villages/sync-projections.ts) | Bases exactes en mémoire, partage des lectures en vol. | Réutiliser le partage ; ne plus dépendre d'une ancienne projection complète pour produire un delta. |
| [harvest-submissions.ts](../apps/api/src/modules/villages/harvest-submissions.ts), [expeditions.ts](../apps/api/src/modules/science/expeditions.ts) | Intentions et reçus durables ; navigation asynchrone. | Conserver leurs règles ; intégrer reçus et effets au protocole commun. |
| [terrain-routes.ts](../apps/api/src/modules/worlds/terrain-routes.ts) | Terrain déjà chargé séparément, par chunks ; certains aperçus ont un ETag. | Conserver les artefacts ; cibler les modifications et éviter leur duplication dans les réponses de commande. |

Le problème historique est réparti entre plusieurs endpoints, lecteurs et handlers. Supprimer un unique endpoint ne réalise pas la migration.

## 3. Architecture cible et responsabilités

~~~mermaid
flowchart LR
  UI[Action du joueur] --> C[Commande ciblée]
  C --> T[Transaction métier et reçu]
  T --> A[Confirmation compacte après commit]
  A --> Store[État client et confirmations]
  W[Worker et échéances] --> T
  T --> J[Journal de changements atomique]
  J --> R[Lecteurs ciblés en lecture seule]
  R --> S[SSE et reprise]
  S --> Store
  B[Initialisation] --> R
~~~

### 3.1 Trois notions distinctes

- **Périmètre métier d'une commande** : ce qu'elle doit vérifier, verrouiller, faire progresser et modifier.
- **Composant de lecture** : représentation typée réutilisée pour afficher une partie du jeu.
- **Flux de synchronisation** : propriétaire d'un curseur ordonné et durable.

Un flux privé du village peut contenir des changements de stocks, de population et de bâtiments. Cela n'autorise pas à relire ces trois composants à chaque changement. Inversement, une même commande peut modifier le village et une cellule mondiale, donc publier dans plusieurs flux.

### 3.2 Contrat explicite de chaque action

Chaque action possède une définition typée, proche du module métier, indiquant :

1. Schéma d'entrée, identifiant idempotent et résultat métier.
2. Résolution du monde, du propriétaire, des cibles et des limites de sélection.
3. Dépendances de lecture et transitions temporelles pouvant affecter la décision.
4. Villages, périmètre spatial et lignes métier à verrouiller.
5. Mutations possibles, notifications nouvelles et lecteurs nécessaires au résultat.
6. Changements publiables, périmètres destinataires et budget.

Ces définitions forment un inventaire vérifiable, pas un interpréteur universel de commandes. Les fonctions métier restent ordinaires et typées. Les services communs ne chargent pas implicitement toutes les ressources parce qu'une commande demande une carotte.

### 3.3 Lecteurs partagés

Extraire progressivement des lecteurs de stocks sélectionnés, population, logements concernés, bâtiments/emprises, parcelles, ordres/équipes, commerce, science, connaissances, journal joueur et modifications spatiales.

Ils reçoivent une transaction de lecture cohérente, un contexte d'autorisation, une borne et une sélection bornée d'identifiants. Ils n'acquièrent pas de verrou métier, ne réconcilient pas, ne démarrent pas de travail et ne créent pas de notification. Les calculs purs partagés restent autorisés.

Les trois usages — confirmation, synchronisation et initialisation — réutilisent ces lecteurs. Les mutations peuvent fournir directement des valeurs RETURNING équivalentes, validées par le même contrat. On ne relit pas systématiquement ce que la transaction vient de produire.

Les caches restent réservés aux données immuables/versionnées et aux calculs purs dont toutes les dépendances figurent dans la clé. Une base de transport en mémoire ne décide jamais des stocks, droits ou disponibilités.

## 4. Catalogue complet des actions et lectures à migrer

Les chemins suivants sont relatifs à /api/worlds/:worldSlug/villages/:villageId, sauf mention. Un nom de composant désigne les seuls identifiants affectés, jamais sa collection complète par défaut. La colonne économique doit être affinée par variante avant son implémentation ; la fermeture des dépendances de la section 5 reste obligatoire.

| Action / chemin actuel | Dépendances principales à examiner | Effets / confirmation V2 | Lot |
|---|---|---|---|
| POST buildings, pose simple ou surfacique | Droits, coût, emprise/halo, passages engagés pertinents, stocks dépensés | Bâtiment, occupation locale, stocks concernés, échéance | B |
| POST buildings/:buildingId/upgrade | Bâtiment/niveau, coût, éventuelle nouvelle emprise, services/capacités dépendants | Bâtiment, stocks, emprise si changée | D |
| POST buildings/:buildingId/expansions | Jardin et sélection, occupation, coût, parcelles concernées | Extension, cellules, stocks | D |
| POST infrastructure et variante undo | Emprise sélectionnée, voies/équipements, coût, protections, certificat d'annulation | Entités spatiales et stocks modifiés | D |
| POST leveling | Sélection, relief/appuis, protections, travailleurs, trajet et devis | Chantier, réservation, équipe, échéance | D |
| POST terraform | Mêmes lecteurs, devis et tolérance de durée déjà validée | started avec patch, ou needs-confirmation sans mutation métier | D |
| POST extraction-pools | Consigne ciblée et affectations nécessaires à son bornage | Consigne, synthèse concernée, réveil durable éventuel | C |
| POST population/gestures, feed | Carottes, groupe éligible, affectations susceptibles de prolongation | Stocks/cohortes/équipes modifiés ; tout le groupe éligible | C |
| POST population/gestures, rest/release | Disponibles ou actifs visés, logements nécessaires, affectations | Jusqu'à dix habitants par geste, rotation/libération différée existante | C |
| POST population/feed et population/rest | Ancien contrat count, mêmes règles partagées | Même noyau, reçu V2 ; adaptateur temporaire sans snapshot | C |
| POST garden-harvests | Parcelles sélectionnées, production exacte, habitants, tournée | Mission, réservations/parcelles, affectations | E |
| POST buildings/:buildingId/harvest | Cible Jardin et règles du parcours unitaire | Même noyau que la récolte groupée | E |
| POST features/:featureId/extractions | Gisement cible, accès, stocks/réservations partagés, habitants | Extraction, gisement, équipe, trajet engagé | E |
| POST features/:featureId/clear | Bosquet ciblé, droits/conditions de dégagement et occupation | Bosquet/occupation, effets réellement prévus par la règle actuelle | E |
| POST exploitation | Sélection mixte bois/pierre/Jardin, affectations et accès | Ordre et cibles/équipes réellement engagées | E |
| POST worksites et worksites/:worksiteId | Ordre/cibles concernés, capacité, état du lot engagé | Ordre, cibles modifiées, équipe éventuelle | E |
| POST harvest-intents | Validité de l'intention et propriété ; admission ultérieure existante | Reçu durable immédiat ; effets du worker ensuite | E |
| POST processing, start/resume | Bâtiment, recette, intrants, habitants, ordre ciblé, prédécesseurs nécessaires | Ordre/lot, stocks et équipe concernés | B |
| POST processing, pause/cancel | Ordre et lot engagé ; règles de fin du lot | Ordre actualisé ; pas de remboursement ou interruption inventés | B |
| POST market, Oracle | Accès marché, échange/devis, stocks offerts et dépendances de crédit | Échange, stock débité, échéance | F |
| POST market/trades, publish/cancel/oracle | Offre et lots concernés, droits marché, stocks/réservations | Offre, réservations, stocks, échéances | F |
| POST market/trades, accept | Deux villages, offre, ressources, convoyeurs, trajet certifié | Deux ensembles privés filtrés, offre publique, convois | F |
| POST science, research/pause/resume/train/recall | Programme/activité, connaissances joueur-monde, équipe, moyens, règles actuelles | Programme/activité, affectation, connaissances si modifiées | G |
| POST science, survey/explore | Réception puis FIFO/admission/navigation existants | Reçu d'expédition ; départ/résultat/retour par publication ciblée | G |
| POST discover-cat-eyes | Condition de découverte et unicité de l'accomplissement | Accomplissement et message Oracle concernés | G |
| POST buildings/:buildingId/discover-supplies | Propriété, coffre et accomplissement uniques | Crédit, coffre, journal | G |
| POST /api/worlds/:slug/join et starter, y compris starter par village | Installation, territoire, kit, identité monde/joueur | Installation ciblée puis initialisation explicite du nouveau village | H |

Préserver : incrément de cinq habitants par appui Exploitation, un chantier de un à dix habitants, zéro chantier met en pause en conservant les cibles, repas pour tout le groupe éligible, gestes Population par dix, tolérance de terraformation déjà validée. Aucun changement de priorité FIFO ou d'affectation n'est implicite dans ce catalogue.

| Lectures / producteurs transversaux | Sort attendu |
|---|---|
| village, events | Initialisation et protocole V2 décrits en sections 7–8 ; retrait des effets économiques de lecture. |
| market/preview, processing/preview, exploitation/preview, worksites/preview, infrastructure/preview, leveling/preview, market/trade-preview | Lectures ciblées pures ; devis non réservé et revérifié à l'admission. Un cache technique de trajet peut être alimenté hors transaction de lecture, sans mutation économique. |
| features/:featureId | Détail du seul gisement, accès et éligibilité nécessaires ; aucun state. |
| market/offers | Pagination/filtre conservés ; invalidation de liste et actualisation de la page visible seulement. |
| harvest-intents GET, science/expeditions GET | Reçus bornés par UUID/pagination, indépendants d'un snapshot du village. |
| terrain, terrain/updates, overview, vegetation, villages | Artefacts et chunks séparés ; versions locales, voisins/coutures inclus ; connaissance autoritaire filtrée. |
| spawn-atlas, spawn-map, resource-check, terrain-check, starter/inspect, starter/terrain | Consultation sans progression économique ; installation seule est mutante. |
| Worker : construction, extension, Jardin, extraction, nivellement | Même métier ciblé, même collecteur de changements ; échéances et crédits inchangés. |
| Worker : lots ateliers, Oracle, offres/livraisons commerciales | Fin/admission ciblées et dépendances temporelles ; publications privées/publiques appropriées. |
| Worker : croissance, énergie/repos/logement, science, expéditions, réveils de pools | Couverture sans connexion, marqueurs durables et reçus ; aucune publication fondée sur l'animation. |
| NOC observation, lancement et lecteurs associés | Même représentation/lecteurs, autorisation d'observation distincte, aucune mutation ; corrélation des commandes conservée. |
| Factory, adaptation de campus/HDV, réglages, génération et éditions administratives | Tous les producteurs modifiant des données consommées déclarent leurs changements ; génération initiale/configuration peut invalider un périmètre entier explicitement. |

Les opérations d'authentification, la télémétrie et les lectures administratives sans données de jeu ne sont pas refondues. Elles ne doivent pas devenir une porte dérobée vers le réconciliateur. Un contrôle automatisé confronte cet inventaire aux routes réellement enregistrées, y compris celles créées dans des boucles et les variantes d'action.

## 5. Temps, autorité et travail économique borné

### 5.1 Ordre conservé

Toute commande revalide monde, droits, cibles canoniques du tore et règles côté serveur. Le viewport ne constitue pas une autorisation.

Ordre : tâche acquise avec SKIP LOCKED si worker ; tous les villages nécessaires en ordre canonique ; verrou spatial/navigation au niveau requis ; préparation/verrouillage métier dans l'ordre existant ; écritures. Tous les gisements nécessaires sont connus et verrouillés par UUID canonique avant les transitions. Aucun deuxième village n'est pris après un gisement.

La borne H vient de statement_timestamp après acquisition des villages et des verrous de contexte requis, suivant le contrat temporel actuel ; elle reste fixe pendant la commande. Ne pas utiliser l'heure de début d'une transaction ayant attendu. Un changement de placement de H exige ses propres tests de concurrence ; cette migration ne le fait pas implicitement.

Commande, reçu et confirmation préparée dans sa transaction partagent H. Une projection après commit possède une borne distincte observée à la lecture. Les horodatages n'ordonnent pas les commits.

### 5.2 Fermeture des dépendances

Remplacer le couple « beginVillageEconomy puis finaliseur global » par une préparation explicite des seules dépendances de l'action :

1. Résoudre les cibles et ressources/affectations réellement utilisées.
2. Rechercher les transitions dues pouvant changer ces entrées ou leur priorité d'utilisation.
3. Étendre cet ensemble jusqu'à inclure leurs dépendances ; une transition qui libère des habitants ou déclenche un successeur peut imposer une extension.
4. Préparer les verrous de l'ensemble avant mutation. Si une dépendance nouvelle ne peut être ajoutée sans inverser l'ordre des verrous, abandonner et recommencer avec l'ensemble élargi.
5. Appliquer les événements retenus par échéance, ID, type ; réinsérer les successeurs dans ce même ordre.
6. Exécuter la commande, puis seulement les conséquences immédiates et admissions prévues par son contrat.

La fermeture peut légitimement être large lorsque plusieurs activités partagent stocks et habitants. Elle ne doit pas être présentée comme constante dans ce cas. On optimise sa découverte et son traitement ; on ne supprime pas une dépendance nécessaire pour satisfaire un compteur SQL.

Exemples à prouver :

- Une pause d'atelier sans lot échu ne doit pas parcourir les jardins ni le terrain.
- Un démarrage utilisant les habitants libérés par une extraction doit voir le retour dû.
- Un lot d'atelier dû pouvant consommer la même ressource avant l'action doit conserver sa priorité actuelle.
- Une création de maison conserve son contrat borné déjà livré, sans réintroduire l'achèvement de tous les bâtiments voisins.
- Un stock productif est calculé par sa formule/cursor et ses changements de régime pertinents, sans replay par seconde ni perte des fractions.

Les handlers de transition existants et population/work.ts restent la source des règles. Pas de second moteur économique spécifique au transport.

### 5.3 Workers autonomes et suppression des réveils en lecture

Avant de retirer reconcileSyncDeadline et reconcileVillageForRead des lecteurs, prouver que chaque transition actuellement réveillée par eux dispose d'une notification durable ou d'un curseur de prochaine échéance indexé, entretenu par ses mutations.

Cela inclut les changements d'activité liés à l'énergie, le logement, les arrivées, les admissions automatiques et les reprises après indisponibilité de navigation. Un balayage de réparation borné, paginé par échéance/village, couvre les notifications manquantes ; il ne recharge pas tous les villages à chaque tick.

Le scheduler ne finalise que sa propre tâche. Une commande/réconciliation n'acquitte, ne verrouille et ne modifie aucune notification existante. Préserver les exceptions d'unicité, notamment building.complete. Les erreurs gardent le recul progressif existant et une visibilité opérateur.

Le rattrapage prolongé est découpé en préfixes chronologiques complets, avec cursor de progression durable ; une transaction ne saute pas une échéance interdépendante pour poursuivre une autre catégorie. Les étapes déjà validées ne sont pas rejouées au retry.

La borne de complétude n'avance qu'après tous les prédécesseurs nécessaires. Un successeur créé à la même échéance reste à traiter même si son UUID précède celui du dernier événement exécuté : les états métier dus restent l'autorité, pas un filtre naïf « ID supérieur au dernier cursor ». Le worker persiste sa continuation avant de terminer sa tâche acquise.

### 5.4 Retard et bornes

Une lecture expose les valeurs matérialisées et leur base temporelle ; elle peut projeter les évolutions continues connues jusqu'à leur prochaine transition. Elle ne prétend pas avoir crédité un événement discret encore non matérialisé. Une fraîcheur insuffisante reste identifiable dans le contrat, sans révéler de détails métier internes au joueur.

Chaque composant temporel distingue observedAt (heure de lecture), basisTime (base du calcul) et la prochaine transition/borne de complétude connue. observedAt seul ne certifie pas un état économique à jour. Si une transition due manque, la projection ne dépasse pas cette borne ; le serveur marque le composant en rattrapage. Le client conserve la dernière valeur certifiée et un état d'actualisation, sans déclencher de boucle de lectures. Les métadonnées viennent des échéances/cursors indexés, sans reconstruire une simulation du village.

Une commande synchrone ne bascule pas silencieusement en intention asynchrone. Si sa fermeture exige un rattrapage dépassant son budget :

- aucune mutation ni reçu de succès de cette commande n'est validé ;
- un réveil de rattrapage peut être créé dans une transaction distincte et bornée, avec déduplication par génération, sans toucher aux anciennes tâches ;
- réponse transitoire SCOPE_CATCHING_UP avec Retry-After ; le client conserve le même UUID et affiche une attente réessayable, pas un succès ;
- le worker fait progresser les cursors ; le retry de la commande revalide les conditions au nouveau H.

Budget technique de départ : au plus 64 transitions discrètes par tranche de rattrapage et contrôle du temps entre transitions ; arrêt après 200 ms de travail observé à une frontière valide. Ce n'est pas une interruption au milieu d'une mutation ni une garantie de latence SQL. Les limites de requête/verrou bornent séparément une instruction lente ; toute interruption annule sa transaction. Le débit de reprise doit dépasser celui des échéances nouvelles dans l'enveloppe de charge acceptée.

Les intentions déjà asynchrones conservent leur reçu durable et leur FIFO. Aucun refus métier définitif n'est transformé en attente infinie. Après des retries transitoires bornés et espacés, le client laisse une reprise explicite avec le même UUID ; il ne renvoie pas l'action à chaque image. Une tâche anormalement bloquée est observable et n'empêche pas les actions indépendantes.

## 6. Persistance des changements et ordre des versions

### 6.1 Flux et composants

| Flux durable | Contenu / autorité | Abonnés |
|---|---|---|
| village privé, clé world/village | Stocks, population, bâtiments privés, ordres, missions, journal, reçus | Propriétaire autorisé, observation autorisée |
| connaissance, clé world/player | Connaissances et découvertes partagées entre les villages de ce joueur | Villages autorisés de ce joueur |
| spatial, clé world/chunk canonique | Terrain édité, occupation publique, gisements, voirie/équipements visibles | Abonnements spatiaux autorisés concernés |
| index d'offres, clé world/filtre de ressource | Changements de présence/état d'offres publiques ; détails privés exclus | Panneau marché concerné |
| manifeste de configuration versionné | Catalogue/génération/apparences applicables | Clients concernés par ce manifeste |

Le flux privé possède un curseur unique pour préserver l'atomicité économique du village ; ses entrées décrivent les composants et clés précis. Les composants ne créent pas chacun une queue de commandes.

Les catégories exactes de composants sont finies et typées dans packages/contracts : stock par code, cohorte, logement, bâtiment, cellule, parcelle, ordre/lot, équipe/mission, échange/offre/livraison, programme/activité, connaissance, accomplissement, reçu. Les synthèses dérivées touchées sont déclarées explicitement et recalculées uniquement si nécessaire.

Une entité publiée a un propriétaire de version unique. Par exemple, l'occupation publique appartient au flux spatial et le détail privé d'un bâtiment au flux village ; ce sont deux représentations distinctes reliées par un identifiant, pas deux copies concurrentes d'un même champ.

### 6.2 Tables proposées

Ajouter des tables additives, noms indicatifs :

- game_sync_streams : world_id, stream_kind, scope_key, epoch, revision, retained_from.
- game_sync_changes : même clé de flux, revision, batch_id, références de composants/entités modifiés ou supprimés, références des autres flux du même batch.

Clé primaire du journal : flux/epoch/revision ; index de reprise sur cette clé. Les révisions PostgreSQL bigint sont sérialisées en chaînes décimales et comparées sans conversion flottante. epoch identifie une génération de flux ; elle change lors d'une réinitialisation ou d'une invalidation incompatible.

Une entrée décrit les clés à relire et les suppressions, sans répliquer tous les payloads de jeu. Ce journal sert à la synchronisation et peut être compacté ; il ne permet pas de reconstruire l'économie historique. Les tables métier restent l'autorité.

### 6.3 Attribution et atomicité

Les mutations accumulent un ChangeSet dédupliqué dans la transaction. Les savepoints doivent annuler aussi les touches correspondantes ; un simple Set JavaScript non restauré au rollback est insuffisant.

Avant la phase terminale, réserver/vérifier l'unicité du reçu, écrire son résultat métier et ses références de cibles, avec batch_id. Aucun reçu en préparation n'est visible avant commit. Les métadonnées de version de la réponse peuvent être assemblées en mémoire après attribution ; un rejeu relit les versions actuelles avec ses cibles et ne dépend pas de la conservation du batch dans le journal.

Après la dernière mutation métier, une phase terminale :

1. Trie tous les flux affectés selon une clé canonique commune.
2. Acquiert leurs lignes de compteur dans cet ordre et incrémente chaque flux une seule fois.
3. Écrit les entrées et leurs dépendances croisées avec le même batch_id.
4. Assemble les métadonnées de confirmation en mémoire, puis commit.

Après l'acquisition d'un compteur de publication, aucune acquisition de verrou métier ni écriture métier susceptible d'en attendre un n'est autorisée. Les références étrangères ajoutées par cette phase doivent être préparées avant elle ; les tables de publication ne doivent pas reprendre indirectement un monde, village ou gisement. Les seuls liens SQL pris à cette phase pointent vers les flux déjà verrouillés. Le résultat du reçu est donc écrit avant, pas par un callback tardif. Un no-op ou un refus reçu peut publier la progression du reçu sans simuler une mutation des stocks.

Ce verrou terminal sérialise uniquement les publications d'un même flux. Une transaction suivante du flux ne peut obtenir la révision suivante avant le commit/rollback de la précédente. Un rollback n'avance pas le curseur et ne publie rien. Les commits de flux indépendants ne nécessitent aucun ordre global.

Ne pas remplacer le COUNT actuel par MAX(id), une séquence globale ou un timestamp : l'ordre d'allocation ne prouve pas l'ordre de validation. Ne pas ajouter de compteur mondial verrouillé après les gisements. Un changement courant d'un village ne touche pas le manifeste mondial.

Les compteurs de chunks/index peuvent créer de la contention locale : la mesurer, borner les sélections et conserver un ordre canonique. Ne pas multiplier les shards arbitrairement avant d'avoir une mesure.

### 6.4 Couverture de tous les écrivains

Installer d'abord la publication V2 en parallèle de V1, côté commandes, workers, installation, factory et maintenance. Chaque table consommée doit avoir une correspondance documentée vers ses composants/flux.

Les triggers existants peuvent fournir un filet de détection pendant la transition. Le contrôle de complétude doit distinguer les vraies mutations de jeu, les progressions de reçus à publier et la télémétrie hors synchronisation ; il détecte les écritures sans ChangeSet. Il ne publie pas une invalidation mondiale à chaque ligne.

Avant activation V2 : zéro écrivain non couvert dans le périmètre activé, tests de rollback/savepoint et vérification des modifications administratives. Pour les migrations ou imports massifs, publier une invalidation explicite du périmètre ou une nouvelle epoch ; ne pas fabriquer des millions de messages unitaires.

### 6.5 Rétention

Politique technique initiale proposée : conserver au maximum sept jours et 10 000 entrées récentes par flux ; la première limite atteinte permet de compacter les entrées anciennes. Ces valeurs sont configurables et mesurées avant production.

Le nettoyage avance retained_from et supprime les entrées dans une même transaction, par lots bornés. Une lecture REPEATABLE READ voit ensemble le plancher et les entrées correspondantes. Un client situé avant ce plancher reçoit un snapshot des périmètres concernés, jamais un faux delta complet.

Le nettoyage n'attend pas le navigateur le plus ancien. Les reçus d'idempotence ont une durée indépendante : ne pas les purger avec le journal. Tant qu'une politique de retrait des UUID n'est pas spécifiée, conserver au moins leur identité, empreinte d'intention et résultat ; un ancien UUID ne redevient jamais une nouvelle dépense.

## 7. Contrat HTTP/SSE V2

### 7.1 Entrées et négociation

Conserver les routes métier ; négocier le protocole commun par x-arbestra-protocol: 2. Toutes les mutations V2 exigent commandId, y compris les variantes science/découvertes/dégagement qui n'en imposent pas encore. Les lectures n'en demandent pas.

La requête ne contient que l'intention : cible(s), paramètres et, si la règle l'exige, devis/niveau attendu. Aucun état complet du village ni droits décidés par le client. Les schémas refusent les champs inattendus et bornent les listes/tailles.

UUID et empreinte portent l'action et son contenu canonique, avec monde/village/propriétaire. L'ordre d'une liste est conservé s'il a un sens métier. Un même UUID avec un autre contenu est refusé. Mise à jour d'une borne de transport ou reconnexion n'altère pas l'intention.

### 7.2 Confirmation

Forme indicative, discriminants et champs exacts à typer dans packages/contracts :

~~~json
{
  "protocol": 2,
  "worldId": "uuid",
  "villageId": "uuid",
  "commandId": "uuid",
  "status": "applied",
  "commandTime": "2026-10-21T18:00:00.000Z",
  "result": { "orderId": "uuid" },
  "effects": {
    "coverage": "effects",
    "observedAt": "2026-10-21T18:00:00.000Z",
    "groups": [
      {
        "stream": { "kind": "village", "key": "uuid", "epoch": "uuid" },
        "revision": "43",
        "changes": [
          { "component": "processingOrders", "upsert": [], "remove": [] },
          { "component": "resources", "upsert": [], "remove": [] }
        ]
      }
    ]
  }
}
~~~

Ce JSON illustre l'enveloppe ; les tableaux vides ne sont pas un exemple de résultat métier complet. Chaque composant possède son schéma d'entité, sans value inconnu ni chemin JSON arbitraire.

États :

- applied : mutation validée ; inclut un effet différé déjà engagé, tel qu'une construction dont la fin est future.
- pending : intention durable reçue, admission/résultat encore à venir ; réservé aux mécanismes asynchrones prévus.
- rejected : refus métier certain et typé, sans mutation de la commande.
- needs-confirmation : devis corrigé selon la règle existante ; aucune réservation conservée.

Les erreurs de transport/503 restent de résultat inconnu jusqu'à consultation du reçu. Un 202 est utilisé pour une intention en attente, 200/201 pour une réussite selon la route. Une création terminant plus tard ne reste pas pending jusqu'à sa fin.

Les valeurs envoyées sont absolues et autoritaires ; les effets visuels +/- sont dérivés côté client. Seuls les composants/champs nécessaires sont transportés. Les chemins engagés sont transmis à leur création/modification, pas recopiés à chaque tick.

### 7.3 Idempotence et reçus

Réutiliser les tables de reçus existantes, avec une façade de lecture commune et seulement les colonnes manquantes. Ajouter un stockage minimal pour les actions sans reçu durable ; ne pas migrer tous les historiques vers une nouvelle table universelle sans nécessité.

Un reçu garantit l'unicité de l'effet, pas une livraison réseau exactement une fois. Rejeu identique : résultat métier d'origine et éventuellement lecture ciblée fraîche de ses entités ; aucune réconciliation, admission, tâche supplémentaire ou second débit.

Pour une intention asynchrone, le reçu possède sa propre progression monotone ; un ancien pending ne remplace pas un résultat final. Le reçu initial et ses transitions sont publiés même lorsqu'un refus n'entraîne aucun changement de stocks.

Un refus définitif enregistré conserve son résultat sous cet UUID. Une nouvelle intention ou une confirmation de devis modifié utilise un nouvel UUID. Un échec technique avant commit ne crée pas un reçu de succès. Après commit, une erreur de projection/connexion est récupérée par le reçu, sans rejouer la mutation.

### 7.4 Effets partiels et delta complet

Deux couvertures sont distinctes :

- effects : les effets de cette commande sur des clés identifiées. Une révision 43 dans ce message ne prouve pas que le client connaît tous les changements 41 et 42.
- delta : tous les changements d'un flux entre fromRevision exclus et toRevision inclus, obtenus du journal.

Seul un delta complet ou un snapshot de périmètre fait avancer le curseur canonique. Le curseur ne progresse jamais grâce à un ACK partiel.

Le client applique l'ACK comme une confirmation superposée à sa base, avec versions par flux/clé et groupe atomique. Un ACK retardé ne remplace ni une valeur confirmée plus récente ni une base couvrant déjà cet effet. La confirmation est retirée quand tous ses groupes pertinents sont couverts par la base.

Généraliser ainsi les garanties déjà présentes pour la construction et le HUD, au lieu d'ajouter un troisième mécanisme concurrent.

### 7.5 Lots de synchronisation

Un lot contient son contexte, sa génération d'abonnement, observedAt et des groupes typés :

- delta : epoch, fromRevision, toRevision, upsert/remove des seules entités touchées ;
- scope-snapshot : périmètre explicitement complet, epoch et revision ;
- invalidation : pour une requête paginée ou un artefact versionné ; ne vaut pas livraison du contenu ;
- receipt : progression d'un reçu de commande ;
- heartbeat / expired : continuité du transport ou expiration de l'autorisation.

Le serveur prend les révisions, le journal et les entités dans **la même vue REPEATABLE READ READ ONLY**. Le delta jusqu'à V est construit depuis l'union des clés modifiées entre la base et V, puis la lecture de leur valeur dans cette vue. Il peut condenser plusieurs changements intermédiaires ; les reçus conservent le résultat des commandes.

Les suppressions ont des tombstones dans le journal. Un snapshot partiel ne supprime rien hors de son périmètre explicite. Un ordre de collection n'est envoyé que lorsque le métier en a besoin.

Les dépendances entre flux d'un batch sont enregistrées. La reprise élargit les flux à lire à leurs dépendances autorisées ; un changement bâtiment/occupation n'est pas livré comme deux états sans lien. Aucun contenu privé d'un autre joueur n'est ajouté à cette occasion.

Cet élargissement est calculé jusqu'à fermeture sur les flux pertinents dans la même capture. Les références privées non autorisées sont filtrées avant sérialisation, y compris leurs révisions et identifiants internes. Si la fermeture ou son journal n'est plus disponible, reprendre ensemble les périmètres autorisés concernés par snapshot. La transaction de lecture est fermée avant tout calcul CPU indépendant ou écriture sur le socket SSE.

L'application cliente valide tout le lot avant publication React/Babylon. Bases exactes : appliquer ensemble. Lot entièrement couvert : ignorer. Trou, epoch différente, composant invalide ou couverture partielle incompatible entre plusieurs flux : conserver l'état, demander une reprise ciblée cohérente. Ne pas appliquer arbitrairement la moitié restante d'un batch dont l'autre moitié est déjà dépassée.

### 7.6 Endpoints de lecture et stream

Nouveaux endpoints proposés, sous le préfixe village :

| Endpoint | Usage |
|---|---|
| GET bootstrap | État initial minimal cohérent, versions/epochs, références d'artefacts, capacités de protocole. |
| POST sync/read | Lecture/reprise de composants ou flux explicitement demandés, avec vecteur des curseurs réellement appliqués. Opération sans mutation métier. |
| POST sync/stream | Réponse text/event-stream ; corps JSON borné contenant abonnements et curseurs appliqués. |
| POST commands/receipts/read | Lecture groupée et bornée de reçus par famille/UUID ; les routes de reçus existantes peuvent rester des adaptateurs. |

Pour V2, consommer SSE avec fetch/ReadableStream permet de transmettre le vecteur dans le corps et d'éviter URL géante ou registre serveur de jetons d'abonnement. Cela reste HTTP/SSE. Conserver cookies same-origin et les contrôles d'origine/session ; aucun secret ni payload métier dans l'URL.

Le lecteur SSE doit gérer les coupures UTF-8, lignes CRLF, champs et messages répartis sur plusieurs chunks, limites de taille, AbortController, fermeture et reconnexion. La génération locale neutralise tous les callbacks et réponses HTTP de l'ancien monde/village.

Le client reprend depuis les curseurs **appliqués**, jamais depuis le dernier événement seulement reçu. Last-Event-ID n'est pas une preuve d'application. Une base cliente arbitraire n'accorde aucun droit.

Un curseur n'est réutilisable que si la copie correspondant à sa projection est encore disponible. Persister la paire état/curseurs atomiquement, ou refaire un bootstrap au reload ; un cursor conservé seul dans le stockage de session ne permet pas de sauter les données perdues.

## 8. Initialisation, abonnements et client

### 8.1 Initialisation

Le bootstrap contient le minimum nécessaire au premier affichage et aux interactions courantes : identité/contexte, stocks, synthèse population, bâtiments/ordres actifs utiles, versions des composants et références des catalogues. Conserver les données requises par les animations actives.

Terrain lourd, géométrie/illustrations, catalogue immuable et réseau de présentation indépendant restent des artefacts versionnés ou des lectures séparées. Historique de reçus, offres et détails scientifiques sont chargés à la demande avec pagination. Aucune donnée utile ne disparaît : le manifeste des composants décrit où la récupérer.

Le bootstrap et ses cursors proviennent d'une même capture cohérente. La connexion SSE lit les changements postérieurs à ces cursors ; elle ne renvoie pas un deuxième village complet si les bases restent récupérables. Une écriture entre HTTP et SSE est donc rattrapée.

La suppression du réveil économique de bootstrap dépend du lot H et des preuves d'autonomie des workers. Avant ce lot, conserver explicitement l'adaptateur historique ; ne pas annoncer des lectures pures tant qu'il est actif.

### 8.2 Abonnements

Abonnement privé du village et reçus toujours actifs pendant la session ; composants détaillés optionnels selon les besoins. Le serveur garde une progression séparée pour les projections effectivement chargées : un curseur avancé pour une synthèse ne certifie pas qu'une liste jamais chargée est présente.

Pour rester simple, un flux privé initialement chargé reçoit tous ses changements nécessaires à la copie privée canonique. Les détails volumineux exclus sont des lectures distinctes identifiées, avec leur version propre et invalidation ; ils ne sont pas silencieusement omis d'un delta annoncé complet.

La projection privée est identifiée/versionnée et définit ses règles de présence : par exemple ordres actifs et données nécessaires à leurs affichages, sans tout l'historique des ordres terminés. Bootstrap et delta appliquent les mêmes règles ; une sortie de cette projection produit une suppression même si la ligne historique existe encore en base. Le changement de ces règles change la version de projection et impose une reprise, pas un filtrage opportuniste selon le HUD ouvert.

Chunks spatiaux : abonnement limité aux zones chargées et marges utiles, plus dépendances de missions affichées. Lors d'un ajout, snapshot du nouveau périmètre et curseur capturés ensemble ; lors d'un retrait, arrêter la diffusion sans supprimer les données durables ni l'autorité des missions hors écran.

Connaissances et permissions filtrent chaque lecture. Les coutures du tore, halos de relief et cellules adjacentes réellement affectées font partie des invalidations spatiales.

Une liste d'offres paginée reçoit une invalidation de requête et relit sa page si visible ; elle ne prétend pas posséder tout le marché à partir d'une page. Le changement de HUD ne ferme pas le flux privé ni la file locale des commandes.

### 8.3 État local et rendu

Conserver une base canonique normalisée, les détails chargés, une file d'intentions non résolues et les confirmations versionnées. Une façade de sélection fournit progressivement les formes attendues par les composants React/Babylon actuels.

Ne pas reconstruire un gros VillageState puis redifférencier toutes ses collections à chaque patch. Préserver les références des entités inchangées, la durée de vie de la scène, les caches de meshes, le picking et les trajectoires engagées.

Les intentions sont conservées par compte/monde/village et UUID dans le stockage de session, comme le HUD actuel. Un timeout, changement de mode ou reload ne crée pas un nouvel UUID. Une déconnexion du compte efface les données privées locales selon la politique existante.

Les valeurs temporelles transportent leur base, taux/règle de projection et prochaine échéance utile. Le client anime les compteurs ; il ne crédite ni ne libère une équipe sur la seule fin d'une animation. Une version inchangée n'exige pas de réémettre les mêmes cohortes chaque seconde.

### 8.4 Publication et contre-pression

NOTIFY réveille la lecture après commit ; le journal est l'autorité durable. Une notification perdue ou un processus arrêté est récupéré par lecture des compteurs, sans COUNT de tout l'historique et sans connexion SQL permanente par navigateur.

Partager les lectures en vol pour un même contexte d'autorisation, flux et base ; ne pas partager les données privées entre comptes. Grouper les touches proches, sans retarder le reçu d'une action derrière une projection coûteuse.

Bornes initiales proposées : 64 KiB par commande ordinaire hors sélection spatiale autorisée ; 256 KiB par lot de stream ; 1 MiB de tampon par connexion ; 128 flux spatiaux au plus par abonnement ; regroupement nominal au plus 50 ms. Les contrats de sélection existants restent la limite métier, même s'ils sont plus stricts. Ajustements documentés après mesure.

Un lot trop grand devient une invalidation suivie d'une lecture ciblée paginée. Un snapshot paginé conserve une version stable : soit une capture bornée à durée de vie limitée, soit détection de changement et reprise ; jamais assemblage silencieux de pages appartenant à des versions différentes.

Un client lent est déconnecté avec reprise possible, sans croissance illimitée du tampon ni blocage du worker. Révocation, expiration de session/observation et changement de génération ferment les abonnements et invalident les callbacks.

## 9. Réutilisation et organisation du code

| Élément actuel | Destination |
|---|---|
| packages/contracts/src/village-sync.ts | Compatibilité V1 isolée ; contrats V2 et application pure dans des modules dédiés, typés par composant. |
| villages/service.ts | Façade provisoire puis fonctions ciblées ; assembleur initial pur séparé des commandes. |
| economy.ts, population/work.ts, modules de récolte/science/processing | Calculs et mutations de référence conservés ; dépendances explicites. |
| reconcile-economy.ts | Préparation ciblée et orchestrateur temporel partagé ; plus de finalisation générale automatique à chaque commande. |
| sync-projections.ts | Partage borné de lectures en vol et lecteurs ciblés ; cache de bases V1 supprimé à la fin. |
| sync.ts, sync-revision.ts | Publication/reprise V2 ; adaptateur V1 temporaire séparé. |
| HUD/construction confirmations | Même gestion des effets partiels, versions et reçus ; supprimer les doublons après parité. |
| NavigationCompute et caches de terrain | Réutilisés pour les calculs nécessaires ; aucun calcul du réseau de présentation dans une commande ou un delta ordinaire. |
| ObservationReads et observation-actions | Lecteurs/contrats V2 et statut réel des reçus, avec autorisation NOC conservée. |

Ne pas extraire tout service pour uniformiser les noms. Chaque extraction doit supprimer une duplication réelle ou permettre une tranche bornée. Les nouveaux noms de fichiers sont un choix d'implémentation.

## 10. Plan de migration complet

Chaque lot comprend serveur, contrats, client réellement raccordé, tests métier/transport et mesure du coût induit. Un lot reste ouvert si son endpoint est compact mais si son SSE reconstruit encore tout le village.

### A — Inventaire exécutable et références

- Mapper toutes les routes/actions, appels state/finaliseurs, tables lues et producteurs de changements.
- Étendre le harness de coût existant à la synchronisation consécutive, aux reçus, aux invalidations et aux octets réels du navigateur.
- Préparer fixtures petite, moyenne, grande et retard économique ; garder un oracle historique isolé pour comparer les résultats.
- Produire la matrice de dépendances et les mesures initiales par variante.

Sortie : aucune route de jeu sans classification, chiffres reproductibles et aucun changement de gameplay.

### B — Fondation V2 et tranche verticale atelier

- Migrations additives des flux/journal, couverture initiale des écrivains, contrats V2, reprise et application pure.
- Journal V2 alimenté en parallèle du marqueur V1 pour **tous les écrivains pouvant affecter un périmètre activé**.
- Disponibilité des lecteurs typés de tous les composants d'un flux avant son activation ; les commandes des autres familles peuvent encore être V1, mais leurs changements sont déjà lisibles par V2. Aucun delta annoncé complet ne saute une famille « pas encore migrée ».
- Implémenter start/resume/pause/cancel atelier avec stocks, équipes et fins de lots ; client et SSE ciblés.
- Adapter la création de bâtiment déjà bornée au même contrat et vérifier l'absence de régression.
- Comparaison V1/V2 en test ; shadow read ponctuel hors chemin critique en staging, jamais deux mutations.

Sortie : premier parcours complet, reprise après coupure et ACK/SSE inversés prouvés. Le prototype ne peut certifier V2 avec seulement les commandes publiant dans le journal.

### C — Population, logement et consignes d'exploitation

- Préparation ciblée des gestes, maintien des pas et groupes validés.
- Unifier les confirmations et persistance des gestes ; migrer les anciens feed/rest vers le noyau commun.
- Couvrir croissance, énergie, repos, logement, rotation et réveils de pools sans lecture mutante.
- Tester changement de HUD/reload avec plusieurs gestes en attente.

Sortie : pas de régression de direction artistique ni du nombre d'habitants ; synthèses et reçus convergent sans rechargement global.

### D — Construction restante et espace

- Améliorations, extensions, infrastructure/undo, nivellement, terraformation.
- Lecteurs d'emprise/halo ciblés ; versions de chunks, connaissance et invalidations de navigation nécessaires.
- Retirer les états complets des devis et confirmations de ces familles.
- Intégrer voisins et couture du tore ; conserver devis/tolérance et règles de protection.

Sortie : aucun changement spatial perdu pour un voisin ; pose et retours HTTP indépendants du réseau de présentation.

### E — Récoltes et exploitation

- Jardins unitaires/groupés, extraction directe, dégagement, exploitation mixte, anciens chantiers et harvest-intents.
- Réutiliser préparation commune, sélection/affectation et navigation ; reçus séparés de l'admission.
- Migrer complétions, retours, départs automatiques, repousse/occupation et reprises.

Sortie : parcours bois/pierre/Jardin complet, sans état global au dépôt d'une demande ni à son exécution.

### F — Marchés et échanges

- Oracle et toutes les variantes du marché joueurs, consultations et historique.
- Publication atomique des deux villages et de l'offre publique ; filtrage strict des informations.
- Reprises, refus, doubles acceptations, livraisons et annulations ; route certifiée sans recalcul de réseau global.

Sortie : deux joueurs convergent après coupure ; aucun double crédit/réservation et aucun stock privé divulgué.

### G — Science, connaissances et découvertes

- Ajouter les identifiants/reçus manquants à toutes les variantes synchrones.
- Programmes, formation, pause/reprise/rappel ; expéditions et connaissances joueur-monde.
- Coffres, accomplissements et découverte du Chat.
- Chargement à la demande des détails ; parcours NOC équivalent.

Sortie : toutes les variantes science utilisent V2 dans le navigateur et les droits restent partagés uniquement au bon niveau joueur/monde.

### H — Initialisation pure et derniers producteurs

- Prouver la couverture autonome des échéances, y compris longues absences et reprise après crash.
- Retirer les réveils de mutation des GET, previews, bootstrap et contrôles SSE.
- Installation/onboarding, factory, génération, scripts d'administration et observation alimentent/consomment les bons flux.
- Réduire le bootstrap et supprimer le snapshot systématique à l'ouverture/reconnexion SSE.
- Activer la rétention et tester les bases compactées.

Sortie : tous les lecteurs économiques sont purs ; l'ensemble du jeu reste fonctionnel sans dépendre d'une lecture pour progresser.

### I — Bascule par environnement et retrait V1

Ordre de déploiement technique : schéma additif et écrivains compatibles ; API/worker V1+V2 ; client V2 ; observation/mesures ; V2 par défaut ; retrait V1. Staging avant alpha. Cette spec ne constitue pas une demande de déploiement.

La sélection de protocole est cohérente par session/contexte, pas changée aléatoirement entre deux commandes. Les clients anciens restent sur un adaptateur V1 isolé pendant la fenêtre de migration ; la mutation métier reste unique, puis l'adaptateur peut encore produire son snapshot. Ses coûts sont identifiés séparément.

Ne pas maintenir indéfiniment les deux transports. Critères avant retrait :

1. Toutes les familles du catalogue et tous leurs appelants applicatifs sont en V2.
2. Deux sessions/onglets, reconnexion, ancien client et renouvellement de déploiement sont vérifiés.
3. Aucune dépendance V1 observée hors clients explicitement expirés ; couverture de toutes les surfaces, pas seulement des actions fréquentes.
4. Les mesures et l'endurance de la section 12 sont acceptées.
5. Les commandes en attente de l'ancien client restent consultables/rejouables avec leur UUID et la même intention.

Fermer ensuite l'entrée V1 avec une réponse explicite de mise à jour requise (426) et un parcours client conservant les intentions, puis supprimer adaptateurs, en-têtes spécialisés et unions de réponse historiques. Les URL métier peuvent rester ; leur résultat est V2.

Pour une ancienne action envoyée sans UUID et dont la réponse a été perdue, ne pas fabriquer un UUID et la réémettre automatiquement : vérifier son effet par la lecture ciblée ou son identité métier naturelle. Si le résultat reste indéterminé, afficher cet état et permettre une nouvelle action explicite. La migration ne peut promettre rétroactivement l'idempotence d'un appel historique qui n'en avait pas.

Dernière migration de nettoyage, séparée et conservatrice, après fin de la fenêtre de rollback : retrait des triggers/marqueurs 041 non utilisés, du COUNT historique et des structures devenues inutiles. Ne jamais effacer des reçus métier ou tâches en cours avec ce nettoyage.

## 11. Déploiement, rollback et exploitation

- Les migrations d'ajout ne réinitialisent pas les villages et ne réécrivent pas les soldes, cohortes ou trajets engagés.
- Le backfill initialise epochs et flux par lots ; les clients commencent par une capture cohérente. Une barrière de bascule ou capture concurrente prouvée évite toute écriture perdue entre backfill et activation.
- Aucun client V2 n'est activé tant que des processus anciens peuvent écrire sans publier V2. Déployer/coordonner tous les workers et outils, puis lever la barrière.
- Pendant compatibilité, retour du client/API vers V1 possible tant que le schéma additif et les marqueurs V1 restent alimentés.
- Après retrait des anciens écrivains, un rollback vers un binaire non compatible V2 impose de désactiver V2 ; à sa réactivation, nouvelles epochs/snapshots après rétablissement de la couverture. Ne pas reprendre un journal devenu incomplet.
- Si V2 publie des données incohérentes, fermer ses streams et revenir au protocole compatible ; ne pas exécuter de compensation économique improvisée.
- Surveiller retard des échéances, durée des verrous, erreurs/retries worker, journal/retenue, resynchronisations, clients lents et commandes non résolues. Pas de payload privé ni secret dans les logs.
- La production ne réalise pas des lectures complètes en shadow à chaque action pour surveiller V2. Comparaisons exhaustives en test, échantillonnage borné en staging.

## 12. Budgets et critères de performance

Les objectifs suivants sont **proposés**, à vérifier sur matériel et fixtures documentés. Aucun nombre issu du harness V1 n'est annoncé comme performance V2.

| Opération à chaud, sans retard à rattraper | Budget initial |
|---|---|
| Création simple de bâtiment | Au plus 10 appels driver SQL, transactions/auth/publication incluses ; confirmation au plus 4 KiB hors emprise composée |
| Pause/annulation d'un atelier, réglage d'un pool | Au plus 12 appels driver ; confirmation au plus 4 KiB hors lot de changements réellement affectés |
| Reçu déjà connu, lecture seule | Au plus 6 appels driver hors lecture ciblée fraîche explicitement demandée ; reçu au plus 2 KiB |
| Geste population / démarrage de travail | Budget de base au plus 20 appels driver puis coût explicite par lot de cibles ; aucune requête par habitant |
| Delta privé simple après une action | Au plus 12 appels driver ; aucune projection globale ni calcul de réseau de présentation |
| Village inactif | Pas de réassemblage périodique ; contrôles de versions groupés et heartbeat, sans historique parcouru |
| Latence des actions simples | Cible p95 serveur <= 150 ms à chaud sans contention ; p95 <= 300 ms pour les gestes avec affectation, à confirmer sur VPS |

Les transactions de rattrapage, calculs de trajet, sélections surfaciques et repas de tout un groupe ont des budgets séparés proportionnels aux éléments réellement concernés. Ne pas prétendre que trois requêtes regroupant des milliers d'opérations constituent un coût constant.

Rapporter par variante : appels driver et requêtes internes importantes, lignes examinées/modifiées, temps SQL, attente/durée de verrou, CPU de projection, octets avant/après compression, messages HTTP/SSE, temps jusqu'à effet visible, allocations/mémoire pertinentes.

Fixtures : petite, dix fois plus grande, cent fois plus grande lorsque réalisable, et village représentatif de production anonymisé ou reproduit. Ajouter des données **sans rapport** pour mesurer leur influence séparément de l'augmentation du groupe visé. Les opérations indexées peuvent coûter différemment ; le critère est l'absence de parcours/projection des collections étrangères à l'action.

Pour chaque scénario : échauffement puis au moins trente répétitions mesurées ; rapport médiane/p95/max, charge de fond, nombre de clients, état des caches et taille de la base/journal. Les actions mutantes utilisent des fixtures reproductibles et un nettoyage identifié.

Mesurer aussi le froid, dix à cinquante connexions simulées selon la capacité du VPS, une session lente, plusieurs villages indépendants et un rattrapage actif. Endurance staging d'au moins deux heures avec progression du jeu, purge du journal et reconnexions ; mémoire et retard ne doivent pas croître sans borne. Ajuster ces nombres explicitement si le matériel de staging impose une autre enveloppe.

Compression HTTP/SSE possible après mesure et vérification du flush du proxy ; aucun buffering ne doit retarder les ACK. Conserver JSON lisible tant que la taille restante ne justifie pas un format binaire.

## 13. Preuves fonctionnelles et de concurrence

### Parité métier

- Comparer l'oracle existant et la cible sur les mêmes fixtures, décisions et bornes ; soldes exacts, fractions, réservations, équipes, ordre des transitions et tâches nouvelles.
- Mélanger fins de construction, arrivées, récoltes, lots ateliers et retours à des dates entrelacées ; vérifier les successeurs et les égalités d'échéance.
- Tester droits monde/joueur, tore, protection spatiale, connaissances et refus sans écriture.
- Rejouer tous les UUID et réutiliser un UUID avec un payload différent ; aucun double effet.
- Aucun lecteur/preview/SSE n'écrit de donnée économique, n'acquitte une tâche ni n'admet un travail.

### Synchronisation

- Mutation validée entre bootstrap et ouverture SSE ; crash après commit avant NOTIFY ; notification perdue sans événement ultérieur.
- ACK avant/après SSE, deux ACK inversés, HTTP timeout après commit, résultat final avant ancien reçu pending.
- Trou de curseur, duplicate, epoch changée, base compactée, suppression/réapparition, changement de chunk et de mode.
- Commande touchant village et espace ; transaction de marché touchant deux villages ; knowledge partagée par deux villages du même joueur.
- Un lot invalide ne modifie aucune partie de l'état ; un ACK partiel ne fait pas avancer le curseur complet.
- Données privées absentes du stream voisin, du marché public et d'une ancienne autorisation révoquée.

### Entrelacements forcés

Utiliser des barrières bornées et, si nécessaire, observer l'attente PostgreSQL. Deux promesses concurrentes ne constituent pas la preuve.

- Deux transactions du même flux valident dans l'ordre imposé par son compteur ; deux flux indépendants peuvent valider en ordre inverse sans perte.
- Deux villages touchent deux chunks/gisements en sens opposés ; ordre canonique et absence de verrou métier après publication.
- Commande attendant le village : H est post-attente, débit et projections partagent la bonne borne.
- Compaction pendant une lecture de reprise : journal/plancher/snapshot restent cohérents.
- Savepoint puis erreur injectée après mutation et touche observées : rollback des soldes, réservations, tâches, reçu, journal et version.

### Navigateur et opération

Parcours réels pour chaque panneau, ordinateur et tactile là où pris en charge ; observer le payload réellement envoyé, le résultat affiché et l'absence de GET village consécutif.

Rejouer spécifiquement : plusieurs gestes Chantiers, changement de mode et retour ; repas de tous les actifs ; pose/amélioration ; pause/reprise atelier ; commerce à deux comptes ; terraformation avec devis révisé ; expédition en attente/reprise.

Tester session sans navigateur pendant les échéances, redémarrage worker/API, ancien client au déploiement, observation NOC, retour au jeu après compaction. Ne pas confondre succès des tests de protocole et validation du rendu.

## 14. Définition de transition terminée

La transition est terminée seulement lorsque :

1. Toutes les lignes du catalogue sont migrées ou retirées avec leurs appelants identifiés.
2. Aucune commande V2, aucun reçu et aucun delta ordinaire n'appelle state ou une projection générale.
3. L'assembleur initial est pur et réservé à l'initialisation/récupération explicite ; plus de finaliseur économique implicite dans les lecteurs.
4. Toutes les mutations, y compris workers et administration, publient les changements atomiquement.
5. Les versions n'utilisent plus un COUNT historique mondial ; reprise et compaction sont prouvées.
6. Le navigateur utilise V2 pour chaque famille ; aucun raccord seulement théorique ou limité au harness.
7. Les règles de gameplay, l'atomicité et les permissions passent les régressions ; les performances de bout en bout respectent les budgets acceptés.
8. Le protocole et les marqueurs V1 sont retirés après la fenêtre de rollback, avec reçus/intentions en cours préservés.
9. Les docs d'architecture décrivent le comportement effectivement livré, accompagnées du rapport de mesures et des limites restantes.

## 15. Vérification de cette spécification

Cette rédaction s'appuie sur une lecture des routes village/terrain/onboarding, des contrats et du client, du réconciliateur, des confirmations, du scheduler, du commerce et des lecteurs d'observation. Elle ne constitue ni une nouvelle recette applicative ni un benchmark.

Contrôles documentaires attendus avant clôture : liens et chemins locaux, couverture des variantes d'action, cohérence des limites/versions, statut prospectif des renvois d'architecture et diff sans artefact personnel. Les preuves applicatives des sections 12–13 seront produites lors de l'implémentation.
