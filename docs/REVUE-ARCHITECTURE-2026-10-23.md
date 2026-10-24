# Revue d'architecture — 23 octobre 2026

Statut : **étude**, aucune implémentation. Base relue : `main` au commit `8415fe0` (23 octobre, 12 h 58), avant le formatage Prettier (`102c5f4`). Les numéros de ligne cités renvoient à `8415fe0` et ont pu bouger depuis : utiliser `git show 8415fe0:<fichier>` ou rechercher le symbole.

Sources : lecture du code et des documents du dépôt. Les mesures de performance citées proviennent des audits et du handoff existants ; elles n'ont pas été refaites. Chaque constat doit être reconfirmé dans le code (fichier:ligne) avant d'être utilisé dans une spec.

## 1. Vue d'ensemble

| Brique | Rôle | Taille |
|---|---|---|
| `apps/api` | Monolithe Fastify 5 + Kysely : règles métier, sessions, scheduler, sync SSE, pool de navigation `worker_threads` | ~33 500 lignes |
| `apps/world-web` | React 19 (HUD) + classe Babylon impérative (rendu) | ~23 900 lignes |
| `packages/contracts` | Schémas TypeBox, mais aussi génération du monde, pathfinding, coûts, réducteurs de sync, exécutés des deux côtés | ~9 000 lignes |
| `play-web` / `admin-web` | Lobby / console NOC | 157 / ~950 lignes |

PostgreSQL 17 est l'unique source de vérité. Production : un VPS OVH de 4 Go, alpha et staging en systemd, déploiement par tag GitHub.

**Points solides :** discipline de verrouillage (ordre canonique, `SKIP LOCKED`, `statement_timestamp()` lu après le verrou), logique partagée client/serveur, imports Babylon profonds, bâtiments procéduraux pré-cuits avec LOD, authentification propre (jetons opaques hachés, scrypt).

## 2. Choix techniques

### Babylon.js — garder
WebGL et `StandardMaterial` sont suffisants ; WebGPU n'apporte rien tant que le GPU n'est pas le goulot.

- `scene/BabylonVillageScene.ts` (2 775 lignes, ~136 méthodes) mélange caméra, entrées, LOD, terrain, bâtiments, météo et hooks DEV. Le découper en systèmes possédant chacun leurs ressources et leur `dispose()`.
- Aucun worker dans la scène de jeu : mouvement des habitants et maillage du terrain sur le thread principal.

### React — garder pour le HUD, revoir le flux d'état
Tout l'état tient dans un `useState<VillageState>` d'`App.tsx` (1 048 lignes, 123 hooks) ; chaque nouvel état déclenche un `scene.update(...)` complet. Cible : store externe (Zustand ou `useSyncExternalStore`), scène abonnée par tranche sans passer par React.

### Node + Fastify — garder, sortir le CPU des transactions
`buildTravelNetwork` tourne parfois sur la boucle principale à l'intérieur de transactions verrouillées (`infrastructure.ts:130`, `leveling.ts:92-99`). Environ 200 ms par pose selon le handoff. Rust/WASM (dossier `crates/`) n'est pertinent qu'après le passage à un calcul incrémental.

### PostgreSQL — garder comme source de vérité, cesser de l'utiliser comme bus
- Sync V1 et V2 : sondage toutes les 2 s par connexion (`sync-v2-stream.ts:52`), réauthentification à chaque tick, pool de 8 connexions. `LISTEN/NOTIFY` est déjà utilisé pour les expéditions : le généraliser.
- Le journal V2 est désormais purgé par passes bornées (`45f45da`). En revanche, la table V1 `village_sync_changes` n'est toujours jamais purgée et subit un `count(*)` à chaque tick et réponse (`sync-revision.ts`, `navigation/context.ts`, vérifié sur `4daec7c`). Remplacer par un compteur monotone par monde, ou retirer avec le V1.
- Triggers PL/pgSQL empilés : plusieurs secondes sur les insertions en masse.
- Les GET de village écrivent (rattrapage économique) : la spec V2 prévoit des lectures pures, à soutenir.

### SSE — garder
Suffisant pour un jeu asynchrone dont les commandes passent en HTTP. Le problème est le sondage derrière.

### Kysely + SQL brut — garder
Mélange sain. La migration 046 réécrit des triggers par remplacement de chaînes : fragile.

### `packages/contracts`
C'est une bibliothèque de domaine et de simulation. La scinder en `contracts` (schémas) et `sim` (géographie, pathfinding, économie).

## 3. Exploitation et outillage

1. **CI** : le déploiement installe, compile et expédie, sans lint, typecheck ni tests. Ajouter un job avec un service Postgres, au minimum sur les tags.
2. **Sauvegardes** sur le même VPS. Ajouter une copie hors site.
3. **Un seul processus** porte HTTP, scheduler, rétention, coordinateur d'expéditions et navigation, sur 4 Go partagés entre deux environnements. Isoler scheduler et navigation.
4. ~~**Code compacté**~~ — **fait** le 23 octobre (`16ca6cc`, `102c5f4`, `.git-blame-ignore-revs`, règle dans AGENTS.md).
5. **Contexte documentaire** : handoff archivé (`8818353`), index court de 32 lignes — **fait**. Reste à ajouter un `CLAUDE.md` qui importe `@AGENTS.md`, car c'est `CLAUDE.md` que Claude Code charge automatiquement.

## 4. Économie

### Solide, à conserver
- PostgreSQL comme horloge ; verrou du village d'abord ; rejeu ordonné (heure, id, type) dans `reconcile-economy.ts`.
- Stocks `bigint`, débits `numeric`, reste dans [0,1).
- `CHECK (amount >= 0)` en base (migration 004).
- Idempotence par UUID de commande ; 409 si la charge diffère.
- Arrondis de l'Oracle à l'avantage du serveur dans les deux sens.

