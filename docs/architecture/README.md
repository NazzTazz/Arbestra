# Architecture autoritaire

Arbestra est un monolithe modulaire TypeScript :

- `play-web` gère compte, lobby et sélection du monde ;
- `world-web` sépare React (état/UI) de Babylon.js (rendu/interactions spatiales) ;
- `api` porte les règles métier, les sessions opaques et le worker ;
- PostgreSQL 17 est la source de vérité, avec `world_id` dans chaque agrégat de monde ;
- `contracts` contient uniquement les contrats JSON réellement partagés.

HTTP JSON est le défaut. SSE/WebSocket, Redis et queues externes restent absents jusqu’à un besoin démontré.

## Direction produit, distincte de l'architecture livrée

La tranche [Jardins par parcelle, fusion et agrandissement tolérant](../SPEC-JARDINS-PARCELLES-FUSION.md) est présente dans le worktree avec la migration 015, mais reste **à corriger / à valider** : la [recette du 7 septembre](../REVIEW-2026-09-07-JARDINS.md) reproduit des défauts de migration, de balayage et de collision. PostgreSQL porte le stock et le curseur de chaque parcelle ; le snapshot expose les composantes cardinales fusionnées.

La [direction produit consolidée](../DIRECTION-PRODUIT.md) fixe le parcours initial et les intentions population/Oracle/karma, avec leurs points ouverts. Le [lore TRY](../../docs-lore/TRY-SAMSARA.md) pose l'expérience sans inscription et l'isolation du monde persistant. Ces documents ne prescrivent pas une implémentation générale ; une spec bornée reste nécessaire pour chaque tranche.

Conventions et tranches implémentées :

- [Monde et grille](./world-grid.md)
- [Espace mondial et occupation](./world-space-and-occupancy.md)
- [Génération d’un monde](./world-generation.md)
- [Bâtiments et catalogue](./building-catalog.md)
- [Construction spatiale et Jardin surfacique](./spatial-construction.md)
- [Économie](./economy.md)
- [Temps serveur](./server-time.md)

## Population et cadrages associés

Le premier accomplissement persistant et le grimoire de l'Oracle sont implémentés par la migration 014 ; voir la section correspondante dans [Économie](./economy.md) et le [handoff](../HANDOFF-SOL-2026-09-07-COFFRE-JOURNAL-ORACLE.md). L'indice validé attend 90 secondes visibles sans action réussie ni découverte du coffre ; son suivi reste une présentation de session côté React, sans autorité économique. Voir la [spec](../SPEC-COFFRE-JOURNAL-ORACLE.md).

- [Habitants par cohortes et récolte différée](../SPEC-TERRA-2026-09-05-habitants-et-recolte.md) — implémentés avec repas, repos et intégration React ; voir la reprise courante pour les preuves et réserves.
- [Version product owner](../PO-CAFE-CLOPE-2026-09-05-habitants-et-recolte.md) — même périmètre, lecture joueur.
- [Brief Exploitation](./Sol-Brief-exploit.md) — cadrage futur des gisements, pas une architecture livrée ni une spec approuvée.

Pour les consignes et preuves de livraison : [AGENTS.md](../../AGENTS.md), [workflow](../AGENT-WORKFLOW.md), [reprise courante](../../SESSION-HANDOFF.md). Les reviews et notes de contexte datées restent historiques ; vérifier le code actuel.


## Mise à jour — gisements pierre

La [spec approuvée](../SPEC-ASTRA-2026-09-05-EXPLOITATION-GISEMENTS.md) remplace le brief prospectif pour cette tranche. Voir le [handoff](../HANDOFF-ASTRA-2026-09-05-gisements.md) et les [appels React](../API-EXPLOITATION-GISEMENTS.md). Le menu React est branché ; Tristan a confirmé la validation humaine du fonctionnement complet le 6 septembre. La reprise courante distingue cette validation des corrections ultérieures de revue et de la suite Playwright historique.
