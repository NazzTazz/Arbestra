# World generator et World preview — alpha

Complément du 8 octobre : [géographie globale et tore 3D r6](GEOGRAPHIE-MONDE-2026-10-08.md). Tristan demande cet aperçu avant tout spawn : relief/eau en volumes réels, arbres orientés sur le tore et inspection locale du même descripteur. Les candidats restent fermés ; la validation hydrologique historique de r5 ne vaut pas validation automatique de r6.

Date : 7 octobre 2026. Base relue : `main`, dernier commit `f9fc28d`, avec changements locaux antérieurs.
Statut au 8 octobre : **A/B implémentées, relief r2 apprécié par Tristan ; C implémentée et vérifiée pour cette première recette**. [Tranche C : mécanismes, preuves et limites](RECETTE-WORLD-GENERATOR-HYDROLOGIE-2026-10-08.md). D et E restent à réaliser. Les candidats v3 restent fermés.
Décision de cette passe : marée exploratoire bornée à ±0,25 unité, cascades permanentes de 1/2 unités, rejet des tracés nécessitant plus. Les artefacts historiques restent inchangés ; les nouveaux aperçus utilisent la recette r5.

Décision complémentaire de Tristan : ouvertures et lits de rivière de **5 à 8 cases réellement creusées**, avec des cascades de même largeur. La recette r4 fixe une largeur déterministe par rivière ; le front de chute couvre toutes les cases du lit. Les chenaux maritimes conservent leur tirette distincte. Les anciens aperçus r0/r2/r3 restent intacts ; générer un nouvel aperçu pour appliquer cette correction.

Correction organique r5 : remplacer les corridors rectilignes par des courbes réellement creusées, avec largeur progressive dans l’intervalle 5–8 cases et têtes arrondies. Le routage tient compte du relief et des passages protégés ; les cases des virages portent leur drainage vers l’aval. Les plateaux restent plats. Le rendu et les règles de marée/cascade restent partagés. Les aperçus r4 déjà prêts sont conservés.

Décision du 8 octobre, audit géographique : **des reliefs adoucis peuvent créer de nouveaux passages ; les plateaux restent nécessaires pour implanter les joueurs**. Cette cible remplace l'exclusivité des escaliers. Seuils de pente et largeur utile à arbitrer avant intégration ; recettes r5 et données existantes inchangées. Voir [audit et prototype proposé](AUDIT-GEOGRAPHIE-HYDROGRAPHIE-2026-10-08.md).

Décision complémentaire du 8 octobre : prototype géographique hybride validé. Terraformation joueur validée pour une tranche ultérieure : **dépenser de l'énergie ; excaver produit de la pierre, remblayer en consomme**. Coûts, rendements, origine de l'énergie, volumes et emprises autorisées restent à arbitrer. Aucun outil ou crédit économique livré dans le prototype. [Reprise](PROTOTYPE-GEOGRAPHIE-2026-10-08.md).
Complément forêt r7 : dispersion de graines et compétition adoptées. Positions continues persistées, habitat boisé distinct du nombre d'arbres, métrique torique et deux lots partagés. Voir la recette forestière dans le compte rendu géographique ; seuls les nouveaux candidats utilisent r7.

Décision r8 : relief **±16 unités par défaut** (−16 à +16, une unité = ¼ de case), et non 16 unités d'écart total. Minimum de réglage opérateur ±8. Moyenne ajustée par la distribution, sans réduire silencieusement les deux bornes. Sites de pierre plus prononcés en volumes facettés, visibles dans le preview ; gisements exploitables/quantités à intégrer ultérieurement. Les artefacts antérieurs gardent leurs conventions. Voir le compte rendu géographique r8.
## 1. Résultat attendu et périmètre

Avant l’ouverture d’un univers, Tristan règle et génère son monde, l’inspecte sur le tore sans fumée, conserve le résultat choisi, puis ouvre explicitement cet univers aux joueurs. Le monde inspecté est exactement celui ouvert.

La cible comprend le panneau World generator, la séparation génération/ouverture, le preview utilisable en production alpha, un terrain à plateaux et altitudes signées, une géographie aquatique cohérente, la végétation liée au climat et à l’exposition solaire, les cascades, et le futur aménagement local au spawn. Elle se livre en tranches bornées ; aucun de ces mécanismes n’est acquis par cette spec seule.

Bateaux, ports, transport, commerce, érosion dynamique, simulation de fluides et effets météo sur l’économie restent hors implémentation alpha initiale. La géographie doit permettre leur intégration future sans leur inventer dès maintenant des règles métier.

## 2. Décisions et arbitrages

### Validé par Tristan

