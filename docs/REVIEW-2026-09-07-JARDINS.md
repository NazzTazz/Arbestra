# Recette Jardins — 7 septembre 2026

Base : `master`, `b148f37`, livraison non commitée de Sol. Verdict : **à corriger / à valider**. Aucun changement de gameplay demandé ; les défauts portent sur la spec validée.

## Régressions reproduites

### R1 — Migration : perte de production due près de la saturation (priorité haute)

`apps/api/src/database/migrations/015_garden_plots.ts:26` répartit le stock brut avec l'ancien curseur, sans matérialiser la production due à une borne commune. Chaque parcelle applique ensuite son plafond séparément.

Reproduction SQL avec la vraie migration dans un schéma transactionnel isolé : deux parcelles, ancien stock 1199, reliquat 0, quinze secondes de production. L'ancien buffer représente 1199,5 carottes. La reprise produit deux stocks 600/599 ; la projection par parcelle donne 600 + 599,25 = **1199,25**. Une fraction de 0,25 est perdue. Le test compare le résultat avant rollback et échoue sur cette valeur précise. Il vérifie le calcul de projection SQL, pas un parcours HTTP migré.

Corriger la bascule à une borne commune en respectant les échéances des extensions et la saturation avant répartition. Compléter les preuves avec production due, chantiers échus et trajets historiques. L'ancien buffer continue aussi d'être matérialisé dans `reconcile-economy.ts` : la documentation qui le qualifie d'archive passive est inexacte.

### R2 — Balayage : parcelles traversées sautées (priorité haute)

`apps/world-web/src/scene/construction-selection.ts:16` échantillonne le segment avec arrondi au lieu de parcourir toutes ses cellules. De `(4,4)` à `(7,6)`, les cellules `(5,4)` et `(6,6)` sont traversées mais absentes. La régression appelle la fonction réellement utilisée par Babylon et échoue : trois cellules retournées au lieu de cinq après la cellule initiale.

Parcourir les intersections du segment dans l'ordre. Vérifier ensuite souris/tactile, passage rapide, coutures du tore et retour sur ses pas. Le relâchement du pointeur ne traite pas non plus le dernier segment (`BabylonVillageScene.ts:151`) ; à couvrir lors de cette correction.

### R3 — Extension : chantier initial accepté comme existant (priorité moyenne)

`apps/api/src/modules/villages/service.ts:994` ne charge pas le statut du bâtiment dans la classification des collisions. Un Jardin en construction initiale a `pendingExpansionId = null` et passe donc pour un existant toléré.

Reproduction via les vrais services : créer un Jardin achevé, un Jardin adjacent avec dix minutes de chantier, puis étendre le premier avec un rectangle recouvrant les deux. Le serveur **accepte** au lieu de retourner `CELL_OCCUPIED`. Le client classe pourtant ce chantier comme réservé. Vérifier explicitement l'achèvement côté serveur et conserver le rejet atomique du rectangle.

Les trois régressions sont conservées, volontairement rouges, dans `apps/api/src/modules/villages/garden-review.integration.test.ts` et `apps/world-web/src/scene/garden-review.test.ts`. Exécution ciblée terminée : **3 échecs attendus**, chacun sur le résultat métier visé. La première version de la fixture migration avait trois cellules au lieu de deux ; elle a été corrigée puis réexécutée avant de retenir R1.

## Écarts supplémentaires établis par lecture, sans reproduction navigateur

- **Réponse perdue / fusion** — `App.tsx:160` conserve l'intention sous une clé contenant l'ID canonique du Jardin. Une fusion peut changer cette clé. De plus, le contrôle `plot.harvest` précède la recherche de l'intention : après un rafraîchissement montrant le départ accepté, le retry est ignoré. Aucun retry automatique ne prend le relais. Conserver l'intention par village/coordonnée stable et permettre sa résolution jusqu'à réponse certaine ; tester une réponse perdue suivie d'une fusion.
- **Accès aux détails de tous les Jardins** — `App.tsx:236` ouvre uniquement `firstGardenSite`. Le clic principal sur une parcelle récoltable est consommé pour la récolte dans Babylon. Le bouton ne fournit donc pas un accès explicite aux autres Jardins lorsque leurs parcelles sont récoltables. Prévoir un choix de Jardin ou un accès secondaire vérifié, notamment pour Étendre.
- Les requêtes en attente ne sont pas exposées visuellement comme telles. Le parcours livré ne démontre ni le glissé tactile, ni les limites d'effectif, ni la fusion/extension dans le navigateur. Les tests de concurrence historiques ne suffisent pas à établir tous les nouveaux entrelacements ; les comparaisons de rollback doivent aussi inclure `garden_plots`.

## Vérifications et périmètre

- Cible DB vérifiée sans secret : `127.0.0.1:5432/arbestra_test`. Suites DB exécutées successivement.
- Suite livrée avant ajout des régressions : **95 tests verts / 14 fichiers**, processus terminé avec code 0. Cela ne valide pas les cas absents révélés ci-dessus.
- Parcours Playwright terminé : **2 tests verts**, Chromium desktop et profil Pixel 7 ; builds contrats/API réussis. Récolte au clavier d'une seule parcelle, voisine intacte et un seul habitant affecté. Six captures inspectées : monde, panneau Jardin et population sur chaque profil. Le marqueur plein apparaît et disparaît après départ ; panneaux lisibles. Ce parcours ne simule pas de glissé tactile.
- Finition visuelle à reprendre : bouton `Gérer les Jardins` au style natif, distinct des contrôles du jeu ; sur mobile il se superpose au cadre inférieur Construire. Le nom du village et le bois se chevauchent aussi dans le HUD mobile (origine antérieure ou nouvelle non établie). Captures : [monde mobile](../test-results/garden-plots-chaque-parcel-d46fb-avier-sans-vider-sa-voisine-mobile-chromium/garden-world.png), [panneau desktop](../test-results/garden-plots-chaque-parcel-d46fb-avier-sans-vider-sa-voisine-chromium/garden-panel.png). Artefacts locaux ignorés par Git, susceptibles d'être remplacés par une prochaine exécution.
- `agent-browser` échoue au lancement (`CDP response channel closed`) ; diagnostic local : répertoire utilisateur indéterminable. Repli Playwright.
- Recette seulement : aucun correctif applicatif, aucune migration dev, aucun reset joueur, aucun commit/push. Les modifications préexistantes sont conservées, dont `hud.css`.
