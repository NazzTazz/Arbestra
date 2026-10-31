# Dette technique

Registre des dettes connues et acceptées : ce qui reste à reprendre, pourquoi ce n'est pas fait, et quand. Une entrée sort du registre quand sa tranche est livrée et validée.

## Ouvertes

### Routes de terre et de gravats qui ne suivent pas le terrain (31 octobre 2026)

- **Constat.** Une case de route tracée à la main est une tuile plane en thin instance (S2c, [spec voirie §4.6](SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md)), inclinée sur le plan moyen de la case et relevée au-dessus de son point échantillonné le plus haut. Une route automatique suit le terrain sommet par sommet (`flatRoadGeometry` avec la hauteur réelle du sol). Sur une pente, les deux ne se raccordent pas exactement.
- **Déjà corrigé** (`08d5e37`). Sur sol plat, la terre et les gravats manuels étaient 2 cm plus hauts que les routes automatiques (marge `TILT_CLEARANCE` prévue pour la pierre). Ils n'ont plus de marge et sont à la même hauteur.
- **À faire** (recommandé). Rendre les cases de terre et de gravats par le rendu par secteurs des routes automatiques (`InfrastructureRenderer`), la pierre restant en tuiles. Estimation : 2 à 3 h. Une pose reconstruit alors un secteur de 8 × 8 cases au lieu de 5 instances : mesurer le coût d'une pose dans le navigateur (aucune image > 100 ms) et borner le travail par pose dans un test. Autre voie si la pierre en pente pose aussi problème : courber les tuiles dans le shader à partir des 9 hauteurs de la case (une demi-journée à une journée).
- **Échéance.** Décision de Tristan du 31 octobre : ne bloque pas la prochaine mise à jour alpha (fin de la synchro V2 et de la voirie) ; à faire juste après.

### Trajets : coût et invalidation à revoir dans leur conception (31 octobre 2026)

- **Décision de Tristan (31 octobre)** : pas de nouveau correctif du pathfinding pour l'instant (six ou sept correctifs successifs à plusieurs échelles) ; il repense la méthode. Les constats ci-dessous servent de matière, pas de plan.
- **Retouche de terrain lente** : le contrôle d'accès de `terrainEditsCommandV2` (`apps/api/src/modules/villages/terrain-edits.ts`, `assertAccess`) calcule deux réseaux complets du village (avant, après) sur le fil principal de l'API, sans cache utile. Mesures sur Bressuire (dev) : 1,7 à 5 s par nivellement d'université hors serveur, environ 10 s observées dans la recette de Tristan (écart non expliqué) ; les autres requêtes attendent pendant ce temps.
- **Invalidation globale** : toute empreinte de cache des trajets contient l'identité du sol du monde entier (`rc1-network-ground.ts` `revision`, `rc1-ground-version.ts`, `networkFingerprint` de `presentation.ts`, caches de `buildTravelNetwork` dans `travel-paths.ts`). Une retouche n'importe où recalcule le réseau de chaque village à sa prochaine lecture (1,8 à 4 s mesurés pour un sommet à 260 cases de Bressuire). Les certificats par chunk de `route-cache.ts` sont locaux mais ne servent qu'aux routes de l'hôtel de ville et aux expéditions.
- **Limite latente** : les clés de géométrie (`rc1-ground.ts` `MAX_GEOMETRY_KEY`, worker `compute-worker.ts`) sérialisent tous les sommets retouchés ; au-delà d'environ 3 000 sommets (une soixantaine de nivellements), ces caches cessent silencieusement de servir.
- Pistes évaluées et mises de côté le 31 octobre : contrôle d'accès sur la file de calcul, identité du sol bornée à la région du village, réutilisation des routes à plus de 8 cases d'une retouche (résultat dépendant de l'historique).