- Plage initiale d’altitude **−8 à +8** ; **0 = niveau moyen de l’eau**, **+1 = plateau de base**. Pour cette première passe exploratoire, **1 unité verticale = 1/4 de la largeur d’une case** ; un escalier peut donc franchir au plus un quart de case en hauteur.
- Plusieurs plateaux à différentes hauteurs, avec fonds négatifs submergés, vallées, rivières et canaux susceptibles de relier des régions du tore.
- Marées d’amplitude **modérée** ; influence de la masse/position du soleil sur les courants comme direction de jeu.
- Répartition des arbres cohérente avec l’éclairement et la météo.
- Génération d’un paysage naturel, puis clairière aménagée localement à l’arrivée d’un joueur, plutôt que clairières préaménagées et réservées.
- Inspection du monde avant ouverture, avec fumée désactivable.
- Six tirettes : pourcentage d’eau en aire au sol, amplitude du relief, relief moyen, largeur des canaux maritimes, densité d’arbres, influence de l’éclairement sur cette densité.
- Panneau avec seed reproductible, génération déclenchée explicitement, valeurs demandées et obtenues, monde retenu sauvegardé avant ouverture ; cette proposition a reçu « c’est parfait ».
- Cascades intégrées à la cible, notamment aux chutes de **1 ou 2 unités** entre tronçons d’eau.
- Aucun outil de terraformation pour le joueur en alpha. Élever ou abaisser son terrain et modifier les reliefs est une intention future, sans commandes, coûts ni autorisations à implémenter maintenant. L’aménagement automatique et borné au spawn reste distinct.
- Continuité terrestre : plateaux plats reliés par des escaliers naturels localisés vers chaque zone terrestre jouable d’une même terre ; falaises et cascades localisées et contournables. Aucune liaison à pied obligatoire entre des îles séparées par la mer. Ce besoin ne valide ni ponts, ni nage, ni escalade.
- Conserver des plateaux pour implanter les joueurs ; les reliefs adoucis peuvent créer des passages praticables. Les escaliers naturels restent possibles, sans exclusivité. Pente maximale et largeur utile restent à arbitrer avant intégration.
- Dénivelé total maximal de **1 unité par escalier naturel**, réparti en petites marches dans l’emprise maximale de 2 × 5 cases. Pour franchir davantage, plusieurs escaliers séparés par de vrais paliers plats sont nécessaires.
- Trajets toujours secs, y compris aux plus hautes eaux : les berges découvertes seulement à marée basse restent hors trajet. Aucune mission ne dépend d’une fenêtre de marée.

### Proposé, pas encore arbitré comme gameplay

- Marée de référence **±0,25 unité** autour de 0 : point de départ à recetter, pas une valeur livrée ni définitive.
- Chute nette d’une unité = petite cascade ; deux unités = cascade plus marquée ; succession de petits seuils = rapides. Hauteurs supérieures à deux possibles comme relief, mais règle de chute/succession à arbitrer.
- Cascade non franchissable par les futurs bateaux ; ports de part et d’autre comme possibilité future, sans réservation de bâtiments.
- Garanties de départ comparables entre joueurs, avec bois et pierre réellement accessibles. Quantités, distances, protection et droit de compléter/retirer des features à préciser avant la tranche spawn.
- Règle climatique donnant une exposition favorable aux arbres : la courbe de réponse, les variations régionales et les valeurs par défaut des six tirettes restent à recetter.
- Recette visuelle des marches, espacement des paliers, détour acceptable, pente maximale et largeur utile des nouveaux passages doux à régler. Le principe des pentes praticables est validé ; aucune ancienne valeur numérique de rampe ne devient automatiquement la règle.

Les choix d’UI, types internes et points d’API décrits ensuite sont des propositions techniques exécutables. Ils ne créent ni autorisation d’implémenter ni validation de ces choix produit ouverts.

## 3. Existant vérifié

- `apps/api/src/modules/worlds/generation.ts` et `generation-config.ts` portent le générateur v2 : monde périodique, chunks 32 × 32, relief non négatif jusqu’à 20, humidité issue de bruit, 600 clairières visées, rayon intérieur 12 aplani et quatre gisements de proximité.
- `world_chunks.elevations` est un tableau PostgreSQL signé `smallint[]`, sans interdiction générale de valeurs négatives. Les contrats terrain acceptent déjà des entiers signés ; cela ne prouve pas la compatibilité du rendu et des règles de construction.
- L’[onboarding livré](SPEC-ONBOARDING-JOUEUR.md) choisit une clairière protégée, copie le modèle figé et conserve toutes les features existantes. Il utilise actuellement `generationStatus = ready` comme critère d’entrée.
- `packages/contracts/src/cosmology.ts` partage la géométrie solaire et le cycle combiné du tore. `apps/world-web/src/scene/weather.ts` porte encore le champ météo de présentation ; sa seed dérive du world UUID. Le générateur utilise une autre humidité. Leur couplage climatique est à faire.
- `terrain-overview-view.ts` construit un tore lisse avec texture des couvertures et altitudes agrégées. `cosmology-world.ts` crée le volume `TorusFog` et les effets solaires. Il n’existe pas de World preview administrateur.
- Le panneau DEV n’existe pas en build production ; le modèle global est soumis à la progression scientifique. Ces deux mécanismes ne constituent pas le futur accès opérateur.
- Le rendu d’eau régional emploie encore une hauteur fixe pour les cellules aquatiques. Des rivières perchées et cascades demandent une surface d’eau distincte du fond.

