# Direction produit — découverte et vie du village

Date : 6 septembre 2026. Source : arbitrages de Tristan dans la session de consolidation, après le commit `1da6df0`.

**Statut : décisions produit consolidées ; implémentation à cadrer par tranches.** Ce document distingue les choix actés, les pistes et les questions ouvertes. Il ne vaut ni livraison ni autorisation d'implémenter tous les systèmes décrits. Il prévaut pour ces intentions sur les propositions antérieures ; les specs techniques livrées restent les références du comportement actuel.

## Intention et rythme

Faire découvrir le gameplay sans dark pattern : récompenses compréhensibles, initiative laissée au joueur, aucune urgence artificielle à s'inscrire. L'investissement et la progression doivent progressivement allonger l'accès aux objectifs : une Scierie 5 serait facile à obtenir, une Scierie 20 beaucoup moins. Ces niveaux illustrent l'intention, pas un catalogue approuvé.

Le monde doit accueillir à la fois celui qui passe cinq minutes améliorer sa scierie et celui qui veut former des soldats et attaquer. Pas de cadence de connexion unique imposée comme cible. Les durées, coûts et courbes ne sont pas définis ; la récolte d'une minute est une valeur temporaire de POC.

## Deux parcours d'entrée

**Parcours standard acté : inscription → choix d'un monde → spawn → quêtes.** L'inscription précède ici l'expérience persistante.

**Parcours TRY : jouer avant de s'inscrire.** Dans la conception précisée par Tristan, le joueur prend le contrôle d'un village abandonné par son précédent chef, déjà partiellement construit. À la fin, deux choix : **s'inscrire et garder ce village**, ou **s'inscrire et commencer un village neuf**. Le second rejoint le choix d'un monde et le spawn du parcours standard.

Le [lore TRY — Samsara](../docs-lore/TRY-SAMSARA.md) conserve l'intention d'entrée sans engagement et l'historique du concept. La possibilité de garder le village remplace sa règle initiale de renaissance obligatoire sans conservation du village ; ce n'est pas une architecture livrée.

- `try.arbestra.world` fait apparaître le joueur dans ce village de reprise sans formulaire ni choix de monde préalable.
- Une copie/projection d'un monde existant fournit le contexte. Le monde source reste en lecture seule pour TRY ; la session possède son propre état mutable et permet de jouer.
- Les actions TRY ne modifient aucun vrai village et ne donnent pas accès à des informations exploitables sur les autres joueurs.
- Avant inscription, le cycle reste temporaire et isolé. **Garder le village conserve toute la progression de l'essai, constructions et ressources comprises**, décision confirmée par Tristan. L'ancienne interdiction générale de transfert est remplacée par cette continuité du village.
- La progression sans compte est volontairement plafonnée pour borner aussi un essai de huit heures. Le principe retenu est une condition d'inscription sur des niveaux de bâtiments : par exemple, accéder à la Scierie niveau 6 demande d'incarner un personnage et propose de conserver le village. Le niveau 6 illustre le mécanisme ; les seuils définitifs et bâtiments concernés restent à calibrer. Ce n'est pas une limite fondée sur le temps passé.
- Proposition de texte, à finaliser : « Pour améliorer votre scierie au niveau 6, incarnez un personnage. Créez votre compte pour conserver ce village et poursuivre son développement. » Le besoin de créer un compte doit rester explicite derrière le vocabulaire de l'incarnation. Les actions encore disponibles au plafond et sa présentation anticipée restent à cadrer ; aucune urgence artificielle n'est demandée.
- Restent à spécifier : village réellement abandonné ou village préparé avec cette histoire, critères de disponibilité, copie et isolation, attribution à l'inscription, emplacement et monde de destination, concurrence entre candidats, fin de session et préférences transférables. La conservation autorisée du village ne décide pas du traitement technique des interactions externes simulées ; elle ne permet pas d'écraser l'état d'un autre joueur. Les systèmes futurs du lore ne sont pas des prérequis à un premier TRY.

