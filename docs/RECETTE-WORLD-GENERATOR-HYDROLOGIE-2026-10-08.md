# Correction du tracé organique — recette r5 — 8 octobre 2026

Demande de Tristan : corriger l'aspect artificiel des rivières après examen des références de génération procédurale. La r4 creusait des corridors rectilignes ; une régression sur les centres des sections l'a confirmé avant modification.

## Choix et réalisation

`world-hydrology-meanders.ts` remplace le routage r4 pour les nouveaux candidats. Une recherche bornée retient jusqu'à six trajectoires concurrentes par section. Un guide à variation lente propose des courbes ; les berges, le relief, les zones protégées, le coût de creusement et la continuité de direction déterminent les passages admissibles. Les plateaux restent plats.

Le lit varie progressivement dans la plage5–8 cases. Le recouvrement entre sections et la largeur transversale estimée sont contrôlés, y compris en diagonale. Une simple droite oblique n'est pas acceptée comme une courbe. Les têtes de source sont arrondies. Les cascades gardent leur largeur entièrement alimentée, leur section étant stabilisée au changement de niveau.

`WaterReach.flowTo`, optionnel, décrit le drainage de chaque case dans un virage. Les épaules rejoignent le milieu du lit avant la section suivante, sans boucle. L'ancien drainage reste disponible pour les artefacts sans ce champ. Aucun nouvel effet par frame ni aucune migration.

Le preview ajoute **Voir une rivière**. Il cadre le cours d'eau et sa tête lorsqu'ils tiennent dans les32×32 cases locales ; sinon, il cadre son milieu. Les anciennes recettes r0/r2/r3/r4 restent disponibles et les artefacts prêts restent inchangés.

