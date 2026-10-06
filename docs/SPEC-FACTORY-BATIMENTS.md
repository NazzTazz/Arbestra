# Factory modulaire des bâtiments

## Hôtel de ville niveau 2 — esquisse du 6 octobre 2026

À la demande de Tristan, l’esquisse est disponible dans l’atelier : `/factory-preview.html?world=aube&recipe=hall-2`, sélection « Hôtel de ville · niveau 2 · marché ». **Direction validée** : deux niveaux, séparation longitudinale de l’étage entre un long balcon couvert en bois et une salle en petites pierres. Rez-de-chaussée sur 1 × 2 cases ; balcon gauche réduit à .70 de large et salle droite élargie à 1.54. Parquet, trois poteaux et garde-corps en bois ; module pierre supérieur .14 × .07, contre .28 × .14 au rez-de-chaussée. Les pignons de l’étage reçoivent désormais une baie Médecine .56 × .70 ; les longues façades conservent les baies hautes Mathématiques.

À l’étage : aucune porte, baies étroites et hautes des Mathématiques avec verre dépoli ; plafond abaissé de 1,68 à 1,26. Rez-de-chaussée : entrée ouverte sans panneau bois, largeur doublée de .56 à 1.12 ; autres baies de Médecine et verre dépoli, adaptées à la trame locale. Les deux baies encadrant l’entrée deviennent des niches en pierre de mêmes dimensions (.56 × .70), chacune contenant un brasero animé du service existant. Aucun vitrage ni menuiserie dans les niches.

Dernière direction demandée : salle à toit plat ; terrasse seule couverte par trois demi-fermes utilisant la géométrie et les sections du kit, avec entrait, arbalétrier, montant et contrefiche. Tasseaux transversaux très sombres, espacés, posés au-dessus ; pente faible vers le bord extérieur. `town-hall-market-roof.ts` compose cet auvent. Matériau sombre et service de braseros libérés avec l’instance ; chantier sans tasseaux ni flammes. Palettes, rotations et état de travaux disponibles ; accès fixes pour cette composition. `town-hall-market-factory.ts` reste réservé à l’atelier : rendu du village et capacités métier inchangés. Proportions à recetter avec Tristan.

Sur la dalle de la salle, Tristan demande finalement la salle vitrée des Mathématiques avec son toit. `mathematicsCrownPlan()` fournit la même recette à l’Université et à `town-hall-clock.ts` ; l’hôtel l’adapte uniformément à la largeur disponible, avec sa grande baie tournée vers la terrasse. Le plancher prend directement appui sur la dalle (sans surélévation au-dessus de la bordure). Charpente plus sombre, toit à 20°, horloge bois centrée dans le pignon côté terrasse. Douze repères et deux aiguilles mises à jour chaque seconde de rendu pour afficher l’heure locale du navigateur ; observateur et matériaux propres libérés avec l’instance. Aucun changement économique. Chantier sans couverture ni cadran.

Retouches du préau : pente abaissée, sablière extérieure à 1.14 au-dessus du plancher, lames orientées transversalement sur la largeur du balcon et couchées sur leur face large, demi-fermes plus fines et sombres, chanfrein local de 2 % (défaut des autres bâtiments inchangé). Fonds, joues, plafonds et appuis des niches utilisent exactement le matériau pierre des murs. Deux rayons lancés depuis l’extérieur rencontrent effectivement les fonds à travers les ouvertures.

L’angle avant opposé au balcon devient un quart de rond de rayon .70 sur toute la hauteur du rez-de-chaussée et du premier niveau, avec le même axe aux deux étages. Petites pierres ordinaires .14 × .07 aux deux niveaux, disposées et tournées en rangées décalées ; leurs arêtes dépassant la courbe sont coupées, avec des faces fermées orientées vers l’extérieur. Une baie haute Mathématiques occupe le milieu de l’arrondi à 45° au premier niveau ; les extrémités des pierres sont coupées contre ses jambages. Position et dimensions de cette fenêtre conservées ; une seule assise de bordure au-dessus de la dalle, comme sur les murs droits. La baie Médecine du pignon est décalée et la baie longitudinale voisine supprimée pour laisser place au raccord. Planchers et dalles suivent la courbe ; couronnement Mathématiques conservé. Composition factory uniquement.

Les joints des deux niveaux sont fermés par une maçonnerie de mortier légèrement en retrait, utilisant le matériau pierre partagé avec une teinte plus sombre. Elle suit l’arrondi et les murs droits sans obturer les ouvertures. La découpe des meshes ne s’applique qu’au quadrant du coin : les tapées, linteaux et tablettes des fenêtres voisines sont conservés sur les façades droites. La fenêtre à 45° est encastrée de .02 dans la courbe ; jambages continus, appui pierre et tablette bois à saillie réduite. Hauteur, largeur et centrage conservés.

La salle vitrée supérieure expose six échantillons décoratifs sur de petits présentoirs bois : blocs finis foncés et clairs, briquettes rouges, planches, rondins bruts avec bouts coupés clairs, madriers carrés. `town-hall-resource-display.ts` les fusionne par matériau dans le repère du pavillon ; aucun stock économique ni entité persistante. La grande vitre de cette salle utilise un matériau transparent local (alpha .12, teinte et reflet spéculaire bleutés), laissant lire les piles ; les autres vitrages restent dépolis. Les présentoirs et cette vitre sont absents en travaux ; matériaux propres libérés avec les meshes, textures du kit partagées conservées.

Retouches de façade : les baies Médecine des deux pignons sont alignées verticalement entre RDC et premier niveau (centre mondial X = 0) ; une baie Mathématiques supplémentaire est replacée sur la façade opposée au balcon, en retrait du raccord courbe. Pierre légèrement beige via teinte des sommets, compatible avec les palettes de l’atelier ; rayon d’arête local de 12 % de la plus petite section, trois segments d’arrondi pour les pierres et encadrements du kit. Les blocs recoupés de l’angle reçoivent aussi des coins adoucis et des arêtes supérieure/inférieure arrondies. Le profil propre à l’hôtel est restauré après sa construction, sans changer la géométrie par défaut des autres recettes ; mortier et stocks d’exposition conservés.

Tristan valide la vitrine sur toute la façade arrière du RDC, prolongée dans l’angle arrondi. Les trois anciennes baies arrière sont remplacées par une ouverture continue de 3.64 × 1.12, appui à .28 ; le quart de rond est ouvert sur la même hauteur. Assise basse, bandeau supérieur et encadrements restent en pierre, sans mortier ni bloc dans le passage vitré ; jambage intermédiaire au raccord courbe supprimé. `town-hall-storefront.ts` compose deux vitres fermées : épaisseur finale de 40 % du muret (.056), face intérieure affleurant celle du mur, retrait extérieur maximal de .084. Alpha .32, teinte et spéculaire bleutés, Fresnel renforcé. Le reflet utilise une petite texture cubique statique de ciel/sol (16 pixels), modulée par la lumière jour/nuit : aucun rendu supplémentaire du village. La capture dynamique initiale de toute la scène a été retirée après signalement de lenteur. Texture, matériau et observateur libérés avec la vitrine ; verrerie absente en travaux.

