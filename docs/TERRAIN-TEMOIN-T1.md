# Monde témoin T1 — 9 octobre 2026

## Candidate alpha 512 × 256 approuvée

Le 9 octobre 2026, Tristan valide la version actuelle comme **candidate pour la sortie du week-end**. Référence de données : `apps/world-web/public/studies/t1-alpha512-rc1.json`, manifeste et couverture homonymes ; SHA256 `de165c395c26eb70572a4370d9a537661e9eaf78b477e1694cfda283418702a4`. Copie exacte de la variante après correction de pierre (28 groupes / 177 rochers, 15 029 arbres). Eau de preview : niveau 0. Les scripts de régénération ne ciblent pas RC1.

La route `world=t1-alpha512` continue de montrer la variante de travail, identique à RC1 lors de la validation. Le code procédural courant participe au résultat et reste à versionner avec les données pour une release reproductible. Cette validation géographique ne vaut pas ouverture du monde ni qualification de la projection métier et des spawns. Aucun univers ouvert par cette passe.

Tristan demande un tore initialement plat, sans eau, avec une forêt cohérente, deux petites chaînes et des creux. Cette passe remplace la poursuite des recettes générales par un témoin visuel commun. Elle ne modifie pas la recette r11 ni les candidats sauvegardés.

## Accès et repères

Route publique de preview en lecture seule : `/terrain-study?world=t1`. En développement : `http://localhost:5174/terrain-study?world=t1`. Aucun compte ni accès à la base nécessaire. L'artefact est inclus dans le build et chargé depuis `/studies/t1.json`.

- Domaine 256×128 ; X suit l'anneau, Y le tube ; les deux axes sont périodiques.
- Secteurs A–H × 1–4, chacun de 32×32 cases. Graticule et noms sur le terrain, masquables.
- Clic au sol : sélection des coordonnées de la cellule touchée et croix orange. X/Y acceptent également le dixième de case ; les valeurs sont normalisées.
- « Aller à ces coordonnées » ouvre l'inspection locale. Tore et carte restent accessibles.
- Le lien conserve monde, coordonnées, vue, couche terrain/altitude et affichage des repères. Il ne conserve pas l'orbite manuelle de la caméra.
- Bouton de copie et lien explicite de secours (notamment sur une origine HTTP de réseau local sans API presse-papiers).

| Repère | Secteur | X / Y | Intention |
|---|---|---|---|
| Chaîne A | C2 | 70 / 45 | Chaîne allongée, sommet proche de +12 unités |
| Massif E3–F3 / chaîne B | E3–F3 | 155 / 89 | Massif étendu, replats plafonnés à +12 unités |
| Creux C | D3 | 120 / 80 | Rides sèches, profil central −6 unités |
| Creux D | G1 | 213 / 31 | Rides sèches, profil central −6 unités |
| Plaine | C1 | 80 / 10 | Sol de base +1 unité |

Une unité de hauteur vaut ¼ de case. Le reste du sol est exactement plat à +1 unité avant les seules formes locales. La suppression de l'eau est explicite dans ce témoin : une altitude négative ne déclenche pas une mer.

## Construction et réutilisation

`packages/contracts/src/terrain-study.ts` contient les points des deux chaînes, leurs profils compacts, les deux dépressions et le descripteur du témoin. `world-geography.ts` ne branche ce champ que lorsque `geography.study` est présent. La géologie existante fournit les facettes/expositions ; le modèle forestier existant conserve climat solaire, humidité, colonisation/compétition, pente et exclusion des roches exposées. Aucune nouvelle distribution uniforme d'arbres.

`node --import tsx scripts/build-terrain-study.mjs` reconstruit l'artefact public. Première passe : 5 994 arbres ; habitat forestier 32 %, distinct d'une couverture de canopée ; altitude mesurée aux centres −2,577 à +12,000 unités. 2 516 332 octets JSON bruts. Pas de génération du monde à chaque visite ; les meshes sont construits par le vrai PreviewScene.

