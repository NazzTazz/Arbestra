# Livraison Git de la session — 30 septembre 2026

Tristan a demandé le commit et le push du travail réalisé : finition des Jardins, chemins et transport à 1 seconde par case, figurants low-poly, textures et côte, grille constructible, caméra, inspection pierre et eau animée avec correction des shaders. Les preuves et limites de validation restent détaillées dans les entrées ci-dessous ; aucune nouvelle campagne applicative n'est revendiquée pour le packaging Git. L'étude du streaming n'a entraîné aucune implémentation. Sources, tests, migrations, assets et documentation sont inclus ; l'export brut `codex-session-01a07944-0d99-7ab3-9983-b16b69419275.md` reste local. Branche de livraison : `main`, distant `origin` ; résultat du commit/push à vérifier après exécution.

# Régression écran bleu après animation de l'eau — 30 septembre 2026

Retour de recette de Tristan : seul le fond bleu restait visible, avec les chemins lorsqu'ils étaient activés. Défaut reproduit dans l'onglet Chrome réel sur `localhost:5174/?world=aube` : les `StandardMaterial` tentaient de charger les shaders Babylon `default` sous forme de fichiers `.fx`, et Vite répondait avec `index.html`, ce qui faisait échouer leur compilation. Les imports explicites de `default.vertex` et `default.fragment` rejoignent ceux des shaders `color` dans le graphe de la scène. Après rechargement propre dans le même Chrome, terrain texturé, eau et rides, rive, bâtiments, Jardins et végétation sont visibles ; aucune nouvelle erreur console Babylon n'est apparue. Le cadrage a été laissé sur la rive pour la recette.

Validation finale : build `@arbestra/world-web` et lint monorepo terminés avec code 0. Le parcours Chromium ciblé de la grille passe (**1 test**, 35,3 s) et surveille désormais aussi les requêtes `default.vertex.fx` / `default.fragment.fx`. Une première tentative n'a pas démarré car PostgreSQL test sur `55432` était arrêté ; le même parcours a ensuite été exécuté sur la base locale `arbestra_test` au port `5432`, sans toucher à la base de développement. Serveur dev conservé, worktree non commité sur `main`.

# Eau légèrement animée — 30 septembre 2026

Tristan a autorisé une animation discrète de l'eau. Le rendu Babylon ajoute un seul mesh transparent aux cases d'eau de la région et une petite texture de rides générée localement. Les UV de ce mesh dérivent lentement ; ni les sommets, ni les côtes, ni les données serveur ne bougent. Vérification Chromium sur deux captures fixes espacées de 2,5 s : 3 573/13 000 échantillons changent dans la zone d'eau, 0/37 500 sur le terrain témoin. Rides et rive inspectées dans la capture `test-results/water-probe.png`. Typecheck et build world-web, lint monorepo terminés avec succès ; worktree non commité sur `main`.

# Sentiers aux contours irréguliers — 30 septembre 2026

À la demande de Tristan, le mode « Chemins · debug » remplace les traits cyan suspendus par des bandes de terre étroites aux deux bords irréguliers. Échantillonnage et variation déterministes par coordonnées ; chaque tronçon partagé est rendu une seule fois, uniquement dans la région chargée. Les bandes suivent l'élévation et restent sous les bâtiments et Jardins. Le calcul des itinéraires, les cellules suivies par les figurants et le temps de transport ne changent pas. Première inspection dans le Chrome réel : le matériau sortait noir sans émissif ; corrigé. Deuxième inspection : bandes brunes lisibles au-dessus de l'herbe, sans masquer les parcelles. Mode debug laissé ouvert pour recette. Typecheck et build world-web, lint monorepo terminés avec succès. Travail non commité sur `main`.

# Figurants low-poly et hauteur — 30 septembre 2026

Tristan jugeait Dude trop détaillé face aux volumes du jeu, puis signalait un flottement sinusoïdal et des pieds coupés. Le personnage importé est remplacé par une silhouette Babylon de huit volumes simples, matériaux plats partagés et marche par rotation des bras/jambes. Le modèle et les textures Dude inutilisés sont retirés. Le balancement vertical ajouté aux récoltants est supprimé ; le figurant est légèrement surélevé pour dégager les pieds, y compris sur les Jardins. Les routes et temps serveur restent inchangés.

Typecheck world-web, build world-web et lint monorepo terminés avec succès. Inspection de la scène dans le Chrome réel de Tristan : silhouette low-poly visible près du gisement, jambes dégagées. Le parcours E2E automatisé a été perturbé avant le rendu par un interblocage de remise à zéro de la base `_test` entre le worker et le reset ; il n'est pas compté vert pour cette modification. Worktree non commité sur `main`.

# Recette figurants, caméra et gisements — 30 septembre 2026

Retour de Tristan : pieds des figurants coupés par le sol, angle de caméra trop élevé au zoom rapproché, inspection du gisement qui ne débouche plus sur l'extraction. Le Dude est remonté de 0,12 unité de rendu. La limite de beta de la caméra croît progressivement de 0,95 à 1,35 entre les rayons 42 et 8, en conservant le réglage manuel pendant le zoom. La fiche pierre ne relance plus son chargement à chaque snapshot (rafraîchi toutes les 2 s) : une réponse lente n'est plus invalidée en boucle ; après une commande, la fiche est rafraîchie explicitement. Aucune règle économique ni durée de transport modifiée.

Preuves : parcours Chromium à inspection retardée de 3 s, bouton disponible et POST d'extraction réussi ; parcours Chromium de zoom rapproché et limite beta > 1,2 ; captures `test-results/camera-angle.png` inspectée. Typecheck, build et lint world-web/monorepo terminés avec succès. Le test pierre nettoie sa feature artificielle de la base `_test`. Serveur dev vérifié HTTP 200 sur 5173, 5174 et `/api/health` port 3000. La hauteur exacte des pieds reste à apprécier pendant la recette humaine. Travail non commité sur `main` ; modifications préexistantes conservées.

# Ajustement des figurants Dude — 30 septembre 2026

Retour de recette de Tristan : ils marchaient à reculons et étaient trop grands. Rotation de la direction de marche de 180°, échelle ramenée de `0,022` à `0,0066` (×0,3), animation du squelette accélérée de ×2,5. Aucun changement du temps de transport serveur : toujours 1 seconde par case. Typecheck world-web et parcours Chromium de chargement d'un figurant/réseau terminés avec succès après réglage. Modifications non commitées.

# Figurants Babylon « Dude » — 30 septembre 2026

Tristan a confirmé le modèle animé officiel « Dude » pour remplacer les boîtes figurant les habitants. Asset `.babylon` et quatre textures locales sous `apps/world-web/public/models/dude/`, avec attribution CC BY 4.0 ; aucun chargement réseau tiers au runtime ni nouvelle dépendance. Babylon charge une fois le modèle dans un `AssetContainer`, instancie le maillage et son squelette par habitant au Jardin et à la pierre, lance la marche pendant le déplacement, l'arrête sur place, puis détruit l'instance à la fin de la mission. Les boîtes restent un repli si l'asset ne charge pas. Échelle du modèle ajustée à 0,022 après inspection visuelle : silhouette reconnaissable sur la parcelle. Typecheck, build et lint world-web, parcours Chromium desktop et mobile de récolte réelle verts ; capture desktop inspectée `test-results/dude-figure.png`. Une scène React détruite pouvait signaler tardivement un échec de chargement et écraser l'état de la scène active sur mobile ; garde `#disposed` ajoutée et parcours mobile repassé. Recette humaine à faire. Le serveur dev s'était arrêté ; relancé avec `corepack pnpm dev`, ports 5173/5174/3000 contrôlés HTTP 200. Aucun commit/push.

# Chemins et déplacements — 30 septembre 2026

Tristan a autorisé l'implémentation des lignes d'envie. Décisions confirmées : itinéraires en tronçons X/Y, détours permis, durée du transport ajoutée à celle du travail, vitesse provisoire **1 seconde par case**, visibilité débogage sur la carte. `buildTravelNetwork` construit des routes cardinales sur le tore, contourne les occupations et favorise les tronçons partagés. Le serveur expose les routes et fige le chemin, `transport_ms` et l'échéance sur chaque nouvelle récolte de parcelle ou extraction de pierre ; migration additive 016. Les missions historiques conservent leur échéance. Un gisement hors de la fenêtre 64×64 utilise un corridor de chunks/occupations jusqu'à 128 cases ; au-delà, chemin torique X puis Y direct pour préserver la portée mondiale, sans contournement du terrain (limite connue). Les figurants suivent leur chemin à l'aller et au retour ; le panneau « Chemins · debug » affiche toutes les routes ou une destination choisie.

