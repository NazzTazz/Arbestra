# Reprise — état au 23 octobre 2026

Index court. L'historique détaillé (preuves, mesures, sessions précédentes) est archivé dans [docs/HANDOFF-ARCHIVE-2026-10-23.md](docs/HANDOFF-ARCHIVE-2026-10-23.md).

## État

- Branche de travail `wip/v2-commandes-bornees`, fusionnée en avance rapide dans `main`. Staging et alpha déployés à `8415fe0` (tags `*-2026.10.23.5`), contrôles publics OK.
- Autorisations durables de Tristan : commits, push, fusion dans `main`, déploiements staging/alpha et enchaînement des tranches, sans aval de routine. Restent à lui demander : gameplay, base de développement locale, actions destructives sur données joueurs.
- Migrations 051–060 appliquées en test, staging et alpha ; **pas sur la base de développement locale** (sauvegarde et commande à lancer par Tristan : `corepack pnpm db:migrate`).

## Livré (V2, commandes bornées)

- Village complet synchronisé en V2 sur staging et alpha (`VITE_SYNC_V2=1` dans `ops/deploy/build.sh` ; option locale `arbestra:sync-v2` en développement). Atelier et pose de bâtiment répondent sur le contrat V2 ; extension et amélioration restent V1 suivies d'une relecture V2.
- Présentation versionnée (région versionnée, `knownRegion`), convois publics (flux `traffic`, 057).
- Journal V2 : purge bornée (7 jours / 10 000 entrées par flux, `sync-v2-retention.ts`), dépendances de lot stockées une fois (059).
- Coût des insertions en masse (058, 060) : première installation RC1 en test 205 s → 11 s.
- Pose V2 affichée dès la confirmation, sans attendre la relecture de présentation.

Spec : [docs/SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md](docs/SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md). Étude Astra : [docs/ETUDE-JOURNAL-SYNC-DEPENDANCES.md](docs/ETUDE-JOURNAL-SYNC-DEPENDANCES.md). Arbitrages : [docs/ARBITRAGES-OUVERTS-V2.md](docs/ARBITRAGES-OUVERTS-V2.md) (aucun ouvert).

## Ouvert

- **Pose d'un bâtiment neuf encore lente au ressenti de Tristan** — remis à plus tard ; mesures et pistes en priorité 5 de [l'audit des coûts](docs/AUDIT-COUTS-SERVEUR-2026-10-21.md#priorités-restantes).
- Risques signalés par Astra, non reproduits : boucle client si une epoch change en cours de session (la purge ne change jamais l'epoch) ; snapshot plafonné à 4 096 références.
- Test `economy` « serializes two workers… » : échec ponctuel de barrière (5 s) dans la suite complète, 3/3 seul ; instabilité de timing à surveiller.
- Purge : deux passes concurrentes peuvent laisser un vecteur de dépendances orphelin (sans incidence de lecture).
- Aucune recette métier distante faite par l'agent (installation RC1, pose, atelier sur staging/alpha).

## Suite proposée

Correctif de la boucle d'epoch côté client ; agrandissement et amélioration en V2 ; puis retrait progressif du V1. La lenteur de pose reprend quand Tristan le décide.
