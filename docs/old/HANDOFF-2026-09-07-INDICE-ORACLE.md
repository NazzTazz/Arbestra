# Indice de l'Oracle — clôture

7 septembre 2026. Base : `master`, `38b801a`. Tristan a validé le déclencheur proposé ; poursuite de la tranche et de sa publication autorisée.

## Résultat et décision

Après 90 secondes visibles dans le village, si le coffre reste fermé et qu'aucune action de gameplay n'a réussi, l'Oracle affiche le texte validé sans ouvrir de panneau. La navigation et l'inspection ne coupent pas le délai. Les intervalles cachés sont exclus ; une commande en cours diffère l'affichage jusqu'à son résultat. Un refus laisse l'aide possible. Une réussite (construction/amélioration/extension, récolte, repas/repos, extraction ou fouille) annule l'indice pour cette session.

`useOracleHint` utilise un minuteur borné et le système de notifications existant. `sessionStorage`, indexé par monde/village, conserve le temps et l'annulation après F5. Session signifie ici session de l'onglet. En cas de stockage indisponible, repli en mémoire pour la page courante. Aucun changement PostgreSQL, contrat API ou autorité économique.

Statut : **clôturée** pour coffre/journal/indice. Le délai reste un réglage de POC à ajuster en jouant.

## Vérifications terminées

- `corepack pnpm exec vitest run apps/world-web/src/ui/oracle-hint.test.ts apps/world-web/src/api/client.test.ts` : 9 tests verts, dont 5 nouveaux (frontière exacte 90 secondes, visibilité, découverte, commande en cours/résultat, reprise de session).
- Typecheck global et lint global verts ; ESLint ciblé final vert après ajustement des tests navigateur.
- `corepack pnpm --filter @arbestra/world-web build` : vert, avertissement de taille Babylon inchangé.
- `corepack pnpm exec playwright test tests/e2e/oracle-journal.spec.ts -g 'indice|action réussie'` : 4/4 verts, desktop et Pixel 7. Affichage, inspection sans annulation, non-répétition après F5, annulation après repos réussi et F5.
- Les deux parcours existants coffre/grimoire et ancien accomplissement/clavier ont aussi passé sur desktop avec ce code pendant le lancement initial. La campagne complète 83 tests et les 4 parcours du socle dans `38b801a` restent des preuves antérieures, pas une nouvelle suite complète pour cette modification front.

Le montage navigateur a été corrigé après des échecs : `runFor` rejouait toutes les images Babylon et dépassait le délai ; pause basée sur l'heure du runner refusée comme passée ; pause avant navigation empêchant la résolution du chargement React. La version finale installe une origine fixe, laisse charger le village, lit l'heure du navigateur pour la pause puis utilise `fastForward`. Le seuil exact et la pause cachée sont vérifiés par les tests du minuteur. Aucun correctif applicatif n'a été substitué à ces ajustements de test.

## Git et suite

Ce handoff accompagne le commit de l'indice sur `master` et sa publication demandée. Aucun changement à la base de développement ; tests navigateur sur `arbestra_test`. Le brouillon préexistant `apps/world-web/src/hud.css` reste non suivi et exclu. Première récolte comme accomplissement : prochaine tranche recommandée, non implémentée ici.
