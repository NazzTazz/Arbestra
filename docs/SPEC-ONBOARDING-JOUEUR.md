# Onboarding joueur — première tranche

Date : 7 octobre 2026. Base relue : `main`, dernier commit `f9fc28d`, avec travaux locaux antérieurs conservés.
Statut : **implémentée, validation navigateur en cours**.

## Résultat et décisions validées

Le joueur s’inscrit dans le lobby, choisit un monde ouvert, nomme son personnage et son village, puis entre en vue Village. Recharger avant la création conserve le compte ; réessayer après une réponse perdue retrouve le village créé. Cette tranche permet le premier village par compte et monde.

Tristan a conçu le modèle sur `start@arbestra.world` et ajouté son Jardin avant export. La recette relative est figée dans `apps/api/src/modules/onboarding/starter-village.ts` : mairie niveau 1, trois maisons en troncs niveau 1, Jardin niveau 1 sur trois parcelles, 35 gestes de chaussée et 15 équipements d’éclairage, orientations et réglages lumineux compris. Les modifications ultérieures du compte de conception ne changent pas implicitement les créations.

État initial explicitement validé : **15 habitants disponibles, 2 000 bois brut, 50 carottes, zéro autre ressource ; coffre de mairie non ouvert avec 2 000 carottes ; chaque parcelle de Jardin au tiers de sa capacité**. Les 999999 du compte de conception, ses missions, son historique, ses identifiants et ses accomplissements ne sont pas copiés.

## Contrats et autorité

- `POST /api/auth/register` : e-mail, mot de passe de 8 à 128 caractères ; compte et session atomiques, mot de passe scrypt salé, cookie identique à la connexion existante, e-mail normalisé. Doublon : 409.
- `GET /api/worlds` authentifié : mondes `ready`, appartenance au village et présence de clairières protégées libres. Aucun détail de clairière exposé.
- `POST /api/worlds/:worldSlug/join` authentifié : noms du personnage (40 caractères) et du village (60), au moins un caractère non blanc ; réponse `{ villageId }`. Le serveur choisit les coordonnées et tous les stocks.

L’existence d’une clairière libre dans la liste n’est pas une garantie de compatibilité du modèle : la commande vérifie la géométrie réellement requise. Elle examine au plus 600 candidates protégées, ignore celles occupées ou incompatibles et ne supprime aucune feature. Sans emplacement : 409 `NO_STARTER_LOCATION` ; monde indisponible : 409 `WORLD_NOT_READY`.

## Transaction, verrous et temps

La transaction verrouille le compte, puis choisit une clairière avec `FOR UPDATE SKIP LOCKED`. La membership précède le nouveau village conformément à sa clé étrangère. La ligne du village précède le verrou spatial exclusif `infrastructure:<worldId>`, partagé avec les écritures de navigation existantes. Aucun autre village n’est verrouillé. La borne `statement_timestamp()` est lue après ces verrous.

Un savepoint annule membership et village provisoires si l’emplacement échoue, avant d’essayer une autre clairière. Après validation : attribution, ressources, flux, bâtiments achevés et occupations, coffre, buffers et parcelles, plan de chaussée, population et cohorte disponible sont créés ensemble. Toute erreur annule le tout. Les ressources ajoutées par les triggers existants sont initialisées par upsert. Le verrou de compte rend les requêtes répétées idempotentes, sans réinitialiser les stocks ou les noms d’un village existant.

Les coordonnées de bâtiment, sous-cellules de chaussée, équipements et références d’éclairage sont translatées et canonicalisées sur le tore. Chaque bâtiment, geste et équipement reçoit un nouvel UUID ; révision et réserve du plan repartent à zéro. Les règles de production, construction, coffre et économie existantes restent responsables des actions ultérieures.

## Vérification et reprise

- `onboarding.integration.test.ts` : inscription/session, validation, initialisation métier et coffre unique, refus atomique, collision conservant le gisement et isolation des comptes, rollback après erreur injectée attestant bâtiments/ressources/attribution déjà écrits, concurrence avec attente advisory PostgreSQL observée.
- `starter-layout.test.ts` : continuité des surfaces au passage du tore, éclairage, identités distinctes et source inchangée.
- `node --import tsx tests/browser/onboarding.mjs` : fixtures isolées dans `arbestra_test`, aucun reset ni mutation du développement ; serveurs de test sur 3100/5273/5274, inscription, reprise avant spawn, création, vrai rendu Babylon instancié, retry, déconnexion/reconnexion, desktop et mobile. Nettoyage des seules fixtures et arrêt des seuls serveurs créés. Ne pas lancer avec une autre suite utilisant cette base.
- Mise à jour explicite du modèle : `node --import tsx scripts/export-starter-village.mjs`, lecture seule de la base locale `arbestra`, exige bâtiments et extensions achevés. Relire le diff de recette avant utilisation.

Les résultats exécutés et captures sont consignés dans la tête de `SESSION-HANDOFF.md` ; les artefacts navigateur restent dans `test-results/`, ignoré par Git.

## Limites bornées

Aucune migration nouvelle. Pas de colonisation d’un deuxième village dans le même monde, de TRY, d’envoi de mails, de validation d’adresse ni de récupération de mot de passe dans cette tranche. La limitation de tentatives est locale au processus (5 inscriptions par IP sur 15 minutes) ; derrière le proxy de développement, les appareils partagent son IP. Les critères d’ouverture publique et d’hébergement restent distincts de ce parcours local.