- `generateWorld()` exécute des boucles CPU synchrones ; son état `generating` appartient à la transaction de génération et n’est pas un suivi durable visible pendant le calcul. L’exécution isolée décrite en section 5 reste à construire.
- `terrain-store.ts` garde les tableaux de sol et de hauteurs déjà chargés lors des mises à jour ordinaires. Le déclencheur `science.geographyRevision` concerne les connaissances du joueur ; il ne fournit pas une révision des mutations de terrain. `travel-paths.ts` teste le type de sol, sans relief dans la signature du cache. La section 11 décrit les extensions nécessaires, pas des capacités acquises.

Les documents de [génération v2](architecture/world-generation.md), [streaming](SPEC-STREAMING-TERRAIN.md) et [vues](SPEC-VUES-TERRAIN-REGION-MONDE-TORIQUE.md) décrivent l’existant et ses recettes. Cette cible ne les remplace qu’après implémentation et vérification.

## 4. Panneau World generator

Le panneau s’ouvre dans un écran opérateur de la production alpha, avec le tore à côté. Il affiche seed, dimensions, version du générateur, paramètres, état de calcul, métriques finales et identité du résultat.

| Réglage | Sémantique proposée | Domaine initial proposé |
|---|---|---|
| Eau | Surface couverte au niveau moyen de l’eau, incluant bassins, canaux et rivières | 0–100 % ; ouverture impossible sans capacité de départ suffisante |
| Amplitude | Étendue cible entre minimum et maximum du relief final, toujours borné à −8/+8 | 0–16 unités |
| Relief moyen | Moyenne d’altitude pondérée par l’aire au sol | −8 à +8 unités |
| Canaux maritimes | Largeur cible des connexions entre bassins retenues par le générateur | En cellules ; domaine à choisir selon dimensions et recette |
| Arbres | Couverture boisée cible sur les terres admissibles | 0–100 % |
| Influence solaire | Poids du score d’exposition dans la répartition des arbres | 0–100 % ; zéro désactive ce facteur |

L’aire au sol désigne la surface de référence du tore, sans compter les parois verticales des ruptures et des marches. Les cellules canoniques n’ont pas toutes la même aire sur le tore : employer les mêmes poids géométriques pour les métriques, la calibration et le panneau. Afficher séparément le pourcentage brut de cellules si utile, avec son nom propre.

La densité boisée compte la surface des cellules métier woodland admissibles, pas le nombre de troncs décoratifs de leurs recettes. Son dénominateur est affiché. La largeur de canal distingue la cible de génération, la largeur constatée à l’étiage et les rétrécissements ; elle ne garantit pas une future navigabilité sans profondeur.

Déplacer une tirette modifie le brouillon sans lancer de calcul complet. Boutons : **Générer l’aperçu**, **Conserver ce monde**, **Ouvrir l’univers**. Une génération active est clairement affichée ; les doubles clics retrouvent la même demande. Modifier le brouillon ne change pas le monde retenu.

Les objectifs eau/moyenne/amplitude/canaux sont couplés. Calibrer sur le résultat après creusement des cours d’eau, avec une procédure déterministe et bornée. Ne pas modifier silencieusement les tirettes pour masquer un échec. Rapporter cible/résultat/écart et les contraintes incompatibles. Tolérances initiales proposées : eau ±1 point de pourcentage, moyenne ±0,25 unité ; les extrêmes sont des contraintes dures. Les tolérances et profils par défaut sont à recetter avant ouverture.

Seed identique + version + dimensions + paramètres identiques doivent reproduire les champs et les métriques, indépendamment de la date, du world UUID ou de l’appareil. Les UUID techniques des features peuvent différer ; le contenu canonique comparé exclut ces IDs.

## 5. Monde généré, retenu et ouvert

Conserver `generationStatus` pour la préparation technique. Ajouter un état d’accès indépendant, fermé par défaut, et une date d’ouverture serveur. Un monde `ready` peut être fermé.

Flux proposé : brouillon de paramètres → calcul d’un candidat fermé → candidat `ready` inspectable → résultat retenu → ouverture explicite. Chaque candidat a sa propre identité mondiale ; les paramètres et sorties sont persistés ensemble avec version, provenance et checksum canonique. « Conserver » retient cette identité sans recalcul. « Ouvrir » vise explicitement l’identité et le checksum retenus : une réponse ancienne ou une nouvelle génération ne peut ouvrir un autre résultat.

Employer un candidat mondial fermé par génération, les chunks et agrégats existants, et un processus de génération dédié utilisant le même code et la même base que le monolithe. Le handler HTTP valide et persiste la demande puis rend son identité ; il n’exécute pas les boucles de génération. Aucun usage des tâches économiques par village comme queue de génération.

Première tranche : un seul calcul actif pour le déploiement, acquisition exclusive en base, demandes supplémentaires explicitement en attente et nombre de demandes borné. Fixer les limites de dimensions, mémoire, durée et candidats conservés dans la configuration opérateur ; ne pas prétendre que l’isolement du processus suffit à isoler CPU, mémoire ou charge PostgreSQL. Mesurer aussi la latence de l’API de jeu pendant un calcul.

