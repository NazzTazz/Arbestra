# Ouverture des premiers mondes RC1 sur VPS

16 octobre 2026 — base `main` / `d3d18d6` — implémentation et recette en cours.

Tristan autorise un monde ouvert en alpha et un en staging, utilisant la géométrie RC1 approuvée, avec inscription et installation des nouveaux joueurs. Les comptes et données restent indépendants. Noms retenus pour cette opération : **Arbestra Alpha**, slug `alpha-rc1` ; **Arbestra Bêta**, slug `beta-rc1`. Aucun village local n'est importé.

Le serveur accepte déjà l'inscription publique, la liste des mondes ouverts, l'atlas et l'installation transactionnelle RC1. Le générateur général refuse encore l'ouverture de candidats v3. Les lecteurs RC1 exigent les dimensions 512 × 256, le chunk de 32 et la signature canonique déclarée dans `spawn-compute-protocol.ts`. Un terrain de mêmes dimensions n'est donc pas suffisant.

La tranche ajoute une commande **serveur uniquement**, `node dist/open-rc1-world.js --owner-account-id UUID --slug SLUG --name NAME --artifact PATH`. Elle vérifie la signature calculée de l'artefact approuvé, l'existence du compte auteur et la validité des identifiants. Une transaction crée le monde, son artefact conservé et sa présentation, puis l'ouvre. Un verrou par slug sérialise cette opération. La relance sur la même identité est idempotente et conserve présentation et données des joueurs ; toute collision avec un autre monde est refusée. L'artefact source est conservé intégralement. Aucun privilège n'est attribué à l'auteur, aucune autorisation par email et aucun endpoint de création publique n'est ajouté.

Le compte existant de Tristan sera utilisé en alpha ; Tristan choisit de s'inscrire lui-même en staging. Les migrations et données initiales du catalogue existent déjà. Chunks, ressources et compléments RC1 sont projetés par le parcours d'installation existant, sous ses verrous et validations habituels. Le garde d'ouverture générale v3 reste inchangé. Aucune génération d'un nouveau relief, modification du kit de départ ou recherche automatique d'un emplacement n'est ajoutée.

Vérifications attendues : création et lecture atlas sur base de test ; relance sans remplacement des données ; refus d'une autre géométrie, d'un auteur inexistant ou d'un slug occupé ; test connexe d'installation RC1. Après déploiement et sauvegarde de chaque base, ouverture des deux mondes avec la commande puis vérification HTTPS de la liste et du parcours atlas/installation, et recette navigateur. Tout compte/village de diagnostic doit être identifié et retiré sans toucher aux joueurs réels ; les modifications terrain propres à ce diagnostic doivent aussi être prises en compte. Aucun reset de base.

Hors périmètre : back-office de création de mondes, qualification générale des terrains v3, accès opérateur au générateur ou au NOC, import du monde de développement et augmentation des capacités du VPS.
