# Navigation — invariants de gameplay du 31 octobre 2026

Décisions de Tristan (validées). Elles cadrent l'enquête d'architecture sur les trajets ; aucun code de navigation n'est modifié tant que le diagnostic n'est pas rendu.

1. **Le moteur garantit la cohérence physique du monde, pas la pertinence des décisions du joueur.** Un joueur peut légitimement rendre son village, ses bâtiments ou ses exploitations inaccessibles par terraformation (exemple : des douves défensives). La terraformation garantit la validité géométrique et la cohérence du terrain, **pas la connectivité**.
2. **Tout terrain physiquement praticable est navigable**, qu'une route existe ou non. Les routes sont magnétiques : elles attirent les itinéraires (coût moindre), sans être obligatoires. Les lignes de désir émergent des déplacements et peuvent guider le joueur, mais ne sont jamais une source de vérité sur l'accessibilité physique.
3. Notions à distinguer : praticabilité physique ; connectivité et accessibilité des destinations ; coûts et préférences d'itinéraire ; déplacements réellement effectués ; lignes de désir observées.
4. Une destination peut devenir inaccessible après une modification du terrain ; la navigation le constate quand c'est pertinent (demande de déplacement), et un trajet engagé peut être réévalué si son passage devient impraticable. Cela ne justifie pas, en soi, une vérification globale de connectivité à chaque modification.
5. Conséquence identifiée : le contrôle d'accès de la retouche de terrain (`LEVELING_ACCESS`, deux réseaux complets du village) impose une garantie non demandée. Il n'est ni optimisé ni remplacé tant que l'enquête n'a pas établi quels calculs restent nécessaires.
6. Méthode : supprimer une responsabilité injustifiée plutôt qu'optimiser indéfiniment son exécution. Besoins à prendre en compte sans les supposer communs à toutes les entités : convois, charrettes, gabarits, rayons de braquage, routes préférentielles, usure, déplacements militaires.
