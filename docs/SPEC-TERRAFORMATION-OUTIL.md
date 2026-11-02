# Outil de terraformation — 2 novembre 2026

Statut : **à valider** (recette navigateur de Tristan, §6). Prolonge [SPEC-TERRAFORMATION-INSTANTANEE.md](SPEC-TERRAFORMATION-INSTANTANEE.md). Statuts : **validé** (Tristan), **proposé** (choix de l'implémentation dans le cadre validé), **ouvert**.

## 1. Décisions validées (Tristan, 2 novembre)

> « J'aimerais modifier le fonctionnement de la terraformation. Le bloc "altitude + / -" reste en place mais demande à être stylisé. Le réglage permet autant de pas que nécessaire, + un bouton "pipette / règle" qui prélève l'altitude d'une case et qui la reporte dans le réglage en cours, et le "pinceau" devient une zone de 3x3 (pour bien montrer la zone touchée par la terraformation, voisins inclus), la case centrale mise en évidence, les 8 autres en dégradé radial d'opacité (vers full transparence à l'extérieur), la grille de 3x3 affichée doit avoir des sommets partagés pour réellement refléter le futur relief façon mesh. Les boutons "Annuler" deviennent des paires "Annuler" "Confirmer" (confirmer -> raccourcir le délai restant à 0.250s). Le client connaît le terrain et doit pouvoir appliquer quelques règles, le serveur fait autorité dans tous les cas. Si une case est refusée, ça serait vraiment cool que l'Oracle explique pourquoi. "Une route sur ce terrain empêche de démarrer les travaux", avec un bouton "Inspecter" (déplacement caméra vers la case, zoom proche, caméra basse) et "Compris". L'icône "Détruire" dans le HUD construction > outils ne me convient pas non plus. »

Puis, même jour : « une maison en pierre, mais avec le filtre rouge de suppression. même chose pour ça d'ailleurs : "annuler / confirmer" » — l'icône « Détruire » devient la maison en pierre teintée du rouge de démolition, et la démolition en attente reçoit aussi la paire.

Règle générale des gestes : intention → retour immédiat → nouveau message en cas d'erreur ; le client calcule ce qu'il peut, le serveur décide.

## 2. État constaté avant la tranche (code de `9e695a1`)

- **Délai et annulation : côté client uniquement.** `usePendingTerrain` (`ui/PendingTerrain.tsx`) et `usePendingDemolition` (`ui/PendingDemolition.tsx`) gardent l'ordre en mémoire, 10 s après le dernier geste ; au terme, une seule commande part (`POST …/terrain-edits` ou `…/demolitions`), appliquée à l'admission. Le serveur ne connaît aucune modification « en attente » : il n'y a pas d'échéance serveur à avancer.
- **Zone réellement modifiée** : une case peinte fixe ses 4 coins (`vertexLeveling`) ; les cases touchées sont toutes celles qui partagent un de ces sommets (`vertexCells`), soit exactement le 3 × 3 autour d'elle, sur une grille de 4 × 4 sommets dont les 4 intérieurs bougent. Pour un trait de plusieurs cases, la zone est l'union de ces 3 × 3.
- **Bornes de hauteur** : contrat `multipleOf 0.25`, `terraformCells` exige `height × 4` entier sûr. Aucune borne haute de gameplay. Borne basse : l'eau (`LEVELING_WATER` si la hauteur ne dépasse pas la surface de l'eau sur la case ou ses raccords). L'interface n'avait déjà aucune limite de pas (± ¼).
- **Refus serveur** (tout ou rien, `TerrainEditRefused` avec l'index du geste, qui n'était pas transmis au client) : `INFRASTRUCTURE_OCCUPIED` (route de n'importe quel village, équipement, voie ou trottoir), `ENGAGED_PASSAGE`, `TERRAIN_NOT_BUILDABLE`, `CELL_OCCUPIED`, `CLEARING_PROTECTED`, `OUTSIDE_VILLAGE_REACH` (contrôlés sur les cases puis sur l'anneau), `LEVELING_WATER`, `LEVELING_FOUNDATION`, `LEVELING_UNAVAILABLE`, `INVALID_TERRAFORM_SELECTION`.
- Client : validation locale par un message générique (« occupé, protégé ou hors de portée ») ; pas d'aperçu au survol ; hauteur prélevée au point du premier clic.

## 3. Conception retenue (proposé, implémenté)

### 3.1 Réglage d'altitude
Bloc − / valeur / + en capsule (`terraform.css`), pas d'un quart de case, **Maj** pour une case entière, ↑ ↓ au clavier. Aucune borne côté interface : le serveur n'a pas de borne haute, la borne basse est l'eau (le pinceau passe au rouge à 0 ou moins, le serveur juge les lacs et rivières).

### 3.2 Pipette
Bouton « Pipette » (touche **P**) : le clic suivant prélève l'altitude **au centre de la case** (interpolation sur ses deux triangles, arrondie au quart, comme le premier trait) et la reporte dans le réglage ; il ne peint pas. Elle lit le relief **futur** : les gestes du lot en attente priment sur le sol (`plannedHeights`). Le premier trait sans réglage prélève maintenant lui aussi au centre de la case.

### 3.3 Pinceau 3 × 3
`scene/terraform-brush.ts` : un maillage de 4 × 4 sommets partagés (18 triangles, même diagonale que le sol) et un système de lignes (grille et diagonales), construits **une fois**. Les 4 sommets intérieurs sont à l'altitude visée, les 12 extérieurs à leur hauteur future ; alpha 1 à l'intérieur, 0 à l'extérieur : la case centrale est pleine et les 8 voisines s'estompent en dégradé jusqu'à la transparence au bord. Teintes : or (peindre), rouge (refus local prévisible), bleu (pipette).

Chemin chaud : le survol est déjà ramené à une fois par image par la scène ; `BrushCursor` ne fait rien si la case, le réglage et la révision des données n'ont pas changé, sinon au plus 16 lectures de hauteur, 9 accès d'ensemble pour le refus et la réécriture de deux tampons (`updateVerticesData`). Aucun maillage créé ni détruit au survol. Test : `terraform-brush.test.ts` (≤ 16 lectures, 0 sur 120 images immobiles, 12 avec une altitude choisie, 50 survols sans nouveau maillage).

### 3.4 Annuler / Confirmer
`CountdownCancelButton` affiche la paire pour la terraformation **et** la démolition. Confirmer ramène l'échéance à `min(échéance, maintenant + 250 ms)` (`confirmedDeadline`), jamais plus tard. **Aucune commande serveur** : le délai n'existe que dans le client (§2), Confirmer ne fait qu'envoyer plus tôt la commande unique déjà idempotente (`commandId`). Pas de migration, pas de nouvelle route, `command-inventory.json` inchangé. Écart avec la consigne initiale (« commande serveur … qui avance l'échéance ») signalé : elle supposait une échéance serveur qui n'existe pas.

