# Journal V2 : dépendances de lots, coût RC1 et rétention

23 octobre 2026 — étude Astra, base relue `4654464`, branche `wip/v2-commandes-bornees`.

**Statut : proposition technique, non implémentée.** Étude et expériences annulées sur `arbestra_test` uniquement. Aucun changement de code applicatif, aucune migration appliquée, aucun commit/push/déploiement. Les décisions ci-dessous restent **proposées** ; le périmètre **validé** est celui de l'étude demandée.

## 1. Décision recommandée

Stocker le vecteur de dépendances **une fois par lot et par monde**, conserver les références de changements par flux, et remplacer la concaténation incrémentale du JSON par une agrégation unique. Faire évoluer le lecteur serveur avant le producteur ; conserver le protocole 2 et les navigateurs existants. Ajouter ensuite une rétention par préfixes de révisions, avec reprise collective des abonnements par snapshot lorsque le curseur est trop ancien.

La représentation des dépendances passe de S² à S objets pour S flux affectés. Cela ne rend pas toute la commande O(S) : restent les tris/verrous, les références E, leurs index, les déclencheurs métier et la lecture des projections.

La normalisation suffit à traiter le très gros gaspillage ; elle ne suffit pas à expliquer ou supprimer les ~37 s d'installation RC1. Les petits lots demandent aussi attention : le schéma normalisé mesuré coûte davantage pour S=1 (§4.3).

## 2. Existant et garantie réellement préservée — lecture du code

| Chemin / fonction | Rôle constaté |
|---|---|
| [051_game_sync_foundation.ts](../apps/api/src/database/migrations/051_game_sync_foundation.ts), `game_sync_publish`, lignes 55–88 | Verrouille/incrémente les compteurs dans l'ordre monde/type/clé, construit `dependencies` par `||`, puis recopie ce vecteur dans chaque ligne du journal. Un même `batch_id` relie ces lignes. |
| [053_game_sync_private_writers.ts](../apps/api/src/database/migrations/053_game_sync_private_writers.ts), `game_sync_assert_published`, ligne 130 | Publication automatique au premier callback différé ; les suivants sortent lorsque la publication est faite. |
| [sync-v2-journal.ts](../apps/api/src/modules/villages/sync-v2-journal.ts), `readJournalSelection`, lignes 15–48 | Seul lecteur applicatif du champ durable `dependencies`. Filtre le monde et l'autorisation, déduplique les compagnons, conserve leurs plus hautes révisions et détecte les epochs incompatibles. |
| Même fichier, `readSubscribedJournal`, lignes 60–92 | Lit tous les compteurs souscrits, vérifie les compagnons présents dans cet ensemble ; un seul besoin de snapshot fait reprendre **toute la souscription**. Maximum 64 flux. |
| [sync-v2-capture.ts](../apps/api/src/modules/villages/sync-v2-capture.ts), lignes 16–78 | Autorise les périmètres puis lit compteurs, journal et entités dans une transaction `REPEATABLE READ READ ONLY`. |
| [sync-v2-effects.ts](../apps/api/src/modules/villages/sync-v2-effects.ts), lignes 10–21 | Autre consommateur du **retour SQL** de `game_sync_publish()` : trouve la version privée pour former l'ACK. Ne lit pas le champ `dependencies` du journal. |
| [contracts/sync-v2.ts](../packages/contracts/src/sync-v2.ts), schéma lignes 104–110 et `applySyncV2Batch`, lignes 161–239 | Le réseau transporte des groupes de flux/version/changements ; **ni `dependencies` ni `batch_id`**. Tous les groupes sont validés avant application. |
| [sync-v2-session.ts](../apps/world-web/src/api/sync-v2-session.ts), lignes 28–33 | Ne publie le nouvel état qu'après validation du lot par le reducer. |

La garantie livrée est une **capture cohérente du vecteur des flux déjà souscrits**. Plusieurs lots SQL intermédiaires peuvent être condensés : le client reçoit leur état courant cohérent, pas un rejeu événement par événement. Un bâtiment et son occupation publique sont appliqués ensemble si leurs deux flux sont souscrits. Un compagnon privé non autorisé n'est jamais ajouté.