Validation à cette reprise : builds contrats/API/world-web, typecheck monorepo, lint, test unitaire de détour, test ciblé Jardin et pierre, suite Jardin, tests de non-régression des gisements hors viewport/protégés, et parcours navigateur Chromium desktop et mobile du bouton/maillage verts. Capture mobile inspectée dans `test-results/travel-paths.png` : lignes cyan et panneau lisibles au-dessus du terrain. La migration 016 a réussi sur les bases test et développement, sans reset développement. `agent-browser` a échoué au lancement (`CDP response channel closed`), donc contrôle navigateur avec Playwright du dépôt. La suite complète pierre a présenté un timeout sur le cas du gisement torique très éloigné avant l'optimisation de la distance ; ce cas ciblé passe après correction. La recette humaine de Tristan reste à faire. Git : changements non commités sur `main`, travaux graphiques/Jardin préexistants conservés, aucun push.

# Ajustement rapide du voile — 30 septembre 2026

À la demande de Tristan : lignes à 22 % d'opacité, voile à 16 % et teinte bleutée #b8d8f2. Aucun test ni build relancé, conformément à sa demande ; dosage visuel à apprécier pendant sa recette. Modifications non commitées sur main.

# Cases constructibles : contours pleins et voile blanc — 30 septembre 2026

Nouvelle préférence de Tristan : remplacer les pointillés devenus trop discrets par des lignes pleines et un léger voile blanc matérialisant la zone constructible. Rendu appliqué aux seules cellules `canBuild` du snapshot : contours blancs continus à 38 % d'opacité, surfaces blanches à 10 %, regroupées dans un seul mesh de remplissage. Le relief et la profondeur sont respectés, les meshes ne sont pas sélectionnables, et le voile est supprimé avec son matériau en quittant Construire ou lors de sa reconstruction. Aucun changement des règles d'occupation ou de distance côté serveur.

Recette dans le Chrome réel de Tristan : contours lisibles, terrain encore visible sous le voile, eau/Jardins/occupations exclus ; console sans erreur. Capture `test-results/grid-chrome-area.png`. Mode Construire laissé ouvert. Lint et build world-web terminés avec code 0. Régression navigateur adaptée aux segments continus, à la couverture du voile sur les seules cases disponibles et à son retrait après Annuler : **deux parcours verts**, ordinateur et Pixel 7, processus terminé avec code 0 (`test-results/grid-area`). `git diff --check` propre. Git : `main`, HEAD `20ff32b`, non commité, aucun conflit ni commit/push.

# Grille presque transparente — 30 septembre 2026

Tristan juge encore le rendu trop pavé et demande une grille vraiment légère, presque transparente. Le contrôle Chrome révèle que réduire seulement `grid.alpha` ne change pas l'opacité : `CreateLineSystem` transmet un `useVertexAlpha` indéfini au constructeur, qui désactive le mélange alpha. **Régression rouge avant correction**, `needAlphaBlending()` reçu `false` au lieu de `true` dans le parcours navigateur. Activation explicite par `useVertexAlpha: true`.

Alpha Construire **0,12**, couleur adoucie `#c6ccb7` ; contour hors construction 0,06. Points petits et serrés, filtre serveur `canBuild` et test de profondeur conservés. Transparence effective vérifiée dans le Chrome réel de Tristan : terrain dominant, points à peine visibles, console sans erreur. Capture `test-results/grid-chrome-subtle.png`, Construire laissé ouvert. Deux parcours navigateur finaux verts (ordinateur et Pixel 7, `test-results/grid-alpha-after`), lint et build world-web terminés avec code 0 ; `git diff --check` propre. Git : `main`, aucun commit/push, autres travaux préservés.

# Grille Construire : shaders et recette Chrome réelle — 30 septembre 2026

Retour de Tristan après la première correction : grille toujours absente dans son Chrome sur `localhost:5174/?world=aube`, y compris après rechargement effectué pendant cette reprise. **Défaut restant reproduit dans cet onglet réel** : console Babylon `FRAGMENT SHADER ERROR`, contenu HTML Vite dans le fragment `color`. La géométrie présente ne prouvait donc pas son rendu ; les anciens tests ne surveillaient que `pageerror`, qui ne capture pas cette erreur console. Les shaders GLSL `color.vertex` et `color.fragment` sont désormais importés explicitement dans le graphe de la scène. Après rechargement, les pointillés sont visibles dans l'onglet réel, sans erreur console relevée.

Précision UX demandée par Tristan : seules les cases réellement constructibles, points beaucoup plus petits et rapprochés, légèrement transparents. Lecture de `world-space-and-occupancy.md` et des vrais `candidates()` / `canBuild` de `villages/service.ts` : rayon de Chebyshev torique 5 depuis toutes les emprises terminées, exclusion des occupations, terrains non herbe et clairières protégées. Le rendu conserve cette autorité serveur. La surimpression de la première correction ignorait la profondeur et projetait des lignes de cases libres derrière les bâtiments sur leurs silhouettes ; supprimée. Points 40 par bord (au lieu de 10), longueur 0,3 intervalle, alpha 0,55. Bâtiments et bosquets masquent maintenant les lignes situées derrière eux ; aucune grille intérieure sur les emprises Jardin ou l'eau.

Capture finale de **l'onglet Chrome de Tristan**, inspectée : `test-results/grid-chrome-final.png`. Mode Construire laissé ouvert, aucun clic de construction/récolte ni changement des données de développement. Régression navigateur renforcée : matériau compilé et prêt (`isReady(true)`), absence d'erreurs console Babylon et de requêtes `.fx` de repli, nombre de sommets correspondant aux seuls bords des cellules autorisées du vrai snapshot. **Deux parcours finaux verts**, Chromium ordinateur et Pixel 7, processus terminé avec code 0 (`test-results/construction-grid-final-ready`). Lint et build world-web terminés avec code 0 après les shaders et le réglage visuel ; avertissement existant du chunk Babylon. `git diff --check`, 40 liens locaux et réponse HTTP 200 du monde dev vérifiés. Ces preuves complètent celles de la première passe sans prétendre que son rendu était déjà correct dans le Chrome réel.

Git inchangé : `main`, HEAD `20ff32b`, modifications non commitées, aucun conflit ni commit/push. Les travaux Jardins et graphiques antérieurs sont conservés.

# Grille Construire sur terrain texturé — 30 septembre 2026

Retour de Tristan pendant la recette humaine : les zones constructibles ne montrent plus leur réseau de cases pointillées après application des textures. **Correction validée dans le worktree, non commitée.** La grille conservait une hauteur absolue de 0,105 et un contraste faible ; le relief pouvait la masquer. Chaque bord suit désormais l'élévation de la région, avec décalage au-dessus du terrain et hauteur maximale entre voisins. Les indices régionaux respectent le tore. En mode Construire, un seul mesh non sélectionnable dessine les pointillés contrastés des cellules `canBuild` du snapshot ; hors construction, le contour discret reste seul visible. Aucun changement de règle serveur ou d'économie.

Preuves de cette correction :

- Régression navigateur rouge avant correction sur un snapshot dont le terrain est surélevé uniquement pour le rendu : grille mesurée à **0,105**, sous le sol à **1**. Après correction, la géométrie reste au-dessus du terrain et Annuler retire le réseau intérieur.
- Playwright : **4 parcours verts**, code 0, Chromium ordinateur et Pixel 7 : nouvelle régression plus parcours existant de construction/amélioration et Jardin. Captures avant/après et profils ordinateur/mobile inspectés ; aucun `pageerror`. Artefacts locaux : `test-results/construction-grid-before` et `test-results/construction-grid-after`.
- Vitest ciblé : **11 tests verts / 3 fichiers**, code 0 (sélection de construction, revue Jardin, apparences des tuiles). Chargeur `runner` utilisé pour éviter le bundling de configuration refusé par les permissions du parent du dépôt.
- Lint et build `@arbestra/world-web` terminés avec code 0 ; `git diff --check` vérifié. Tests DB sur `127.0.0.1:5432/arbestra_test`, sans suites réinitialisantes parallèles. Aucun reset ni migration de développement.

