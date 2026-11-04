# Handoff Sol — interactions joueur React

Date : 6 septembre 2026. Base Git : `master`, HEAD `4dfd494`, worktree antérieur population/pierre/UI conservé. Statut : **implémentée / à valider sur les parcours métier complets**, non commitée et non poussée.

## Correctif clic HUD signalé par Tristan

Le HUD actif avait `pointer-events: none` sur `.top-bar` : les clics traversaient la barre vers le canvas Babylon et le bouton Habitants ne pouvait pas recevoir son clic. `.top-bar` reçoit maintenant les événements ; `.notification-stack` reste transparente afin de ne pas masquer les contrôles voisins. Correctif CSS borné dans `apps/world-web/src/styles.css`, **à revalider dans le navigateur par Tristan conformément à la répartition explicite de cette session**.

Le sommeil automatique a ensuite révélé que le front ne rafraîchissait pas le snapshot lorsque le repos était la seule transition temporelle. Les habitants pouvaient être réveillés côté serveur tout en restant affichés indéfiniment au repos. Tant qu'au moins un habitant est affiché au repos, `App.tsx` rafraîchit désormais le snapshot toutes les dix secondes ; le polling s'arrête lorsque le dernier groupe redevient disponible.

## Résultat

Sol a repris exceptionnellement les interactions joueur à la demande de Tristan. `App.tsx` compose désormais des frontières React dédiées : HUD, panneau construire et panneaux population/bâtiment/gisement. Le HUD expose bois, carottes, pierre, population/couchages et habitants disponibles.

Le joueur peut ouvrir la population, choisir un effectif, nourrir ou envoyer au repos. L'Hôtel de ville expose le coffre tant qu'il est disponible. Le snapshot porte maintenant `building.hiddenSuppliesAvailable`, ce qui reconstruit correctement cet état après F5 ; un 409 concurrent relit le snapshot sans erreur agressive.

Le Jardin présente les carottes en transit, les récolteurs, le compte à rebours et désactive une nouvelle récolte pendant le travail. Les travaux déclenchent le polling même sans chantier. Le message de départ n'annonce plus un crédit immédiat. Si les parcelles dépassent les habitants disponibles, le besoin est affiché et l'action désactivée. Construction/extension avertissent aussi lorsque la future surface excède l'effectif total ; la règle serveur demeure ouverte au gameplay.

Le menu pierre charge le détail serveur, affiche les quantités, le lot, les options d'effectif/durée et lance une extraction avec une intention stable. Les lectures de gisement obsolètes sont ignorées. Le polling couvre les extractions actives et la sélection d'un gisement. Les réponses générales plus anciennes qu'un snapshot déjà appliqué sont rejetées.

Les UUID de récolte, population et extraction sont conservés pour un retry de la même intention. Côté serveur, réutiliser un `commandId` de récolte avec un autre Jardin produit désormais `COMMAND_ID_CONFLICT`.

## Fichiers de cette reprise

- `apps/world-web/src/App.tsx`
- `apps/world-web/src/ui/Hud.tsx`
- `apps/world-web/src/ui/ConstructionPanel.tsx`
- `apps/world-web/src/ui/PlayerPanels.tsx`
- `apps/world-web/src/api/client.ts`
- `apps/world-web/src/styles.css`
- `packages/contracts/src/villages.ts`
- `apps/api/src/modules/villages/service.ts`
- `apps/api/src/modules/population/garden-harvest.ts`
- `apps/api/src/modules/population/population.integration.test.ts`

Le fichier non suivi `apps/world-web/src/hud.css` préexistait et reste préservé ; le HUD actif utilise `styles.css`.

## Preuves

- `corepack pnpm test` : **77 tests verts, 12 fichiers**, processus terminé avec code 0. Inclut la régression du conflit d'intention entre deux Jardins et l'état du coffre avant/après découverte.
- `corepack pnpm lint` : vert.
- `corepack pnpm build` : vert pour contracts, API, lobby et world-web ; avertissement Babylon habituel sur le chunk de scène.
- Typecheck ciblé final API et world-web : vert.
- `git diff --check` ciblé : vert, avertissements CRLF seulement.
- Navigateur Chrome sur les serveurs locaux préexistants : monde chargé, HUD complet visible, panneau Habitants visible, panneau Construire visible, Jardin visible. Le contrôle a révélé puis fait corriger le bouton Récolter actif avec 0 disponible : il affiche maintenant `133 habitants nécessaires · 0 disponibles` et reste désactivé.
- Tristan a expliqué que les `800 / 185` habitants observés proviennent d'ajouts manuels dans sa base de développement. Cette incohérence de fixture n'est ni attribuée au code ni corrigée.

## Limites restantes

Le parcours navigateur n'a pas muté la base de développement : repas/repos/coffre/récolte/extraction n'ont pas été déclenchés sur les données de Tristan. Le menu pierre n'a pas été sélectionné visuellement durant ce passage. Ces parcours restent **à valider** sur une fixture de test adaptée.

La console Babylon signale sur le serveur Vite préexistant une compilation du shader `line` recevant la page HTML en fragment shader. La scène reste rendue et interactive ; ce problème n'a pas été causé ni corrigé par la tranche React. Le démarrage d'un second `pnpm dev` a été refusé car 5173/5174 étaient déjà occupés ; aucun processus existant n'a été arrêté.

`tests/e2e/vertical.spec.ts` décrit encore l'ancien parcours de construction/Jardin et n'a pas été adapté ici. La suite Playwright n'est donc pas une preuve actuelle de cette UI.

La représentation Babylon des récoltes simultanées reste limitée au premier Jardin (`gardens[0]`). La tranche interaction React ne l'a pas refondue.

## Git et suite

Aucun commit/push. Les nombreuses modifications population, pierre, monde et documents étaient déjà mêlées dans le worktree ; examiner l'ensemble avant toute publication. Prochaine action conseillée : fixture e2e fraîche couvrant population/coffre/récolte/pierre, puis correction du shader Vite et des récoltes Babylon simultanées si elles font partie de l'acceptation.
