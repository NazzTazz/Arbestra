# Contre-recette World generator A/B — 8 octobre 2026

Mise à jour du 8 octobre : corrections implémentées et recette technique dans [le bilan des corrections](RECETTE-WORLD-GENERATOR-CORRECTIONS-2026-10-08.md). Les constats et mesures ci-dessous décrivent la livraison antérieure.

**Verdict : B n’est pas acceptée visuellement ; reprise nécessaire avant C.** A possède un socle technique vérifié, avec des réserves sur la fidélité complète de la copie et l’outil d’inspection. La qualification précédente « vérifiée techniquement » ne vaut pas acceptation de la géographie.

Base : main/f9fc28d, grand worktree préexistant conservé. Demande : contre-recette, sans correction du générateur. Référence : [spec alpha](SPEC-WORLD-GENERATOR-ALPHA.md), [ancienne recette](RECETTE-WORLD-GENERATOR-AB-2026-10-07.md). Le besoin explicite actuel est un relief plus granulaire, donnant un aspect « craquelé » en couche altitude. **Interprétation proposée, en attente de précision : mosaïque de plateaux irréguliers, pas ajout automatique de ravins.**

## 1. Preuves nouvelles

Inspection navigateur du candidat existant **a6476a95-0a16-402d-8d1b-dde78083d067**, seed 1, v3, 512×256, eau 12 %, amplitude 12, moyenne 1,5, bois 12 %, solaire 0. Checksum : `fb0c28c44194d49c87d2690273b61734456178b55f77736eb1929e31ae99c315`. Aucun candidat créé, modifié ou supprimé ; session de contrôle temporaire supprimée après inspection.

Vite **développement**, checkout courant, Chromium/WebGL2, viewport 1440×1000, canvas 1080×560. Caméra globale initiale alpha −π/2, beta 1,05, rayon 8 ; phase 0, lumière neutre, atmosphère absente. Captures comparables amplification 1 puis 4 ; inspection locale via « Voir un escalier ». Zéro erreur navigateur. Ce parcours n’est pas une nouvelle certification du build production ni un benchmark matériel.

Captures locales ignorées par Git :
- [Altitude ×1](../test-results/generator-review-altitude.png).
- [Altitude ×4](../test-results/generator-review-altitude-x4.png).
- [Inspection locale](../test-results/generator-review-local-altitude.png).
- Métadonnées : `test-results/generator-review-browser.json`.

**12 tests existants repassés : 6 purs et 6 API.** La suite API utilise uniquement sa cible gardée `127.0.0.1/arbestra_test`, sans reset ; ses fixtures sont nettoyées. Ces tests verts ne couvrent pas les défauts esthétiques ci-dessous.

## 2. Constats classés

### P1 — Génération trop grossière, liée à une grille technique

