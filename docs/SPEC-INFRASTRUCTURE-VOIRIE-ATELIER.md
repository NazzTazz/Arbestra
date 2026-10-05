# Infrastructure : voirie, équipements et atelier

**Arbitrage du 5 octobre 2026, validé par Tristan :** les rebords deviennent des trottoirs bas, larges de **2 subdivisions (¼ de case) par côté**, traversables partout. Aucune encoche ni modification spécifique au croisement d'une sortie de bâtiment : les surfaces restent continues. Cet arbitrage remplace les anciennes mentions de bordures bloquantes, de demi-subdivision et d'ouvertures aux portes ci-dessous. Les tarifs linéaires restent inchangés ; aucune facturation rétroactive. Le champ persistant `border` est conservé pour les plans existants. La famille visible devient **Trottoirs**.

Statut : **implémentée dans le worktree, recette en cours**. Les résultats et limites de validation sont dans la tête du [handoff](../SESSION-HANDOFF.md). Arbitrages avec Tristan, confrontation initiale au worktree le 4 octobre 2026 (base `ffb6707`, modifications HUD/factory/habitants non commitées conservées). Cette spec précise et remplace, pour Infrastructure, les mentions « à venir » du [contrat HUD](SPEC-GUI-HUD-MODES.md). Elle ne remplace pas ses règles générales. L'activation des ateliers passe par DEV, pas par un rôle administrateur.

## 1. Livraison bornée

**Validé** : Infrastructure est le second domaine de Constructions. La barre prépare, le monde exécute. Livrer les voies éditables, leurs bordures, les braseros automatiques et manuels, les raccordements aux accès, leur incidence sur les déplacements, l'atelier Infrastructure, et la rotation R des placements de bâtiments et équipements. Réalisation immédiate après paiement et validation serveur, sans chantier ni travailleur mobilisé.

Familles opérationnelles : Voirie, Bordures, Éclairage. Sols, Végétation, Mobilier et Monuments restent prévus dans la grammaire, sans fausse action activable. Une place dessinée librement et l'éditeur d'assemblages ne sont **pas** nécessaires à cette livraison : la frontière ultérieurement validée prévaut sur les premières propositions de discussion.

Hors scope : usure, réparation, chevaux/carrioles, commerce, artisans, ères, terrassement simulé, ponts, tunnels, courbes, diagonales, vitesse variable selon matériau, nouveau moteur de foule, déplacement libre des bâtiments existants, édition publique/export de méta-blocs. Aucune nouvelle recherche ne conditionne ces outils.

## 2. Confrontation initiale au code, avant implémentation

| Couche / sources vérifiées | Existant | Écart à traiter |
|---|---|---|
| `packages/contracts/src/travel-paths.ts`, `buildTravelNetwork` | Chemins cardinaux en cellules entières, départ à l'ancre du village, empreintes bloquantes, préférence bornée pour les arêtes partagées (0,7 contre 1), pénalité de virage, détour borné à distance + 8 | Aucun tracé manuel, aucune subdivision ni accès multiples. Les poids de recherche ne sont pas des vitesses. |
| `apps/api/src/modules/villages/service.ts`, `stoneTravelPath`, création du snapshot et commandes | Réseau calculé au snapshot ; chemins de missions bois réutilisés ; routes reconnues scientifiques prioritaires ; recherche territoriale hors snapshot ; cas lointain > 128 en parcours X puis Y | Brancher aussi les nouveaux départs et les itinéraires reconnus, pas seulement le snapshot. Le fallback lointain n'est pas une preuve générale d'évitement des obstacles. |
| `packages/contracts/src/villages.ts`, `garden-tour.ts`, `apps/api/src/modules/population/garden-tour.ts` | Contrats de parcours à coordonnées entières ; jardins avec étapes ; durée notamment calculée avec `(path.length - 1) * 1000` | Introduire des trajets versionnés à précision fine et une longueur physique explicite ; ne pas multiplier le temps par huit. |
| Migration `016_travel_paths.ts` et missions | `path_cells` et `transport_ms` persistés | Préserver les missions engagées et leur durée ; migration additive/versionnée. |
| `scene/road-profile.ts`, `village-roads.ts`, `BabylonVillageScene.ts` | Pavage pour routes bâtiment, terre pour ressources, excavation et bordures ; `roadDisplayRoutes` masque les portions d'accès occupées ; largeur graphique fixe | Le rendu ne constitue pas une route persistante. Géométrie/excavation/raccords doivent recevoir un même plan de surface édité. |
| `scene/village-braziers.ts` | Positions dérivées des angles rentrants, instances décoratives non pickables, quelques points explicites pour décors ; particules/lumières bornées | Pas d'identité métier éditable, pas de suppression persistante ni contrôle manuel par case. Ne pas rendre chaque pierre/flamme persistante. |
| `scene/building-plan.ts` | `BuildingRecipe.entrance` et `BuildingPlan.entry` uniques, transformations, `quarterTurns`, cellule de 2,5 unités | Généraliser en liste d'accès métier, sans dépendance Babylon dans l'API. |
| `BabylonVillageScene.#workerPath`, `#leisurePath` | Ajout graphique du départ par la porte ; repli historique pour hôtels sans layout | Ce détour n'est pas intégralement le parcours serveur. Éviter de rajouter une seconde fois les portes aux nouveaux trajets. |
| `scene/factory-preview.ts`, `/factory-preview.html` | Atelier réel, rotations, couleurs, grille campus 8 × 8 avec cases blanches, mi-cases bleu medium, subdivisions bleu foncé | Réutiliser ce socle pour l'atelier Infrastructure ; pas un éditeur d'assemblages déjà existant. |
| Migration `023_building_visual_layout.ts`, commande `BuildRequestSchema` | Layout persistant limité à certaines recettes, rotations possibles dans le plan ; maison créée à rotation zéro ; requête ordinaire sans orientation | R n'est pas une simple rotation de mesh : étendre requête, occupation et persistance, y compris recettes composées. |
| `ui/ConstructionPanel.tsx` | Domaine Infrastructure affiché mais « à venir » | Brancher palettes, gestes, devis et erreurs dans le shell actuel. |
| Migration `004_world_economy_foundation.ts`, `economy.ts` | Stocks `village_resources.amount` entiers ; reliquats de **production** distincts | Ne pas utiliser ces reliquats pour les achats : réserve de matière d'aménagement dédiée, validée après confrontation. |
| `service.ts`, `claimBuildingCommand`, migration `027_building_command_receipts.ts` | Précédent de commande idempotente, devis attendu et transaction économique | Réutiliser les garanties, pas supposer que ce reçu est déjà un historique d'annulation. |

