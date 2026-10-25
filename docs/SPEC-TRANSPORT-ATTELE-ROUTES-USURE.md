# Transport attelé, routes commerciales et usure

Date : 25 octobre 2026. Base relue : `wip/v2-commandes-bornees`, `d87dc2d`.

Statut : **spécification proposée ; décisions D1 à D12, entretien et partage des chevaux tranchés par Tristan le 25 octobre ; trois réglages encore ouverts** (section 6.2). Rien n'est implémenté côté serveur. Les études visuelles et le banc de rendu existent (références ci-dessous). Tant qu'une question ouverte n'est pas tranchée, le comportement actuel reste la règle sur ce point.

Documents liés :
- [voirie et atelier](SPEC-INFRASTRUCTURE-VOIRIE-ATELIER.md) : coûts, réserve prépayée, invariants de routage ;
- [marché entre joueurs](SPEC-MARCHE-JOUEURS.md) : convois et porteurs ;
- [refonte navigation et économie](SPEC-REFONTE-NAVIGATION-ECONOMIE.md) : champ de distance, registre des mouvements, processus ;
- [chantiers animés](SPEC-CHANTIERS-ANIMES-SEQUENCES.md) : séquences, autorité du serveur ;
- études : [gabarit et revêtements](../blender-elements/routes/README.md), [cheval Quaternius](../blender-elements/chevaux/README.md), [banc squelettes contre texture](../apps/world-web/bench/README.md).

## 1. Intention

Introduire un **attelage** (un cheval, une carriole, un charretier) pour transporter des marchandises. Faire des **routes commerciales** un aménagement qui compte, et des **revêtements** un choix de durabilité : la terre s'use vite, l'empierrement moins, les pavés résistent.

Le serveur reste souverain :
- l'animation ne transporte rien et n'use rien ;
- l'usure résulte de passages enregistrés par le serveur, jamais de ce que montre le client.

## 2. Existant vérifié

| Sujet | État actuel | Source |
|---|---|---|
| Vitesse | 1 case par seconde pour tout trajet. `travelDuration` ignore matériau, charge et profil. | `packages/contracts/src/travel-paths.ts:509-524` |
| Rôle des routes | Elles orientent le choix du tracé (coût 0,7 sur un pixel aménagé), **jamais la durée**. Règle validée : « le revêtement n'apporte aucun bonus de vitesse ». | `SPEC-INFRASTRUCTURE-VOIRIE-ATELIER.md:145`, `:161` |
| Profils de déplacement | Seul `pedestrian-v1` existe ; un test vérifie que `cart` est refusé (`context-unavailable`). | `route-planner.ts:149`, `route-planner.test.ts:253` |
| Capacité de portage | Seulement au commerce : `ceil(max(aller, retour) / 250)` habitants. Bois et pierre : lot fixe de 100, quel que soit l'effectif. Carottes : un habitant emporte tout le stock des parcelles. | `market.ts:8-10`, `stone-extractions.ts:23`, `garden-harvest.ts:87-105` |
| Commerce | L'acceptant fournit les porteurs et fait l'aller-retour entre hôtels de ville. Énergie exigée pour toute la boucle. Durée maximale aller simple choisie à la publication (1 s à 1 h). | `trade-service.ts:261-356`, `SPEC-MARCHE-JOUEURS.md:21-33` |
| Énergie | Tout trajet compte comme du travail : 10 h d'énergie pleine. Le transport ne consomme pas de nourriture. | `population/energy.ts` |
| Routes manuelles | Un document JSONB par village. Matériaux `none`, `earth`, `rubble`, `stone-1`, `stone-2` ; largeur de 2 à 8 pixels (0,625 à 2,5 m) ; bordure optionnelle. Coût : 4 pierres par case de surface en pierre, 1 pierre par côté de bordure, réserve au 1/256. Application immédiate, sans chantier. | `infrastructure.ts:6-49`, `:470-504`, migration 028 |
| Routes automatiques | Recalculées à chaque lecture, jamais persistées. Toujours en terre, 1,25 m, sans bordure. | `infrastructure.ts:240-288` |
| Usure, réparation, chevaux, carrioles | **Rien** dans le code ni les contrats. Déclarés hors périmètre par la spec voirie (« usure, réparation, chevaux/carrioles… vitesse variable selon matériau »). | `SPEC-INFRASTRUCTURE-VOIRIE-ATELIER.md:34`, `:250` |
| Refonte prévue | Durées tirées d'un champ de distance déterministe ; registre `resource_movements`, avec un motif `repair` déjà prévu ; table `processes` avec un gestionnaire de fin unique. | `SPEC-REFONTE-NAVIGATION-ECONOMIE.md` §3, §6 |

