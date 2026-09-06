/# Habitants par cohortes et récolte différée du Jardin — spécification pour Terra

Date : 5 septembre 2026. Auteur : Astra/Codex. Base relue : commit `4dfd494`, avec migration 009. Aucun code applicatif modifié pour cette rédaction.

## 0. Statut et contrat d'exécution

Cette spec couvre le socle de population, son énergie, les logements, la réserve cachée de l'Hôtel de ville, puis une récolte de Jardin d'une minute avec personnages visibles. Elle ne couvre pas l'exploitation des gisements.

Toutes les règles de cette spec sont validées au 5 septembre 2026. Si le code réel contredit cette spec, rapporter le conflit ; ne pas élargir silencieusement le diff.

## 1. Résultat joueur et règles validées

- Le village commence avec **15 habitants**, chacun à **10 d'énergie**. Ils sont représentés collectivement par des cohortes, pas par quinze identités serveur.
- L'Hôtel de ville terminé offre **30 couchages** ; chaque maison actuelle terminée en offre **5**. Les chantiers n'en offrent pas. Construire une maison ne crée personne.
- La croissance démographique, les morts et les transferts sont hors scope. L'effectif total reste 15 dans le parcours normal de cette tranche.
- L'origine désigne le village de naissance/création dans la simulation ; elle est durable. Le village de rattachement actuel est une information distincte. Initialement, les deux sont le village de départ.
- L'énergie a onze niveaux, de **0 à 10**. Idle : −1 point toutes les **2 h 12** (10 → 0 en 22 h). Working : −1/h. Resting : +2/h. Fighting : −4/h, documenté seulement ; aucun combat à implémenter.
- Sans affectation, un habitant reposé est idle. À 0 il commence automatiquement à se reposer, jusqu'à 10. Il reprend ensuite son affectation si elle subsiste, sinon redevient idle. Le repos anticipé est autorisé ; son interface exacte est à fermer en section 12.
- Une carotte consommée restaure un point, sans dépasser 10. Chaque habitant peut récupérer au maximum **2 points par alimentation entre deux repos qualifiants**. Le quota est réinitialisé après **5 heures continues de repos**, même s'il atteint 10 avant ces cinq heures. Une micro-sieste ne réinitialise rien.
- L'Hôtel de ville contient **2 000 carottes cachées**, à découvrir explicitement dans son menu. La réserve se récupère une seule fois ; elle est distincte du stock utilisable.
- Une récolte de Jardin dure **60 secondes au total**, trajet et retour compris. Un habitant est mobilisé par cellule active : dix cellules demandent dix habitants. Les cellules d'extension encore en chantier sont exclues.
- Des personnages provisoires visibles donnent vie au village et à la récolte. Ils ne constituent pas des personnes persistantes distinctes des cohortes.

La récolte est entière : elle refuse de partir si tous les habitants nécessaires ne sont pas disponibles, réserve le buffer entier au départ et ne s'annule pas pendant sa minute. Seuls les habitants capables de tenir la minute peuvent partir. La progression énergétique exacte est conservée entre deux niveaux affichés. Repas et repos sont des commandes collectives manuelles : pas d'alimentation automatique ; un repos volontaire dure cinq heures minimum et n'offre pas de réveil anticipé dans cette tranche.

## 2. Invariants

1. La somme des effectifs des cohortes est conservée lors de toute séparation, réunion ou affectation. Un travailleur reste un habitant de son village, pas un effectif ajouté au compteur.
2. Aucun habitant ne participe à deux récoltes simultanées. Aucun groupe ne travaille et ne récupère par repos en même temps.
3. L'énergie, la progression entre paliers et le quota alimentaire sont conservés lors d'une séparation. Une fusion ne crée ni énergie ni quota ni temps de sommeil.
4. Deux cohortes ne sont fusionnables que si toutes leurs caractéristiques métier et leurs progressions futures sont équivalentes à une même borne. L'origine fait partie de cette équivalence. Ne jamais remplacer des états différents par une moyenne.
5. Pour une récolte, toute carotte se trouve dans le buffer, dans la réservation en transit, ou dans le stock village. Elle ne peut être comptée à deux endroits. La nouvelle production pendant le trajet est distincte de la réservation.
6. Une même intention de commande rejouée ne lance pas une seconde action, même après l'achèvement de la première. L'acquittement tardif d'une tâche ne reproduit pas le crédit.
7. À état initial, commandes acceptées et borne finale identiques, le résultat est indépendant de l'ordre de découverte des échéances. Toutes les mutations sont atomiques avec leurs ressources et affectations.
8. Les quantités, dates, effectifs requis, disponibilités et permissions viennent du serveur. Authentifier le compte, vérifier le village possédé et le `worldId` sur chaque accès.
9. Une représentation Babylon n'est jamais la source de vérité d'un habitant ou d'une récolte. Un refresh ne relance pas le travail et ne crédite rien par lui-même côté client.