Les chemins de fichiers `scene/...` et `ui/...` ci-dessus sont relatifs à `apps/world-web/src`. Cette table conserve les écarts constatés le 4 octobre avant la réalisation ; elle ne décrit pas l'état livré. Cette lecture n'est pas une recette ni un résultat de tests.

## 3. Échelles, emprises et géométrie

- Une case comporte 8 × 8 subdivisions. Une subdivision vaut 1/8 de case, soit 0,3125 unité graphique avec l'échelle actuelle. Coordonnées métier canoniques, indépendantes du rebasage graphique et du viewport.
- Tracé orthogonal X/Y, axe aligné sur les subdivisions. Largeur utile entière de **2 à 8 subdivisions**, défaut **4**. La largeur ne dépend pas du pavage.
- Trottoir facultatif, largeur **2 subdivisions par côté**, à l'extérieur de la chaussée. Largeur 4 avec deux trottoirs : emprise totale 8 subdivisions. Les trottoirs sont traversables ; leur surface participe aux contrôles de terrain, de périmètre et de propriété.
- Conserver les blocs presque enterrés, environ un dixième de leur hauteur dépassant de l'herbe, et les pavages à fleur. Réutiliser le langage pierre actuel ; dimensions verticales ajustables dans l'atelier.
- Les unions de surfaces résolvent droits, angles, T, croisements et changements de largeur. Pas de double pavage, de double facturation des recouvrements inchangés ni de trottoir intérieur aux jonctions. Les sorties de bâtiments ne coupent ni ne remodèlent les trottoirs.
- Pierre 1 : pièces de 3 × 1 subdivisions. Pierre 2 : pièces de 4 × 2 subdivisions. Joints décalés, découpes de rive et d'angle ; les pièces ne changent pas d'échelle pour remplir une voie étroite. Les subdivisions sont des dimensions, pas une obligation de créer un mesh par sous-case.
- Tout l'aménagement, bordures comprises, doit rester dans le périmètre historique du village et sur du terrain compatible. Ce périmètre n'est ni le viewport ni un nouveau rayon d'autorité. Les chemins vers les ressources extérieures restent fonctionnels mais non éditables hors périmètre.
- Une route n'occupe pas une case entière comme un bâtiment : prévoir une couche d'emprises fines complémentaire, sans détourner `world_cell_occupancies` ni libérer ses réservations existantes.

## 4. Palette et paramètres

Voirie expose **Pas de route**, **Terre**, **Pierre 1**, **Pierre 2**. « Pas de route » crée/conserve une liaison manuelle sans revêtement : elle reste protégée et participe au routage. Retirer la liaison est une opération distincte, disponible dans Voirie avec aperçu explicite. Aucun changement de matériau ne supprime cette liaison.

Largeur et bordure sont préparées dans la barre. La bordure initiale est Aucune ; l'autre choix est Petits blocs de pierre. Le réglage de bordure peut être utilisé seul sans remplacer le revêtement. Éclairage propose Brasero, puis l'action contextuelle Rétablir l'éclairage automatique de la case.