Persister une tentative identifiable et son état (en attente, en cours, réussie, échouée/interrompue) hors de la transaction longue de sortie, avec dates et signal de vie. Le processus écrit le résultat et publie `ready` avec son checksum dans une transaction atomique, seulement s’il possède toujours la tentative courante. Un ancien processus ne peut publier après reprise. Les lectures preview refusent les sorties partielles. Au redémarrage ou après expiration bornée du signal de vie, réconcilier les tentatives orphelines sous exclusion ; elles restent fermées et sont identifiées comme interrompues. Une reprise explicite réutilise les paramètres figés, ne duplique pas le candidat et ne touche jamais un résultat déjà prêt. Double clic = même demande via `commandId`. Ce suivi durable est une extension du générateur actuel.

Proposition API sous `/api/admin/world-generator` :
- création idempotente d’un candidat avec `commandId`, seed, dimensions et paramètres validés ;
- lecture du candidat, statut, métriques et paramètres ;
- lectures overview/terrain/hydrologie du candidat autorisées à l’opérateur ;
- conservation puis ouverture explicites avec contrôle d’identité et de version.

Les noms de routes et tables peuvent être ajustés sans arbitrage produit. L’autorisation opérateur doit être vérifiée côté serveur et fonctionner en build production. Aucun privilège ne vient d’un paramètre URL ou de `import.meta.env.DEV`. Le dépôt n’a pas actuellement de rôle administrateur : une liste de comptes opérateurs configurée côté serveur suffit pour la première tranche, sans RBAC général.

Les listes publiques et l’inscription à un monde vérifient ready **et** ouvert. Une génération fermée ne doit pas être accessible par deviner son slug. Les endpoints preview réutilisent la géographie, avec une autorisation adaptée au candidat sans village ; ne pas créer un faux village pour satisfaire l’autorisation actuelle.

Après ouverture, interdire remplacement/régénération globale. Les tranches initiales exposent les aménagements locaux du spawn serveur. La future terraformation joueur passera par des commandes serveur versionnées, selon la décision validée ci-dessus ; elle reste hors du prototype géographique. Aucun candidat abandonné ne peut être supprimé s’il est ouvert ou contient des données joueur. Limiter les candidats conservés et leur coût mémoire/disque ; nettoyage explicite, ciblé et vérifiable.

Pour Aube et les autres mondes habités, préserver terrain, villages, stocks, gisements et autorisations. Toute migration d’état d’ouverture les classe explicitement selon une politique de compatibilité, à valider lors de l’application ; cette spec ne déclenche aucun changement en développement.

### Recette privée sans altérer le candidat

Retenir une copie de recette de l’artefact persistant dans un environnement d’essai isolé, avec accès opérateur et comptes de test uniquement. Copier le résultat canonique, les paramètres, versions, climat et recette de spawn ; ne pas relancer le générateur. Remapper les identifiants techniques sans changer le contenu, et vérifier le même checksum canonique avant le premier spawn. Employer le build et les règles prévus pour l’univers cible.

La copie peut être ouverte dans cet environnement pour exercer le vrai onboarding et les commandes joueur. Le candidat source reste fermé, sans village ni données de recette, et son checksum est revérifié avant ouverture publique. Les modifications locales dues aux spawns de test appartiennent seulement à la copie ; les preuves indiquent source, checksum initial, build, positions testées et résultat. Tester plusieurs emplacements, y compris près d’escaliers naturels, berges et coutures. Une copie n’est jamais promue comme univers public ; son nettoyage vise exclusivement les données identifiées comme fixtures dans l’environnement d’essai. Aucun effacement de données joueur en production. Le preview reste en lecture seule et aucun contournement du garde `ready + ouvert` n’est ajouté.

## 6. Relief, eau et raccords

L’altitude est une distance signée suivant la normale locale du tore. Le niveau marin moyen de référence vaut zéro ; le plateau de base vaut +1. −8/+8 borne le relief physique généré.

Proposition de stockage : garder des entiers quantifiés pour les chunks, avec un pas explicite par version/monde, par exemple un quart d’unité en v3. Le décodage v2 garde strictement son comportement actuel. Ne jamais réinterpréter les tableaux des mondes existants comme de nouvelles unités.

Séparer :
- altitude du fond/terrain ;
- hauteur locale de la surface d’eau ;
- échelle verticale de rendu ;
- éventuelle amplification du relief uniquement dans l’overview.

Former des plateaux étendus et plats pour implanter les joueurs, reliés par des passages doux praticables ou des escaliers naturels délimités. Préparer ces liaisons lors de la génération, sans demander au joueur de terraformer. Chaque zone terrestre jouable d'une même terre possède un accès valide ; les falaises et cascades ont un contournement. Les îles séparées par la mer restent distinctes, sans garantie de liaison à pied. La géographie détermine les profils ; la politique métier versionnée fixe pente admissible et largeur utile.

Chaque escalier porte une emprise canonique orientée, ses accès bas/haut et leurs altitudes. Sa longueur mesurée dans le sens de la montée est au plus 2 cases ; sa largeur perpendiculaire au plus 5 cases, rotations et coutures du tore comprises. Les petites marches occupent cette emprise, elles ne nécessitent pas une case entière chacune. Préserver des surfaces de marche plates et des contremarches visibles ; le rendu ne transforme pas ce passage en rampe. Ne pas découper artificiellement un long escalier contigu en plusieurs identifiants pour contourner la borne de longueur.