## Parcours initial acté

| Étape | Expérience et accomplissement |
|---|---|
| Découvrir l'Hôtel de ville | Le joueur trouve librement le coffre. L'Oracle fournit un indice s'il peine à progresser ; pas de quête dévoilant d'emblée la solution. |
| Ouvrir le coffre | Première quête accomplie et 2 000 carottes, avec un retour immédiat. Aucun second crédit à ajouter à la récompense existante. |
| Récolter | Jardin préexistant avec un tiers de sa capacité en carottes poussées. Les premières carottes récoltées suffisent comme récompense de cette étape. |
| Explorer deux activités | Deux quêtes parallèles : extraction de pierre et coupe de bois. Ce n'est pas une chaîne imposant l'une avant l'autre. |
| Développer l'accueil | Le joueur découvre l'intérêt de davantage d'habitants pour aller plus vite. Premier choix de développement : agrandir une maison ou construire une seconde maison. |
| Accueillir | Le premier petit groupe de nouveaux habitants valide une quête implicite, honorée par l'Oracle. |

Les arbres doivent contraindre naturellement l'étalement et inviter à composer avec le terrain. Leur occupation bloque déjà la construction ; l'objectif d'éviter un village massif en dix minutes reste à éprouver. La coupe de bois, son effet sur les obstacles et les gains de vitesse liés aux effectifs restent à cadrer.

Les quêtes suivent le spawn dans le parcours standard et accompagnent la découverte dans TRY. Leur adaptation à un village de reprise déjà construit et leur continuité à l'inscription restent à préciser, sans supposer une remise à zéro des récompenses. Le choix d'habitation doit avoir un intérêt réel : les couchages initiaux actuels dépassent déjà la population initiale. Il faudra cadrer cet état de départ sans inventer une croissance instantanée pour forcer la quête.

## Population, énergie et satisfaction

### Acté comme direction produit

- Les couchages sont une limite de population, pas un mécanisme de création automatique d'habitants.
- La population croît par petits groupes lorsque les conditions de satisfaction sont bonnes, dans la limite de l'accueil disponible.
- Faire travailler les habitants fatigués les rend ronchons. L'énergie et la bonne humeur sont deux notions liées, sans imposer ici leur représentation technique.
- Les habitants ronchons mangent automatiquement si des carottes sont disponibles. Une carotte rend de l'énergie et un peu de bonne humeur ; quantités exactes et seuils restent ouverts.

### Pistes retenues, à spécifier

- Une mauvaise humeur non apaisée, notamment faute de carottes, peut conduire au refus des activités les plus dures : combat et pierre.
- Un mécontentement extrême peut conduire à partir et s'installer dans un autre village. Le départ est exceptionnel, pas la conséquence ordinaire d'un repas manqué.

### Questions ouvertes

Seuils, délais, récupération, critères de satisfaction, fréquence et taille des arrivées ; articulation avec le quota alimentaire actuel ; refus au départ ou interruption d'une tâche ; effet de l'absence du joueur ; choix du village d'accueil et conservation des effectifs lors des migrations. L'accès au Jardin en cas de mécontentement est une recommandation pour éviter une impasse, pas encore un arbitrage.

## Oracle

**Accomplissements persistants actés** : le joueur peut retrouver ses quêtes accomplies dans un journal, éventuellement présenté sous forme de trophées. PostgreSQL conserve la vérité métier ; l'Oracle en est la voix. Ce choix ne demande pas un moteur générique de trophées. Première tranche implémentée par Sol : [coffre et journal de l'Oracle](./SPEC-COFFRE-JOURNAL-ORACLE.md). Le déclenchement de l'indice reste à arbitrer ; voir le handoff courant pour les validations.

L'Oracle est la sortie privilégiée des astuces et du tutoriel, avec humour et contexte. Il explique les règles par leurs conséquences observables sans exiger des personnages persistants individuels.