Le showroom conserve le langage HUD validé, avec modèles issus des mêmes générateurs que la carte. Les coûts sont ceux du devis réel, pas une légende décorative. Afficher matériau, largeur, longueur/surface, coût exact, débit immédiat et réserve de matière utilisée/restante. Les erreurs restent proches de l'action/dans la barre, aucune modale ordinaire.

Conserver les paramètres pendant les placements successifs du même outil. Changer de modèle réinitialise sa rotation par défaut ; revenir au même outil peut conserver ses paramètres non destructifs. Replier le mode, changer de domaine ou quitter Village abandonne l'aperçu et suspend l'outil ; aucune commande implicite. Les actions déjà acceptées restent construites.

## 5. Grammaire de tracé

### États

`inactif → prêt → aperçu ancré → envoi → prêt pour portion suivante`, avec variantes `aperçu invalide`, `refus certain`, `résultat incertain` et `annulation envoi`.

- Survol : aperçu local, aucun débit ni réservation.
- Premier clic gauche : ancre. Déplacement : aperçu vers le pointeur. Si deux axes diffèrent, proposer un coude ; une commande « Inverser le coude » dans la palette alterne X→Y et Y→X, sans réaffecter R.
- Clic gauche suivant : envoi de **toute la portion présentée**, coude compris. Après succès, le point final devient l'ancre suivante.
- Clic-glissé depuis un point : équivalent en une portion, envoi au relâchement. Un clic isolé sans longueur ne construit pas une surface fantôme.
- Une portion invalide n'est ni tronquée ni partiellement construite. Conserver son aperçu et signaler les zones bloquantes. Aucune dépense.
- Repasser sur une voie remplace seulement la surface parcourue ; prolonger ajoute une voie. Seuls les matériaux réellement changés sont facturés. Passage identique : aucun coût, aucune mutation artificielle.
- Clic droit : annuler la dernière portion **acceptée de la session de tracé**, puis retour à son ancre initiale. Répétable en ordre inverse. Sans historique, abandonner l'aperçu courant, sans supprimer une voie historique.
- Échap : terminer le tracé, abandonner uniquement l'aperçu. Les portions acceptées restent en place. Aucun remboursement automatique à la fermeture du mode.
- Supprimer une liaison utilise les mêmes limites de sélection et le même aperçu ; cela remet la surface au sol naturel et retire les bordures associées, sans remboursement. Les équipements indépendants ne disparaissent pas avec la route. La suppression mémorise l'absence de décoration automatique sur la portion retirée.

Pendant un envoi, aucune seconde mutation ni annulation ne part en parallèle depuis cet outil. Un clic droit/Échap peut fermer l'aperçu local, mais ne prétend pas annuler une commande déjà envoyée. En résultat incertain, retrouver d'abord le reçu avec le même identifiant ; ne pas créer une nouvelle dépense. Une annulation éventuelle est ensuite une commande explicite.

## 6. Équipements ponctuels

Ce comportement n'est actif que dans Infrastructure avec l'outil d'équipement ; Vue libre continue à naviguer sans éditer.

| État / geste | Résultat |
|---|---|
| Modèle neuf choisi, déplacement | Ghost aligné sur les subdivisions, emprise et coût visibles |
| Neuf + clic gauche valide | Création, paiement ; outil conservé pour répéter |
| Neuf + clic droit ou Échap | Abandon du ghost, aucune dépense |
| Clic gauche sur équipement existant | Objet saisi, collant au pointeur ; ancien emplacement marqué ; état serveur inchangé |
| Existant saisi + clic gauche valide | Déplacement/orientation persistés sans refacturer l'objet |
| Existant saisi + clic droit | Suppression persistée, aucun remboursement |
| Existant saisi + Échap/changement de mode | Abandon, retour à l'état initial |
| Clic gauche invalide | Rester en édition, raison visible, aucune mutation |

Le modèle d'interaction précédent « clic droit annule la création d'un équipement déjà posé » est remplacé par cet arbitrage. L'annulation des portions de route reste distincte ; afficher le sens du clic droit pendant le geste. Le menu contextuel navigateur ne s'ouvre pas pendant l'édition.

Une collision se juge sur l'emprise bloquante déclarée, pas sur les particules/flammes. Refuser bâtiments, eau, équipements incompatibles, passage utile occupé ou trajet engagé coupé. Les braseros se placent sur les côtés des voies. Sur tablette, prévoir des actions équivalentes Poser / Supprimer / Annuler et Tourner ; ne pas livrer un moteur tactile supplémentaire dans cette tranche PC.

## 7. Braseros automatiques et contrôle manuel