Construire et vérifier le graphe d'accessibilité à partir du sol géographique canonique, des profils des passages doux, des escaliers explicitement décrits et des plus hautes eaux. Une rupture abrupte reste infranchissable hors passage valide. Les accès des escaliers restent bidirectionnels, sans entrée latérale à travers une contremarche. Partager les règles serveur/client et les versionner indépendamment du mesh ; conserver une validation distincte de planéité des emprises de bâtiments. Les seuils des nouvelles pentes restent ouverts ; ne pas les déduire des dimensions maximales des escaliers.

Vérifier la connectivité après creusement des cours d’eau et placement des obstacles naturels bloquants : un escalier naturel traversé par une rivière ou entièrement bouchée par des features n’est pas un passage. Préserver des corridors naturels praticables, sans préaménager ni réserver des clairières de joueurs. Rapporter zones isolées, goulots et détours des liaisons entre plateaux ; ne pas contourner un échec en renommant arbitrairement une zone « non jouable ». Une combinaison de réglages incompatible avec la continuité demandée doit être signalée et empêcher de retenir le candidat comme ouvrable, sans créer automatiquement de pont.

Les raccords incluent coutures du tore et halos de chunks. Les plateaux d'implantation sont conservés ; les transitions douces géographiques peuvent créer des passages validés par la projection métier. Le lissage graphique seul ne modifie pas l'accessibilité. Les hauteurs et passages autoritaires pilotent occupation, chemins et construction.

Les bassins connectés à la mer suivent le niveau marin. Les lacs perchés et rivières ont leur propre niveau ; une cellule de fond négatif n’est pas automatiquement un océan connecté. La couverture d’eau dépend du fond, de la connexion hydrologique et du niveau local. Au niveau de référence, compter une surface en eau lorsque sa hauteur d’eau est strictement positive ; une berge exactement à 0 est au contact de l’eau et peut devenir submergée à marée haute. Le découpage terrain/eau doit permettre de conserver le fond sous la surface.

L’accessibilité à pied utilise une enveloppe stable des plus hautes eaux locales prévues (mer, rivières et lacs), et non le niveau animé de la frame. Un sol susceptible d’être submergé reste hors trajet même à marée basse ; la marée n’entraîne ni recalcul périodique des routes ni interruption de mission. Le client présente la même règle que le serveur. Les sols secs aux plus hautes eaux gardent une marge explicite dans la recette.

Dans la première tranche relief, toute zone proposée à la construction satisfait explicitement les contraintes de sol, planéité de l’emprise et marge au-dessus des plus hautes eaux prévues. Mettre à jour les règles et tests des routes, emprises et ancrages avant toute ouverture v3 ; ne pas supposer que les échelles fixes actuelles supportent automatiquement les nouvelles altitudes. La génération et le preview doivent déjà montrer les composantes accessibles en B, puis les recalculer sur l’hydrologie définitive en C.

## 7. Climat, exposition et végétation

Construire un champ climatique commun déterministe, consommé par la génération et la météo visible. L’exposition durable est calculée sur un cycle cosmologique complet depuis les fonctions partagées, avec incidence et occultation du tore ; ne pas utiliser l’heure du spawn ou le nuage courant comme déterminant permanent des arbres.

Calculer à une résolution bornée puis interpoler périodiquement, au lieu d’une intégration coûteuse par parcelle à chaque frame. Versionner résolution, phase d’origine et paramètres. Les ombres locales du relief peuvent suivre dans une tranche ultérieure, avec la limite explicitement affichée.

La météo varie autour du climat régional, avec une seed du candidat/générateur persistée, plutôt que du UUID technique. Une copie du même monde ne change pas son climat. Les arbres suivent un score de terrain, humidité et exposition favorable, avec une variation locale déterministe. La courbe d’exposition reste proposée : ne pas introduire silencieusement « plus de soleil = toujours plus d’arbres ».

À influence zéro, le facteur solaire ne participe pas à la sélection. À influence forte, il redistribue les zones boisées ; recalibrer autant que possible la couverture globale demandée. Afficher la couverture obtenue si les terres admissibles ne suffisent pas. Aucun effet nouveau sur production agricole, consommation, économie ou missions n’est autorisé par cette cible visuelle.

## 8. Hydrologie et cascades

Le générateur décrit un réseau de tronçons reliant sources, rivières, lacs, bassins et sorties. Il conserve au minimum fond, surface d’eau, direction de référence, largeur, connexion amont/aval et type de transition. Une représentation compacte par tronçons et couches de chunks suffit ; aucun objet économique par goutte ni simulation fluide générale.

Un écoulement permanent descend vers une sortie ou se termine dans un bassin identifié. Sur les zones plates, définir un ordre déterministe pour le drainage ; vérifier l’absence de boucle de rivière créée par les raccords périodiques. Les étendues marines et leurs courants peuvent former des circulations sans être assimilées au graphe de drainage descendant.

Une cascade existe lorsqu’un tronçon alimenté a une rupture nette de **surface d’eau**, avec un aval valide et une chute positive. Ne pas la déduire uniquement de deux altitudes de terrain voisines. Persister une transition avec emplacement du seuil, sommet/pied, largeur et identifiants des tronçons.