Serveur `corepack pnpm dev` laissé actif pour poursuivre la recette : lobby `http://localhost:5173/`, monde `http://localhost:5174/?world=aube`, API `http://127.0.0.1:3000/api/health`. Git reste sur `main`, HEAD `20ff32b`, sans conflit ; aucun commit/push. Le diff comprend toujours les Jardins et la passe graphique antérieure, préservés. Validation mobile sur profil Chromium, pas sur appareil physique.

# Finition des Jardins — 30 septembre 2026

Recette UX humaine : à la demande de Tristan après clôture, `corepack pnpm dev` démarré et laissé actif. Lobby `http://localhost:5173/`, monde `http://localhost:5174/?world=aube`, API `http://127.0.0.1:3000/api/health` : trois réponses HTTP 200 constatées. Aucun reset ni migration exécuté pour ce démarrage.

Demande de Tristan : « finir les jardins ». Implémentation de la [spec validée](docs/SPEC-JARDINS-PARCELLES-FUSION.md), sans nouvelle quête ni équilibrage. **Statut : tranche terminée et validée dans le worktree, non commitée.**

Corrections de la [recette historique](docs/REVIEW-2026-09-07-JARDINS.md) : migration 015 matérialisée à une borne PostgreSQL commune après verrous villages, avec constructions/extensions échues et plafonds chronologiques avant répartition exacte ; ancien buffer désormais passif à la réconciliation. Extension refusant les chantiers initiaux inachevés. Balayage par intersections de grille depuis les coordonnées réelles du pointeur, y compris au relâchement, déduplication torique et arrêt du geste faute d'habitants. Les nouvelles récoltes restent individuelles, un habitant et 60 secondes par parcelle.

File de récolte dédiée : clés monde/village/coordonnée, reçu et ancien bâtiment conservés tant que la réponse est incertaine, cibles suivantes ordonnées derrière elle, reprise toutes les deux secondes/online/focus et bouton Réessayer. Une fusion ou un snapshot montrant le trajet n'empêche plus la résolution du reçu. Boutons et indicateur de parcelle distinguent attente et départ accepté. Symbole plein conservé au-dessus des nouvelles textures. Tous les Jardins sont accessibles par le choix explicite ; les extensions simultanées d'une composante fusionnée sont exposées séparément avec leurs cellules et échéances. Les agrégats UI additionnent des projections plafonnées par parcelle.

Preuves déjà terminées pendant cette session :

- Les trois régressions R1/R2/R3 ont été reproduites rouges avant correction. Huit tests serveur de revue passent ensuite : migration près du plafond et chantiers échus, notifications/ressources préservées, deux entrelacements forcés avec `pg_blocking_pids`, rollback après stock/trajet/cohorte/tâche observés, crédit unique à D=60 s (D−1 exclu), fusion gardant deux trajets/deux extensions et anciens reçus.
- `corepack pnpm test` : **113 tests verts / 18 fichiers**, processus final terminé avec code 0. La première exécution avait 112 succès et une nouvelle assertion de preuve incorrecte : elle lisait le stock stocké au lieu de sa projection. Assertion corrigée vers le vrai `projectGardenPlot`, puis huit tests de revue verts et suite complète réexécutée avec succès.
- `corepack pnpm test:e2e` : **24 tests verts**, processus terminé (Chromium desktop et Pixel 7, six parcours Jardin par profil, construction, repos et Oracle). Quatre reprises ciblées terminées vertes : vraie migration 015 sur tables Jardin reconstruites dans une transaction de la base test avant session navigateur ; trajet global à deux habitants/612 carottes, stock migré 52 + 0,5 conservé, nouveaux départs bloqués puis un seul crédit ; réponse réellement acceptée côté serveur puis perdue, fusion visible et retry avec le même reçu.
- Captures desktop/mobile inspectées : symbole plein, aperçu tolérant, panneaux, fusion, attente et compatibilité globale. Déplacement tactile sur sol libre, glissé droit desktop et zoom ne déclenchent aucun départ. Les tests Jardin observent les erreurs JavaScript et assets PNG/WebP en échec ; aucun détecté.
- Lint, typecheck et build racine terminés avec succès, puis builds world-web/API terminés après les dernières finitions. Avertissement Vite existant sur le chunk Babylon >500 kB. L'indicateur en attente mobile reste lisible sous le panneau. Le marqueur au sol a reçu un matériau jaune émissif propre : le matériau de sélection sans éclairage ne rendait que son émissif brun, trop proche de la terre. Les quatre cas réponse perdue/village migré ont été réexécutés sur l'état final avec succès ; captures finales desktop/mobile inspectées, anneau jaune visible sur la parcelle concernée, production voisine lisible. Artefacts finaux : `test-results/e2e-garden-final` ; recette complète conservée dans `test-results/e2e`. Liens documentaires locaux et `git diff --check` vérifiés.

Validation DB uniquement sur `127.0.0.1:5432/arbestra_test`, suites réinitialisantes successives. La fixture de migration navigateur reconstruit uniquement les tables Jardin pré-015 et exécute `up()` dans la transaction ; elle ne prétend pas rejouer toutes les migrations 001–014 d'un déploiement historique. Les autres preuves de migration utilisent un schéma transactionnel isolé avec le catalogue réel et comparent les mutations avant leur rollback identifié.

Limites explicites : 015 corrigée ne s'exécute que sur les bases qui ne l'ont pas déjà appliquée. Aucun replay sur les parcelles actuelles ni crédit d'une perte historique estimée ; aucune écriture/migration/reset de la base de développement pendant cette session. Les intentions client survivent à la réponse perdue pendant la session React, sans persistance après F5. Recette tactile sur profil Chromium Pixel 7, pas sur appareil physique ni Safari. Les quêtes de première récolte restent hors scope.

Git : un seul worktree et une seule branche locale `main`, HEAD `20ff32b`, aucun conflit ni opération de merge/rebase. Aucun commit/push autorisé ou effectué. Les modifications graphiques préexistantes de Babylon/styles, les assets et les brouillons locaux sont conservés ; `hud.css`, specs graphiques, scripts et export de conversation ne sont pas absorbés. Le diff total contient donc à la fois ce travail et la passe graphique antérieure. Playwright écrit désormais dans `test-results/e2e`, avec reprises ciblées dans des sous-dossiers séparés, pour isoler ses artefacts des captures/sauvegardes locales historiques. `agent-browser` a encore échoué au lancement (`CDP response channel closed`) ; repli sur Playwright du dépôt, sans réparation destructive.

# Village de démonstration des huit Jardins — 23 septembre 2026

À la demande de Tristan, modification transactionnelle de la base locale de développement `127.0.0.1:5432/arbestra`, monde `aube`, village Clairière uniquement. Avant écriture : 15 habitants pour une capacité de 110, huit cases d'herbe libres et inoccupées en `(1024..1027, 509..510)`. Ajout de 95 habitants reposés dans une cohorte : total et disponibles **110/110**. Ajout de huit parcelles contiguës en bloc 4 × 2, distinct du Jardin préexistant : sept parcelles achevées avec stocks initiaux `0, 60, 180, 300, 420, 540, 600` carottes pour les textures 1 à 7, et une parcelle en chantier pour la texture 0. Les sept parcelles actives appartiennent à deux bâtiments rectangulaires voisins, fusionnés logiquement par le snapshot ; la parcelle en chantier est un troisième bâtiment avec sa tâche `building.complete`. Le chantier se termine le **24 septembre 2026 à 21:28:44 UTC**. Le curseur de production de la parcelle à 0 est aussi différé jusqu'à cette heure pour garder l'état « semé » visible pendant la démonstration ; les six autres parcelles actives produisent normalement. Aucune ressource existante débitée, aucun bâtiment ou jardin précédent modifié. Sauvegarde des cohortes antérieures et des identifiants créés : `test-results/dev-garden-showcase-backup-2026-09-23.json` (local, ignoré par Git).