### 3.5 Règles client et Oracle
- `ui/terraform-refusals.ts` indexe une fois par état du village (WeakMap) : cases constructibles, routes du village, équipements et trottoirs de l'ancien plan, emprises. Par case (cases du trait **et** anneau, comme le serveur) : `road`, `fixture`, `building`, sinon `nature` (non constructible à portée d'un bâtiment achevé) ou `reach` (hors de portée, même règle que `withinBuildReach`). Hauteur ≤ 0 : `water`. Limites : les routes des autres villages, la surface des lacs et rivières, les fondations voisines et les équipes en chemin restent l'affaire du serveur.
- Les codes serveur se traduisent dans les mêmes raisons ; la réponse 409 de `terrain-edits` porte désormais `gesture` (index du geste refusé, `HttpError.details`, corps `{ code, message, gesture }`), et « Inspecter » vise l'ancre de ce geste.
- **Regroupement** : un seul message par geste refusé. Titre = raison la plus prioritaire présente (route, aménagement, bâtiment, fondation, équipe, eau, nature, portée, monde, autre : d'abord ce que le joueur peut changer), au pluriel si elle touche plusieurs cases ; les autres raisons tiennent en une ligne (« Ailleurs dans ce geste, les travaux butent aussi sur un bâtiment et la nature. ») ; « Inspecter » vise la case de la raison principale la plus proche de l'ancre (distance sur le tore). Justification : un seul geste, une seule boîte, la cause actionnable d'abord.
- Boîte : style `oracle-provisions-overlay`, sans voile (la caméra doit rester visible), « Inspecter » (caméra vers la case, rayon 14, inclinaison basse 1,2 rad dans la limite du zoom proche, glissé de `focusCell`) et « Compris » (ou Échap). Un trait refusé localement ne part pas ; « le terrain est déjà à cette hauteur » reste une simple bulle.

### 3.6 Icône « Détruire »
La maison en pierre du catalogue (`buildPresentation('dwelling')`) dont chaque matériau est remplacé par sa copie teintée du rouge de démolition (`demolitionTintedMaterial`, la même teinte que les cibles désignées, avec une lueur fixe à 60 % au lieu de la pulsation). Révision des miniatures montée (`factory-10-demolish-house-png-384x240`).

## 4. Textes de l'Oracle (proposé)

Une case / plusieurs cases :
- route : « Une route sur ce terrain empêche de démarrer les travaux. » / « Des routes sur ce terrain empêchent de démarrer les travaux. »
- aménagement : « Un aménagement de la voirie occupe ce terrain. Les pelles attendront qu'on le déplace. » / « Des aménagements … qu'on les déplace. »
- bâtiment : « Un bâtiment se dresse ici. Je doute qu'il apprécie d'être soulevé avec le terrain. » / « Des bâtiments se dressent ici. Je doute qu'ils apprécient d'être soulevés avec le terrain. »
- fondation : « Une fondation voisine bougerait avec ce terrain. Éloignez un peu les travaux. » / pluriel.
- équipe : « Une équipe traverse ce terrain en ce moment. Laissez-la passer, puis recommencez. » / pluriel.
- eau : « À cette hauteur, l'eau s'inviterait sur le terrain. Montez un peu le réglage. »
- nature : « La nature tient ce terrain : arbre, rocher ou clairière protégée. Elle a parfois le dernier mot. »
- portée : « Ce terrain est hors de portée du village. Restez plus près de vos bâtiments. »
- monde : « Ce monde ne se laisse pas encore modeler de cette façon. »
- autre : « Le terrain a refusé de bouger. Je n'en sais pas davantage, pour une fois. »

## 5. Points ouverts

- Textes du §4 et ordre de priorité du regroupement : à relire par Tristan.
- Un trait dont une case est refusée est refusé entier (comme le serveur, tout ou rien). Variante possible, non tranchée : ne garder que les cases acceptées.
- Le pinceau ne se redessine pas si le sol change sous un pointeur immobile (application d'un lot par le flux) ; il se met à jour au mouvement suivant ou au changement d'état du village.

## 6. Vérification

Faits : tests unitaires `terraform-brush`, `terraform-refusals`, `terraform-tool`, `terraform-draft`, `tool-presentation`, `errors` ; intégration `terrain-edits` (6/6 sur la base de test), la régression « gesture dans le corps HTTP » rouge sans le correctif ; `tsc` API et client, ESLint, Prettier. Aucune recette navigateur faite.

Recette navigateur restante (dev local, monde à sommets partagés) :
1. Mode Terraformation : la capsule −/+ et la pipette s'affichent ; Maj+clic fait ±1.
2. Survol : le 3 × 3 suit la case, centre opaque, voisines estompées jusqu'au bord, relief futur visible ; rouge près d'une route ou d'un bâtiment ; bleu en mode pipette.
3. Pipette : clic sur une case → l'altitude s'affiche, aucun trait peint ; sur une case du lot en attente → l'altitude future.
4. Trait touchant une route : boîte de l'Oracle, « Inspecter » amène la caméra près et bas sur la route, « Compris » ferme ; rien n'est envoyé.
5. Trait valide : « Annuler 10 s » + « Confirmer » ; Confirmer → envoi en ~¼ s, « Terrain modifié. ». Même paire pour une démolition.
6. Refus serveur (ex. route d'un village voisin) : l'Oracle explique, Inspecter vise le geste.
7. HUD construction > outils : l'icône « Détruire » est une maison en pierre rouge.
8. **Mesure de performance exigée** (code exécuté par image) : sur le parcours réel, 60 s de survol continu en mode Terraformation sur Bressuire : images > 100 ms une fois le village prêt (budget : aucune), coût du gestionnaire de survol (profil Performance : `TerraformPanel` + `TerraformBrush.show`, attendu bien sous 1 ms), comparé au même survol avant la tranche.
