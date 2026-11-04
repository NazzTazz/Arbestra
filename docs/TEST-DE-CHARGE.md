# Test de charge

4 novembre 2026. Étape 1 de la [feuille de route](ROADMAP.md). Outil livré et validé en local (§8) ; mise à niveau opérateur du 4 novembre (livraison sur un serveur déployé, ouverture de monde, cible dédiée). **Le passage sur staging ou sur une machine dédiée attend la décision de Tristan** (§7, §10). Aucun script n'a été lancé sur le VPS, le staging ou l'alpha.

## 1. À quoi sert l'outil

Mesurer combien de joueurs actifs un serveur unique tient, et **ce qui casse en premier** : pool PostgreSQL de l'API, verrous (village, navigation du monde, verrou mondial des poses), worker de trajets, scheduler économique, CPU de l'API. Le résultat éclaire la taille du monde, le nombre de joueurs par monde et l'ordre des chantiers structurants (trajets, verrous mondiaux, worker hors de l'API).

Le paquet `apps/load-test` (`@arbestra/load-test`) contient quatre scripts et aucune dépendance nouvelle (Node, `fetch`, `kysely` déjà présent dans l'API). En développement ils tournent par `tsx` ; sur un serveur déployé, par leur version compilée (`corepack pnpm --filter @arbestra/load-test build`, sortie `apps/load-test/dist/`, installée par `ops/deploy/load-test.py`, §7.1) :

| Script | Rôle | Touche la base |
|---|---|---|
| `provision.ts` | crée N comptes et villages de bots par le code réel du jeu | oui, comptes et villages des bots |
| `run.ts` | fait jouer les bots par paliers via l'API HTTP réelle, écrit les résultats | non (passe par l'API) |
| `sampler.ts` | échantillonne le serveur en lecture seule ; lancé par `run.ts` dans un processus à part, ou seul (`nohup` possible : il ne s'arrête que sur SIGINT/SIGTERM, ou sur la fermeture de son stdin si `--stop-on-stdin-close`, que passe `run.ts`) | lecture seule |
| `cleanup.ts` | supprime les seuls bots ; essai à blanc par défaut | oui, avec `--apply` |
| `local-api.ts` | lance une API locale dédiée (port libre, base dédiée, worker compris) avec une sonde CPU/mémoire | non |

Les résultats et les identifiants des bots vont dans `apps/load-test/out/`, ignoré par Git (ou dans le dossier donné par la variable `LOAD_OUT_DIR`, ce que fait `load-test.py` sur un serveur).

## 2. Les bots

- **Marquage** : e-mail `bot-NNN@load.arbestra.test` (3 à 5 chiffres), joueur et village `Bot NNN`. Aucun champ existant ne marque un compte de test : le motif d'e-mail suffit, sans migration. Le nettoyage ne sélectionne que les comptes qui vérifient exactement ce motif.
- **Mots de passe** générés au provisionnement (18 octets aléatoires), écrits avec le jeton de session dans `out/bots-<cible>-<monde>.json` (mode 600), jamais commités. Les bots se présentent avec ce jeton de session (cookie `arbestra_session`) : pas de connexion HTTP à chaque lancement, donc pas de limiteur de tentatives (60 connexions par IP et par quart d'heure, `attempt-limiter.ts`) à contourner.
- **Protocole** : les bots utilisent le transport V2 du client lui-même (`apps/world-web/src/api/sync-v2-transport.ts`, importé tel quel) : `bootstrap`, présentation, flux SSE `POST /sync/stream`, commandes avec `x-arbestra-protocol: 2`, `x-arbestra-generation` et `x-arbestra-command`, mêmes corps. Les intentions de récolte et les expéditions reprennent `client.ts`. Au chargement, un bot lit aussi le terrain des 3 × 3 chunks autour de son village, comme la scène. Chaque requête porte `x-arbestra-dev-timing: 1` (phases serveur `Server-Timing`, disponibles en production sur demande ; `--no-server-timing` les retire).
- **Choix des actions** (`actions.ts`, pur, testé) : tirage pondéré parmi les seules actions que l'état reçu permet, comme le HUD. Une action impossible n'est pas tirée.

| Action | Requête | Possible si |
|---|---|---|
| `reload` | rechargement complet (bootstrap, présentation, terrain) | toujours |
| `harvest` | intention de récolte : 1 ou 2 parcelles de jardin avec carottes, un bois disponible parmi les 6 plus proches, parfois une pierre | habitants disponibles |
| `hud-pool` | `extraction-pools` : sites ou effectifs +/− (bois, pierre), dans les bornes du HUD, au plus 3 sites | au moins un réglage valide |
| `hud-population` | `population/gestures` : repos, libération, nourrir | selon les effectifs et les carottes |
| `build` | maison en rondins, jardin d'une case ou scierie sur une case libre et plane dont l'anneau est libre | ressources suffisantes |
| `upgrade` | bâtiment au niveau suivant (coût attendu : la variante la plus chère) | ressources suffisantes |
| `terraform` | trait d'une case, un quart au-dessus de son coin le plus haut | case libre dans la région |
| `terrain-restore` | geste inverse du dernier trait (`terrain-restore`, hauteurs d'avant, sommets intacts) | un trait de plus de 3 s |
| `market-publish` / `market-cancel` | offre de 50 (bois, carottes, pierre) ; annulation d'une offre ouverte | marché débloqué (hôtel de ville niveau 2) |
| `market-accept` | parcourt les offres, devis du trajet (`trade-preview`), acceptation | marché débloqué ; **seulement l'offre d'un autre bot** |
| `expedition` | relevé d'un point à 20 cases | un cartographe |

Mélange par défaut : `reload 0.3, harvest 3, hud-pool 1.5, hud-population 1.5, build 1, upgrade 1, terraform 1, terrain-restore 1, market-publish 1, market-cancel 0.5, market-accept 0.5, expedition 0.5`. `--mix harvest=5,build=0` modifie des poids ; `--mix only:terraform=1,terrain-restore=1` n'en garde que certains. Le rythme est un temps de réflexion exponentiel autour de `--pace-seconds` (8 s par défaut), borné entre 0,2 et 5 fois cette moyenne.

Le calcul de trajets est sollicité par la lecture de la présentation (routes du village), les sites d'extraction, les récoltes de bois, le devis et l'acceptation d'une offre et, indirectement, par chaque trait de terraformation (identité du sol du monde entier, voir la [dette](DETTE-TECHNIQUE.md) « Trajets »).

Un village neuf n'atteint ni le marché (hôtel de ville niveau 2 : 500 bois d'œuvre et 120 pierres taillées) ni les expéditions pendant un test. L'option `--grant` du provisionnement relève les stocks des bots (`--grant wood=5000,timber=700,cut-stone=200,stone=600`), sous le verrou économique de chaque village bot et jamais d'un autre : c'est une **accélération non réaliste**, à signaler dans les résultats.

## 3. Provisionner et nettoyer

Pré-requis : `corepack pnpm install`, puis `corepack pnpm --filter @arbestra/contracts build`. La base est donnée par `--database-url` ou `LOAD_DATABASE_URL`, jamais affichée (les journaux ne montrent que l'hôte et le nom).

```sh
cd apps/load-test
# Ouvre un monde RC1 canonique en sommets partagés s'il n'existe pas (local uniquement), puis 20 bots.
npx tsx src/provision.ts --target local --world charge --create-world --count 20
# Un deuxième monde, villages répartis sur tout le tore, stocks relevés.
npx tsx src/provision.ts --target local --world charge-b --create-world --count 20 --start 21 --layout spread --grant wood=5000,timber=700
```

- **Code réel** : inscription `register()`, session `login()`, installation `installVillage()` comme le bouton « Installer » (mode `grouped` par défaut ; `--mode manual` pose l'hôtel de ville puis chaque élément du kit par `poseRemainingStarter()`, le chemin du verrou mondial des poses). Aucun INSERT à la main.
- **Emplacements** : `--layout cluster` (défaut : spirale autour de `--center x,y`, centre du monde par défaut) ou `--layout spread` (grille sur tout le tore, ordre pseudo-aléatoire reproductible, `--seed`). Avant d'envoyer un point, le script applique le contrôle de terrain que l'atlas fait avant que le joueur puisse cliquer (même inspecteur que le plan du serveur) ; un point refusé par le serveur passe au suivant. Le jeu exige plus de 50 cases entre deux villages : **un monde RC1 (512 × 256) tient environ 21 villages** (mesuré : 21 au premier monde, plein ensuite). Au-delà, le script s'arrête proprement (« monde plein ») et on provisionne un autre monde ; `run.ts --world charge,charge-b` répartit alors les bots de chaque palier entre les mondes.
- **Idempotent** : un bot existant garde son compte, sa session valide et son village ; un village absent est installé. Si le fichier d'identifiants a été perdu, un nouveau mot de passe est généré pour le seul compte bot.
- **Mesure** : chaque inscription, connexion, installation (acceptée ou refusée) et pose est chronométrée dans `out/provision-*.json`. `--concurrency 2..4` installe en parallèle, pour mesurer l'attente du verrou mondial `infrastructure:<monde>`.

```sh
npx tsx src/cleanup.ts --target local --world charge          # essai à blanc : table par table
npx tsx src/cleanup.ts --target local --world charge --apply  # suppression, puis vérification
```

- Refus si aucun compte ne vérifie le motif.
- Liste tirée du schéma (migrations jusqu'à 081) : presque tout part en cascade de `villages` et `accounts`. Sont supprimés explicitement, dans cet ordre et dans une seule transaction : les notifications `scheduled_tasks` des bots (sans clé étrangère : sujet ou charge utile désignant une ligne bot), `population_cohorts` (clé RESTRICT vers les extractions), `deposit_extractions` (RESTRICT vers les chantiers), `harvest_submissions` (`village_id` sans clé), les villages, les flux privés V2 `game_sync_streams` des villages bots (après les villages, dont la suppression écrit encore dans ces flux), puis les comptes (sessions, adhésions, journaux de parcours en cascade).
- Verrous pris dans l'ordre du jeu : villages bots `FOR UPDATE` par identifiant, puis le verrou spatial `infrastructure:<monde>`.
- **Bloquant, jamais supprimé** : une ligne d'un vrai joueur qui pointe vers un bot (cohorte née dans un village bot, convoi vers une offre bot, clairière réservée par un bot). Les bots n'acceptent que les offres d'autres bots.
- **Restent** : les données du monde que les bots ont changées (hauteurs de terrain aplanies ou terraformées, arbres abattus, gisements entamés, ressources de départ ajoutées au monde). D'où la recommandation d'un **monde dédié** au test (§7).
- Après suppression, l'inventaire est recompté ; s'il reste une ligne, la transaction est annulée.

## 4. Lancer

```sh
# Terminal 1 : API dédiée sur 3300, sur la base dédiée, avec son worker et la sonde CPU/mémoire.
npx tsx src/local-api.ts --target local --port 3300
# Terminal 2 : paliers de 10 puis 30 bots, deux minutes chacun.
npx tsx src/run.ts --target local --base-url http://127.0.0.1:3300 --world charge,charge-b \
  --stages 10,30 --stage-seconds 120 --api-probe-file out/api-probe-3300.json
```

Chaque palier démarre ses nouveaux bots sur `--ramp-seconds` (20 s) ; les bots restent connectés d'un palier au suivant. Le résumé d'un palier couvre sa partie stable (après la rampe). `run.ts` lance l'échantillonneur si la base est connue (`LOAD_DATABASE_URL`), dans un processus séparé.

**Mesures côté bots** : latence de chaque requête par type (p50, p95, p99), refus métier (409, 422) comptés à part des erreurs (400, 401, 429, 5xx, délais dépassés), délai entre la confirmation HTTP d'une commande et l'arrivée de son effet par le flux SSE (révision du flux privé portée par la confirmation, ou mention de la commande pour les intentions asynchrones de récolte et d'expédition), ouvertures et reconnexions du flux, phases serveur `Server-Timing` (attente de connexion `pool`, verrous `village_lock` et `navigation_lock`, file et calcul des trajets, réconciliation, SQL), et retard de la boucle d'événements du processus des bots (au-delà de 200 ms, la machine des bots fausse la mesure).

**Mesures côté serveur** (`sampler.ts`, toutes les 2 s, lecture seule : session `default_transaction_read_only`, délais de requête et de verrou du pool d'observation du NOC) : santé `/api/health` ; notifications dues et âge de la plus ancienne (retard du scheduler), intentions de récolte et d'expédition en attente ; connexions PostgreSQL par état, attentes de verrou (`pg_stat_activity`, `pg_locks`, verrous consultatifs à part), plus longues transaction et requête, événements d'attente, validations et annulations par seconde, interblocages ; CPU et mémoire du processus de l'API (sonde de `local-api.ts`, ou `/proc/<pid>` sous Linux avec `--api-pid`) ; charge de l'hôte et mémoire disponible (`MemAvailable` de `/proc/meminfo` sous Linux : `os.freemem()` ne donne que `MemFree`, trop bas sur un VPS sain).

**Sortie** : `out/run-<cible>-<date>/result.json` (toutes les requêtes, effets, échantillons, échecs) et `summary.md` : un tableau par palier, les seuils dépassés et **la première ressource saturée** avec sa preuve chiffrée.

## 5. Seuils

**Arrêt automatique**, vérifié toutes les 5 s sur les 30 dernières secondes (avec au moins 20 commandes pour juger latence et erreurs) :

| Seuil | Défaut | Option |
|---|---|---|
| p95 des commandes | 5 000 ms | `--max-p95-ms` |
| taux d'erreur des commandes | 5 % | `--max-error-rate` |
| santé : p95 de `/api/health` | 2 000 ms | `--max-health-ms` |
| santé : échecs consécutifs | 3 | — |
| charge de l'hôte (load 1 min) par cœur ; échantillonneur lancé par `run.ts` | 1 (au-delà du nombre de cœurs) ; 0 désactive | `--max-host-load-per-core` |
| mémoire disponible de l'hôte, en % du total ; échantillonneur lancé par `run.ts` | 15 ; 0 désactive | `--min-free-mem-percent` |

**Ressource saturée** (`report.ts`) : pour chaque palier, chaque ressource est comparée à son seuil ; la première ressource saturée est le plus fort dépassement du premier palier qui en a un.

| Ressource | Seuil |
|---|---|
| pool PostgreSQL de l'API (8 connexions, `connection.ts`) | attente de connexion `pool` p95 > 100 ms |
| verrou village, verrou de navigation du monde | attente p95 > 500 ms |
| verrous PostgreSQL | plus de 3 sessions en attente simultanée |
| file du worker de trajets / calcul de trajets | attente p95 > 500 ms / calcul p95 > 2 s |
| scheduler économique | échéance due depuis plus de 10 s |
| traitement des récoltes | intention en attente depuis plus de 15 s |
| CPU de l'API / boucle d'événements | p95 > 90 % d'un cœur / retard p99 > 200 ms |
| santé de l'API | p95 > 1 s ou un échec |
| requête PostgreSQL longue | requête active depuis plus de 5 s |

## 6. Garde-fous de cible

`target.ts` (pur, testé) refuse de tourner :

- sans `--target local`, `--target staging` ou `--target dedicated` ;
- si la base, l'URL de l'API ou le monde contient `alpha` (même encodé), ou si l'API est sur le port 3100 (API alpha du VPS) ;
- en local : base hors de 127.0.0.1, ou dont le nom ne finit pas par `_load` (la base de développement `arbestra` et les bases `_test` sont refusées) ; API hors de 127.0.0.1, ou sur 3000 (le `pnpm dev` du PO) ou 3200 (staging) ;
- en staging : sans le drapeau `--confirm-staging` **et** la variable `ARBESTRA_LOAD_STAGING` nommant le monde visé (un slug, ou **plusieurs séparés par des virgules** : `charge-1,charge-2` pour `run.ts --world charge-1,charge-2` ; chaque monde du test doit y figurer) ; base autre que `arbestra_staging` ; API autre que `https://staging.arbestra.fr` ou `http://127.0.0.1:3200` ;
- en cible dédiée (machine de test louée, §10) : sans le drapeau `--confirm-dedicated` **et** la variable `ARBESTRA_LOAD_DEDICATED_HOST` égale à l'hôte de l'API visée ; si la base, l'API, le monde ou cette variable désigne l'alpha **ou le staging** (nom, domaines publics `arbestra.world` et `arbestra.fr`, ports 3100, 3200 et 3000) ; si la base n'est pas locale à la machine ou ne finit pas par `_load`.

Un monde ne peut être créé par `provision.ts` qu'en local ; sur staging ou une machine dédiée, il est ouvert par l'opérateur (§7, §10).

## 7. Procédure staging proposée (à valider par Tristan)

Le staging partage le VPS (2 cœurs, 3,8 Go) avec l'alpha, qui a de vrais joueurs : la procédure protège d'abord l'alpha. **Rien n'est lancé tant que Tristan ne l'a pas validée et n'a pas fixé le créneau.** Si l'alpha ne doit pas être approchée du tout, préférer la machine dédiée (§10).

Les commandes d'opérateur ci-dessous tournent sur le VPS, en root, depuis les scripts de `ops/deploy/` relus et transférés. Le monde de staging s'appelle `staging` (et non plus `beta-rc1`, depuis le 24 octobre) ; les mondes de test sont `charge-1` et `charge-2` (un monde RC1 tient environ 21 villages).

### 7.1 Préparation, avant le jour J

1. **Release staging contenant l'outil.** Déployer sur staging, par le workflow habituel, le commit qui contient l'outil et `--shared-vertices`. La release elle-même ne livre que `api/` et `web/` ; l'outil vient d'une archive séparée, **optionnelle**, jamais installée par un déploiement : `bash ops/deploy/build.sh staging` (sur Linux : poste Linux, WSL ou exécuteur CI, **au même commit** que la release déployée) produit `release.tar.gz` et `load-test.tar.gz`. L'archive de l'outil ne contient que le JavaScript compilé par `tsc` (`apps/load-test/tsconfig.build.json`) : pas de `tsx`, pas de dépendance ajoutée, elle utilise `kysely`, `pg` et `@arbestra/contracts` de la release.
2. **Transférer** `load-test.tar.gz` sur le VPS par un canal chiffré (`scp`), en vérifiant sa somme `sha256sum`.
3. **Installer l'outil** (le script refuse l'alpha, ne s'accepte que pour `staging` ou `load`, vérifie que l'archive a la même révision que `current`, extrait sous l'UID `arbestra-staging`, relie `node_modules` à celui de la release et n'écrit rien dans `current`) :

   ```sh
   sudo python3 ops/deploy/load-test.py install staging load-test.tar.gz
   ```

   L'outil est dans `/srv/arbestra/staging/load-test/<révision>/` (lien `current`), ses résultats et identifiants de bots dans `/srv/arbestra/staging/load-test/out/` (propriété du service, mode 700). Il doit être réinstallé après chaque déploiement de staging.
4. **Ouvrir les mondes de test**, avec les sommets partagés comme l'alpha et staging (conversion du 19 octobre). `open-rc1-world.py` sauvegarde d'abord la base (`/var/backups/arbestra/staging-open-rc1-<slug>-<date>.dump`, vérifiée par `pg_restore --list`), puis exécute le code applicatif (`activateTerrainVertices`) sous le même UID et le même rôle PostgreSQL que l'ouverture habituelle. Un monde `charge-*` est **refusé sur l'alpha** par le script lui-même.

   ```sh
   sudo python3 ops/deploy/open-rc1-world.py staging --owner-account-id UUID --slug charge-1 --name "Charge 1" --shared-vertices
   sudo python3 ops/deploy/open-rc1-world.py staging --owner-account-id UUID --slug charge-2 --name "Charge 2" --shared-vertices
   ```

   `--slug` et `--name` valent par défaut `staging` et « Arbestra Bêta », `alpha` et « Arbestra Alpha » pour l'alpha ; `--shared-vertices` est facultatif et sans effet sur un monde déjà converti. L'UUID est celui d'un compte existant du staging (compte auteur, sans droit particulier). Le monde `staging` et le village Test ne sont pas touchés.
5. **Lecture à blanc** : `cleanup` doit répondre « aucun compte ne correspond » avant le provisionnement (voir 7.3).

### 7.2 Qui lance quoi

Une commande de l'outil sur le VPS s'écrit toujours sous la même forme. `--staging-worlds` donne la valeur de `ARBESTRA_LOAD_STAGING` (les mondes du test) ; l'outil tourne sous l'UID `arbestra-staging`, avec l'environnement du service (`/etc/arbestra/staging.env`) : sa base lui arrive dans `LOAD_DATABASE_URL`, renommée depuis `DATABASE_URL`, jamais en argument ni affichée.

```sh
sudo python3 ops/deploy/load-test.py run staging --staging-worlds charge-1,charge-2 SCRIPT -- ARGUMENTS DU SCRIPT
```

`SCRIPT` vaut `provision`, `run`, `sampler` ou `cleanup`. Les arguments du script sont ceux du §3 et du §4, avec `--target staging --confirm-staging`.

- **Provisionnement et nettoyage** (écrivent dans `arbestra_staging`, rôle applicatif du staging : DML, sans DDL, sans accès à `arbestra_alpha`).
- **Échantillonneur** : sur le VPS, même rôle, session en lecture seule ; `--api-pid` = PID de `arbestra-api@staging`.
- **Bots** (`run.ts`) : **depuis une autre machine** (le PC de Tristan), contre `https://staging.arbestra.fr`, pour que leur CPU ne s'ajoute pas à celui de l'alpha. Les identifiants sont copiés du VPS vers cette machine par un canal chiffré, puis effacés après le test. Les bots présentent un jeton de session : le nom du cookie de staging doit être donné, `--cookie-name __Secure-arbestra_staging`.

### 7.3 Déroulé

```sh
# a. À blanc (doit répondre qu'aucun compte ne correspond) :
sudo python3 ops/deploy/load-test.py run staging --staging-worlds charge-1 cleanup -- --target staging --confirm-staging --world charge-1
# b. Bots : 10 par monde, villages répartis (un monde RC1 tient environ 21 villages).
sudo python3 ops/deploy/load-test.py run staging --staging-worlds charge-1,charge-2 provision -- --target staging --confirm-staging --world charge-1 --count 10 --layout spread
sudo python3 ops/deploy/load-test.py run staging --staging-worlds charge-1,charge-2 provision -- --target staging --confirm-staging --world charge-2 --count 10 --start 11 --layout spread
# c. Échantillonneur (arrière-plan, il ne s'arrête plus sur la fermeture de son stdin ; arrêt : SIGINT/SIGTERM).
nohup sudo python3 ops/deploy/load-test.py run staging --staging-worlds charge-1 sampler -- --target staging --confirm-staging --base-url http://127.0.0.1:3200 --world charge-1 --out samples-j.jsonl --api-pid "$(systemctl show -p MainPID --value arbestra-api@staging)" > /dev/null 2>&1 &
# d. Copier les identifiants vers la machine des bots (canal chiffré), puis, sur cette machine, dans apps/load-test :
ARBESTRA_LOAD_STAGING=charge-1,charge-2 npx tsx src/run.ts --target staging --confirm-staging --base-url https://staging.arbestra.fr \
  --world charge-1,charge-2 --credentials bots-staging-charge-1.json,bots-staging-charge-2.json --cookie-name __Secure-arbestra_staging \
  --stages 2,5,10 --stage-seconds 180
```

La tâche provisionnement écrit d'abord les chunks du monde : la première installation d'un monde neuf peut durer plusieurs minutes (§8.1) et pèse sur le CPU du VPS : la lancer hors de l'heure de pointe de l'alpha, et surveiller la charge.

**Paliers.** Le VPS est petit : **2, puis 5, puis 10 bots**, 3 minutes chacun, arrêt automatique par défaut. On ne monte (20, 30) qu'après relecture des résultats et de l'alpha, dans une nouvelle exécution. Au-delà de 30, la machine dédiée (§10) est le bon endroit.

### 7.4 Seuils d'arrêt

Les seuils du §5 s'appliquent (p95, erreurs, santé de l'API). S'y ajoutent deux seuils **de l'hôte**, explicites et réglables, pensés pour un VPS partagé :

| Seuil | Défaut | Option |
|---|---|---|
| charge de l'hôte (load 1 min) par cœur | 1 (soit 2 sur 2 cœurs) ; `0` désactive | `--max-host-load-per-core` |
| mémoire **disponible** (MemAvailable) sous X % du total | 15 ; `0` désactive | `--min-free-mem-percent` |

La mémoire est celle de `MemAvailable` (`/proc/meminfo`) : `os.freemem()` ne donne que `MemFree`, que le cache de pages maintient à 4–10 % sur un VPS sain, ce qui arrêterait tout dès le départ. Hors Linux, repli sur `os.freemem()`.

`run.ts` applique ces deux seuils à chaque vérification (5 s) **lorsqu'il lance lui-même l'échantillonneur**, donc quand il tourne sur le serveur testé (§10). Avec des bots sur une autre machine (le cas staging), l'échantillonneur du VPS ne peut pas arrêter les bots : il écrit une `ALERTE HÔTE` sur sa sortie d'erreur (visible si lancé sans `nohup`, ou en redirigeant sa sortie d'erreur vers un fichier surveillé), et l'opérateur arrête les bots (Ctrl+C). Les options des mêmes noms existent sur `sampler.ts`.

### 7.5 Surveillance de l'alpha pendant le test

- Avant : relevé de référence de l'alpha (santé `/api/health` publique, latence d'une page, charge de l'hôte, `journalctl -u arbestra-api@alpha`).
- Pendant : santé de l'alpha toutes les 10 s depuis la machine des bots (un simple `curl`, hors de l'outil de charge qui refuse toute URL alpha), charge de l'hôte et mémoire disponible dans l'échantillonneur, console NOC de l'alpha ouverte.
- **Arrêt immédiat** (Ctrl+C sur `run.ts` ; les bots ferment leurs flux) si la santé de l'alpha dépasse 1 s, si la charge de l'hôte dépasse le nombre de cœurs, si la mémoire disponible passe sous 15 %, ou sur une plainte d'un joueur.

### 7.6 Après

- `cleanup` à blanc, relu, puis `--apply` (même forme de commande que 7.3 a, avec `--world charge-1` puis `--world charge-2`).
- Résultats (`summary.md`) relus avec Tristan ; **aucun identifiant de bot conservé** : effacer `/srv/arbestra/staging/load-test/out/` et la copie sur la machine des bots.
- Les mondes `charge-*` restent en base (traces de terrain) : ils sont sans villages et peuvent être laissés ou supprimés par une opération d'opérateur séparée, sur décision de Tristan.

## 8. Validation locale du 4 novembre 2026

Machine : le PC de Tristan, déjà chargé (dev du PO actif sur 5173 à 5175, PostgreSQL 17 natif partagé). **Les chiffres absolus ne valent rien** : ils valident l'outil et montrent des tendances, pas une capacité.

Base dédiée `arbestra_load` : créée, migrée (`db:migrate`) et semée (`db:seed`) avec les commandes du dépôt ; API dédiée sur 3300 par `local-api.ts` (durées de construction de 3 s, comme le `.env.example` de développement). Le `pnpm dev` du PO n'a pas été touché.

### 8.1 Provisionnement

| Mesure | Monde `charge` (`cluster`) | Monde `charge-b` (`spread`, `--grant`) |
|---|---|---|
| Villages installés avant « monde plein » | 21 | 18 |
| Première installation d'un monde neuf | 224 s (elle écrit les chunks jouables du monde entier) | environ 87 s |
| Installation suivante, p50 / p95 | 22 à 48 s (3 premières) | 16,5 s / 87 s |
| Point refusé par le serveur malgré le contrôle de terrain | 10 refus, environ 10 s chacun | 46 refus, p50 7,8 s |
| Inscription p50 | 0,58 s | 0,16 s |

Le refus coûte presque une installation : le plan complet (ressources de départ, place disponible) tourne avant de dire non. Une relance du provisionnement sur des bots existants ne fait rien d'autre que vérifier les sessions (3,8 s pour 21 bots).

### 8.2 Paliers 10 puis 30 bots (deux mondes, rythme 8 s)

Seuils d'arrêt relâchés pour observer jusqu'à 30 (`--max-p95-ms 30000 --max-error-rate 25 --max-health-ms 10000`) : avec les seuils par défaut, l'essai s'arrête dès 10 bots.

| Essai | Bots | Commandes p50 / p95 | Présentation p95 | Effet SSE p50 / p95 | Retard scheduler max | Attente pool p95 | `navigation_lock` p95 | CPU API p95 | Boucle API p99 |
|---|---|---|---|---|---|---|---|---|---|
| À froid (premier chargement de chaque village) | 10 | arrêt à 35 s : santé `/api/health` p95 2,6 s | 8,9 s, `NAVIGATION_BUSY` ×5 sur 9 | — | 7,9 s | 885 ms | 2,4 s | 293 % | 1,3 s |
| Mélange complet, à chaud | 10 | 159 ms / 4,8 s | 12,3 s | 43 ms / 694 ms | 21 s | 402 ms | 3,6 s (terraformation) | 234 % | 253 ms |
| Mélange complet, à chaud | 30 | 7,2 s / 17,8 s | 22,2 s, `NAVIGATION_BUSY` ×73 sur 151 | 1,3 s / 5,2 s | 97 s | **9,9 s** | 11,3 s | 339 % | 1,5 s |
| Sans terraformation | 10 | 148 ms / 2,3 s | 2,4 s | 55 ms / 626 ms | 14 s | 541 ms | 0,7 s | 266 % | 964 ms |
| Sans terraformation | 30 | 2,0 s / 9,5 s | 12,3 s, `NAVIGATION_BUSY` ×84 sur 179 | 504 ms / 3,2 s | 79 s | 4,7 s | 12,1 s (amélioration) | 408 % | 1,6 s |

À 30 bots, quatre commandes HUD sur 34 dépassent le délai de 15 s du client (`TIMEOUT`). Les récoltes restent en file jusqu'à 97 s. La boucle d'événements des bots atteint 483 ms à 30 bots sans terraformation : à ce palier, la machine des bots elle-même fausse un peu la mesure.

### 8.3 Ce que l'essai local laisse deviner

Réserve : machine chargée, un seul PostgreSQL partagé avec le dev du PO. Les mécanismes, eux, se lisent dans les phases serveur et ne dépendent pas de la machine.

1. **Le verrou mondial `infrastructure:<monde>` sérialise le monde.** Toute commande économique le prend en partage (`beginVillageEconomy`) ; terraformation, construction, amélioration et installation le prennent en exclusif. Un écrivain exclusif bloque tous les villages du monde, et les lecteurs partagés s'accumulent derrière lui : `navigation_lock` p95 de 3,6 s dès 10 bots, 11 à 16 s à 30. Les attentes PostgreSQL les plus vues sont `Lock/advisory`.
2. **Le pool de 8 connexions de l'API s'épuise en conséquence.** Les transactions qui attendent le verrou gardent leur connexion ; les autres requêtes attendent une connexion (9,9 s p95 à 30 bots), le scheduler aussi, puisqu'il partage ce pool : 97 s de retard sur les échéances et les récoltes.
3. **Le worker de trajets est la première file saturée.** Chaque trait de terraformation change l'identité du sol du monde entier, et chaque présentation recalcule alors le réseau de son village : file de 9,3 s p95 dès 10 bots, refus `NAVIGATION_BUSY` en masse à 30 ([dette](DETTE-TECHNIQUE.md) « Trajets »). Sans terraformation, la présentation tombe de 12,3 s à 2,4 s à 10 bots ; à 30, la file sature quand même (32 s p95), sous l'effet des constructions et des améliorations.
4. **Le chargement à froid simultané de 10 villages suffit à dégrader la santé de l'API** (CPU à 290 %, boucle d'événements à 1,3 s) : une rentrée de joueurs après un redémarrage ou un déploiement est un cas à mesurer sur staging.
5. **Un monde RC1 tient 18 à 21 villages** (plus de 50 cases entre deux villages). Cent joueurs demandent environ cinq mondes RC1, ou un monde plus grand.

Ordre suggéré, à confirmer sur staging : portée du verrou mondial et invalidation globale des trajets (les deux premiers maillons de la chaîne), puis un pool séparé ou un worker hors de l'API (le scheduler ne doit plus attendre derrière les commandes).

### 8.4 Nettoyage et état final

- `cleanup.ts` à blanc a listé 35 tables (1 238 notifications, 250 bâtiments, 39 flux privés, entre autres), puis `--apply` a supprimé 40 comptes et 39 villages.
- **Défaut trouvé et corrigé** au premier nettoyage : les suppressions mettent en file des changements des flux privés, publiés au commit par un déclencheur différé, qui recréaient les 39 flux supprimés. Le script publie désormais explicitement (`game_sync_publish()`) avant de supprimer les flux, puis recompte après validation. Les 39 flux résiduels de ce premier passage ont été retirés à la main de la base locale. Le nettoyage corrigé a été revalidé sur 3 bots neufs (provisionnement, jeu, suppression, aucune ligne restante après validation).
- **Limite constatée** : réinstaller un village au même endroit qu'un bot supprimé échoue (erreur 500, `stone_deposits_world_id_cell_x_cell_y_key`) : les gisements ajoutés au monde par l'installation restent. Dans un monde déjà nettoyé, il faut provisionner ailleurs (`--layout spread --seed N`) ou dans un nouveau monde. Le même cas pourrait toucher un vrai joueur si un village était un jour supprimé : à signaler.
- État final de `arbestra_load` : aucun compte bot, un seul village (Clairière, du seed), aucune notification ni flux privé dans les mondes `charge` et `charge-b`, qui restent ouverts (sans villages) avec leurs traces de terrain. L'API dédiée sur 3300 est arrêtée.

## 9. Points à décider par Tristan

- Valider la procédure staging (§7), le créneau et les paliers du premier passage.
- Mondes dédiés au test sur staging (`charge-1`, `charge-2`) : ouverture par l'opérateur (`open-rc1-world.py --slug ... --shared-vertices`, §7.1) ; `provision.ts --create-world` reste refusé hors local.
- VPS partagé de 2 cœurs ou machine dédiée louée (§10) ? Paliers de départ proposés en staging : 2, 5, 10.
- `--grant` (stocks relevés pour atteindre le marché) : acceptable en staging, ou mélange sans marché.
- Mélange par défaut des actions et rythme (8 s) : représentatifs de l'alpha ? Le journal des parcours pourrait les calibrer.
- Seuils d'arrêt par défaut (5 s, 5 %) : ils arrêtent l'essai local dès 10 bots.

## 10. Machine de test dédiée

Un serveur cloud **temporaire**, loué pour l'essai, évite de toucher l'alpha et son VPS. Il est générique : tout hébergeur Linux convient. La cible `--target dedicated` y applique ses propres garde-fous (§6) : refus de l'alpha et du staging (noms, domaines publics, ports), drapeau `--confirm-dedicated`, variable `ARBESTRA_LOAD_DEDICATED_HOST` égale à l'hôte de l'API, base locale suffixée `_load`.

**Dimensionnement.** Pour que la mesure soit utile, la machine doit ressembler au serveur de production visé, pas à celui de l'alpha : indiquer dans les résultats ses cœurs et sa mémoire. Point de départ : 4 vCPU, 8 Go, 40 Go de disque, Debian 13 (PostgreSQL 17 dans le dépôt) ou Ubuntu 24.04 (PostgreSQL 17 par le dépôt PGDG), x86-64. Les bots tournent **sur une autre machine** (le PC de Tristan) ; sinon leur CPU fausse la mesure (voir la boucle d'événements dans `summary.md`).

### 10.1 Installer une release sur une machine neuve

`bootstrap.py` est propre au VPS audité (passerelle Caddy dans Docker, domaines, deux environnements) : il n'est pas utilisé. On réutilise le reste de `ops/deploy/` : le gabarit de service `arbestra-api@.service` (instance `load`), `open-rc1-world.py` et `load-test.py` (environnement `load`) et la fonction `application` du contrôleur `deploy.py`, installé tel quel.

Sur un poste **Linux** (WSL, exécuteur CI), au commit à tester :

```sh
bash ops/deploy/build.sh load        # release.tar.gz et load-test.tar.gz ; aucun domaine, les pages web ne sont pas servies
sha256sum release.tar.gz load-test.tar.gz
scp release.tar.gz load-test.tar.gz ops/deploy/{arbestra-api@.service,deploy.py,open-rc1-world.py,load-test.py} root@HÔTE:/root/
```

Sur la machine, en root :

```sh
# 1. Paquets et Node 24 (version épinglée du bootstrap, vérifiée par SHASUMS256.txt de nodejs.org).
apt-get update && apt-get install -y --no-install-recommends postgresql-17 postgresql-client-17 ca-certificates curl xz-utils
NODE=24.22.0; cd /tmp
curl -fsSLO https://nodejs.org/dist/v$NODE/node-v$NODE-linux-x64.tar.xz
curl -fsSL https://nodejs.org/dist/v$NODE/SHASUMS256.txt | grep " node-v$NODE-linux-x64.tar.xz" | sha256sum -c -
tar -xJf node-v$NODE-linux-x64.tar.xz -C /opt && ln -s /opt/node-v$NODE-linux-x64/bin/node /usr/local/bin/node && cd /root

# 2. Compte de service, dossiers.
useradd --system --create-home --home-dir /var/lib/arbestra-load --shell /usr/sbin/nologin arbestra-load
mkdir -p /srv/arbestra/load/releases /etc/arbestra /var/backups/arbestra /usr/local/lib/arbestra
chmod 700 /var/backups/arbestra
install -m 755 deploy.py /usr/local/sbin/arbestra-deploy
install -m 644 'arbestra-api@.service' /etc/systemd/system/

# 3. Base : un seul rôle (machine jetable, sans donnée réelle) ; mot de passe tiré au hasard, jamais affiché.
PW=$(openssl rand -hex 32)
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE arbestra_load LOGIN PASSWORD '$PW'" -c "CREATE DATABASE arbestra_load OWNER arbestra_load"
install -m 600 /dev/null /etc/arbestra/load.env
printf 'DATABASE_URL=postgresql://arbestra_load:%s@127.0.0.1:5432/arbestra_load\nNODE_ENV=production\nHOST=127.0.0.1\nPORT=3400\nCOOKIE_NAME=arbestra_session\nTRUSTED_PROXY_CIDRS=127.0.0.1\nEXPEDITION_WORKERS=1\nSCHEDULED_TASK_POLL_INTERVAL_MS=1000\n' "$PW" > /etc/arbestra/load.env
unset PW

# 4. Release : extraction sous l'UID du service, lien courant, migrations.
REV=$(tar -xzOf release.tar.gz revision)
install -d -o arbestra-load -g arbestra-load -m 755 /srv/arbestra/load/releases/$REV
cp release.tar.gz /tmp/release.tar.gz && chmod 644 /tmp/release.tar.gz
runuser -u arbestra-load -- tar -xzf /tmp/release.tar.gz --no-same-owner -C /srv/arbestra/load/releases/$REV && rm /tmp/release.tar.gz
ln -sfn /srv/arbestra/load/releases/$REV /srv/arbestra/load/current
systemd-run --wait --collect --pipe -p User=arbestra-load -p EnvironmentFile=/etc/arbestra/load.env \
  -p WorkingDirectory=/srv/arbestra/load/current/api /usr/local/bin/node dist/database/migrate.js

# 5. Service API (gabarit de ops/deploy, instance « load »). Sur une machine plus grande, relever les limites mémoire :
#    systemctl edit arbestra-api@load  ->  [Service] MemoryHigh=3G, MemoryMax=4G
systemctl daemon-reload && systemctl enable --now arbestra-api@load
curl -fsS http://127.0.0.1:3400/api/health
```

Les migrations créent le schéma seulement ; **jamais `db:seed`** ici non plus. Le compte auteur du monde s'inscrit par l'API (`POST /api/auth/register`, corps `{"email":"...","password":"..."}` ; non rejoué depuis cette procédure, à vérifier au premier passage), puis son identifiant est lu : `runuser -u postgres -- psql arbestra_load -Atc "select id from accounts where email = '...'"`.

Ouvrir un monde, convertir en sommets partagés, installer l'outil (même commandes que sur staging, environnement `load`, monde `charge-1` par défaut) :

```sh
python3 open-rc1-world.py load --owner-account-id UUID --shared-vertices
python3 load-test.py install load load-test.tar.gz
```

### 10.2 Exécuter l'outil en cible dédiée

L'API écoute sur `127.0.0.1:3400` : aucun port public. Les bots l'atteignent par un **tunnel SSH** depuis leur machine (`ssh -N -L 3400:127.0.0.1:3400 root@HÔTE`), donc `--base-url http://127.0.0.1:3400` et `ARBESTRA_LOAD_DEDICATED_HOST=127.0.0.1` ; le tunnel ajoute un peu de latence, à signaler dans les résultats. Autre option : ouvrir le port 3400 au seul pare-feu de l'hébergeur pour l'adresse de la machine des bots, `HOST=0.0.0.0`, `--base-url http://ADRESSE:3400` et `ARBESTRA_LOAD_DEDICATED_HOST=ADRESSE` ; le trafic est alors en clair, ce qui reste acceptable pour des comptes de bots jetables, jamais pour de vrais comptes.

Sur la machine de test, mêmes formes de commande que sur staging (§7.2), avec `--dedicated-host` au lieu de `--staging-worlds` et `--target dedicated --confirm-dedicated` au lieu de `--target staging --confirm-staging` :

```sh
python3 load-test.py run load --dedicated-host 127.0.0.1 provision -- --target dedicated --confirm-dedicated --world charge-1 --count 20 --layout spread
nohup python3 load-test.py run load --dedicated-host 127.0.0.1 sampler -- --target dedicated --confirm-dedicated --base-url http://127.0.0.1:3400 --world charge-1 --out samples.jsonl --api-pid "$(systemctl show -p MainPID --value arbestra-api@load)" > /dev/null 2>&1 &
```

Sur la machine des bots (tunnel ouvert) :

```sh
ARBESTRA_LOAD_DEDICATED_HOST=127.0.0.1 npx tsx src/run.ts --target dedicated --confirm-dedicated --base-url http://127.0.0.1:3400 \
  --world charge-1 --credentials bots-dedicated-charge-1.json --stages 10,30,60 --stage-seconds 180
```

Un monde RC1 tient environ 21 villages : pour plus de bots, ouvrir `charge-2`, `charge-3` (`open-rc1-world.py load --slug charge-2 --name "Charge 2" --shared-vertices`) et donner la liste à `--world`.

Les seuils d'hôte du §7.4 s'appliquent ; leur valeur par défaut (charge égale au nombre de cœurs) est faite pour le VPS partagé : sur une machine dédiée, le but est de **trouver** la saturation, relever `--max-host-load-per-core` (par exemple 2) est légitime, à écrire dans le compte rendu.

### 10.3 Détruire la machine

1. Rapatrier les résultats utiles (`/srv/arbestra/load/load-test/out/run-*/summary.md` et `result.json`) ; **ne pas** rapatrier `bots-*.json` (identifiants jetables).
2. Fermer le tunnel SSH, effacer les identifiants sur la machine des bots (`apps/load-test/out/bots-dedicated-*.json`).
3. **Détruire l'instance** chez l'hébergeur (suppression, pas arrêt : un serveur arrêté est encore facturé, ainsi que son disque, ses instantanés et son adresse IP fixe) ; supprimer aussi volumes, instantanés et adresses réservées.
4. Vérifier dans la console de l'hébergeur que plus aucune ressource ne court, et révoquer la clé SSH ou l'accès créés pour l'occasion.
