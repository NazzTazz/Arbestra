# Recette World generator A/B — 7 octobre 2026

Mise à jour du 8 octobre : corrections implémentées et recette technique dans [le bilan des corrections](RECETTE-WORLD-GENERATOR-CORRECTIONS-2026-10-08.md). Les constats et mesures ci-dessous décrivent la livraison antérieure.

Statut : **A et B implémentées et vérifiées techniquement** sur main/f9fc28d avec worktree antérieur conservé. Relief et écologie sont une première recette exploratoire à ajuster avec Tristan ; C/D/E restent à réaliser. Aucun commit ni push de cette passe.

**Réserve du 8 octobre : B non acceptée visuellement.** Les preuves ci-dessous restent historiques ; [contre-recette actuelle](CONTRE-RECETTE-WORLD-GENERATOR-AB-2026-10-08.md).

## Livraison

- [Contrats](../packages/contracts/src/world-generator.ts), [climat](../packages/contracts/src/world-climate.ts), [générateur v3](../packages/contracts/src/world-landscape.ts).
- [Migration 035](../apps/api/src/database/migrations/035_world_generator.ts) additive : séparation ready/ouvert, tentatives persistantes. Anciens mondes ready conservés ouverts. Appliquée uniquement sur **127.0.0.1/arbestra_test**, sans reset ni seed.
- [API opérateur](../apps/api/src/modules/world-generator/routes.ts) authentifiée par session et allowlist serveur, disponible en production ; aucun privilège par DEV. Candidats fermés, commande idempotente, identité révision/checksum obligatoire pour conserver/ouvrir.
- [Worker](../apps/api/src/modules/world-generator/worker.ts) dédié, exclusion PostgreSQL globale, processus enfant isolé, heap Node plafonné et timeout. Tentative/heartbeat visibles hors transaction de publication ; reprise explicite des interruptions, publication atomique vérifiant la tentative courante. Une erreur de heartbeat arrête le child.
- [Panneau React](../apps/world-web/src/world-generator/WorldGenerator.tsx) sur `/world-generator`, chargé à la demande. Liste, seed, dimensions, paramètres figés, métriques demandées/obtenues, conservation, ouverture v2, reprise et suppression protégée.
- [Preview Babylon](../apps/world-web/src/world-generator/PreviewScene.tsx) : tore volumique, inspection locale 32×32, couches altitude/exposition/humidité/accessibilité, picking des coordonnées, arbres en thin instances, phase cosmologique réglable, lumière neutre ou ombres solaires. Atmosphère absente par défaut, réellement créée/détruite à l’activation.

Limites initiales configurables : 6 candidats persistants, 131 072 cellules par candidat par défaut (plafond dur 262 144), axes 64–512 multiples de 32, un calcul à la fois, 180 s de timeout, heap enfant 768 Mio. Ce plafond concerne le heap Node, pas une mesure ni un plafond de RSS totale.

## Recette exploratoire B

Plateaux constants de 8×8 cellules, altitudes entières signées bornées −8/+8. **Une unité verticale = un quart de largeur de case**. Paliers terrestres voisins ajustés pour des ruptures d’au plus une unité ; passages localisés de **2×1 cases**, avec huit petites marches visibles. Ce format respecte les maxima validés 2×5 et une unité. Aucune rampe.

Le franchissement autorise les plats et l’axe des escaliers dans les deux sens, bloque les falaises et les entrées latérales. Le bois ménage des corridors centraux et des détours vers les passages ; les petites poches libres isolées sont reconnectées. Un graphe de contrôle compte terres physiques, composantes accessibles et zones isolées. Il est partagé dans contracts, **sans remplacer les trajets du gameplay v2**.

Eau pondérée par l’aire toroïdale au sol, calibration bornée de moyenne/amplitude, humidité périodique et exposition intégrée sur le cycle solaire combiné (grille 32×16, 96 phases), courbe solaire favorable aux arbres non monotone. La météo du preview reprend seed et humidité partagées ; les anciens univers conservent leur recette météo. Les objectifs impossibles sont signalés sans déplacer les tirettes.