`TerrainStudy.tsx` fournit la route et les liens. `study-coordinates.ts` utilise un lot de lignes, un atlas de texte et un petit lot actualisable pour la croix. Depth testing normal des étiquettes, déplacement/rotation cohérents avec le tore ; aucune modification du terrain par la grille. Éclairage directionnel de diagnostic propre au témoin pour lire les reliefs. Le moteur dispose l'ensemble avec la scène.

Les coordonnées de T1 servent aux retours artistiques. Conserver cet artefact et les captures avant une prochaine passe ; ne pas faire varier la seed pour masquer une régression. Les ajustements locaux doivent porter sur les zones discutées. Les futurs outils d'édition/terraformation ne sont pas implémentés ici.

## Vérification

Tests ciblés : plaine plate, deux chaînes relevées, creux négatifs secs, sérialisation et coutures périodiques ; absence de géométrie d'eau dans le mesh du creux ; tous les arbres de l'artefact restent ancrés sur le champ et hors roche fortement exposée. `walkable` reste nul : aucune autorisation de jeu.

Recette navigateur : `node tests/browser/terrain-study.mjs`, vraie route sans harness ni API simulée. Captures tore/carte/chaînes/creux/altitude, saisie et normalisation (−1,129)→(255,1), réouverture du lien direct, picking de carte et masquage des repères. Rapports et captures dans `test-results/study-*`, hors Git.

Résultats du 9 octobre : 4 tests ciblés réussis, build contrats, typecheck et build de production world-web réussis. Lint ciblé réussi après ajout de l'import Node `process` dans le script de génération. Avertissement Vite existant sur les bundles volumineux ; `git diff --check` propre. Deux passages navigateur complets réussis ; le second confirme les corrections des étiquettes et de la croix de sélection, sans exception. Captures examinées : tore, carte, chaîne et dépression. Backend WebGL2, ANGLE Intel Iris Plus / D3D11, canvas 1390×680. Aucune mesure de gain CPU/GPU revendiquée. La copie presse-papiers dispose d'un repli explicite ; le clic de copie n'a pas fait partie du parcours automatisé.

## Ajustement des creux — 9 octobre

Demande : conserver +12, approfondir vers −6 avec des rides étroites. Les seules formes changées sont C et D : trois sillons sinueux par zone, profil central −6 unités, sillons secondaires moins profonds et bandes hautes entre eux. Largeur maximale du sillon principal : 5,2 cases en C, 4,6 en D ; longueur 36 / 30 cases, extrémités atténuées. Le relief géologique existant ajoute ses entailles : minimum final échantillonné −7,026, repère C −6,049. Amplitude des montagnes inchangée (+12,000 maximal).

Le descripteur optionnel `folds` conserve la lecture des anciens témoins elliptiques. Artefact régénéré : 5 930 arbres, zéro eau ; réévaluation de la forêt sur le nouveau relief. Copie de la première passe conservée dans `test-results/study-t1-before-rides.json` hors Git.

Build contrats et lint ciblé réussis. Cinq tests réussis au total (3 contrats, 2 mesh/arbres) : profil −6, bandes intermédiaires surélevées, raccord à la plaine, déterminisme périodique, absence d'eau et ancrage des arbres. Les premières assertions supposaient à tort que la géologie ne creusait pas le profil ; elles ont été corrigées pour distinguer profil et surface finale. Capture du creux C examinée : sillons rocheux étroits lisibles, pas d'eau. Appréciation artistique à poursuivre.

Parcours navigateur complet de cette passe réussi sans exception : tore/carte/local, altitude, liens directs, coordonnées périodiques, picking et masquage des repères.

## Deux bassins secs et sillon — 9 octobre

Tristan valide deux bassins à −3, encore secs, avec modification de la chaîne B en F3. Bassin occidental centré (0,80), rayons 20×14 cases, à cheval sur H3/A3. Bassin oriental centré (183,83), rayons 13×39, allongé sur F2/F3/F4. Fonds centraux à −3 ; les embouchures du sillon sont à −4.

Sillon : H3 → G3 → F3 près de F2 → E3, coude vers E4, passage de Y=128 vers F1 près de G1, retour dans le bassin oriental par F2. Tracé enregistré en coordonnées déroulées, lissé par deux passes de découpe des angles (Chaikin), profil de largeur maximale 7,6 cases. Fond cible −4 absolu, y compris dans la montagne ; les incisions de géologie existantes peuvent approfondir localement le relief final. Le sillon peut communiquer avec le bassin oriental lors de son premier passage en F3 : ce tracé n'impose pas deux réseaux séparés.