Apparence validée et intégrée au village pour le niveau 2, avec ou sans layout factory, ainsi que dans les miniatures. Le générateur procédural local conserve horloge et braseros animés ; niveau 1 et capacités économiques inchangés. Les mentions « factory uniquement » ci-dessus décrivent les étapes historiques de la maquette.

## Tailleur de pierres — maquette du 6 octobre 2026

**Demandé** par Tristan : atelier ouvert sur 2 × 2 cases, mur rectangulaire au fond et charpente habituelle du kit, pignon côté ouvert. Les deux piliers initialement assemblés en blocs 3 × 1 sont remplacés par une seule colonne carrée chacun : un bloc .14 × .14 par assise, hauteur achevée 2.24. Hauteur sous ferme augmentée et pente abaissée. Pierres brutes à gauche, trois postes de taille au centre et blocs finis à droite. L’économie et les qualifications relèvent d’une tranche distincte.

`stonemason-factory.ts` compose une cour poussiéreuse, un mur arrière rectangulaire et deux colonnes de section .14 × .14, avec un seul bloc par assise. Appuis à 2.24 et pente de toit à 25°. `TimberThatch.buildRoof()` reprend la charpente et la couverture existantes sans corps habité, parquet ni plafond. Trois établis avec outils/éclats et deux stocks décoratifs complètent l’atelier. Un brasero animé du système existant se tient près du stock brut, presque sous l’auvent, dans l’état achevé. Pièces fusionnées par matériau : 9 meshes achevés, 5 en travaux. L’état travaux montre une maçonnerie moins haute, la charpente sans couverture et des matériaux en attente. Le sol et les ressources du brasero sont libérés avec l’instance ; les matériaux partagés sont conservés.

Les murs utilisent des blocs de longueur .42 et hauteur .14 (demi-blocs aux joints décalés du mur arrière). Les murs gauche et droit sont remplis, chacun percé d’une arche en pierres de taille : jambages, onze voussoirs en coin et maçonnerie ajustée autour de l’extrados. Le sommet est fermé par un bloc rectangulaire central et un trapèze de chaque côté, sans deux triangles pincés. Ouverture réelle de 1.40, naissance à 1.12 et sommet intérieur à 1.82 ; façade avant ouverte conservée. En travaux, seuls les jambages et les portions de murs en montage sont présents.

Une pile supplémentaire de dix-huit petites pierres en forme de briques (.26 × .10 × .125) occupe le centre de la cour devant l’atelier, en trois assises et deux rangs. La pile de gros blocs finis à droite est tournée ensemble de -35° autour de son centre ; les assises restent assemblées.

Sélection « Tailleur de pierres · atelier ouvert » dans la factory, ou `/factory-preview.html?world=aube&recipe=stonemason`. Les quatre orientations, les deux états et les palettes existantes restent accessibles. Les contrôles d’accès de bâtiments fermés sont masqués pour cette composition ouverte.

**Aspect validé par Tristan**, puis intégré au village comme bâtiment décoratif. Migration additive 030 : type `stonemason`, niveau 1, emprise fixe, aucune production ni coût ; construction ordinaire désactivée dans le catalogue. En DEV avec les ateliers activés, le menu Construire → Production propose « Tailleur de pierres · Décoratif · gratuit ». Aperçu 2 × 2 tournable avec R ; choix de l’emplacement par le joueur. Le serveur vérifie propriétaire, monde, terrain, portée, occupation, infrastructure et passages engagés, puis réserve les quatre cases et enregistre directement un bâtiment achevé. Une seule instance par village ; répétition idempotente. La route refuse la production et les ateliers désactivés. Aucun travail, compétence ou ordonnanceur économique ajouté. Le modèle utilise encore le générateur de la factory ; pas d’asset précalculé dans cette tranche. Les aperçus et miniatures n’activent pas le brasero.

Tristan l’a placé dans Clairière ; rendu observé dans son onglet Chrome et persistance confirmée sur quatre cases. Tests de géométrie, emprise et installation/permissions DEV verts ; détails dans le handoff courant.

## Assets compilés et premières maisons bois — 5 octobre 2026

Implémenté dans le worktree : la recette reste éditable dans l'atelier ; les modèles de série sont compilés en assets 3D, indépendamment de leurs miniatures PNG. `corepack pnpm factory:bake` (serveur Vite actif sur 5174 ; surcharge `FACTORY_BAKE_URL`) génère le manifeste et les fichiers versionnés par contenu dans `apps/world-web/public/buildings`. Après une modification de géométrie ou de matériau, régénérer et livrer le manifeste avec les assets. Le compilateur utilise Chromium pour les textures Canvas de la factory, sans lancer de suite E2E.

- Pack initial : Université niveaux 1–3 ; maison Pierre, Troncs et Madriers niveaux 1–2 ; hôtel de ville standard. Chaque modèle dispose d'un état achevé et d'un état intermédiaire de travaux. Les recettes atypiques et anciennes représentations non migrées conservent leur chemin existant ; scieries, casernes et Infrastructure ne sont pas converties dans cette passe.
- Format `AB01` : hiérarchie et matériaux Babylon sérialisés, sommets Float32 et indices Uint32 en buffers alignés, ensemble gzip. Pas de tableaux numériques JSON à développer pour les gros campus. Le chargeur prend en compte la décompression HTTP éventuelle de l'hébergeur.
- Un téléchargement et un conteneur par clé et par scène ; clones partageant géométries et matériaux. Les URLs portent un hash et utilisent le cache navigateur. Les modèles apparaissent assemblés ; aucun générateur de pierres lancé pour les campus en jeu. Le prévisualiseur de placement utilise le même pack. La maquette du village attend les chargements et invalide ses pixels quand le pack change.
- Verre dépoli réattaché au service partagé de la scène ; monuments ajoutés selon les acquis scientifiques ; feux gérés par le système vivant existant. Aucun instantané de lumière ni de simulation intégré aux assets.
- Habitat propose Troncs / Madriers / Pierre. Les deux variantes bois réutilisent toiture et ouvertures de la factory ; corps en pièces horizontales continues, coins alternés avec extrémités saillantes. Troncs à dix facettes ; madriers chanfreinés. Niveaux 1 et 2 disponibles dans l'atelier, accès et rotation conservés.
- La commande porte `houseVariant` (`stone`, `logs`, `beams`, défaut API legacy `stone`). Le choix devient une recette persistante dans `visualLayout`, participe à l'identité de commande et survit aux améliorations. L'UI propose Troncs initialement ; aucun ancien bâtiment converti.
- **Validé pour cette passe** : coûts existants identiques pour les trois choix ; aucune ressource bois d'œuvre ajoutée et production passive de la scierie inchangée. Déblocages durables par approvisionnement, artisanat, coûts différenciés et conversion économique de la scierie restent la tranche suivante, pas une économie fictive ajoutée au HUD.