La largeur des canaux reste désactivée : hydrologie C absente. Eau du preview à 0, sans rivière perchée, courant, marée ni cascade. Végétation v3 conservée dans l’artefact ; elle ne crée pas encore les features/dépôts économiques. Aucune clairière réservée v3 ; spawn aménageur, révisions des chunks et branchement du graphe au gameplay restent D. **Ouverture v3 bloquée côté serveur et interface.**

## Preuves exécutées

**17 tests passés, 4 fichiers**, dernière exécution 22:30:25, durée 51,16 s :

```powershell
corepack pnpm --filter @arbestra/contracts build
corepack pnpm exec vitest run packages/contracts/src/world-landscape.test.ts apps/api/src/modules/world-generator/world-generator.integration.test.ts apps/api/src/modules/onboarding/onboarding.integration.test.ts apps/world-web/src/scene/weather.test.ts
```

Déterminisme, bornes et cibles impossibles, climat aux coutures, accessibilité/escaliers/entrées latérales ; droits opérateur en production et monde ready fermé ; suivi lisible pendant le véritable child et exclusion d’un second exécuteur ; interruption simulée par heartbeat périmé et reprise même identité ; **véritable child tué par timeout de 10 ms**, absence de chunks/checksum partiels, puis reprise réussie ; conservation/ouverture v2 idempotentes et révision obsolète refusée.

[Copie de recette v2](../apps/api/src/modules/world-generator/recipe-copy.ts) : résultat persisté recopié dans une base de test, IDs remappés, checksum égal avant un vrai `joinWorld`. Source sans village et checksum initial inchangé après ce spawn. Cet utilitaire est interne aux essais, sans endpoint public. Le checksum couvre l’artefact terrain/climat/bois/graphe du preview ; il ne doit pas être présenté comme une signature des stocks de gisements. Les features et dépôts sont recopiés depuis PostgreSQL. Étendre cette provenance aux couches hydrologiques et ressources pertinentes avant E.

Builds **contracts, API et world-web** réussis ; lint ciblé des modules et scripts passé. Le build world-web conserve l’avertissement de taille de chunks Babylon. Suite globale du dépôt non exécutée. Les suites DB n’ont pas été lancées en parallèle avec le worker de recette : un premier essai a révélé cette collision, puis un second la capacité occupée par les candidats de recette ; nettoyage scoped et exécution finale verte.

## Navigateur et référence mesurée

Vrai build production Vite, API en mode production et allowlist sur fixture, Chromium / WebGL 2 / Babylon **8.56.2**, ANGLE **Intel Iris Plus / Direct3D11**, Windows, i7-1065G7. NVIDIA MX230 présente sur la machine mais non utilisée par ce contexte.

Candidat **seed 42, v3, 256×128**, paramètres eau 25, amplitude 8, moyenne 1, canaux 4 (inactifs), bois 30, solaire 50. Viewport 1440×1000 ; phase 0 ; amplification 1 ; caméra tore alpha −π/2, beta 1,05, radius 8 ; locale alpha −π/2, beta 0,78, radius 23, centre premier escalier x71/y4, cible locale (0,1,0). Même build, mêmes paramètres, chargement stabilisé puis fenêtre de 120 frames. Le script attend l’initialisation réelle des trois passes de fog.

| Pose | FPS observés | Rendu JS médiane / p95 (ms) | Draws | Meshes actifs | Triangles compteur | Textures / passes fog |
|---|---:|---:|---:|---:|---:|---:|
| Tore neutre | 60 | 1,30 / 3,30 | 2 | 2 | 1 766 | 0 / 0 |
| Locale, bois et escaliers | 60 | 1,80 / 3,20 | 3 | 4 | 14 478 | 0 / 0 |
| Tore + atmosphère | 60 | 2,70 / 4,50 | 6 | 2 | 3 326 | 3 / 3 |
| Tore + ombres solaires | 59 | 4,00 / 6,50 | 8 | 2 | 11 126 | 1 / 0 |
| Après trois allers-retours | 58 | 0,80 / 1,70 | 2 | 2 | 1 766 | 0 / 0 |

