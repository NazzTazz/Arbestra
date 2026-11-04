# Inventaire des licences avant ouverture du dépôt — 4 novembre 2026

Base : `7de87df` (branche `open-source-licensing`). Étude en lecture seule ; aucune valeur sensible n'est reproduite. Décision du PO : code sous AGPL-3.0, contenus non logiciels sous CC BY-NC-SA 4.0, nom « Arbestra » réservé. Ce document n'est pas un avis juridique.

Méthode : `git ls-files` (1 471 fichiers suivis), lecture des README et manifestes, `git log --diff-filter=A` sur des échantillons, balayage par motifs des fichiers texte. Les licences JavaScript viennent du champ `license` des `package.json` installés dans le `node_modules` du dépôt principal (lu sans le modifier ; versions installées, pas forcément celles du lockfile à la lettre).

## Points bloquants (à régler avant de poser les licences)

1. **`LICENSE` absent** : le texte officiel de l'AGPL-3.0 n'est pas présent dans les paquets installés. Il n'a pas été écrit de mémoire. À récupérer tel quel sur <https://www.gnu.org/licenses/agpl-3.0.txt>.
2. **Tiers à vérifier** : `apps/world-web/public/decals/perlin-tag.png` (1,8 Mo, « PNG Perlin de Downloads » fourni par Tristan le 11 octobre) et `apps/world-web/public/arbestra-loading.png` (3 Mo, « image de JMP », 16 octobre). L'historique indique un fichier fourni, pas son auteur ni ses droits. Si JMP, Marie ou l'auteur du « Perlin » n'ont pas consenti à CC BY-NC-SA, retirer ou remplacer. Le texte du lore cite aussi la « planche JMP » comme référence graphique ; vérifier qu'aucune reproduction ne figure dans le dépôt.
3. **Contenus à provenance IA** : voir section 4. Pas bloquant juridiquement, mais la décision d'étiqueter ces fichiers CC BY-NC-SA est à prendre en connaissance de cause.
4. **Pas de secret ni de journal suivi** (voir section 5), donc aucun blocage de ce côté. Un point de réserve : l'historique git contient 572 commits sous l'adresse personnelle de Tristan, déjà publique si le dépôt l'est.

Aucune dépendance incompatible n'a été trouvée.

## 1. Dépendances

### Rust

`crates/` ne contient que `.gitkeep`. Aucun `Cargo.toml` : rien à déclarer.

### JavaScript, dépendances directes (tous les `package.json` sont `"private": true`)

