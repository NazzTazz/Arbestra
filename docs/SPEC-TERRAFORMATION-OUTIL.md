# Outil de terraformation — 2 novembre 2026

Statut : **à valider** (recette navigateur, §7.8, §7.9 et §7.13). Les §7.10 à §7.12 (2 novembre, plus tard encore) ajoutent l'annulation par geste inverse, la fusion des pages d'eau et le halo rouge des arbres et rochers. Le §7.9 (2 novembre, plus tard) rend le trait vivant : le sol change pendant le geste. Le §7 (décisions du 2 novembre au soir) remplace le délai de 10 s, la paire Annuler/Confirmer de la terraformation, le tout-ou-rien, les diagonales du réticule et le message regroupé par geste ; les §2 à §6 restent l'historique de la première version. Prolonge [SPEC-TERRAFORMATION-INSTANTANEE.md](SPEC-TERRAFORMATION-INSTANTANEE.md). Statuts : **validé** (Tristan), **proposé** (choix de l'implémentation dans le cadre validé), **ouvert**.

## 1. Décisions validées (Tristan, 2 novembre)

> « J'aimerais modifier le fonctionnement de la terraformation. Le bloc "altitude + / -" reste en place mais demande à être stylisé. Le réglage permet autant de pas que nécessaire, + un bouton "pipette / règle" qui prélève l'altitude d'une case et qui la reporte dans le réglage en cours, et le "pinceau" devient une zone de 3x3 (pour bien montrer la zone touchée par la terraformation, voisins inclus), la case centrale mise en évidence, les 8 autres en dégradé radial d'opacité (vers full transparence à l'extérieur), la grille de 3x3 affichée doit avoir des sommets partagés pour réellement refléter le futur relief façon mesh. Les boutons "Annuler" deviennent des paires "Annuler" "Confirmer" (confirmer -> raccourcir le délai restant à 0.250s). Le client connaît le terrain et doit pouvoir appliquer quelques règles, le serveur fait autorité dans tous les cas. Si une case est refusée, ça serait vraiment cool que l'Oracle explique pourquoi. "Une route sur ce terrain empêche de démarrer les travaux", avec un bouton "Inspecter" (déplacement caméra vers la case, zoom proche, caméra basse) et "Compris". L'icône "Détruire" dans le HUD construction > outils ne me convient pas non plus. »

Puis, même jour : « une maison en pierre, mais avec le filtre rouge de suppression. même chose pour ça d'ailleurs : "annuler / confirmer" » — l'icône « Détruire » devient la maison en pierre teintée du rouge de démolition, et la démolition en attente reçoit aussi la paire.

Règle générale des gestes : intention → retour immédiat → nouveau message en cas d'erreur ; le client calcule ce qu'il peut, le serveur décide.

Puis, 2 novembre au soir (validé, mis en œuvre au §7) :

> « Le réticule de terraformation est presque parfait, je ne veux pas des triangulations (diagonales), ni du délai de 10 s pour la terraformation finalement : j'aimerais que l'effet du pinceau soit immédiat (si possible préshot côté client la réponse du serveur). Un refus n'invalide pas le reste du geste. "Inspecter" devrait aussi faire pulser l'équipement qui interdit la terraformation. 3 pulsations rouges comme pour la suppression. »

> « Les textes de l'Oracle sont parfaits, mais je préférerais un message par erreur, avec un simple sélecteur "1/X" et éventuellement gérer le swipe précédent/suivant pour les messages de l'Oracle. »

Règle générale validée le même jour : intention → retour immédiat du jeu → correction ou message si le serveur refuse ; le client prédit, le serveur fait autorité.

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
- ~~Un trait dont une case est refusée est refusé entier~~ : tranché le 2 novembre, un refus n'invalide plus le reste du geste (§7.3).
- Le pinceau ne se redessine pas si le sol change sous un pointeur immobile (application d'un lot par le flux) ; il se met à jour au mouvement suivant ou au changement d'état du village.

## 6. Vérification (première version)

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

## 7. Effet immédiat, refus partiel et pages de l'Oracle (2 novembre)

Décisions citées au §1 (validé). Conception ci-dessous : **proposé, implémenté** (branche `terraform-immediate`), sauf mention.

### 7.1 Réticule sans diagonales
Les lignes ne tracent plus que les 4 rangées et 4 colonnes de la grille de 4 × 4 sommets. Le remplissage montrait lui aussi la diagonale : avec deux triangles par case, l'opacité linéaire d'une case de coin faisait un pli le long de la diagonale (min(u, v) d'un côté ; une rampe d'un seul côté pour l'autre orientation). Il devient une grille de 13 × 13 points (chaque case coupée en 4 × 4 carrés dont les diagonales suivent celle du sol) : chaque petit triangle est inclus dans un triangle du sol, le relief reste exact, l'opacité est bilinéaire. Toujours O(1) au survol : les 169 points viennent des mêmes 16 hauteurs, deux maillages réécrits, jamais reconstruits. Tests `terraform-brush` (aucun segment diagonal, fondu bilinéaire et symétrique dans les deux orientations de coin, points sur le relief du sol, au plus 16 lectures).

### 7.2 Envoi immédiat et prédiction
*Envoi et prédiction au relâchement remplacés le 2 novembre par le trait vivant (§7.9) ; la réconciliation ci-dessous reste.*

- **Plus de délai ni de paire Annuler/Confirmer pour la terraformation** (la démolition garde la sienne). Le trait part **au relâchement** : un trait est l'unité de geste du contrat (une commande par trait au plus, pas une par case survolée) et le relâchement est le premier instant où il est connu ; l'effet visible ne dépend pas de l'aller-retour.
- **Prédiction** : au relâchement, `localStroke` retire les cases refusables, puis `predictTerrainEdits` (contrat partagé, `packages/contracts/src/terrain-edits.ts`) calcule les sommets écrits, unité par unité, avec `terrainEditUnit`, **la fonction même de l'admission serveur** (`vertexLeveling` d'une case). `TerrainStore.predict` copie et corrige les chunks en cache qui portent ces sommets (les deux chunks pour un sommet de bord) et les publie comme un changement de sol : c'est le chemin d'une modification serveur (révision de sol, `changed`, file du rendu). Le pinceau, la pipette et les traits suivants lisent ce relief prédit.
- **Rendu** : la signature de sol d'une unité de rendu (4 × 4 cases) ne couvre plus que les sommets qu'elle lit (`rc1VertexUnitSignature`) ; une modification reconstruit 1 à 4 unités au lieu des 64 du chunk, pour les réponses serveur aussi.
- **Réconciliation** : les chunks prédits sont **tenus** jusqu'à la réponse : une réponse déjà en route est écartée (elle précède la prédiction) et aucune n'est demandée, pour que la prédiction ne clignote pas. À la réponse (appliquée, partielle, refusée ou en échec), `release` relit le chunk : le terrain serveur remplace la prédiction, une case refusée revient à sa hauteur réelle, une réponse égale ne redessine rien. Une prise sans réponse expire après 30 s.
- **Ordre** : une commande à la fois (`TerrainEditQueue`) pour que le serveur applique les traits dans l'ordre où ils sont peints ; les traits relâchés pendant un envoi partent ensemble ensuite (32 gestes, 1 024 cases au plus). Un chunk touché par plusieurs traits reste tenu jusqu'à la dernière réponse.
- **Coût mesuré** (Node, NullEngine, deux chunks de 32 cases, trait de 30 cases à cheval sur leur bord, 20 essais) : `predict` 1,6 ms en médiane ; remise en file du rendu 12,7 ms en médiane (19,1 avant) ; 8 unités reconstruites (128 avant) ; remise en file et reconstruction 60 ms p95 au total (118 avant), étalées sur le budget d'images du rendu. Une fois par trait, jamais par image. **Mesure navigateur à faire** (§7.8).

### 7.3 Refus partiel côté serveur
- **Grain** : l'unité est la **case peinte** d'un geste libre, exactement celle dont la zone 3 × 3 est en conflit, ou l'**emprise entière** d'un nivellement (une université ne se nivelle pas à moitié). Un geste refusé en bloc avant toute lecture (sélection invalide, limite d'instances, monde sans sommets partagés) compte pour une unité. Restent globaux : monde non RC1 (409), coordonnées non canoniques (400), lot trop grand (400), identifiant réutilisé.
- **Ordre** : gestes dans l'ordre du lot, cases peintes dans l'ordre canonique de `terraformCells` (x puis y), chacune sur le terrain laissé par les unités **acceptées** avant elle. Une unité refusée n'écrit rien, même sur un sommet partagé. Les unités acceptées d'un trait aboutissent exactement aux hauteurs de la version tout-ou-rien (toutes à la hauteur du geste ; un sommet partagé entre gestes prend celle du dernier geste accepté). Tests d'intégration : lot partiel, case refusée au milieu d'un trait, unité refusée sur un sommet partagé.
- **Cause** : le code est celui que `assertBuildableCells` lèverait (infrastructure de n'importe quelle case d'abord, puis passage engagé, puis le sol case par case) ; `at` nomme la case de l'obstacle (la case peinte si elle est elle-même refusée, sinon la case de l'anneau), la case mouillée, ou la fondation qui bougerait. Lecture **unique** des refus par case pour tout le lot (`buildableCellRefusals`, `infrastructureCellRefusals` : formes par case des contrôles existants, sous le même verrou consultatif ; test d'équivalence avec `assertBuildableCells` seul). Sur un monde à sommets partagés, le raccord à l'eau et la fondation se lisent sur les hauteurs des sommets au lieu de reconstruire un champ par unité (même résultat : un échantillon pris à un sommet est sa hauteur, et les échantillons d'une fondation ne bougent que si un de ses coins bouge).
- **Contrat** (`TerrainEditsResult.refused`, codes `TERRAIN_EDIT_REFUSAL_CODES`) et compatibilité : [SPEC-TERRAFORMATION-INSTANTANEE.md §2](SPEC-TERRAFORMATION-INSTANTANEE.md). Rien d'écrit et un refus : 409 inchangé pour un ancien client, avec la liste en plus. Pas de nouvelle route (`command-inventory.json` inchangé), **pas de migration** (le reçu 078 garde le JSON du résultat), invariants inchangés (village d'abord, `statement_timestamp()` après acquisition, idempotence par `commandId`, `world_id`).

### 7.4 Règles client
Par case peinte (`unitRefusal`, au plus 9 accès d'ensemble) : la case elle-même, puis son anneau, infrastructure avant le sol. Les cases refusables sont retirées d'emblée et dites par l'Oracle ; le reste part (l'ancre devient la première case acceptée si la sienne est retirée). Hauteur ≤ 0 : le trait entier est refusé, une seule erreur (eau). Une réponse serveur `INFRASTRUCTURE_OCCUPIED` est lue comme un aménagement quand le client ne connaît pas de route à cette case.

### 7.5 Pages de l'Oracle
Une page par erreur ; une erreur = une raison à une case d'obstacle (deux cases peintes bloquées par la même case de route : une erreur). Ordre : route, aménagement, bâtiment, fondation, équipe, eau, nature, portée, monde, autre, puis ordre d'apparition. Textes du §4 inchangés, au singulier ; la ligne « Ailleurs dans ce geste… » disparaît. Les refus locaux et serveur s'ajoutent aux pages ouvertes. `OraclePager` (`ui/OraclePager.tsx`, réutilisable ; `ReleaseNotesDialog` non migrée dans cette tranche) : « ‹ 1/X › », ← →, glissé horizontal d'au moins 40 px et plus horizontal que vertical, sans boucler aux extrémités. « Inspecter » vise la page courante et laisse la boîte ouverte ; « Compris » (ou Échap) ferme l'ensemble. Tests `OraclePager` (bornes, touches, seuil du glissé, rendu).

~~Proposé, non tranché : fusionner les erreurs identiques sur des cases contiguës~~ : tranché le 2 novembre pour l'eau (§7.11).

### 7.6 Inspecter fait pulser l'obstacle
La caméra de `inspectCell`, et l'obstacle pulse **trois fois** dans le rouge de démolition : `DemolitionTint`, l'effet même des cibles désignées, dans sa propre instance (une démolition en attente n'est pas touchée), cycle redémarré pour que les trois pulsations (3 × 1,2 s) commencent et finissent éteintes. Route : la peau rouge des pixels de route de la case ; bâtiment ou fondation : copies teintées du bâtiment de la case ; aménagement : une plaque rouge sur la case. Sans entité : eau, portée, monde, équipe de passage, bâtiment d'un autre village (non dessiné ici) : la caméra seule. Sol (arbre, rocher, clairière protégée) : halo rouge au sol depuis le 2 novembre (§7.12).

### 7.7 Points ouverts
- ~~**Annulation**~~ : tranché le 2 novembre, Ctrl+Z en geste inverse et bouton « Annuler » (§7.10).
- ~~Fusion des erreurs identiques contiguës~~ : l'eau est fusionnée (§7.11) ; les autres raisons gardent une page par case d'obstacle.
- ~~Le trait en cours garde l'aperçu translucide~~ : remplacé le 2 novembre par le trait vivant (§7.9), l'aperçu est retiré.
- ~~Arbres et rochers ne pulsent pas~~ : halo rouge au sol, option B du 2 novembre (§7.12).

### 7.8 Vérification
Faits (codes de sortie vérifiés) : intégration `terrain-edits` 10/10 sur la base de test (lot partiel et rejeu du reçu, case refusée dans un trait, unité refusée sur sommet partagé, refus total 409 avec la liste, classification par case égale à `assertBuildableCells` seul, plus les cas existants : ordre, sans effet, emprise, rollback, douves), `client-protocol.integration` 4/4, `command-inventory.integration` 1/1 ; unitaires : contrats `terrain-edits`, `errors`, `terraform-brush`, `terrain-store`, `terrain-renderer`, `terrain-edits` (file d'envoi), `OraclePager`, `terraform-draft`, `terraform-refusals`, `terraform-tool`, `terraform-preview`, `tool-presentation`, tests `api` du client ; `tsc` API et client, ESLint, Prettier. Sérialisation de `refused` par le schéma de réponse Fastify vérifiée par un essai jetable. Aucune recette navigateur faite.

Recette navigateur restante (dev local, monde à sommets partagés) :
1. Survol : 3 × 3 sans aucune diagonale (lignes et remplissage), centre opaque, fondu jusqu'au bord ; rouge près d'une route ; bleu en pipette.
2. Trait valide : le sol change au relâchement, sans attente ; aucun Annuler/Confirmer pour la terraformation ; la démolition garde sa paire.
3. Trait qui touche une route : les cases libres changent, celles dont le 3 × 3 touche la route restent ; l'Oracle montre une page par obstacle, « 1/X », ← →, glissé au doigt ou à la souris.
4. Refus serveur (route d'un village voisin, fondation) : la case prédite revient à sa hauteur ; la page nomme l'obstacle.
5. Inspecter : caméra proche et basse ; route, bâtiment ou aménagement : trois pulsations rouges puis retour normal ; eau ou portée : caméra seule.
6. Traits rapides successifs : appliqués dans l'ordre, sans clignotement du relief.
7. **Mesures exigées** (AGENTS.md, code exécuté par image et par geste) sur Bressuire : village prêt à froid et à chaud ; 60 s de survol continu en mode Terraformation (aucune image > 100 ms attendue) ; coût d'une prédiction et de la reconstruction qui suit pour un trait de 30 cases (profil Performance : `TerrainStore.predict`, `TerrainRenderer.demand`, `buildRc1TerrainUnit`), comparé au même trait avant la tranche.

### 7.9 Trait vivant : le sol change pendant le geste (2 novembre)

Décision de Tristan (validé, 2 novembre) :

> « Instantané à mon sens, c'est même pas au relâchement du geste, c'est pendant le geste. Tu dessines ton terrain vraiment en temps réel. »

Conception : **proposé, implémenté** (branche `terraform-live`). Remplace, pour le trait, l'envoi et la prédiction au relâchement du §7.2 ; la réconciliation (`release`) et le refus partiel (§7.3) sont inchangés, le serveur n'est pas modifié.

- **Case par case** (`ui/terraform-live.ts`, `LiveStroke`) : chaque case nouvellement peinte, et la case sous le pointeur quand le réglage change pendant le trait (↑ ↓, + −), est une unité appliquée tout de suite sur le sol affiché, dans l'ordre du pointeur (`cellsAlongSegment`, puis la case courante). Repeindre une case à la même hauteur ne fait rien tant que la hauteur n'a pas changé (une case repeinte à une autre hauteur, puis à la première, est réécrite, comme le ferait le serveur). Une case refusable localement (`unitRefusal`) n'est pas appliquée ; hauteur ≤ 0 : une seule erreur d'eau pour le trait ; sol non chargé : non envoyée, bulle « Les raccords dépassent le terrain visible ».
- **Oracle à la fin du trait** : les refus locaux et ceux que le serveur renvoie pendant le trait (`TerrainEditQueue.stroke`) sont gardés jusqu'au relâchement, puis montrés ensemble (locaux d'abord). Raison : une boîte qui surgit sous le pointeur interromprait le geste et volerait le glissé ; pendant le trait, le réticule rouge et la case qui ne bouge pas disent déjà le refus, l'explication vient dès que la main est levée.
- **Même ordre que le serveur** : le serveur applique les gestes dans l'ordre du lot et les cases d'un geste dans l'ordre canonique (x puis y). `orderedTerrainEditGestures` (contrat partagé) coupe donc les unités en gestes d'une seule hauteur dont les cases croissent strictement dans cet ordre (256 au plus) : l'ordre d'application serveur est exactement l'ordre peint. Chaque unité est prédite par `terrainEditUnit`, la fonction de l'admission, sur les hauteurs laissées par les précédentes. Test (`terrain-edits.test.ts` du contrat) : 20 traits pseudo-aléatoires de 200 cases traversant la couture du tore, avec changements de hauteur et cases repeintes, coupés en deux commandes à un endroit quelconque : l'ordre serveur reconstruit est l'ordre peint, et `predictTerrainEdits` des gestes envoyés donne exactement les hauteurs de la peinture case par case.
- **Envoi progressif** (choisi) : les unités partent pendant le trait, par petits lots ordonnés ; une commande à la fois, au plus une toutes les 150 ms (`SEND_INTERVAL_MS`), qui emporte tout ce qui a été peint entre-temps (32 gestes, 1 024 cases au plus par commande ; une image n'est jamais coupée entre deux commandes). Idempotence par `commandId` inchangée. Pourquoi plutôt qu'au relâchement : le serveur confirme au fil du trait (une case refusée par lui revient pendant le geste, pas après), un long trait ne finit plus en une grosse commande, et la limite de 256 cases par trait disparaît (elle tient par geste). Coût borné : au plus ~7 commandes par seconde par joueur qui peint, aucune quand il ne peint pas.
- **Tenue et réconciliation** : chaque image prédite tient ses chunks (`predict` → clés) jusqu'à la réponse de la commande qui l'emporte, puis `release`. Un chunk peint en continu reste tenu tant qu'une image non confirmée le touche ; il est relu une fois la dernière confirmée. Le flux du village ne relit plus que les chunks dont un sommet a bougé (`TerrainStore.observe`, diff des `vertexHeights`) et jamais un chunk tenu : avant, chaque commande appliquée relisait et remettait en file tous les chunks du village.
- **Bornes par image (chemin chaud)** : les cases d'une même image sont coalescées ; au plus 16 unités par image (`LIVE_CELLS_PER_FRAME`) et **une seule** prédiction (une copie de chaque chunk touché), le reste à l'image suivante dans l'ordre. La prédiction ne marque plus le chunk « changé » : elle note les sommets touchés (`TerrainStore.groundEdits`) et le rendu remet en file, à chaque image, **les seules unités de sol** qui lisent ces sommets (`TerrainRenderer.queueGroundEdits`, priorité la plus haute), sans relire les autres unités, le décor ni les entités du chunk ; la reconstruction reste plafonnée par le budget d'admission (1 ms, au moins une unité par image). La signature mutable d'un chunk prédit n'est plus calculée à chaque prédiction mais à la comparaison avec la réponse.
- **Aperçu retiré** : le sol réel montre le trait ; `TerraformPreview`, `terraformSelectionVisual`, `footprintTerraformVisual` (déjà sans appelant) et `localStroke` sont supprimés. Seul reste le réticule 3 × 3 sous le curseur, inchangé (sans diagonales), redessiné quand le sol change sous lui.
- **Tests déterministes du travail par image** : `terraform-live.test.ts` (un trait de 60 cases en une image : une prédiction par image, au plus 16 cases, 3 images de rattrapage, ordre peint, hauteurs égales à celles du serveur ; refus et eau dits à la fin ; repeinte à une autre hauteur) ; `terrain-renderer.test.ts` (trait rapide de 30 images sur un chunk de 200 arbres : au plus une unité de sol reconstruite par image, **aucune lecture des entités du chunk**, aucun chunk marqué changé, puis une passe complète ne trouve rien à reconstruire) ; `terrain-store.test.ts` (prédiction notée en sommets sans marquer le chunk, relecture limitée aux chunks dont un sommet a bougé, jamais un chunk tenu) ; `terrain-edits.test.ts` côté interface (gestes dans l'ordre peint, cadence bornée, refus serveur gardés jusqu'à la fin du trait).
- **Mesure Node** (NullEngine, deux chunks de 32 cases, trait rapide de 3 cases par image en aller-retour sur leur bord, 600 images, après échauffement, deux séries) : application d'une image (refus locaux, unités, prédiction) médiane 0,7–0,85 ms, p95 1,3–1,8 ms ; remise en file des unités touchées médiane 0,15 ms, p95 0,3–0,4 ms, max < 0,7 ms ; admission du rendu médiane 0,7 ms, p95 1,0 ms ; total par image médiane 1,7–1,9 ms, p95 2,4–3,1 ms ; file vide en fin de trait. **Avant** (même trait vivant par l'ancien chemin : chunk marqué changé, remise en file complète toutes les 100 ms) : remise en file p95 4,4–5,4 ms, max 7–18 ms par passe, total par image p95 6,2–7,0 ms, sur des chunks **sans** entités (la passe complète croît avec les arbres d'un chunk, la nouvelle n'en dépend pas). Les maxima isolés de 10 à 20 ms des deux modes sont des pauses du ramasse-miettes de Node. **Mesure navigateur à faire** (ci-dessous).

Recette navigateur restante (dev local, monde à sommets partagés, Bressuire) :
1. Trait lent puis rapide : le sol monte ou descend sous le pointeur pendant le geste, sans attendre le relâchement ; pas d'aperçu translucide, seul le réticule 3 × 3.
2. ↑ ↓ pendant le trait : la case sous le pointeur et les suivantes prennent la nouvelle hauteur.
3. Trait qui longe une route : les cases libres changent pendant le geste ; l'Oracle n'apparaît qu'au relâchement, une page par obstacle.
4. Refus serveur pendant le trait (route d'un village voisin) : la case revient pendant le geste ; la page arrive au relâchement.
5. Long trait (plus de 256 cases) : accepté ; onglet Réseau : commandes espacées d'au moins 150 ms, une seule en vol.
6. **Mesure exigée** (AGENTS.md) : 60 s de trait continu sur Bressuire, profil Performance : aucune image > 100 ms une fois le village prêt ; coût par image de `LiveStroke` (application), `TerrainStore.predict`, `TerrainRenderer.queueGroundEdits` et `buildRc1TerrainUnit` ; village prêt à froid et à chaud.

Tranchés depuis (2 novembre) : annulation d'un trait (§7.10), fusion des erreurs d'eau (§7.11), halo des arbres et rochers (§7.12).

### 7.10 Annulation par geste inverse (2 novembre)

Décision de Tristan (validé, 2 novembre) :

> « Fusionne les erreurs d'eau, et Ctrl+Z en geste inverse avec un bouton "Annuler" en haut à droite, qui disparaît au bout de 10 secondes. Le geste Ctrl+Z reste possible passé ce délai. »

Conception : **proposé, implémenté** (branche `terraform-undo` sur `wip/v2-commandes-bornees`).

- **Ce qu'on annule** : le dernier trait **relâché**. Chaque trait laisse un enregistrement (`ui/terraform-undo.ts`, `TerraformUndoRecord`) : ses cases peintes dans l'ordre et, pour chaque sommet que sa prédiction écrit, la hauteur que le client montrait juste avant (la première fois que le trait le touche ; lue avant que la prédiction ne s'applique, donc après réconciliation des traits déjà confirmés). Une case refusée par le serveur sort de l'enregistrement (`TerrainEditQueue` prévient le propriétaire de l'image : rien à annuler) ; une case refusée localement n'y est jamais entrée. Aucune copie de chunk : seulement les sommets touchés.
- **Geste inverse** : Ctrl+Z dépile l'enregistrement et envoie un **nouveau geste**, chaque case du trait ramenée à ses quatre hauteurs d'avant (un coin que le trait n'a pas écrit garde sa hauteur actuelle ; une case déjà revenue est omise). Il est **vivant** comme un trait : `LiveStroke.restore`, mêmes images (16 unités au plus par image, une prédiction), mêmes refus locaux (`unitRefusal`), même file d'envoi (une commande en vol, ≥ 150 ms), mêmes pages de l'Oracle à la fin, refus serveur compris. Il n'est pas lui-même empilé (pas de « rétablir »).
- **Pile** : par village, en mémoire, **20 traits** au plus (le plus ancien tombe) ; vidée au changement de village. Ctrl+Z répété remonte la pile. Pas de Ctrl+Y (point ouvert ci-dessous).
- **Raccourci** : Ctrl+Z ou Cmd+Z, sans Maj ni Alt, **dès que le village est affiché**, outil de terraformation actif ou non (le bouton disparaît après 10 s mais Ctrl+Z doit rester possible, y compris après être passé à un autre outil), hors champ de saisie et quand aucun dialogue (`role="dialog"`, `alertdialog`) n'a le focus ; ignoré pendant un trait en cours (on annule un trait relâché). Pile vide : « Aucun trait de terraformation à annuler. »
- **Bouton** : « Annuler N s » en haut à droite, le composant de la démolition (`CountdownCancelButton`, rendu sans « Confirmer ») dans la même région `.harvest-cancel` que la récolte et la démolition, pour un seul emplacement et un seul style. 10 s après chaque trait relâché (délai redémarré à chaque nouveau trait), caché une fois utilisé. En mode exploitation, la région appartient au « Annuler » de la récolte : le bouton de terraformation y est masqué, Ctrl+Z reste possible.
- **Contrat** : un geste de peinture fixe les **quatre coins à une seule hauteur** ; la dernière case écrite d'une suite de peintures a donc toujours quatre coins égaux, et un sol naturel en pente ne peut pas être restitué par des peintures (test `terrain-edits.test.ts` du contrat). Ajout d'une forme de geste, **sans nouvelle route ni migration** :
  `{ buildingType: 'terrain-restore', cells: [{ cellX, cellY, corners: [h00, h10, h11, h01] }] }` (1 à 256 cases, ordre de `cellVertices`, hauteurs bornées à ±1 024, arrondies au 1e-6 des hauteurs stockées). Chaque case est une **unité** au sens du §7.3, traitée dans l'ordre donné, sans doublon (doublon ou case hors du monde : geste refusé en bloc `INVALID_TERRAFORM_SELECTION`, coordonnée non canonique : 400 global comme une ancre). `terrainRestoreUnit` (contrat partagé) calcule ses sommets, son 3 × 3 et son volume comme `terrainEditUnit` ; serveur et prédiction l'emploient.
- **Admission** (`terrainEditsCommandV2`, inchangée par ailleurs : village d'abord, `statement_timestamp()` après acquisition, idempotence par `commandId` sur la forme canonique de la restauration, `world_id`, reçu 078) : une case **sans effet** n'est pas un refus et se vérifie **avant** les obstacles (une case de route ramenée à ses propres hauteurs n'est pas refusée) ; puis les règles d'une case peinte : la case puis son anneau (`buildableCellRefusals`, infrastructure d'abord), l'eau sur la surface (les 81 échantillons interpolés aux hauteurs restituées) et aux raccords, la fondation voisine. Le serveur ne fait pas confiance aux « hauteurs d'avant » du client : c'est une modification de terrain comme une autre, aux mêmes règles. Monde sans sommets partagés : `LEVELING_UNAVAILABLE`.
- **Compatibilité** : forme ajoutée à l'union du corps, sans changement d'en-tête ni de route (`command-inventory` inchangé). Un ancien onglet ne l'envoie jamais. Un nouveau client face à un ancien serveur (fenêtre de déploiement du monolithe) reçoit un 400 de validation, montré comme un avertissement avec le message du serveur ; pas de 426. Validation Fastify vérifiée par un essai jetable (`inject`) : corps mixte peinture + emprise + restauration intact, 3 coins ou hauteur 5 000 : 400.
- **Conflit (choix, point ouvert)** : si le terrain a changé entre-temps (autre trait, autre joueur), le geste inverse restaure quand même les hauteurs mémorisées : c'est une peinture comme une autre. Alternative possible : n'annuler que les sommets encore à la hauteur que le trait a laissée.
- **Limites connues** : la « hauteur d'avant » est celle que le client affichait ; si un trait précédent était encore en vol et que le serveur en refuse ensuite une case touchée aussi par ce trait, l'annulation viserait la hauteur prédite (refusée) ; le serveur la refuserait en principe pour la même cause. Une annulation pendant que les réponses du trait sont en route envoie aussi les cases que le serveur refusera : leurs coins sont déjà à la hauteur d'avant, donc sans effet, sans page.

Ouvert : rétablir (Ctrl+Y / Ctrl+Maj+Z) — non fait ; il faudrait empiler le geste inverse comme un trait (simple) mais aussi décider si un trait nouveau vide la pile de rétablissement. Taille de la pile (20) et message de pile vide à relire.

### 7.11 Fusion des pages d'eau (2 novembre)

Décision citée au §7.10 (validé). Implémenté : `mergeWaterPages` (`ui/terraform-refusals.ts`), appliqué par l'App à chaque arrivée de pages (refus locaux à la fin du trait, puis refus serveur gardés jusque-là, ou refus d'un geste inverse) sur les pages ouvertes.
- Les pages d'**eau** dont les cases se touchent sur le tore, **diagonales comprises** (8-voisinage : un trait en diagonale le long d'une rive est une seule rive ; en 4-voisinage il ferait une page par marche d'escalier), deviennent une page, à la place de la première ; les autres pages gardent leur ordre. Une page arrivée plus tard rejoint son groupe (la page fusionnée garde la liste de ses cases).
- Portée : les pages **ouvertes ensemble**. Les refus locaux et serveur d'un trait arrivent en deux temps et doivent être fusionnés sur la liste ouverte ; deux traits successifs dans le même lac, dialogue encore ouvert, donnent aussi une seule page (même lac, même phrase) : choix assumé plutôt qu'un marquage par trait.
- **Inspecter** vise la case du groupe la plus proche de son **centre** (moyenne des décalages sur le tore depuis la première case) : une vraie case mouillée, au milieu de l'eau rencontrée, plutôt que la première (bord du groupe) ou un point du centre qui tomberait hors de l'eau dans un groupe courbe.
- Coût : indexé par case, O(cases × 9), une fois par arrivée de pages. Test `terraform-refusals.test.ts` (diagonale et couture du tore, centre, page tardive, cases distantes).

### 7.12 Halo rouge au sol sous « Inspecter » (2 novembre)

Décision de Tristan (validé, 2 novembre, transmise par la coordination) : pour un refus dû à un arbre ou un rocher (instances fines, non teintables seules), **option B, « le halo rouge au sol »**.
- Raison `nature` (arbre, rocher, clairière protégée) → obstacle `nature` : `InspectHalo` (`scene/inspect-halo.ts`) pose l'anneau « Onde » des halos de récolte (`HaloMarkerPlugin` au repos, empreinte qui suit le sol de `resource-halos.ts`) en rouge (`HALO_MARKER.clearColour`), **au pied de l'arbre ou du rocher** de la case le plus proche de son centre (`natureFoot`, géométrie RC1 des entités naturelles), au centre de la case sinon (clairière, entité inconnue).
- **Trois pulsations**, même durée et même rythme que `DemolitionTint` (3 × 1,2 s, 0,5 − 0,5·cos, éteint au début et à la fin) : la pulsation est l'opacité partagée que le greffon lit au moment de lier le matériau ; rien d'autre ne tourne par image. Un seul maillage et un seul matériau temporaires, créés à l'inspection, libérés après la dernière pulsation (minuterie) ou par l'inspection suivante ; suivent le recentrage de l'origine.
- Test `inspect-halo.test.ts` (NullEngine) : trois pics, éteint au début et à la fin ; un maillage et un matériau créés, libérés à l'échéance, une seule minuterie ; pied de l'arbre le plus proche du centre, couture du tore, centre par défaut.

### 7.13 Vérification (§7.10 à §7.12)

Faits, codes de sortie vérifiés : intégration `terrain-edits` 12/12 sur la base de test (dont restauration d'un trait à l'identique, coins à quatre hauteurs différentes, rejeu par `commandId` et `COMMAND_REUSED` ; refus partiel d'une restauration près d'une route, refus total 409 avec la liste, fondation, doublon ; case de route ramenée à ses propres hauteurs non refusée — **rouge** si la vérification d'effet est déplacée après les obstacles), `client-protocol.integration` 4/4, `command-inventory.integration` 1/1 ; unitaires contrat `terrain-edits` (9), `terraform-undo` (8 : restauration exacte, pile remontée, refus serveur, case déjà revenue, borne de 20, refus local, raccourcis, borne de 16 unités par image), `terraform-refusals`, `terrain-edits` (file : geste de restauration, propriétaire prévenu), `inspect-halo` ; tous les tests `apps/world-web/src` (140 fichiers, 722 tests) ; `tsc` API et client, ESLint des fichiers touchés, Prettier. **Aucune recette navigateur faite.**

Recette navigateur restante (dev local, Bressuire) :
1. Trait relâché : « Annuler 10 s » en haut à droite, décompte ; un nouveau trait le relance ; il disparaît à 10 s.
2. Annuler (bouton) ou Ctrl+Z : le sol revient pendant l'annulation, case par case, sans clignotement ; Ctrl+Z répété remonte les traits précédents ; Ctrl+Z après 10 s, et depuis un autre outil, fonctionne.
3. Ctrl+Z dans un champ de saisie ou avec la boîte de l'Oracle ouverte : rien.
4. Route posée sur une case du trait avant Ctrl+Z : la case reste, l'Oracle l'explique, Inspecter fait pulser la route.
5. Trait plongé dans un lac : une seule page d'eau ; Inspecter vise le milieu de l'eau.
6. Refus à cause d'un arbre ou d'un rocher : Inspecter pose un anneau rouge à son pied, trois pulsations, puis rien.
7. **Mesure exigée** (AGENTS.md) : une annulation d'un trait de 60 cases sur Bressuire, profil Performance : aucune image > 100 ms ; coût par image de `LiveStroke` et `TerrainStore.predict` comparable à un trait.