Migration 029 : extension de la contrainte JSON existante aux recettes `log-house` et `beam-house`, sans réécriture des bâtiments ou ressources.

**Accès atelier implémenté :** l’option DEV commune aux deux ateliers rend visible une entrée « Créer un bâtiment » dans le showroom Bâtiments ; le même lanceur dans Infrastructure ouvre son atelier dédié. Aucun coût, ghost ni création d'entité lors de l'ouverture. La [spec Infrastructure](SPEC-INFRASTRUCTURE-VOIRIE-ATELIER.md) porte le contrat d'activation et de navigation. Aucun rôle administrateur ajouté ; accès authentifié par monde, refus en production et arrêt sur révocation.

**Extension Infrastructure implémentée dans le worktree :** la [spec Infrastructure](SPEC-INFRASTRUCTURE-VOIRIE-ATELIER.md) ajoute les accès multiples (position, normale, largeur, principal), leur contrat spatial partagé avec le serveur, la rotation R lors des placements et l'atelier Infrastructure sur grille 8 × 8. Elle prévoit les futures compositions sans livrer leur éditeur. L'atelier Bâtiments permet de configurer les accès des recettes simples ; les campus et casernes conservent leurs accès composés, sans afficher de faux contrôles. Les réglages d'atelier restent locaux, sans publication de recettes utilisateur.

Extension future spécifiée le 3 octobre : [Université et monuments scientifiques](SPEC-UNIVERSITE-SCIENCES-DECOUVERTE.md#12-architecture-visible-et-monuments). Composition dédiée autour d'une cour, silhouettes par niveau et état intermédiaire de travaux ; les niveaux du bâtiment expriment la capacité, les monuments les acquis du joueur/monde. Chaque grand palier débloque son monument dans toutes ses Universités, présentes et futures. Recettes, dimensions et placement restent à concevoir ; aucune Université ajoutée à la factory dans cette session de spécification.

Date : 2 octobre 2026, mise à jour le 3 octobre. Statut : **première implémentation disponible, recette visuelle en cours**.

## Première livraison et réglages de recette

Intégration du campus acceptée le 3 octobre : `buildUniversity` compose désormais les trois départements validés, le terrain herbeux 5 × 6 (grain/mipmaps), sept arbres et les monuments scientifiques existants, aussi bien en atelier que dans le jeu. Construction/prévisualisation réservant 30 cases, centre déduit de l'emprise. En jeu, les six braseros du niveau 3 rejoignent le composant des routes, nuit/LOD et budget lumineux global conservés ; pas de boucle lumineuse concurrente. L'Université de recette d'Aube a été agrandie puis retirée sur demande de Tristan : l'emplacement ne convenait pas aux chemins. Les 30 cases sont libérées, connaissances conservées ; modèle disponible en atelier et pour les prochaines constructions, pas de réimplantation automatique. Validation graphique du placement en jeu différée, aucun test exécuté pendant cette passe.

Atelier : trois sélecteurs de palette, toit/charpente (bois brun, clair, naturel) et maçonnerie (pierre claire, briques rouges, pierre sombre). Ils modifient les matériaux en direct sans reconstruire le modèle ; choix locaux à la page, conservés quand on change de recette/état/orientation. La charpente partage le matériau bois des menuiseries/parquets. Les briques rouges constituent une variante de teinte, sans nouvelle géométrie de maçonnerie.

Porte générée comme composant atomique (`timber-door.ts`) : planches verticales, traverses et renfort Z dans un repère commun, transformés ensemble vers la face d'entrée. Géométrie fusionnée ensuite au lot bois du bâtiment ; aucune animation de charnière dans cette tranche.

Recette campus : un module supérieur peut désactiver son entrée extérieure (`entrance.enabled: false`) ; aucune baie de porte n'est alors creusée. Le kit accepte une ouverture centrale de toiture sur son axe longitudinal pour accueillir un pavillon surélevé : charpente, couverture et isolation sont générées de part et d'autre. Sans cette option, les recettes existantes conservent leur toiture complète. Première utilisation : pavillon central de Mathématiques, pignon exposé en façade.

Préau d'entrée de Mathématiques : passage ouvert (`entrance.open: true`) élargi à quatre sous-cases et huit assises, sans vantail en bois ni petite fenêtre latérale. Une couverture plate en pierre d'une case de large et trois sous-cases de profondeur est portée par deux colonnes octogonales, avec bases et chapiteaux ; bases alignées sur la dernière marche du grand escalier. Les éléments pierre du préau sont fusionnés en un mesh distinct. En travaux, les colonnes sont partielles et la couverture absente. Les portes des autres recettes conservent leur vantail par défaut.

Mathématiques : variante `roof.style: flat-stone` pour les corps principal et latéraux, seule la toiture du chapeau reste en bois. Dalle plate en pierre sans débord, rebord en blocs d'une demi-pierre de large et d'une assise de haut après recette ; coins assemblés sans chevauchement, pas de rebord à la jonction avec un corps plus haut. Une ouverture centrale interrompt aussi la dalle sous le chapeau. Charpente et foin ne sont pas générés pour les toits plats ; les planchers intérieurs sont conservés. L'état intermédiaire de travaux n'affiche pas la dalle et le rebord achevés.

Ouvertures explicites du kit : `windowOpenings` précise face, niveau, centre en demi-modules, largeur en modules, allège et hauteur en assises. Cette liste s'ajoute aux fenêtres réparties par nombre ; Mathématiques désactive cette répartition automatique pour définir sa grande baie centrale, les fenêtres hautes/fines des étages ; l'ancienne petite fenêtre au sol a ensuite été retirée au profit d'un préau de pierre à deux colonnes. Les dimensions restent sur la trame de maçonnerie et les ouvertures sont validées avant génération des pierres ; menuiseries et linteaux suivent les mêmes baies.

Vitrage de recette, Mathématiques, Médecine et Géographie : `frosted-glass.ts` pose des surfaces dans les baies non portes déjà réalisées, fusionnées par module. Un `RenderTargetTexture` de 512 × 512 partagé capture le décor sans les vitrages ; un `ShaderMaterial` réalise un flou à neuf prélèvements, avec voile bleuté et grain discret. La capture est retirée des rendus lorsque le dernier module vitré est supprimé, réutilisée aux changements de recette et libérée avec la scène. Pas de capture par fenêtre, pas de nouveau mécanisme métier ; rendu visuel à recetter, coût non mesuré pendant cette passe sans tests.

Médecine dans l'atelier : réservation 2 × 3 cases devant à gauche du campus 5 × 6. Recettes validées : niveau 1 = 8 × 22 sous-cases sur un niveau ; niveau 2 = ce corps plus deux ailes 8 × 6 aux extrémités, formant un C vers la cour (+X) ; niveau 3 = ce C plus un étage 8 × 22 sur le corps initial. `medicine-factory.ts` utilise la trame 8 × 8, les toits plats en pierre et les vitrages du kit. Enveloppe maximale 16 × 22 contenue dans la réservation ; corps aligné à gauche, centre local X/Z (−5 ; −3,75). Aux raccords, murs partagés retirés uniquement au rez-de-chaussée, pierres terminales prolongées pour garder des façades jointives. Les rives longitudinales du toit plat suivent les portions de murs conservées au dernier niveau, évitant les rebords internes aux jonctions. En travaux, les volumes conservés restent achevés : corps au niveau 2, ailes au niveau 3. Recette visuelle humaine restante, sans profession ni capacité médicale métier.

Géographie dans l'atelier : bande 3 × 1 cases sur le côté droit, entrée vers la cour. Première recette interne 6 × 22 sous-cases, trois modules contigus 6 × 8 / 6 × 6 / 6 × 8, toits plats et vitrages du kit. Niveau 1 : un niveau uniforme ; niveau 2 : chapeau central (hauteurs 1/2/1) ; niveau 3 : podium proposé (2/3/1 de l'avant au fond). `geography-factory.ts` réutilise le raccord longitudinal exporté `openLongitudinalJoin` des Mathématiques, à hauteur partagée entre chaque paire de volumes ; continuité des pierres aux façades et parquet raccordé, sans toit intercalaire dans les volumes rehaussés. Les parties existantes sont conservées achevées en état de travaux. Implantation et silhouette à recetter humainement, sans changement métier.

