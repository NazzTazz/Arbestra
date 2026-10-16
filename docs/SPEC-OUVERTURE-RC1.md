# Ouverture des premiers mondes RC1 sur VPS

16 octobre 2026 — base `main` / `d3d18d6` — **clôturée : deux mondes ouverts et vérifiés**.

Tristan autorise un monde ouvert en alpha et un en staging, utilisant la géométrie RC1 approuvée, avec inscription et installation des nouveaux joueurs. Les comptes et données restent indépendants. Noms retenus pour cette opération : **Arbestra Alpha**, slug `alpha-rc1` ; **Arbestra Bêta**, slug `beta-rc1`. Aucun village local n'est importé.

Le serveur accepte déjà l'inscription publique, la liste des mondes ouverts, l'atlas et l'installation transactionnelle RC1. Le générateur général refuse encore l'ouverture de candidats v3. Les lecteurs RC1 exigent les dimensions 512 × 256, le chunk de 32 et la signature canonique déclarée dans `spawn-compute-protocol.ts`. Un terrain de mêmes dimensions n'est donc pas suffisant.

La tranche ajoute une commande **serveur uniquement**, `node dist/open-rc1-world.js --owner-account-id UUID --slug SLUG --name NAME --artifact PATH`. Elle vérifie la signature calculée de l'artefact approuvé, l'existence du compte auteur et la validité des identifiants. Une transaction crée le monde, son artefact conservé et sa présentation, puis l'ouvre. Un verrou par slug sérialise cette opération. La relance sur la même identité est idempotente et conserve présentation et données des joueurs ; toute collision avec un autre monde est refusée. L'artefact source est conservé intégralement. Aucun privilège n'est attribué à l'auteur, aucune autorisation par email et aucun endpoint de création publique n'est ajouté.

Le compte existant de Tristan sera utilisé en alpha ; Tristan choisit de s'inscrire lui-même en staging. Les migrations et données initiales du catalogue existent déjà. Chunks, ressources et compléments RC1 sont projetés par le parcours d'installation existant, sous ses verrous et validations habituels. Le garde d'ouverture générale v3 reste inchangé. Aucune génération d'un nouveau relief, modification du kit de départ ou recherche automatique d'un emplacement n'est ajoutée.

Vérifications attendues : création et lecture atlas sur base de test ; relance sans remplacement des données ; refus d'une autre géométrie, d'un auteur inexistant ou d'un slug occupé ; test connexe d'installation RC1. Après déploiement et sauvegarde de chaque base, ouverture des deux mondes avec la commande puis vérification HTTPS de la liste et du parcours atlas/installation, et recette navigateur. Tout compte/village de diagnostic doit être identifié et retiré sans toucher aux joueurs réels ; les modifications terrain propres à ce diagnostic doivent aussi être prises en compte. Aucun reset de base.

Hors périmètre : back-office de création de mondes, qualification générale des terrains v3, accès opérateur au générateur ou au NOC, import du monde de développement et augmentation des capacités du VPS.

## Livraison et preuves

Commit applicatif `dd7cce7`, [staging réussi](https://github.com/NazzTazz/Arbestra/actions/runs/38947615341), [alpha réussi](https://github.com/NazzTazz/Arbestra/actions/runs/38947998042), tag alpha `alpha-2026.10.16.2`. Sauvegarde avant chaque ouverture, pas de migration nouvelle ni de reset. Auteurs : comptes existants de Tristan dans leurs bases respectives, sans privilège ajouté.

| Environnement | Monde | Slug | UUID |
| --- | --- | --- | --- |
| Alpha | Arbestra Alpha | `alpha-rc1` | `45f81817-cad6-47f8-9e35-ec0dab16cff3` |
| Staging | Arbestra Bêta | `beta-rc1` | `e25c4a95-92fc-4ab5-95cf-07786195266b` |

Les deux mondes sont `ready`, ouverts, version 3, 512 × 256, seed 4109, checksum canonique `5e80042349e495c504900531c189bac1912795f65e739aee09f95bdcf452a9f0`.

Tests locaux : quatre cas de la nouvelle commande et un cas connexe d'installation complète RC1 verts, exécutés séquentiellement sur `arbestra_test`. Builds contracts/API et lint ciblé réussis ; builds complets et smoke tests de déploiement réussis sur GitHub. Aucun garde général v3 modifié.

Recettes HTTPS sur chaque environnement : inscription d'un compte temporaire, monde réel visible/joignable en mode atlas, diagnostic du kit sur le monde réel `planned`. Pour prouver la pose sans toucher au terrain des joueurs, création d'un monde de diagnostic RC1 distinct, pose du kit, relance idempotente et lecture du village. Résultat dans chaque base : cinq bâtiments, quinze habitants, 128 chunks et 2 018 groupes de ressources. Pose initiale mesurée à 15,05 s en staging et 15,78 s en alpha ; lecture suivante du village à 4,05 s et 3,88 s. Ces valeurs ponctuelles depuis le VPS ne sont pas un benchmark de charge ni un temps de rendu client. Mondes, modifications de terrain, comptes et sessions de diagnostic intégralement supprimés.

Recette navigateur staging : inscription via formulaire, choix du monde, saisie des noms, atlas affiché, sélection (140,20), passage à `/spawn`, terrain et aperçu du kit dans Babylon. Aucune erreur JS relevée ; captures atlas/préparation inspectées. Aucun bâtiment posé sur le vrai monde pendant cette recette UI ; son compte a été supprimé après fermeture du navigateur. L'alpha a reçu la même recette backend HTTPS, sans seconde recette UI complète. Contrôle final : un compte réel dans chaque base, aucun compte de diagnostic ; staging sans village, alpha avec un village réel déjà créé par le joueur et préservé. Services des deux environnements actifs. Aucune mesure FPS ou garantie de capacité sous charge ajoutée.
