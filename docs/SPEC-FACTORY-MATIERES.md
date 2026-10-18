# Factory des matières

Suite du 18 octobre 2026 : la tranche [marché joueurs](SPEC-MARCHE-JOUEURS.md) réutilise ces présentations dans ses sélections et ajoute la recette visuelle `carrot` (racines orange et fanes vertes). Elle ne crée aucun nouveau stock : `carrot` était déjà catalogué. Recette technique du marché validée sur desktop et tactile ; voir le handoff courant.

12 octobre 2026 · base `main`, `be6532d`. **Maquette implémentée ; apparences à valider avec Tristan.**

## Périmètre et décisions

Tristan demande de réutiliser la factory pour designer Pierre brute, Pierre taillée, Bois brut, Rondins et Bois d’œuvre. Il confirme les **rondins avec écorce**. Les autres formes ci-dessous constituent une première proposition visuelle, pas une validation produit acquise.

| Modèle | Proposition de représentation | Stock existant |
|---|---|---|
| Pierre brute | Fragments anguleux irréguliers, nuances de pierre | `stone` |
| Pierre taillée | Cinq blocs réguliers empilés, arêtes biseautées | `cut-stone` |
| Bois brut | Trois troncs légèrement coniques avec écorce et départs de branches | `wood` |
| Rondins | Trois sections cylindriques coupées et ébranchées, écorce et cernes visibles | Aucun stock distinct livré |
| Bois d’œuvre | Planches empilées et madrier, grain longitudinal et bois de bout | `timber` |

Tranche de présentation uniquement : aucun contrat économique, stock, recette de fabrication, obstacle, transport ou entité persistante ajouté. Le raccord des nouvelles icônes au HUD et aux offres commerciales est une suite distincte après choix des apparences.

## Atelier et génération

Accès depuis la navigation Bâtiments / Infrastructure / Matières dans l’atelier existant. URL : `/factory-preview.html?world=aube&domain=resources`, ou `&recipe=stone`, `cut-stone`, `wood`, `logs`, `timber`. Les gardes authentifiés par monde et l’arrêt sur révocation restent communs aux ateliers. Un monde avec ateliers désactivés reste refusé ; aucun réglage serveur n’est changé par l’ouverture.

La section Matières propose les cinq recettes, leurs quatre orientations et les palettes pertinentes : pierre pour les deux pierres, bois scié pour le bois d’œuvre. Les commandes de chantier, accès et emprise des bâtiments sont masquées. Caméra orbitale/zoom et sol de présentation conservés ; composition posée sur le sol, sans occupation de case métier.

`resource-factory.ts` fournit `buildResourcePresentation()`. Le kit de la factory apporte grain de pierre et bois scié ; écorce et cernes sont des textures procédurales déterministes appartenant au modèle. Changer de recette détruit ces ressources sans détruire les matériaux partagés du kit.

Le bouton « Préparer l’icône PNG » utilise le renderer des miniatures : scène temporaire, même générateur, palette et orientation sélectionnées, vue orthographique, image **384 × 240 avec alpha**, puis destruction de la scène et de son moteur. Le cadrage des matières utilise leurs sommets réels. L’aperçu sur damier et le lien de téléchargement sont invalidés au changement de recette, palette ou orientation. Une capture à la fois ; une réponse ancienne ne remplace pas la nouvelle sélection. Le damier est un fond HTML, absent du PNG.

Les présentations `resource:<code>` sont aussi disponibles dans le chemin commun de miniatures. Aucune image n’est précompilée ou publiée par cette tranche ; le cache versionné existant reste utilisable pour une future intégration des icônes dans les listes.

## Vérification

Preuves effectivement obtenues et état Git dans [SESSION-HANDOFF.md](../SESSION-HANDOFF.md). Recette technique : cinq scènes et cinq captures, transparence et cadrage, changement de palette/orientation, export cohérent et ressources libérées. Recette produit restante : Tristan choisit les silhouettes, teintes et proportions finales.