Décor du campus : sept arbres non exploitables, trois côté Médecine, trois côté Géographie, un à gauche de Mathématiques entre les deux départements. `campus-decoration.ts` reprend la silhouette du terrain (tronc six faces, deux couronnes sept faces), avec tailles/rotations variées ; trois meshes fusionnés, deux matériaux feuillage libérés avec le modèle, bois partagé avec le kit. Aucune entité naturelle persistante. Mathématiques niveau 3 achevé : trois braseros de chaque côté de l'escalier, au sol contre le socle. `VillageBraziers.updatePoints` accepte leurs positions explicites, conserve modèle, petites flammes désynchronisées et budget lumineux existants ; feux allumés en atelier pour la recette. Positions transformées avec le site/orientation d'atelier ; animation, particules/lumières et matériaux propres supprimés au changement de recette. Première représentation appréciée par Tristan, nouveaux placements à recetter sans tests.

Implantation Mathématiques dans l'atelier : rangée du fond du campus, façade d'entrée/chapeau retournés de 180° vers la cour. Socle maçonné et palier 3 × 1 cases aux niveaux 1/2, 5 × 1 au niveau 3 ; escalier central de deux cases de large, deux/quatre/six marches, giron 1/8 de case et hauteur d'assise 0,14. Maçonnerie périphérique creuse et escalier sont fusionnés en un mesh pierre ; le bâtiment est surélevé au niveau du palier sans vide sous les murs. Cette recette graphique explicite ne crée pas un socle automatique pour les autres bâtiments et ne modifie pas l'occupation persistée.

L'atelier affiche au sol les cases de l'emprise sélectionnée, avec un voile léger et des limites blanches. Le campus affiche aussi sa subdivision 8 × 8 : traits bleu foncé semi-transparents aux huitièmes, traits bleu moyen à mi-case. Ces trois groupes de lignes ne se superposent pas. Ce quadrillage suit les rotations du modèle, est remplacé à chaque changement de recette et reste distinct du budget géométrique du bâtiment.

Texture du parquet de rez-de-chaussée tournée de 90°, sens de pose et joints décalés conservés.

Toiture affinée en recette : panne faîtière 0,11 de large au lieu de 0,22, hauteur 0,20 conservée. Arbalétriers/poinçon à la section de l'entrait (0,123 × 0,153). Pannes secondaires amincies ; chevrons et liteaux encastrés dans leur couche au lieu de couches empilées, couverture en contact avec le dessus des bois. Débords et pente conservés.

Après ajustement de la charpente, couverture raccourcie d'une largeur de planche sur chaque versant : débord latéral 0,290 au lieu de 0,535. Débord des pignons inchangé ; charpente inchangée lors de ce réglage.

Cour de caserne en terre battue, variations de teinte discrètes et lisière irrégulière estompée sur l'herbe. Un mesh de sol supplémentaire, matériau libéré avec la caserne, sans particules. Bois de charpente et couverture assombri pendant la recette ; veinage conservé (le matériau bois partagé concerne également cadres et parquet).

Recette sur la map de développement : `/?world=aube&barracksPreview=1`. Aperçu décoratif temporaire, sans bâtiment ni occupation persistés, disponible uniquement en mode développement. Recherche bornée d'une emprise 2 × 5 plane dans le snapshot, marge d'une cellule libre autour des occupations et éléments naturels. L'instance conserve son mesh entre snapshots et suit les rebases/LOD du village ; aucun recrutement ni commande métier. Cette vue présente également les habitations historiques avec le nouveau kit, via une copie locale du snapshot conservant leurs niveaux et capacités. Omettre le paramètre supprime l'aperçu.

Ouvertures, décision révisée en recette : tapées/linteaux en pierre, utilisant la même géométrie chanfreinée que les blocs de maçonnerie. Chaque fenêtre reçoit en façade un encadrement de fines planchettes en bois sur les deux montants et le haut ; la tablette en bois ferme le cadre en bas et déborde dedans/dehors comme précédemment. Pas de tablette bloquant les portes. Fil du bois des planchettes tourné de 90°. Parquet intérieur au rez-de-chaussée, planches à joints décalés, fusionné au lot bois et limité au volume intérieur des murs.

Plan modulaire pur dans `building-plan.ts`, rendu fusionné dans `timber-thatch.ts`, atelier isolé à `/factory-preview.html`. Recettes hôtel de ville, maison à deux niveaux, maison avec muret et caserne. Entrée, chemin d'accès et cible de caméra utilisent le même plan ; les instances inchangées sont conservées. Les anciens bâtiments sans `visualLayout` conservent leur représentation historique. Un état de travaux est disponible, avec maçonnerie incomplète, charpente apparente et échafaudage ; les silhouettes régionales distinguent également les travaux.