`terrain-study-basins.ts` porte uniquement la sculpture de ce témoin et un index spatial des segments ; aucune hydrologie ni règle de navigation. La géographie et l'index restent périodiques. Raccourcis dans la preview : bassins, coude E4 et passage F1. Copie avant sculpture : `test-results/study-t1-before-basins.json`, hors Git.

Recette visuelle de cette passe : parcours `tests/browser/terrain-study.mjs` enrichi des quatre nouveaux raccourcis, terminé sans exception. Captures carte complète, bassin de couture et bassin F examinées ; cuvettes douces encore discrètes en matériau herbe, couche altitude conseillée pour leur emprise. Fonds du bassin F −3 et embouchure H/A3 −4 lus dans la preview. Build contrats et lint ciblé réussis. Premier passage Vitest sous charge : 6 assertions vertes mais processus en échec sur timeout RPC `onTaskUpdate` ; ne pas compter ce passage comme validation complète.

## Tracé révisé par G1/G2 vers H1–A1–B1

La demande suivante remplace la fin du tracé précédent : le passage F1 rejoint les trois rides G1/G2, puis une sortie unique mène à une cuvette H1–A1–B1. Le bassin F2–F4 est retiré ; son relief antérieur réapparaît. Bassin H3/A3 conservé. Nouveau bassin centré (16,16), rayons 43×14 cases, fond −3, toujours sec. La plaine de repère est déplacée vers (80,10), hors de ce bassin.

Entrée commune (198,40), trois bras de rayon 1,1 case suivant les courbes des rides existantes autour de (213,31), réunion (228,20), puis sillon unique de rayon 3,8 jusqu'au nouveau bassin à travers la couture H1/A1. La sculpture utilise le minimum des profils : elle conserve les rides déjà plus profondes (−6) et n'additionne pas les excavations. Il s'agit de connexions géométriques sèches ; aucun débit ni irrigation simulée. Artefact : 5 716 arbres, zéro eau, maximum +12 et minimum −7,026 inchangés. Copie avant cette révision : `test-results/study-t1-before-south-route.json`.

Le passage précédent a finalement obtenu 6 tests verts en série après fermeture du navigateur, et un typecheck client réussi. Ces résultats concernent le tracé F2–F4 antérieur ; la recette de la révision courante est rapportée séparément ci-dessous.

Validation finale de la révision G1/G2 : build contrats et lint ciblé réussis ; 6 tests réussis en série, processus terminé sans erreur (26,57 s). Vérifie tous les axes des bras à −4 ou plus bas, les fonds de bassin à −3 hors embouchures, le retour du relief de l'ancien bassin F3, les raccords périodiques, les bandes séparatrices, l'absence d'eau et l'ancrage des arbres sauvegardés. Parcours navigateur ciblé `node tests/browser/terrain-study.mjs --basins` réussi sans exception, captures carte terrain/altitude et trois bras examinées. Le bleu de la couche altitude n'est pas une surface d'eau. `git diff --check` propre ; non commité/non poussé.

## Courbes élargies et massif E3–F3

Tristan confirme le massif intérieur au grand coude E3/F3, autorise son extension avec replats à +12 et demande des montées plus abruptes. Paramètre `outerBendWidening: 0.6` : augmentation de 60 % de la largeur totale aux courbes marquées, entièrement reportée sur le bord extérieur (demi-largeur extérieure 2,2r, intérieure r). Le coefficient suit progressivement le virage signé du tracé lissé ; pas d'élargissement sur les sections droites. L'index spatial inclut l'extension maximale et reste périodique. Paramètre absent : géométrie historique conservée.

Chaîne B : extension vers (154,89), rayons jusqu'à 11 cases, hauteurs brutes renforcées et plafonnées à +12. Profil de montée concentré sur les 45 % extérieurs du rayon, avec raccord continu ; les parties centrales produisent plusieurs replats hauts. Chaîne A conservée. Nouveau raccourci « Massif E3–F3 (155,89) ». L'élargissement extérieur du coude E3 atteint le bord est du creux C. Ancien artefact conservé dans `test-results/study-t1-before-wider-bends.json` hors Git.

