# Dette technique

Registre des dettes connues et acceptées : ce qui reste à reprendre, pourquoi ce n'est pas fait, et quand. Une entrée sort du registre quand sa tranche est livrée et validée.

## Ouvertes

### Routes manuelles qui ne suivent pas le terrain (31 octobre 2026) — livré le 4 novembre, à valider

- **Constat initial.** Une case de route tracée à la main était une tuile plane en thin instance (S2c, [spec voirie §4.6](SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md)), inclinée sur le plan moyen de la case ; une route automatique suit le terrain sommet par sommet. Sur une pente, les deux ne se raccordaient pas.
- **Fait** (branches `roads-follow-slope-2` puis `roads-slope-fix`). Toutes les cases suivent le terrain sommet par sommet par `scene/road-cell-surfaces.ts` : la terre et les gravats avec la géométrie des routes automatiques, la pierre et les trottoirs avec leurs tuiles posées sur le sol (aspect inchangé, 2 cm de garde de la pierre conservés). Plus de thin instances de tuiles. Détail, choix et mesures : [spec voirie §4.6](SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md).
- **Retour de recette du staging, corrigé** : la jonction d'une case de route manuelle avec une route automatique avait un trou d'une demi-case (la route automatique est masquée sous les cases de route et ne dessinait pas son dernier bras). Corrigé par `scene/road-cell-links.ts`.
- **Sol vrillé, corrigé** (retour de recette du staging) : les faces de la pierre sont découpées le long de la diagonale du terrain, chacune dans un seul triangle du terrain ; plus de trous (voir la spec §4.6).
- **Reste.** Les bordures et les tuiles d'une grande pose apparaissent sur quelques images, la surface de terre tout de suite. Image longue d'environ 200 ms autour d'une pose, présente avant ce travail et hors des routes (travail de la scène après publication de l'état, à étudier).

### Verrou mondial `infrastructure:<monde>` (4 novembre 2026) — livré, à valider

- **Constat** ([test de charge](TEST-DE-CHARGE.md) §8.3) : chaque commande économique le prenait en partage, chaque écrivain spatial en exclusif ; un seul écrivain arrêtait tout le monde et le pool de 8 connexions s'épuisait derrière lui.
- **Fait** (branche `world-lock-scope`) : verrous par zone (chunk), partagés sur la région du village, exclusifs sur les cases écrites à ±2 cases ; carte, garanties, preuves et mesures dans [VERROUS-2026-11-04.md](VERROUS-2026-11-04.md).
- **Contre-revue** (branche `zone-locks-fixes`, à valider) : un trajet vers un gisement reconnu par la science sortait de la région et ses zones étaient prises en retard (trajet périmé, interblocage). Plus aucune zone n'est prise après un gisement : la transaction est rejouée une fois avec les zones apprises, puis refusée ; les trajets distants déjà inscrits sont déclarés d'emblée. Clé du monde et cache après savepoint corrigés ([§10](VERROUS-2026-11-04.md#10-contre-revue-du-4-novembre)).
- **Reste** : un premier départ vers un gisement distant coûte un rejeu de sa transaction ; le worker de trajets (invalidation globale, ci-dessous « Trajets ») et le pool partagé entre requêtes et scheduler (worker hors de l'API, autre chantier) ; une transaction tient encore ses zones pendant son calcul de trajets.

### Installation : poses du kit sous verrou mondial exclusif (1er novembre 2026)

- **Fait le 1er novembre.** Le plan d'installation de l'hôtel de ville se calcule hors du verrou mondial `infrastructure:<monde>`, puis il est réutilisé sous le verrou si l'instantané n'a pas changé (sinon, recalcul sous le verrou). L'échantillonnage du réseau d'accès ne lit plus que l'altitude et l'eau. Sur rc1-dev, pose de bout en bout 6,7 s, contre 12,8 s mesurées pendant la recette de Tristan.
- **Fait le 4 novembre (à valider, branche `world-lock-scope`)** : la pose d'un élément du kit ne prend plus que les zones de l'élément en exclusif, et l'installation la clé du monde (entre installations et territoires) puis les zones à ±64 cases du point ; les villages éloignés ne l'attendent plus ([verrou mondial](VERROUS-2026-11-04.md)).
- **Reste.** L'instantané de l'installation et de la pose couvre toujours le monde entier : une écriture validée ailleurs entre le plan hors verrou et le verrou force un nouveau calcul (coût, pas correction). Une première installation dans un monde sans chunks reste exclusive sur tout le monde.
- **Mondes à terrasses.** Sur l'ancien modèle de terrain (aube, recette-nivellement, fixture des tests d'intégration), le plan coûte toujours environ 10 s, l'échantillonnage restant procédural. L'alpha et le staging sont en sommets partagés.

### Trajets : coût et invalidation à revoir dans leur conception (31 octobre 2026)

- **Décision de Tristan (31 octobre)** : pas de nouveau correctif du pathfinding pour l'instant (six ou sept correctifs successifs à plusieurs échelles) ; il repense la méthode. Les constats ci-dessous servent de matière, pas de plan.
- **Retouche de terrain lente : résolu** (vérifié le 4 novembre 2026) : `terrain-edits.ts` n'appelle plus `assertAccess` ni aucun calcul de réseau de trajets depuis la terraformation instantanée du 31 octobre ; une retouche peut couper un accès, c'est au joueur de le rétablir. Le coût de recalcul subsiste seulement à la lecture suivante (point suivant).
- **Invalidation globale** : toute empreinte de cache des trajets contient l'identité du sol du monde entier (`rc1-network-ground.ts` `revision`, `rc1-ground-version.ts`, `networkFingerprint` de `presentation.ts`, caches de `buildTravelNetwork` dans `travel-paths.ts`). Une retouche n'importe où recalcule le réseau de chaque village à sa prochaine lecture (1,8 à 4 s mesurés pour un sommet à 260 cases de Bressuire). Toujours vrai le 4 novembre 2026 : `rc1-network-ground.ts` hache tous les sommets, terrasses et arbres du monde, et `networkFingerprint` inclut `navigationEdits` en entier. Les certificats par chunk de `route-cache.ts` sont locaux mais ne servent qu'aux routes de l'hôtel de ville et aux expéditions.
- **Limite latente** : les clés de géométrie (`rc1-ground.ts` `MAX_GEOMETRY_KEY`, worker `compute-worker.ts`) sérialisent tous les sommets retouchés ; au-delà d'environ 3 000 sommets (une soixantaine de nivellements), ces caches cessent silencieusement de servir. Toujours vrai le 4 novembre 2026 : `MAX_GEOMETRY_KEY` vaut 131 072 caractères (`rc1-ground.ts`), `compute-worker.ts` sérialise toujours les retouches dans ses clés ; plus personne n'attend ce cache dans une commande de retouche, donc l'effet est surtout un recalcul à la lecture.
- Pistes évaluées et mises de côté le 31 octobre : contrôle d'accès sur la file de calcul, identité du sol bornée à la région du village, réutilisation des routes à plus de 8 cases d'une retouche (résultat dépendant de l'historique).
