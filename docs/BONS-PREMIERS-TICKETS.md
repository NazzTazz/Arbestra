# Bons premiers tickets : brouillons

Brouillons d'issues, prêts à copier sur GitHub (titre, corps, étiquettes). Chemins et lignes vérifiés dans le code au 4 novembre 2026 ; les lignes bougent, cherche alors le nom cité. Pour installer le projet et lancer un test : [CONTRIBUTING.md](../CONTRIBUTING.md). Pour comprendre la scène : [APPRENDRE.md](APPRENDRE.md) §3.

Ces tickets sont des **corrections techniques**, pas des décisions de gameplay. Ils ont été lus dans le code mais **pas reproduits sur un vrai téléphone** : la première étape de chacun est de constater le problème.

---

## 1. Rendu mobile : une résolution beaucoup trop basse

**Étiquettes** : `bon premier ticket`, `mobile`, `perf`

**Contexte.** Sur téléphone, le jeu paraît flou. Le moteur règle la résolution de rendu ainsi, à la création de la scène :

```ts
this.#engine.setHardwareScalingLevel(Math.max(this.#reducedQuality ? 4 : 1.2, window.devicePixelRatio / 1.5));
```

Le moteur est créé sans « adaptation au ratio de l'appareil » (`new Engine(canvas, true, { ... })`, quatrième paramètre non fourni) : le rendu part donc de la taille du canvas **en pixels CSS**, divisée par ce niveau. Sur un téléphone de densité 3, le niveau vaut `max(1.2, 3 / 1.5) = 2` : on dessine à la moitié de la taille CSS, soit **un sixième de la résolution physique dans chaque direction** (un trente-sixième des pixels). La formule va dans le mauvais sens : plus l'écran est dense, plus on dégrade. Sur un PC (densité 1) le niveau est 1,2, soit 83 % de la taille CSS. (Le rapport CSS → physique est déduit du code de Babylon ; le constater avec `canvas.width`, voir plus bas.)

**Fichiers.**
- [`apps/world-web/src/scene/BabylonVillageScene.ts`](../apps/world-web/src/scene/BabylonVillageScene.ts) : `setHardwareScalingLevel`, ligne 1355 ; création du moteur, ligne 1353 ; mode « qualité réduite » (navigateur automatisé), ligne 429.

