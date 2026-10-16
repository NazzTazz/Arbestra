# Console opérateur Arbestra

Application React/Vite dédiée à la supervision, distincte des interfaces joueur.
La V1 consulte les mondes, comptes, villages, activités persistées et les métriques
du processus API répondant. Les opérations d’administration métier ne sont pas
exposées dans cette version.

Depuis la racine du dépôt :

```powershell
corepack pnpm --filter @arbestra/admin-web dev
corepack pnpm --filter @arbestra/admin-web typecheck
corepack pnpm --filter @arbestra/admin-web build
```

Le serveur local écoute `localhost:5175` (`5275` en mode e2e). Le proxy `/api`
vise `http://127.0.0.1:3000` par défaut. `VITE_API_PROXY_TARGET` permet de choisir
une autre API locale sans intégrer de secret au navigateur.

L’authentification utilise uniquement `/api/admin/session` et le cookie opérateur
dédié. Les habilitations sont contrôlées par l’API ; aucune variable client ne
confère un accès. Déployer les fichiers de `dist` avec le routage `/api` de la
console et la configuration serveur des origines autorisées.

Les graphiques utilisent les séries réellement reçues. Les valeurs absentes
restent inconnues et les dernières données conservées après un échec sont
marquées anciennes. Les compteurs SSE portent sur l’instance observée et ne
mesurent pas la présence réelle des joueurs. L’économie du village est affichée
dans son état persisté, sans déclencher de réconciliation.

Vérifications pures, sans base de données :

```powershell
corepack pnpm exec vitest run --configLoader runner apps/admin-web/src/format.test.ts
corepack pnpm exec eslint apps/admin-web
```