Temps de génération final : **1 591 ms**. Sur 30 lectures HTTP health durant/après démarrage du calcul : médiane **20,13 ms**, maximum **202,71 ms** (première requête). Ce n’est pas un benchmark de missions économiques chargées. Aire eau **24,88 %**, moyenne **0,95**, amplitude **7** (−2/+5), bois **24,36 %** des terres, **190 escaliers**, **1 terre / 1 composante accessible / 0 zone isolée**. Écarts amplitude/bois expliqués dans le panneau.

Après quatre changements de candidat supplémentaires : 2 meshes, 0 texture, même géométrie au retour, aucune erreur ; choix vide retire effectivement le canvas. FPS ponctuels descendus à 32 pendant cette recette concurrente, sans prétendre un budget stable sur cette machine. Artefact final PostgreSQL : **668 322 octets stockés**, **1 874 398 octets JSON** non compressés pour 32 768 cases. Pas de mesure du heap total ni de mémoire GPU ; retour des compteurs ne prouve pas à lui seul l’absence de toute fuite.

Vérification visuelle : plateaux/marches proches, couches accès/exposition, tore, fumée on/off, lumière solaire, conservation et ouverture v3 désactivée, retours de vues/candidats ; aucune erreur JS ni erreur shader observée dans la session finale. Deux corrections issues de la recette : winding des quads (normales), import Babylon Ray requis pour le fog. Mobile 390×844 : largeur document 390, pas de débordement horizontal. Simulation de viewport, pas test matériel mobile.

Les triangles viennent de `getActiveIndices()/3` ; c’est un compteur Babylon incluant du travail de passes/instances, distinct des sommets résidents et du temps GPU. Les temps JS viennent de SceneInstrumentation ; **temps GPU absent**. Cette table établit la référence du nouveau preview, pas un gain de performance de la vue Village.

[Script navigateur reproductible](../tests/browser/world-generator.mjs), avec [serveur de recette isolé](../tests/browser/world-generator-server.mjs). Captures et JSON conservés localement dans `test-results/world-generator-*-final.png` et `test-results/world-generator-browser.json`, ignorés par Git. Les services temporaires ont été arrêtés, cinq candidats v3 et leur compte fixture supprimés ; pas de reset de base ni de données de test dans un univers public.

## Activation et reprise

