# Reprise — état au 23 octobre 2026

Index court. L'historique détaillé (preuves, mesures, sessions précédentes) est archivé dans [docs/HANDOFF-ARCHIVE-2026-10-23.md](docs/HANDOFF-ARCHIVE-2026-10-23.md).

## État

- Branche de travail `wip/v2-commandes-bornees`, fusionnée en avance rapide dans `main`. Staging et alpha déployés à 061 (tags `*-2026.10.23.6`), contrôles publics OK.
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

- **Pose d'un bâtiment neuf encore lente au ressenti de Tristan** — remis à plus tard ; mesures et pistes en priorité 5 de [l'audit des coûts](docs/AUDIT-COUTS-SERVEUR-2026-10-21.md#priorités-restantes).
- Risques signalés par Astra, non reproduits : boucle client si une epoch change en cours de session (la purge ne change jamais l'epoch) ; snapshot plafonné à 4 096 références.
- Tests de concurrence `economy` stabilisés : leurs échecs révélaient un achèvement de bâtiment trop long (relevé `science_places` ligne par ligne) dépassant le `lock_timeout` de 2 s d'un second worker ; corrigé par 061. `hookTimeout` vitest porté à 30 s (reset après construction). Suite complète verte (1384).
- Purge : deux passes concurrentes peuvent laisser un vecteur de dépendances orphelin (sans incidence de lecture).
- Aucune recette métier distante faite par l'agent (installation RC1, pose, atelier sur staging/alpha).
- [Revue d'architecture du 23 octobre](docs/REVUE-ARCHITECTURE-2026-10-23.md) (étude, rien d'implémenté) : refonte proposée du pathfinding et de l'économie, contraintes à respecter pendant la migration V2, points à trancher par Tristan.
- [Spec de refonte navigation/économie](docs/SPEC-REFONTE-NAVIGATION-ECONOMIE.md) (étude, rien d'implémenté) : constats de la revue vérifiés sur `5c1fb33`, quatre cibles avec lots et critères, huit décisions en section 8 à trancher par Tristan avant les lots N3, N4, E2, E4.
- [Audit de concurrence économique](docs/AUDIT-CONCURRENCE-ECONOMIE-2026-10-23.md) : aucune inversion d'ordre de verrous trouvée (lecture seule, non prouvé par test). L'explication des tests instables est à corriger : `lock_timeout` de test 4 s et barrière 5 s, pas 2 s ; 061 réduit la fenêtre sans sortir le relevé du verrou village. Risque principal : `finaliseExpedition` (exclusif, 500 ms) derrière des partagés longs. Correctifs minimaux en section 7.
- [Audit de la sync V2](docs/AUDIT-SYNC-V2-2026-10-23.md) : **boucle client réelle** si l'epoch change (restauration de sauvegarde) — `refresh(true)` applique le snapshot dans la même session, rejeté à `sync-v2.ts:516`, réessai toutes les 2 s avec snapshot complet, sans message ; correctif de quelques lignes côté client. Orphelins de purge réels mais bornés, référence pendante impossible (FK 059). Plafonds 4 096/1 024 : `RangeError` → 500, village inchargeable au-delà ; pagination prévue par la spec non implémentée.

## Suite proposée

Correctif de la boucle d'epoch côté client ; agrandissement et amélioration en V2 ; puis retrait progressif du V1. La lenteur de pose reprend quand Tristan le décide.
