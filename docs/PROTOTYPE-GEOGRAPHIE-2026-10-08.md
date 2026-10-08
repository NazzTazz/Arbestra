# Prototype de géographie indépendante

8 octobre 2026 — approche hybride et prototype isolé validés par Tristan. Base main/f9fc28d avec travail antérieur non commité. [Audit](AUDIT-GEOGRAPHIE-HYDROGRAPHIE-2026-10-08.md).

## Accès et périmètre

`http://localhost:5174/geography-preview`, lié depuis le World generator et le Kit de terrain. Atelier autonome sans API métier, compte requis, écriture de monde ou migration.

Deux chunks de 32 × 32 affichent une fixture périodique de 128 × 64 : rivière de largeur variable 5–8 cases, affluent, lac terminal, berges creusées, affleurements irréguliers, surfaces végétalisées, plateaux et liaison douce. La topologie fluviale est prédéfinie, ses formes varient avec la seed. **Pas encore de génération globale des bassins.** La scène est une projection locale plane du tore, pas un nouveau globe 3D.

Réglages : seed, amplitude, largeur, irrégularité, densité Standard/Fine et couture torique. Une relance termine le worker précédent. Grille métier, triangles, frontières, courant et surface d'eau sont indépendants ; masquer l'eau expose le lit. Clic au sol : faits géographiques par cellule, sans permission de construire ou marcher.

## Réalisation

- `packages/contracts/src/geography-prototype.ts` : descripteur sérialisable, fixture vectorielle, bruit périodique existant, requêtes fractionnaires, lit et relief, projection de fraction mouillée/pente. Sous-chemin de package séparé ; aucune dépendance à Babylon.
- `apps/world-web/src/world-generator/geography-mesh.ts` : points irréguliers, Delaunator puis Constrainautor. Frontières/intersections quantifiées à 10^-6 case, arêtes découpées aux points intermédiaires, exclusion des quasi-doublons. Les densités changent seulement les points intérieurs. Une triangulation commune fournit sol et domaine d'eau, sans superposition de rubans aux confluences.
- `geography.worker.ts` : génération des deux chunks et transfert des buffers hors boucle de rendu ; résultat périmé ignoré, worker terminé.
- `geography-scene.ts` : normales plates, gris par facette, shader à rides advectées adapté de l'aperçu existant, arbres décoratifs en thin instances. Deux lots de sol, deux d'eau, deux d'arbres ; superpositions séparées. Instrumentation native, picking suivi d'une requête du modèle, libération des meshes/matériaux au remplacement et de la scène à la sortie.
- `GeographyPreview.tsx`, CSS et `main.tsx` : route différée, contrôles et liens depuis les ateliers.

Dépendances figées : Delaunator 5.1.0, Constrainautor 4.1.0 ; polygon-clipping 0.15.7 pour unir et découper les domaines d'eau. Bruit climatique existant réutilisé. Constrainautor expose son implémentation TypeScript comme types, incompatible avec `noUncheckedIndexedAccess` : un pont JavaScript et la déclaration du seul constructeur public utilisé évitent de compiler ses sources avec les options Arbestra. Contrôles stricts du projet conservés, aucun patch de node_modules.

Les axes sont finement échantillonnés depuis des courbes déterministes. Le même tracé définit berges et creusement ; aucun lissage réservé au mesh d'eau. Le niveau décroît puis se stabilise dans le lac. Pas de nouvelle bibliothèque de spline ou bruit pour cette fixture bornée.

## Terraformation validée pour la suite

Des pentes peuvent créer des passages ; des plateaux restent nécessaires pour implanter les joueurs. Modifier le terrain dépensera de l'énergie ; excaver produira de la pierre, remblayer en consommera.

À spécifier avant cette tranche : unité/provenance d'énergie, coûts par volume et matière, rendement en pierre, consommation du remblai, droits et limites spatiales, bâtiments et infrastructures, conséquences sur l'eau et l'accessibilité. Empêcher les cycles créant gratuitement pierre ou énergie ; traiter les arrondis et restes. Aucune valeur inventée ni règle économique implémentée ici.

Architecture proposée : base géographique versionnée et modifications autoritaires persistantes par monde, avec révision et ordre déterministes. Cellules et rendu interrogent le même état modifié. Invalider relief, occupation et routes ; une modification de lit/barrage peut affecter l'amont/aval au-delà des chunks voisins. Recalculer ces conséquences de manière bornée ou rejeter explicitement une modification non prise en charge. Le mesh ne devient jamais l'état persistant ou la source des crédits. Les commandes respecteront les transactions et verrous économiques existants. Aucun framework préventif de terraformation ajouté.

