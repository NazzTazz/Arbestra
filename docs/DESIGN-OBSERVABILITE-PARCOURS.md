# Observabilité des parcours joueur — audit et conception (30 octobre 2026)

Étapes 1 et 2 du brief de Tristan (« Observabilité produit et parcours joueur »). **Statut (30 octobre) : arbitrages du §5 validés par Tristan ; sous-tranches A et C implémentées, à valider (§6) ; B et D à faire.** Lecture du code de la branche `wip/v2-commandes-bornees` (`7acaf07`) et de la base de dev locale en lecture seule (3 comptes).

## 1. Existant réutilisable

### 1.1 Identités et sessions d'authentification

- **Table `sessions`** (`apps/api/src/database/migrations/001_initial.ts:69-80`) : `id, token_hash, account_id, expires_at, created_at`. Il n'y a **ni date de dernier usage, ni fin**. Une ligne est créée à l'inscription et à chaque connexion (`modules/auth/service.ts:29-37` et `:68-77`), pour une durée de 30 jours par défaut (`config.ts:132`). `authenticate()` (`auth/service.ts:82-98`) n'écrit rien. `logout` supprime la ligne (`:115-118`). Aucune purge des sessions expirées (dev : 282 lignes depuis le 4 septembre, dont 70 expirées).
- Les **sessions du NOC** vont dans la même table (`modules/admin/auth.ts:104-109`, `:160-166`), avec un autre hachage de jeton. Une ligne ne dit pas si c'est une session admin. Seule la liste blanche `adminAccountIds` (`admin/auth.ts:85-87`) permet de les écarter par compte.
- **Ce que ça donne** : les dates de connexion explicite (rares avec un cookie de 30 jours). **Ça ne donne pas** les visites, l'activité, la fin d'une visite. Une session d'authentification n'est pas une session de jeu.
- Identités utiles : `accounts.created_at`, `world_memberships.created_at` (arrivée dans un monde, `player_name`), `villages.created_at`, installation de départ (`village_starter_installations`, migration 038).

### 1.2 Présence et cycle de vie du client

- **Battement existant à réutiliser.** Tout onglet de jeu dont le village est chargé envoie `POST …/villages/:villageId/observation/status` **toutes les 5 s, même masqué** (`apps/world-web/src/observation.ts:40-56`, minuterie `:93`, montée dans `App.tsx:175` hors installation). Côté serveur, ces requêtes sont authentifiées, rattachées au village possédé et à `hashSessionToken` (`admin/observation-routes.ts:423-446`). Le corps est aujourd'hui vide. Ce battement prouve qu'un onglet est ouvert, **pas que le joueur joue**.
- Le flux V2 `sync/stream` est une requête longue relue toutes les 2 s côté serveur (`villages/sync-v2-stream.ts:96`). Il n'est **pas compté** dans la télémétrie (`openStream`, `operations/telemetry.ts:148`, n'est appelé que par le flux V1, `villages/sync.ts:168`).
- Rechargement à la reprise de visibilité : `App.tsx:836-845`. Aucune mesure d'entrée utilisateur (clavier, pointeur) n'existe.

### 1.3 Commandes, reçus et refus

- **Crochet unique sur toutes les commandes de village** : `instrumentObservationActions` (`admin/observation-actions.ts:67-120`) enveloppe les POST reconnus par `observationCommandKind` (`:56-66`). Il fournit le type, le `commandId` (UUID), la cible, `businessOutcome` (`accepted` / `pending` / `rejected`), le code métier `HttpError` des refus 4xx (`:113`), le statut HTTP et l'interruption du transport. L'engagement est relevé à la sortie de la transaction (`observationCommitted`, appelé dans `villages/routes.ts`). Le rattachement compte/village/monde passe par la lecture de propriété existante (`ownedVillage`, `villages/service.ts:173`, et `construction.ts:75`), sans SQL supplémentaire.
  - **Limites** : (a) le crochet ne fait rien hors observation NOC (`if (!hub.collecting)`, `:74`, puis `hub.active`, `:27`) ; (b) la collecte reste **en mémoire**, 500 actions et 15 min par village, 8 Mio au total (`admin/observation-hub.ts:206-226`), et disparaît au redémarrage ; (c) `discover-cat-eyes` et `villages/:villageId/starter` ne sont pas dans la liste, alors que l'inventaire `tests/fixtures/command-inventory.json` compte 29 mutations ; (d) les refus de schéma (400 de validation Fastify) ne passent pas par le handler.