Le pilote Clairière réserve réellement deux cellules : ancre `(1101,21)`, extension `(1101,20)`, entrée `+x`. Les migrations 023/024 ont été appliquées au développement après validation sur test. Le script `scripts/configure-building-factory.ts` propose d'abord un aperçu transactionnel annulé ; `--apply` réalise la conversion explicitement. Les nouveaux hôtels de ville du seed de développement utilisent ce pilote ; les villages existants ne sont pas agrandis implicitement.

Réglages demandés pendant la recette : débord de couverture supplémentaire sur chaque versant, sans prolonger la charpente (dimension finale 0,290 après affinement) ; couverture allongée de 10 % au total côté pignons (5 % par extrémité). Les étages impairs de la maison carrée sont tournés de 90°, mais le toit conserve l'orientation du rez-de-chaussée. Une assise de pierre ferme le pourtour à l'épaisseur des planchers entre niveaux. Le débord de couverture hors emprise est explicitement permis ; il n'étend pas l'autorité constructible. La vérification des collisions de ces débords avec tous les bâtiments voisins reste à compléter.

**Caserne validée : modèle et catalogue seulement.** Emprise 2 × 5, deux pavillons 2 × 1, cour 2 × 3, murets de trois assises. Préau descendant vers le muret, croix de Saint-André au fond et aux deux extrémités, quatre poteaux côté tireurs entre les trois cibles et huit côté muret. Cibles circulaires sur trépieds : deux pieds avant, un pied central arrière. Aucun coût, recrutement ni entraînement simulé ; catalogue non constructible et sans niveaux métier pour l'instant.

Vérifications : tests ciblés du plan, de la géométrie Babylon et de sa libération, entrée caméra, silhouette régionale ; intégration DB du pilote, refus d'occupation et catalogue non constructible. Pas d'E2E. Balcons et investissement animé restent hors de cette première réalisation. Les sections « Existant vérifié » ci-dessous décrivent l'état avant cette implémentation.

La factory construit un bâtiment à partir d'une emprise, d'un module de maçonnerie et d'une recette. Les murs déterminent les dimensions ; toiture, charpente, plafond et isolation s'y ajustent. Elle prolonge le kit de l'hôtel de ville validé en recette, sans remplacer le système de monde, l'économie ou la circulation des habitants. Premier consommateur : hôtel de ville sur une emprise réelle de deux cellules, entrée au centre du grand côté.

## Décisions et périmètre

**Validé par Tristan** : dimensions multiples des pierres, calepinage cohérent aux angles, toiture adaptative ; hôtel de ville sur 1 × 2 cellules avec entrée sur le grand côté. La factory doit prendre en compte l'emprise, la taille relative aux cellules, le placement dans celles-ci, le nombre de modules L × l, la face d'entrée, le nombre d'étages, les fenêtres par étage et les murets de bordure avec ouverture alignée sur l'entrée. La faisabilité des balcons est à étudier.

Le toit à deux pans, les fermes ouvertes, la charpente, le plafond plat et le foin ont été validés visuellement. La factory reprend ces éléments et leurs proportions, pas leurs dimensions absolues. Pierre claire aux coins légèrement adoucis ; porte de bois à renfort Z ; fenêtres ouvertes ; aucun piédestal ni préau.

**Proposé pour la première réalisation** : recette déclarative interne, sans éditeur public de bâtiments, escaliers fonctionnels ni nouveaux coûts/couchages. Murets disponibles comme option de génération, désactivés sur le pilote tant qu'on ne les choisit pas en recette. Balcons documentés mais non construits dans cette tranche.

**Ajout validé par Tristan** : la factory propose des représentations intermédiaires de travaux entre les niveaux métier d'un bâtiment, destinées plus tard à animer les investissements. Cette première tranche fournit un seul état intermédiaire par transition prise en charge, en plus des états achevés de départ et d'arrivée. Aucun nouveau mécanisme économique d'investissement n'est introduit.

## Existant vérifié

- `BabylonVillageScene.ts` utilise une cellule de 2,5 unités graphiques. Le kit est dans `timber-thatch.ts`, avec pièces fusionnées par matériau et géométrie de poutres testée.
- PostgreSQL réserve les cellules dans `world_cell_occupancies`. Le seed initialise actuellement l'hôtel de ville avec une cellule `anchor`. L'occupation supplémentaire n'est pas créée par un mesh plus grand.
- Le snapshot expose les occupations par bâtiment ; l'instance est portée par l'ancre. Le pipeline dessine encore les cellules séparément : il devra réunir l'emprise pour générer une seule instance.
- L'entrée de l'hôtel de ville est actuellement codée sur −Z dans `#workerPath()` et `#leisurePath()`. Son déplacement impose de remplacer ces coordonnées fixes par les points de la factory.
- Le catalogue et la population calculent les couchages métier indépendamment du mesh. Un étage graphique supplémentaire ne doit pas modifier cette capacité.

## Contrat de génération

| Paramètre | Sens et règle |
|---|---|
| Emprise | Liste des cellules canoniques appartenant réellement au bâtiment, avec ancre, monde et orientation. Le pilote exige un rectangle 1 × 2 ; pas de réservation client. |
| Taille d'une cellule | Échelle graphique commune, actuellement 2,5. Jamais confondue avec un nombre de cellules serveur. |
| Module | Longueur, hauteur d'assise et épaisseur, joints compris. Proposition pierre : 0,28 × 0,14 × 0,14 ; une longueur vaut deux épaisseurs. |
| Dimensions du corps | Nombre entier de modules sur les deux axes et nombre entier d'assises par étage. Pas de mise à l'échelle libre des pierres. |
| Taille relative | Taux d'occupation désiré de l'emprise, utilisé pour choisir des nombres entiers de modules si ceux-ci ne sont pas explicitement fournis. La taille effective est renvoyée après quantification. |
| Placement | Ancrage centré ou sur une face de l'emprise, puis décalage dans le plan local. Le décalage déplace le bâtiment entier, porte et toit compris. |
| Rotation | Quarts de tour, appliqués à toute la recette. Elle ne change pas silencieusement la liste de cellules occupées. |
| Entrée | Face locale −X, +X, −Z ou +Z ; position sur la grille modulaire de cette face, largeur en modules, hauteur en assises. |
| Niveaux habitables | Nombre de niveaux graphiques, rez-de-chaussée inclus ; nombre d'assises et épaisseur du plancher par niveau. Un niveau habitable signifie seulement un rez-de-chaussée. Distinct du niveau métier du bâtiment. |
| État de travaux | Niveau métier acquis, niveau métier cible éventuel et état autoritatif de construction. Une recette de transition fournit un état intermédiaire unique dans cette tranche. |
| Fenêtres | Nombre demandé pour chaque étage et chaque face ; largeur/hauteur modulaires, hauteur d'allège et espacement minimal. Possibilité de positions explicites sur la grille. |
| Toiture | Pente, débord et épaisseurs relatives du kit. Dimensions déduites du dernier étage. Le pilote conserve l'angle intérieur de 110°, soit deux pentes de 35°. |
| Murets | Activation par bordure extérieure de l'emprise, hauteur en assises, épaisseur et ouverture de passage. Pas de mur automatique entre deux cellules du même bâtiment. |
| Balcon | Extension future identifiée par étage, face, position et dimensions modulaires. Non générée dans le pilote. |

