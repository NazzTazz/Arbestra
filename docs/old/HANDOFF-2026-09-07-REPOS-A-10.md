# Repos jusqu'à énergie 10 — clôture

7 septembre 2026, base `cec0d72`. Tristan valide le remplacement des cinq heures minimales de repos volontaire par un réveil dès l'énergie exacte 10. Les cinq heures continues restent la condition de remise à zéro du quota alimentaire.

## Résultat

`advanceEnergy()` réveille à la frontière 10 et poursuit la projection en activité idle. Une sieste courte conserve le quota consommé ; le cycle automatique depuis zéro restaure toujours ce quota après cinq heures. `beginRest()` exclut les habitants exactement pleins. Une jauge affichant 10 peut masquer une petite fatigue fractionnaire : un repos bref reste alors possible.

Les anciennes cohortes déjà à 10 et au repos sont rendues disponibles à la lecture, y compris sans temps supplémentaire écoulé. Aucune migration, aucun nouveau reset du village dev. Les règles et la note prospective sur l'affichage des réveils sont actualisées.

## Preuves

- Avant correction : deux régressions rouges constatées (repos accepté à pleine énergie, maintien au repos après récupération de 9 à 10).
- Après correction : frontière juste avant/à 10, équivalence projection directe/par étapes, quota conservé après repos court, repos automatique cinq heures et absence longue verts.
- Intégration PostgreSQL : snapshot disponible pour une courte sieste achevée et une ancienne cohorte pleine endormie.
- `corepack pnpm test` : **90 tests verts**, 14 fichiers, processus terminé.
- `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm --filter @arbestra/api build` : verts.
- `corepack pnpm exec playwright test tests/e2e/population-rest.spec.ts tests/e2e/oracle-journal.spec.ts -g 'repos court|action réussie'` : **4 parcours verts** desktop/Pixel 7. Retour automatique de 14 à 15 disponibles sans F5, quota préservé, action réussie annulant toujours l'indice de l'Oracle.

## État et périmètre

Correctif validé, publication dans la continuité du workflow autorisé. Le handoff inclut aussi les opérations dev précédemment demandées (migration 014 et reset ciblé), sans les réexécuter. `hud.css` reste un brouillon non suivi hors commit.

Tristan confirme que son attente de quêtes Jardin/récolte était un malentendu : seules les quêtes coffre/indice étaient livrées. Aucune extension du système de quêtes dans ce correctif.