Tests supplémentaires : largeur extérieure +60 %, bord intérieur et section droite inchangés sur un coude isolé, invariance au sens de parcours ; surface haute du massif augmentée de plus de trois fois et pente maximale échantillonnée supérieure de plus de 30 %, plafond et chaîne A préservés. Une ancienne assertion sur le bord est du creux C était incompatible avec le nouvel élargissement ; le raccord au sol est désormais vérifié sur son bord ouest non touché.

Artefact régénéré : 5 521 arbres, zéro eau, maximum +12,000 et minimum −7,026. Build contrats et lint ciblé réussis. Capture locale du massif examinée : replat à +12 et flancs rocheux abrupts ; la surface sommitale reste herbeuse dans le matériau actuel. Captures dans `test-results/study-*`, hors Git. Les contrôles de navigation sont réutilisés avec le raccourci du massif ajouté au parcours.

Validation finale : 8 tests ciblés réussis, processus terminé sans erreur (16,61 s). Parcours navigateur `terrain-study.mjs --basins` terminé avec succès et zéro exception ; captures du massif, carte terrain/altitude et trois bras examinées. WebGL2 / Intel Iris Plus, mêmes poses et viewport que précédemment. Aucun gain de performance revendiqué. `git diff --check` propre, changements non commités/non poussés.

## Montée F4–F3 vers le coude intérieur

Tristan demande un accès en pente au plateau, depuis F3/F4 vers son coude intérieur. Corridor de (174,112,+1) à (174,87,+12), longueur 25 cases ; profil progressif avec tangentes horizontales aux extrémités. Bande centrale de 10 cases et épaules de 4 cases de chaque côté, fondu dans le terrain existant. Le profil modifie seulement ce versant ; les autres falaises, le parcours fluvial et les bassins restent présents. Paramètre optionnel `study.ramp`, appliqué avant le creusement des bassins ; aucun effet sur un ancien témoin sans ce champ.

Raccourci « Montée F4–F3 (174,100) ». Régression sur la surface géologique finale, sur trois lignes d'une bande de 4 cases, échantillonnée tous les quarts de case : montée sèche, raccord +1 / +12, variation verticale inférieure à une unité par case. Ce contrôle décrit une pente géographique ; le pathfinding, les occupations, les autorisations et le masque `walkable` de cette preview ne sont pas modifiés. La jouabilité serveur future ne se déduit pas de cette seule pente.

Ancien artefact : `test-results/study-t1-before-ramp.json`, hors Git. Capture du nouveau passage ajoutée au parcours navigateur existant.

La première bande de 6 cases échouait au contrôle (1,22 unité/case après incisions rocheuses). La bande de 10 cases corrige ce défaut ; 7 tests contrats passent sur la version finale. Build contrats et lint ciblé réussis. Artefact régénéré : 5 519 arbres, zéro eau, extrema inchangés. Parcours navigateur `terrain-study.mjs --ramp` réussi sans exception : tore, carte, montée, massif et altitude ; capture locale examinée, large passage herbeux entre les épaules rocheuses, repère central +6,17. Aucun accès métier n'est déclaré sur cette seule preuve visuelle.

Les 2 tests du mesh et des arbres de l’artefact final sont également réussis : 9 tests au total, processus terminés sans erreur. `git diff --check` propre. Changements non commités/non poussés.


## Base sauvegardée, plateaux bas, pierre et mer occidentale

La base approuvée avant cette passe est conservée dans `apps/world-web/public/studies/t1-base.json`, empreinte SHA256 `02b9b3b749a45797524c35bd824d891889cc69e2fcd12cd90eda3cd616fb3493`. Le script de génération écrit uniquement la variante `t1.json` et son rapport `t1-coverage.json`. Accès comparables : `/terrain-study?world=t1-base` et `/terrain-study?world=t1`. Les liens conservent la position et la lecture choisies.