Si les modules sont explicites, ils déterminent les dimensions et le taux d'occupation devient une mesure, pas une seconde source de vérité. Si seule la taille relative est fournie, choisir le plus grand nombre entier de modules qui respecte la cible et les marges. Ne pas cumuler deux contraintes incompatibles sans les signaler.

L'emplacement est défini par rapport au rectangle de l'emprise entière. Pour une cellule, cela revient à un placement dans la cellule ; pour 1 × 2, on place le bâtiment dans l'union, pas deux fragments indépendants. Prévoir des marges par face pour les passages, les murets et les futurs balcons.

Le contrat reste centré sur des volumes rectangulaires. Une emprise irrégulière exige une recette adaptée et ne doit pas être remplie arbitrairement par un grand cube.

## Implantation durable et repère local

Conserver côté serveur l'identifiant et la version de recette, l'orientation en quarts de tour et les éventuelles dérogations de placement/entrée propres au bâtiment. Les dimensions, matériaux et ouvertures par défaut se déduisent de la recette versionnée ; ne pas persister chaque pierre. Les contrats JSON exposent les données nécessaires au même résultat pour tous les clients. La structure actuelle ne porte pas encore ces champs : prévoir une évolution additive et un repli explicite vers la recette historique pour les bâtiments existants, sans agrandissement implicite.

Choisir l'orientation vers le chemin une fois à l'implantation ; un nouveau chemin, un rechargement ou un changement de caméra ne doit pas faire tourner le bâtiment. Toute modification ultérieure de son implantation doit être explicite et revérifier son emprise.

Assembler les cellules dans un repère local continu autour de l'ancre, à partir de leurs décalages toriques. Ne jamais calculer le rectangle par min/max des coordonnées canoniques brutes : les cellules de coordonnées 0 et largeur−1 peuvent être voisines. Appliquer une transformation commune aux murs, au toit, aux ouvertures, aux murets et au cadrage ; projeter ensuite l'ensemble dans la copie visible du monde. Les variations décoratives sont déterministes pour un bâtiment et une recette donnés.

## Assise au sol et dégagements

Le plan inclut une altitude de référence pour le plancher et le seuil, calculée depuis les hauteurs du terrain de toute l'emprise. Pour le pilote, retenir une emprise plane à la précision des hauteurs du terrain ; une différence supérieure à cette tolérance doit être signalée avant réservation, sans terrassement ni piédestal automatique. Fixer cette tolérance numérique depuis le format réel du terrain lors de l'implémentation. Les bâtiments historiques conservent leur présentation tant qu'ils ne sont pas convertis. Les terrains en pente restent une extension ultérieure.

Les marges de toiture ne sont pas des couloirs praticables. Le corps proposé laisse 0,13 unité de chaque côté sur l'axe étroit ; le rayon actuel d'un habitant vaut 0,18 et son dégagement de circulation vaut 0,44 (`WORKER_CLEARANCE`). Réserver au moins ce dégagement libre pour les passages nécessaires, en tenant compte des murets, consoles à poteaux et autres obstacles. Il n'est pas nécessaire de pouvoir faire le tour de chaque bâtiment, mais porte, ouverture et raccord à la ruelle doivent être accessibles. Réutiliser les constantes de circulation plutôt que recopier leur valeur dans le générateur. Une recette avec murets peut donc nécessiter moins de modules ou un placement décalé ; ne pas appliquer aveuglément les dimensions du pilote.

## Grille de maçonnerie

Utiliser une grille de demi-modules pour les positions des joints : module entier pour les pierres courantes, demi-pierres pour le décalage des assises et les angles. Les dimensions extérieures restent des nombres entiers de modules. L'épaisseur vaut un demi-module pour cette recette, ce qui permet les retours d'angle alternés.

Une assise sur deux, un mur traverse le coin et l'autre s'arrête à sa face intérieure ; l'assise suivante inverse ces rôles. Les faces extérieures restent sur les mêmes plans et les volumes ne se superposent pas. Hauteurs d'assises identiques sur les quatre murs.

Les ouvertures sont placées sur cette grille, avec des hauteurs alignées sur les assises. Composer pierres entières, demi-pierres et pièces d'encadrement identifiées ; supprimer le clipping généralisé qui crée des petites pierres arbitraires. Les joints font partie du module : un bloc visible est légèrement plus petit, sans augmenter la longueur de chaque rangée.

Les encadrements peuvent employer une pièce de linteau plus longue explicitement prévue. Ce n'est pas une pierre courante étirée aléatoirement. Les coins conservent leur léger arrondi cartoon, avec des normales extérieures et une orientation qui ne permute pas hauteur et épaisseur.

## Entrée et fenêtres

La face d'entrée est locale au bâtiment avant rotation. La factory renvoie sa normale, le seuil, un point juste à l'intérieur, un point dégagé à l'extérieur et le passage dans le muret éventuel. Toute rotation ou translation applique la même transformation à ces points.

Sur une façade, répartir les fenêtres sur des positions entières ou demi-modulaires. Distribuer les intervalles restants sur la grille, de façon symétrique autant que possible ; ne pas déformer les baies pour atteindre un compte impossible. Respecter les piédroits aux angles et l'espace de la porte. Une recette impossible doit être refusée explicitement, pas perdre des fenêtres silencieusement.

À un étage supérieur, la hauteur résulte des assises et du plancher de l'étage précédent. Le nombre et la disposition de fenêtres peuvent différer selon la face et l'étage. Aucun vitrage dans le kit actuel.

## Toiture et isolation adaptatives

Le rectangle supérieur fixe la portée et la longueur du toit. Calculer la hauteur du faîtage par la portée et la pente ; ajouter les débords sans étirer les matériaux. Répartir les fermes selon un entraxe maximal propre au kit : une ferme par pignon et le nombre de fermes intermédiaires nécessaire, espacées régulièrement. Distinguer cet entraxe longitudinal de la portée transversale franchie par chaque ferme ; le kit doit borner les deux.