Aucun incident documenté de duplication ou de stock négatif.

### Fragile
- **Aucun registre** : crédits et débits `amount ± n` dispersés dans une dizaine de fichiers ; conservation vérifiée par relecture seulement ; réparations manuelles (`ops/repairs/2026-10-17-…`) non auditables.
- **Une mécanique par fonctionnalité** : chantiers, tournées Jardin, lots, expéditions, convois, nivellement… Environ douze tables de reçus et treize types de tâches planifiées ; enchaînement « libérer les habitants, créditer » recopié à la main.
- **Verrou exclusif par monde** : la pose prend `infrastructure:<world_id>` en exclusif (`construction.ts:37`), comme l'infrastructure et le nivellement, et des routes sont calculées sous verrou.
- **Rattrapage non borné en lecture** : seules les commandes de transformation et `economy.catchup` sont bornées (64 transitions / 200 ms).
- **Production perdue si le scheduler est en retard** : « les nouveaux départs ont lieu à la borne réelle » (`docs/architecture/economy.md:117`), alors que les lots de transformation se rattrapent.

## 5. Pathfinding

### Constats
- **Six implémentations** : A* par cible du réseau village (`travel-paths.ts`), A* de raffinement au huitième de case, A* pondéré ×2 (`route-planner.ts`, non optimal par construction), HPA* paresseux (`hierarchical-route.ts`), Dijkstra d'accès au spawn, Dijkstra des tournées Jardin. Coûts différents ; deux fonctions de distance torique qui divergent à exactement une demi-largeur.
- **Non reproductible** : budgets en millisecondes (250 ms, 5 s, 30 s) ; selon la charge CPU ou les caches, la même requête peut donner un autre chemin, ou « budget dépassé » au lieu de « trouvé ».
- **Faux « inaccessible »** : le raffinement élague les détours de plus de 128 pas fins ; si la file se vide à cause de cet élagage, `limited` reste faux et la fonction renvoie `null`, traité comme `DESTINATION_UNREACHABLE` ; un chantier peut être abandonné comme `'unreachable'` (`deposits/worksites.ts:228`). Contraire à la spec : une recherche incomplète ne prouve pas l'absence de chemin. Même travers dans `buildTravelNetwork` (plafond de détour à +8 cases, `travel-paths.ts:207`).
- **Routes droites non certifiées** : en cas d'échec, `[départ, arrivée]` est inséré (`travel-paths.ts:242`) et peut sortir tel quel du raffinement.
- **Réseau dépendant de l'ordre** : le bonus 0,7 sur les arêtes déjà empruntées (`travel-paths.ts:231`) dépend des cibles calculées avant ; toute pose recalcule tout le réseau.
- **Inaccessibilité jamais prouvée** : une paire déconnectée renvoie « budget dépassé », après jusqu'à 30 s, puis est réessayée toutes les 5 minutes.

### Couplage avec l'économie
`travelDuration(path)` (1 s par case du chemin exact) fixe la durée et le nombre de porteurs d'un échange, le transport des récoltes, les tournées Jardin, la durée du nivellement et les relevés scientifiques. Un même échange peut recevoir deux devis différents ; son acceptation par rapport au plafond de l'offre peut basculer.

## 6. Refonte proposée

1. **Découpler l'économie de la géométrie fine.** Durées issues d'une distance stable et déterministe ; chemin détaillé réservé au rendu. Village : un Dijkstra unique depuis l'hôtel de ville (champ de distance) répond à toutes les cibles ; suppression du bonus dépendant de l'ordre ; pose = mise à jour locale ou un seul recalcul.
2. **Un seul planificateur.** Une convention torique, un tas, trois issues explicites (trouvé / inaccessible prouvé / budget épuisé), budgets en nœuds. Longues distances : HPA* avec portails et matrices précalculés par chunk, réparés sur les chunks touchés (versions de la migration 046). Composantes connexes par chunk pour prouver l'inaccessibilité et mémoriser les échecs.
3. **Calculer hors verrou, valider sous verrou court** la version de la route. Verrou par région ou par chunk au lieu du verrou par monde.
4. **Économie autour de deux tables** : `processes` (type, village, début, fin, intrants réservés, habitants, extrants) avec gestionnaire de fin unique ; registre `resource_movements` en ajout seul, `village_resources` devenant un cache dérivé. Table de reçus unique ; départs automatiques à l'heure logique ; lectures pures et rattrapage borné partout.

**À ne pas changer :** PostgreSQL comme horloge et source de vérité, verrou du village en premier, scheduler `SKIP LOCKED`, intégration paresseuse des flux continus.

## 7. Articulation avec la migration du transport V2

Ne pas fusionner la refonte avec la migration du transport. Pendant celle-ci, ne rien figer que la refonte changera :

- périmètres de sync calqués sur le domaine (village, ressources, processus, bâtiments), pas sur les tables actuelles ;
- aucune cellule de chemin dans les charges économiques : la durée oui, le tracé non ;
- forme de reçu commune.

## 8. Ordre conseillé

1. ~~Prettier, en un commit isolé~~ — fait.
2. Finir le transport V2 avec les contraintes du § 7.
3. Spec de refonte (étude seule).
4. Découplage durée/chemin et planificateur unique.
5. Registre et `processes`, après le transport V2.

## 9. À trancher par Tristan

- Réinitialiser ou non les mondes alpha (évite toute migration de données pour le registre et les processus).
- Toute variation de durée de trajet, de coût ou de règle d'admission perçue par le joueur qui résulterait du découplage.
- Rattrapage des départs automatiques perdus pendant une indisponibilité du scheduler.