- **Reçus d'idempotence** : clé primaire `(world_id, village_id, command_id)` (par ex. `011_population_command_receipts.ts:12`, `027_building_command_receipts.ts:13`). Tables : `population_command_receipts`, `building_command_receipts` (→ `building_id`), `infrastructure_receipts` (son `session_id` est une session d'éditeur, pour l'annulation), `processing_command_receipts` (→ `order_id`), `trade_receipts`, `hud_workforce_receipts`, `extraction_worksite_commands`, `starter_pose_receipts`, `harvest_intents` et `harvest_submissions` (reçu JSON par case), `harvest_intent_cancellations`, `expedition_submissions` (reçu `rejected`/`failed` avec code), `leveling_jobs`, `market_exchanges`, `exploitation_orders`.
  - **Ce que ça donne** : les commandes **acceptées** avec leur `command_id`. Plusieurs tables n'ont pas d'horodatage (`trade_receipts`, `hud_workforce_receipts`, `starter_pose_receipts`, `extraction_worksite_commands`). Le résultat différé est lié par identifiant : `buildings.completed_at`, `leveling_jobs.completed_at`, `market_exchanges.completed_at`, science et expéditions.
  - **Ce qui manque** : les **refus**. La transaction est annulée et rien n'est écrit, sauf les reçus partiels de récolte et d'expédition. Il n'y a pas non plus d'horodatage uniforme, ni de vue unique ordonnée.
- Les rejeux sont déjà neutralisés par ces reçus : un même `commandId` renvoie le même reçu. Il ne faut donc **jamais compter une action à partir des requêtes**, mais par `commandId`.

### 1.4 Journaux, notifications, accomplissements

- **Accomplissements** : `village_accomplishments(code, completed_at)` (`014_village_accomplishments.ts`). Codes observés sur le dev : `town-hall-supplies`, `first-harvest`, `first-woodcut`, `cat-eyes`. C'est la progression initiale, prête à afficher.
- **Activités du NOC** : `admin/service.ts:81-139`, union des expéditions, de la science et des tâches, déjà par compte (`AccountPage`).
- **`scheduled_tasks`** : contrainte unique `(world_id, task_type, subject_id)` (`002_deferred_actions.ts:78`). Une notification est **réutilisée** : ce n'est pas un historique, et elle décrit des transitions automatiques. À ne pas afficher comme action.
- **Journal V2 `game_sync_changes`** : différences d'état par flux, conservées 7 jours et 10 000 entrées par flux (`villages/sync-v2-retention.ts:10-16`, minuterie `server.ts:23`). Il ne distingue pas action et transition automatique. Ce serait une seconde lecture de l'économie : **non retenu**.
- Diagnostic HTTP : en mémoire, 10 min (`operations/http-diagnostics.ts:15`). Les accès au NOC sont journalisés (`admin.access` et `admin.denied`, `admin/auth.ts:113-116`).

### 1.5 NOC