## 3. Existant vérifié

| Chemin | Garantie actuelle / changement nécessaire |
|---|---|
| `apps/api/src/database/seed.ts`, `seedDevelopmentData()` | Village de développement, Hôtel de ville, 2 000 bois et **50 carottes ordinaires**. Pas de population. Le seed préserve les stocks existants avec `doNothing`. |
| `database/migrations/004_world_economy_foundation.ts` | Catalogue `town-hall`, `dwelling`, `garden`, modes de progression. Les maisons actuelles ont une entrée niveau 1 ; pas de capacité résidentielle. |
| `modules/villages/service.ts`, `state()` | Snapshot commun avec ressources projetées, emprises actives/réservées et Jardin. Pas de population ni de trésor. |
| `modules/villages/economy.ts`, `activeSurface()`, `bufferedRates()` | Production/capacité du Jardin multipliées par le nombre de cellules actives. Buffer commun par bâtiment/ressource ; pas un stock par parcelle. |
| `service.ts`, `harvestGarden()` | Verrou village via `beginVillageEconomy`, puis bâtiment/buffers, matérialisation, crédit immédiat au village et vidage du buffer dans la même transaction. À remplacer par lancement/réservation. |
| `modules/villages/routes.ts` | `POST /api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/harvest`, réponse `VillageState`, sans corps d'idempotence actuellement. |
| `modules/villages/reconcile-economy.ts` | Verrou village, borne `statement_timestamp()` après acquisition, fusion chronologique constructions/extensions. À étendre seulement aux échéances nécessaires à cette tranche. |
| `jobs/scheduled-tasks.ts` | Acquisition tâche `FOR UPDATE SKIP LOCKED`, savepoint du handler, rollback avant retry `availableAt`, acquittement de sa seule tâche. À conserver. |
| `database/migrations/009_economic_task_notifications.ts` | Seules les notifications `building.complete` sont exemptées d'unicité pending par sujet. Utiliser un ID de récolte unique comme sujet, pas l'ID du Jardin. |
| `packages/contracts/src/villages.ts` | `GardenSchema` expose buffer, capacité, compte des cellules, extension ; pas de récolte en cours. |
| `apps/world-web/src/api/client.ts`, `App.tsx` | Appel de récolte et remplacement du snapshot ; bouton du menu Jardin. À faire évoluer pour la durée et les effectifs. |
| `apps/world-web/src/scene/BabylonVillageScene.ts` | `update`, `selectSite`, animation de scène et `dispose` ; pas de population animée. Picking des sites via `siteId`. Ajouter une petite couche de personnages indépendante du terrain. |
| `database/reset-e2e.ts`, tests économiques et verticaux | Fixtures réinitialisent les stocks et bâtiments dans la base `_test`. Adapter l'ordre de nettoyage aux nouvelles FK, conserver le monde généré. |

Ces constats proviennent de lectures du worktree. Aucun nouveau comportement n'a été reproduit, aucun test exécuté et aucune mesure de charge réalisée pendant la rédaction. Le brief `docs/architecture/Sol-Brief-exploit.md` reste un document de cadrage des gisements, pas la spec à implémenter ici.

## 4. Modèle minimal recommandé

Ajouter une migration additive après 009, enregistrée dans `database/migrate.ts`. Ne pas réécrire les migrations historiques, réinitialiser la base de développement ou modifier ses stocks existants.

### Population