Variante : plateaux irréguliers de +0,5 à +3 unités dans les plaines, sites périodiques décalés et déformés spatialement, six niveaux indépendants et transitions locales. Aucun découpage par courbes de niveau concentriques. Les massifs, sillons, creux et montée F4–F3 sont protégés de ce champ supplémentaire.

Tristan demande ensuite une mer étendue sur H3/A3/B3/C3 et H2/A2/B2/C2 jusqu'à A1. Cuvette principale centrée (32,64), rayons 68×35, prolongement vers (14,33), fond −3 ; rivage perturbé périodiquement. Raccord au bassin H1/A1/B1. Les sommets de C2 restent émergents, conformément à son arbitrage. Cette passe reste sèche : les altitudes négatives préparent la future mise en eau, sans navigation simulée.

Pierre : réutilisation des groupes rocheux existants pour couvrir les terres douces éloignées des grands massifs exposés. Contrôle tous les quatre points de grille, rayon 24 selon la métrique de surface torique existante. Groupes exclus de la montée et des futurs fonds marins ; arbres écartés des blocs et des altitudes négatives. Ce contrôle géographique ne garantit ni le chemin pédestre d'un joueur ni un stock exploitable : ces garanties restent à vérifier lors du placement des villages. Aucun changement de règles métier, de données persistantes ou de ressources.

Artefact final de cette passe : 3 555 arbres, 29 groupes / 174 rochers. Les 1 053 points de plaine éligibles sont couverts ; distance maximale 22,771 pour le rayon 24. Altitudes −7,026 à +12 ; sommet de référence C2 (70,45) à +5,76. La base reste inchangée.

Parcours navigateur `terrain-study.mjs --variation` terminé sans exception : tore, carte, montée, massif, bassin étendu, sommet C2, plaine, pierre, aller-retour base/variante et carte altitude. Captures examinées : péninsule rocheuse C2, emprise maritime H–C raccordée à A1, mosaïque de plateaux sans terrasses concentriques, groupes rocheux visibles. Les plateaux restent peu lisibles avec le matériau herbe uniforme, plus nets en couche altitude. WebGL2 / Intel Iris Plus via ANGLE D3D11, canvas 1390×680. Aucune mesure de performance stabilisée revendiquée.

Validation automatique : 14 tests / 3 fichiers réussis (47,33 s), build contrats et lint ciblé réussis. Régression incluant l’empreinte exacte de la base sauvegardée. Le premier build client a détecté un import de test vers un sous-chemin non exporté ; corrigé en import source relatif, puis les 3 tests de scène ont réussi.

Build client final réussi (TypeScript + Vite), avec avertissement de taille des gros chunks. `git diff --check` propre. Git main / 7218549 ; changements non commités, non poussés.


## Mise en eau visuelle au niveau zéro

À la demande de Tristan, la variante s'ouvre avec une eau au niveau 0. Case « Eau au niveau 0 » pour comparer à sec ; état conservé dans le lien (`water=1` / `water=0`). La base s'ouvre sèche par défaut ; une comparaison depuis la variante conserve le choix d'affichage. Les JSON sauvegardés ne sont pas réécrits.

Le descripteur optionnel `study.waterLevel` est appliqué dans l'échantillon final, après la géologie. Le substrat et les incisions restent strictement identiques au témoin sec. Réutilisation du mesh d'eau existant, clipping et raffinement des berges, couleurs selon profondeur ; même niveau périodique dans le tore, la carte et l'inspection locale. La couche altitude reste une lecture du relief sans surface d'eau. Aucune simulation de courant, navigation, débit ou marée ajoutée.


### Référence alpha approuvée

Tristan valide cette version pour le monde alpha. Copie exacte distincte `t1-alpha.json`, manifeste avec SHA256 `3b718b97e644ad3024f43dfc1cecca95b95fb3c5f7cafe97203a21f6435d75af` et niveau d'eau visuel 0. Le générateur n'écrit pas cette copie. URL `/terrain-study?world=t1-alpha&water=1&view=map` ; entrée « Monde alpha validé ». Il s'agit d'une référence artistique sauvegardée, pas d'un univers persistant ouvert.