Vérification après écriture dans la transaction : 110 habitants, huit occupations, sept lignes `garden_plots`. Snapshot réel via navigateur : 110 disponibles, une case réservée en chantier et sept actives ; capture `test-results/dev-garden-showcase-desktop.png`, aucune erreur JavaScript ni tuile HTTP manquante. Le rendu montre les huit états dans le bloc. Pas de campagne de tests applicatifs, car seule la donnée dev change ; pas de commit/push.

# Coin diagonal de rive — 23 septembre 2026

Tristan a précisé le cas manquant avec une capture : la case d'herbe au creux d'un V touche l'eau en diagonale ; ses deux voisines orthogonales portent chacune une bordure, mais son coin restait vert. Ajout d'un triangle supérieur sur cette case quand les deux voisines sont terrestres et la diagonale est de l'eau. Le raccord antérieur des cases bordées d'eau sur deux côtés reste en place. `needsDiagonalShorePatch` et son test ciblé fixent cette règle. Contrôle Playwright sur Clairière (`test-results/shore-diagonal-qa.png`, variante `-zoom.png`) : V raccordés, aucune erreur JavaScript ou asset manquant ; navigation et zoom uniquement, aucune action métier. Build world-web, lint et quatre tests ciblés terminés avec succès. Aucun commit/push.

# Faces et angles de côte — 23 septembre 2026

Après deux captures de Tristan : des angles sortants restaient nus et la texture des flancs apparaissait sur la mauvaise face. Dans `BabylonVillageScene.ts`, ordre des sommets du flanc inversé pour présenter les strates vers l'eau ; une petite pièce supérieure raccorde les deux bandes quand une case terrestre touche l'eau sur deux côtés adjacents. `shoreFaceCorners` centralise l'ordre et une régression ciblée vérifie les quatre directions. Contrôle Playwright sur Clairière avec captures `test-results/shore-angle-qa.png` et `shore-angle-qa-1.png` à `-3.png` : strates visibles sur les faces extérieures sous plusieurs angles, aucun asset en échec HTTP ni erreur JavaScript. Pendant la rotation par glisser de souris, le pointeur a traversé les Jardins : le nombre de personnes libres et les carottes ont changé ; action de jeu possiblement déclenchée, sans rollback de données faute d'attribution certaine. Build world-web, lint et trois tests ciblés terminés avec succès. Aucun commit/push.

# Correction du profil de côte — 23 septembre 2026

Après capture de Tristan : l'irrégularité était du côté de l'eau alors qu'elle devait être du côté de l'herbe ; le flanc se distinguait peu. La limite eau/bande reste désormais sur les carrés de la grille, la limite bande/herbe varie vers l'intérieur de la terre (`shoreInset`). L'eau descend à `-0.75` et le sous-sol suit ; `shore-face.png` reçoit quatre strates plus contrastées. Aucune donnée serveur ou DB modifiée. Voir [spec côte](docs/SPEC-COTE-EN-RELIEF.md). Contrôle Playwright sur Clairière réelle : `test-results/shore-fix-desktop.png` et `shore-fix-zoom.png`, aucune erreur JavaScript ou tuile HTTP manquante. Sur les captures, la variation est bien côté herbe ; le flanc est visible surtout sur les rives orientées vers la caméra et reste discret vu de dessus. Build world-web, lint, deux tests ciblés et `git diff --check` réussis. `agent-browser` échoue toujours au lancement (`CDP response channel closed`), d'où le repli Playwright. Aucun commit/push ; serveurs dev laissés en marche.

# Côte en faux relief — 23 septembre 2026

Après retour de Tristan et Marie : l'herbe et les textures Jardin sont conservées ; les huit overlays plats de rive ne conviennent pas. Direction confirmée par la planche JMP : une eau carrée dans les données mais plus basse, une limite de sol visible légèrement irrégulière, un flanc de terre entre les deux. Voir [spec de la passe](docs/SPEC-COTE-EN-RELIEF.md). Dans `BabylonVillageScene.ts`, l'eau descend à `-0.5` unité de rendu, le sous-sol descend aussi, chaque bord terrestre adjacent à l'eau reçoit quatre segments de bande supérieure et de flanc. Les extrémités des segments restent à la limite canonique de case. Les anciennes surfaces transparentes par case sont supprimées. `scripts/generate-terrain-tiles.mjs` produit maintenant huit herbes, huit Jardins, un dessus de rive et un flanc, plus l'atlas ; les huit PNG de bordure précédents ont été retirés. Aucune donnée serveur ou DB modifiée.

Contrôle Playwright sur le vrai village Clairière, desktop et mobile : `test-results/shore-review-desktop.png`, `shore-review-mobile.png` et variantes `-construction.png`. Sept bâtiments visibles, menu Construire avec quatre options, aucun asset HTTP manquant, aucune erreur JavaScript. Deux tests ciblés verts (raccord des extrémités et seuils Jardin), build client, lint et `git diff --check` verts. La côte montre désormais un dessus et un flanc, encore anguleux et à juger par Tristan/Marie en jeu. Les trois régressions métier Jardins restent ouvertes. Serveurs dev laissés en marche ; aucun commit/push demandé, brouillons préexistants intacts.

# Tuiles terrain, côte et Jardin — 23 septembre 2026

À la demande de Tristan : [contrat et limites de la passe 24 images](docs/SPEC-TUILES-TERRAIN-JARDIN.md). `scripts/generate-terrain-tiles.mjs` produit huit PNG d'herbe, huit PNG transparents de bordure eau/sol et huit PNG d'états Jardin, plus un atlas technique. Une tentative imagegen a été inspectée puis écartée des assets finaux parce qu'elle ne raccordait pas aux bords ; les images livrées sont produites de façon reproductible par le script. La planche JMP guide la palette et le style, sans équivalence promise.

Dans Babylon, UV du terrain vers l'atlas, bordures tournées selon les voisins d'eau, et texture de chaque parcelle déterminée par son stock/capacité de snapshot ou son état de chantier. Aucun changement serveur, contrat, migration ou donnée du village. Deux tests ciblés verts vérifient les 16 masques cardinaux et les seuils de Jardin. Contrôle Playwright sur Clairière réelle, desktop et mobile : `test-results/tiles-review-desktop.png`, `tiles-review-mobile.png` et variantes `-construction.png`, sept bâtiments visibles, quatre options de menu en construction, aucun asset en échec HTTP et aucune erreur JavaScript. La première capture révélait un atlas inversé, corrigé ; la seconde, un liseré soumis au conflit de profondeur, corrigé en relevant les surfaces de bordure. Build client, lint et `git diff --check` terminés avec succès. Le résultat après correction est à présenter à Tristan et Marie ; les raccords et le dosage artistique restent à juger en jeu. Les trois régressions Jardins documentées restent ouvertes. Aucun commit/push demandé ; les fichiers non suivis préexistants restent intacts.

# Arbres et cailloux — 23 septembre 2026

À la demande de Tristan après le retour de Marie, passe visuelle bornée sur la base de la passe terrain précédente. Dans `BabylonVillageScene.ts`, les 2 à 4 conifères de chaque feature `woodland` sont plus grands et mieux répartis dans leur case ; les gisements `stone_outcrop` sont plus lisibles. De petits cailloux non bloquants apparaissent de façon déterministe sur herbe, surtout près de l'eau, hors features et bâtiments ; ils sont fusionnés par matériau. Aucun contrat, règle économique ou génération de monde futur modifié. Voir `docs/architecture/world-grid.md`.

Dans la base **locale de développement** `127.0.0.1:5432/arbestra`, monde `aube`, village Clairière (ancre 1024,512), quatre features `woodland` avec occupations associées ont été ajoutées aux cases d'herbe libres `(1018,518)`, `(1022,520)`, `(1027,519)`, `(1031,518)`. Vérification préalable : aucune occupation et terrain herbe pour ces quatre cases ; contrôle transactionnel après écriture : quatre features et quatre occupations. Leurs identifiants et l'état antérieur vide sont dans `test-results/dev-scenery-clairiere-backup-2026-09-23.json` (local, ignoré par Git). Les bosquets sont de vraies features : ces quatre cases ne sont plus constructibles. Aucun autre village ni chunk modifié.