Cible initiale : cascade de 1 ou 2 unités, nappe continue suivant la largeur du cours d’eau, écume au pied, particules limitées à proximité. Une succession de petits seuils peut former des rapides, avec un profil de lit cohérent. Ne pas rendre toutes les limites de plateau comme des murs d’eau ; ne pas afficher de chute sans eau amont ou à travers un obstacle. Le raccord de cascade au bassin doit suivre le niveau de l’aval.

LOD : à distance, simplifier la nappe et couper particules/écume fine selon leur taille projetée. Dans le tore global, privilégier continuité des cours d’eau et repères utiles ; ne pas instancier les cascades détaillées de tout le monde. Préparer et partager les ressources ; libérer avec le candidat/scène.

## 9. Marées, courants et future navigation

La règle exploratoire validée le 8 octobre utilise la phase et la position solaire pour moduler niveaux marins et courants de chenaux. Son amplitude demeure modérée ; ±0,25 est validé pour cette première recette visuelle. Une tirette de masse solaire, une simulation gravitationnelle et un débit réaliste ne sont pas demandés.

Employer un champ périodique spatial et temporel commun aux vues. Les bassins marins connectés partagent des niveaux cohérents ; éviter les marches d’eau artificielles entre chunks. Garder la fonction climatique/solaire comme source commune et mesurer la variation locale.

Distinguer le débit de drainage d’une rivière et la composante de marée dans les estuaires/canaux. Une modulation solaire ne doit pas faire remonter arbitrairement une cascade permanente. Les marées peuvent modifier son pied près de la mer.

Conserver les informations de profondeur, largeur, connexion et rupture pour une future navigation. Aucun itinéraire bateau n’est livré. Cascades bloquantes, vitesse selon le courant, tirant d’eau et périodes de franchissement restent des propositions de gameplay à valider dans leur tranche.

## 10. World preview en production alpha

Écran opérateur avec caméra orbitale globale, inspection de la face intérieure/extérieure, zoom local et coordonnées. Atmosphère désactivée par défaut, réactivable pour comparer ; prévoir l’exclusion réelle des passes de brouillard, pas simplement leur transparence.

Éclairages : solaire réel et neutre d’inspection. Le second permet de lire la face nocturne sans modifier l’exposition calculée. Couches : terrain, altitude avec légende, eau/réseaux, couverture boisée, exposition moyenne et aptitude à l’accueil. Distinguer couches validées comme besoin et choix de présentation proposés.

Le tore preview doit présenter le relief en volume à une résolution adaptée ; l’amplification visuelle est indiquée et ne change jamais la physique. Les données agrégées ne suffisent pas à prouver la largeur d’un chenal ou une chute : inspection locale de la géographie canonique disponible.

Ne pas dépendre du panneau DEV ni de l’acquisition scientifique d’un joueur. Ne pas créditer accomplissement, coffre, observation du Chat ou autre progression depuis le preview. Garder les commandes de gameplay absentes de cet écran. Les animations aquatiques restent de présentation.

Métriques avant ouverture : aire d’eau moyenne et extrêmes de marée, min/max/moyenne de relief, couverture boisée, composants aquatiques et principaux canaux, cascades par hauteur, composantes terrestres praticables aux plus hautes eaux, zones isolées, goulots et détours entre plateaux, estimation conservatrice de capacité d’accueil. Une estimation de capacité n’est pas une réservation de clairières ni une garantie exacte du nombre final de joueurs.

## 11. Clairière créée au spawn — tranche dépendante

La génération nouvelle ne défriche ni n’aplatit des emplacements destinés à des joueurs futurs. Un éventuel index d’aptitude n’en réserve pas l’usage.

Au spawn, chercher un plateau adapté au modèle figé, sec aux plus hautes eaux, raccordable à pied et suffisamment séparé des installations existantes. Dégager seulement l’emprise requise, raccorder le sol et conserver une lisière naturelle ; ne pas couper un cours d’eau ni effacer une cascade pour faire tenir le village.

Les ressources proches sont d’abord recherchées dans l’existant, avec accès terrestre réel via les passages autorisés et distance de trajet. Le complément de gisements et le dégagement de features métier constituent une nouvelle autorisation serveur bornée : les quantités, stocks, distances et conditions restent à valider. Garder les valeurs de population, coffre et stocks initiales déjà acceptées.

Terrain local, features et dépôts concernés, occupations, attribution et village se créent/modifient dans une transaction unique, idempotente. Échec = aucun défrichement ni nivellement résiduel. Concurrence = réservation spatiale temporaire des emprises sous les verrous autoritaires ; pas de chevauchement de zones d’aménagement. Respecter village avant verrous métier et ordre canonique des dépôts, sans prendre un autre village après un gisement.

L’aménagement serveur au spawn est le seul changement local de relief de cette tranche après ouverture ; il ne confère aucun droit de terraformation au joueur. Préserver le résultat initial généré et enregistrer les modifications locales comme overrides persistants et bornés. Le terrain effectif associe ce socle à ses overrides. Cela conserve la provenance du monde et une possibilité d’extension future, sans construire maintenant un éditeur, des outils, des coûts ou un système général de terrassement.