## Vérification et limites

Dix tests ciblés couvrent déterminisme/sérialisation, seeds, positions fractionnaires périodiques, lit et niveaux aval, confluence, plateaux et liaison douce, inondation partielle, paramètres invalides, ordre des chunks, bords exacts, deux densités, normales et plusieurs largeurs. Builds et recette navigateur consignés ci-dessous à leur achèvement.

Limites : fixture de réseau, pas de bassins mondiaux ou érosion ; une densité affichée à la fois, pas de LOD automatique ; pas de surplomb, ombres portées ou marée dans cet atelier. Arbres décoratifs sans ressources. Projection approximée (8 × 8 points par cellule par défaut) sans politique de franchissement. Qualifier les opérations et la quantification sur les futurs domaines de production avant ouverture.

Les buffers transmis ne représentent pas toute la mémoire CPU/GPU ; les sommets résidents incluent les superpositions masquées. Les temps de frame incluent l'ordonnancement navigateur et ne sont pas des temps GPU. Aucun gain par rapport au Village ne peut être déduit de cette scène différente.

## Recette du 8 octobre

Les dix tests ciblés ont terminé avec succès après les dernières corrections. Le premier essai avait détecté que l'affluent traversait la liaison douce entre plateaux : sa source a été déplacée, puis la régression est passée. La recette navigateur a détecté l'import de rayon manquant dans la scène autonome ; l'import Babylon explicite a rétabli le picking. Les bascules simultanées des superpositions sont vérifiées avec des mises à jour React fonctionnelles.

En navigateur de production, viewport 1440 × 1000, canvas 1112 × 638, WebGL 2, ANGLE / Intel Iris Plus Graphics / Direct3D11 : seed 42, amplitude 1, largeur 6,5, irrégularité 0,35, densité Standard. Pose Ensemble : alpha = -PI/2 - 0,22 ; beta = 0,85 ; rayon = 51 ; cible (32, 0, 16). Hémisphérique 0,72 et directionnelle 1,05, aucun post-effet ni ombre portée.

Observations sur les cycles de recette, sans promesse de benchmark contrôlé :

| Cas | Triangles sol | Buffers transmis | Sommets résidents avec diagnostics masqués | Draw calls / meshes actifs |
| --- | ---: | ---: | ---: | ---: |
| Seed 42, Standard, x = 0..64 | 4 848 | 0,70 Mio | 27 494 | 6 / 6 |
| Seed 7, Standard, x = 0..64 | 4 860 | 0,71 Mio | 27 644 | 6 / 6 |
| Seed 7, Fine, couture x = -32..32, frontières visibles | 17 022 avant finition de tête de source | 2,29 Mio | 69 187 | 7 / 7 |
| Retour seed 42 / Standard après ces cycles | 4 848 | 0,70 Mio | 27 494 | 6 / 6 |

Génération worker observée 0,40–1,76 s pour les cas Standard, 2,23 s pour le cas Fine torique avant finition de source. Frames stables souvent autour de 16,6–16,8 ms médianes et 17–19 ms p95 ; un relevé pendant le build a atteint 26,7 / 59,4 ms. Ces variations interdisent d'attribuer un gain GPU au prototype. CPU scène : valeurs ponctuelles, pas une campagne CPU séparée ; temps GPU absent. Le retour au même nombre de meshes/sommets prouve seulement l'absence d'accumulation de ces ressources sur les cycles observés, pas l'absence universelle de fuite mémoire.

Parcours exercé : grille / triangles / frontières / courant séparés, masque d'eau et inspection du lit, poses Ensemble/Berges/Roche, seed 7 puis retour 42, densité Fine puis Standard, couture du tore, picking de la cellule (31,15). Les buffers de bords sont également comparés exactement par les tests, indépendamment de l'image.

Captures locales sous `test-results/geography-prod-*.png`, exclues de Git ; fichiers overview, grid, bed, seed7 et seam-wire. Dernier build world-web terminé avec succès ; lint ciblé vert. Captures finales overview/rock/bed/seam-final inspectées. Retour Kit de terrain puis prototype vérifié. Dernier relevé seed 42 Standard après retour : 421 ms de génération, 16,6 / 17,2 ms de frame médiane/p95, mêmes 6 lots et 27 494 sommets. Couture finale seed 42 : 4 754 triangles sol, 0,65 Mio transmis, 26 161 sommets, 7 lots avec frontière affichée, génération 400 ms. Aucune erreur navigateur relevée sur cette version. Aucun test DB exécuté, aucune donnée métier modifiée, aucun commit/push.
