# Handoff Sol — coffre et journal de l'Oracle

État ultérieur : l'indice a été validé par Tristan, implémenté et testé ; la tranche est clôturée. Voir le [handoff final](./HANDOFF-2026-09-07-INDICE-ORACLE.md). Les statuts ci-dessous décrivent la livraison initiale du socle.

Date / agent : 7 septembre 2026, Sol

Spec : [coffre et journal de l'Oracle](./SPEC-COFFRE-JOURNAL-ORACLE.md), **implémentée / à valider pour l'indice**

Base relue : `master`, `1da6df0`, avec consolidation documentaire préexistante non commitée

## Résultat

Reprise après revue : les réserves de preuve sont levées, voir [corrections et résultats finaux](./REVIEW-ASTRA-2026-09-07-COFFRE-JOURNAL.md). Campagne finale : 83 tests, 4 parcours Playwright, lint/typecheck/build verts ; deux mutations temporaires ont fait échouer les tests pour les défauts attendus. Commit/push désormais autorisés par Tristan. Les mentions de non-publication et les campagnes ci-dessous décrivent la livraison initiale de Sol.

L'ouverture du coffre de l'Hôtel de ville accomplit désormais `town-hall-supplies`, crédite 2 000 carottes dans la même transaction et inscrit une trace datée dans le grimoire de l'Oracle. La commande est idempotente : une répétition ou un second onglet reçoit l'état courant sans second crédit. Le HUD ouvre un journal qui reste vide sans dévoiler le coffre, puis affiche « Les anciennes réserves » après la découverte. Une célébration transitoire de l'Oracle accompagne un nouvel accomplissement observé par le client.

Migration 014 : table `village_accomplishments`, unicité `(world_id, village_id, code)`, FK vers le village et reprise conservatrice des coffres déjà réclamés à leur date d'origine. `building_hidden_supplies` reste la donnée du coffre ; toute divergence entre réclamation et accomplissement provoque une erreur au lieu de créer un crédit ambigu.

## Décisions et limites

- PostgreSQL est l'autorité des accomplissements ; le client contient uniquement leur présentation.
- Journal borné au village courant, sans moteur de quêtes, bus d'événements ni catalogue de récompenses.
- L'indice de l'Oracle en cas de blocage n'est pas implémenté : les 90 secondes de la spec restent une proposition non arbitrée. C'est la seule partie attendue de cette tranche encore ouverte.
- TRY, première récolte comme quête, coupe de bois, humeur, croissance, combat, karma et trophées génériques restent hors scope.

## Preuves

- `corepack pnpm exec vitest run apps/api/src/modules/population/population.integration.test.ts apps/world-web/src/api/client.test.ts` : 11 tests verts après implémentation.
- `corepack pnpm test` : 82 tests verts dans 13 fichiers après l'implémentation initiale. Un test d'accès étranger a ensuite été ajouté ; le fichier population a été réexécuté seul avec 8 tests verts. Ne pas additionner ces campagnes comme des tests distincts.
- Concurrence : deux transactions forcées au verrou village ; attente observée avec `pg_blocking_pids`, puis deux retours réussis, un seul accomplissement et un stock final à 2 050.
- Rollback : trigger injecté après observation simultanée de l'accomplissement, de la réclamation et du crédit ; erreur exacte vérifiée, puis carottes à 50, coffre non réclamé et journal vide.
- Migration : exécution dans un schéma isolé ; seule la réserve réclamée est reprise avec sa date, stock inchangé après rollback du montage.
- Accès : village et bâtiment étrangers refusés, sans changement du stock ou du journal ; retry post-réponse conserve un accomplissement et 2 050 carottes.
- `corepack pnpm typecheck`, `corepack pnpm lint` et `corepack pnpm build` : verts. Build des quatre packages ; avertissement Babylon habituel sur le chunk d'environ 1,16 Mo.
- `corepack pnpm exec playwright test tests/e2e/oracle-journal.spec.ts` : 2 parcours verts, Chromium desktop et Pixel 7. Le test couvre journal vide, découverte réelle par picking Babylon, célébration, 2 050 carottes, F5 et synchronisation d'un second onglet par focus.
- Contrôle dans le Chrome ouvert par Tristan, via l'extension : parcours desktop observé sur l'environnement E2E, mise en page lisible, journal vide, coffre, 2 050 carottes, accomplissement daté et persistance après F5. Aucune erreur console issue de `localhost:5274` pendant ce contrôle ; les logs conservaient des erreurs historiques de l'ancien serveur `localhost:5174`, dont le shader `line` déjà signalé.

Le premier lancement Playwright a échoué sur une attente de cinq secondes trop courte et sur l'absence d'événement de focus synthétique entre onglets en headless. Le test a été corrigé pour attendre le résultat métier et déclencher le même événement que le listener de production ; aucun correctif applicatif n'a été masqué par cette adaptation. Le lancement final est vert.

## Données et Git

Migration 014 appliquée uniquement à la base de test par les tests et l'environnement E2E. Base de développement non migrée et non réinitialisée.

Le worktree contient l'implémentation et la consolidation documentaire d'Astra. `apps/world-web/src/hud.css` reste un brouillon non suivi préexistant et n'a pas été modifié. Aucun commit/push effectué ; aucune autorisation de publication n'a été déduite du handoff.

## Suite

Tristan doit arbitrer le déclenchement de l'indice de l'Oracle. Après cet arbitrage, implémenter et vérifier uniquement cet indice, puis la tranche pourra être clôturée. La première récolte constitue la tranche produit suivante recommandée.