Contrôle Chromium via Playwright sur le vrai snapshot : village avec 7 bâtiments visible, captures `test-results/graphics-review-scenery-desktop.png`, `graphics-review-scenery-wide.png`, `graphics-review-scenery-construction.png` et `graphics-review-scenery-mobile.png`, aucune erreur JavaScript. Grille de construction visible. Le snapshot API confirme les 4 bosquets et aucune case village à ces coordonnées. Build client, lint et `git diff --check` terminés avec succès. `agent-browser` échoue toujours au lancement avec `CDP response channel closed` ; Playwright sert de repli. Les arbres apparaissent mieux, mais le premier cadre reste ouvert et peu boisé : appréciation humaine encore à recueillir. Les services dev restent sur les ports 3000, 5173 et 5174. Aucun commit/push demandé pour cette passe. Les brouillons `hud.css` et journal de session préexistants restent intacts.

# Eau réelle dans Clairière dev — 23 septembre 2026

À la demande explicite de Tristan pour inspection en jeu, modification ciblée de la base de **développement** `127.0.0.1:5432/arbestra`, monde `aube`, village Clairière. Une petite étendue irrégulière de **150 cases** d'herbe est devenue de l'eau dans deux lignes `world_chunks`, coordonnées canoniques comprises entre `x=1001..1017` et `y=503..516`. Les élévations de ces cases sont fixées à 0. La première emprise croisait une feature à `(1008,512)` : aucune écriture n'a eu lieu ; la rive a été redessinée pour laisser cette case sèche. Contrôle avant écriture : zéro occupation et 150 cases d'herbe. Contrôle après transaction : 150 cases d'eau, zéro occupation. Aucun bâtiment, gisement, stock ou compte modifié par cette opération.

Sauvegarde des anciennes valeurs par case : `test-results/dev-water-clairiere-backup-2026-09-23.json` (locale, ignorée par Git). Le navigateur Chromium a relu le vrai snapshot API : 150 cases d'eau, capture `test-results/graphics-review-water-real.png`, aucune erreur JavaScript. Le rendu n'utilise plus le snapshot simulé pour cette vérification. Les services dev API (`127.0.0.1:3000`), lobby (`localhost:5173`) et monde (`localhost:5174`) sont laissés en marche pour inspection par Tristan ; vérifier leur disponibilité à la prochaine reprise. Aucun commit/push. Le changement de terrain est une donnée locale de développement, pas une migration à publier.

# Passe graphique de prise en main — 23 septembre 2026

À la demande de Tristan, première passe visuelle bornée sur `main` / `20ff32b`, sans commit ni push : [spec et limites](docs/SPEC-PASSE-GRAPHIQUE-PRISE-EN-MAIN.md). Babylon rend une mosaïque de verts déterministe, des cases d'eau abaissées, des rives et des flancs d'élévation dans ses chunks existants. La caméra cadre les cellules occupées au premier chargement ; le HUD mobile ne chevauche plus le nom du village et le bouton Jardins reçoit un style et une place distincte de Construire. La correction préalable de la grille hors construction est conservée. Aucune règle serveur, migration, donnée village ou ressource graphique externe modifiée.

Contrôle navigateur effectué avec Chromium via Playwright sur la base de développement, desktop 1600 × 900 et profil Pixel 7 : connexion, village visible, ouverture de Construire et grille en mode construction, sans erreur JavaScript. Captures locales ignorées par Git : `test-results/graphics-review-desktop-quality.png` et `graphics-review-mobile-quality.png` en qualité normale ; les captures sans suffixe montrent le mode dégradé activé par `navigator.webdriver`, et leurs variantes construction vérifient la grille. La région de Clairière contient **0 case d'eau** ; le contrôle eau/rive utilise un snapshot modifié uniquement dans le navigateur (`graphics-review-water-mock.png`), sans écriture serveur. `agent-browser` échoue au lancement avec `CDP response channel closed`, d'où ce repli. Builds contrats et client, typecheck client, lint et `git diff --check` terminés avec succès. Les suites applicatives ne sont pas relancées pour cette passe de rendu ; les trois régressions Jardins connues restent rouges. La valeur visuelle et une vraie zone d'eau restent **à valider** ; ne pas déclarer la direction artistique complète.

Le brouillon non suivi `apps/world-web/src/hud.css` et le journal de session préexistant restent intacts. Les trois défauts Jardins de la recette du 7 septembre restent ouverts.

# Historisation granulaire — 9 septembre 2026

À la demande de Tristan, les changements Jardins existants sont répartis en commits de cadrage, migration, API, client, parcours E2E et revue, sans squash ni modification du code applicatif. La branche locale `master` est renommée `main` pour rejoindre la branche par défaut GitHub ; l'historique antérieur reste intact. La publication est autorisée ; vérifier le résultat effectif avec Git. `origin/master` reste une référence historique, sans suppression demandée.

Vérifications de cette opération : compilation des contrats et `corepack pnpm typecheck` terminées avec succès ; tests ciblés client/sélection : huit succès et un échec sur la régression connue de balayage diagonal. Les tests PostgreSQL et E2E ne sont pas relancés pendant cette historisation ; leurs preuves du 7 septembre restent datées. Aucun correctif de recette, aucune migration ni opération sur les données n'est effectué ici. La tranche reste **à corriger / à valider**, même une fois publiée.

Le brouillon `apps/world-web/src/hud.css` et le journal brut `codex-session-01a07944-0d99-7ab3-9983-b16b69419275.md` restent locaux et hors commits. Cette séparation organise l'état local disponible aujourd'hui ; elle ne reconstitue pas des dates ou étapes d'exécution historiques inexistantes dans Git.

# Recette Jardins — 7 septembre 2026

Opération dev effectuée ensuite à la demande explicite de Tristan pour constater les comportements : `corepack pnpm db:migrate` a appliqué `015_garden_plots` avec succès sur `127.0.0.1:5432/arbestra`. Seconde exécution réussie sans migration restante. Aucun reset ni seed. Les défauts de recette restent non corrigés ; les mentions « uniquement en test » ci-dessous décrivent l'état avant cette opération.

**Verdict : à corriger / à valider.** Recette demandée par Tristan après la livraison de Sol. Base relue : `master`, `b148f37`, worktree non commité. Voir la [revue avec reproductions et corrections attendues](docs/REVIEW-2026-09-07-JARDINS.md) et la [spec validée](docs/SPEC-JARDINS-PARCELLES-FUSION.md).

Trois défauts reproduits : perte de 0,25 carotte de production due lors d'une reprise proche de la saturation ; deux cellules traversées omises par le balayage diagonal ; chantier initial accepté comme existant toléré par le serveur. Régressions ajoutées dans `garden-review.integration.test.ts` et `garden-review.test.ts`, volontairement rouges : trois échecs précis constatés. La lecture révèle aussi des trous dans la reprise des intentions après réponse perdue/fusion et l'accès aux détails des Jardins autres que le premier.

Preuves de cette recette : suite livrée **95/95 verte**, puis régressions ciblées **3/3 rouges** ; **2 parcours Playwright verts** desktop/profil mobile, builds contrats/API réussis, six captures inspectées. Le parcours valide la récolte clavier d'une parcelle et un seul habitant affecté ; il ne prouve pas le glissé tactile, la caméra, l'extension ou la fusion visibles. `agent-browser` ne démarre pas Chrome ; repli Playwright. Ne pas confondre ces vérifications avec la validation complète de la tranche. Les anciens résultats lint/typecheck/build globaux restent ceux de Sol, pas une nouvelle campagne de recette.

La recette n'a corrigé aucun code applicatif. Les trois régressions, les captures ajoutées au test E2E et cette revue préparent la correction. Migration 015 présente uniquement en test ; aucune migration dev ni modification du joueur effectuée. Aucun commit/push. `hud.css` préexistant reste intact. Le précédent statut « implémentation terminée » est retiré ; l'explication antérieure attribuant l'échec de saturation à des fixtures parallèles n'est pas une preuve retenue.

## Repos jusqu'à énergie 10 — livraison précédente