Nuance par rapport à la [spec §8](SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md) : elle décrit une fermeture sur les dépendances autorisées ; le code capture le sur-ensemble borné des flux **déjà souscrits**, sans ajouter les autres flux simplement lisibles. Le mode village demande knowledge/manifest/traffic en plus du village, pas les milliers de chunks du monde (`sync-v2-initial.ts:10`). Les ACK `effects` restent privés et n'avancent pas le curseur canonique : cette étude ne prétend pas garantir une atomicité visuelle universelle entre ACK, spatial et présentation.

Supprimer durablement les dépendances selon les navigateurs actuellement connectés serait incorrect : les abonnements et les reprises futurs sont inconnus du producteur. Les filtrer **à la lecture**, selon l'abonnement autorisé, préserve la garantie actuelle.

## 3. Représentation et transition proposées

### 3.1 Schéma minimum et publication

Schéma indicatif, pas une migration livrée :

```sql
game_sync_batches (
  world_id uuid, batch_id uuid, recorded_at timestamptz,
  dependencies jsonb NOT NULL,
  PRIMARY KEY (world_id, batch_id)
)

-- Ajout nullable ; les lignes historiques conservent leur forme.
game_sync_changes.dependencies_batch_id uuid NULL
CHECK (dependencies_batch_id IS NULL OR dependencies_batch_id = batch_id)
FOREIGN KEY (world_id, dependencies_batch_id)
  REFERENCES game_sync_batches(world_id, batch_id)
-- Index pour recherche des dernières références et collecte des lots :
INDEX (world_id, dependencies_batch_id)
```

Une nouvelle ligne externalisée porte `dependencies=[]` et la référence non nulle ; une ancienne ligne garde son vecteur et une référence nulle. Le marqueur explicite distingue absence légitime et donnée perdue. Un lot référencé absent doit entraîner reprise/erreur contrôlée, jamais être interprété comme un vecteur vide.

Publication proposée :

1. Conserver exactement l'ordre canonique d'acquisition et l'incrément unique des compteurs. Aucun verrou métier après cette phase terminale.
2. Agréger les versions obtenues en une fois avec `jsonb_agg(... ORDER BY ...)`, depuis les flux touchés et leurs compteurs. Supprimer le `dependencies := dependencies || ...` de la boucle.
3. Écrire un vecteur par `(world_id,batch_id)`, puis les S références du journal. Une transaction peut toucher plusieurs mondes : chaque vecteur durable reste limité au sien.
4. Conserver le retour SQL du vecteur complet, sous la forme actuelle, pour `publishPrivateEffects()`. Conserver le contrôle de publication unique et l'annulation transactionnelle.

La FK proposée ne reprend aucun monde/village/gisement : elle vise seulement l'en-tête nouvellement créé par cette publication. Pas de compteur mondial ni de nouvelle sérialisation globale.

### 3.2 Lecture sans redéployer le coût quadratique

Ne pas joindre naïvement le grand vecteur sur chaque ligne de journal puis le transmettre à Node. Cela économiserait le disque mais répéterait les décodages et transferts, jusqu'à 64 fois par lot pour un abonnement.

Dans la même capture MVCC : sélectionner les intervalles de tous les flux souscrits ; contrôler leur continuité ; réunir les références de lots **distinctes** ; lire chaque vecteur une fois ; filtrer monde et scopes autorisés **en SQL avant transfert**. Conserver les contrôles d'epoch, de version du compagnon et les bornes de références. Ne pas réduire à un simple `MAX(revision)` qui masquerait des epochs incompatibles. Pour les anciennes lignes, utiliser leur champ historique, avec les mêmes filtres.

Une table relationnelle `game_sync_batch_members(world_id,batch_id,kind,key,epoch,revision)` est également O(S) et facilite la jointure aux scopes souscrits. Elle n'a pas été mesurée ici. Le vecteur unique est le changement minimum chiffré ; choisir les membres relationnels nécessiterait une comparaison supplémentaire des lectures et index. Supprimer entièrement les dépendances au motif que la capture lit tous les compteurs demanderait une autre démonstration ; ce n'est pas la proposition retenue.

