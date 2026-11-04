# Contribuer à Arbestra

> **In short (English).** Arbestra is a persistent web strategy game (React + Babylon.js client, Fastify + PostgreSQL server), developed mostly by one person with AI agents, and now open to human help. Beginners are welcome. The docs and the in-game text are in **French**; code identifiers, code comments and commit messages are in **English**. You do not need to write French to contribute code: open an issue or a pull request in English if you prefer, we will manage. Gameplay decisions belong to the product owner (Tristan): open an issue first for anything that changes how the game plays. Then fork, branch from `main`, open a pull request, and keep the CI green. Code is licensed AGPL-3.0-or-later, non-software content (art, text, lore) CC BY-NC-SA 4.0; by contributing you offer your work under the matching licence (see [Licences et contributions](#licences-et-contributions)). The French text below is the reference.

## Bienvenue

Arbestra est un jeu de stratégie en ligne, persistant, qui se joue dans le navigateur : on fait grandir un village sur un monde partagé (voir le [README](README.md)). Il est construit par Tristan, le product owner (PO), qui travaille seul avec des agents d'IA. Il cherche maintenant de l'aide humaine, et voudrait aussi que le dépôt serve à ceux qui débutent et se demandent « comment fait-on un jeu, pour de vrai ? ».

Tu n'as pas besoin d'être expert. Corriger une faute dans un texte, lire une spec et signaler ce qui n'est pas clair, essayer le jeu sur ton téléphone, écrire un petit test, tout cela compte. Si tu débutes, commence par le [parcours de lecture](docs/APPRENDRE.md) et les [bons premiers tickets](docs/BONS-PREMIERS-TICKETS.md) (la liste à jour est sur GitHub, avec l'étiquette `bon premier ticket`).

## Langues : français et anglais

- **Documentation, interface du jeu, textes de l'Oracle, lore** : en français.
- **Code, noms de variables et de fonctions, commentaires de code, messages de commit** : en anglais.
- Les titres d'issues et de PR peuvent être en français ou en anglais. Si le français est un obstacle, écris en anglais : on te répondra.

## Installer le projet en local

Objectif : un jeu qui tourne chez toi en une quinzaine de minutes, téléchargements compris. Tout vient du [README](README.md), du [guide développeur](docs/GUIDE-DEVELOPPEUR.md) et de `package.json` ; rien n'est ajouté.

**Il te faut** : Node.js 24 ou plus, Corepack (livré avec Node 24 ; il fournit pnpm, d'où les commandes `corepack pnpm …`), et PostgreSQL 17. Le dépôt fournit un PostgreSQL prêt à l'emploi par Docker (`compose.yaml`) : c'est le plus simple si tu as Docker.

1. **Récupérer le code.** Fork le dépôt `NazzTazz/Arbestra` sur GitHub, puis clone ton fork.
2. **Installer les dépendances.**

   ```sh
   corepack pnpm install
   ```

3. **Créer ta configuration locale.** Le serveur lit le fichier `.env` à la racine ; le dépôt propose `.env.example` (valeurs prévues pour le PostgreSQL de `compose.yaml`). Le README crée `.env.dev` puis un lien `.env` vers lui :

   ```powershell
   # Windows (PowerShell), comme dans le README
   Copy-Item .env.example .env.dev
   New-Item -ItemType SymbolicLink -Path .env -Target .env.dev
   ```

   ```sh
   # Équivalent Linux / macOS
   cp .env.example .env.dev
   ln -s .env.dev .env
   ```

   Ces fichiers ne sont pas versionnés (le `.gitignore` les écarte). Ne mets jamais de secret dans un fichier suivi par git.

4. **Démarrer PostgreSQL** (si tu utilises Docker), puis **créer le schéma et les données de départ** :

   ```sh
   corepack pnpm db:up
   corepack pnpm db:setup
   ```

   `db:setup` applique les migrations puis réensemence la base : c'est la commande du **premier** démarrage, pas celle des démarrages suivants (voir plus bas).

5. **Lancer le jeu.**

   ```sh
   corepack pnpm dev
   ```

   - Lobby : <http://localhost:5173>
   - Monde : <http://localhost:5174/village>
   - Console d'exploitation (NOC) : <http://localhost:5175> (réservée aux comptes explicitement autorisés ; tu n'en as pas besoin pour contribuer).
   - Compte de développement : `player@arbestra.local` / `arbestra` (il n'existe que dans ta base locale).

   Le premier chargement du monde peut prendre un moment (terrain, bâtiments) ; les suivants sont plus rapides.

**Les jours suivants**, lance seulement `corepack pnpm dev`. N'exécute plus `db:setup` sur une base qui contient déjà ta partie : il réensemence. Si le schéma a changé après une mise à jour du code, `corepack pnpm db:migrate` applique les nouvelles migrations sans toucher aux données.

### Lancer les tests

Les tests qui touchent la base utilisent une base **séparée**, dont le nom doit finir par `_test` (le code refuse toute autre base, par sécurité). Une fois, crée-la et prépare-la :

```sql
create database arbestra_test owner arbestra;
```

(Avec le PostgreSQL de `compose.yaml`, cette commande SQL se passe dans le conteneur : `docker compose exec postgres psql -U arbestra -d arbestra -c "create database arbestra_test owner arbestra;"`.)

```sh
cp .env.test.example .env.test      # Windows : Copy-Item .env.test.example .env.test
corepack pnpm db:test:setup
corepack pnpm --filter @arbestra/contracts build
corepack pnpm exec vitest run <fichier> -t '<nom du test>'
```

- **Un test ciblé** (le réflexe de tous les jours) : construis d'abord le paquet `contracts`, puis `vitest run` sur un fichier, éventuellement filtré par `-t`. Évite `corepack pnpm test -- <fichier>` : le script racine enveloppe la commande et le filtre n'est pas transmis comme on l'attend.
- **Toute la suite** : `corepack pnpm test`. Elle est longue en local (le guide parle d'une trentaine de minutes) ; la CI la rejoue pour toi en quelques minutes. Contente-toi des tests ciblés en local.
- **Ne lance jamais deux suites qui touchent la base en même temps** : elles réinitialisent la même base de test et se détruisent mutuellement.
- Autres contrôles : `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm build`, `corepack pnpm test:e2e` (Playwright, navigateur).

Ne réinitialise **jamais** ta base de développement pour faire passer un test : `db:test:setup` vise la base de test, `db:setup` ne doit pas être relancé à la légère.

Les détails (organisation du code, commande de bout en bout, pièges connus) sont dans le [guide développeur](docs/GUIDE-DEVELOPPEUR.md).

## Où regarder

| Tu cherches… | Va voir |
|---|---|
| Ce qui est prévu, dans quel ordre | [Feuille de route](docs/ROADMAP.md) : ordre proposé et dépendances, réordonnable par Tristan. |
| L'état du travail en cours | [SESSION-HANDOFF.md](SESSION-HANDOFF.md) : index court, une ligne par chantier. |
| Les règles durables du code | [Index d'architecture](docs/architecture/README.md). |
| Comment une fonctionnalité doit se comporter | Les specs `docs/SPEC-*.md`. Une spec décrit une **cible**, pas forcément ce qui est déjà livré : le code fait foi pour l'existant. |
| Ce qui est connu comme imparfait | [Registre de dette technique](docs/DETTE-TECHNIQUE.md). |
| L'esprit du jeu | [Direction produit](docs/DIRECTION-PRODUIT.md) et le [lore](docs-lore/TRY-SAMSARA.md). |
| Comment tout cela est construit | [Parcours de lecture pour débutants](docs/APPRENDRE.md). |
| Des idées pour commencer | Les tickets `bon premier ticket` et `aide bienvenue` sur GitHub ; brouillons dans [docs/BONS-PREMIERS-TICKETS.md](docs/BONS-PREMIERS-TICKETS.md). |

## Comment proposer un changement

1. **Cherche d'abord** si une issue existe déjà sur le sujet.
2. **Ouvre une issue avant tout ce qui touche au gameplay** : ressources, durées, règles, nouvelles mécaniques, équilibrage, ce que le joueur voit ou décide. **C'est Tristan qui tranche le gameplay.** Une PR qui change une règle de jeu sans accord préalable sera probablement refusée, même bien faite ; ce serait dommage pour ton temps. Les modèles d'issue (bug, idée de gameplay) t'aident à écrire ta demande.
3. **Pour un bug, une amélioration technique, de la documentation ou un correctif visuel évident**, tu peux ouvrir directement une PR, mais une issue courte d'abord évite les doublons. Pour un gros changement, discute-en avant d'écrire du code.
4. **Fork, puis une branche par sujet**, créée à partir de `main` à jour (par exemple `fix/mobile-render-scale`).
5. **Fais de petits commits**, avec un message en anglais, une ligne, à l'impératif, dans le style de `git log --oneline` (par exemple `Fix the Android render resolution`).
6. **Ouvre une PR vers `main`.** Le modèle de PR te guide : quoi, pourquoi, comment tu l'as vérifié, captures si c'est visuel.
7. **Attends une CI verte.** Elle contrôle le formatage, le lint, le typecheck et toute la suite de tests. Une PR dont la CI est rouge n'est pas relue en détail ; si le rouge te semble sans rapport avec ton changement, dis-le dans la PR.
8. **Relecture.** Tristan ou un agent relit, demande parfois des changements. Rien de personnel : même le code de Tristan est relu.

Les tranches de travail (d'une idée à une livraison) suivent le [workflow des tranches](docs/AGENT-WORKFLOW.md). Tu n'as pas à le suivre en détail pour une petite contribution, mais il explique le vocabulaire (« tranche », « à valider », « spec »).

## Conventions

Elles viennent de [AGENTS.md](AGENTS.md), en version humaine.

- **Une tranche bornée.** Fais une chose à la fois. Pas de refactor général « au cas où », pas de système construit parce qu'une future fonctionnalité l'utilisera peut-être.
- **Le serveur décide.** Le client (React, Babylon) affiche et envoie des demandes ; il ne décide jamais des ressources ni des autorisations. Toute donnée du monde porte son `world_id`.
- **Un bug se corrige avec un test.** Écris d'abord un test qui échoue pour la bonne raison, puis la correction. Il vérifie un résultat de jeu, pas un détail interne.
- **Tests ciblés** : lance les tests des fichiers que tu touches et ceux qui y sont liés, pas toute la suite en boucle. La CI fait le reste. Ne dis pas « ça passe » avant que la commande ait réellement terminé avec succès, et distingue ce que tu as lu, déduit, reproduit et vérifié.
- **Format** : `corepack pnpm format` avant de committer (Prettier, 120 colonnes, guillemets simples). `corepack pnpm format:check` vérifie sans modifier. Ne reformate pas de fichiers que tu ne modifies pas : un reformatage de masse a son propre commit.
- **Migrations de base de données** : seulement **additives** (une nouvelle migration `NNN_*.ts`). Une migration déjà déployée ne se réécrit jamais ; une correction est une nouvelle migration. Les numéros sont strictement ordonnés.
- **Aucun secret** dans le dépôt : pas de mot de passe, de jeton, de contenu de fichier `.env`. Les fichiers `.env*` sont déjà ignorés par git ; garde-les ainsi.
- **Aucun artefact de test commité** : rapports Playwright, `test-results/`, captures de tests, bases locales, sauvegardes. Regarde `git status` avant `git add`, et ajoute les fichiers un par un plutôt que `git add .`.
- **Performance** : le jeu doit rester fluide. Si tu touches du code exécuté à chaque image ou à chaque pas (scène, villageois, terrain, trajets), mesure dans le navigateur, sur le parcours réel, **avant et après**, et mets les chiffres dans la PR. Budgets : village prêt en moins de 15 s (caches chauds) ; aucune image de plus de 100 ms une fois le village prêt ; mise à jour des villageois sous 2 ms par image (p95). Un crochet appelé à chaque image est en O(1) ou indexé, avec un test qui borne le nombre de ses appels. Le [guide développeur](docs/GUIDE-DEVELOPPEUR.md) (§6, « Campagne de mesures ») explique comment mesurer.
- **Visuel et mobile** : un changement visible se vérifie dans un navigateur, pas seulement par les tests. Joins des captures.
- **Textes joueur** : ton malicieux et bref, jamais technique (c'est la voix de l'Oracle). Voir les nouveautés de l'[alpha](docs/CHANGELOG-ALPHA.md) pour le ton.

## Humains et agents d'IA dans le même dépôt

Une grande partie du code a été écrite par des agents d'IA, pilotés par Tristan. Pour que tout le monde (humain ou agent) travaille avec les mêmes règles :

- [AGENTS.md](AGENTS.md) est le **mode d'emploi du dépôt**, lu par les agents à chaque reprise ; il est utile aux humains aussi. Si une règle de ce `CONTRIBUTING.md` et celle d'`AGENTS.md` se contredisent sur un point technique, signale-le dans une issue.
- [SESSION-HANDOFF.md](SESSION-HANDOFF.md) est le **passage de relais** : une ligne par chantier, avec son statut et un lien vers la spec. Les preuves détaillées vivent dans les specs et dans les messages de commit, pas dans ce fichier. Si ta PR termine ou fait avancer un chantier listé, ajoute ou ajuste **une seule ligne** ; sinon, n'y touche pas.
- Les statuts (**proposé**, **validé**, **à valider**, **ouvert**, **hors scope**) ont un sens précis ; voir le [workflow](docs/AGENT-WORKFLOW.md). Une livraison reste « à valider » tant que Tristan n'a pas fait sa recette.
- Tu peux t'aider d'un assistant d'IA pour contribuer. Tu restes responsable de ce que tu proposes : relis-le, comprends-le, teste-le, et dis-le dans la PR si une part importante a été générée.
- Le travail en cours se montre sur le dev local ; l'alpha publique ne reçoit que des tranches terminées et validées.

## Licences et contributions

- Le **code** est sous licence **GNU AGPL v3.0 ou ultérieure** (`AGPL-3.0-or-later`) : voir [LICENSE](LICENSE).
- Les **contenus non logiciels** (graphismes, textures, modèles 3D, sons, lore, textes du jeu et de l'Oracle) sont sous licence **Creative Commons BY-NC-SA 4.0** : voir [LICENSE-CONTENT.md](LICENSE-CONTENT.md).
- Le nom et le logo « Arbestra » ne sont concédés par aucune de ces licences.

Il n'y a **pas de CLA** (pas de papier à signer, tu gardes tes droits). À la place, une phrase simple, dans l'esprit du *Developer Certificate of Origin* : **en ouvrant une pull request, tu déclares avoir le droit de proposer ce travail, et tu l'offres sous la licence du dépôt qui correspond à sa nature : AGPL-3.0-or-later pour le code, CC BY-NC-SA 4.0 pour les contenus non logiciels.** Le modèle de PR te demande de le cocher. Tu peux aussi l'attester dans tes commits avec `git commit -s`, qui ajoute une ligne `Signed-off-by: Ton Nom <ton@email>`.

N'apporte rien que tu n'aies pas le droit de partager : pas de code copié d'un projet à licence incompatible, pas d'image, de modèle ou de son tirés d'ailleurs sans que la licence le permette (et sans le dire dans la PR, pour que l'[inventaire des licences](docs/INVENTAIRE-LICENCES-2026-11-04.md) reste juste). Les contenus générés par IA relèvent de la même règle d'honnêteté : dis-le.

## Sécurité

Si tu trouves une faille, suis la consigne de [SECURITY.md](SECURITY.md) (une issue avec l'étiquette `security`) et n'y mets pas les détails exploitables : décris le problème sans la recette pour l'utiliser.

Merci d'être là.
