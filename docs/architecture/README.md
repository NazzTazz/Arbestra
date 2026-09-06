# Architecture autoritaire

Arbestra est un monolithe modulaire TypeScript :

- `play-web` gère compte, lobby et sélection du monde ;
- `world-web` sépare React (état/UI) de Babylon.js (rendu/interactions spatiales) ;
- `api` porte les règles métier, les sessions opaques et le worker ;
- PostgreSQL 17 est la source de vérité, avec `world_id` dans chaque agrégat de monde ;
- `contracts` contient uniquement les contrats JSON réellement partagés.

HTTP JSON est le défaut. SSE/WebSocket, Redis et queues externes restent absents jusqu’à un besoin démontré.

Conventions et tranches implémentées :

- [Monde et grille](./world-grid.md)
- [Espace mondial et occupation](./world-space-and-occupancy.md)
- [Génération d’un monde](./world-generation.md)
- [Bâtiments et catalogue](./building-catalog.md)
- [Construction spatiale et Jardin surfacique](./spatial-construction.md)
- [Économie](./economy.md)
- [Temps serveur](./server-time.md)

## Population et cadrages associés

- [Habitants par cohortes et récolte différée](../SPEC-TERRA-2026-09-05-habitants-et-recolte.md) — implémentés avec repas, repos et intégration React ; voir la reprise courante pour les preuves et réserves.
- [Version product owner](../PO-CAFE-CLOPE-2026-09-05-habitants-et-recolte.md) — même périmètre, lecture joueur.
- [Brief Exploitation](./Sol-Brief-exploit.md) — cadrage futur des gisements, pas une architecture livrée ni une spec approuvée.

Pour les consignes et preuves de livraison : [AGENTS.md](../../AGENTS.md), [workflow](../AGENT-WORKFLOW.md), [reprise courante](../../SESSION-HANDOFF.md). Les reviews et notes de contexte datées restent historiques ; vérifier le code actuel.


## Mise à jour — gisements pierre

La [spec approuvée](../SPEC-ASTRA-2026-09-05-EXPLOITATION-GISEMENTS.md) remplace le brief prospectif pour cette tranche. Voir le [handoff](../HANDOFF-ASTRA-2026-09-05-gisements.md) et les [appels React](../API-EXPLOITATION-GISEMENTS.md). Le menu React est branché ; Tristan a confirmé la validation humaine du fonctionnement complet le 6 septembre. La reprise courante distingue cette validation des corrections ultérieures de revue et de la suite Playwright historique.
