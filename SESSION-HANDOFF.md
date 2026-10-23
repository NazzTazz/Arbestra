# Reprise — état au 23 octobre 2026

Index court. L'historique détaillé (preuves, mesures, sessions précédentes) est archivé dans [docs/HANDOFF-ARCHIVE-2026-10-23.md](docs/HANDOFF-ARCHIVE-2026-10-23.md).

## État

- Branche de travail `wip/v2-commandes-bornees`, fusionnée en avance rapide dans `main`. Staging et alpha déployés à `947d6c2` (tags `staging-2026.10.23.11`, `alpha-2026.10.23.8`), contrôles publics OK.
- **Jusqu'au 23 octobre ~17 h, la V2 n'a jamais tourné en prod** : son contrôle d'activation lisait `kysely_migration`, interdite au rôle applicatif (`deploy.py`) → 500 sur toutes les routes V2 et repli silencieux du client sur V1. Corrigé (`1383eb4`, contrôle par le catalogue, régression qui reproduit les droits de prod). Les recettes staging antérieures portaient donc sur la V1.
- Autorisations durables de Tristan : commits, push, fusion dans `main`, déploiements staging/alpha et enchaînement des tranches, sans aval de routine. Restent à lui demander : gameplay, base de développement locale, actions destructives sur données joueurs.
- Migrations 051–061 appliquées en test, staging et alpha ; **pas sur la base de développement locale** (sauvegarde et commande à lancer par Tristan : `corepack pnpm db:migrate`).

## Livré (V2, commandes bornées)

- Village complet synchronisé en V2 sur staging et alpha (`VITE_SYNC_V2=1` dans `ops/deploy/build.sh` ; option locale `arbestra:sync-v2` en développement). Atelier et pose de bâtiment répondent sur le contrat V2 ; extension et amélioration restent V1 suivies d'une relecture V2.
- Présentation versionnée (région versionnée, `knownRegion`), convois publics (flux `traffic`, 057).
- Journal V2 : purge bornée (7 jours / 10 000 entrées par flux, `sync-v2-retention.ts`), dépendances de lot stockées une fois (059).
- Coût des insertions en masse (058, 060, 061) : première installation RC1 en test 205 s → 11 s ; achèvement d'un bâtiment (relevé `science_places`) 3,0–3,5 s → 0,9 s de verrou village.
- Pose V2 affichée dès la confirmation, sans attendre la relecture de présentation.
- Prettier sur tout le code (`16ca6cc` outillage, `102c5f4` formatage seul, ignoré par `git blame` via `.git-blame-ignore-revs`) ; règle dans AGENTS.md.

Spec : [docs/SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md](docs/SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md). Étude Astra : [docs/ETUDE-JOURNAL-SYNC-DEPENDANCES.md](docs/ETUDE-JOURNAL-SYNC-DEPENDANCES.md). Arbitrages : [docs/ARBITRAGES-OUVERTS-V2.md](docs/ARBITRAGES-OUVERTS-V2.md) (aucun ouvert).

## Ouvert

- Pose d'un bâtiment neuf : **résolue sur staging** (mesure navigateur réelle : 4,9 s → 0,27 s). Causes : V2 inactive en prod (ci-dessus), JIT PostgreSQL sur une requête composite (pool API en `jit=off`) et contrôle de croisement des trajets réécrit. Détails : priorité 5 de [l'audit des coûts](docs/AUDIT-COUTS-SERVEUR-2026-10-21.md#priorités-restantes).
- **Passerelle Caddy (VPS, hors dépôt applicatif)** : `respond @crossSite 403` rejette aussi les navigations de page venant d'un autre site (lien Discord, moteur de recherche). À restreindre à `/api/*` dans la config du VPS (`ops/deploy/bootstrap.py` pour l'installation initiale).
- Diagnostic prod : `localStorage['arbestra:timing']='1'` → Server-Timing sur les requêtes V2 (phases, 3 instructions les plus lentes `arbsql_n`, profil par partie de la préparation de pose `arbpart_n`). L'extension Claude in Chrome permet à l'agent de mesurer sur staging, Tristan ouvrant l'URL (les navigations lancées par l'extension prennent le 403 inter-sites).
- Risques signalés par Astra, non reproduits : boucle client si une epoch change en cours de session (la purge ne change jamais l'epoch) ; snapshot plafonné à 4 096 références.
- Tests de concurrence `economy` stabilisés : leurs échecs révélaient un achèvement de bâtiment trop long (relevé `science_places` ligne par ligne) dépassant le `lock_timeout` de 2 s d'un second worker ; corrigé par 061. `hookTimeout` vitest porté à 30 s (reset après construction). Suite complète verte (1384).
- Purge : deux passes concurrentes peuvent laisser un vecteur de dépendances orphelin (sans incidence de lecture).
- Aucune recette métier distante faite par l'agent (installation RC1, pose, atelier sur staging/alpha).

## Suite proposée

Correctif de la boucle d'epoch côté client ; agrandissement et amélioration en V2 ; puis retrait progressif du V1. La lenteur de pose reprend quand Tristan le décide.