- Les braseros automatiques gardent une génération déterministe aux angles rentrants admissibles. Leur identité logique dépend du lieu canonique et du coin, jamais de l'index d'un mesh ou du chunk actuellement chargé.
- Supprimer un automatique mémorise ce retrait pour qu'un rebuild/rechargement ne le recrée pas. Les autres automatiques de la case restent possibles tant qu'elle n'est pas passée en contrôle manuel.
- Poser le premier brasero manuel d'une case la passe en **contrôle manuel** et retire ses automatiques. Pas de récupération de matériaux pour ces décors automatiques.
- Déplacer un automatique le transforme en manuel : suppression persistante à l'origine, contrôle manuel à l'arrivée. Le déplacement est gratuit ; sa suppression ultérieure ne rembourse rien.
- Retirer/déplacer le dernier manuel ne réactive pas l'automatique de sa case d'origine. La politique manuelle survit au nombre d'objets présents.
- « Rétablir l'éclairage automatique » efface les exclusions automatiques de la case et réactive la génération, sans créer de route. Cette action n'est disponible que sans brasero manuel : elle ne détruit pas implicitement des objets payés.
- Les braseros intégrés à une recette de bâtiment (ex. campus) restent des composants de ce bâtiment, pas des équipements éditables détachables. Les règles ci-dessus concernent l'éclairage de voirie.

Ne persister que les objets placés et les politiques/exclusions nécessaires. Pierres, flammes, particules et lumières restent dérivées. Préserver l'allumage nocturne, la désynchronisation et les limites de lumières existantes.

## 8. Accès et rotation des factories

Chaque recette peut déclarer plusieurs accès stables : identifiant, position locale, normale de sortie, largeur utile, principal/secondaire. Un accès principal par recette utilisable ; les recettes historiques sont adaptées depuis leur entrée existante, sans déplacer les bâtiments existants.

Le contrat spatial pur doit être utilisable côté serveur et client. Séparer emprise réservée, obstacle physique, passages internes d'accès, ouvertures de muret et décor non bloquant. Une ouverture autorise son corridor d'accès dans l'emprise ; elle ne rend pas tout le bâtiment traversable. Le modèle graphique doit figurer la porte à la position déclarée.

Chaque trajet sélectionne les accès praticables donnant le parcours le plus court vers sa destination, selon les passages autorisés et connus ; égalités départagées de façon stable. Le principal sert au cadrage et au repli, pas à imposer un détour. Raccord au réseau gratuit et invisible par défaut, aménageable ensuite ; aucune petite route visible imposée depuis la porte.

**R** tourne de 90° le ghost neuf ou l'équipement saisi. Ignorer R dans les champs de texte et lorsque aucun placement n'est actif ; éviter les répétitions incontrôlées de keydown. Transformer modèle, accès/normales, pivot, emprise, collisions et raccordements ensemble. Ne pas tourner uniquement la caméra ou la charpente.

Pour les bâtiments non carrés, 90° échange les dimensions réellement réservées. Les composants d'un campus suivent la même transformation. Le serveur reconstitue l'emprise depuis recette, ancre et orientation ; il ne croit pas une liste libre de cellules donnée par le client. Une amélioration conserve l'orientation du bâtiment. Le Jardin surfacique conserve sa grammaire de sélection ; ne pas inventer une rotation d'un Jardin déjà planté.

Les anciennes données sans orientation/layout continuent à se rendre et fonctionner avec leur orientation historique. Ne pas convertir tous les modèles en pierre/bois selon les stocks pendant cette tranche.

## 9. Routage, durée et autorité spatiale

### Invariants

1. Le réseau manuel est durable. Le réseau automatique complète et raccorde, sans réécrire les tracés du joueur.
2. Le revêtement n'apporte **aucun bonus de vitesse**. Le tracé peut raccourcir un déplacement. Travail sur place inchangé.
3. Supprimer une route n'interdit pas le sol naturel. Une cohorte engagée conserve son parcours et ses échéances, même si le revêtement disparaît.
4. Les prochains départs utilisent le réseau courant. Une mission/lot déjà admis conserve toutes ses jambes, y compris retour et étapes Jardin. Un lot suivant d'un chantier utilise le nouveau réseau.
5. Ajouter un véritable obstacle ne doit pas couper un parcours engagé. Tester ses corridors persistés, pas la seule position du représentant visible. Refuser l'obstacle si nécessaire ; ne pas retarder les crédits pour une collision graphique.
6. Toute nouvelle construction/extension consulte les infrastructures : voie manuelle, même nue, ou équipement → refus de recouvrement ; passage automatique nu → remplacement possible avec contournement validé ; jamais de suppression implicite d'une voie aménagée.
7. Conserver les accès aux bâtiments par un passage praticable, qui peut être naturel. Il n'est pas exigé qu'un chemin revêtu subsiste partout.
8. Recalculer un itinéraire ne recrée pas la décoration automatiquement supprimée.

### Raccord minimal recommandé au code

Introduire une représentation versionnée de parcours continu par points canoniques fins, accès choisis, longueur et durée serveur. Ne pas changer le sens des entiers `TravelCell` existants. Ajouter un adaptateur pour les trajets historiques, qui conserve `transportMs` et les échéances déjà persistées.

