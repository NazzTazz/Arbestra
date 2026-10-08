# Corrections World generator A/B — 8 octobre 2026

Statut : corrections implémentées. Recette technique et navigateur décrite ci-dessous ; appréciation finale de la géographie à Tristan. C/D/E restent hors de cette livraison et les candidats v3 restent fermés.

## Résultat

La recette v3 **r2** remplace les blocs 8×8 par une mosaïque périodique de régions de Voronoï irrégulières (espacement nominal 18 cases), avec plusieurs échelles de relief et des contours à la case. L'altitude reste entière, entre −8 et +8 ; une unité vaut ¼ de case. Aucun terrain en pente n'est introduit.

Les accès sont choisis dans le graphe des régions. Les escaliers de 2×4 cases franchissent une unité, en huit marches larges et peu profondes ; leurs paliers sont plats et protégés. Lorsque la place manque, la connexion retenue reste à niveau. Des passages secondaires raccourcissent certains détours. Les autres frontières peuvent rester des falaises. Les arbres sont placés en préservant les connexions des cases sèches.

Le compteur d'isolement s'évalue désormais **par terre**. Une terre entièrement inaccessible est signalée séparément. Le panneau montre aussi le nombre/taille des plateaux, les contours hors grille8, et des diagnostics **échantillonnés** de détours et d'escaliers sans alternative.

## Avant / après

Même seed42, eau25 %, amplitude8, moyenne1, arbres30 %, influence solaire50. Comptage des plateaux par composantes connexes de même altitude.

| Monde | Ancienne recette | Recette r2 |
| --- | ---: | ---: |
| 256×128 : plateaux | 13 | 33 |
| 256×128 : plus grand plateau | 15 360 cases | 3 956 cases |
| 512×256 : plateaux | 6 | 188 |
| 512×256 : plus grand plateau | 62 336 cases | 3 179 cases |
| 512×256 : ruptures hors grille8 | 0 % | 88,18 % |
| 256×128 : couverture boisée obtenue | 25,04 % | 30,00 % |

Les neuf combinaisons des seeds1/2/42 et tailles64², 256×128, 512×256 ont zéro zone isolée, zéro terre sans accès et zéro détour inaccessible dans l'échantillon. La couverture boisée obtenue est entre29,98 et30,01 %. Les proportions d'eau sont calculées en aire au sol du tore.

## Aperçu et fidélité

Le tore affiche désormais les cases canoniques (pas1), y compris les petites ruptures. La couche altitude emploie une palette fixe −8/−4/0/+1/+4/+8 et sa légende ; la surface d'eau ne masque plus le fond. Les couches de diagnostic sont sans variation d'éclairage. Le cadrage est conservé lors des changements de couche et de phase ; l'inspection locale adapte sa cible à la hauteur du terrain. Des boutons +/− donnent accès au zoom fin.

La migration additive036 inscrit la révision de recette des candidats. Les nouveaux v3 utilisent r2 ; les anciens sont identifiés comme historiques non versionnés (r0), **sans réécriture de leurs artefacts**. Cette étiquette ne garantit pas la régénération de toutes les anciennes variantes sous un même numéro v3. Migration test puis développement effectuée ; huit artefacts/checksums utilisateur comparés avant/après et inchangés.

Les nouveaux artefacts v2 portent aussi une signature de recette complète : terrain, features, occupations, stocks/réservations, horloges de repousse et modèle de village. Copie sous snapshot repeatable-read, vérification source/cible et contrôle avant ouverture. Les anciens artefacts restent lisibles par le chemin de compatibilité sans prétendre disposer d'une signature historique complète.

## Preuves et reproduction

- Régression rouge préalable : faux zéro d'isolement et géographie sur grille8.
- 15 tests paysage, 2 tests de profil de marches, 6 intégrations API, 1 test d'implantation du modèle réel de départ sur un plateau naturellement plat.
- Builds contracts/API/world-web et lint ciblé ; résultats finaux consignés dans les logs landscape-final-*.
- Scripts navigateur : tests/browser/landscape-repair.mjs et tests/browser/landscape-close.mjs. Fixtures propres sur arbestra_test, services dédiés ; aucun candidat utilisateur créé ou supprimé.
- Vrai build production, Chromium/WebGL2, ANGLE Intel Iris Plus (0x8A52), Direct3D11. Viewport1440×1000, canvas1080×560. Pose globale alpha−π/2, beta1,05, rayon8, phase0, amplification1, sans fumée, chargement stabilisé.
- Neuf rendus générés, dont un par le bouton réel ; baseline de l'ancienne recette avec **le même nouveau renderer**, pour isoler le changement de géographie. Rotation réelle puis retour de couche : PNG avant/après identiques. Couches, fumée, soleil/ombres et trois allers-retours global/local : zéro erreur navigateur.
- Captures et JSON ignorés sous test-results : repair-baseline-altitude.png, repair-42-256-altitude.png, repair-42-512-altitude.png, repair-altitude-x4.png, repair-camera-{before,after}.png, landscape-repair-browser.json.