Voir [README](../README.md#world-generator-alpha--tranches-ab). Développement/production restent à migrer avec `corepack pnpm db:migrate` puis allowlist `WORLD_GENERATOR_OPERATOR_EMAILS` et redémarrage. Aucune configuration privée changée, aucun univers ouvert par cette passe.

Reprise **C par Astra**, avec contre-recette A/B avant hydrologie : surveiller contraintes amplitude/couverture, aspect des plateaux 8×8, détours, définition des plus hautes eaux, provenance complète des ressources et cas extrêmes. D porte le spawn local et les invalidations, E la recette joueur v3 avant ouverture. État Git : main/f9fc28d, changements non commités ; modifications antérieures conservées.


### Activation locale ultérieure (7 octobre 2026)

Tristan a ensuite demandé explicitement l’activation : `.env.dev` autorise `start@arbestra.world`, migration 035 appliquée à **127.0.0.1/arbestra**, API watch rechargée et worker local démarré. Route **http://localhost:5174/world-generator** et endpoint du compte start vérifiés HTTP 200. Session de contrôle créée puis supprimée ; univers existant toujours ouvert et nombres inchangés (1 monde, 2 villages, 69 bâtiments), sans reset, seed ni génération. Production reste à activer séparément.

### Correction des marches après recette joueur (7 octobre 2026)

Tristan demande des marches larges et peu profondes. Recette courante : **volée 2×4 cases**, huit girons de ¼ case, dénivelé ≤1 unité. Le maximum produit reste 2×5. La tentative 2×5 isolait les cases de coin entre deux côtés d’escaliers dans certains plateaux 8×8 ; 2×4 conserve deux cases de contournement sur chaque bord.

Les contremarches descendantes sont maintenant au bord de sortie des girons. Les parois rejoignent le plateau extérieur et les marches s’affichent aussi aux bords de la fenêtre locale. L’emprise entière est dégagée, toutes les voies se franchissent dans les deux sens, les mouvements transversaux internes sont permis et les entrées latérales extérieures restent interdites. Des détours courts bornés dans chaque plateau remplacent les strips en L de la première recette.

Les artefacts sauvegardés restent ceux inspectés : leur largeur persiste. **Générer un nouvel aperçu** pour la nouvelle emprise ; les anciens profitent de la correction de profil sans changement de checksum. Pas de migration ni de modification des candidats du joueur.

Vérification actuelle : régression rouge sur l’ancienne largeur de 1 ; **6 tests purs / 2 fichiers + 5 tests API / 1 fichier passés**, builds contracts/world-web et lint ciblé passés. Les échecs intermédiaires ont identifié les coins isolés du format 5 avant le choix du format 4. Navigateur production : seed42/256×128, poses X montée (71,2), X descente (159,2), Y montée (66,7), Y descente (114,7), caméra locale standard de la recette ci-dessus. Captures inspectées dans `test-results/stair-0-up.png`, `stair-0-down.png`, `stair-1-up.png`, `stair-1-down.png`, JSON `stair-browser.json`. Zéro erreur JS finale ; fog/ombres et cycles également rejoués. Les anciennes mesures A/B ci-dessus restent historiques.

Résultat nouveau : eau24,88 %, moyenne0,95, amplitude7, bois25,04 %, 190 escaliers, 1 terre/1 composante/0 zone isolée, génération1 366 ms. Un candidat et son compte de recette nettoyés dans la base de test ; services locaux du jeu conservés. Script navigateur enrichi pour reproduire les quatre poses. Main/f9fc28d, aucun commit/push.


## Correction du bouton de generation - 7 octobre 2026

Le plafond local de six candidats etait atteint. Le panneau affiche maintenant le nombre de places et le refus pres de Generer, et desactive ce bouton a capacite pleine. Plafond prive local porte a douze ; six candidats utilisateur conserves. Le defaut versionne reste six. Six integrations API, build production et lint cible passes. Recette navigateur isolee : deux generations pretes, plafond visible, suppression explicite puis nouvelle generation prete, zero erreur. Script `tests/browser/generator-capacity.mjs` avec serveur de recette et `WORLD_GENERATOR_MAX_CANDIDATES=2`. Capture `test-results/generator-capacity-full.png`, trace JSON correspondante. Fixtures et services de recette supprimes apres verification.

## Suppression du plafond — 8 octobre 2026

À la demande explicite de Tristan, suppression du plafond de candidats sauvegardés (localement 12). `WORLD_GENERATOR_MAX_CANDIDATES` n'est plus lu, le serveur ne compte plus les candidats pour refuser une création et le panneau affiche leur nombre sans quota ni désactivation pour capacité. Taille maximale d'un monde, exécution isolée, budgets mémoire/temps et protections des mondes ouverts/habités restent en place.

Les 12 candidats prêts, fermés et inhabités de la base locale `arbestra` ont été supprimés via `deleteCandidate`, après inventaire ; compte restant zéro. Aucun monde jouable supprimé. Test API rouge sur l'ancien plafond puis vert avec 13 candidats malgré l'ancienne variable réglée à 1 ; test d'accès opérateur/taille/idempotence repassé vert. La recette navigateur `generator-capacity.mjs` utilise désormais le vrai composant avec 13 candidats HTTP simulés : bouton actif, aucun message de plafond, aucune erreur. Elle n'écrit aucune donnée. Capture `test-results/generator-capacity-unlimited.png`, rapport JSON associé, hors Git.