Le plan renvoie aussi l'enveloppe de la toiture. Pour le pilote, proposer un débord borné par les marges de l'emprise : la largeur de 2,24 laisse 0,13 de chaque côté dans une cellule de 2,5. Un débord plus grand doit être un choix explicite de présentation, pas une extension implicite d'autorité ni un toit pénétrant dans le bâtiment voisin.

Les pannes suivent cette longueur. Chevrons, liteaux et planches sont distribués depuis les dimensions obtenues. Les contacts entre couches utilisent leurs épaisseurs selon la normale du toit, comme dans le kit validé. Panne faîtière continue et faîtage joint au sommet ; nez visibles aux pignons.

Le plafond plat ferme le dessus du volume habité ; le foin repose dessus dans les espaces entre les fermes. Il ne remplit pas les pignons et ne colle pas aux sous-pentes. Aux étages intermédiaires, réutiliser le parquet pour les planchers. Le nombre d'étages ne multiplie pas les couches de foin : l'isolation reste sous la toiture supérieure.

## Murets et passage aligné

Construire le périmètre extérieur de l'union des cellules occupées. Supprimer les bordures communes, fusionner les bordures colinéaires et identifier chaque bord dans l'espace canonique du monde. Cela évite un mur au milieu de l'hôtel de ville et les doublons à la couture torique.

Entre deux bâtiments voisins, identifier également les demandes portant sur le même segment canonique. Une seule géométrie est produite : parmi les bâtiments demandant un muret, l'UUID canonique le plus petit désigne son propriétaire graphique et sa recette. L'union des ouvertures nécessaires des deux côtés est conservée. Le segment est invalidé si l'un des voisins change ; son propriétaire est déterminé depuis les données des voisins, jamais depuis l'ordre de chargement des meshes. Cette propriété graphique n'accorde aucun droit territorial. Ne pas couper une ruelle existante : refuser une recette dont le passage ne peut pas être raccordé dans les dégagements disponibles.

Projeter l'axe de sortie de la porte sur la bordure correspondante, puis retirer un intervalle assez large pour le passage. L'ouverture peut chevaucher deux segments de cellules : la traiter comme une ouverture unique, sans poteau au milieu. Les morceaux de muret utilisent le même calepinage et les mêmes assises.

Le passage doit être réellement dégagé entre porte, ouverture et chemin. Si un muret exige une marge absente du placement choisi, signaler l'incompatibilité ou proposer une réduction modulaire du corps ; ne pas ajouter des habitants traversant le mur. Les obstacles graphiques et les passages rejoignent la couche de circulation existante, sans nouveau moteur de foule. Les murets restent décoratifs côté économie ; leur éventuelle autorité métier future est hors de cette tranche.

## Balcons

**Faisabilité géométrique : bonne.** Le parquet validé fournit le plateau, les poutres fournissent consoles ou petits poteaux, un garde-corps bas se compose de pièces simples. Ces éléments partagent matériaux, picking, ombres et destruction avec leur bâtiment. Pas de modèle externe nécessaire.

Première variante proposée : balcon droit à partir du premier étage au-dessus du rez-de-chaussée, appuyé sur deux consoles, garde-corps simple, porte d'accès dédiée sur la face choisie. Pas de balcon d'angle ni de PNJ animés sur le balcon dans la première réalisation éventuelle.

Le balcon doit respecter une marge prévue dans l'emprise, ne pas chevaucher un autre bâtiment ni fermer une ouverture basse. Sa porte remplace une fenêtre déclarée ou possède une position dédiée ; elle ne s'ajoute pas sur la même baie. Garder le nombre de fenêtres effectif explicite. Une variante à poteaux consomme un passage au sol et demande un contrôle supplémentaire.

L'accès animé aux étages/balcons, escaliers et navigation verticale restent ouverts. Le rendu statique est réalisable indépendamment ; leur simulation n'est pas autorisée par la seule présence du mesh.

## Résultat commun pour le rendu et la circulation

Un plan de génération calculé une fois fournit dimensions, limites du corps/toit, occupation relative, niveaux des planchers, ouvertures, points d'entrée, passage des murets, obstacles et centre de cadrage. Le rendu, la caméra et les habitants consomment ces mêmes données, sans recopier des constantes de porte dans chacun.

Les chemins métier restent serveur. Le raccord local part de la porte calculée, passe par l'ouverture du muret s'il existe et rejoint le trajet autoritatif sans traverser le corps. Conserver l'acceptation déjà donnée d'un petit décalage de représentation sans modifier crédits, fatigue ou temps métier.

La caméra d'arrivée vise le centre réel de l'hôtel de ville ou le point de cadrage déclaré, pas nécessairement sa cellule d'ancre. Le même plan sert après recentrage, rotation, rechargement et changement de LOD. Les géométries locales ne deviennent pas des entités persistantes individuelles.

## Représentations intermédiaires de travaux

Le niveau métier et le nombre de niveaux habitables sont deux axes distincts : une amélioration peut changer des matériaux, une toiture ou des équipements sans ajouter d'étage. La factory décrit les transitions entre deux recettes achevées, pas une règle automatique « amélioration = étage supplémentaire ».

Pour chaque transition prise en charge, prévoir trois représentations : état acquis, état de travaux, état cible achevé. Le contrat de transition identifie les recettes source/cible et une liste ordonnée d'étapes visuelles ; cette liste contient **une seule étape `travaux`** pour l'instant. Cela permet d'ajouter des étapes plus tard sans créer maintenant de chronologie ou de tâches serveur supplémentaires. Les couples pris en charge sont déclarés explicitement, sans inventer de niveau supérieur pour un bâtiment qui n'en possède pas.

L'état de travaux est généré à partir des parties conservées et transformées : conserver les murs/planchers inchangés ; représenter la zone modifiée par une maçonnerie partielle ou une charpente découverte et un échafaudage simple. Chaque recette de transition choisit ses éléments, sans superposer intégralement les deux bâtiments et sans remettre un cube de chantier générique autour du kit. Il reste reconnaissable aux dimensions du bâtiment et respecte son emprise réservée. Échafaudages et matériaux restent dans les marges disponibles et ne bloquent pas l'entrée utilisée par les habitants.

L'état autoritatif déclenche la présentation : niveau acquis hors travaux ; état intermédiaire lorsque le serveur indique la construction/amélioration ; recette cible uniquement après confirmation de l'achèvement. La progression temporelle ne change pas le mesh dans cette première tranche et le client ne conclut pas les travaux à partir de son horloge. Un rechargement en cours de chantier reconstruit directement le même état. Une construction initiale utilise une source vide ; une amélioration conserve les parties et accès encore utilisés selon les règles métier existantes.

