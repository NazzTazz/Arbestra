# Arbestra

Jeu de stratégie web persistant : deux frontends React, une scène Babylon.js, un monolithe Fastify et PostgreSQL comme source de vérité.

## Développement local

Prérequis : Node.js 24+, Corepack/pnpm et PostgreSQL 17.

```powershell
Copy-Item .env.example .env.dev
New-Item -ItemType SymbolicLink -Path .env -Target .env.dev
corepack pnpm db:setup
corepack pnpm dev
```

- Lobby : <http://localhost:5173>
- Monde : <http://localhost:5174/?world=aube>
- Compte de développement : `player@arbestra.local` / `arbestra`

## Tests

Les tests PostgreSQL refusent toute base dont le nom ne finit pas par `_test`.

```sql
-- À exécuter une fois avec un rôle PostgreSQL autorisé :
create database arbestra_test owner arbestra;
```

```powershell
Copy-Item .env.test.example .env.test
corepack pnpm db:test:setup
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

## Travail avec les agents

Commencer par [AGENTS.md](./AGENTS.md) et l'état courant de [SESSION-HANDOFF.md](./SESSION-HANDOFF.md). Le [workflow de tranche](./docs/AGENT-WORKFLOW.md) précise les statuts, la validation et le format de passation.

Les conventions durables sont dans [docs/architecture](./docs/architecture/README.md). Les specs prospectives y sont signalées séparément du code livré.

La [direction produit](./docs/DIRECTION-PRODUIT.md) rassemble les décisions actuelles et les questions ouvertes sur la découverte, la population et la protection des joueurs. Le [lore TRY — Samsara](./docs-lore/TRY-SAMSARA.md) décrit l'expérience d'essai ; ces intentions ne sont pas une liste de fonctionnalités livrées.