Pour les nouveaux parcours : 1 case de longueur = 1 seconde ; 1 subdivision = 125 ms. Compter les distances de parcours, non le nombre de sommets (une polyline peut être simplifiée). Les raccords jusqu'aux seuils doivent être inclus dans la longueur ; une animation intérieure de sortie ne rajoute pas un second transport. Arrondir uniquement la durée finale à la milliseconde si un raccord existant a une position plus fine.

Le routage fin se limite au village ; conserver le routage territorial et les droits scientifiques au-delà, avec des raccords explicites aux deux représentations. Ne pas mailler tout le monde en 64 sous-cases par case. Auditer `recognizedDepositRoute`, les voies d'admission de chantiers, tournées Jardin, missions scientifiques et départs de repos/loisir : aucun départ métier ne doit ignorer l'édition locale parce qu'il emprunte un autre helper.

Le choix de trajet peut conserver la préférence existante pour des voies partagées afin que les habitants suivent le réseau ; cette préférence n'est jamais utilisée pour calculer la durée. Recommandation d'implémentation : même préférence pour voies nues, terre et pierre ; terrain naturel admissible en raccord/contournement. Entre accès, comparer les longueurs physiques des parcours trouvés, pas les seuls poids de recherche. La formule de préférence n'est pas un nouveau bonus économique. Recetter explicitement qu'un raccourci manuel pertinent est emprunté et raccourcit la durée.

Supprimer le vieux départ par porte rajouté côté Babylon pour les parcours versionnés ; garder seulement l'adaptation legacy. Files, binômes et priorités restent une couche visuelle avec leur décalage accepté, sans double simulation du trajet. Partager les obstacles avec la marche POV ; Passe-muraille reste un réglage DEV de caméra, jamais une permission métier.

## 10. Coûts et réserve prépayée

| Modification | Coût exact validé |
|---|---|
| Passage nu / terre | 0 |
| Pierre 1 / Pierre 2 | 4 pierres par case de **surface** réellement modifiée |
| Bordure | 1 pierre par longueur d'un côté de case, par côté |
| Brasero neuf | 2 pierres + 1 bois |
| Déplacement d'équipement | 0 |
| Suppression ordinaire | Aucun remboursement |

Exemple : longueur 1 case, largeur utile 4 subdivisions → 2 pierres de revêtement ; deux rives longues → 2 pierres de bordure. Les terminaisons ouvertes de voie ne sont pas bouchées et facturées comme des traverses. Les longueurs supplémentaires réellement visibles aux angles entrent dans le devis.

Ne pas facturer des bounding boxes ni compter deux fois une intersection. Remplacement pierre 1 → pierre 2 : nouveau matériau payé sur la surface remplacée, ancien non récupéré. Réglage de bordure seul : ne pas refacturer la chaussée. Suppression de bordure : aucun remboursement. Géométrie de raccord automatiquement ajustée incluse dans le devis et l'annulation de la portion.

**Arbitrage validé après lecture du code : réserve de matière prépayée par village.** Stocks généraux inchangés, entiers. Coût exact c, réserve disponible r : consommer la réserve puis débiter le minimum d'unités entières nécessaire ; conserver le surplus en réserve. Par ressource : débit `max(0, ceil(c - r))`, nouvelle réserve `r + débit - c`. Cette réserve ne se confond pas avec le reliquat de production.

Recommandation technique : exprimer coûts et réserve en unités entières de 1/256 de ressource. Les arêtes de chaussée de largeur impaire, les axes au huitième et les bordures au seizième ont alors des aires exactes sur grille 1/16 ; les tarifs ci-dessus sont exacts sans flottants. Refuser les géométries hors grille plutôt que cumuler une dette imprécise. Les joints et découpes esthétiques ne modifient pas la surface économique.

La réserve concerne les recettes Infrastructure de cette tranche ; elle n'est pas automatiquement consommée par les anciens achats Bâtiments. L'indiquer comme « matière préparée pour les aménagements », visible dans le devis. L'absence de stock entier n'empêche pas une opération couverte par cette réserve. Plusieurs petits tracés d'une même surface finale inchangée ne coûtent pas plus qu'un grand ; les matériaux réellement remplacés restent payés.

## 11. Commandes, revalidation et annulation sûre

Noms exacts des routes API/tables à choisir dans le style du dépôt. Contrat minimal : identité monde/village, commandId obligatoire, opération, paramètres canoniques de géométrie/recette/orientation, cibles et versions attendues, révision du plan concerné, devis présenté (coût exact, débit entier, réserve attendue), identifiant de session de tracé pour l'annulation. Authentification et appartenance serveur.

Une portion est atomique : terrain + réseau + bordures + politiques d'éclairage affectées + coût + reçu sont validés ensemble. À aucun moment le client ne décide des ressources, occupations ou droits d'accès. Aucune action partielle cachée. Les éditions restent propres au village autorisé : un périmètre historique qui chevauche celui d'un voisin ne donne aucun droit sur ses bâtiments, voies ou équipements.

