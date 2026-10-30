# Dette technique

Registre des dettes connues et acceptées : ce qui reste à reprendre, pourquoi ce n'est pas fait, et quand. Une entrée sort du registre quand sa tranche est livrée et validée.

## Ouvertes

### Routes de terre et de gravats qui ne suivent pas le terrain (31 octobre 2026)

- **Constat.** Une case de route tracée à la main est une tuile plane en thin instance (S2c, [spec voirie §4.6](SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md)), inclinée sur le plan moyen de la case et relevée au-dessus de son point échantillonné le plus haut. Une route automatique suit le terrain sommet par sommet (`flatRoadGeometry` avec la hauteur réelle du sol). Sur une pente, les deux ne se raccordent pas exactement.
- **Déjà corrigé** (`08d5e37`). Sur sol plat, la terre et les gravats manuels étaient 2 cm plus hauts que les routes automatiques (marge `TILT_CLEARANCE` prévue pour la pierre). Ils n'ont plus de marge et sont à la même hauteur.
- **À faire** (recommandé). Rendre les cases de terre et de gravats par le rendu par secteurs des routes automatiques (`InfrastructureRenderer`), la pierre restant en tuiles. Estimation : 2 à 3 h. Une pose reconstruit alors un secteur de 8 × 8 cases au lieu de 5 instances : mesurer le coût d'une pose dans le navigateur (aucune image > 100 ms) et borner le travail par pose dans un test. Autre voie si la pierre en pente pose aussi problème : courber les tuiles dans le shader à partir des 9 hauteurs de la case (une demi-journée à une journée).
- **Échéance.** Décision de Tristan du 31 octobre : ne bloque pas la prochaine mise à jour alpha (fin de la synchro V2 et de la voirie) ; à faire juste après.