Étendre explicitement le protocole : révision géographique monotone par chunk, distincte de `generationVersion` et de `science.geographyRevision`, incrémentée dans la même transaction que les modifications. Invalider aussi les chunks voisins dont le halo fourni change, y compris aux coutures du tore. Les réponses ordinaires de mise à jour portent cette révision ; si elle diffère, le streamer recharge le sol complet, les hauteurs et les couches hydrologiques nécessaires au lieu de conserver les anciens tableaux. Une réponse ancienne ne peut remplacer une révision plus récente. Les chunks quittés puis revisités suivent la même règle.

Inclure les révisions géographiques et la version des règles de franchissement dans les clés des caches de trajets client et serveur concernés. Rafraîchir les agrégats d’overview affectés et leurs clés de cache après commit ; ils annoncent leur révision et ne prétendent pas être à jour tant que la reconstruction est en cours. Le checksum initial retenu reste une provenance immuable, distincte des révisions du monde aménagé. Aucun recalcul de géographie à chaque frame ou survol.

Refuser un candidat de spawn dont l’aménagement altère une emprise, une ressource voisine ou un passage utilisé par une mission engagée. La vérification autoritaire doit rester valable sous les verrous spatiaux ; choisir un autre emplacement plutôt que relocaliser un voisin ou réécrire ses missions. Aucune mission engagée ni ressource d’un voisin n’est supprimée. Cette spec ne lève pas implicitement les règles actuelles de protection des features dans l’onboarding v2.

## 12. Tranches d’exécution

| Tranche | Résultat borné | Dépendances et preuve |
|---|---|---|
| A — candidat fermé et preview | Accès opérateur, ready/ouvert séparés, calcul v2 isolé avec suivi durable, candidat persistant, tore sans fumée et éclairage neutre, ouverture explicite | Reprise après interruption et API de jeu réactive ; copie de recette privée conforme au checksum. Aucun nouveau relief ni spawn aménageur ; garder l’onboarding actuel sur les univers ouverts. PostgreSQL et navigateur en build production |
| B — relief et climat v3 | Six réglages selon fonctions disponibles, plateaux signés et escaliers naturels bornés, graphe de franchissement partagé, exposition/climat commun, preview volumique et métriques | Recetter marches et détours ; vérifier continuité des terres. Aucune clairière préaménagée ; pas d’ouverture publique v3 avant hydrologie et spawn compatibles |
| C — hydrologie et cascades | Bassins, canaux, rivières perchées, chutes 1/2 et rendu LOD, marée exploratoire bornée ±0,25 validée, enveloppe des plus hautes eaux | Revalider passages secs et continuité terrestre après hydrologie/obstacles ; incompatibilités signalées. Pas de bateaux |
| D — spawn local | Recherche, overrides transactionnels, ressources accessibles, révisions du sol/halos, streamer et caches actualisés | Arbitrages ressources/protection ; concurrence/rollback ; préserver trajets engagés ; vérifier un client déjà connecté. Aucun outil de terraformation joueur |
| E — ouverture alpha v3 | Recette de nouveaux joueurs sur copie isolée de l’artefact retenu, puis ouverture du candidat source | Checksum source inchangé, preuve de copie conforme avant spawn, critères précédents satisfaits ; aucune donnée de test dans l’univers public |

Les tranches A/B sont implémentées ; C dispose de sa recette r3 et de son bilan distinct. Les tranches B–D gardent les valeurs de recette et choix métier ouverts de la section 2 ; ne pas les annoncer « prêtes » globalement. En B, une tirette non opérationnelle est désactivée et expliquée, jamais présentée comme modifiant un résultat qu’elle ne pilote pas.

## 13. Vérifications et critères d’acceptation

Tests purs : même seed/version/paramètres = mêmes champs, indépendance UUID/temps ; coutures terrain/climat/eau ; aire pondérée ; domaines impossibles expliqués ; altitude/fond/surface distincts ; passage en marches vs rupture bloquante ; cascade 1/2 alimentée, aval raccordé et absence de chute factice ; graphes de drainage sans cycle ; marée bornée et niveaux connectés.

PostgreSQL : comptes ordinaires refusés sur candidats fermés ; aucun join avant ouverture même sur ready ; ouverture idempotente du résultat exact ; candidat obsolète refusé ; génération interrompue fermée ; monde habité non remplaçable. Pour D : forcer entrelacements, constater attentes pertinentes, prouver modifications avant rollback injecté, comparer toutes les données touchées, libérer toutes les transactions.

Navigateur en build production : accès opérateur réel sans DEV, fumée on/off, ombres solaires vs lumière neutre, relief −8/+8, vues intérieur/extérieur, légendes et métriques, escaliers/canaux/rivières/cascades près et loin, niveau de l’eau et raccords, retours de vues, changement de candidat sans fuite, aucune découverte/progression. NullEngine ne valide ni image ni shaders.

Mesurer à mêmes seed, candidat, caméra, viewport/résolution, backend et lumière : coût de génération, latence d’aperçu, temps de frame/variabilité, draws, géométrie soumise et ressources après changements de candidats. CPU/GPU séparés seulement si disponibles ; pas de gain annoncé à partir du seul nombre de sommets résidents. Les budgets chiffrés sont à fixer à partir de cette référence.

