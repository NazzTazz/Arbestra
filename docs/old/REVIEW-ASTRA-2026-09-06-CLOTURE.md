# Revue de clôture — population, pierre et interactions joueur

6 septembre 2026, Astra. Base : `master`, `4dfd494`. Publication demandée explicitement par Tristan.

## Périmètre relu

La livraison React de Sol dépend des tranches population et pierre encore non commitées. La publication les regroupe : migrations 010–013, contrats, économie et worker, génération des gisements, rendu Babylon, interactions React et documentation associée. Les travaux préexistants sont conservés. Le brouillon inutilisé `apps/world-web/src/hud.css` reste hors commit.

Lecture des changements de snapshot, commandes, réconciliation chronologique, affectation commune, énergie, migrations, scène et UI. Les preuves de concurrence/rollback de la finition pierre sont documentées dans son handoff ; la suite correspondante a été réexécutée à cette reprise.

## Réserves corrigées

- Coffre déjà réclamé dans un autre onglet : l'appel de rafraîchissement était ignoré car une action restait en vol. Le client relit maintenant explicitement le snapshot après ce refus, sans répéter le crédit. Une régression mock HTTP vérifie le POST refusé suivi du GET et le résultat actualisé.
- Le rafraîchissement du détail pierre réinitialisait l'effectif toutes les deux secondes. Il conserve maintenant le choix du joueur ; l'ouverture d'un autre gisement initialise séparément son choix.
- Une intention d'extraction non résolue pouvait être réutilisée en cliquant un autre gisement. Les intentions sont désormais conservées par cible ; un retry garde son effectif et son UUID, sans détourner une autre commande. Une régression couvre deux cibles, le retry et le renouvellement après succès. Un refus HTTP 4xx libère le choix pour une nouvelle tentative ; une erreur réseau ou serveur conserve l'intention.
- Une réponse d'extraction tardive ne remplace plus le détail d'un autre panneau ouvert entre-temps.
- L'index d'architecture annonçait encore population et menu pierre comme non implémentés ; il reflète maintenant la livraison.

## Preuves et limites

- `corepack pnpm test` : 78 tests verts dans 12 fichiers, code 0, avant les seules corrections client de cette revue. Base ciblée vérifiée : `arbestra_test`, PostgreSQL local port 5432. Aucune base de développement modifiée.
- Après corrections : `corepack pnpm exec vitest run apps/world-web/src/api/client.test.ts apps/world-web/src/ui/extraction-intents.test.ts` : 5 tests verts, code 0, dont deux nouvelles régressions. Les trois tests client préexistants sont inclus dans ces cinq ; ne pas additionner les deux campagnes comme des tests distincts.
- Après corrections : `corepack pnpm lint` et `corepack pnpm build` verts, processus terminés avec code 0. Build des quatre packages, vérification TypeScript incluse ; seul avertissement de taille du chunk Babylon (~1,16 Mo).
- Tristan a confirmé dans cette session la validation **humaine** du fonctionnement complet avec Sol. Il ne parlait pas d'une réparation de Playwright.
- `tests/e2e/vertical.spec.ts` décrit toujours l'ancienne interface ; la suite Playwright n'a pas été exécutée et n'est pas une preuve actuelle. Les corrections client de cette revue restent à recontrôler manuellement conformément à la répartition navigateur de la session.

## Suites connues

Les réveils lisibles et les quêtes restent des propositions de design, non implémentées. Les figurants de récolte Babylon ne représentent encore que le premier Jardin actif, même si les récoltes métier simultanées fonctionnent. Le signalement antérieur du shader `line` Vite n'a pas été reproduit ni validé à cette reprise. Aucune de ces limites n'est présentée comme corrigée.

Statut : revue technique terminée, publication autorisée ; contrôle visuel des corrections de revue restant à Tristan. Les notes de livraison antérieures conservent leurs preuves historiques et leurs anciens statuts Git ; la tête de `SESSION-HANDOFF.md` prévaut pour cette publication.