[world-landscape.ts](../packages/contracts/src/world-landscape.ts#L3) impose BLOCK=8. Les seules fréquences du bruit de hauteur sont **2 et 4 à l’échelle du monde** (ligne 49). La hauteur calculée pour un bloc est recopiée sur ses 64 cases (lignes 77–80). Augmenter les dimensions ne crée donc pas une diversité locale proportionnelle.

Mesure : **100 % des ruptures de hauteur suivent des limites multiples de 8**, dans les cinq recettes régénérées et dans le candidat inspecté. Il n’existe aucune rupture interne aux blocs. La spec demandait un paysage naturel, des plateaux étendus et des passages localisés ; elle ne validait ni cette grille, ni ces deux seules échelles.

Un plateau dans le tableau est une composante terrestre connexe de même hauteur, avant prise en compte des arbres. Ce sont des nombres de cellules, **pas des aires toroïdales pondérées**.

| Cas | Plateaux | Plus grand plateau | Amplitude demandée / obtenue |
|---|---:|---:|---:|
| Seed 42, 64×64, défauts | 8 | 768 cases | 8 / 4 |
| Seed 42, 256×128, défauts | 13 | 15 360 cases | 8 / 7 |
| Seed 42, 512×256, défauts | 6 | 62 336 cases | 8 / 8 |
| Seed 2, 512×256, eau11/bois15/solaire100 | 5 | 77 952 cases | 8 / 8 |
| Candidat inspecté seed1, amplitude12 | 31 | 62 400 cases | 12 / 12 |

Dans le dernier candidat, le plus grand plateau occupe **47,6 % des cellules du monde**, eaux incluses dans ce dénominateur. L’amplitude globale correcte masque une faible diversité locale.

### P1 — Le maillage du tore renforce l’aspect de gros pavés

[PreviewScene.tsx](../apps/world-web/src/world-generator/PreviewScene.tsx#L71) utilise un pas global fixe de 8 en v3 et une seule face supérieure par échantillon. À 512×256 : **64×32 faces supérieures** ; à 256×128 : **32×16**. Le pas ne dépend ni du zoom ni de la taille projetée.

Constat visuel : grosses facettes et bandes liées à la courbure, immenses aplats, relief peu lisible à ×1. ×4 rend les ruptures existantes plus visibles, sans ajouter de géographie. La lumière module également les couleurs d’altitude selon les normales : des bandes visuelles ne sont pas nécessairement des niveaux différents.

Aujourd’hui, le pas 8 coïncide avec les blocs générés : le problème n’est donc pas seulement une perte de relief détaillé au rendu. **Réduire uniquement le pas du preview ne suffira pas.** Après une génération plus fine, conserver cet échantillonnage ponctuel ferait en revanche disparaître les petits reliefs.

### P1 — L’accessibilité impose artificiellement la forme du paysage

[world-landscape.ts](../packages/contracts/src/world-landscape.ts#L63) rabaisse systématiquement les plateaux terrestres pour que chaque voisin diffère d’au plus une unité, puis pose un escalier au centre de chaque bord de bloc de hauteur différente (lignes 85–97). Les corridors sans arbre suivent eux aussi les lignes centrales de tous les blocs (ligne 83).

Sur les cinq recettes et le candidat inspecté : **aucun bord terrestre de dénivelé supérieur à 1**. Cela va au-delà de la règle produit : une unité est la limite **d’un escalier**, pas de toutes les falaises du monde. Des ruptures plus fortes avec détour et plusieurs paliers sont explicitement possibles. La connexion de chaque bord n’est pas requise.

Conséquence : accès régulièrement espacés, bois quadrillé et relief atténué. Le graphe devrait sélectionner des liaisons locales dans une géographie naturelle, puis réparer les cas nécessaires, plutôt qu’imposer une maille globale.

### P1 — « Zéro zone isolée » peut être faux

[landscapeMetrics](../packages/contracts/src/world-landscape.ts#L41) calcule `max(0, composantes accessibles − terres)`, sans associer les composantes à leur terre.

**Contre-exemple exécuté en 64×64** : deux terres séparées par l’eau ; la première contient deux bandes praticables de hauteurs 1 et 2, sans escalier ; la seconde est entièrement boisée. Résultat : 2 terres, 2 composantes accessibles, **0 zone isolée**, malgré la coupure de la première terre. Ce cas est construit pour éprouver le compteur ; il n’est pas présenté comme un monde effectivement produit par la recette actuelle.

Corriger le calcul par terre, puis mesurer aussi les terres sans accès, les goulots et les détours. Le verrou d’ouverture v3 actuel empêche une exposition immédiate aux joueurs ; il ne rend pas cette métrique fiable.

### P2 — Les tirettes et la validation ne suffisent pas à caractériser le résultat

Seed42/256×128 : bois demandé 30 %, obtenu **25,04 %** après les dégagements ; à 512×256, **25,61 %**. Seed17/128×64 avec amplitude16 et bois80 : amplitude **11**, bois **66,98 %**. Les avertissements existent : il n’y a pas dissimulation du résultat. Mais ces écarts ne sont pas tous des impossibilités géographiques : la grille de corridors et la méthode de réparation participent à la contrainte.

Les tests vérifient déterminisme, bornes, quelques accès et un cas manifestement impossible. Ils ne mesurent ni taille des plateaux, ni alignement artificiel, ni maintien de la densité à plusieurs tailles de monde, ni qualité visuelle des transitions.

### P2 — Inspection et provenance incomplètes

- Changer couche, coordonnées, amplification ou phase recrée moteur, scène **et caméra** ([PreviewScene.tsx](../apps/world-web/src/world-generator/PreviewScene.tsx#L165)). Une pose choisie à la souris est perdue, ce qui gêne les comparaisons.
- L’eau transparente est dessinée aussi en couche altitude ; les fonds sont teintés par cette superposition. La légende se limite à une indication textuelle bleu/rouge, sans échelle graduée.
- La recette ne persiste que `version:3`, sans révision distincte du générateur. Le changement documenté des escaliers 2×1 vers 2×4 s’est fait sous ce même numéro. Les artefacts enregistrés restent stables, mais « même seed/version/paramètres » ne garantit pas une régénération identique entre ces livraisons.
- Le checksum de [recipe-copy.ts](../apps/api/src/modules/world-generator/recipe-copy.ts) compare l’artefact preview, qui ne contient pas les stocks de gisements, toutes les features ni la recette de spawn. Les données copiées dépassent donc les données effectivement signées. **La fidélité complète de la copie A reste à prouver**, même si le parcours v2 testé fonctionne.

## 3. Reprise recommandée avant C — proposition, non implémentée

1. **Recette géographique** : conserver les grandes masses terre/eau, ajouter une échelle intermédiaire et des contours locaux périodiques, échantillonnés à la case ; quantifier ensuite en plateaux plats. Éviter à la fois les blocs 8×8 obligatoires et le bruit aléatoire indépendant par case. La distribution des tailles de plateaux doit rester cohérente lorsque le monde grandit. Garder des surfaces capables d’accueillir le village-type ; taille cible à recetter, aucune nouvelle tirette imposée ici.
2. **Accès** : sélectionner un réseau suffisant de passages et détours, conserver des falaises locales, placer les escaliers bornés sur de vraies liaisons et dégager uniquement les corridors utiles. Contrôler chaque terre après végétation, avec métriques de détour et goulots. Les pentes restent exclues.
3. **Preview** : séparer la finesse nécessaire à la courbure du tore de celle des données de relief ; préserver les frontières visibles des plateaux. Choisir un niveau adapté au cadrage sans simplifier au point d’effacer les petites régions. Couche altitude avec échelle graduée et lecture du fond, caméra conservée entre changements de couche. Mesurer le coût avant/après au même cadrage ; aucune promesse de gain GPU à ce stade.
4. **Reproductibilité** : persister une révision explicite de recette et conserver les candidats existants. Étendre séparément la preuve canonique de copie aux données requises avant ouverture.
5. **Acceptation** : panneau comparatif 3 seeds × 3 tailles (64×64, 256×128, 512×256), mêmes poses ×1/×4 et locale. Relever distribution des plateaux, part des ruptures alignées sur la grille8, écarts des tirettes, connectivité par terre et détours. Faire échouer une régression sur le faux zéro décrit ci-dessus. Valider l’aspect irrégulier et la lisibilité des villages avant de poursuivre l’hydrologie.

Un simple passage de BLOCK=8 à BLOCK=1 casserait plusieurs hypothèses des escaliers et corridors et conserverait le bruit trop large. Un simple trait de contour ajouterait une apparence « craquelée » sans réparer les données. Ces raccourcis ne répondent pas à la demande.

## 4. Reproduction et état final

```powershell
node --import tsx scripts/audit-world-generator.mjs
# Option : ajouter le chemin d’un artefact JSON déjà exporté pour le mesurer aussi.
corepack pnpm exec vitest run packages/contracts/src/world-landscape.test.ts apps/world-web/src/world-generator/stair-profile.test.ts
corepack pnpm exec vitest run apps/api/src/modules/world-generator/world-generator.integration.test.ts
```

Le [script d’audit](../scripts/audit-world-generator.mjs) n’accède à aucune base. Les JSON/captures locaux sont dans `test-results/generator-review-*`. Les données et services utilisateur sont conservés. La contre-recette modifie seulement le suivi documentaire et ajoute ce script ; **aucune correction de génération ou de rendu n’est livrée**. Tests nouveaux exécutés le 8 octobre ; performances et recette production antérieures restent historiques. Aucun commit/push.