**Critère de réussite.**
- Sur un appareil de densité 2 ou 3, le canvas est rendu à une résolution au moins égale à sa taille CSS (niveau de mise à l'échelle inférieur ou égal à 1), plafonnée pour garder la fluidité (par exemple une densité effective plafonnée à 2). Le plafond exact est un choix à justifier par la mesure.
- Sur PC (densité 1), rien ne change visiblement et les budgets du dépôt tiennent (aucune image de plus de 100 ms une fois le village prêt).
- Le mode `#reducedQuality` garde son comportement.
- La règle de calcul est extraite en une petite fonction pure avec un test (densité de l'appareil vers niveau de mise à l'échelle).

**Comment vérifier.**
1. Constater : sur un téléphone (ou l'émulation d'appareil de Chrome avec une densité de 3), comparer `document.querySelector('canvas').width` à la largeur CSS du canvas.
2. Appliquer la correction et mesurer avant/après avec l'overlay de statistiques (`localStorage['arbestra:dev']='1'`, bouton DEV) : temps d'image et temps GPU, pendant 60 secondes de jeu. Mettre les chiffres dans la PR (budgets : [CONTRIBUTING.md](../CONTRIBUTING.md)).
3. Test automatisé de la fonction de calcul : `corepack pnpm exec vitest run <fichier de test>`.

---

## 2. Écran « Tourne ton téléphone » en portrait, et plein écran paysage sur Android

**Étiquettes** : `bon premier ticket`, `mobile`

**Contexte.** Le jeu se joue en paysage. Aujourd'hui rien n'accueille le joueur qui tient son téléphone en portrait, et il n'y a pas de bouton plein écran : une recherche dans `apps/world-web/src` ne trouve aucun usage de `screen.orientation` ni de `requestFullscreen`. Tout est à écrire. La [feuille de route](ROADMAP.md) liste ce correctif parmi les petites tranches (« Mobile, correctifs rapides »).

**Fichiers.**
- [`apps/world-web/src/App.tsx`](../apps/world-web/src/App.tsx) : où les écrans sont assemblés (voir les usages de `WorldLoading`, ligne 1843 et suivantes).
- [`apps/world-web/src/ui/WorldLoading.tsx`](../apps/world-web/src/ui/WorldLoading.tsx) et son test [`WorldLoading.test.ts`](../apps/world-web/src/ui/WorldLoading.test.ts) : modèle d'un petit composant d'écran plein cadre et de son test sans navigateur (`renderToStaticMarkup`).
- [`apps/world-web/src/styles.css`](../apps/world-web/src/styles.css) : styles ; une règle `@media (orientation: portrait)` peut suffire pour l'affichage.
- [`apps/world-web/index.html`](../apps/world-web/index.html) : la balise `viewport` (ligne 5).

**Critère de réussite.**
- En portrait sur un petit écran tactile, un écran couvrant la scène dit, avec le ton de l'Oracle (malicieux, bref, pas technique), de tourner le téléphone. Il disparaît dès que l'appareil passe en paysage. Il ne s'affiche pas sur un PC en fenêtre étroite.
- Un bouton « Plein écran » demande le plein écran (`requestFullscreen()`), puis tente de verrouiller le paysage avec `screen.orientation.lock('landscape')`. Cette API de verrouillage n'existe que sur Android (Chrome), seulement en plein écran et après un geste du joueur ; elle est absente d'iOS Safari. Le bouton ne s'affiche que si l'API est disponible, et un échec du verrouillage est silencieux (le jeu continue).
- Les textes sont en français.

**Comment vérifier.**
1. Test automatisé d'une petite fonction « faut-il afficher l'écran ? » (largeur, hauteur, appareil tactile).
2. Dans Chrome (outils de développement, émulation d'appareil), basculer portrait / paysage.
3. Idéal : essai sur un vrai téléphone Android via le réseau local ([guide](GUIDE-DEVELOPPEUR.md) §9). Dire dans la PR ce qui a été testé et ce qui ne l'a pas été (iOS en particulier).

---

## 3. Scintillement des routes et des halos de récolte sur mobile (z-fighting)

**Étiquettes** : `mobile`, `aide bienvenue`

**Contexte.** Les surfaces posées sur le sol (routes, halos des ressources) sont dessinées à très faible hauteur au-dessus du terrain. Quand deux surfaces presque coïncidentes se disputent le même pixel de profondeur, elles scintillent : c'est le « z-fighting ». Il est signalé sur mobile, où la précision de profondeur peut être plus faible. Ce que le code montre :
- les halos sont décalés d'une constante, `RESOURCE_HALO_LIFT = 0.045`, avec écriture de profondeur désactivée (`disableDepthWrite`) ;
- les matériaux des routes ne définissent aucun `zOffset` ;
- seuls deux matériaux du client utilisent `zOffset` aujourd'hui (`soil.zOffset = -2`, `footprintMaterial.zOffset = -1`) ;
- aucun `minZ` / `maxZ` de caméra n'est défini dans le client : les valeurs par défaut de Babylon s'appliquent (à vérifier dans sa documentation ; des plans proche et lointain très écartés dégradent la précision de profondeur).

`zOffset` est la propriété Babylon qui « tire » une surface vers la caméra dans le tampon de profondeur, sans la déplacer visuellement.

**Fichiers.**
- [`apps/world-web/src/scene/infrastructure-renderer.ts`](../apps/world-web/src/scene/infrastructure-renderer.ts) : matériaux des routes, créés autour de la ligne 204.
- [`apps/world-web/src/scene/resource-halos.ts`](../apps/world-web/src/scene/resource-halos.ts) : `RESOURCE_HALO_LIFT` (ligne 26), matériaux des halos (ligne 98).
- [`apps/world-web/src/scene/inspect-halo.ts`](../apps/world-web/src/scene/inspect-halo.ts) : halo du bouton « Inspecter » (matériau ligne 103).
- Exemples d'usage de `zOffset` : [`barracks-factory.ts`](../apps/world-web/src/scene/barracks-factory.ts) (ligne 120) et [`factory-preview.ts`](../apps/world-web/src/scene/factory-preview.ts) (ligne 201).
- Création de la caméra dans [`BabylonVillageScene.ts`](../apps/world-web/src/scene/BabylonVillageScene.ts).

**Critère de réussite.**
- Sur un téléphone, plus de scintillement visible des routes ni des halos de récolte en bougeant la caméra.
- Aucun changement visible sur PC (hauteurs, couleurs, ordre d'empilement des couches).
- La valeur retenue (`zOffset` par couche, ou réglage des plans de caméra) est expliquée dans la PR avec des captures avant/après.

**Comment vérifier.** Ouvrir un village avec des routes et des ressources à récolter, regarder en biais et en mouvement, comparer avant/après. Aucun test automatique ne détecte le scintillement : les captures font foi. Si la PR change une constante, un petit test peut vérifier que chaque couche au sol reçoit son `zOffset`. Si le réglage de caméra change, mesurer les images avant/après (budgets dans [CONTRIBUTING.md](../CONTRIBUTING.md)).

---

## 4. Campagne de mesures : choisir une zone de traits plus loin des bâtiments, des routes et de la limite de portée

**Étiquettes** : `bon premier ticket`, `perf`

**Contexte.** La campagne de mesures (DEV → « Campagne de mesures », voir le [guide](GUIDE-DEVELOPPEUR.md) §6) peint des traits de terraformation dans une zone choisie automatiquement : la plus proche du village dont chaque case est « peignable ». Le pinceau fait 3 × 3 : un trait touche aussi les cases voisines de chaque case peinte. Comme la zone retenue est la **plus proche** du village, elle colle souvent aux bâtiments et aux routes, ou à la limite de portée de construction (8 cases, `BUILD_REACH`), et l'Oracle refuse certains traits : le scénario est alors invalidé.

Le choix se fait dans `chooseZone` : une case est acceptée si `unitRefusal` (la case et son anneau de 3 × 3) ne trouve aucun refus. Il n'y a aucune marge supplémentaire autour de la zone, et `findStrokeZone` trie les candidates par distance au village seulement.

**Fichiers.**
- [`apps/world-web/src/dev/measure-campaign.ts`](../apps/world-web/src/dev/measure-campaign.ts) : `findStrokeZone` (ligne 393, recherche de la zone par sommes cumulées), `zoneVertices` (ligne 448).
- [`apps/world-web/src/dev/measure-runner.ts`](../apps/world-web/src/dev/measure-runner.ts) : `chooseZone` (ligne 351), constantes `ZONE_RADIUS`, `ZONE_RELIEF`, `ZONE_WATER_MARGIN` (lignes 60 à 63).
- [`apps/world-web/src/ui/terraform-refusals.ts`](../apps/world-web/src/ui/terraform-refusals.ts) : `cellRefusal`, `unitRefusal` (ligne 147), qui disent pourquoi une case est refusée (route, bâtiment, hors de portée…).
- [`packages/contracts/src/building-footprint.ts`](../packages/contracts/src/building-footprint.ts) : `BUILD_REACH` (ligne 46), `withinBuildReach` (ligne 48).
- Tests : [`measure-campaign.test.ts`](../apps/world-web/src/dev/measure-campaign.test.ts), bloc « stroke zone » (ligne 271).

**Critère de réussite.**
- La zone choisie garde une marge d'au moins quelques cases (à fixer, par exemple 2 ou 3) autour d'elle, débord du pinceau 3 × 3 compris, par rapport aux bâtiments, aux routes et aux équipements.
- Elle reste à une distance à fixer de la **limite de portée** : la zone la plus proche n'est plus au bord. Une campagne lancée sur un village réel ne produit plus de refus de l'Oracle dus au choix de la zone.
- Si aucune zone avec marge n'existe, la PR choisit entre le repli sur la zone actuelle (sans marge) et l'erreur actuelle (« Aucune zone libre… »).
- Des tests sur `findStrokeZone` (ou sur une fonction ajoutée) couvrent la marge.

**Comment vérifier.**
1. Test ciblé : `corepack pnpm exec vitest run apps/world-web/src/dev/measure-campaign.test.ts`.
2. En local, avec un village : DEV → Campagne de mesures, lancer un scénario de trait, constater l'absence de refus dans les incidents du JSON de résultats.

Piste : exiger la condition « peignable » sur la zone élargie de la marge, dans `chooseZone`. Reproduire d'abord le refus avant de corriger.

---

## 5. Installation sur Linux et macOS : dérouler le pas-à-pas et le corriger

**Étiquettes** : `bon premier ticket`, `docs`

**Contexte.** Le [README](../README.md) donne les commandes d'installation en PowerShell (`Copy-Item`, `New-Item -ItemType SymbolicLink`), parce que le projet est développé sous Windows. [CONTRIBUTING.md](../CONTRIBUTING.md) ajoute des équivalents Linux / macOS (`cp`, `ln -s`, `docker compose exec …`) qui n'ont **pas été essayés sur ces systèmes**. Dérouler l'installation de zéro sur une machine propre est un excellent exercice pour un débutant, et utile à tous les suivants. (Idée de contribution tirée de ce chantier d'ouverture du dépôt, pas d'un registre de dette.)

**Fichiers.**
- [`CONTRIBUTING.md`](../CONTRIBUTING.md), section « Installer le projet en local ».
- [`README.md`](../README.md), section « Développement local ».
- [`package.json`](../package.json) (scripts `db:up`, `db:setup`, `dev`, `db:test:setup`), [`compose.yaml`](../compose.yaml), [`.env.example`](../.env.example), [`.env.test.example`](../.env.test.example).
- [`docs/GUIDE-DEVELOPPEUR.md`](GUIDE-DEVELOPPEUR.md) §2.

**Critère de réussite.**
- Sur un système Linux ou macOS neuf (ou une machine virtuelle), suivre le pas-à-pas **à la lettre** donne : le lobby sur <http://localhost:5173>, le monde sur <http://localhost:5174/village>, une connexion réussie avec le compte de développement, puis un test ciblé qui passe (par exemple `corepack pnpm exec vitest run packages/contracts/src/building-footprint.test.ts` après la construction de `contracts`).
- Chaque écart rencontré (commande qui échoue, étape manquante, message d'erreur obscur) est corrigé dans la documentation, ou signalé dans une issue s'il vient du code.
- La PR indique le système, la version de Node et le temps total de l'installation, pour vérifier l'objectif d'une quinzaine de minutes.

**Comment vérifier.** Le relecteur suit à son tour le pas-à-pas corrigé. Vérification documentaire seulement : aucun test applicatif à lancer pour la PR elle-même.