- `village_population` : `(world_id, village_id)` unique, date d'initialisation. Permet de distinguer une population déjà initialisée d'un village à initialiser, même si son effectif devient nul ultérieurement.
- `population_cohorts` : ID, monde, village actuel, village d'origine, effectif entier strictement positif, activité (`idle`, `working`, `resting`), niveau d'énergie, progression énergétique, borne de calcul, quota alimentaire utilisé (0..2), début de repos nullable, récolte affectée nullable.
- Stocker les liens village/monde avec FK composites cohérentes. Ne pas créer une ligne par personne, un métier exclusif, un inventaire individuel ou une table de qualifications inutilisée.
- Les IDs de cohortes sont des IDs techniques temporaires. Le client ne doit pas les traiter comme des identités personnelles durables.
- Effectif total et disponible sont dérivés ; pas de second compteur à maintenir indépendamment. Capacité dérivée des bâtiments terminés et de leur capacité catalogue : town-hall=30, dwelling actuel=5. Ne pas créer un système d'attribution des lits.

### Récoltes

- `garden_harvests` : ID, monde/village, bâtiment, dates de départ et d'achèvement prévu, état en cours/terminé, date de crédit, effectif requis au départ, quantité de carottes réservée, commande d'origine.
- Conserver les cellules actives du départ dans une petite table fille ou un payload structuré validé côté serveur. Le trajet et le nombre de figurants restent stables même si une extension termine pendant la minute.
- Les cohortes affectées portent la référence de récolte ; la somme de leurs effectifs égale l'effectif requis tant qu'elle est active. Pas de table doublonnant les mêmes effectifs sans nécessité.
- Index unique partiel sur le Jardin ayant une récolte en cours. Une tâche `garden.harvest.complete` utilise **l'ID de récolte** comme sujet. Les récoltes terminées restent consultables pour idempotence.

### Réserve cachée et répétition HTTP

- Une réserve par Hôtel de ville, avec quantité 2 000 et `claimed_at` nullable. Pas d'ajout au stock avant découverte. Ne pas la recréer au redémarrage ou au seed.
- Pour les commandes répétables (récolte, repas et repos si retenus), ajouter un reçu de commande borné à ce module : village/monde, `commandId` UUID, type, paramètres normalisés, résultat métier/ID de récolte. Unicité par village et commande.
- Sous le verrou village, un même ID et les mêmes paramètres retournent le résultat déjà accepté avec un snapshot actuel ; un ID réutilisé avec d'autres paramètres est refusé. Pas besoin de rendre le JSON de réponse historiquement identique.
- Le coffre peut être protégé par son unique `claimed_at` ; les retries retournent « déjà découvert » sans recrédit. Pas de framework général d'idempotence.

## 5. Temps, énergie et cohésion des cohortes

Extraire un petit module de calcul pur `modules/population/energy.ts` : avancer une cohorte à une borne et restituer ses transitions. Même calcul pour projection et matérialisation ; pas de tick SQL par habitant, ni de tâche scheduler pour chaque point d'énergie.

**Ne pas perdre les fractions temporelles.** Soixante récoltes d'une minute doivent coûter un point de travail au total. Garder un reste exact de progression en unités rationnelles/entières documentées ; les changements d'activité ne remettent pas gratuitement ce reste à zéro. La politique précise des paliers et de la compensation repos/dépense doit être fermée par l'arbitrage énergétique de section 12 avant codage.

Le quota appartient à chaque membre : nourrir N habitants d'un point débite N carottes et augmente de un le quota de chacun. La moitié nourrie d'une cohorte devient une cohorte distincte. Aucune consommation sans gain d'énergie ; jamais d'énergie au-delà de 10.

Un sommeil interrompu remet à zéro sa durée continue, pas le quota alimentaire déjà utilisé. À cinq heures de repos continu, le quota redevient zéro ; ne pas appliquer des réinitialisations multiples procurant des repas pendant un même repos. Le repas ne doit pas pouvoir contourner la règle par changement artificiel d'activité.

