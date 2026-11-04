# Handoff Sol — Habitation niveau 2

Date : 6 septembre 2026. Base Git : `master`, HEAD `4dfd494`, worktree antérieur conservé. Statut : **implémentée / validation navigateur à Tristan**, non commitée et non poussée.

## Résultat

L'Habitation peut être améliorée au niveau 2 depuis son menu existant. L'amélioration coûte 300 bois, dure 120 secondes, conserve la même cellule et offre 25 couchages après achèvement. Pendant le chantier, l'Habitation ne contribue temporairement plus au logement, conformément au calcul existant limité aux bâtiments terminés : une Habitation isolée fait donc évoluer la capacité totale `35 → 30 → 55` autour du chantier.

Babylon reconstruit déjà le bâtiment lorsque son niveau change. Le corps de l'Habitation passe du bois clair au bois plus sombre au niveau 2 ; aucun nouvel asset ni mesh persistant n'est introduit.

## Changements

- Migration additive `013_dwelling_level_two.ts`, enregistrée dans le migrateur : catalogue niveau 2, durée 120 s, variante `dwelling-2`, coût 300 bois.
- Snapshot : la capacité d'une Habitation terminée dépend maintenant de son niveau, 5 puis 25.
- Scène : matériau du corps sélectionné selon le niveau.
- Architecture du catalogue mise à jour.
- Régression PostgreSQL ajoutée au test économique.

## Preuves

- Régression ciblée : verte. Vérifie capacité 35 avant, débit exact de 300, capacité 30 et niveau cible pendant le chantier, puis capacité 55 et niveau 2 après échéance.
- `corepack pnpm test` : **78 tests verts, 12 fichiers**, processus terminé avec code 0.
- `corepack pnpm lint` : vert.
- `corepack pnpm build` : vert sur contracts, API, lobby et world-web ; avertissement habituel sur la taille du chunk Babylon.
- Typechecks API et world-web : verts.
- Migration 013 appliquée à la base de développement avec `Success`, sans reset ni seed.
- Validation navigateur volontairement laissée à Tristan selon sa demande explicite.

## Git

Aucun commit/push. Le worktree contient toujours les tranches population, pierre, interactions React et documents préexistants ; ne pas attribuer tout le diff à cette seule tranche.