### 3.3 Compatibilité et ordre de livraison

1. Migration additive : table, colonne nullable, contraintes/index. Aucune réécriture des gros journaux historiques nécessaire.
2. Déployer le lecteur qui comprend les deux formes, alors que le producteur écrit encore l'ancienne. Adapter aussi les tests qui lisent directement `dependencies`.
3. Après renouvellement/drainage des anciens processus API, activer le producteur normalisé. Ne pas laisser un ancien lecteur considérer `[]` comme toutes les dépendances du lot. Une option de bascule peut borner cette transition.
4. Laisser expirer l'ancien journal selon la rétention. Une conversion historique, si nécessaire pour libérer rapidement l'espace, doit vérifier l'accord des copies et avancer par petits lots ; elle n'est pas nécessaire à la correction.

**Client déjà déployé : aucun changement de contrat ni de protocole.** Ajouter des champs réseau serait même incompatible avec son schéma strict. Ne changer ni les epochs ni les révisions pour cette migration. Un retour arrière serveur doit conserver le lecteur à deux formats ; revenir à un ancien binaire exige de rétablir les vecteurs ou d'avancer les planchers pour exclure les intervalles normalisés et forcer des snapshots.

## 4. Mesures annulées sur `arbestra_test`

### 4.1 Méthode et limites

Mesures nouvelles du 23 octobre : PostgreSQL **17.11 Windows**, Node **24.19.0**. Cible vérifiée par URL locale exacte et `current_database()`, sans afficher de secret. Aucun autre backend client dans la base au contrôle préalable ; aucune suite DB ni aucun reset lancé. Migrations existantes jusqu'à 058 constatées, non réappliquées.

Le microbenchmark crée, dans une transaction, un schéma isolé avec des **tables ordinaires journalisées**, les mêmes clés/index, la FK journal→flux et le garde différé. Il copie la définition PostgreSQL courante de `game_sync_publish()` pour le témoin. La variante normalisée garde les boucles de compteurs/références et ajoute le schéma ci-dessus ; seules l'assemblage et la persistance des dépendances changent. Chaque transaction est ensuite annulée et son schéma doit avoir disparu. Aucune modification des fonctions ou journaux `public`.

S=130 puis S=1 856 ; trois passages par variante, ordre alterné. Flux synthétiques avec UUID/epochs identiques entre variantes, clés courtes, une référence `spatialCells` par flux. Ces clés ne décrivent pas une vraie souscription de monde. La mesure porte sur l'appel de publication et son retour SQL, pas le peuplement initial ni un COMMIT/fsync final. Les callbacks différés sont forcés et mesurés séparément avant ROLLBACK. Aucun temps de vraie commande ne doit être déduit directement de ces nombres.

Les deux variantes ont produit le même vecteur de dépendances, vérifié par égalité des valeurs et empreinte sur les six essais de chaque S. Les S lignes et le vidage de pending sont observés avant annulation. Avant/après la campagne : **4 243** lignes `public.game_sync_changes`, **19 984** flux, **0** pending, définition du producteur public inchangée ; aucun schéma d'expérience subsistant.

