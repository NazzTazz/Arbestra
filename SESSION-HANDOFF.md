# Reprise — état au 23 octobre 2026

Index court. L'historique détaillé (preuves, mesures, sessions précédentes) est archivé dans [docs/HANDOFF-ARCHIVE-2026-10-23.md](docs/HANDOFF-ARCHIVE-2026-10-23.md).

## État

- Branche de travail `wip/v2-commandes-bornees`, fusionnée en avance rapide dans `main`. Staging et alpha déployés à `947d6c2` (tags `staging-2026.10.23.11`, `alpha-2026.10.23.8`), contrôles publics OK.
- **Jusqu'au 23 octobre ~17 h, la V2 n'a jamais tourné en prod** : son contrôle d'activation lisait `kysely_migration`, interdite au rôle applicatif (`deploy.py`) → 500 sur toutes les routes V2 et repli silencieux du client sur V1. Corrigé (`1383eb4`, contrôle par le catalogue, régression qui reproduit les droits de prod). Les recettes staging antérieures portaient donc sur la V1.
- Autorisations durables de Tristan : commits, push, fusion dans `main`, déploiements staging/alpha et enchaînement des tranches, sans aval de routine. Restent à lui demander : gameplay, base de développement locale, actions destructives sur données joueurs.
- Migrations 051–061 appliquées en test, staging et alpha ; **pas sur la base de développement locale** (sauvegarde et commande à lancer par Tristan : `corepack pnpm db:migrate`).

## Livré (V2, commandes bornées)

- Village complet synchronisé en V2 sur staging et alpha (`VITE_SYNC_V2=1` dans `ops/deploy/build.sh` ; option locale `arbestra:sync-v2` en développement). Atelier, pose, amélioration et agrandissement de jardin répondent sur le contrat V2 (effets privés dans l'ACK, rejeu sans publication) ; une amélioration s'affiche sans attendre la relecture de présentation (emprises déjà connues).
- Présentation versionnée (région versionnée, `knownRegion`), convois publics (flux `traffic`, 057).
- Journal V2 : purge bornée (7 jours / 10 000 entrées par flux, `sync-v2-retention.ts`), dépendances de lot stockées une fois (059).
- Coût des insertions en masse (058, 060, 061) : première installation RC1 en test 205 s → 11 s ; achèvement d'un bâtiment (relevé `science_places`) 3,0–3,5 s → 0,9 s de verrou village.
- Pose V2 affichée dès la confirmation, sans attendre la relecture de présentation.
- Prettier sur tout le code (`16ca6cc` outillage, `102c5f4` formatage seul, ignoré par `git blame` via `.git-blame-ignore-revs`) ; règle dans AGENTS.md.

Spec : [docs/SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md](docs/SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md). Étude Astra : [docs/ETUDE-JOURNAL-SYNC-DEPENDANCES.md](docs/ETUDE-JOURNAL-SYNC-DEPENDANCES.md). Arbitrages : [docs/ARBITRAGES-OUVERTS-V2.md](docs/ARBITRAGES-OUVERTS-V2.md) (aucun ouvert).

## Ouvert

- Pose d'un bâtiment neuf : **résolue sur staging** (mesure navigateur réelle : 4,9 s → 0,27 s). Causes : V2 inactive en prod (ci-dessus), JIT PostgreSQL sur une requête composite (pool API en `jit=off`) et contrôle de croisement des trajets réécrit. Détails : priorité 5 de [l'audit des coûts](docs/AUDIT-COUTS-SERVEUR-2026-10-21.md#priorités-restantes).
- Passerelle : la règle `@crossSite` (403) ne vise plus que `/api/*` — **appliqué le 23 octobre sur staging et alpha** (`ops/repairs/2026-10-23-crosssite-pages.py`, sauvegardes `/etc/arbestra/*.Caddyfile.pre-crosssite-20261023T183809`). Les pages s'ouvrent depuis un lien externe (200), l'API reste refusée en inter-sites (403). Le Caddy web tourne `admin off` : `systemctl reload` ne relit pas sa config, il faut `restart`. Accès VPS : session PuTTY `VPS` via `plink` (`../.vps`, procédure seulement).
- Diagnostic prod : `localStorage['arbestra:timing']='1'` → Server-Timing sur les requêtes V2 (phases, 3 instructions les plus lentes `arbsql_n`, profil par partie de la préparation de pose `arbpart_n`). L'extension Claude in Chrome permet à l'agent de mesurer sur staging directement (connecté avec le compte de Tristan).
- Boucle client sur changement d'epoch : corrigée (le transport rouvre une nouvelle génération par bootstrap si même l'instantané est refusé ; régression rouge puis verte). Reste ouvert (Astra) : snapshot plafonné à 4 096 références.
- Tests de concurrence `economy` stabilisés : leurs échecs révélaient un achèvement de bâtiment trop long (relevé `science_places` ligne par ligne) dépassant le `lock_timeout` de 2 s d'un second worker ; corrigé par 061. `hookTimeout` vitest porté à 30 s (reset après construction). Suite complète verte (1384).
- Purge : deux passes concurrentes peuvent laisser un vecteur de dépendances orphelin (sans incidence de lecture).
- Aucune recette métier distante faite par l'agent (installation RC1, pose, atelier sur staging/alpha).
- [Revue d'architecture du 23 octobre](docs/REVUE-ARCHITECTURE-2026-10-23.md) (étude, rien d'implémenté) : refonte proposée du pathfinding et de l'économie, contraintes à respecter pendant la migration V2, points à trancher par Tristan.
- [Spec de refonte navigation/économie](docs/SPEC-REFONTE-NAVIGATION-ECONOMIE.md) (étude, rien d'implémenté) : constats de la revue vérifiés sur `5c1fb33`, quatre cibles avec lots et critères, huit décisions en section 8 à trancher par Tristan avant les lots N3, N4, E2, E4.
- [Audit de concurrence économique](docs/AUDIT-CONCURRENCE-ECONOMIE-2026-10-23.md) : aucune inversion d'ordre de verrous trouvée (lecture seule, non prouvé par test). L'explication des tests instables est à corriger : `lock_timeout` de test 4 s et barrière 5 s, pas 2 s ; 061 réduit la fenêtre sans sortir le relevé du verrou village. Risque principal : `finaliseExpedition` (exclusif, 500 ms) derrière des partagés longs. Correctifs minimaux en section 7.
- [Audit de la sync V2](docs/AUDIT-SYNC-V2-2026-10-23.md) : **boucle client réelle** si l'epoch change (restauration de sauvegarde) — `refresh(true)` applique le snapshot dans la même session, rejeté à `sync-v2.ts:516`, réessai toutes les 2 s avec snapshot complet, sans message ; correctif de quelques lignes côté client. Orphelins de purge réels mais bornés, référence pendante impossible (FK 059). Plafonds 4 096/1 024 : `RangeError` → 500, village inchargeable au-delà ; pagination prévue par la spec non implémentée.

## Suite proposée

Retrait progressif du V1 (lecture `GET /village`, SSE historique, chemins de commande V1 encore utilisés par les autres gestes) ; recenser d'abord les gestes encore V1. La lenteur de pose reprend quand Tristan le décide.
