# Revue de la spec streaming terrain

Date : 30 septembre 2026. Base : `main`, `0a0873a`.
Objet : [SPEC-STREAMING-TERRAIN.md](SPEC-STREAMING-TERRAIN.md), proposition non implémentée.
Conclusion de la revue initiale : **direction adaptée, spécification à compléter avant implémentation**.

Revue par lecture de la spec et du code. Aucun test applicatif ou navigateur exécuté ; les scénarios ci-dessous sont des risques d'intégration identifiés, pas des défauts reproduits d'un streamer existant. La revue initiale n'a pas réécrit la spec ; la correction documentaire demandée ensuite par Tristan est suivie ci-dessous.

## Suivi d'implémentation — 1er octobre 2026

Tristan a autorisé l'implémentation après la correction documentaire. La lecture serveur et le streamer existent dans le worktree ; les constats de la revue initiale ci-dessous décrivent l'ancien code.

Retour de recette ultérieur : 60–90 s avant le premier arbre et rechargement du sol après zoom/rotation. Deux régressions ont échoué avant correction : bosquet proche affamé par la file globale sol/cailloux, et destruction des tuiles au changement de masque caméra. La file passe maintenant par bandes de proximité et conserve les tuiles construites jusqu'à l'éviction du résident. `/terrain/updates` revalide uniquement features/occupations, sans lire `world_chunks` ni transférer les tableaux immuables. Les **7 tests API et 18 tests client** sont verts ; le parcours zoom/déplacement/rotation/dézoom donne **2,2 s sur ordinateur et 1,7 s en profil mobile**, avec un seul téléchargement du sol du chunk et des refreshs HTTP réussis après 15 s. Ces mesures d'apparition sont distinctes des percentiles CPU ci-dessous. Les dernières preuves mémoire/fluidité et leurs limites figurent en tête du handoff.

| Réserve | Preuves d'implémentation obtenues |
| --- | --- |
| R1 | 7 tests API : autorisations/bornes/halo, refresh sans tableaux ni lecture des chunks immuables, absence de mutation économique, lecture cohérente avec mutation forcée entre requêtes SQL sur les deux routes. Store : invalidation en vol, révisions et tombstones, scopes complets vides, polling visible, footprints, incarnation, reprise et rétention bornée, retour après 15 s sans retélécharger le sol. Chaque réponse détail/commande pierre rejoint impérativement le store. |
| R2 | Parcours Chromium ordinateur/mobile : même ID de figurant, masquage hors sol affiché, reprise à la phase courante comparée à l'heure serveur ; chemins debug réaffichés. Aucun crédit déclenché par le rendu. |
| R3 | Tests de transformation/inverse avec ancre non centrale, emprises compactes et trajets continus aux coupures ; navigateur : tour complet sur chaque axe, quatre coins, retour et picking réel du bâtiment avant reconstruction du village. |
| R4 | Régression rétrospective isolée : ancien défaut = 32 résidents pour plafond 16 ; correction prouvée sur 30 déplacements et libération Babylon. Régressions rouges puis vertes : arbres proches avant sol/cailloux lointains et conservation des tuiles lors des rotations. Mémoire Intel après correction : 26,91 → 27,20 → 27,44 Mio sur 18 déplacements réels, reload 17,56 ; plafonds 64 données / 16 résidents + réserve 17. Mesure finale Intel verte : intégration P95 1,8 / 0,1 / 0,2 ms, actif 3,4 / 0 / 5 ms ; streamer max 22,4 ms ; frame P95 pan 35,3 ms face à 39 ms préchargé. Admission 1 ms, aucune erreur navigateur. |

**À recetter humainement :** raccords/fondu en vue rasante et au dézoom maximal, geste/preview pendant un changement de repère, téléphone physique. Les résultats matériels verts n'effacent pas l'essai logiciel : SwiftShader dépassait le seuil sur les frames actives et sa cadence restait lente, malgré une mémoire bornée. Le percentile par frame inclut désormais toute la période ; la distribution active et tous les maxima sont publiés séparément. Les bâtiments des autres villages restent hors scope. Résultats détaillés, commandes et état Git dans le [handoff](../SESSION-HANDOFF.md).