Arbitrage de Tristan implémenté et validé : réveil dès énergie exacte 10, aucune immobilisation de cinq heures à pleine énergie ; une sieste courte ne restaure pas le quota alimentaire. Anciennes cohortes pleines endormies prises en charge à la lecture, sans migration ni nouveau reset. [Handoff et preuves](docs/HANDOFF-2026-09-07-REPOS-A-10.md) : 90 tests, 4 parcours navigateur desktop/mobile, lint/typecheck/build API verts. Correctif prêt et publié dans le workflow autorisé ; voir Git pour le hash de ce handoff. `hud.css` reste hors livraison.

## Coffre, journal et indice — clôture et opérations dev précédentes

Test manuel demandé ensuite par Tristan : village dev Clairière de `player@arbestra.local` réinitialisé dans une transaction ciblée (Hôtel de ville niveau 1, 15 habitants reposés, 2 000 bois, 50 carottes, 0 pierre, coffre disponible et grimoire vide). Compte, sessions et monde conservés ; tâches et progression du village supprimées. Nouvel onglet Chrome ouvert pour une session d'indice vierge. Script ponctuel retiré après succès.

Développement migré ensuite à la demande explicite de Tristan : `corepack pnpm db:migrate` a appliqué `014_village_accomplishments` avec succès sur la base locale `arbestra` (`127.0.0.1:5432`). Aucun reset ni seed. Les mentions « base dev inchangée » ci-dessous décrivent les validations précédentes.

Tristan a validé l'indice : 90 secondes visibles sans action réussie ni découverte du coffre, une seule fois par session, sans panneau automatique. Implémentation et validations terminées : [handoff de clôture](docs/HANDOFF-2026-09-07-INDICE-ORACLE.md), [spec](docs/SPEC-COFFRE-JOURNAL-ORACLE.md). **Tranche clôturée.** 9 tests ciblés verts dont 5 nouveaux, 4 parcours navigateur de l'indice desktop/mobile verts, lint/typecheck et build client verts. Base dev inchangée. Ce handoff accompagne la publication autorisée de l'indice ; le socle précédent est poussé dans `38b801a`. Seul `hud.css`, brouillon préexistant, reste hors livraison. Première récolte recommandée ensuite.

## Livraison du socle — avant l'arbitrage de l'indice

Revue et corrections demandées par Tristan : [verdict et levée des réserves](docs/REVIEW-ASTRA-2026-09-07-COFFRE-JOURNAL.md). Les trois preuves sont renforcées ; deux mutations temporaires ont démontré la sensibilité des tests. Validation finale : **83 tests**, **4 parcours Playwright desktop/mobile**, lint, typecheck et build verts. Le parcours ancien accomplissement/clavier est validé. Les réserves techniques sont levées ; l'indice reste à arbitrer. Commit/push autorisés par Tristan pour ce lot et ses documents de référence ; `hud.css` reste hors livraison.

Sol a implémenté la [spec coffre/journal](docs/SPEC-COFFRE-JOURNAL-ORACLE.md) sur la base `master`, `1da6df0` : accomplissement PostgreSQL `town-hall-supplies`, crédit atomique et idempotent des 2 000 carottes, migration conservatrice 014, célébration Oracle et grimoire persistant dans le HUD. Voir le [handoff et les preuves](docs/HANDOFF-SOL-2026-09-07-COFFRE-JOURNAL-ORACLE.md).

Statut : **implémentée / à valider pour l'indice**. Les résultats finaux de correction figurent ci-dessus et dans la revue. Sol avait également contrôlé dans le Chrome de Tristan : journal vide, coffre, 2 050 carottes, entrée datée et F5. Migration appliquée uniquement à la base test ; base dev intacte.

Seule limite de tranche : le délai et la règle de l'indice de l'Oracle restent ouverts ; la proposition actuelle est 90 secondes de présence active sans action métier réussie, une fois par session. Première récolte recommandée ensuite. Ce handoff accompagne la livraison Git demandée ; vérifier son commit et le distant avec Git à la reprise. Préserver `apps/world-web/src/hud.css`, brouillon non suivi préexistant.

## Consolidation produit — état au 6 septembre 2026

Travail courant : **consolidation documentaire terminée**, sans implémentation. Lire la [direction produit](docs/DIRECTION-PRODUIT.md) : parcours standard inscription → monde → spawn → quêtes ; TRY dans un village abandonné partiellement construit, puis inscription pour le garder ou commencer un village neuf ; coffre/Jardin, quêtes parallèles bois-pierre, population et satisfaction, Oracle, karma. Elle distingue décisions actées, pistes et arbitrages ouverts ; elle ne rend pas ces systèmes livrés. Le [lore TRY](docs-lore/TRY-SAMSARA.md), préexistant et non suivi à cette reprise, porte désormais cette évolution au-dessus de son texte initial conservé comme historique. Les modalités de conservation du village restent ouvertes.

Base relue : `master`, `1da6df0` (population, pierre, interactions, Habitation niveau 2). Réserves applicatives : contrôle visuel des dernières corrections de revue, Playwright historique à adapter ; voir la [revue de clôture](docs/REVIEW-ASTRA-2026-09-06-CLOTURE.md). Aucun test applicatif relancé pour cette consolidation.

Précision TRY actée : garder le village conserve toute la progression, constructions et ressources incluses. L'essai sans compte est plafonné par des niveaux de bâtiments nécessitant l'inscription/incarnation pour poursuivre (Scierie 6 comme exemple, seuils à calibrer), pas par le temps passé. Les modalités techniques de conservation et d'attribution restent à cadrer.