Les rythmes ne sont pas des timers JavaScript permanents. Pour une absence longue, calculer les intervalles et les cycles complets idle/repos arithmétiquement ; ne pas itérer sur chaque habitant, seconde ou point depuis la création du village. Pour un habitant sans repas ni affectation, un cycle complet pleine énergie → idle 22 h → repos 5 h dure 27 h.

Normaliser les cohortes à une borne commune avant fusion ; comparer aussi origine, affectation, reste et durée de sommeil pertinente. Les onze niveaux affichés **ne garantissent pas onze cohortes** : les progressions et affectations peuvent les fragmenter. Fusionner les états exactement équivalents après commande/achèvement. Ne pas arrondir pour gagner de la place ; mesurer la fragmentation avant de promettre une capacité de production pour 18 millions d'habitants.

## 6. Récolte : chemin transactionnel cible

Sous réserve des choix de section 12 :

1. Authentifier et vérifier le village possédé. Valider la forme de `commandId` ; ne recevoir du client ni quantité, ni effectif requis, ni dates.
2. Ouvrir la transaction, prendre le verrou village par le point d'entrée commun et sa borne H. Réconcilier les transitions dues jusqu'à H, dont population et récoltes.
3. Vérifier le reçu de commande ; retourner la même action si déjà acceptée. Vérifier le Jardin, son état courant et l'absence de récolte active.
4. Relire les occupations actives. N cellules actives nécessitent N habitants éligibles. Évaluer l'énergie à H, sélectionner de manière stable les cohortes (énergie décroissante puis ID), séparer seulement si nécessaire. Réserver les N habitants atomiquement.
5. Matérialiser le buffer à H avec `materializeBuildingBuffer()`. Si aucune carotte entière, refuser sans consommer d'effectif. Réserver tout le stock entier, mettre `storedAmount` à zéro en conservant le traitement existant du reste. Ne pas créditer le village.
6. Créer la récolte [H,H+60s], ses cellules de départ, ses affectations et sa notification, puis le reçu de commande dans la même transaction.
7. Retourner le snapshot à H : habitants occupés, récolte/dates/quantité en transit, nouveau buffer et stock village inchangé.

À H+60s, la transition économique avance les cohortes de travail jusqu'à cette échéance, crédite la réservation exactement une fois, marque la récolte terminée, libère les habitants et détermine leur activité suivante. Les fractions de production nouvelles restent dans le Jardin. Tout cela est une seule transaction.

Une extension achevée pendant le trajet augmente normalement capacité et production à son échéance. Elle ne change ni la réservation, ni les cellules, ni l'effectif de la récolte déjà partie.

Une ancienne tâche doit pouvoir retrouver le village et déclencher la réconciliation même si sa récolte est déjà terminée ; elle devient un acquittement sans nouveau crédit. Un retry HTTP avec une ancienne `commandId` ne relance jamais la récolte.

## 7. Ordre temporel et verrous

Conserver le verrou village comme barrière de toutes les mutations internes. Le coordinateur fusionne constructions, extensions et fins de récolte par `(échéance, identifiant, type)` ; ne pas réconcilier toutes les récoltes après toutes les constructions sans tenir compte des dates.

Entre deux transitions métier, avancer la population jusqu'à la prochaine échéance, puis appliquer la transition et poursuivre jusqu'à H. Définir explicitement le traitement d'une frontière énergétique au timestamp de fin de récolte : coût jusqu'à la fin, achèvement/crédit, puis activité résultante. Aucun intervalle doublé ou omis.

Convention : **tâche du worker déjà acquise → village → verrous métier**. Dans un même ensemble, cohortes et récoltes par ID, ressources par `resourceCode`. Il n'est pas nécessaire d'imposer un ordre global entre toutes les tables métier puisque toutes ces mutations sont sérialisées par le même village ; interdire toute nouvelle mutation inter-villages dans cette tranche.

- Aucune commande/réconciliation ne verrouille, modifie ni acquitte une notification existante.
- Le scheduler conserve `SKIP LOCKED`, ses savepoints et l'acquittement/retry de sa propre tâche.
- Une commande peut insérer une nouvelle notification à sujet unique, jamais attendre une ancienne tâche du même Jardin.
- Ne pas modifier la migration 009 ni introduire `SERIALIZABLE` global.
- Une lecture projette l'énergie jusqu'à H sans obligation d'écrire chaque palier. Les transitions métier dues sont toutefois réconciliées avant le snapshot, comme aujourd'hui.
- Une petite extraction de `ownedVillage`/construction du snapshot est permise si elle évite une dépendance circulaire entre population et `service.ts`. Pas de refonte générale du service ou de repository générique.