## Suivi de correction — 30 septembre 2026

Les quatre réserves ont reçu une réponse dans les sections R1–R4 de la spec et dans ses critères d'acceptation. **Corrigées au niveau documentaire, à démontrer par l'implémentation et la recette** ; aucun test applicatif n'est revendiqué. La tranche reste une proposition à valider avant implémentation.

| Réserve | Réponse dans la spec |
| --- | --- |
| R1 | Store spatial propriétaire, listes complètes par intérieur, révisions des gisements, requêtes sérialisées par chunk et gardes d'invalidation/incarnation ; lecture serveur cohérente ; revalidation du visible toutes les 5 secondes et après transitions/retour au premier plan. |
| R2 | Chemins canoniques conservés, projections invalidées par terrain et repère, progression de mission conservée ; masquage contrôlé lorsque le sol n'est pas affiché. |
| R3 | Conversion commune monde/scène et inverse pour le picking, déroulement continu des emprises/trajets, changement de repère atomique avec caméra et marqueurs ; tests d'ancre non centrale et de sélection réelle. |
| R4 | Rayon initial de 64 cellules, cache de 128 chunks, résidence graphique de 64 chunks avec réserve et rétention bornée en erreur ; intégration progressive, file dédupliquée et critères chiffrés de fluidité. |

Les constats ci-dessous sont conservés comme justification des corrections, pas comme liste de réserves documentaires encore ouvertes.

## R1 — Priorité haute : protocole de fraîcheur incomplet

Sections concernées : contrat serveur et cache, notamment la règle « le snapshot courant prévaut sur des données évolutives plus anciennes ».

Le contrat proposé n'indique pas comment comparer les données évolutives entre réponse de chunks, snapshot village, détail et commande. `StoneDepositSchema` expose déjà une `revision`, mais la liste d'occupations n'a pas de révision équivalente. L'absence d'une feature du snapshot fixe ne signifie pas sa suppression dans un chunk distant. Or `changedStoneFeatures()` traite actuellement toute absence de la liste entrante comme une suppression.

Scénario : une réponse terrain ancienne arrive après une extraction ou une construction ; elle peut restaurer un rocher ou du décor. Autre scénario : un snapshot village arrive après le chargement d'un chunk distant et retire ses gisements si le renderer réutilise son mécanisme actuel de remplacement de liste.

Le rafraîchissement proposé se limite aux entrées de zone, retours et commandes. Une extraction qui se termine pendant que la caméra reste immobile hors de la région initiale n'est pas couverte. `App.refresh()` recharge uniquement le snapshot fixe ; l'appel `loadDeposit()` dépend de la sélection et des commandes, pas d'un rafraîchissement spatial périodique. Les changements causés par un autre village présentent le même problème.

À préciser :

- un propriétaire explicite des données évolutives fusionnées et la portée complète de chaque liste ; absence hors portée = aucune information, pas suppression ;
- comparaison par révision des gisements, y compris ceux issus des détails et commandes ;
- remplacement atomique des occupations par chunk avec protection contre les requêtes antérieures à une invalidation, et règle de cohérence entre occupations et features dans une réponse ;
- cadence bornée de revalidation des chunks visibles immobiles, invalidation à la fin d'une mission et au retour au premier plan ;
- tests avec réponse terrain retardée après une commande, snapshot ne couvrant pas un gisement distant et épuisement sans mouvement de caméra.

Références : `packages/contracts/src/villages.ts` (`StoneDepositSchema`), `apps/world-web/src/scene/deposit-visuals.ts` (`changedStoneFeatures`), `apps/world-web/src/App.tsx` (`refresh`, `loadDeposit`, `startExtraction`).

## R2 — Priorité moyenne : chemins et figurants ne sont pas invalidés par le terrain

La spec exige une hauteur lue dans le terrain disponible sans expliquer comment mettre à jour une mission déjà affichée.

`#pathPoints()` utilise actuellement une hauteur nulle hors de `state.region`. `#updateExtractionPeople()` conserve le chemin projeté tant que l'ID de mission existe ; `#updateHarvestPeople()` dépend de la signature métier de la récolte. La signature de `#updateTravelPaths()` ne dépend ni du terrain chargé ni du repère, et ses segments sont filtrés sur la région fixe.