Exemple donné par Tristan : « J'ai entendu dire que Jean-michel a refusé d'aller couper du bois l'autre jour, parce qu'il avait l'estomac vide. Quelle indignité ! » Ce texte illustre le ton ; il n'ajoute pas la coupe de bois à la liste arrêtée des refus.

L'Oracle aide en cas de blocage et célèbre les accomplissements implicites. Détection du blocage, fréquence des interventions, textes définitifs et présence éventuelle d'une jauge de satisfaction restent ouverts.

## Coexistence militaire et pacifique

Direction retenue : la protection dépend du karma, pas seulement d'un écart de puissance militaire.

- Protection absolue à l'arrivée. La quête proposant une caserne ouvre la découverte militaire ; elle ne retire pas à elle seule la protection.
- Si le joueur refuse cette quête, une interaction explique la protection et permet de choisir d'essayer le militaire ou d'écarter ces sollicitations de son parcours.
- Construire une caserne ou former des soldats ne fait pas perdre la protection. C'est la perte de karma, selon les seuils à définir, qui fait basculer.
- Initier un combat coûte du karma. Défendre son village n'en coûte pas ; une expédition de vengeance reste une attaque.
- Le karma se reconstitue. Le joueur qui n'attaque jamais acquiert un bonus pacifiste ; à partir d'un seuil positif, la protection est absolue.
- À karma nul ou légèrement positif, l'Oracle atténue la violence du combat pour le défenseur. La forme de cette intervention n'est pas décidée.

Restent ouverts : valeur initiale et articulation avec le bonus acquis, seuils, perte et récupération, protection à karma négatif, effets économiques et militaires de l'atténuation, traitement des attaques déjà engagées et prévention des raids entre deux retours sous protection. Aucun système de combat ou de karma n'est livré par cette consolidation.

## Écart avec le code relu

Base : `1da6df0`, lecture statique du 6 septembre ; aucune nouvelle exécution de tests ni validation navigateur.

| Existant vérifié | Cible ou travail futur |
|---|---|
| `discoverBuildingSupplies()` dans `apps/api/src/modules/villages/service.ts` et `hiddenSuppliesAvailable` dans les contrats portent le coffre actuel. | Quête implicite et retour d'accomplissement, avec une seule autorité de crédit. |
| `feedPopulation()`, `restPopulation()` et `population/energy.ts` portent repas manuels et énergie ; les contrats exposent les totaux et l'énergie. | Humeur, repas automatiques, arrivées et départs ne sont pas implémentés. |
| `housingCapacity` est calculée ; Habitation niveau 2 existe. | Plafond à appliquer aux futures arrivées, pas preuve d'une croissance déjà livrée. |
| Jardin et pierre disposent de commandes et de panneaux React. | Coupe de bois distincte de la production de Scierie ; quêtes parallèles non livrées. |
| TRY est décrit par le lore ; aucune tranche TRY livrée n'a été identifiée lors du tour du dépôt. | Architecture d'isolation et parcours anonyme à spécifier. |

## Suite recommandée

Préparer une tranche bornée coffre → première récolte : visibilité de l'accomplissement, indice Oracle, crédit unique préservant les coffres réclamés et état initial du Jardin. Distinguer explicitement cette tranche du chantier TRY nécessaire à la promesse sans inscription. Leur ordre d'implémentation reste à choisir ; ne pas déclarer TRY réalisé sur la seule base d'un parcours connecté.

L'[ancienne proposition de quête](./HANDOFF-SOL-2026-09-06-QUETES-JOUEUR-POUR-ASTRA.md) conserve ses recommandations techniques et preuves à prévoir, sauf présentation initiale de la quête désormais remplacée par la découverte implicite. Les [réveils lisibles](./DESIGN-SOL-2026-09-06-REVEIL-COHORTES-POUR-ASTRA.md) restent un cadrage distinct.
