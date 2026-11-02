# Nouveautés présentées par l'Oracle

Statut : décisions **validées** par Tristan le 2 novembre 2026 ; **implémentée le 2 novembre, à valider** (migration 081 appliquée sur dev, tests ciblés verts, recette navigateur et relecture des textes par Tristan restantes). À livrer avant la recette alpha avec plusieurs testeurs.

## Besoin

Après un déploiement, un joueur qui revient dans son village apprend ce qui a changé depuis sa dernière visite, dans une modale, sans aller lire un document technique.

## Décisions validées (2 novembre 2026)

| Sujet | Décision |
| --- | --- |
| Contenu | Fichier versionné avec le client (`changelog.json` ou équivalent), pas de table de contenu en base. Il part avec le déploiement et se relit dans le commit. |
| Granularité | Une entrée par version `alpha-*` : identifiant (le tag), date, 2 à 5 points (titre court, une phrase). Texte pour joueurs, distinct de [CHANGELOG-ALPHA.md](CHANGELOG-ALPHA.md), qui reste technique. |
| Voix | Celle de l'**Oracle**, comme ses notifications en jeu (« Oracle — Votre première récolte ! Ces carottes-là, vous les avez méritées. ») : malicieuse, brève, jamais technique (ni migration, ni synchro, ni nom de code). |
| Ce qui a été vu | Côté serveur, par compte : une colonne `last_seen_release` (migration additive), pour suivre le joueur d'un appareil à l'autre. |
| Affichage | Au chargement du village, si la dernière version du fichier est plus récente que `last_seen_release`, la modale montre toutes les versions manquées, la plus récente en haut. « Compris » enregistre la version vue. |
| Nouveau joueur | Pas d'historique : sa version vue est la version courante à la création du compte (ou à sa première visite si la colonne est vide). |
| Moment | Le 426 (« Une nouvelle version d'Arbestra est disponible. Rechargez la page. ») amène le rechargement ; la modale vient juste après. |

## Hors scope

- Annonces sans déploiement (maintenance, événement) : besoin distinct, éventuellement une table plus tard.
- Édition du contenu depuis une interface d'administration.

## Implémentation (choix de l'agent, 2 novembre)

### Contenu

- **Où** : `packages/contracts/src/release-notes.ts` (`RELEASE_NOTES`, tableau TypeScript typé, la plus récente **en premier**). Dans `contracts` plutôt que dans le client parce que l'API doit connaître la dernière version (compte neuf) et valider l'identifiant qu'on lui envoie ; le client et l'API sont déployés ensemble, donc le même fichier fait foi des deux côtés. Un `.ts` plutôt qu'un `.json` évite d'avoir à faire copier un fichier de données par `tsc`. Il part avec le déploiement et se relit dans le commit.
- **Ordre** : l'ordre du tableau fait foi pour « plus récent que » ; aucune comparaison de dates ni de texte (`…09.10` est bien plus récent que `…09.9`). `releases.ts` porte la logique (`releasesToShow`, `releaseNotice`, `mostRecentSeenRelease`) ; ses tests vérifient aussi le contenu publié (2 à 5 points, titre et phrase non vides et bornés, identifiants distincts et au format du tag, date égale à celle du tag, du plus récent au plus ancien).
- **Version de départ** (`RELEASE_BASELINE_ID = 'alpha-2026.11.01.1'`) : l'alpha qui précède la première entrée. C'est le seul identifiant connu sans figurer dans le tableau ; il est plus ancien que toutes les entrées. Ne jamais la changer (elle fait partie de la migration 081).
- **Identifiant inconnu** : un compte dont la version vue n'est pas dans le tableau (ni la version de départ) ne reçoit **rien** plutôt que tout l'historique. Cas réels : un déploiement revenu en arrière, un client plus ancien que le compte.

### Base

- Migration **081** (additive, sens inverse fourni) : `accounts.last_seen_release text` nullable, contrainte `length between 1 and 40`, pas d'index (lecture par la clé primaire seulement). Elle initialise **tous les comptes existants** à `alpha-2026.11.01.1` : les joueurs alpha déjà inscrits lisent la première entrée à leur prochaine visite.
- **Compte neuf** : `register()` (`modules/auth/service.ts`) écrit la dernière version du tableau à la création, dans la même transaction que le compte. Une valeur **NULL** reste possible (comptes insérés hors de la route d'inscription : graines, fixtures de test) ; le client la remplit alors **en silence** au premier chargement du village (version courante, sans modale). Les deux chemins sont conservés : le premier est exact (un compte créé en version N voit les versions suivantes), le second rattrape ce que le premier ne couvre pas.

### API

- **Lecture** : `account.lastSeenRelease` (`string | null`) dans `SessionResponse`, donc dans `GET /api/auth/session`, `POST /api/auth/login` et `POST /api/auth/register` ; `authenticate()` le sélectionne dans la requête qu'il fait déjà.
- **Écriture** : `POST /api/account/seen-release`, corps `{ "releaseId": "alpha-AAAA.MM.JJ.N" }` (chaîne bornée à 40 caractères, au format d'un tag), réponse `{ "lastSeenRelease": "<valeur conservée>" }`. Authentifiée par le cookie de session (401 sans session) ; ce n'est pas une commande de village, donc sans en-tête de protocole V2 (`client-protocol.ts` n'est pas concerné).
  - **Idempotente et sans retour en arrière** : sous verrou de la ligne du compte, la valeur conservée est la plus récente de l'ancienne et de la nouvelle, selon l'ordre du tableau. Une requête tardive d'un vieil onglet ne fait pas reculer le compte ; une valeur déjà stockée que ce déploiement ne connaît pas (plus récente) est gardée telle quelle.
  - **Refus** : 400 `VALIDATION_ERROR` (corps invalide ou hors format), 400 `UNKNOWN_RELEASE` (bien formé, mais jamais publié par ce déploiement). Fastify retire les propriétés en trop sans les refuser, comme partout dans l'application.

### Client (`apps/world-web`)

- `ui/use-release-notes.ts` lit le compte **une fois** (`GET /api/auth/session`) quand le village est prêt **et** que rien d'autre ne tient l'écran : `initialReady && !starter && !needsLogin && !villageLost && !arrivalActive` dans `App.tsx`. Pas pendant l'écran de chargement, pas pendant l'arrivée (cinématique) ni pendant la pose du kit de départ (`starter` : la modale ne couvre jamais le tutoriel d'un nouveau joueur), pas sur l'écran « Connexion au village impossible ». Si l'arrivée démarre pendant que la modale est lue, elle reste cachée jusqu'à la fin de l'arrivée.
- `ui/ReleaseNotesDialog.tsx` : la boîte dorée de l'Oracle (classes `oracle-provisions-overlay` + `oracle-news`, voile `oracle-news-backdrop` qui bloque la scène), `role="dialog"` et `aria-modal`, focus sur « Compris » à l'ouverture et rendu à la scène à la fermeture, Tab reste dans la boîte (liste défilante focalisable puis bouton), aucune touche tapée dedans n'atteint les raccourcis du jeu. Versions du plus récent au plus ancien, chacune avec sa date (« 2 novembre 2026 ») et ses points.
- **« Compris »** ferme la modale **tout de suite** puis enregistre la plus récente version montrée (la réponse n'est pas attendue : un échec réseau ne fait que ramener la modale au chargement suivant). **Échap = « Compris »** (choix de l'agent : une modale qui revient à chaque chargement parce qu'on l'a fermée au clavier serait irritante).
- Toute erreur de lecture ou d'écriture est ignorée sans message : les nouveautés sont un confort, jamais un obstacle.
- Aucune dépendance nouvelle.

## Textes (première entrée, `alpha-2026.11.02.1`, à relire par Tristan à la recette)

L'identifiant `alpha-2026.11.02.1` est celui **supposé** du prochain tag : **à ajuster dans `release-notes.ts` (identifiant et date) si le tag posé est différent**. Un test vérifie que la date de l'entrée est bien celle de l'identifiant.

Contenu : ce qu'un joueur perçoit depuis `alpha-2026.11.01.1` (défrichage, réactivité, marché, écran de connexion, cette fenêtre).

1. **Le défrichage a pris de la vitesse** : « Un habitant vient à bout d’une souche en une minute. Les racines ont fini par comprendre qu’il ne lâcherait pas. »
2. **Des nouvelles plus vives** : « Vos ordres, vos récoltes et vos expéditions se répercutent plus vite : j’ai cessé de faire patienter les messagers dans l’antichambre. »
3. **Un marché qui se tient au courant** : « La liste des offres se met à jour toute seule. Inutile de rouvrir la fenêtre pour apprendre que quelqu’un a acheté avant vous. »
4. **Quand le village ne répond plus** : « Si le silence dure environ une minute, je vous le dis et je vous propose de réessayer ; si votre page est trop ancienne, je vous demande de la recharger. »
5. **Cette fenêtre** : « Désormais, je vous raconte ce qui change à chaque nouvelle version. Vous pouvez me remercier, mais sans insister. »

Chapeau de la modale (dans le composant, pas dans le contenu) : « L’Oracle — Le village a changé depuis votre dernière visite. Je vous raconte. » ; bouton « Compris ».

## Procédure au tag

1. Avant de poser un tag `alpha-*` qui change quelque chose pour les joueurs : ajouter **en tête** de `RELEASE_NOTES` (`packages/contracts/src/release-notes.ts`) une entrée `{ id: '<nom exact du tag>', date: 'AAAA-MM-JJ', items: [...] }`, 2 à 5 points, titre court et une phrase, dans la voix de l'Oracle (malicieuse, brève, jamais technique). Partir de [CHANGELOG-ALPHA.md](CHANGELOG-ALPHA.md) en ne gardant que ce qu'un joueur perçoit.
2. Ne jamais retirer, renommer ni réordonner une entrée déjà déployée (les comptes l'ont peut-être vue). Un tag sans effet visible (technique pur) n'a pas besoin d'entrée.
3. `corepack pnpm exec vitest run packages/contracts/src/releases.test.ts` vérifie le format ; le commit du tag contient l'entrée.
4. Les environnements de test et de développement partagent la même liste : la première visite d'un compte vu à la version de départ y affiche la modale ; pour la revoir sur dev, remettre `last_seen_release` du compte à la version voulue.

## Preuves (2 novembre)

- `packages/contracts/src/releases.test.ts` (13) : ordre, identifiant inconnu, aucune nouveauté, plusieurs versions manquées, version de départ, `…09.10` contre `…09.9`, valeur qui ne recule pas, validation du corps, forme du contenu publié.
- `apps/api/src/modules/auth/release-notes.integration.test.ts` (7, base de test) : compte neuf initialisé à l'inscription et lu par session/connexion, lecture `null` et valeur, enregistrement, idempotence, non-recul, compte sans version qui prend la sienne, 401 sans session ou avec session inconnue, 400 corps invalide, 400 version inconnue, contrainte de la colonne, migration 081 (comptes existants initialisés à la version de départ, sens inverse, base laissée intacte). Sensibilité vérifiée : remplacer la règle « le plus récent » par une simple écriture fait échouer le test de non-recul.
- Client : `ui/ReleaseNotesDialog.test.ts` (3), `ui/use-release-notes.test.ts` (4 : montrer, rien à montrer, enregistrement silencieux, erreurs), `api/release-notes.test.ts` (4).
- Dev local : migration 081 appliquée (7 comptes initialisés à `alpha-2026.11.01.1`) ; routes vérifiées avec le compte de graine (session, 401, 400 corps invalide, 400 version inconnue, enregistrement valide ; valeur du compte remise à `alpha-2026.11.01.1` ensuite pour que la modale s'affiche à la recette).

## À valider à la recette (navigateur, non fait)

- Sur dev, avec un compte à `alpha-2026.11.01.1` (le compte de graine `player@arbestra.local` et les autres comptes de dev y sont) : la modale s'affiche une fois le village prêt, **après** la cinématique d'arrivée, jamais pendant le chargement ; « Compris » et Échap la ferment ; après rechargement elle ne revient pas, ni depuis un autre appareil.
- Un compte neuf (inscription puis kit de départ) : aucune modale, ni pendant le kit ni après.
- Rendu (largeur téléphone, défilement s'il y avait plusieurs versions), focus et clavier (Tab, Entrée, Échap) ; les textes (voix de l'Oracle).
- Limite connue : le moment exact entre la fin du chargement et le début de l'arrivée n'a pas été observé ; le garde `!arrivalActive` cache la modale si l'arrivée démarre juste après.