16 tests ciblés réussis (67,19 s), build contrats, typecheck client et lint ciblé réussis. Eau appliquée après géologie : hauteurs identiques et sommet C2 hors eau contrôlés ; géométrie d'eau au niveau zéro avec décalage visuel de 0,003 case. Premier parcours visuel interrompu par timeout de connexion CLI au dernier changement altitude, après les captures tore/carte/C2 et bascule eau ; ces captures ont été examinées.

Recette finale `terrain-study.mjs --alpha --water` réussie sans exception : tore, carte, C2, eau masquée/rétablie, URL alpha conservée. WebGL2 / Intel Iris Plus D3D11, canvas 1390×680. `git diff --check` propre ; non commité/non poussé.


## Chunks serveur et agrandissement 512 × 256

Demande : afficher le découpage serveur sans coordonnées sur le tore et préparer une alpha 512×256. Le serveur impose des chunks de 32×32 (`006_world_space_and_generation.ts`). La preview propose « Chunks serveur (32 × 32) », indépendant des étiquettes de coordonnées ; grille seule par défaut, lignes au-dessus du relief ou de l'eau, sans atlas texte ni marqueur. Les coordonnées restent activables séparément.

Référence alpha approuvée 256×128 conservée. Version dérivée `t1-alpha512.json` générée par `node --import tsx scripts/build-terrain-study.mjs --alpha512` à partir du descripteur sauvegardé de l'alpha. Domaine de sculpture agrandi horizontalement ×2 (`study.layoutScale:2`), mêmes altitudes de sculpture ; géologie locale, forêt et couverture pierre recalculées à la nouvelle dimension. Les pentes sont donc globalement plus douces, et les incisions géologiques fines peuvent différer. 16×8 chunks (128), surface quatre fois celle de la référence précédente. Le passage F4–F3 agrandi est également exclu du placement de pierre.

Dimensions, coordonnées canoniques, raccourcis et atlas de labels adaptés. Les liens entre versions convertissent les coordonnées proportionnellement pour conserver le même emplacement géographique. Pas de modification du monde dev ni ouverture d'univers.

Vérification read-only en base le 9 octobre : monde dev `aube`, 2048×1024 cases, chunk 32, soit 64×32 chunks (2048). La preview 512×256 est seize fois plus petite en surface.


Artefact 512 terminé : 15 242 arbres, 122 groupes / 723 rochers, 4 973 points de plaine éligibles couverts au rayon 24 (distance maximale 23,935). Maximum +12, minimum −6,428 ; différence fine attendue du recalcul géologique. Zéro eau dans les données sèches, eau appliquée au niveau 0 dans la preview comme pour la référence. Empreinte de la référence alpha 256 vérifiée inchangée.

Validation automatique : build contrats, typecheck client et lint ciblé réussis ; 12 tests terrain (32,16 s) et un test de grille avec NullEngine (27,87 s) réussis. Ce dernier vérifie exactement 17 lignes longitudinales et 9 transversales échantillonnées, frontières multiples de 32, grille au-dessus de l'eau, un seul mesh, aucune texture de labels ni marqueur. NullEngine ne valide pas l'image finale.

Première inspection navigateur 512 : tore affiché, capture examinée, limites seules visibles sur terre et mer, reliefs et grandes formes conservés. Le passage carte a dépassé le délai CDP pendant la reconstruction synchrone ; ajout de reprises bornées de l’attente (sans rejouer les clics). Coût de reconstruction notable à cette taille, à profiler séparément ; aucune promesse de performance issue de la capture.


Correction de finition : la bascule des chunks ne reconstruit plus la scène, elle modifie la visibilité du mesh existant. Les coordonnées avec labels conservent leur mécanisme séparé. Typecheck client et lint repassés après correction. Recette navigateur finale `--large` réussie sans exception : tore, carte, grille masquée (identité de rendu inchangée), rétablie, puis inspection à −1/257 canonisée en 511/1. Captures examinées, sans labels sur la surface. Une attente CDP du changement de vue carte a nécessité une reprise ; ce coût de reconstruction reste à profiler. WebGL2 / Intel Iris Plus D3D11, canvas 1390×680. `git diff --check` propre ; aucun commit/push.

Accès : http://localhost:5174/terrain-study?world=t1-alpha512&view=torus&water=1&chunks=1&coordinates=0


