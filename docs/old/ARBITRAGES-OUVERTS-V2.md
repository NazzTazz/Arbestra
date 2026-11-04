# Arbitrages ouverts — transition V2 (commandes bornées et synchronisation ciblée)

Ouvert le 22 octobre 2026 pendant une session autonome ; O1–O5 tranchés par Tristan le même jour. **Aucun point ci-dessous n'a été tranché à la place de Tristan.** Pour chacun, le code actuel applique l'option la plus conservatrice (parité avec V1 ou statu quo), réversible sans migration destructive. Répondre par numéro suffit ; la suite s'appliquera sans reprendre le contexte.

Statuts : **ouvert** (décision attendue), **tranché** (décision reçue, à reporter dans la spec).

## Tranchés

| # | Sujet | Décision | Report |
|---|---|---|---|
| T1 | Visibilité des convois | Entités publiques et observables du monde ; données commerciales privées ; base de la future dimension militaire. Pas de mécanique militaire maintenant. | Spec §6.1, flux `traffic` (057), mémoire projet |
| O1 | Portée de visibilité des convois | (a) Monde entier jusqu'à la spécification des règles de vue ; filtrage futur au point unique `visibleConvoys`. | Code inchangé (déjà conforme) |
| O2 | Champs publics d'un convoi | (a) Origine et destination restent observables. | Code inchangé (déjà conforme) |
| O3 | Activation V2 par défaut | Accord sur la séquence : staging d'abord avec `VITE_SYNC_V2=1`, recette, puis alpha ; chaque migration/déploiement reste soumis à accord explicite au moment voulu. | Pas d'action tant que les prérequis ne sont pas remplis |
| O4 | Rythme visible de l'économie en V2 | Accepté : les échéances apparaissent après passage du planificateur ; latence à mesurer en staging. | Spec inchangée (déjà conforme) |
| O5 | Historique affiché des chantiers | Rétablir la limite V1 des 32 plus récents. | `createdAt` transmis, plafond rétabli dans le projecteur |

## Ouverts

Aucun pour l'instant. Les nouveaux points seront ajoutés ici avec la même structure : question, contexte, état réversible du code, options, recommandation.