## 3. Ce que les études ont établi

**Gabarit, à l'échelle du jeu** : tuile de 2,5 m, villageois de 0,69 m, attelage d'environ 0,72 × 1,8 m, au pas, circulation à droite.

| Route | Croisement de deux attelages | Virage à 90° en tournant à droite |
|---|---|---|
| 1 tuile, chaussée 1,56 m | 5 cm d'écart : **ne passe pas** | la roue intérieure monte de 0,30 à 0,38 m sur le trottoir, même avec pan coupé ou arc |
| 2 tuiles, chaussée 3,75 m | 1,15 m d'écart | trace entièrement sur la chaussée, à angle vif |

Le réseau peut rester en segments axiaux ; pan coupé et arc deviennent un choix esthétique sur une route de deux tuiles. Ces chiffres supposent un rayon de braquage du cheval de 0,7 m.

**Revêtements** : terre battue, empierrement et pavés, chacun en trois états (neuf, usé, dégradé). L'usure se concentre dans la trace des roues et **reste lisible à 17 px** (zoom moyen) : ornières, flaques, nids-de-poule, pavés manquants. Ils correspondent aux matériaux existants : terre = `earth`, empierrement = `rubble`, pavés = `stone-1` ou `stone-2`.

**Rendu, mesuré sur la MX230** : à 300 chevaux, les squelettes classiques coûtent 125 à 282 ms de processeur par image, contre 1 à 4 ms en animation précalculée dans une texture avec *thin instances*. 300 chevaux à 500 triangles tiennent 60 i/s. Le modèle de Quaternius doit passer par l'exporteur glTF de Blender : le fichier d'origine est mal lu par Babylon.

## 4. Proposition

### 4.1 L'attelage dans l'économie

Première version, **limitée au commerce entre joueurs** : c'est le seul endroit où la capacité de portage existe déjà.

- **Un convoi peut être formé d'attelages plutôt que de porteurs.** Un attelage transporte **2 000 ressources** (D2, soit l'équivalent de 8 porteurs) et mobilise **un habitant**, le charretier, plus un cheval et une carriole disponibles.
- **Effectif et attelages** : `attelages = ceil(max(aller, retour) / 2000)` et `habitants = attelages`. Les mêmes attelages font l'aller et le retour, comme les porteurs aujourd'hui.
- **Choix au moment de l'acceptation** :
  - par défaut, attelages si le village en a assez de disponibles, porteurs sinon ;
  - le joueur peut forcer les porteurs ;
  - pas de convoi mixte en première version.
- **Énergie** : le charretier est soumis aux règles communes (travail pendant toute la boucle).
- **Le gain pour le joueur est la main-d'œuvre** : moins d'habitants mobilisés, donc moins d'énergie dépensée pour le même chargement.
- **Vitesse** : 1 case par seconde, comme à pied (D3, tranché). L'invariant de voirie « aucun bonus de vitesse » est conservé.

**Bois, pierre et jardins restent inchangés** : leurs quantités ne dépendent pas d'une capacité de portage. Y introduire l'attelage demanderait de revoir leurs lots ; c'est une seconde étape.

### 4.2 Possession et entretien

- **L'écurie est essentielle** (D12) : les chevaux serviront aussi au combat. Elle loge les chevaux du village, et c'est elle qui fixe combien le village peut en avoir. Son coût, ses niveaux et sa capacité restent à chiffrer (questions ouvertes, section 6).
- **Une carriole** se fabrique à la scierie, en recette de bois d'œuvre. Un attelage, c'est une carriole et un cheval de l'écurie, que l'on attelle au départ du convoi.
- **Origine des chevaux** (D4), en trois étapes successives :
  1. **achetés à l'Oracle**, avec le barème existant : première version ;
  2. **trouvés à l'état sauvage**, lors de l'exploration : tranche ultérieure ;
  3. **pris aux perdants des combats** : avec le système militaire.

  Seule la première est dans le périmètre de réalisation de cette spec. Les deux autres sont actées comme direction : le modèle de données doit les accueillir sans migration, avec une provenance par cheval (`oracle`, `sauvage`, `butin`).
