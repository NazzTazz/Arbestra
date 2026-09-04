# Architecture autoritaire

Arbestra est un monolithe modulaire TypeScript :

- `play-web` gère compte, lobby et sélection du monde ;
- `world-web` sépare React (état/UI) de Babylon.js (rendu/interactions spatiales) ;
- `api` porte les règles métier, les sessions opaques et le worker ;
- PostgreSQL 17 est la source de vérité, avec `world_id` dans chaque agrégat de monde ;
- `contracts` contient uniquement les contrats JSON réellement partagés.

HTTP JSON est le défaut. SSE/WebSocket, Redis et queues externes restent absents jusqu’à un besoin démontré.

Spécifications :

- [Monde et grille](./world-grid.md)
- [Bâtiments et catalogue](./building-catalog.md)
- [Économie](./economy.md)
- [Temps serveur](./server-time.md)