| Espace de travail | Paquets (licence) |
| --- | --- |
| Racine (dev) | `@eslint/js`, `eslint`, `globals`, `prettier`, `tsx`, `typescript-eslint`, `vitest`, `@types/node` : MIT ; `@playwright/test`, `typescript` : Apache-2.0 |
| `apps/api` | `fastify`, `@fastify/cookie`, `@fastify/type-provider-typebox`, `@sinclair/typebox`, `fast-json-stringify`, `kysely`, `pg` : MIT |
| `apps/admin-web`, `apps/play-web` | `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, types : MIT |
| `apps/world-web` | `@babylonjs/core`, `@babylonjs/loaders` : Apache-2.0 ; `delaunator`, `@kninnug/constrainautor` : ISC ; React, Vite : MIT |
| `packages/contracts` | `@sinclair/typebox`, `polygon-clipping` : MIT |

Observations :

- Ensemble transitif installé (289 paquets) : MIT 232, Apache-2.0 22, ISC 17, BSD-2-Clause 6, BSD-3-Clause 6, plus `robust-predicates` (Unlicense), `minimatch` (BlueOak-1.0.0), `argparse` (Python-2.0), `caniuse-lite` (CC-BY-4.0). Ce sont des outils de développement ; `caniuse-lite` (données) n'est pas livré avec le jeu. Aucune GPL, LGPL, SSPL, propriétaire, « non commercial » ou licence inconnue ; pas de GPL-2.0-only.
- `@babylonjs/loaders` est déclaré en devDependency alors qu'il est embarqué dans le bundle : sans conséquence de licence (Apache-2.0), mais à connaître pour les mentions.
- Apache-2.0 est compatible avec AGPL-3.0 (non avec GPL-2.0-only, absente ici).
- Services externes non distribués : PostgreSQL (licence PostgreSQL), Docker via `compose.yaml`.
- Les paquets embarqués dans les bundles (React, Babylon, etc.) exigent de conserver leurs mentions de copyright ; Vite les conserve en partie. Un fichier de remerciements (`THIRD-PARTY-NOTICES`) est une option à étudier.

## 2. Contenus binaires et médias

Aucune police suivie (pas de `.woff`, `.ttf`, `.otf`), aucun son, aucun `.ktx2`, `.hdr`, `.fbx`, `.obj`. Les CSS demandent `Inter` en première famille mais ne la chargent ni depuis Google Fonts ni depuis un fichier : repli sur les polices système (`system-ui`, Georgia, Consolas). Rien à licencier côté polices ; si Inter est un jour embarquée, elle est OFL-1.1.

| Dossier | Fichiers / taille | Provenance probable | Catégorie |
| --- | --- | --- | --- |
| `apps/world-web/public/tiles/` | 19 PNG, 289 Ko | Générés par `scripts/generate-terrain-tiles.mjs` ; la proposition imagegen n'a servi que de référence de palette (spec tuiles) | Fait pour le projet (code) |
| `apps/world-web/public/buildings/` | 11 PNG (490 Ko) et 72 `.abmesh.gz` ; 28 Mo | Compilés par `scripts/bake-buildings.mjs` depuis les fabriques de bâtiments du code | Fait pour le projet (code) |
| `apps/world-web/public/garden/` | 1 PNG, 1 `.abmesh.gz` | Convertis de `blender-elements` par `scripts/convert-garden-kit.mjs` | Fait pour le projet (IA, Opus 5.5) |
| `apps/world-web/public/thumbnails/` | 4 PNG, 53 Ko | Captures du rendu du jeu (README du HUD) | Fait pour le projet (code) |
| `apps/world-web/public/hud/` | 5 PNG, 797 Ko | Générés avec l'outil imagegen intégré (README du HUD, 20 octobre) ; 3 sur 5 sont « historiques » | Fait pour le projet (IA) |
| `apps/world-web/public/atlas/rc1.svg` | 1 SVG, 1 Mo | Produit par `scripts/build-spawn-atlas.ts` à partir du JSON géographique | Fait pour le projet (code) |
| `apps/world-web/public/decals/perlin-tag.png` | 1 PNG, 1,8 Mo | Fichier fourni, « Perlin » (easter egg) | **Tiers inconnu** |
| `apps/world-web/public/arbestra-loading.png` | 1 PNG, 2,9 Mo | « Image de JMP », copiée sans modification | **Tiers inconnu** |
| `apps/world-web/public/studies/` | JSON de géographie | Données générées par le dépôt | Fait pour le projet (code) |
| `apps/world-web/bench/assets/` | 3 GLB, 8,2 Mo | Cheval de Quaternius réexporté par Blender, trois niveaux de détail | **Tiers identifié** : CC0 |
| `art-sol/` | 9 PNG, 2,6 Mo | Captures historiques du rendu procédural (README « journal visuel »). Tristan : produites avec GPT-6-sol | Fait pour le projet (IA / capture) |
| `docs/references/atlas-rc1-concept-01.png` | 1 PNG, 3,3 Mo | Concept « imagegen » | Fait pour le projet (IA) |
| `blender-elements/` (racine, `assets/`, `previews/`, `sources/`) | 2 GLB, 1 BLEND, 3 PNG, environ 7 Mo | Kit jardins V7 (Astra) | Fait pour le projet (IA) |
| `blender-elements/v8/` | 12 GLB, 13 PNG, 10 textures, 1 BLEND, 4 scripts Python ; environ 15 Mo | Kit V8 (Opus 5.5, d'après la notice) | Fait pour le projet (IA) |
| `blender-elements/carre-potager/` | 2 GLB, 10 PNG | Kit retenu (Opus 5.5) | Fait pour le projet (IA) |
| `blender-elements/contre-proposition-opus/` | 4 PNG, 1 BLEND, 2 scripts | Étude Opus 5.5 | Fait pour le projet (IA) |
| `blender-elements/villageois/` | 10 PNG, 4 MP4, 1 BLEND, 7 scripts | Étude Opus 5.5 | Fait pour le projet (IA) |
| `blender-elements/routes/` | 9 PNG (9,9 Mo), 1 BLEND | Étude Opus 5.5, cheval procédural | Fait pour le projet (IA) |
| `blender-elements/chevaux/` | 1 BLEND (3 Mo), 1 GLB source, 7 PNG, 1 MP4 | Dérivés du **White Horse de Quaternius**, CC0 (README, crédit donné), source « non modifiée » | **Tiers identifié** : CC0 |
| `ops/`, `scripts/` | scripts Python, shell, JS, unités systemd | Code | Code (AGPL) |

Note : le README `blender-elements/README.md` cite le kit d'Astra et celui d'Opus 5.5. Tristan indique « Claude et un serveur MCP » ; les notices parlent d'« Astra » et d'« Opus 5.5 ». À rapprocher : un interlocuteur peut être un autre modèle que Claude.

## 3. Textes et données

- `docs-lore/TRY-SAMSARA.md` (7 Ko) : texte de conception, écrit pour le projet.
- Textes de l'Oracle et du jeu : `packages/contracts/src/release-notes.ts`, `releases.ts`, `docs/CHANGELOG-ALPHA.md`, migrations de textes. Écrits pour le projet par Tristan avec l'aide d'agents IA (voir `voix-oracle` dans la mémoire du projet).
- `docs/`, `SESSION-HANDOFF.md`, `docs/old/`, `docs/HANDOFF-ARCHIVE-*.md` : documents de travail internes, remplis de noms de modèles et de procédures. Pas de problème de licence, mais ils exposent la méthode de travail (voir section 5).
- Aucune image sous droits repérée dans `docs/`, hors `docs/references/atlas-rc1-concept-01.png`.

## 4. Contenu généré par IA

| Contenu | Origine déclarée | Source |
| --- | --- | --- |
| `art-sol/` (9 PNG) | Captures du rendu du jeu au début du projet, GPT-6-sol selon Tristan | Tristan ; README sans mention de l'outil |
| `blender-elements/` (modèles, scripts, aperçus) | Agents « Astra » (V7, V8) et « Opus 5.5 » (carré potager, villageois, routes), via Blender (MCP selon Tristan) | READMEs du dossier |
| `docs/references/atlas-rc1-concept-01.png` | Outil intégré imagegen | `docs/CADRAGE-CARTE-ATLAS-RC1.md` |
| `apps/world-web/public/hud/*.png` | Outil imagegen | `apps/world-web/public/hud/README.md` |
| Code, tests, specs et textes | Rédigés avec des agents IA (569 commits de Tristan, 2 de « Claude ») | Historique git |

Éléments factuels, sans trancher :

- La protection par le droit d'auteur d'un contenu entièrement produit par une IA est incertaine selon les pays (conditions d'originalité et d'apport humain). Une licence CC appliquée à ces fichiers peut donc être en partie inopposable ; elle reste sans effet nuisible pour le projet. Les captures de jeu (`art-sol/`) et les rendus issus du code relèvent aussi du code qui les produit.
- Les conditions d'OpenAI et d'Anthropic attribuent en général les sorties à l'utilisateur, sous réserve de leurs règles d'usage. **Non vérifié ici** : consulter les conditions en vigueur au moment de la publication, pour chaque fournisseur et chaque outil (imagegen, Claude, serveurs MCP).
- Rien ne prouve que les sorties reproduisent des œuvres tierces. Les concepts imagegen ont été générés à partir d'une capture du jeu ; ils ne sont pas dérivés d'une œuvre tierce connue.
- Une licence NC (usage non commercial) sur des contenus que l'on ne contrôle pas entièrement ne peut pas excéder les droits que l'on détient.

## 5. Fichiers sensibles ou personnels suivis par git

Fichiers suivis recherchés : `.env`, `*.log`, clés (`*.pem`, `*.key`), `test-results/`, bases de données, jetons. Résultat :

- **Aucun** `.env` réel, journal, clé privée ou dossier `test-results/` suivi. Seuls `.env.example` et `.env.test.example` (exemples) sont suivis. `.gitignore` couvre `.env*`, `*.log`, `test-results/`.
- Aucun de ces fichiers n'a jamais été ajouté dans l'historique (recherche `--diff-filter=A` sur `.env`, `*.pem`, `*.key`, `debug.log`) ; aucune clé privée dans l'historique (recherche `-S`).
- Motifs balayés dans le texte (chemin et type seulement) :
  - **Identifiants de connexion à une base** dans des URL : `.env.example`, `.env.test.example`, `.github/workflows/test.yml` (identifiants de développement locaux sur 127.0.0.1) ; quelques tests ; `ops/deploy/bootstrap.py` (gabarits `{app}`/`{owner}`, pas de valeur réelle). Type : exemples ou fixtures.
  - **Mots de passe de fixtures** dans `apps/api/src/database/seed.ts` et une quinzaine de tests ou scripts de navigateur (`tests/browser/*.mjs`). Type : comptes de développement et de test, à ne pas réutiliser en production. À vérifier une fois : que ces mots de passe ne servent à aucun compte réel.
  - **Adresses IP** : uniquement des adresses de bouclage, de plages de documentation ou de réseau Docker interne (172.18.0.x). Aucune IP publique repérée. Deux faux positifs dans du code géométrique.
  - **Adresses e-mail** : domaines fictifs (`arbestra.local`, `*.test`), plus `alpha.arbestra.world` et `arbestra.world` (adresses d'exploitation publiques par conception) dans `config.test.ts`, `starter-village.ts`, `docs/SPEC-ONBOARDING-JOUEUR.md`, `docs/HANDOFF-ARCHIVE-2026-10-23.md`.
  - **Chemins personnels** (type « dossier utilisateur Windows ou Unix ») : `docs/old/HANDOFF-AB-REPRISE-COMPTE-2026-10-21.md`, `docs/old/CONTRE-RECETTE-EXPEDITIONS-RC1-ASYNCHRONES-2026-10-12.md`. Anodins, à nettoyer par propreté.
- **Exposition d'exploitation** : `ops/deploy/*`, `docs/DEPLOIEMENT-VPS.md` et `SECURITY.md` décrivent l'architecture du VPS (services systemd, passerelle, sauvegardes, emplacements des fichiers d'accès côté serveur, un épisode SSH/TLS). Aucun secret, mais des informations utiles à un attaquant. À relire avant publication, à décider par le PO.
- Aucune capture de données de joueurs repérée (les PNG de `docs/` et `art-sol/` n'ont pas été relus un à un ; `art-sol/` date de septembre, avant l'alpha). Les e-mails et pseudos de joueurs réels n'ont pas été cherchés dans les PNG.
- L'adresse e-mail de l'auteur apparaît dans les métadonnées de commit.

## 6. Recommandations

### Avant de poser les licences (bloquant)

1. Récupérer `LICENSE` (texte officiel AGPL-3.0, gnu.org), sans modification.
2. Faire confirmer par leurs auteurs (JMP, Perlin) la licence de `arbestra-loading.png` et `perlin-tag.png`, sinon les retirer ou les remplacer ; sinon exclure explicitement de CC BY-NC-SA dans `LICENSE-CONTENT.md`.
3. Décider du sort de `art-sol/` (historique, 2,6 Mo, aucune valeur de spec) : le garder avec une mention de provenance IA, ou l'exclure du dépôt public.
4. Relire `docs/DEPLOIEMENT-VPS.md`, `ops/` et `docs/old/` pour l'exposition d'exploitation et les chemins personnels.
5. Relire les mots de passe de fixtures (`seed.ts`, scripts de navigateur) et confirmer qu'ils sont purement locaux.
6. Faire valider par un juriste le point CC BY-NC-SA sur contenus IA, la compatibilité du « NC » avec l'objectif de l'alpha payante éventuelle, et le dépôt de la marque « Arbestra ».

### Peut attendre

- Fichier `THIRD-PARTY-NOTICES` généré depuis les licences JavaScript (ou lien vers elles).
- En-têtes SPDX par fichier : à proposer seulement (`// SPDX-License-Identifier: AGPL-3.0-or-later`), non posés ici. Le champ `license` des `package.json` suffit pour démarrer.
- Politique de contribution (CLA ou DCO) : le PO est aujourd'hui seul détenteur du code. Les contributions externes à une licence AGPL le rendent plus difficile à relicencier ensuite.
- AGPL-3.0 « only » ou « or later » : proposition **or-later**, car c'est la forme recommandée par la FSF, elle ne coûte rien tant que le PO détient seul les droits (il peut changer de position avant d'accepter des contributions) et elle évite un blocage si une version 4 corrige un défaut. Choisir « only » si le PO veut garder la main sur le choix des versions futures. Les `package.json` portent `AGPL-3.0-or-later` à titre de brouillon ; changer un seul mot au besoin.
- Section « Licence » du README : brouillon à reformuler quand le PO a validé.
- Historique git : 572 commits sous deux identités personnelles ; si le dépôt n'est pas déjà public, vérifier qu'aucune donnée n'est indésirable dans l'historique avant de l'ouvrir (non exhaustif ici).

## Ce que ce document ne couvre pas

Aucun audit de l'historique git au-delà de ces recherches ciblées ; PNG, GLB et BLEND non inspectés visuellement ni par métadonnées ; conditions d'utilisation des fournisseurs d'IA non consultées ; noms de JMP, Marie, Perlin non éclaircis (ce sont des personnes du cercle de Tristan, pas des auteurs avérés des fichiers).