Cette adaptation est inspirée des principes de séparation réseau/forme présentés par [Red Blob Games](https://www.redblobgames.com/x/1723-procedural-river-growing/) et de la cohérence relief/eau de [Mapgen4](https://www.redblobgames.com/maps/mapgen4/). Aucun code externe ajouté. Elle conserve le relief existant : ce n'est pas une reconstruction complète du monde à partir d'un nouveau réseau hydrographique.

## Vérifications actuelles

**39 tests distincts validés** : hydrologie16, relief15, marches2, API6. Ils couvrent la courbure réelle, les largeurs, les arêtes de cascade alimentées, les chemins de drainage des virages, une traversée forcée de la couture du tore, les accès secs, la végétation, les recettes r3/r4/r5 et la publication fermée.

La première exécution groupée a passé les assertions mais terminé avec un timeout RPC Vitest `onTaskUpdate`. Les vérifications ont été reprises en lots courts et terminées sans erreur, sans augmenter les timeouts. Journaux locaux : `meander-check-geometry.log`, `meander-check-drainage.log`, `meander-check-rest.log`. Builds contracts et world-web, lint ciblé et diff check passés. Le dernier build inclut le cadrage complet ; avertissement Vite de taille des chunks inchangé.

Deux candidats seed42, paramètres par défaut, publiés par le worker sur la base de recette `127.0.0.1/arbestra_test` :

| Dimension | Sources | Cases de rivière, hors cap ajouté | Cascades hauteur1 / hauteur2 | Largeurs des fronts | Eau | Zones isolées |
|---|---:|---:|---:|---|---:|---:|
| 256×128 | 1 | 169 | 1 / 0 | 8 cases | 25,43 % | 0 |
| 512×256 | 4 | 756 | 2 / 3 | 7–8 cases | 25,71 % | 0 |

Largeurs de lit rencontrées :6–8 cases, dans l'intervalle autorisé5–8. Bois30 % ; détours maximaux échantillonnés273/137 cases, sans garantie universelle. Génération worker1 312/4 316ms ; JSON2 071 398/8 299 933octets. Les différences avec les mesures r4 ne constituent pas une comparaison de performance contrôlée.

Navigateur production Chromium/WebGL2, Intel Iris Plus D3D11 : génération UI, inspection de rivière, cascades1/2 larges, phases basse/haute, chenal, soleil, atmosphère, changements de candidat et cycles tore/local. Aucune erreur navigateur/shader ; caméra conservée. Avant/après cycles globaux256 : mêmes2 draws,3 meshes,89 852triangles,0 texture. Temps GPU non mesuré.

[Courbe dans le terrain](../test-results/hydro-meander-river-terrain.png) · [Rivière recentrée](../test-results/hydro-meander-river-complete.png) · [Tête arrondie](../test-results/hydro-meander-spring.png) · [Cascade vue d'aval](../test-results/hydro-meander-fall-2-orbit-terrain.png).
Données locales ignorées : `hydrology-meander-browser.json`, `hydrology-meander-generated.json`, `hydrology-meander-orbit.json`. Parcours : `tests/browser/hydrology.mjs` et `hydrology-orbit.mjs`.

Dernière recette sur le build final terminée : recentrage avec marge sèche, tête arrondie et cascade vue selon son aval réel, aucune erreur navigateur. Les deux candidats et le compte QA ont été supprimés ; services QA arrêtés et sessions navigateur fermées. Aucun monde du jeu touché.

## Limites et reprise

Le routage garde une direction principale et une longueur bornée (au plus96 sections, moins sur les petits mondes). Il n'ajoute pas encore une gestion générale des confluences ni une simulation d'érosion. Les fronts de cascade restent alignés sur la grille. Les contraintes plus fortes peuvent produire moins de rivières que r4 ; aucune rivière rectiligne de remplacement n'est injectée pour atteindre un quota.

Recharger **/world-generator**, **Générer l’aperçu**, puis **Voir une rivière**. D/E restent à réaliser ; aucun univers v3 ouvert, aucune modification de données utilisateur. Main/f9fc28d ; worktree antérieur conservé, aucun commit/push.

---

## Historique : correction des largeurs r4

# Correction des largeurs — recette r4 — 8 octobre 2026

Demande de Tristan : des ouvertures de rivière de **5 à 8 cases**, avec des cascades aussi larges. La r3 creusait des rivières d'une seule case et rendait ses cascades sur une seule arête. La régression ajoutée a échoué avant correction : largeur1 au lieu du minimum5.

## Correction

Les nouveaux aperçus utilisent **v3 r4**. `world-hydrology-rivers.ts` construit des sections complètes de 5 à 8 cases, de largeur déterministe par cours d'eau. Le creusement porte sur toutes les cases, avec fond, surface et aval cohérents. Une chute regroupe ses 5–8 paires amont/aval dans `Waterfall.lanes` ; le rendu et l'écume couvrent ces faces, sans agrandir une nappe sur une berge sèche. « Voir une cascade » centre l'inspection sur son milieu.

Les paliers sont protégés, les berges contrôlées et le creusement refusé si la continuité terrestre est rompue. Les niveaux de marée et le recalibrage de la végétation restent partagés. Les chenaux maritimes conservent leur réglage distinct. R0/r2/r3 restent dispatchés explicitement ; aucun artefact prêt n'est régénéré, aucune migration ni ouverture de monde.

Limite de cette passe : corridors **rectilignes de 8 à 64 cases**, sans méandres. La recette refuse les tracés incompatibles plutôt que de revenir à une rivière d'une case. Les cascades restent limitées à 1/2 unité ; une unité vaut toujours ¼ de case.

## Preuves de cette correction

36 tests ciblés passés : hydrologie13 (dont régression des largeurs, fronts alimentés et compatibilité r3), relief15, marches2, API6. Les contrôles couvrent les arêtes mouillées, drainage descendant, accès secs, végétation, publication et fermeture v3. Builds contracts/API/world-web et lint ciblé passés. L'avertissement Vite sur la taille des chunks demeure.

Deux artefacts **r4 réellement publiés** sur `127.0.0.1/arbestra_test`, seed42, paramètres par défaut :

| Dimension | Sources | Cases de cours d'eau creusées | Cascades hauteur1 / hauteur2 | Largeurs des fronts | Eau | Zones isolées |
|---|---:|---:|---:|---|---:|---:|
| 256×128 | 4 | 883 | 6 / 0 | 5–6 cases | 25,63 % | 0 |
| 512×256 | 16 | 1 802 | 8 / 9 | 5–8 cases | 25,12 % | 0 |

Bois : 30 % dans les deux cas. Durée worker observée : 12 267 / 25 530 ms ; JSON : 2 085 762 / 8 322 954 octets. Ces observations sous charge locale ne sont pas une comparaison de performance contrôlée avec r3. La continuité n'impose toujours pas un maximum universel de détour.

Navigateur production Chromium/WebGL2, ANGLE Intel Iris Plus D3D11, viewport1440×1000 : génération UI, fronts larges, chute de8 cases et hauteur2, phases basse/haute, chenal, soleil, atmosphère, changement de candidat et cycles tore/local. Caméra conservée ; aucune erreur navigateur/shader. Global256 avant/après cycles : 2 draws, 3 meshes, 90 604 triangles, 0 texture. Temps GPU non mesuré. FPS observés24–44 pendant cette recette sous charge ; aucune conclusion de gain ou régression GPU n'en est tirée.

[Front de6 cases](../test-results/hydro-wide-fall-1.png) · [Front de8 cases](../test-results/hydro-wide-eight-cell-fall.png) · [Vue terrain oblique](../test-results/hydro-wide-fall-2-orbit-terrain.png) · [Tore](../test-results/hydro-wide-large-water.png).
Les captures et métriques sont des artefacts locaux ignorés par Git : `hydrology-wide-browser.json`, `hydrology-wide-generated.json`, `hydrology-wide-orbit.json`. Scripts reproductibles : `tests/browser/hydrology.mjs` et `hydrology-orbit.mjs`.

Recharger **/world-generator**, puis **Générer l’aperçu**. Les aperçus sauvegardés antérieurs gardent leurs anciennes largeurs.

---

## Recette r3 historique — mesures antérieures à la correction

# World generator — tranche C hydrologie — 8 octobre 2026

Statut : première recette exploratoire implémentée et vérifiée. A/B restent la base ; D (spawn/streamer) et E (ouverture alpha) restent à faire.

## Décisions et portée

Tristan a validé pour cette recette exploratoire une marée de ±0,25 unité, des cascades permanentes de 1 ou 2 unités et le rejet des tracés nécessitant une chute plus grande. Une unité verticale reste ¼ de case. Aucun bateau, aucune terraformation joueur, aucun changement économique.

La nouvelle recette est **v3 r3**. Les générateurs historiques r0 et r2 restent accessibles par révision ; aucun artefact prêt n'est régénéré. Les nouveaux champs sont conservés dans l'artefact JSONB signé existant : aucune migration supplémentaire. L'ouverture v3 reste refusée côté serveur jusqu'au spawn compatible et à sa recette.

## Génération

- Le relief r2 fournit les plateaux et les escaliers. Jusqu'à trois essais déterministes calibrent la part d'eau **après** creusement ; la cible originale et le résultat restent distincts.
- Les composantes aquatiques sont identifiées sur le tore. Le plus grand bassin initial est la mer de référence ; les bassins déconnectés sont des lacs. Les connexions de niveau marin créées ensuite héritent de la marée.
- Les chenaux relient des bassins voisins par les cols bas admissibles, avec une emprise réellement creusée à la largeur demandée. Ils ne sont pas garantis sur chaque seed ni à toute largeur : obstacles et incompatibilités sont signalés.
- Le drainage est construit à rebours depuis les récepteurs. Sur le plat, la distance à la sortie décroît strictement ; les ruptures descendent de 1 ou 2 unités. Les sources sont distribuées, déterministes, avec humidité comme critère. Des bassins perchés peuvent alimenter leurs rivières.
- Fond et surface sont distincts ; les tronçons conservent cellules, profondeur de référence, largeur, amont/aval. Les embouchures à plusieurs faces portent des sorties secondaires **strictement descendantes**. Chaque nappe visible correspond à une transition persistée entre deux cellules aquatiques alimentées.
- Escaliers et paliers sont protégés. Le creusement est refusé si les berges ne retiennent pas l'eau ou si une même terre perd sa continuité géométrique. La forêt est recalibrée sur le graphe sec définitif, en préservant les passages.
- Les métriques finales d'accès, de bois, de relief et d'eau sont recalculées. Les limites de détours héritées de B restent visibles, sans borne universelle promise.

## Marée et courants

Le niveau marin est commun à tout son réseau connecté, estuaires et lagunes inclus. Une modulation bornée utilise la phase et la position solaire partagées. Les eaux perchées ne suivent pas la marée ; le pied d'une chute côtière la suit. Le débit descendant de référence reste distinct de la composante solaire dans les estuaires.

L'enveloppe haute est persistée avec une marge sèche de0,25 unité. Elle décide des cases praticables une fois à la génération ; déplacer la phase ne modifie ni routes ni état métier. Les plateaux côtiers entiers restent normalement au-dessus de cette enveloppe : les surfaces mouillées basse/haute peuvent donc être identiques malgré un niveau visiblement mobile.

Il s'agit d'une règle de présentation déterministe, sans simulation de pression, conservation des volumes, érosion ou débit physique.

## Aperçu

Couche **Eau et réseaux**, bouton **Voir une cascade** parcourant les chutes, phase numérique exacte en complément de la tirette. Les nappes et surfaces sont regroupées ; leur marée est appliquée dans le shader, sans reconstruire la scène. Le champ solaire des courants est évalué spatialement dans le shader à partir des mêmes fonctions et conventions que les contrats.

Le tore global ne crée pas l'écume détaillée. L'inspection locale ajoute un lot d'écume procédurale à proximité (rayon caméra inférieur à14, dans cette caméra à focale fixe). Pas de système de particules individuel dans cette première représentation. Les ressources sont libérées avec la scène. Aucun changement de backend Babylon.

## Fichiers concernés

- packages/contracts/src/world-hydrology.ts et world-hydrology.test.ts : réseau, niveaux, courants et vérifications.
- world-generator.ts, world-landscape.ts, index.ts : contrat, dispatch par révision, calibration bornée.
- world-landscape.test.ts : recette r2 explicitement conservée ; intégrations API : révision3 et hydrologie persistée.
- apps/world-web/src/world-generator/hydrology-view.ts, PreviewScene.tsx et WorldGenerator.tsx : rendu et inspection.
- tests/browser/hydrology.mjs : recette production reproductible sur compte/monde de test.

## Vérifications et mesures finales

**34 tests ciblés distincts** validés : 15 pour le relief r2, 11 pour l'hydrologie r3, 2 pour les marches, 6 intégrations API. La dernière correction de drainage a été rejouée sur les 11 tests hydrologiques. Les essais incluent sept combinaisons seed/taille jusqu'à512×256, les extrêmes tout sec/tout eau, les coutures, les sorties multiples, la périodicité et les berges sèches. Les révisions historiques restent testées explicitement.

Builds contracts/API/world-web et lint ciblé. La recette utilise PostgreSQL arbestra_test, sans reset ni mutation d'un monde utilisateur. Le bouton réel a généré le premier candidat ; le second a été généré par le même endpoint opérateur.

| Seed42, réglages par défaut | 256×128 | 512×256 |
| --- | ---: | ---: |
| Génération worker persistée | 2 769 ms | 13 989 ms |
| Eau obtenue (cible25 %) | 25,60 % | 25,18 % |
| Bois obtenu (cible30 %) | 30,00 % | 30,00 % |
| Sources / cellules de rivière | 4 / 196 | 5 / 292 |
| Bassins lacustres | 3 | 8 |
| Chenaux de largeur4 | 0, incompatibilité signalée | 1 |
| Fronts de chute de1 /2 unités | 10 /1 | 10 /3 |
| Terres / composantes accessibles | 1 /1 | 1 /1 |
| Zones isolées / terres sans accès | 0 /0 | 0 /0 |
| Détour médian / maximum échantillonné | 29 /435 cases | 33 /155 cases |
| Taille JSON UTF-8 de l'artefact | 2 092 541 octets | 8 317 466 octets |

Les fronts contigus ou les sorties multiples d'une embouchure sont des transitions distinctes ; ce compteur n'est pas un inventaire de lieux nommés. Les détours sont échantillonnés, pas des maxima globaux. Le cas435 est une limite de cette recette à traiter avant l'ouverture, sans inventer ici une borne de gameplay.

Navigateur production Chromium/WebGL2, Babylon8.56.2, ANGLE Intel Iris Plus 0x8A52 / Direct3D11. Viewport1440×1000, canvas1080×560. Pose globale alpha−π/2, beta1,05, rayon8, amplification1 et phase0. Local : beta0,78, rayon23 puis quatre zooms + (rayon7,28), coordonnées enregistrées dans le JSON de recette.

- Cascades1/2, pieds à marée basse/haute, chenal, couches, éclairage neutre/solaire, atmosphère et trois cycles global/local contrôlés.
- Marée inspectée : −0,250 à22°, +0,250 à360° (arrondis). L'accès sec ne varie pas.
- Cadrage conservé : captures de la couche altitude avant/après changement de couche identiques.
- Zéro erreur navigateur et zéro erreur de compilation shader/GL dans le passage final.
- Réactivité HTTP pendant la génération du grand monde : médiane18,42 ms, maximum37,31 ms sur les sondes de cette exécution, sans prétendre établir une garantie de latence.

| Rendu mesuré | FPS | JS médiane/p95 | Draws | Triangles soumis |
| --- | ---: | ---: | ---: | ---: |
| Tore256, eau | 60 | 1,80/4,40 ms | 2 | 90 500 |
| Tore512, eau | 60 | 0,60/0,90 ms | 2 | 358 934 |
| Chenal local | 60 | 0,50/0,90 ms | 2 | 3 370 |
| Local avec soleil/ombres | 60 | 3,60/6,60 ms | 10 | 19 482 |
| Tore avec atmosphère | 60 | 2,20/4,00 ms | 6 | 163 882 |
| Retour sans effets après cycles | 60 | 1,40/4,20 ms | 2 | 90 500 |

Ces temps JavaScript ne sont ni le temps GPU ni la durée complète d'une frame. Aucune accélération GPU n'est déduite de ces compteurs. Retour après cycles : trois meshes actifs, zéro texture, mêmes triangles/draws ; cela ne constitue pas une mesure exhaustive de mémoire GPU. Les tailles JSON ne sont pas des consommations mémoire résidentes.

Captures r3 conservées : [chute2](../test-results/hydro-r3-fall-2.png). Les autres vues sont remplacées par la recette r4 ci-dessus.
Scripts : tests/browser/hydrology.mjs et hydrology-orbit.mjs. Données détaillées locales ignorées : test-results/hydrology-browser.json, hydrology-generated.json, hydrology-matrix.log, hydrology-suite.log.

Publication API finale repassée seule : 1 test passé, 5 non sélectionnés. Le premier essai filtré a révélé une dépendance du test à la fixture du cas précédent ; ce cas crée maintenant sa propre fixture si nécessaire. Les deux mondes et le compte QA finaux sont supprimés, les services QA arrêtés, aucun navigateur de recette restant. Worker du jeu conservé.

[Chute2 en vue oblique dans le terrain](../test-results/hydro-r3-fall-2-orbit-terrain.png) : nappe et raccord inspectés, zéro erreur navigateur.

## Limites et reprise

Les sources et tracés sont bornés ; un avertissement peut signaler l'absence de chenal ou de rivière admissible. La première recette ne garantit pas un réseau naval parcourant toutes les régions. Les eaux ne sont pas encore intégrées au village jouable v3 : cette intégration dépend de D/E, et les candidats restent fermés.

Recharger /world-generator et **générer un nouvel aperçu r3**. Les candidats r2 restent disponibles avec leur représentation historique.

État Git : main, tête f9fc28d, worktree antérieur préservé ; aucun commit/push.