L'ancre, l'orientation et les points de circulation communs restent stables pendant les travaux. Pour cette tranche, conserver le seuil d'entrée pendant une amélioration ; les recettes qui déplaceraient cette entrée nécessitent une règle de bascule ultérieure explicite. La factory n'ajoute ni indisponibilité, ni coût, ni rendement, ni couchage anticipé. Pause, annulation ou changement de cible ne sont pris en charge que s'ils existent côté métier ; la présentation suit alors le nouvel état reçu.

La silhouette agrégée reste cohérente avec l'emprise et l'état de travaux sans afficher chaque échafaudage en région. Les animations d'ouvriers, les livraisons de matériaux et les étapes progressives d'investissement sont hors de cette première tranche. Une recette de transition peut être examinée en aperçu isolé sans modifier un niveau métier ni simuler un investissement en base.

## Coût du rendu et durée de vie

Conserver les plans et meshes inchangés par identifiant de bâtiment et signature de recette, implantation et état de travaux. Une sélection, un passage en mode construction ou un rafraîchissement économique sans changement géométrique ne doit pas reconstruire les bâtiments. Un changement de phase remplace seulement les éléments concernés, puis libère les géométries devenues inutiles ; les matériaux partagés restent vivants tant qu'ils sont utilisés.

Fusionner les pièces statiques par matériau à l'intérieur d'un bâtiment et borner les variantes. Fixer lors du pilote un budget mesuré de sommets, meshes et coût de génération pour les recettes achevée et intermédiaire ; documenter ces valeurs avant généralisation aux maisons. Aucune pièce décorative ne devient un objet animé par frame. Les LOD région/monde utilisent leurs volumes agrégés existants ; ils ne génèrent pas le détail pierre par pierre. Vérifier des bascules répétées entre niveaux de détail et phases sans croissance des géométries conservées.

## Hôtel de ville pilote

Proposition numérique à conserver comme recette initiale ajustable en séance :

- emprise réelle 1 × 2 cellules de 2,5, soit 2,5 × 5 ;
- murs de 8 × 16 modules de 0,28, soit 2,24 × 4,48 ;
- un niveau habitable (rez-de-chaussée seul) de 12 assises de 0,14, soit 1,68 ;
- placement centré dans l'emprise ; taux effectif 89,6 % sur chaque axe ;
- entrée centrée sur un grand côté, face orientée vers le chemin après inspection du placement réel ;
- fenêtres proposées : deux par grand côté, une par petit côté, disposition ajustée à la porte ;
- toit validé à 35°, pignons ouverts, plafond plat et foin ;
- murets désactivés et aucun balcon pour le premier rendu.

Les choix 1 × 2 et entrée sur grand côté sont validés. Les nombres exacts de modules, fenêtres, la face mondiale et les options initiales restent une proposition de recette, pas une approbation implicite de tous les chiffres.

## Occupation serveur et compatibilité

Avant d'agrandir l'hôtel de ville pilote, vérifier la cellule voisine réelle : même monde, terrain compatible, dans le périmètre autorisé et libre. Réserver l'extension dans une transaction sous verrou village. Aucun déplacement ou écrasement d'un jardin, gisement ou bâtiment pour faire tenir le rendu.

Conserver le protocole `beginVillageEconomy()` et sa borne H après acquisition du verrou, puis la réconciliation et les règles d'autorité du village. Cette opération administrative de recette ne doit pas emprunter implicitement les coûts, timers ou commandes d'extension d'un Jardin.

La factory reçoit l'emprise autoritative, elle ne crée pas la seconde occupation. Réunir les cellules d'un même bâtiment pour dessiner une seule instance et attribuer les sélections à son identifiant. Les recettes existantes à une cellule ne deviennent pas automatiquement des emprises à deux cellules dans tous les mondes. Le seed devra refléter les futures implantations, mais sa modification ne suffit pas pour les villages existants.

Une emprise terminée supplémentaire peut modifier les cellules constructibles et les accès aux ressources. Cela suit les règles existantes du serveur ; ne pas modifier simultanément leurs distances, ressources ou couchages. Toute représentation agrégée de région/monde doit conserver cette implantation.

## Ordre de réalisation

1. Plan modulaire pur : dimensions, placement, coins, ouvertures et points d'entrée ; assertions de validité et tests ciblés.
2. Adapter le kit visuel validé à ce plan, sans migration générale ni moteur générique de meshes.
3. Vérifier/réserver les deux cellules du pilote, réunir son rendu, raccorder les habitants et le cadrage à l'entrée latérale.
4. Recette humaine du bâtiment et de ses départs/retours ; vérifier les deux orientations et les niveaux de zoom.
5. Ajouter les paramètres niveaux habitables/fenêtres et vérifier une recette de deux niveaux (rez-de-chaussée et premier étage). Ne pas attribuer de nouveaux couchages.
6. Activer un exemple de muret avec passage aligné. Balcon statique seulement dans une passe ultérieure autorisée.
7. Générer et recetter un état intermédiaire de travaux entre deux recettes prises en charge, puis brancher les états métier existants. Vérifier aussi la construction initiale, le rechargement en cours de travaux et l'achèvement confirmé. Utiliser un aperçu pour toute transition sans commande métier existante.

La factory se limite au plan paramétrique et au constructeur du kit. Pas de refonte de l'architecture de monde ni de système complet de bâtiments personnalisables.

## Vérification proportionnée

Tester les résultats géométriques : dimensions entières et exactes, coins couverts sans chevauchement, hauteur/épaisseur conservées après rotation, baies modulaires, portes transformées correctement, passages de murets continus même à cheval sur deux cellules. Vérifier qu'un plan impossible est rejeté sans modifier l'emprise.

Ajouter les cas de couture torique, orientation conservée après rechargement/ajout de route, dénivelé incompatible, passage trop étroit et muret commun sans doublon avec ouvertures préservées. Vérifier que la sélection seule conserve la géométrie existante et qu'un remplacement de phase ne conserve pas les anciens meshes.

Travaux : vérifier la sélection des recettes source/intermédiaire/cible depuis l'état reçu, sans achèvement local anticipé ni effets économiques. Contrôler la stabilité de l'ancre, de l'entrée et du cadrage, l'absence de superposition des bâtiments complets et le retour au même état après rechargement. Les nombres de niveaux habitables peuvent différer sans être déduits du niveau métier. Recette humaine de l'état intermédiaire et des départs/retours devant le chantier.

Pour le pilote à deux cellules, tests ciblés des occupations et de l'absence de double rendu ; vérifier en recette la porte, les fenêtres, le cadrage et les habitants. Balcons : validation géométrique et visuelle éventuelle, sans tests de navigation verticale tant qu'elle n'existe pas. Pas de suite E2E dans cette séance ; une passe de clôture plus large reste prévue avant commit.

Cette rédaction constitue un cadrage et une étude de faisabilité. Aucun paramètre de factory, étage, muret ou balcon n'est annoncé comme implémenté par la seule présence de cette spec.
