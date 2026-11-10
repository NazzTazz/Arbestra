# Navigation — invariants de gameplay du 31 octobre 2026

Décisions de Tristan (validées). Elles cadrent l'enquête d'architecture sur les trajets ; aucun code de navigation n'est modifié tant que le diagnostic n'est pas rendu.

1. **Le moteur garantit la cohérence physique du monde, pas la pertinence des décisions du joueur.** Un joueur peut légitimement rendre son village, ses bâtiments ou ses exploitations inaccessibles par terraformation (exemple : des douves défensives). La terraformation garantit la validité géométrique et la cohérence du terrain, **pas la connectivité**.
2. **Tout terrain physiquement praticable est navigable**, qu'une route existe ou non. Les routes sont magnétiques : elles attirent les itinéraires (coût moindre), sans être obligatoires. Les lignes de désir émergent des déplacements et peuvent guider le joueur, mais ne sont jamais une source de vérité sur l'accessibilité physique.
3. Notions à distinguer : praticabilité physique ; connectivité et accessibilité des destinations ; coûts et préférences d'itinéraire ; déplacements réellement effectués ; lignes de désir observées.
4. Une destination peut devenir inaccessible après une modification du terrain ; la navigation le constate quand c'est pertinent (demande de déplacement), et un trajet engagé peut être réévalué si son passage devient impraticable. Cela ne justifie pas, en soi, une vérification globale de connectivité à chaque modification.
5. Conséquence identifiée : le contrôle d'accès de la retouche de terrain (`LEVELING_ACCESS`, deux réseaux complets du village) impose une garantie non demandée. Il n'est ni optimisé ni remplacé tant que l'enquête n'a pas établi quels calculs restent nécessaires.
6. Méthode : supprimer une responsabilité injustifiée plutôt qu'optimiser indéfiniment son exécution. Besoins à prendre en compte sans les supposer communs à toutes les entités : convois, charrettes, gabarits, rayons de braquage, routes préférentielles, usure, déplacements militaires.

## Décisions de game design du 10 novembre 2026

Réponses de Tristan aux questions ouvertes du [diagnostic](DIAGNOSTIC-NAVIGATION-2026-10-31.md) §7 (validées). Elles cadrent la méthode de la refonte des trajets.

7. **Trajet engagé** : on garde le refus actuel. Une modification de terrain, de route, d'ancrage ou de construction qui couperait le passage d'une équipe en route est refusée (`ENGAGED_PASSAGE`). Un trajet engagé n'est donc jamais réévalué : il reste praticable jusqu'à son terme.
8. **Les routes accélèrent** : la durée d'un trajet suit le coût de son chemin, une case de route comptant 0,7 s au lieu de 1 s (même facteur que la recherche, `ROAD_STEP_COST`). La pente n'entre pas dans la durée. Les durées restent figées au départ de la mission. Effet attendu : tournées plus courtes, équilibrage à vérifier.
9. **Lignes de désir observées** : les routes automatiques naissent des trajets réellement effectués, pas d'un réseau calculé vers tous les buts du village. Sans usure pour l'instant. Les routes automatiques existantes sont conservées comme état de départ. Le réseau « tous buts » n'a plus de responsabilité dans la simulation.
10. **Lieu inaccessible** : seules les missions qui doivent s'y rendre sont refusées, au moment de la demande (`DESTINATION_UNREACHABLE`). Le bâtiment continue de produire ; aucun contrôle global d'accessibilité.
11. **Profils de déplacement** (piéton, charrette, convoi, armée) : reportés à l'arrivée des convois. La refonte garde le seul profil piéton cardinal, avec des caches qui pourront être indexés par profil.