Les tailles de colonnes utilisent `pg_column_size` (compression effective) ; les tailles de relations utilisent `pg_total_relation_size` (table, TOAST et index). Elles ne sont pas interchangeables avec la longueur du JSON textuel. Références PostgreSQL : [fonctions de taille](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADMIN-DBSIZE), [TOAST](https://www.postgresql.org/docs/17/storage-toast.html). Mio = 1 048 576 octets ; KiB = 1 024 octets.

### 4.2 Lots de 130 et 1 856 portées

| Mesure | 130 actuel | 130 normalisé | 1 856 actuel | 1 856 normalisé |
|---|---:|---:|---:|---:|
| Objets de dépendance utiles persistés | 16 900 | 130 | 3 444 736 | 1 856 |
| Dépendances, octets stockés dans colonnes | 769 210 | 6 567 | 156 419 968 | 93 558 |
| Équivalent JSON textuel, octets | 2 582 840 | 20 128 | 528 763 264 | 288 606 |
| Journal + lots, table/TOAST/index, octets | 933 888 | 163 840 | 164 601 856 | 745 472 |
| Même total en Mio | 0,891 | 0,156 | 156,977 | 0,711 |
| Publication médiane | 477 ms | 257 ms | 72,07 s | 4,84 s |
| Publication min–max | 427–511 ms | 207–301 ms | 37,40–77,74 s | 1,91–6,08 s |

Le total normalisé inclut les tableaux vides historiques, la colonne UUID de référence, son index et la table des lots. Le seul vecteur stocké vaut respectivement **5 917** et **84 278** octets. Gains observés : **×5,7 / ×220,8** sur l'espace total des relations et **×1,85 / ×14,9** sur les médianes de publication. Les callbacks différés hors publication ont pris 1–26 ms.

La plage des temps est large : cache et charge de la machine ne sont pas contrôlés. Les **18 s** rapportées par Claude pour un reset réel restent une mesure historique distincte ; cette expérience ne les reproduit pas exactement. En revanche, les **149,17 Mio de dépendances seules** à S=1 856 retrouvent bien l'ordre de grandeur des « 150 Mo » annoncés. Les nombres de références métier du vrai reset/RC1 sont plus grands que la référence unique du microbenchmark.

### 4.3 Petits lots et croissance : mesure complémentaire de stockage

Pour ne pas extrapoler un gros reset à toutes les commandes, insertion de **1 000 lots** par scénario, chacun touchant S flux village à clé UUID, avec une référence `resources/wood` par flux. Même schéma/index, tables journalisées isolées, ROLLBACK final. Mesure de stockage uniquement, pas de latence de commandes :

| S | Actuel, octets/lot | Normalisé, octets/lot | Variation |
|---:|---:|---:|---:|
| 1 | 614 | 868 | +41 % |
| 2 | 1 597 | 1 499 | −6 % |
| 4 | 4 735 | 2 630 | −44 % |

**Proposition de finition : garder le format inline pour S=1**, tout en utilisant l'agrégation unique et le lecteur à deux formats. Le stockage reste O(S), et un lot mono-flux ne paie pas un en-tête supplémentaire. Ce mode hybride n'a pas été chronométré ; ses octets S=1 sont ceux de la forme actuelle. La version intégralement externalisée du tableau §4.2 est celle réellement mesurée.

État réel du journal au début de l'étude : **38 043 648 octets** table/TOAST/index, 4 243 lignes/43 lots. Sommes des colonnes : changements **2 498 188 octets**, dépendances **31 948 392 octets** ; le JSON textuel des dépendances représente 106 120 724 octets. Les lots conservés comprennent 17 lots à 130 portées, 10 à 129, un à 197 et un à 449. Ce résidu de tests n'est pas un échantillon de trafic staging/alpha.

## 5. Installation RC1 : attribution des coûts

### 5.1 Historique lu et nouvelle mesure

Les logs locaux historiques portent **37 095 ms** (`test-results/install-058.log:17`, worker 723 ms) et **41 162 ms** (`rerun-2.log:14`, worker 836 ms). Dans ces passages, environ 98 % du temps de première installation est hors worker. Le test `installation.integration.test.ts:183–189` utilise le mode **manuel, HDV seul**, et un worker partagé ayant déjà servi : première projection de ce monde ne signifie pas processus/worker froid.

Nouvelle mesure : code API actuel compilé dans un répertoire ignoré isolé, aucun fichier source modifié ; `installVillage` appelé avec sa vraie logique et un `SpawnCompute` neuf, au sein d'une transaction extérieure annulée. Compte, monde 512×256 et candidat RC1 créés dans cette transaction ; même point `(140,20)` et mode manuel que le test. Log Kysely par instruction, paramètres non journalisés. Publication différée forcée par `SET CONSTRAINTS ALL IMMEDIATE` avant la sentinelle de rollback.

| Poste, premier passage sans EXPLAIN | Temps observé |
|---|---:|
| Corps de `installVillage` | 81,769 s |
| Dont worker de planification, froid | 6,827 s |
| Dont instructions SQL, déclencheurs inclus | 74,580 s environ |
| Publication et contrôles différés | 0,893 s |
| Corps + différés, hors setup | **82,662 s** |
| INSERT occupations, 13 instructions | 37,565 s |
| INSERT `world_features`, 11 instructions | 17,013 s |
| INSERT `world_rc1_resources`, 11 instructions | 10,394 s |
| INSERT dépôts bois, 11 instructions | 7,471 s |
| INSERT chunks, 8 instructions | 1,119 s |

Les lignes « INSERT » sont **des sous-totaux du SQL**, pas des temps à additionner au total. La machine est variable : ce passage n'est pas présenté comme une nouvelle mesure fiable de référence à 37 s. Il sépare néanmoins nettement planification et persistance. La publication représente environ **1,1 %** de ce passage ; normaliser les dépendances ne peut donc pas, à elle seule, supprimer les dizaines de secondes restantes.

Preuve de travail avant rollback : **2 018 groupes**, **13 690 occupations**, **34 449 références feature/sommet**, **19 984 références pending**, **132 portées** ; après publication, 132 lignes de journal et zéro pending. Les deux portées de plus que les installations historiques proviennent du regroupement setup/installation dans la même transaction. Les statistiques de transaction montrent aussi **19 845 UPDATE sur `village_sync_changes`**, pour une seule ligne créée dans cette transaction.

Après la sentinelle précise `ASTRA_STUDY_EXPECTED_ROLLBACK`, compte et monde absents, zéro ligne du monde dans chacune des **24 tables touchées portant `world_id`**, et comptes globaux journal/flux/pending revenus à 4 243 / 19 984 / 0. Le profilage par `track_functions` a été refusé par PostgreSQL (42501) avant toute écriture métier ; aucun changement de privilèges n'a été tenté. Les temps ci-dessus sont donc des temps d'instructions, pas une attribution exhaustive par fonction.

### 5.2 Déclencheurs mesurés sur des instructions représentatives

Une seconde installation isolée remplace la première insertion de chacune des six tables ci-dessous par **la même insertion exécutée sous `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`**, une seule fois, puis poursuit l'installation. Aucun trigger n'est désactivé. Les écritures et la publication ont de nouveau été observées, puis annulées et vérifiées. Ces instructions sans `RETURNING` ne fournissent aucun résultat métier au code appelant.

| Première instruction de la table | Lignes | Temps serveur total | Déclencheurs V2 053/054/058 | `navigation_change` 042/046 | `village_sync_change` 041 |
|---|---:|---:|---:|---:|---:|
| `villages` | 1 | 1 516 ms | 1 481 ms | — | 2 ms |
| `world_chunks` | 16 | 570 ms | 179 ms | 302 ms | 11 ms |
| `world_features` | 200 | 862 ms | 196 ms | 427 ms | 74 ms |
| `world_rc1_resources` | 200 | 1 219 ms | 878 ms | 196 ms | 72 ms |
| `woodland_deposits` | 200 | 1 093 ms | 463 ms | 505 ms | 89 ms |
| `world_cell_occupancies` | 1 513 | 7 603 ms | 2 646 ms | 3 613 ms | 784 ms |

Les colonnes de déclencheurs sont incluses dans le total. Le reste comprend insertion/index et contraintes étrangères. Pour les occupations, V2 = **1 955 ms** de `game_sync_shared` et **691 ms** de `game_sync_private_indirect` ; la navigation est un poste plus gros dans cet échantillon. Pour les ressources RC1, les **878 ms** viennent du trigger d'instruction introduit par 058, appelé une seule fois pour les 200 lignes. Pour le village, le trigger partagé et sa visibilité dominent.

Ces mesures attribuent directement des coûts aux familles de triggers ; **elles ne donnent pas leur pourcentage sur l'installation entière**. Les autres paquets ne sont pas instrumentés et les durées varient avec la base et l'hôte. Le second passage a pris 232,925 s corps+différés, dont 26,457 s de worker, contre 82,662 s/6,827 s au premier : aucune comparaison A/B ni estimation de gain global ne peut être faite entre ces passages. `EXPLAIN ANALYZE` ajoute lui-même un coût ; les triggers différés ne figurent pas dans ses temps, d'où leur mesure séparée. [Documentation PostgreSQL sur les temps d'EXPLAIN](https://www.postgresql.org/docs/17/using-explain.html#USING-EXPLAIN-ANALYZE).

### 5.3 Explication par le code et priorités

- **Collecte V2 par ligne (053/054).** Chaque `game_sync_spatial_touch` relit les dimensions du monde puis tente un INSERT pending dédupliqué. Les occupations touchent cellule + feature ; les dépôts font de même. Les recherches indirectes de 053 s'exécutent aussi sur occupations/dépôts, même si le monde neuf n'a pas de missions. Références : `054_game_sync_shared_writers.ts:80–115,230–256`, `053_game_sync_private_writers.ts:147–181`.
- **058 conserve onze expansions par installation.** `persistRc1Resources` écrit par paquets de 200 (`rc1-resources.ts:21`). L'artefact contient 15 029 arbres, 1 984 groupes bois et 28 sites pierre/177 rochers ; ces décomptes sont calculés depuis l'artefact. La nouvelle fonction développe l'artefact une fois par instruction, puis maintient les ~34 k références/index, pas une seule fois pour toute l'installation.
- **Visibilité et chunks.** L'insertion du village tente 4 225 cellules (rayon 32), les deux cellules HDV 2 178 autres (rayon 16), et 128 chunks touchent chacun neuf voisins. Avec occupations/dépôts naturels, le code implique déjà environ 38 891 appels spatiaux avant les suppléments/autres cas. C'est une estimation statique de travail, distincte des 19 984 références finales observées après déduplication.
- **V1/navigation restent actives.** `041_village_sync.ts` tente un marqueur par ligne ; `042_async_expeditions.ts:16–46` réécrit `navigation_changed=true` même si déjà vrai ; 046 ajoute les invalidations locales. Les 19 845 UPDATE observés confirment ce travail répété. Il serait faux d'imputer toutes les secondes SQL aux seules migrations 053/054. Pour un chunk, le rayon 17 de `navigation_touch_box` énumère 35×35 points avant DISTINCT.

Ordre proposé pour une future optimisation RC1 : profiler/réduire la collecte et les invalidations répétées des écritures massives en conservant leurs références exactes ; examiner les réécritures du marqueur V1/navigation ; regrouper davantage l'expansion de l'artefact 058 si son coût le justifie. Le calcul métier du planner n'est pas le premier poste des observations disponibles. Aucune suppression de trigger ni modification métier n'est proposée comme raccourci sans tests d'équivalence.

## 6. Rétention et estimation staging/alpha

### 6.1 Politique proposée et reprise

La recherche dans le code ne trouve aucune purge du journal. Le champ `retained_from` et les replis du lecteur existent déjà. Reprendre la politique de la [spec §6.5](SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md) : **sept jours ou 10 000 entrées par flux**, première limite atteinte, valeurs configurables. Exécuter un passage périodique, par exemple toutes les cinq minutes, avec transactions et nombre de lignes bornés ; ces durées et budgets sont proposés, pas configurés aujourd'hui.

Sémantique exacte : supprimer un préfixe `revision <= F` et poser **`retained_from=F`**, dans la même transaction. Une base strictement inférieure à F exige un snapshot ; une base égale à F peut repartir avec les révisions suivantes. Conserver revision et epoch. Ne supprimer aucun reçu d'idempotence : leur identité et résultat doivent survivre indépendamment du journal.

Algorithme borné recommandé : traiter un flux à la fois sous son verrou de compteur, sans verrou métier ; déterminer son préfixe expiré par âge/nombre ; limiter l'avancée du plancher au préfixe réellement supprimé dans cette transaction (par exemple 2 000 lignes) ; avancer le plancher et supprimer ensemble. Répéter aux passages suivants. Ne pas utiliser un timestamp global comme curseur : `recorded_at` est un `statement_timestamp`, pas un ordre de commit. Si des dates sont inversées entre révisions, purger un préfixe jusqu'à la plus haute révision expirée peut aussi sacrifier des entrées plus récentes ; les sept jours sont un maximum, pas une garantie minimale de reprise.

Nettoyer les lots seulement lorsqu'**aucune ligne de journal** ne les référence encore, avec leur monde et l'index de référence. Leur âge seul ne suffit pas : les flux d'un même lot peuvent être compactés à des moments différents. La FK protège contre un lot supprimé trop tôt. Le travail doit rester borné, observable et se poursuivre jusqu'au plafond ; un quota de lignes sans suivi du retard ne garantit pas la rétention annoncée. Surveiller lignes, octets, âge du plus ancien préfixe, planchers, durée/retard de purge, snapshots forcés et espace mort. Ne pas assimiler suppression logique et réduction immédiate du fichier disque.

Pour un curseur trop ancien, `readSubscribedJournal` passe toute la souscription en `scope-snapshot`. Le stream émet `reset` ; `SyncV2Transport.refresh(true)` appelle `/sync/read` sans curseurs, avec les mêmes scopes. **Un re-bootstrap économique n'est pas nécessaire** pour cette purge normale. Une lecture MVCC ouverte avant la purge conserve sa vue ancienne cohérente ; une nouvelle capture voit le nouveau plancher et reprend par snapshot.

Deux limites existantes, lues/inférées et non corrigées ici :

- Le client refuse une nouvelle epoch dans une session existante (`sync-v2.ts:206`) et `refresh(true)` garde la session/génération (`sync-v2-transport.ts:91–98`). Une boucle de reprise après changement d'epoch est donc possible, non reproduite ici. **Ne pas changer l'epoch pour purger.**
- Le snapshot privé refuse plus de 4 096 références et certains composants plafonnent à 1 024. Vérifier la reprise des gros villages avant de promettre que toute base compactée est récupérable.

### 6.2 Croissance : scénarios, pas mesures de production

Aucune lecture de staging/alpha n'a été faite. Le nombre de villages actifs, la fréquence de publications worker et la distribution S/E ne sont pas connus. Les **8,6 Go / 115 k lignes** du prompt sont un historique de tests ; les multiplier par le nombre de joueurs serait trompeur. Compter les lots réellement publiés, pas les requêtes HTTP ni les polls SSE sans changement.

Pour une estimation reproductible : `octets/jour = lots/jour × octets moyens/lot`. Exemple avec des petits lots S=2 mesurés à **1 597 octets actuels / 1 499 normalisés**, une référence par flux :

| Scénario hypothétique | Publications/jour | Actuel / jour | Normalisé / jour | Normalisé, 7 jours avant plafond de 10 000/flux |
|---|---:|---:|---:|---:|
| Staging : 10 villages actifs, 1 publication/minute chacun | 14 400 | 21,9 Mio | 20,6 Mio | 144,1 Mio |
| Alpha : 100 villages actifs, 2 publications/minute chacun | 288 000 | 438,8 Mio | 411,8 Mio | 2,81 Gio |

Les 10 000 entrées peuvent réduire ces valeurs : à 1/min un flux atteint la borne en 6,94 jours ; à 2/min en 3,47 jours ; un flux public partagé l'atteint plus vite. Les lots restent conservés tant qu'un compagnon conservé les référence. À l'inverse, des changements plus volumineux ou davantage de réveils augmentent ces estimations. Elles excluent WAL, sauvegardes, espace mort et métadonnées de flux ; prévoir une marge d'exploitation et mesurer les octets réels avant de fixer une capacité disque.

Effet des opérations larges, hors autres données métier : un lot synthétique S=130 ajoute **0,891 → 0,156 Mio** ; S=1 856 ajoute **156,98 → 0,71 Mio**. Dix opérations S=1 856 par jour représentent **1,53 Gio/jour → 7,11 Mio/jour** de journal. C'est cette longue traîne qui explique l'urgence du correctif, même si les commandes ordinaires S=1–2 gagnent peu. Pour un import/remplacement massif, la spec §6.4 prévoit aussi une invalidation explicite de périmètre ; une telle évolution et la gestion des epochs du client sortent de cette proposition minimale.

## 7. Critères d'une future implémentation

Travail **à autoriser séparément**, pas réalisé par cette étude :

- Double lecture des formats, vecteurs manquants, égalité des références, plusieurs mondes, ACL et filtrage aux scopes souscrits ; préserver la détection d'epochs différentes et la signature SQL des ACK.
- Vérifier l'application atomique privé/spatial, un compagnon déjà couvert et un lot partiellement couvert incompatible avec le client existant ; prouver que le vecteur n'est chargé qu'une fois par lot/capture.
- Tester la purge à F−1/F/F+1, la conservation d'un lot encore référencé et le snapshot de toute la souscription ; client SSE `reset` → `/sync/read` → reprise du stream.
- Pour la concurrence, maintenir une capture MVCC par barrière pendant la purge, observer l'ancien état cohérent puis le nouveau ; prouver séparément l'ordre des publications et le rollback après mutations observées. Aucun résultat de concurrence n'est revendiqué par le microbenchmark séquentiel.
- Mesurer les vraies installations/reset et un mélange de petits lots sur une base entretenue, puis une endurance staging avec purge active. Ne pas confondre validation du schéma proposé et validation de ces parcours.

Les tests existants de journal et reducer ont été **lus**, pas réexécutés : `sync-v2-journal.integration.test.ts:61–103` et `packages/contracts/src/sync-v2.test.ts:108–132`. Leur compaction séquentielle ne prouve pas un entrelacement purge/lecture. Les seules exécutions de cette étude sont les expériences décrites, la compilation isolée nécessaire au profilage et les vérifications documentaires.

## 8. Reproduction et état de livraison

Les harnesses et résultats détaillés sont locaux, ignorés par Git dans `test-results/journal-study/` : `benchmark.mjs` / `benchmark.jsonl`, `small-storage.mjs`, `retention-probe.mjs`, `profile-install.ts`, `profile-install.json` et `profile-install-explain.json`. Ils ne sont pas des migrations ni du code livré. Le rapport conserve les valeurs, hypothèses et méthode afin que ses conclusions ne dépendent pas d'un artefact de tests commité.

Commandes d'expérience : `node test-results/journal-study/benchmark.mjs`, `node test-results/journal-study/small-storage.mjs`, `node test-results/journal-study/retention-probe.mjs`. Elles refusent toute cible autre que la base locale `arbestra_test`. Les expériences DB s'exécutent séquentiellement.

Pour le profilage : `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir apps/api/node_modules/.cache/astra-journal-study --sourceMap false --incremental false`, puis `node test-results/journal-study/emit-profile.mjs` et `node test-results/journal-study/profile-install.mjs` (avec `--explain` pour le second passage). Compilation et deux passages terminés code 0. Le lancement initial par TSX avait échoué avant connexion sur `uv_os_get_passwd/ENOMEM` ; les anciens fichiers `dist` différaient des sources, d'où cette compilation isolée du code API actuel. Le refus `track_functions` a été traité par le profilage SQL/EXPLAIN, sans élévation de privilèges.

Contrôle final : aucune session d'expérience restante, migrations inchangées jusqu'à 058, fonction de publication inchangée, toujours 4 243 lignes/43 lots visibles. Le journal occupe désormais **40 673 280 octets** contre 38 043 648 avant les profils : le rollback restaure les données visibles, **pas le WAL ni les pages mortes/allouées**. Aucune purge ni remise à zéro n'a été effectuée. Le développement, staging et alpha n'ont pas été contactés.

Livraison documentaire : ce rapport et une entrée courte du handoff, non commités. Le fichier personnel `codex-session-01a07944-0d99-7ab3-9983-b16b69419275.md`, présent au départ, est préservé. Aucun navigateur n'est requis pour cette étude sans modification visuelle ; la recette de la future implémentation reste à faire.