- **Entretien** (D5) : **20 carottes par cheval et par jour**, qu'il travaille ou non. Le serveur les prélève sur le stock du village, à une échéance quotidienne par village. L'effet d'un stock insuffisant reste à fixer (O2).
- **Partage des chevaux** (D12) : un seul effectif de chevaux par écurie, réparti **dynamiquement** entre les usages. Aujourd'hui, seul le commerce existe. Quand le combat existera, une règle de priorité s'appliquera ; la direction pressentie est **le militaire avant le commerce**. Elle sera fixée avec la spec militaire.

Un cheval engagé, dans un convoi aujourd'hui ou dans un combat demain, n'est pas disponible pour une autre mission. Sa disponibilité suit la même affectation exclusive que les habitants (aujourd'hui `trade_journey_id`, demain `processes.team`).

Ordre de grandeur, à confirmer : la migration 004 fixe une production de 60 carottes par heure, soit 1 440 par jour, de quoi nourrir 72 chevaux. Il reste à vérifier si ce débit vaut pour une parcelle ou pour un jardin entier.

### 4.3 Routes commerciales

- **Une route charretière** est une route manuelle de **deux tuiles de large** :
  - chaussée de 3,75 m, trottoirs de 0,625 m (4 pixels du moteur) avec bordure ;
  - segments axiaux et coudes à angle vif ; un congé en arc est possible en option graphique.
- **Contrats** : la largeur de trait (`RoadStroke.width`) monte de 8 à 16 pixels, sur la même grille de 1/16 de case et avec les mêmes règles de coût. Pour une case de longueur pavée :
  - 1,5 case de chaussée (3,75 m) à 4 pierres par case, soit 6 pierres ;
  - deux trottoirs, qui sont la « bordure » du moteur, à 1 pierre par côté, soit 2 pierres ;
  - total : 8 pierres, sans changer le barème validé.
- **Rôle dans la première version** : la route charretière **ne change pas la durée** (invariant actuel, D3). Elle donne :
  - un tracé que les attelages préfèrent, avec la même préférence de recherche que les autres voies ;
  - un croisement des attelages lisible à l'écran ;
  - **la durabilité** du revêtement choisi, voir 4.4.
- **Les routes automatiques (1,25 m, terre) ne changent pas.** Un attelage qui les emprunte est montré à l'écran, avec les attentes visuelles déjà acceptées pour les croisements ; le serveur ne simule pas les croisements.

D6 est tranché : **la durabilité seule** donne leur poids aux routes. Une vitesse supérieure sur route charretière, ou une obligation d'emprunter une route pour les attelages, ne sont pas retenues.

### 4.4 Usure et réparation

**Ce qui s'use** : seulement les **routes manuelles**. Les routes automatiques ne sont pas persistées et restent intactes.

**Comptage** :
- à la fin d'un convoi d'attelages, le serveur ajoute un passage à chaque case de route manuelle traversée par son chemin persisté, aller et retour ;
- le compteur est tenu par case, dans une table additive `road_wear (world_id, village_id, cell_x, cell_y, passages, repaired_at)`, et non dans le document JSONB du plan, pour ne pas faire avancer sa révision à chaque convoi ;
- coût borné par la longueur du chemin, calculé en une seule requête d'agrégation.

**Paliers** : neuf, usé, dégradé, selon des seuils de passages propres à chaque revêtement. Valeurs validées (D7), réglables en recette :

| Revêtement | Usé à partir de | Dégradé à partir de |
|---|---:|---:|
| Terre (`earth`) | 20 passages | 60 |
| Empierrement (`rubble`) | 60 | 180 |
| Pavés (`stone-1`, `stone-2`) | 200 | 600 |

**Effet** (D8, tranché) : **uniquement visuel**, plus une indication « à réparer » dans l'atelier de voirie. Aucun malus de vitesse ni de capacité.

**Réparation** : une commande d'infrastructure, appliquée immédiatement comme les autres poses, qui remet le compteur des cases choisies à zéro.
- **Coût** (D9, tranché) : **50 % du coût de pose** de la surface réparée. La terre et l'empierrement, gratuits à la pose, se réparent donc gratuitement.
- **Débit** : par la réserve prépayée existante.
- **Journal** : l'opération porte le motif `repair` prévu par le registre de la refonte.

**Routes d'un autre village** (D10, tranché) : le chemin d'un convoi traverse le village de l'acceptant et celui de l'auteur de l'annonce, et **use les routes des deux**. Pour éviter l'usure malveillante, un convoi ajoute au plus un passage par case et par trajet, et le nombre de cases qu'il peut user par village est plafonné (valeur à régler en recette).

**Piétons** (D11, tranché) : ils n'usent pas les routes.

### 4.5 Rendu

- **Le cheval** : modèle de Quaternius réexporté par Blender, ses 7 matériaux fusionnés en un seul à couleurs de sommets, animé en texture précalculée (pas, attentes) et dessiné en *thin instances*. Niveaux de détail après une simplification soignée (le banc a montré des trous à 500 et 150 triangles).
- **La carriole** : pièces rigides en *thin instances* (caisse, brancards, chargement selon la ressource, roues). La rotation des roues dépend de la distance parcourue et se calcule sur le processeur.
- **Le charretier** : une figurine, avec le pivot de taille de la spec des chantiers animés.
- **Synchronisation** : l'attelage suit le chemin et les échéances du serveur, avec le décalage visuel déjà accepté. L'essieu est tiré par la cinématique de remorque de l'étude, et la vitesse d'avance est réglée sur la foulée mesurée, pour que les sabots ne glissent pas.
- **Les routes** :
  - route charretière : rastérisée sur la grille existante ;
  - pavés de 2 × 1 pixels en quinconce, chaussée bombée, caniveaux, bordure de granit ;
  - les paliers d'usure se dessinent par case : ornières, flaques, nids-de-poule, pavés manquants. L'état est lu dans le snapshot, ou en synchronisation ciblée avec le plan d'infrastructure.

## 5. Invariants

- **Les durées viennent du serveur.** Avec la refonte, elles viennent du champ de distance pour les trajets courts, et du témoin certifié pour le commerce. Aucune durée ne dépend de l'animation.
- **Une mission engagée conserve son chemin, ses échéances et sa composition**, même si une route est supprimée, réparée ou s'use pendant le trajet.
- **L'usure se calcule à la fin du processus**, dans la même transaction que les livraisons, sous les verrous déjà pris par le commerce (villages verrouillés par UUID canonique).
- **Pas de réécriture du plan d'infrastructure** pour l'usure. Une réparation est une commande avec reçu idempotent.
- **Isolation par `world_id`.**
- **Le client ne décide ni des quantités, ni des attelages disponibles, ni de l'usure.**

## 6. Décisions

### 6.1 Tranchées par Tristan le 25 octobre

| # | Question | Décision |
|---|---|---|
| D1 | Où l'attelage sert-il en premier ? | **Commerce entre joueurs seulement.** Chantiers bois et pierre, jardins et logistique interne inchangés. |
| D2 | Capacité d'un attelage | **2 000 ressources**, soit l'équivalent de 8 porteurs. |
| D3 | Vitesse | **1 case par seconde**, comme à pied. Invariant de voirie conservé. |
| D4 | Origine des chevaux | **Achetés à l'Oracle**, puis **trouvés à l'état sauvage**, puis **pris aux perdants des combats**. Seul l'achat à l'Oracle entre dans cette spec ; les deux autres sont une direction actée. |
| D5 | Entretien | **20 carottes par cheval et par jour**, prélevées chaque jour, que le cheval travaille ou non. |
| D6 | Poids des routes | **La durabilité seule.** Pas de vitesse ni d'obligation de route pour les attelages. |
| D7 | Seuils d'usure | **Validés** : terre 20/60, empierrement 60/180, pavés 200/600 passages, réglables en recette. |
| D8 | Effet d'une route dégradée | **Visuel seulement**, avec l'indication « à réparer ». |
| D9 | Coût de réparation | **50 % du coût de pose**, appliqué immédiatement. |
| D10 | Routes de l'autre village | **Usées aussi**, avec un plafond par convoi contre l'usure malveillante. |
| D11 | Piétons | **N'usent pas** les routes. |
| D12 | Écurie et partage des chevaux | **Essentielle** : les chevaux serviront aussi au combat. **Un seul effectif réparti dynamiquement** entre les usages. Priorités à régler quand le combat existera ; direction pressentie : le militaire avant le commerce. |

### 6.2 Encore ouvertes

| # | Question | Proposition à discuter |
|---|---|---|
| O2 | Stock de carottes insuffisant au prélèvement | Le cheval est **affamé** : indisponible pour toute nouvelle mission jusqu'au prochain prélèvement réussi. Il ne meurt pas et ne s'enfuit pas. Une mission engagée continue. |
| O3 | Écurie : coût, niveaux, capacité | À chiffrer : nombre de chevaux par niveau, coût en bois d'œuvre et pierre taillée, niveau d'hôtel de ville requis. |
| O5 | Plafond d'usure par convoi dans un autre village | Nombre de cases au-delà duquel un convoi n'use plus les routes d'un village tiers, à régler en recette. |

## 7. Tranches de réalisation

1. **Rendu seul, sans économie** :
   - pipeline du cheval (fusion des matériaux, texture précalculée, simplification) ;
   - carriole rigide, charretier ;
   - banc étendu à des attelages qui suivent des chemins.

   Peut commencer tout de suite : ne dépend d'aucune décision.
2. **Route charretière** :
   - largeur jusqu'à 16 pixels dans les contrats, devis, atelier de voirie ;
   - rendu des trois revêtements à l'état neuf.

   Dépend seulement de la validation de 4.3.
3. **Écurie et chevaux** :
   - bâtiment écurie, chevaux par village avec leur provenance (`oracle` pour l'instant), achat à l'Oracle ;
   - prélèvement quotidien de carottes et état « affamé ».

   Dépend de O2 et O3. Le modèle doit accueillir plus tard les chevaux sauvages, le butin, l'usage au combat et une priorité entre usages.
4. **Attelages au commerce** :
   - fabrication de la carriole à la scierie, composition des convois (2 000 par attelage), choix porteurs ou attelages à l'acceptation ;
   - rendu des convois attelés.

   Dépend de la tranche 3.
5. **Usure et réparation** :
   - table `road_wear`, comptage en fin de convoi sur les routes des deux villages, plafond par convoi, paliers, commande de réparation à 50 % ;
   - rendu des états usé et dégradé.

   Ne dépend plus que de O5, réglable en recette. S'insère au mieux après les lots `processes` et `resource_movements` de la refonte, sinon dans le gestionnaire de fin du commerce actuel.

Chaque tranche comprend contrats, serveur, client raccordé, tests et recette, et ne réécrit aucune mission engagée.

## 8. Vérification

- **Tests purs** :
  - nombre d'attelages et d'habitants pour une charge donnée, avec la règle de capacité réutilisée au retour ;
  - comptage d'usure sur un chemin connu : aller et retour, cases uniques ou répétées, cases hors route ignorées ;
  - passage d'un palier à l'autre et remise à zéro par réparation ;
  - coût de réparation par la réserve au 1/256.
- **Tests d'intégration** :
  - acceptation concurrente : un attelage ne peut pas partir deux fois ;
  - fin de convoi : livraisons et usure dans la même transaction, et commande rejouée sans double comptage ;
  - route supprimée pendant un trajet : ni erreur, ni usure sur la case supprimée.
- **Recette** :
  - attelages qui se croisent sur une route charretière, en vue rapprochée et à 17 px ;
  - usure visible après une série de convois ;
  - réparation ;
  - 300 attelages à 60 i/s sur la MX230 (banc étendu).

## 9. Hors périmètre

- Usage des chevaux au combat, chevaux pris aux perdants, licorne et chevalier monté : ils relèvent de la spec militaire. L'écurie et le modèle de données des chevaux doivent néanmoins les prévoir (D4, D12). Le squelette du cheval et la variante licorne sont prêts dans les études.
- Chevaux trouvés à l'état sauvage : direction actée (D4), à spécifier avec l'exploration.
- Bateaux, ponts, tunnels, diagonales du réseau.
- Entrepôts et logistique interne.
- Élevage et reproduction.
- Monnaie.
- Accidents, vol de cargaison, combat sur les routes.
- Simulation serveur des croisements.