## 8. API et interface minimale

Étendre les contrats partagés plutôt que créer un second snapshot : résumé population (total, capacité, disponibles, travailleurs, repos), répartition d'énergie lisible et récolte en cours dans chaque Jardin (ID, dates, quantité, effectif, cellules). Exposer la réserve cachée dans le détail du bâtiment, pas comme des carottes déjà utilisables dans le HUD.

Conserver le chemin `/harvest`, ajouter `{ commandId }`, garder une réponse 200 contenant le snapshot enrichi. Nouveau bouton désactivé pendant l'action ; afficher « N habitants · 1 minute », progression et carottes en transit. Le client conserve l'ID d'intention pour un retry après perte de réponse ; une nouvelle intention n'est créée qu'après résolution de la précédente. Après refresh, récupérer l'action serveur avant de permettre un nouveau départ.

Ajouter une commande dédiée de découverte du coffre, authentifiée/scopée sur l'Hôtel de ville. Menu : invitation à fouiller/découvrir, puis résultat 2 000 carottes et état découvert persistant. Deux onglets ne peuvent récupérer que 2 000 au total.

Pour repas et repos, appliquer les décisions de section 12. Ne pas inventer un panneau individuel de quinze personnes ou exposer des IDs de cohortes comme personnages nommés. Les erreurs doivent distinguer Jardin occupé, buffer vide, habitants insuffisants, énergie insuffisante et commande conflictuelle.

## 9. Petits bonshommes : vraie présence, simulation bornée

- Ajouter un module de scène dédié, par exemple `scene/VillagePeople.ts`, attaché à `BabylonVillageScene.update()` et nettoyé par `dispose()`.
- Silhouettes provisoires simples, matériaux réutilisés et instances/pool. Aucun asset acheté/généré requis, aucun service supplémentaire.
- Ambiance idle : quelques figurants, nombre plafonné, trajets locaux cosmétiques déterministes et positions cohérentes avec le terrain. Ne pas faire passer ostensiblement les promeneurs à travers des bâtiments ; choisir de petites zones libres connues. Pas de pathfinding général.
- Récolte : un figurant par parcelle active de la récolte dans le cas de dix parcelles demandé. Mouvement local, geste de récolte, retour avec une indication de charge. Le serveur ne suit pas les pas.
- La phase visuelle découle de `(harvestId, cellule, startedAt, completesAt, serverTime)` ; après refresh, reprendre la phase, ne pas repartir de zéro. L'animation ne déclenche jamais le crédit API.
- L'achèvement de l'animation provoque au plus une actualisation dédupliquée du snapshot. Aucun stock anticipé si le serveur n'a pas confirmé l'achèvement.
- Ne pas reconstruire terrain/bâtiments à chaque image. Invalider la couche habitants sur les affectations pertinentes, pas seulement sur `generationVersion`.
- Budget de rendu global requis : conserver les dix récolteurs visibles du parcours d'acceptation, puis réduire/culler les figurants hors vue à grande échelle. Ne jamais créer un mesh par habitant des 30 000 théoriques. Ne pas promettre un figurant visible par travailleur à toute échelle.

## 10. Migration et initialisation

Créer les tables/index/FK et capacités résidentielles de manière additive. Initialiser une seule fois chaque village existant du périmètre à 15 habitants, origine=rattachement, énergie 10 à la date de migration ; ne pas simuler rétroactivement leur fatigue depuis la création du village.

Créer la réserve non découverte des Hôtels de ville existants, une seule fois. **Préserver les carottes ordinaires existantes**, y compris les 50 du seed : les 2 000 cachées s'ajoutent uniquement lors de la découverte. Ce choix de compatibilité conserve les données et ne remplace aucun stock existant.

Le seed des nouveaux villages emploie la même initialisation idempotente. Un seed répété ne remet ni énergie, ni population, ni coffre à neuf. Pas d'inscription/spawn à ajouter pour cela.