Ordre d'exécution : transaction → `beginVillageEconomy` (village avant verrous métier, borne après acquisition) → réconciliation due selon les invariants existants → contrôle d'idempotence/versions et lecture des dépendances → revalidation géométrie, accès, parcours engagés, connaissances, stock/réserve et devis → mutation et reçu → snapshot cohérent. Préparer l'ensemble des verrous requis avant mutation, ordre canonique, aucune prise tardive d'un autre village après un gisement ; ne pas introduire une isolation SERIALIZABLE globale ni acquitter les notifications du worker.

Deux commandes concurrentes ne peuvent payer avec la même réserve ou éditer silencieusement la même portion. Un second onglet reçoit un conflit et un aperçu actualisé ; aucun nouvel envoi automatique avec un nouveau prix. Même identifiant + même requête renvoie le résultat acquis ; même identifiant + requête différente est rejeté.

Raccord livré pour la navigation : après le verrou village et avant les gisements, `beginVillageEconomy` protège la géométrie par un verrou transactionnel partagé du monde ; aménagement/construction choisissent le verrou exclusif dès l'entrée. Un nouveau départ voisin ne peut ainsi être admis sur une géométrie remplacée pendant son calcul. Les obstacles des plans voisins susceptibles de croiser le périmètre local entrent dans le contexte de routage, sans devenir éditables par notre village. Il n'y a ni verrou tardif d'un autre village ni upgrade partagé/exclusif après un gisement.

Préserver la priorité existante des commandes manuelles sur les nouveaux départs automatiques : réconcilier les événements dus, appliquer l'édition, puis admettre les nouvelles missions sur le réseau résultant. Une réserve de passage est celle d'une mission déjà engagée ; un recalcul de snapshot ne doit pas en inventer. Les déplacements purement décoratifs se réorientent visuellement et ne créent pas de verrou économique permanent.

### Annulation des portions

Un reçu conserve le delta avant/après de la portion, raccords compris, et le coût exact. L'annulation est une **commande compensatrice**, pas un rollback tardif d'une transaction. Elle ne restaure jamais un ancien snapshot global, le stock total ou l'état d'une mission.

Recommandation bornée : pile inverse de session, invalidée par une modification concurrente du réseau/des équipements ou une mutation ultérieure de la réserve hors de cette pile. La production de ressources et les commandes métier indépendantes ne sont pas annulées. À chaque undo, vérifier l'état attendu, les nouveaux bâtiments et les parcours admis depuis. Recréer une ancienne bordure qui couperait maintenant un trajet engagé peut être refusé.

Si valide, inverser uniquement les deltas de cette opération : rembourser les unités entières effectivement débitées et restaurer la réserve précédente correspondante. Les annulations successives de la pile restent possibles. Une opération déjà annulée ne rembourse jamais deux fois. Après rechargement, ne pas inventer un historique local ; les reçus restent utiles pour résoudre les réponses incertaines, pas pour offrir un remboursement illimité des routes anciennes.

| Situation | Retour attendu |
|---|---|
| Collision, eau, hors périmètre, passage coupé | Aucun changement ; aperçu rouge et motif précis |
| Ressources/réserve insuffisantes | Aucun changement ; coût et manque dans la barre |
| Devis/révision périmés | Aucun lancement ; état et aperçu actualisés, nouveau geste nécessaire |
| Objet saisi supprimé par ailleurs | Édition abandonnée, message explicite, pas de recréation |
| Réponse réseau perdue | État incertain, résolution avec le même commandId, pas de double paiement |
| Annulation devenue impossible | Rien n'est inversé ; expliquer pourquoi, conserver l'état actuel |
| Geste vide/identique | No-op sans débit ni nouvelle entrée artificielle dans la pile |

## 12. Données et migration conservatrice

Persister au minimum : surfaces/liaisons manuelles et leurs matériaux/largeurs, bordures, absence demandée de décor automatique, équipements avec identités et versions, politiques d'éclairage par case/exclusions par emplacement, réserve de matière, révision et reçus. Toutes les clés et relations respectent `world_id` et le village. Aucune entité persistante par pavé, pierre de brasero, particule ou sous-case vide.

Les routes automatiques existantes restent gratuites et dérivées ; aucune facture rétroactive. Éditer leur portion la matérialise comme aménagement manuel. Modifier la bordure seule peut donc préserver un ancien revêtement gratuit ; reconstruire ce revêtement paie la recette actuelle. Une suppression mémorisée empêche la résurrection graphique. Les tronçons extérieurs ne sont pas convertis par la migration.