À cette date, la prochaine tranche prévue pour **Sol** était le [coffre et journal de l'Oracle](docs/SPEC-COFFRE-JOURNAL-ORACLE.md). Elle est désormais implémentée ; l'état courant et ses preuves figurent en tête de ce fichier. Le déclenchement de l'indice reste proposé à 90 secondes et non acté. Première récolte et architecture TRY sont des tranches suivantes à ordonner. Ne pas engager population/humeur/combat au seul motif qu'ils figurent dans la direction produit. Les réveils lisibles restent un cadrage distinct.

Git au 6 septembre : modifications documentaires seulement ; aucun commit/push pour cette tâche. L'état Git courant est décrit en tête de ce fichier. `apps/world-web/src/hud.css` reste intact. `docs-lore/` était non suivi avant les éditions ; seul le préambule d'évolution a été ajouté à son document TRY. Vérification documentaire : liens locaux des documents édités et diff contrôlés ; les comptes de tests ci-dessous sont historiques.

## Notes antérieures — historique, pas état courant

Les sections suivantes conservent les preuves et le contexte de leurs reprises. Leurs mentions « aucun commit/push », délégations et propositions sont datées ; elles ne remplacent ni le point de reprise ci-dessus ni les décisions produit consolidées.

# Revue de publication — 6 septembre 2026

À la demande de Tristan : revue, clôture technique et publication du lot population/pierre/interactions React/Habitation niveau 2. Voir la [revue Astra et ses réserves](docs/REVIEW-ASTRA-2026-09-06-CLOTURE.md). Le parcours complet a été validé humainement par Tristan avec Sol ; la suite Playwright historique reste à adapter. La revue corrige le rafraîchissement du coffre concurrent, la conservation de l'effectif pierre et les intentions d'extraction par cible. Ces dernières corrections restent à recontrôler visuellement par Tristan. Les anciens statuts « aucun commit/push » ci-dessous décrivent les reprises précédentes.

# Design du réveil des cohortes pour Astra — 6 septembre 2026

Tristan demande que le joueur puisse savoir quand les cohortes se réveillent. Voir la [note de design de Sol pour Astra](docs/DESIGN-SOL-2026-09-06-REVEIL-COHORTES-POUR-ASTRA.md) : vagues de réveil autoritatives exposées sans IDs techniques, prochain effectif et heure du dernier réveil, distinction explicite entre sommeil et manque de couchages. Statut : **proposition en cadrage** ; documentation uniquement, aucun commit/push.

# Proposition de quêtes joueur pour Astra — 6 septembre 2026

> Correctif UI courant : le HUD ne recevait aucun clic car `.top-bar` déclarait `pointer-events: none`. La barre reçoit désormais les événements et la pile de notifications demeure transparente. Validation navigateur laissée explicitement à Tristan ; aucun commit/push.

> Correctif énergie courant : le serveur projetait correctement le réveil automatique, mais le front ne pollait pas lorsque le repos était la seule transition. `App.tsx` rafraîchit désormais toutes les dix secondes tant que des habitants sont au repos. Validation navigateur laissée à Tristan ; aucun commit/push.

Tristan propose de faire du coffre de l'Hôtel de ville la première quête joueur, la complétion de la quête devenant l'autorité qui crédite les 2 000 carottes. Sol recommande un onboarding scénarisé minimal, sans moteur générique prématuré. Voir le [handoff de cadrage pour Astra](docs/HANDOFF-SOL-2026-09-06-QUETES-JOUEUR-POUR-ASTRA.md). Statut : **proposition en cadrage** ; aucun code, test, accès base, commit ou push pour cette discussion.

# Habitation niveau 2 — 6 septembre 2026

Sol a ajouté l'amélioration de l'Habitation : 300 bois, 120 secondes, 25 couchages après achèvement et corps Babylon plus sombre. Voir le [handoff et les preuves](docs/HANDOFF-SOL-2026-09-06-HABITATION-NIVEAU-2.md). Migration additive 013 appliquée avec succès à la base de développement, sans reset ni seed. 78 tests verts, lint/build/typechecks verts. Validation navigateur explicitement laissée à Tristan. Aucun commit/push.

# Interactions joueur prises en charge par Sol — 6 septembre 2026

À la demande de Tristan, Sol a repris le front React et branché HUD/population, coffre, récolte différée et menu pierre, avec découpage borné d'`App.tsx`. Voir le [handoff et les preuves](docs/HANDOFF-SOL-2026-09-06-INTERACTIONS-JOUEUR.md). Statut : **implémentée / à valider sur les parcours métier complets**, sans commit/push. Suite actuelle : 77 tests verts, lint/build/typechecks verts ; vérification Chrome partielle avec une correction issue du parcours. La base dev contient 800 habitants ajoutés manuellement par Tristan : ne pas traiter cette fixture comme un défaut applicatif ni la modifier.

# Audit et relais à Sol — 6 septembre 2026

Tristan confie exceptionnellement le clavier à Sol et demande de lui transmettre l'[audit Astra : priorités métier et frontières React](docs/AUDIT-ASTRA-2026-09-06-PRIORITES-POUR-SOL.md). Audit statique : constats, limites et tranches proposées, sans validation automatique des choix gameplay. La recommandation est une extraction limitée HUD/panneau construire, puis l'intégration habitants–récoltes et pierre. Ce relais explicite prime sur l'ancienne répartition « React à Tristan » ; suivre les instructions courantes de Tristan pour le périmètre de Sol. Enregistrement documentaire uniquement, aucun test applicatif ni commit/push.

# Finition gisements pierre — 5 septembre 2026

La finition Astra est implémentée après la revue Terra. Voir le [handoff et ses preuves](docs/HANDOFF-ASTRA-2026-09-05-gisements.md) et le [contrat React](docs/API-EXPLOITATION-GISEMENTS.md). Cette note prime sur les statuts historiques ci-dessous. Aucun commit/push. La migration 012 a été appliquée à la base de développement à la demande explicite de Tristan, sans reset ni seed. React et validation visuelle restent à Tristan.

# Reprise inter-agent — état courant

## Point de reprise — 5 septembre 2026

Lire [AGENTS.md](./AGENTS.md) et le [workflow](./docs/AGENT-WORKFLOW.md). Cette section remplace les statuts et consignes opérationnelles historiques plus bas ; vérifier toujours le worktree réel.

- Dernière tranche applicative clôturée : ordre économique par village, commit `4dfd494`, poussé sur `origin/master`. [Handoff et preuves](./docs/HANDOFF-ASTRA-2026-09-05-economic-order.md) : 39 tests verts à cette clôture, lint/typecheck verts, défaut historique reproduit rétrospectivement. Ce compte n'est pas une validation des futurs changements.
- Migration `009_economic_task_notifications` appliquée ensuite à la base de développement, à la demande explicite de Tristan ; le migrateur a signalé `Success` puis aucune migration restante à la seconde exécution. Le handoff daté décrit l'état antérieur, limité à la base test.
- Tranche habitants et récolte différée : implémentation hors UI React terminée dans le worktree, à valider/committer. [Handoff](./docs/HANDOFF-TERRA-2026-09-05-population-et-recolte.md), [spec](./docs/SPEC-TERRA-2026-09-05-habitants-et-recolte.md), [mock-up/API pour le product owner](./docs/UI-MOCKUP-2026-09-05-habitants-et-recolte.md). Migrations 010/011 testées uniquement sur `arbestra_test`; ne pas présumer leur application au développement.
- Gisements : [brief de Sol](./docs/architecture/Sol-Brief-exploit.md) conservé comme cadrage futur. Ce n'est pas une instruction de démarrer son implémentation.
- Travail documentaire courant : consignes agent/workflow et clarification des références. Les nouveaux documents de spec/PO et le brief existaient déjà dans le worktree avant cette mise à jour ; ne pas les attribuer à une implémentation.
- La présente mise à jour documentaire n'est pas un commit/push. Vérifier `git status` avant toute reprise ; ne pas déduire une autorisation de publication de celle donnée pour la tranche économique clôturée.

## Archives — fondations monde et Jardins

Les sections suivantes sont conservées pour leur historique. Leurs statuts « non commité », chiffres de tests, références Git et restrictions de session décrivent leurs dates d'origine, pas l'état courant. La délégation ancienne des tests navigateur à Tristan n'est pas une dispense permanente de validation des nouvelles tranches.

## Dernière reprise — corrections jardins, 2026-09-05

Cette section prime sur les bilans historiques ci-dessous. La review ciblée a trouvé des écarts dans la livraison Terra ; ils ont été corrigés dans le worktree, sans migration supplémentaire ni modification de la base dev.

- Récolte : réconciliation des extensions échues avant de matérialiser le buffer jusqu'au présent. Régression PostgreSQL : une heure à 60/h puis une heure à 120/h donne bien 180 carottes, même sans passage du worker.
- Polling : actif seulement si construction ou expansion présente ; suppression du piège `undefined !== null`.
- Construction : entrée par `Construire`/`B`, type puis sélection et confirmation. Drag souris, deux coins tactiles. Les bâtiments non spatiaux restent mono-case.
- Sélection : rectangle torique borné, nombre de cases/coût catalogue affichés, aperçu invalide rouge et confirmation désactivée. Une sélection invalide remplace l'ancienne ; `Recommencer`, `Annuler` et Échap nettoient l'aperçu.
- Extension : voisins proposés autour de toute l'emprise active ; vérification locale de l'adjacence. L'identifiant du Jardin à étendre ne dépend plus du menu ouvert : déplacer la caméra conserve la sélection.
- Babylon : contour seul en mode normal, grille détaillée en construction. Aperçu séparé des meshes bâtiment. Le clic gauche de construction ne pilote pas la caméra ; les gestes de caméra habituels restent disponibles hors de ce drag.
- Snapshot : les cellules de la construction initiale sont comptées en chantier, pas actives.
- Validation : 27 tests hors navigateur verts, dont 4 régressions nouvelles ; builds de production contracts/API/lobby/world-web verts (TypeScript inclus, avertissement habituel de taille Babylon). La validation souris/tactile dans le navigateur reste à Tristan ; aucune exécution navigateur par l'agent.
- Aucun commit/push. Ne pas attribuer les modifications antérieures du worktree à cette seule correction.

Date : 2026-09-04. État : **implémentation validée hors navigateur, non commit, non poussée**.

## Complément du 2026-09-05

- Picking Babylon exact au relâchement : un clic hors géométrie interactive ferme le menu ; la reprojection permanente des cases est supprimée.
- La grille globale est remplacée par un unique line system dérivé des cellules métier exposées par le serveur.
- Le décor serveur est fusionné par matériau ; les ombres individuelles des arbres et le fog sont retirés.
- La caméra comprime la perspective au village et rejoint progressivement une vue cartographique au dézoom.
- Génération v2 : noyau central de clairière `5 × 5` libre et quatre gisements déterministes hors noyau. La migration `007_clearing_deposits` enrichit les mondes v1 sans régénérer leur terrain.
- `docs/architecture/spatial-construction.md` est implémentée dans le worktree ; voir la dernière reprise en tête et les réserves de validation manuelle.

## Ancienne consigne de session (archive)

L'interdiction de tests a été explicitement levée. Les tests navigateur restent volontairement à la charge de Tristan, car ils sont coûteux et il pilote manuellement l'UX.

Ne pas écraser les modifications existantes de `apps/world-web/src/scene/BabylonVillageScene.ts` : elles contiennent notamment sa grille de sol manuelle. `docs/architecture/Notes.md` est également non suivi et n'a pas été créé par cette tranche.

## Décisions autoritaires

- Le monde est un tore rectangulaire : `2048 × 1024` cellules, chunks `32 × 32`.
- La cellule canonique est `(world_id, cell_x, cell_y)`. Une cellule vide n'a pas de ligne SQL.
- Les occupations mondiales remplacent les anciennes `village_cells` et `building_cells`.
- Une occupation appartient exactement à un bâtiment ou une feature. Les chantiers réservent leur emprise dès la transaction de commande.
- Les clairières non réclamées sont protégées contre l'expansion normale. Les clairières de village sont `claimed`.
- Terrain : `grassland` constructible, `water` et `rocky_ground` non constructibles.
- Features : `woodland` (une cellule boisée, recette future 2–4 arbres) et `stone_outcrop`; elles bloquent la construction. Fleurs/herbes restent décor client non bloquant.
- Le rayon constructible est Chebyshev `5` autour de toute cellule d'un bâtiment terminé du village. Les chantiers occupent mais n'étendent pas ce rayon.
- Les coordonnées mondiales remplacent les UUID de « site » dans les commandes. L'`id` encore présent dans `VillageCell` est uniquement une clé UI stable, de la forme `x:y`.

Les specs de référence sont :

- `docs/architecture/world-space-and-occupancy.md`
- `docs/architecture/world-generation.md`

## Travail écrit dans le worktree

- Nouvelle migration `006_world_space_and_generation.ts`, enregistrée dans `migrate.ts`.
  - Crée `terrain_types`, `world_chunks`, `world_clearings`, `world_feature_types`, `world_features`, `world_cell_occupancies`.
  - Copie les occupations bâtiment existantes depuis le modèle legacy, puis retire `building_cells`, `village_cells` et `buildings.anchor_cell_id`.
- Nouveau module `apps/api/src/modules/worlds/` :
  - `coordinates.ts` : normalisation et distances toriques.
  - `generation-config.ts` : réglages explicites de la génération v2.
  - `generation.ts` : générateur déterministe, bruit périodique et advisory lock PostgreSQL ; `db:seed` appelle le générateur pour Aube tant que le monde n'est pas `ready`.
- Service villages, routes et client HTTP migrés vers `cellX/cellY`.
- Le contrat de snapshot expose désormais `region` : fenêtre `64×64`, terrains, élévations, features et `generationVersion`.
- Le seed crée l'hôtel de ville directement dans `world_cell_occupancies`.
- Babylon consomme le terrain, les élévations et les features du snapshot. Les faux arbres/rochers locaux ont été retirés ; la grille globale a été remplacée par la grille métier dérivée des cellules accessibles.
- `arbestra_test` a été créée comme base PostgreSQL séparée. Son reset conserve le monde généré et remet seulement l'état joueur à zéro.
- La migration 006 et la génération ont été appliquées à la base dev sans reset : Aube est `ready`, avec 2 048 chunks, 600 clairières, 29 367 features et les 3 bâtiments/4 occupations historiques conservés.

## À reprendre impérativement avant validation

1. Tristan doit contrôler manuellement l'UX Babylon et signaler les corrections visuelles nécessaires. Aucun test navigateur n'a été lancé.
2. Ajouter le point d'entrée de création de monde/spawn lors de la tranche dédiée : la génération doit être appelée transactionnellement à la création du monde, et non seulement depuis le seed de développement.
3. Le futur déplacement de la fenêtre `64 × 64` devra charger les nouvelles données ; les meshes fusionnés de l’ancienne fenêtre sont déjà disposés proprement.
4. Commit/push uniquement sur demande explicite.

## Risques connus à examiner

- Une génération complète prend environ 35–40 secondes sur la machine locale ; les resets suivants sont rapides car les données mondiales immuables sont conservées.
- Le snapshot filtre désormais terrains et features à sa fenêtre côté SQL.
- La future navigation par chunks nécessitera un cycle de vie explicite des meshes/instances ; aucun moteur de streaming n'est implémenté.

## Validation effectuée

- `typecheck` : vert sur contracts, API, lobby et world-web.
- `lint` : vert.
- `build` de production : vert sur les quatre packages ; avertissement connu sur le chunk Babylon (~1,15 Mo brut).
- Vitest complet hors navigateur : 23/23 tests verts.
- PostgreSQL 17 réel : concurrence, retry, idempotence et collision feature/bâtiment validés.
- Migration 006 validée sur une copie de la base dev : 3 bâtiments et 4 occupations conservés.
- Génération : 2 048 chunks complets, 600 clairières espacées d'au moins 40 cellules, 2 400 gisements légers ajoutés et zéro feature dans les noyaux `5 × 5`.

## Spatial gardens -- update 2026-09-05

Status: implemented, migration `008_spatial_gardens` applied to `arbestra_test` and `arbestra` without reset; not committed or pushed.

- Garden stays `level = 1`. Its active footprint area determines its production and capacity.
- Unit values per active cell: `50 wood`, `60 carrot/h`, `600 carrot`.
- Initial construction reserves one filled rectangle (1 to 100 cells) and completes through `building.complete`.
- An extension creates `building_expansions`, one `building-expansion.complete` scheduled task, and occupancy rows with `pending_expansion_id`.
- Reserved cells block construction but contribute no production, capacity, or build radius.
- At the logical deadline the worker materializes the existing Garden buffer first, activates the reserved cells, then completes the expansion. This is transactional and idempotent.
- Harvest remains available during an expansion and uses active area only.
- The server validates filled-rectangle shape, collisions, and adjacency to at least one active Garden cell.

### Core files

- `apps/api/src/database/migrations/008_spatial_gardens.ts`
- `apps/api/src/modules/villages/spatial-selection.ts`
- `apps/api/src/modules/villages/complete-construction.ts`
- `apps/api/src/modules/villages/economy.ts`
- `apps/api/src/modules/villages/service.ts`
- `packages/contracts/src/villages.ts`
- `apps/world-web/src/App.tsx`

### API / snapshot

- Spatial construction: `POST .../buildings` with `buildingType`, `anchorCellX`, `anchorCellY`, `cells`.
- Garden expansion: `POST .../buildings/:buildingId/expansions` with `cells`.
- Snapshot Garden exposes `activeCellCount`, `pendingCellCount`, and optional `expansion`.
- All footprint cells carry the same `footprint.buildingId`; anchor, active extension, and reserved extension resolve to the same Garden menu.
- The legacy single-cell build payload is still accepted temporarily for old MVP tests. New client code uses spatial selection.

### Manual UX validation required

- Normal mode: empty cells are not pickable, so no free-cell menu on arbitrary clicks.
- Bottom bar: type -> first corner -> second corner -> confirm. Same selector is used for Garden extensions.
- Check initial multi-cell Garden, multi-cell extension, collision/obstacle, clicking an extension cell, completion, and F5/reconnect.
- Browser automation was deliberately not run.

### Validation done

- `db:migrate:test`: OK.
- `db:migrate` development: OK, without reset.
- API and world-web typecheck: OK.
- lint: OK.
- `git diff --check`: OK, CRLF warnings only.
- PostgreSQL economic integration suite passed after adapting the concurrent extension case.

### Reprise warnings

- The full worktree is still uncommitted and includes prior world/visual work. Do not assume every modified file belongs solely to spatial gardens.
- Never reset `arbestra`; apply migrations only. Reset only `arbestra_test`.
- Do not overwrite `docs/architecture/Notes.md` or Tristan's manual grid adjustments in `BabylonVillageScene.ts`.
- `docs/architecture/spatial-construction.md` is implemented; the earlier statement above calling it a future Terra tranche is stale.

## Git

Dernier commit de référence : `c75115f feat: establish world and economy foundations` (déjà poussé). La tranche présente n'est pas committée.