Adapter `reset-e2e.ts` uniquement pour les bases validées `_test`, supprimer dans l'ordre des FK les récoltes/affectations/reçus, puis restaurer la fixture population/coffre. Ne lancer aucun reset sur la base de développement. Toute application de migration au développement est une opération distincte explicitement autorisée.

## 11. Tests obligatoires et acceptation

Tests unitaires sur calcul pur, intégration PostgreSQL pour transactions/concurrence, navigateur pour le parcours visible. Les instants de référence sont contrôlés ; pas d'attente réelle d'une heure.

| Cas | État / action / résultat attendu |
|---|---|
| Initialisation et logement | Village nouvellement initialisé : 15 habitants à 10, capacité 30. Maison en chantier : 30 ; terminée : 35. Seed répété : aucun habitant ajouté, aucune énergie restaurée. |
| Temps d'énergie | Idle à 10 : à 22 h énergie 0 et début repos ; à 27 h énergie 10. Repos 0 → 10 en 5 h. Travail 1 h = −1. Tester juste avant/à/après chaque frontière et une longue absence. |
| Fraction et cohortes | Séparer 15 en 10+5, avancer séparément puis réunir les états équivalents : même total, énergie et quota. Soixante minutes de travail fractionnées coûtent autant qu'une heure continue ; pas de remise à zéro des restes à chaque affectation. Origines différentes non fusionnées. |
| Alimentation | Après règles section 12 : N habitants recevant un point coûtent N carottes ; deux gains permis, troisième refusé ; plein=aucun débit. Deux requêtes concurrentes ne dépassent pas quota/stock. 4 h 59 min de repos ne réinitialisent rien ; 5 h oui. Interruptions et repas ne contournent pas la limite. |
| Coffre | Stock initial S ; deux découvertes concurrentes puis retries/refresh : S+2 000 exactement, réserve marquée. Injecter erreur après crédit : stock et marqueur restaurés. |
| Récolte nominale | Jardin 10 cellules actives, buffer 100, 15 habitants éligibles, stock S. Départ : 10 occupés, 5 libres, buffer entier vidé, 100 en transit, stock S. À 60 s : S+100, affectation libérée, production pendant le trajet toujours au Jardin. |
| Extension pendant trajet | Dix cellules au départ, onzième achevée à +30 s : dix travailleurs et réservation inchangée ; nouveau taux/capacité depuis +30 s. La récolte suivante demande onze habitants. |
| Effectif insuffisant | Dix cellules mais neuf habitants éligibles : selon validation section 12, refus total, buffer/stock/affectations inchangés. Aucun habitant de chantier fictif ajouté. |
| Compétition de main-d'œuvre | Deux Jardins demandent chacun dix personnes sur quinze. Forcer une transaction à détenir le village et observer la seconde en attente PostgreSQL ; au plus une action acceptée. Jamais vingt affectés. |
| Idempotence | Même commandId avant/après achèvement : même harvestId, un crédit. Autres paramètres avec cet ID : conflit. Deux IDs visant le même Jardin pendant l'action : une seule récolte active. |
| Ordre défavorable | Une construction/extension antérieure et une récolte ultérieure sont dues. Faire découvrir la récolte en premier : comparer ressources, buffers, cohortes/énergie, dates et statuts avec une exécution chronologique aux mêmes bornes. |
| Worker/commande | Ancienne notification détenue par un vrai worker attendant le village ; commande détient village, réconcilie l'ancienne récolte et démarre la suivante. Observer `pg_blocking_pids`, terminer les deux sans deadlock ni double crédit. |
| Rollback | Erreur après réservation buffer+cohortes au lancement : aucune mutation ni tâche/reçu persisté. Erreur après plusieurs achèvements dans handler : rollback savepoint complet, retry différé puis un seul crédit. Vérifier l'erreur injectée exacte pour éviter un faux positif. |
| Monde/propriété | Village d'un autre compte et bâtiment d'un autre monde : refus, aucun changement. |
| Navigateur | Découvrir le coffre, lancer un Jardin de dix cellules, voir dix récolteurs, refresh à mi-parcours, observer leur retour et un crédit unique. Une extension ne redémarre pas l'animation. Pas de fuite de meshes à répétition. |