Recette opérateur obligatoire avant ouverture : identité/checksum du candidat affichés, métriques finales inspectées, parcours de vrais comptes de test sur copie isolée de cet artefact exact selon la section 5, puis checksum du candidat source revérifié. La preuve concerne le monde initial copié et les spawns exercés, pas une garantie exhaustive de tous les futurs emplacements. Les preuves exécutées pour A/B sont consignées dans le bilan de recette ; les vérifications C/D/E restent futures.

Compléments obligatoires issus de la revue :
- Génération : prouver que le suivi est lisible pendant le calcul, que l’API de jeu reste réactive, qu’un double clic ne crée pas deux candidats et qu’un processus interrompu ou ancien ne publie pas de sortie partielle/périmée. Mesurer la charge et les latences sous génération, pas uniquement au repos.
- Accessibilité : escaliers franchissables dans les deux sens et limités à 2 cases de long × 5 de large, rotations/coutures et refus des emprises excessives, absence d’entrée latérale invalide, rupture directe bloquée avec détour vers un escalier valide, absence d’isolement après placement des cours d’eau et obstacles ; mêmes décisions serveur/client aux coutures. Marée basse/haute = même masque de marche et mêmes routes, sans recalcul déclenché par l’animation. Recetter visuellement le seuil et les détours sur les cas min/max de relief ; publier les valeurs retenues dans la recette versionnée avant ouverture. Ajouter les tests de profils doux praticables et trop raides selon les seuils à valider ; une rupture directe abrupte doit rester distincte de ces passages. Vérifier la conservation des plateaux constructibles destinés aux joueurs.
- Spawn : client déjà connecté recevant sol et hauteurs modifiés sans reconnexion ; halo voisin correct ; ancienne réponse réseau rejetée ; sortie/retour de zone et overview cohérents ; cache de trajets renouvelé uniquement pour les données pertinentes. Prouver que les overrides et révisions rollbackent avec un spawn échoué et qu’aucun trajet engagé voisin n’est altéré.
- Recette : checksum de copie égal avant gameplay, nouveaux IDs correctement référencés, refus des comptes ordinaires sur le candidat source fermé, absence de données de test dans la source après essais. Aucun endpoint joueur de terraformation livré.

## 14. Fichiers prévus et reprise

Implémentation future : contrats monde/génération/hydrologie dans `packages/contracts`, migrations additives, modules génération et endpoints opérateur API, garde d’ouverture onboarding, champs climatiques partagés, terrain/overview/eau/fog côté world-web et panneau React dédié. Réutiliser WorldSpace, le streamer, les sessions et les verrous métier ; pas de migration Babylon ni de changement de backend.

Livraison A/B : contrats `world-generator`, `world-climate`, `world-landscape`, migration 035, module API `world-generator`, worker dédié et route React `/world-generator`. Le graphe de franchissement v3 est partagé et testé dans le preview, sans branchement au gameplay v2. Hydrologie, streamer géographique et spawn aménageur restent C/D. Voir le bilan pour les commandes, captures, mesures et limites.

### Complément géologique r9 — 8 octobre

Demande validée : distinguer substrat rocheux, affleurements continus, blocs détachés et éboulis ; exposition préférentielle sur pente forte, crête, rupture de pente et sol mince. Les formations appartiennent au relief, les débris sont secondaires et reliés à une source en amont. Réalisation bornée dans le preview r9 : [modèle et limites](GEOGRAPHIE-MONDE-2026-10-08.md). Aucun stock ni règle de terraformation ajoutés ; le contrat de stratigraphie prépare l'excavation future. Générer un nouveau candidat pour appliquer cette recette ; les artefacts historiques restent conservés.

### Inspection et carte complète — tranche du 8 octobre

Après audit web, priorité validée à la fiabilité de l'inspection et des indicateurs. Ajouter une vue rectangulaire de toute la carte, non projetée sur le tore, partageant les données et couches de diagnostic. Identifier le candidat effectivement chargé/rendu, distinguer formulaire et paramètres enregistrés, permettre leur reprise, écarter réponses/statistiques périmées. Pas de refonte géologique/hydrologique ou de terraformation dans cette tranche. [Réalisation et limites](GEOGRAPHIE-MONDE-2026-10-08.md).


### Berges et affleurements — première passe de rendu du 8 octobre

Tranche autorisée : améliorer la lecture des berges et des formations en préservant les récifs appréciés. Réalisé sur les candidats r9 existants : intersections terrain/eau plus précises, transitions de matériaux et profondeur d'eau, contraste des petites facettes réduit avec variations cohérentes plus larges. Aucun changement du modèle géographique ni des données persistantes. [Mesures, captures et limites](GEOGRAPHIE-MONDE-2026-10-08.md#berges-et-lecture-des-affleurements--8-octobre-passe-de-rendu). Validation technique acquise ; qualité artistique partielle. Les discontinuités hydrologiques r9 et les grandes formes géologiques restent à traiter dans une recette ultérieure ; les défauts de l'audit ne sont pas déclarés clos.