## Pierre par chunk, géologie prioritaire

Correction demandée par Tristan : la règle précédente « toute plaine à moins de 24 cases » surpeuplait le monde de massifs posés. La variante 512 utilise désormais `terrain-study-chunk-stone.ts` : géologie affleurante d'abord, compléments seulement pour les accès manquants des chunks terrestres habitables. Les chunks entièrement maritimes n'ont pas de complément. La référence alpha 256 reste inchangée.

Le contrôle de preview échantillonne au pas 2 : terres au-dessus de +0,08 case, pente ≤0,35, connexions cardinales avec écart vertical ≤0,5 case. Des composantes distinctes dans un même chunk gardent des besoins distincts. Une surface géologique exposée (`rock >= 0.45`), sèche et voisine d'une zone accessible du même chunk satisfait ce besoin. Ce contrôle géographique ne remplace pas les règles serveur ni le futur pathfinding de placement d'un joueur.

Les groupes existants servent de modèles ; propositions sur coins, milieux des limites et intérieurs des chunks, sélection privilégiant plusieurs accès manquants, suppression des groupes devenus redondants. L'emprise intérieure réelle d'un rocher permet de compter 2 ou 4 chunks, y compris aux coutures du tore. Pas de validation par simple rayon ou boîte englobante. Un bloc compact suffit sur une terre étroite où un groupe complet ne tient pas. Quelques groupes proches peuvent être reliés par une bande rocheuse courbe, entièrement sèche et hors de la montée protégée ; le rendu d'enveloppe rocheuse existant fusionne ces formes.

`rebuild-study-stone.mjs` actualise uniquement les groupes de la variante et retire les arbres qui entreraient dans leurs nouvelles emprises ; terrain, relief, eau et autres arbres conservés. Copie avant cette correction dans `test-results/t1-alpha512-before-chunk-stone.json`, hors Git. Le script refuse d'écrire tant qu'un accès reste sans couverture. Le premier calcul (31 groupes) a ainsi laissé l'artefact intact avec trois accès manquants, avant ajout des blocs compacts.


Tristan confirme explicitement la couverture des seules terres habitables, avec pierre dans le chunk (éventuellement partagée), sans compter une autre rive ou une falaise comme un accès. Le contrôle est plus fin autour des roches partiellement exposées : pas 0,25 dans un voisinage de 2 cases. Une petite nervure près de (249,159), manquée au pas 2, est ainsi reconnue comme géologie au lieu de recevoir un ajout. Deux morceaux de côte très petits ont nécessité un placement sous-cellulaire de blocs compacts.

Résultat réel 512 : 28 groupes / 177 rochers contre 122 / 723 avant (−77 % de groupes). 111 chunks terrestres éligibles, 21 composantes, 131 besoins chunk/composante dont 52 servis par géologie, aucun manque ; 27 groupes partagés entre plusieurs chunks, une liaison entre formations. Les neuf tests ciblés passent (13,86 s), dont contrôle de l'artefact réel, témoin négatif sans compléments, partage 2/4 et couture, géologie prioritaire, eau séparatrice, îlot compact et nervure fine.

Comparaison du JSON avant/après : géographie, altitudes, eau, masques, exposition, humidité et métriques inchangés ; seules les formations et 213 arbres dans leurs nouvelles emprises changent. Les 15 029 arbres conservés gardent exactement leurs positions. Le script incrémental ne replante pas les petites ouvertures sous les anciens groupes retirés. La référence alpha 256 conserve son empreinte. Ce contrôle reste géographique : pathfinding serveur et quantité exploitable à vérifier au placement du joueur.


Validation finale de la pierre : build contrats et lint ciblé réussis, `git diff --check` propre. Tore et carte capturés et examinés ; parcours global interrompu après la carte sur un élément DOM introuvable. Reprise locale `--stone-local` réussie sans exception, massif partagé à (192,0) et liaison à (485,9;58) examinés. Les formations se rejoignent visuellement, les lignes de chunks traversent bien un même massif. WebGL2 / Intel Iris Plus D3D11. Aucun gain FPS revendiqué. Changements non commités/non poussés.