Adapter explicitement les tests existants qui attendent un crédit instantané : lancement, échéance, achèvement puis assertions de stocks. Garder leurs garanties de plafonnement, production avant/après extension, double récolte et rollback. Ne pas supprimer ces tests pour obtenir du vert.

Validation : `corepack pnpm test`, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm build` après vérification des scripts disponibles ; tests navigateur existants adaptés et parcours manuel. Documenter commandes et sorties réellement obtenues. Ne pas présenter cette suite comme un benchmark de 600 villages.

Acceptation : règles section 12 fermées ; parcours visuel complet et persistant ; tests ciblés et suites adaptées verts ; scheduler toujours `SKIP LOCKED` sans responsabilité d'ordre métier ; aucune duplication de population/carottes ; budget visuel borné ; migration conservatrice ; aucun changement hors scope.

## 12. Interface hors Babylon réservée au product owner

Le product owner réalise l'UI React/HUD. Ne pas modifier `App.tsx`, les composants React ou les styles hors Babylon dans cette tranche. Fournir à la place [le mock-up et le contrat d'intégration](./UI-MOCKUP-2026-09-05-habitants-et-recolte.md) : états, textes indicatifs, commandes HTTP et transitions de snapshot. Le backend, les contrats et la scène Babylon restent dans le périmètre de l'implémentation.

## 13. Hors scope

Gisements, stock de bois/pierre du monde, régénération, extraction par bord des îlots, libération du terrain, transport économique général, combat, qualifications militaires, caserne (50 places indicatives futures), prisonniers, adoption/loyauté, personnages nommés, croissance démographique, faim/mortalité, inscription/spawn, niveaux de maisons, lits individuels, pathfinding général, nouvelles UI hors population/coffre/récolte, assets définitifs, infrastructure distribuée, refonte générale de `service.ts` ou Babylon.

Les capacités de qualifications, captivité et incarnation future restent documentées seulement. Ne pas créer des tables vides « au cas où ».

## 14. Plan atomique pour Terra

1. **Calcul énergétique pur.** Ajouter `modules/population/energy.ts` et tests ciblés (cadences, frontières, fractions, sommeil, quota, longue absence). Sans dépendance DB ; valider les règles avant schéma définitif.
2. **Persistance et initialisation.** Migration après 009, `schema.ts`, `migrate.ts`, seed/reset test : population/cohortes, capacité, coffre, récoltes/reçus. Validation migration sur base test, init répétée, conservation des stocks et FK monde.
3. **Population et commandes collectives.** Petit service population et routes/contrats ; projection/matérialisation sous village, séparation/fusion, repas/repos. Validation énergie, effectifs, concurrence et rollback ; vérifier les tests économiques existants.
4. **Coffre et capacités visibles.** Étendre snapshot/contrats et commande de découverte. Fournir le mock-up/API pour le menu Hôtel de ville ; ne pas modifier l'UI React. Validation crédit unique concurrent, capacités aux échéances de construction, refresh.
5. **Réservation de récolte.** Modifier `harvestGarden`, route/contrats ; affectations, instant départ, buffer en transit et idempotence. Validation départ atomique, manque d'effectif, mêmes/requêtes différentes et crash.
6. **Achèvement temporel commun.** Étendre `reconcile-economy.ts`, ajouter handler de notification et l'enregistrer là où les handlers actuels sont assemblés (localiser avec `COMPLETE_CONSTRUCTION_TASK`). Validation ordre défavorable, deux workers, ancienne tâche/commande, retry et savepoint. Adapter les anciens tests de récolte, pas leurs invariants.
7. **Personnages Babylon.** `BabylonVillageScene.ts`, petit module de figurants : dix récolteurs, retour, reprise après refresh, budget/dispose. Validation navigateur et décompte de meshes stable. Ne pas modifier l'UI React.
8. **Clôture.** Suites, lint/typecheck/build, parcours manuel ; handoff avec limites et résultats effectifs. Pas de migration dev, commit/push ou déploiement sans autorisation propre à cette tranche.