## Coût observé

Les mesures JavaScript Babylon ne sont ni un temps GPU ni le temps complet entre deux images. Le compteur géométrique est celui des triangles soumis aux passes, pas la mémoire résidente.

| Pose | FPS | JS médiane/p95 | Draws | Triangles soumis |
| --- | ---: | ---: | ---: | ---: |
| Baseline seed42/256, altitude | 60 | 0,50/0,80 ms | 1 | 69 824 |
| r2 seed42/256, altitude | 60 | 0,40/0,70 ms | 1 | 72 624 |
| r2 seed42/512, altitude | 59 | 0,30/0,70 ms | 1 | 291 654 |
| Inspection locale | 60 | 0,70/1,20 ms | 3 | 33 128 |
| Global avec fumée | 60 | 4,00/5,90 ms | 6 | 161 938 |
| Global avec soleil/ombres | 60 | 4,30/9,80 ms | 8 | 525 058 |

Retour après cycles : deux meshes actifs, zéro texture, deux draws sans effets ; absence d'accumulation visible dans ces compteurs, **pas de preuve exhaustive sur la mémoire GPU**. La finesse augmente la géométrie par rapport à l'ancien renderer sous-échantillonné ; aucun gain GPU n'est revendiqué.

## Limites

Les détours échantillonnés atteignent213 cases (seed1/256). La continuité est vérifiée, mais aucun maximum global de détour n'est garanti ; des escaliers restent des passages uniques, surtout dans les petits mondes. Le panneau expose ces résultats. Fixer une borne de trajet universelle demanderait un arbitrage produit.

Les surfaces des régions quantifient la part d'eau, particulièrement à64². Certaines combinaisons extrêmes ne réalisent pas l'amplitude demandée (exemple amplitude16/arbres80 :14 obtenue) et produisent un avertissement. Les paramètres réalisés font foi.

Hydrologie, canaux navigables, cascades, marées et aménagement au spawn restent les tranches suivantes. Ce travail ne branche pas le graphe v3 sur les trajets économiques v2 et n'ouvre aucun univers.

## Fichiers et statut

Implémentés et vérifiés :
- packages/contracts/src/world-landscape{,-recipe,-quality}.ts et world-generator.ts : recette, graphe, métriques et métadonnées.
- apps/api/src/database/migrations/036_world_generator_recipe.ts et modules/world-generator/{service,generate-child,artifact,recipe-provenance,recipe-copy}.ts : version, persistance et intégrité.
- apps/world-web/src/world-generator/{PreviewScene,WorldGenerator}.tsx, altitude-color.ts et world-generator.css : rendu, inspection et diagnostics.
- Tests purs/API, starter-landscape.test.ts et scripts navigateur landscape-{repair,close}.mjs.

Recette rapprochée : quatre poses X/Y montantes/descendantes, rayon passé de23 à7,28 par quatre clics sur +. Changement d'image vérifié, puis conservation exacte du cadrage après aller-retour terrain/altitude. [Marches vues de face](../test-results/repair-close-1-up.png). Aucun trou observé aux raccords des poses inspectées ; les contremarches deviennent peu visibles lorsqu'on les regarde depuis l'amont. La molette automatisée n'a pas modifié l'image ; sa validation reste distincte de celle des boutons, réussie. Aucun succès de molette n'est revendiqué.

Les dix candidats et le compte QA ont été supprimés, leurs services arrêtés ; les services du jeu et les données utilisateur sont conservés. Le dernier test v2 de copie/ouverture a été rejoué après ce nettoyage : 1 passé, 5 non sélectionnés, sans worker QA concurrent. Builds contracts/API/world-web terminés avec succès ; lint ciblé passé et git diff --check sans erreur.

## Reprise

Recharger /world-generator puis **Générer l'aperçu** : les candidats historiques restent visuellement historiques. Consulter Couche → Altitude, amplification1 puis4, et Inspection locale.

Branche main, tête f9fc28d. Worktree antérieur préservé ; modifications non commitées, aucun commit/push.