Les braseros automatiques existants ne deviennent pas tous des lignes en base. Les bâtiments existants gardent position, orientation et aspect. Les missions legacy conservent crédits, stocks réservés, dates et chemins. Migrations additives, pas de seed/reset de développement. Invalider les caches de présentation lorsque les recettes changent ; les caches graphiques ne constituent jamais l'état d'aménagement.

## 13. Atelier Infrastructure et futures compositions

### Accès depuis le showroom — complément validé

Les deux ateliers sont accessibles depuis **le showroom du HUD existant**, chacun dans son domaine : Bâtiments ouvre l'atelier Bâtiments ; Infrastructure ouvre l'atelier Infrastructure. Une entrée supplémentaire **« Créer un bâtiment »**, présentée comme un modèle du showroom avec une miniature d'atelier et un signe de création, sert de lanceur. Son sous-libellé précise l'atelier correspondant. Cette entrée reste disponible indépendamment de la famille filtrée, sans doublons dans le même showroom. Elle n'a ni coût ni emprise de construction : cliquer ouvre l'atelier, jamais un ghost de bâtiment à poser.

Une **case à cocher dans le drawer DEV** active les deux ateliers (correction explicite de Tristan pendant l’implémentation, 5 octobre 2026). Le réglage est conservé côté serveur par monde, modifiable par un membre authentifié uniquement sur le serveur de développement. Aucun rôle administrateur ni écran admin n’est ajouté. Désactivée, les deux entrées sont absentes ; activée, elles apparaissent dans leurs showrooms respectifs. Un accès direct à l’atelier vérifie la capacité serveur ; une désactivation interrompt l’atelier et propose le retour au village sans mutation.

Ouvrir l'atelier annule l'aperçu de placement en cours et suspend les gestes monde. Le retour retrouve le domaine et la famille d'origine ; aucune construction ni dépense n'est déclenchée par cette navigation. Les modifications d'atelier restent celles du périmètre ci-dessous : ce lanceur n'ajoute pas implicitement publication de recettes utilisateur, sauvegarde de méta-blocs ou création de bâtiments métier.

**Raccord retenu :** capability serveur par monde, toggle DEV et vérification périodique dans la page isolée. L’atelier ne modifie aucune donnée économique ; les paramètres sont propres à sa session.

Réutiliser l'atelier Bâtiments : caméra, éclairage, canevas dimensionnable en cases, grille cases blanches / demi-cases bleu medium / subdivisions bleu foncé. Accès identifiable à « Factory : Infrastructure », sans obligation de créer un nouvel outil autonome.

Éditer/prévisualiser les paramètres des deux pavages, de la terre, des bordures et du brasero : dimensions, matériaux, orientation, pivot, emprises physiques et accès. Proposer fixtures droit, angle, T, croisement, largeurs 2/4/8 et jonction à une porte. Modifier une définition de recette doit alimenter le même générateur en atelier, showroom, ghost et carte ; pas de copies indépendantes de géométrie.

L'atelier est un espace de conception exposable via l'option DEV, pas une commande qui modifie directement le village. Pour cette tranche, des paramètres de session et des recettes versionnées dans le dépôt suffisent ; pas de service de publication de recettes utilisateur. Les marqueurs d'accès sont configurables dans les recettes et visibles dans l'atelier Bâtiments aussi.

Préparer trois niveaux sans livrer l'éditeur complet : **pièce** graphique réutilisable ; **mini-bloc** plaçable avec emprise/pivot/accès ; **méta-bloc** futur, références de mini-blocs avec positions et quarts de tour, couvrant une ou plusieurs cases. Composition orientée et accès hérités, sans décider maintenant des coûts groupés ni d'une économie des plans.

## 14. Ères et artisanat : direction conservée, pas implémentation cachée

Les capacités émergent des ressources accessibles localement ou par commerce. Pierre brute → tailleur qualifié → blocs utilisables. Importer des blocs permet de construire sans tailleur local, mais ne transmet pas sa compétence. Le premier artisan peut apprendre par la pratique puis transmettre à l'Université. Connaissances joueur/monde ; capacité de production et stock locaux. Une pénurie ne fait pas régresser une ère ni changer les murs existants.

Pour cette tranche, Pierre brute est explicitement le matériau provisoire des recettes routières. Prévoir les références à des produits économiques, sans ajouter maintenant les blocs taillés, artisans, commerce, ères ni convertir les maisons. La durabilité future différenciera les revêtements, notamment sous chevaux/carrioles ; aucun effet d'usure ni de vitesse n'est simulé ici.

## 15. Ordre de réalisation recommandé

1. Contrats de géométrie fine, coûts/réserve, accès et rotations ; adaptateurs legacy. Prouver les raccords purs avant le branchement métier.
2. Commandes et persistance Infrastructure, reçus et annulations transactionnelles ; intégration avec les contrôles d'emprise des bâtiments.
3. Routage local fin, conservation des missions engagées, longueur/durée partagées ; raccorder tous les départs métier et les chemins territoriaux.
4. Atelier et rendu des routes/bordures ; même plan pour excavation et surface. Validation humaine rapide des jonctions.
5. Outils HUD/monde, placement R des bâtiments, braseros éditables et politiques d'éclairage. Recette interactive.
6. Vérifications ciblées et documentation de livraison. Pas de refonte générale du monde ou du scheduler.