- Le NOC est `apps/admin-web` (React). Navigation dans `App.tsx` (rubriques `accounts`, `activities`…, routage par fragment `:225-255`) ; pages dans `pages.tsx` (`AccountPage` `:938`, `VillagePage` `:1007`) ; appels dans `api.ts`. Côté API : `modules/admin/routes.ts` (préfixe `/api/admin`, `requireAdmin` à chaque appel : cookie admin, origine, liste blanche, journal d'audit), lectures dans `admin/service.ts` via `AdminReadCache` (en vol bornées, cache court). **Ajouter une vue** revient à écrire un `GET` dans `routes.ts`, une lecture dans `service.ts`, un schéma dans `packages/contracts`, une page et un lien dans `pages.tsx`.

### 1.6 Les cinq questions face à l'existant

| Question | Déjà possible | Manque réellement |
|---|---|---|
| 1. Quand est-il venu ? | Connexions explicites (`sessions.created_at`, mêlées aux sessions admin), dates des commandes acceptées (selon les tables) | Visites réelles : début et fin de présence |
| 2. Combien de temps actif ? | Rien | Mesure d'activité (entrées) par minute |
| 3. Actions, ordre, résultats | Commandes acceptées dispersées dans une quinzaine de tables, résultats différés par jointure, accomplissements | Journal unique horodaté des commandes, avec issue |
| 4. Refus, annulations, abandons | Annulation de récolte (`harvest_intent_cancellations`), reçus partiels de récolte et d'expédition | Refus des commandes (code), annulations et abandons côté client |
| 5. Répétitions entre visites | Possible sur les acceptées, laborieux | Agrégation à la lecture une fois 1 à 3 disponibles |

**Volontaire ou automatique.** Les commandes POST sont volontaires. Les fins de chantier, accomplissements, fins de repos et énergie (`population.energy`), arrivées et notifications sont automatiques ou différés. Seules les fins **reliées à une commande** (bâtiment, nivellement, échange, expédition) et les accomplissements figurent dans la chronologie, marqués « différé » ou « automatique ».

## 2. Modèle minimal proposé

### 2.1 Définitions (uniformes, documentées dans `docs/architecture/operations.md` à la livraison)

- **Minute de présence** `(compte, village, minute)` : au moins un battement `status` reçu dans la minute, onglet visible ou non.
- **Minute active** : un battement de la minute signale une entrée utilisateur (appui de pointeur, touche, molette) avec l'onglet visible, **ou** une commande est reçue dans la minute. Plusieurs onglets écrivent la même ligne et ne comptent qu'une fois.
- **Session de jeu** : suite de minutes actives d'un compte dans un village, séparées de **moins de 15 min**. Les bornes et le statut de fin :
  - **Début** : première minute de présence contiguë qui précède la première activité (le chargement est inclus), au plus 15 min avant.
  - **Dernière activité** : dernière minute active.
  - **Durée active** : nombre de minutes actives (précision de 1 min).
  - **Fin** : dernière activité + 1 min.
  - **Statut de fin** : *déconnexion* si la présence s'arrête dans les 2 min qui suivent la dernière activité (onglet fermé, fermeture brutale), *expiration* si la présence continue 15 min sans activité (onglet oublié), *en cours* si la dernière activité date de moins de 15 min.
- **Visite sans activité** : présence sans aucune minute active (onglet ouvert sans être touché). Affichée à part, sans compter comme session.
- **Reconnexion, rechargement, redémarrage du serveur** : un trou de présence de moins de 15 min ne coupe pas la session. Au redémarrage, le battement reprend dès que le client se reconnecte. Les minutes encore en mémoire et non écrites sont perdues : au plus 30 s, limite documentée.
- **Tout est calculé à la lecture** (îlots par fonctions de fenêtre SQL sur des lignes bornées : au plus 1 440 par jour et par village). Il n'y a pas de table de sessions à maintenir.

### 2.2 Données serveur à ajouter

1. **Journal des commandes**, branché sur le crochet existant `instrumentObservationActions`, qui devient indépendant du hub. Le hub continue d'être alimenté seulement s'il observe. Le rattachement reste celui de `ownedVillage` / `construction.ts` (sans `hub.active`). On ajoute `discover-cat-eyes` et `starter` de village à `observationCommandKind`, et un test compare la liste à l'inventaire des mutations.
2. **Écriture hors transaction et différée** : le handler ne fait qu'empiler un objet dans un tampon mémoire borné (2 000 entrées ; au-delà, compteur `dropped` visible dans le NOC). Un vidage toutes les 5 s, et à `onClose`, écrit un seul `INSERT … ON CONFLICT` multi-lignes. Rien n'est ajouté à la transaction métier, et un refus (transaction annulée) est quand même journalisé. Un échec de vidage est retenté une fois au vidage suivant, puis abandonné et compté. Perte maximale en cas de plantage : 5 s.
3. **Sans double comptage** : unicité `(world_id, village_id, command_id)`. Un rejeu fait `attempts = attempts + 1`. L'issue n'est remplacée que si la précédente était `interrupted` ou `error` (une première tentative coupée, puis un succès, donne une seule action acceptée). Un refus suivi d'un nouvel essai a un nouveau `commandId`, donc deux lignes : c'est voulu.
4. **Présence** : le corps de `status` reçoit un champ optionnel `journey: { tab: uuid, visible: bool, input: bool, events: [...] }`. Le serveur agrège en mémoire par `(compte, village, minute)` (« OU » des drapeaux) et vide toutes les 30 s par un upsert multi-lignes. Aucune requête supplémentaire.
5. **Sujet de l'action** : extraction par liste blanche et par type (type de bâtiment, recette, action scientifique, type de geste, nombre de cases). Ni coordonnées ni texte du corps.

### 2.3 Événements client (liste fermée)

`tool.open` (outil ou panneau : construction, population, exploitation, nivellement, voirie, démolition, marché, science, transformation, journal), `intent.start` (début d'un placement ou d'une sélection, avec `intentId`), `intent.submit` (avec le `commandId` envoyé, ce qui relie l'intention à la commande serveur), `intent.cancel` (`escape`, `button` ou `tool-switch`), `intent.blocked` (refus local affiché avant envoi, avec un code d'aperçu : place invalide, ressources insuffisantes…), `intent.abandon` (intention ouverte au changement de village ou à `pagehide`, sans validation ni annulation ; pas de délai heuristique).

- Champs : `id` (UUID, dédoublonnage), `type`, `tool` (énumération), `subject` (code catalogue, `^[a-z0-9-]{1,40}$`), `code` (même motif), `intentId`, `commandId`, `clientAt`. Rien d'autre.
- Transport : file mémoire du client (au plus 50 événements ; au-delà, compteur de pertes envoyé), jointe au battement `status` suivant (au plus 20 par envoi), avec `fetch(keepalive)` au `pagehide`. Les entrées sont captées par des écouteurs passifs qui ne notent qu'un booléen ; **rien dans la boucle de rendu**. Les appels à `track()` n'ont lieu que sur des actions de l'interface.
- Les événements client sont des **observations** : l'issue autoritaire reste celle de la commande serveur.

### 2.4 Schéma additif (migration 072)

```sql
create table player_journey_events (
  id uuid primary key,                       -- commande : uuid serveur ; client : id du client
  world_id uuid not null references worlds(id) on delete cascade,
  village_id uuid not null references villages(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  source text not null check (source in ('command','client')),
  type text not null check (type ~ '^[a-z][a-z0-9./:-]{0,63}$'),
  occurred_at timestamptz not null,          -- horloge serveur (réception)
  client_at timestamptz,                     -- horloge client, indicative
  command_id uuid, intent_id uuid,
  outcome text not null check (outcome in ('accepted','pending','rejected','error','interrupted','observed')),
  code text check (code ~ '^[A-Za-z0-9_-]{1,64}$'),
  status_code smallint, subject text check (subject ~ '^[a-z0-9-]{1,40}$'),
  tool text check (tool ~ '^[a-z-]{1,32}$'),
  attempts smallint not null default 1
);
create unique index player_journey_command on player_journey_events (world_id, village_id, command_id)
  where source = 'command' and command_id is not null;
create index player_journey_account_time on player_journey_events (account_id, occurred_at desc);
create index player_journey_time on player_journey_events (occurred_at);   -- purge

create table player_presence_minutes (
  world_id uuid not null references worlds(id) on delete cascade,
  village_id uuid not null references villages(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  minute timestamptz not null check (date_trunc('minute', minute) = minute),
  visible boolean not null, active boolean not null,
  primary key (account_id, village_id, minute)
);
create index player_presence_time on player_presence_minutes (minute);
```

Volume estimé en alpha : une centaine de minutes par testeur et par jour, quelques centaines d'événements. Négligeable.

### 2.5 Rétention et purge

90 jours (arbitrage 2). Une passe bornée (au plus 5 000 lignes par table et par passe, verrou consultatif d'exclusion comme `sync-v2-retention.ts`) au démarrage puis toutes les 6 h. La suppression d'un compte ou d'un village supprime tout par cascade. Le NOC affiche la date de la plus ancienne donnée conservée.

### 2.6 Consultation dans le NOC

- API : `GET /api/admin/journeys/:accountId?worldId&villageId&from&to&before`, protégée par `requireAdmin` et auditée. Elle renvoie : (a) les **sessions** calculées (début, dernière activité, durée active, statut de fin) et les visites sans activité ; (b) la **chronologie** paginée (500 lignes), qui fusionne à la lecture `player_journey_events`, les accomplissements et les fins différées jointes par `command_id` (`building_command_receipts` → `buildings.completed_at`, `leveling_jobs`, `market_exchanges`, expéditions et science déjà lues par `admin/service.ts`) ; (c) une **synthèse** : nombre par type d'activité et par session, première utilisation de chaque type, refus par code, annulations et abandons par outil.
- Page « Parcours » liée depuis `AccountPage` et `VillagePage` : liste des sessions, puis chronologie d'une session (heure, temps depuis le début, source *action / observation client / différé / automatique*, activité, issue, motif du refus, tentatives). Filtres : session, source, issue (refus, annulations, abandons), type. Pas de graphique.

## 3. Confidentialité (éléments de décision, pas un avis juridique)

- **Données collectées** : identifiant de compte et de village, horodatages, présence et activité par minute (booléens), types et issues d'actions, codes de refus, outil et code de catalogue. **Exclus** : adresse IP, agent utilisateur, coordonnées, positions de caméra, texte libre, contenu du marché (prix et quantités ne sont pas copiés ; ils restent dans leurs tables métier), frappes. L'e-mail n'est lu qu'au NOC par jointure.
- **Accès** : comptes de la liste blanche du NOC seulement, lectures journalisées (`admin.access`). Durée : 90 jours, purge prouvée par un test.
- **Cadre probable** : ce sont des données personnelles (liées à un compte), donc le RGPD s'applique.
  - **Journal des commandes et présence** : ce sont des faits que le serveur traite déjà ; l'intérêt légitime (améliorer et faire fonctionner le service) est plausible, avec une information claire.
  - **Événements client et drapeau `input`** : un script lit le comportement dans le terminal. La directive ePrivacy (art. 82 de la loi Informatique et Libertés en France) peut exiger un **consentement**. L'exemption « mesure d'audience » de la CNIL vise des statistiques anonymes et agrégées, pas un parcours individuel nominatif.
- **À faire par Tristan avant activation sur de vrais joueurs** :
  - Informer les testeurs : quoi, pourquoi, qui y accède, combien de temps, comment demander l'accès ou l'effacement.
  - Recueillir leur accord explicite pour les événements client, simple en alpha vu le petit groupe.
  - Ajouter une mention dans les CGU ou dans un écran d'information du jeu (il n'en existe aucune aujourd'hui), et une ligne au registre des traitements.
  - Vérifier la grille de la CNIL sur la mesure d'audience, ou demander l'avis d'un juriste avant toute ouverture publique.

## 4. Découpage en sous-tranches (environ 1 h chacune)

| # | Contenu | Tests et mesures |
|---|---|---|
| A | **Serveur, journal des commandes** : migration 072 (les deux tables), tampon et vidage, crochet indépendant du hub, liste blanche des sujets, `cat-eyes` et `starter`, purge, interrupteur de configuration `JOURNEY_ENABLED` (désactivé par défaut) | Intégration : acceptée, refusée (code), rejouée (1 ligne, `attempts = 2`), interrompue puis acceptée, aucune écriture dans la transaction métier (refus journalisé, pas d'effet métier), couverture de l'inventaire des mutations, tampon borné, purge (seules les lignes trop anciennes). Mesure : latence p50/p95 d'une commande légère (gestes de population, 50 exécutions) avant/après, durée d'un vidage |
| B | **Présence** : champ `journey` du `status` (schéma strict, absent = inchangé), agrégation par minute et vidage, écouteurs passifs d'entrée dans `observation.ts` | Deux onglets → une ligne ; trou de 4 min → même session, de 16 min → deux sessions ; onglet masqué seul → visite sans activité ; perte de 30 s au redémarrage, session continue ; mesure : coût du `status` avant/après, aucun appel par image (test du nombre d'appels) |
| C | **NOC Parcours** : contrat, lecture des sessions, chronologie fusionnée et synthèse, page et filtres | Intégration sur jeux de données : sessions calculées, fin différée hors connexion (bâtiment achevé après déconnexion), transition automatique absente, refus et rejeu affichés une fois ; tests de format admin-web ; vérification navigateur sur le dev avec une vraie session |
| D | **Événements client** : `journey.ts` (file, `track`, abandon au `pagehide`), branchement des 6 événements dans les outils | Tests unitaires (bornes, dédoublonnage, abandon), nombre d'appels à `track` borné sur un parcours scripté, mesure des images longues et du coût par image avant/après sur le dev, navigateur |

Ordre : A → C (déjà répondre aux questions 1, 3, 4 et 5 sur les commandes), puis B, puis D. **Recouvrements avec `refactor/hud-infrastructure`** (`../Arbestra-hud-infra`, qui modifie `App.tsx`, `ConstructionPanel.tsx`, `BabylonVillageScene.ts`, `DemolitionTool.tsx`, `tool-presentation.ts`) :
- A et C ne touchent pas le client de jeu.
- B touche seulement `observation.ts`.
- D touche les outils et panneaux (`ConstructionPanel`, palette, démolition, nivellement) : **à faire après la fusion de la branche HUD**.

Aucune sous-tranche ne modifie `api/client.ts`. `App.tsx` reste au plus à une ligne de montage.

## 5. Arbitrages pour Tristan

**Validés le 30 octobre** : toutes les recommandations ci-dessous (15 min et minute ; 90 jours ; interrupteur global désactivé par défaut ; comptes admin collectés et marqués ; pas de coordonnées ; abandon relevé seulement au changement d'outil ou de village et à la fermeture de l'onglet ; purge des `sessions` et comptage du flux V2 en petits correctifs séparés, hors tranche). Les testeurs ont consenti au préalable à être observés ; Tristan les prévient. **L'activation sur alpha reste soumise à son feu vert explicite.**

1. **Seuil d'inactivité de 15 min, granularité à la minute.** Recommandation : oui. C'est simple, stable, et assez précis pour quelques testeurs.
2. **Rétention de 90 jours.** Recommandation : 90 jours, qui couvrent une saison d'alpha ; à raccourcir (30 jours) si ce n'est que du débogage d'expérience.
3. **Consentement.** Recommandation : journal serveur et présence pour tous les testeurs informés ; événements client et drapeau `input` seulement après leur accord explicite. Interrupteur global désactivé tant que l'information n'est pas faite.
4. **Comptes admin (Tristan joue aussi).** Recommandation : les collecter et les marquer « admin » dans la vue, sans les exclure.
5. **Coordonnées des cibles.** Recommandation : ne pas les collecter. Codes de catalogue et nombre de cases seulement ; à rouvrir si une étude de placement en a besoin.
6. **Abandon.** Recommandation : seulement au changement d'outil ou de village et à la fermeture de l'onglet avec une intention ouverte ; pas de délai heuristique.
7. **Hors périmètre, signalé.** La purge des `sessions` d'authentification expirées (jamais faite) et le comptage du flux V2 dans la télémétrie du NOC. Recommandation : deux petits correctifs séparés, pas dans cette tranche.

## 6. Livré (30 octobre) — à valider

### A — journal des commandes (commit `241a91d`)

- **Interrupteur** `JOURNEY_ENABLED` (`0` par défaut, `1` pour activer ; toute autre valeur refuse le démarrage). Désactivé, rien n'est écrit et le crochet se comporte comme avant.
- **Crochet** `instrumentObservationActions` indépendant de l'observation NOC : l'action est liée au village par la lecture de propriété existante (`observationVillage`) si le journal est actif **ou** si le village est observé ; le hub n'est alimenté que dans le second cas, comme avant. `discover-cat-eyes` et `villages/:villageId/starter` sont couverts (l'installation appelle désormais `observationVillage` après sa lecture de propriété). `commandId` : corps, sinon en-tête `x-arbestra-command`.
- **Une ligne par requête**, enregistrée quand le handler est terminé **et** la réponse finie ou coupée : `accepted`, `pending` ou `rejected` (code métier d'un `HttpError` 4xx) d'après l'issue métier ; sinon `error` (réponse envoyée) ou `interrupted` (connexion coupée). Une commande engagée dont la réponse est perdue reste `accepted`, sans statut HTTP. Type = route sans paramètres (`buildings.upgrade`, `harvest-intents.cancel`) ; sujet = `buildingType`, sinon `action`, s'il respecte `^[a-z0-9-]{1,40}$` ; ni coordonnées ni quantités.
- **Tampon** (`modules/admin/journey-journal.ts`) : 2 000 entrées, au-delà compteur `dropped` ; vidage toutes les 5 s et à la fermeture de l'app, par un seul `insert … select from jsonb_to_recordset … on conflict`, hors de toute transaction métier (une ligne dont le village ou le compte a disparu est ignorée). Un vidage en échec est retenté une fois, puis compté `lost`. Perte maximale au plantage : 5 s.
- **Rejeu** : unicité `(world_id, village_id, type, command_id)` pour `source='command'`. Le type est dans la clé pour qu'une annulation de récolte, qui porte dans sa route le `commandId` de l'intention, ne fusionne pas avec elle. Les tentatives s'additionnent ; une issue provisoire (`error`, `interrupted`) est remplacée par la suivante ; une issue finale est gardée et ne gagne qu'un statut HTTP manquant. Même règle en mémoire et en SQL.
- **Migration 072** `player_journey_events` (schéma du §2.4 ; `player_presence_minutes` reportée à B), cascade avec compte, monde et village. Appliquée à la base de test et à la base de dev locale.
- **Purge** : `pruneJourneyEvents`, au plus 5 000 lignes de plus de 90 jours par passe, les plus anciennes d'abord, verrou consultatif d'exclusion ; au démarrage de `server.ts` puis toutes les 6 h, que la collecte soit active ou non.
- **Preuves** : `journey.integration` (9 cas : acceptée sans écriture avant vidage ; refusée avec son code et sans effet métier ; rejouée dans un même vidage puis entre deux vidages ; coupée par le client pendant l'attente du verrou du village (attente PostgreSQL observée), puis rejouée = une ligne `accepted`, 2 tentatives ; issue provisoire remplacée ; tampon borné ; interrupteur désactivé ; purge bornée ; cascade du compte), `observation-actions.test` (couverture de l'inventaire des mutations, types, sujets), `config.test`. Constat rouge par mutation : avec l'ancien filtrage (`if (!hub.collecting)`) et l'ancienne liste de routes, les cas « acceptée », « refusée » et « inventaire » échouent. Suites connexes vertes : `observation.integration` (11), `command-inventory.integration`, `service.integration`.
- **Mesure** (base de test, geste « repos », 50 requêtes par configuration alternées requête par requête, 3 passages) : avant (HEAD, code identique dans les deux colonnes) p50 64 / 90 / 78 ms, p95 76 / 223 / 99 ms ; après, journal désactivé p50 117 / 60 / 60, p95 194 / 78 / 69 ; activé p50 119 / 59 / 61, p95 180 / 80 / 72. Différence dans le bruit de la machine. Vidage de 2 000 lignes : 1,2 s, hors requête.

### C — page « Parcours » du NOC (commit `a8100af`)

- **API** `GET /api/admin/journeys/:accountId?worldId&villageId&days` (1 à 90, 7 par défaut) dans le plugin `/api/admin` : `requireAdmin` et journal d'audit `admin.access` comme les autres vues, cache court du NOC, transaction en lecture seule bornée (2 s). Lecture dans `modules/admin/journey-reads.ts`, contrat `AdminJourneySchema`.
- **Sessions**, dérivées des seules commandes tant que B n'existe pas (la page le dit) : îlots de commandes séparés de moins de 15 min (fonctions de fenêtre SQL) ; début, dernière activité, fin = dernière + 1 min, minutes actives = minutes contenant une commande, actions, refus, « en cours » si la dernière commande a moins de 15 min. 200 sessions au plus.
- **Chronologie** (500 événements au plus, troncature signalée) : actions du joueur (journal) ; fins différées reliées à une commande (`building.complete` par le dernier reçu du bâtiment, avec son `commandId` ; `leveling.complete` ; `market.complete` sans ressource ni montant ; `science.complete`) ; accomplissements (`automatic`). Les notifications et transitions de l'économie n'y figurent pas. Chaque événement porte sa session (ou « hors session ») et le temps écoulé depuis le début de la session. Filtres dans la page : session, source, issue (dont « refus, erreurs, interruptions »), activité.
- **Synthèse** : par activité (actions, refus, sessions, première fois), refus par motif ; compteurs sessions, minutes actives, actions, refus. Comptes admin marqués « Compte administrateur ». La page signale une collecte désactivée, la plus ancienne donnée conservée et les entrées perdues.
- **Liens** depuis la fiche compte et la fiche village (`#/journeys/:accountId?worldId&villageId`).
- **Preuves** : `journey-reads.integration` (5 cas sur données préparées : accès refusé sans session admin ; trois sessions séparées par 30 min et 2 h, minutes actives avec deux commandes dans une même minute, session en cours ; fin de construction hors session avec son `commandId` ; accomplissement dans sa session ; notification `population.energy` absente ; rejeu affiché une fois avec 2 tentatives ; synthèse et refus ; périmètres compte, village, période ; autre compte en 404 ; compte admin marqué), `journey-data.test` (filtres, libellés, temps depuis le début). Code neuf : pas de constat rouge. Inventaire des routes complété (`GET /api/admin/journeys/:id`).
- **Navigateur** (NOC de dev, port 5175, API de dev existante non relancée) : lien depuis la fiche compte puis depuis la fiche village de Bressuire, page affichée sans erreur console ; bandeau « collecte désactivée » (le dev n'a pas `JOURNEY_ENABLED=1`), compte marqué administrateur, chronologie réelle des fins de construction de Bressuire « hors session », sélecteurs de village et de période. **Non vérifié en navigateur** : sessions et commandes réelles, faute de collecte active sur le dev.

### Limites et suite

- Sur le dev et l'alpha, rien n'est collecté tant que `JOURNEY_ENABLED=1` n'est pas posé et l'API redémarrée (l'alpha attend le feu vert de Tristan).
- Sessions sans présence : un joueur qui regarde sans agir n'a pas de session ; une déconnexion n'est pas distinguée d'une inactivité. B (présence par minute) corrigera ce point ; D (événements client) ajoutera intentions, annulations et abandons.
- Pas de pagination au-delà de 500 événements : réduire la période.