Scénario : un trajet est projeté avant l'arrivée d'un chunk en relief. Le chunk apparaît, mais le figurant garde ses anciennes hauteurs et le chemin debug reste tronqué à la région initiale. Déplacer seulement le mesh du figurant lors d'un changement de repère ne suffit pas : la frame suivante le replace depuis son ancien chemin.

À préciser : conserver le trajet canonique, recalculer sa projection/hauteur lorsque les chunks nécessaires ou le repère changent, sans recréer la mission ni repartir au début de son animation. Invalider le rendu debug sur les mêmes événements. Fixer la règle pour une portion encore inconnue ou évincée. Ajouter un test d'arrivée tardive d'un chunk élevé pendant une mission, puis d'éviction et retour.

Référence : `apps/world-web/src/scene/BabylonVillageScene.ts`, méthodes `#pathPoints`, `#updateTravelPaths`, `#updateExtractionPeople`, `#updateHarvestPeople`.

## R3 — Priorité moyenne : transformation du tore incomplètement définie

La spec prévoit de repositionner terrain, village et figurants lors du changement de repère. Le picking, les previews, la grille et les marqueurs utilisent aussi les coordonnées locales et doivent partager exactement la même transformation inverse.

Le code actuel projette les cellules par rapport à l'ancre du village, et `#gridPointAtPointer()` reconvertit les rayons avec cette même ancre. `#wrapCamera()` réenveloppe la cible autour de la demi-largeur/hauteur du monde. Cette coupure de représentation n'est pas toujours située à la coordonnée canonique zéro : elle dépend de l'ancre.

À préciser : une convention commune de projection monde → scène et scène → monde, la représentation continue des segments voisins sur le tore et les objets invalidés/repositionnés. Tester à la fois les frontières canoniques et la coupure opposée à une ancre non centrale, dans les deux sens. Vérifier les coordonnées réellement sélectionnées après le passage, pas seulement une capture de terrain raccordé.

Référence : `apps/world-web/src/scene/BabylonVillageScene.ts`, `#gridPointAtPointer`, `updateAreaSelection`, `updateHarvestPending`, `#wrapCamera`.

## R4 — Priorité moyenne : budgets de rendu et comportement aux limites non fermés

La spec borne les requêtes et le nombre de chunks de données. Elle laisse ouverts le nombre de chunks rendus, la distance maximale utile et le coût d'intégration d'une réponse. Deux lots réseau de 16 chunks peuvent arriver ensemble : le cache borné n'empêche pas leur construction synchrone de bloquer la scène.

Elle demande aussi de conserver le terrain pendant un échec sans définir la borne de rétention des anciens meshes quand la caméra continue à se déplacer. Conserver toute l'ancienne couverture contournerait le budget ; l'évincer sans règle peut révéler brutalement le sous-sol.

À préciser : paramètres explicites de distance/couverture et maximum résident, politique de rétention en erreur, file de construction des meshes avec travail réparti sur les frames, annulation des travaux devenus inutiles et priorité au visible. Les valeurs peuvent être ajustées pendant la recette, mais les critères d'acceptation doivent inclure une borne vérifiable et une mesure de fluidité, pas seulement un nombre de chunks qui finit par se stabiliser.

Référence : spec, sections « Caméra, réseau et cache », « Rendu Babylon » et « Preuves et critères d'acceptation ».

## Points solides et périmètre

La lecture séparée du snapshot économique, le halo diagonal d'une cellule, les coordonnées canoniques, les ressources graphiques partagées et l'absence de migration spéculative sont cohérents avec le dépôt.

L'exclusion des bâtiments des autres joueurs est explicitement documentée : ce n'est pas un oubli de la spec. Elle doit rester visible dans le périmètre accepté par Tristan. De même, le streaming ne corrige pas le repli actuel des trajets pierre très longs vers un trajet X puis Y ; ne pas présenter cette tranche comme une validation de la navigation longue distance.

Les quatre réserves portent sur les garanties techniques de la tranche proposée. Elles peuvent être résolues dans la spec sans ajouter de mécanique de jeu ni refactor général.