## 16. Critères d'acceptation observables

1. Infrastructure ouvre ses outils dans le shell existant. **Aucune action ordinaire couverte ne nécessite une modale ou un second formulaire après le geste monde.**
2. Une voie de largeur 4 avec trottoirs mesure 8 subdivisions hors tout ; les trottoirs sont continus devant les portes et traversables partout.
3. Les quatre revêtements sont distinguables ; le passage nu reste invisible en Vue libre mais sélectionnable en édition et présent dans le réseau.
4. Pose par clics et par glissé produit la même portion. Inverser un coude change l'aperçu avant paiement. Un obstacle refuse toute la portion.
5. Un passage identique ne coûte rien. Une modification de bordure seule ne refacture pas le sol. Petites portions et grand tracé équivalents consomment la même quantité exacte, réserve comprise.
6. Débit/réserve affichés correspondent au serveur ; manque de stock couvert par réserve accepté ; insuffisance totale sans mutation. Deux commandes concurrentes ne surconsomment pas.
7. Deux clics droits annulent deux portions en sens inverse, remboursent exactement leurs débits, restaurent leurs réserves et revêtements antérieurs ; nouvelle tentative d'annulation sans double remboursement.
8. Un concurrent modifie la zone ou rend l'undo dangereux : refus explicite, aucun écrasement. Une réponse perdue puis réessayée ne produit qu'une mutation et un débit.
9. Suppression de route sous une cohorte : elle continue sur le sol naturel, mêmes échéances. Les nouveaux départs utilisent une liaison manuelle plus courte et ont une durée effectivement réduite, sans changer le travail.
10. Une barrière ou un bâtiment ne peut pas couper un parcours encore engagé ; une voie manuelle ou un équipement n'est jamais détruit implicitement par une construction.
11. Suppression d'un automatique, rechargement/rebuild/changement LOD : il reste absent. Premier manuel retire les automatiques de sa case ; dernier manuel supprimé ne les réactive pas ; rétablissement explicite les autorise.
12. Saisir un brasero, R, déplacer puis Échap laisse l'état serveur initial. Clic gauche valide déplace sans coût ; clic droit supprime sans remboursement. Les décors du campus ne sont pas arrachables.
13. R sur un bâtiment rectangulaire transforme ghost, vraie occupation et accès ; après rechargement ils coïncident. Amélioration conserve son orientation. Aucun passage à travers un mur pour rejoindre une porte tournée.
14. Deux accès praticables : choix pertinent selon destination, déterministe en égalité ; accès bloqué ignoré. Raccord invisible, aménageable, avec bordure ouverte.
15. Ancien village, anciennes missions, hôtel sans layout : aucune relocation ni modification rétroactive de durée/crédit. Cas proche d'une couture torique valide sans saut visuel ou cellule d'un autre monde.
16. Atelier, showroom, ghost et carte affichent les mêmes pavages/brasero. Droits/angles/T/croisements vérifiés visuellement ; pas de clignotement sol/terre/pavés ni de fuite de meshes/lumières lors d'éditions répétées.
17. Option DEV désactivée : aucune entrée de création dans les deux showrooms et accès joueur direct indisponible. Activée : « Créer un bâtiment » ouvre le bon atelier selon Bâtiments/Infrastructure, sans ghost, coût ni mutation du village ; le retour retrouve le contexte HUD. La modification de l’option exige une session authentifiée membre du monde sur le serveur de développement ; elle est refusée en production.

Tests ciblés attendus : géométrie/rotations/accès, coûts exacts, trajet/durée et compatibilité legacy ; intégration DB pour concurrence forcée, atomicité/rollback identifié, reçu idempotent, réserve et undo. Recette navigateur interactive des gestes et de la fluidité. Pas de campagne E2E générale imposée pour cette passe ; une lecture de code ne remplace pas ces preuves lors de l'implémentation.

## 17. Statut des décisions et limites de cette spécification

Les choix produit ci-dessus et la réserve prépayée sont **validés**. Représentation versionnée des parcours, unités 1/256, invalidation prudente de pile et ordre de réalisation sont des **recommandations techniques** pour obtenir les garanties, adaptables si une solution plus simple les conserve. Les identifiants exacts d'API/tables ne sont pas imposés.

Aucun arbitrage produit bloquant identifié après cette confrontation. L'ampleur réelle est plus grande qu'un nouvel outil de dessin : autorité des accès, contrats de transport, persistance des aménagements et rotation des occupations sont nécessaires. Ne pas déclarer la tranche livrée avec seulement des meshes et une durée calculée sur l'ancien parcours.
