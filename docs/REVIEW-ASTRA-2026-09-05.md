# Arbestra — avis architectural et organisation de travail

Date : 5 septembre 2026. Lecture du worktree courant, pas seulement du dernier commit.

Ce document répond aux 33 questions du [brief de Sol](./ARBESTRA_CONTEXT_FOR_ASTRA.md). C'est une revue et une proposition de priorités, **pas une nouvelle spécification autoritaire**. Aucun changement applicatif, aucune commande de base, aucun test, build ou contrôle navigateur exécuté pour cette revue. Les conclusions de concurrence sont issues du code et restent à reproduire par tests ciblés ; aucune mesure de performance nouvelle n'est revendiquée.

## Verdict

Le projet a un vrai squelette de jeu persistant, pas une collection de mocks. Les bonnes décisions sont déjà concrètes : occupation atomique des cellules, économie temporelle, séparation React/Babylon, contrats JSON, moteur de combat externe au jeu.

Le risque principal n'est pas le choix de stack ou la taille des fichiers. C'est l'accumulation de chemins légèrement différents pour une même règle : réconciliation, construction historique/spatiale, catalogue générique/branches Jardin. La petite consolidation utile concerne ces chemins, pas un nouveau framework.

## Priorités proposées

### À corriger maintenant : ordonner l'économie, pas seulement les tâches

Sources : [complete-construction.ts](../apps/api/src/modules/villages/complete-construction.ts), [economy.ts](../apps/api/src/modules/villages/economy.ts), [service.ts](../apps/api/src/modules/villages/service.ts), [scheduled-tasks.ts](../apps/api/src/jobs/scheduled-tasks.ts).

`settleDueConstructionsForVillage` récupère les échéances sans `orderBy`. Chaque achèvement matérialise tous les flux directs du village jusqu'à sa propre échéance. Les workers verrouillent chacun leur tâche puis leur bâtiment ; ils n'ont pas de sérialisation économique commune par village.

Exemple possible : une Scierie doit terminer à 20:10, un Jardin à 20:20. À 20:30, si le Jardin est réconcilié d'abord, il avance le curseur du bois jusqu'à 20:20 avec la production ancienne. La Scierie est ensuite activée, mais le curseur ne revient pas à 20:10 : sa production entre 20:10 et 20:20 est perdue. Une requête SQL sans ordre ne garantit pas que le cas favorable sera toujours choisi. Deux workers peuvent également traiter des échéances différentes du même village hors ordre, notamment après un retry.

Correction minimale proposée : une entrée de réconciliation économique par village, utilisée par commandes, lectures et handlers, avec un verrou de village pris **avant** les verrous métier, une borne temporelle explicite et les transitions dues parcourues par échéance puis identifiant. Le handler ne doit pas seulement activer son bâtiment en ignorant les transitions antérieures. Ne pas verrouiller les autres tâches du scheduler depuis cette réconciliation : éviter une inversion tâche/village. Le scheduler reste générique et petit.

Un simple `orderBy` améliore les lectures mais ne suffit pas à régler les workers concurrents. Deux tests de régression utiles : échéances différentes réconciliées en ordre défavorable ; deux workers sur le même village avec effet sur le même flux. Les tests actuels de SKIP LOCKED vérifient l'attribution de tâches distinctes, pas cet ordre économique.

La même convention doit régler les snapshots pris pendant une mutation. Les transactions actuelles ne déclarent pas d'isolation renforcée et `state()` assemble plusieurs requêtes : une transaction seule ne signifie pas photographie immuable. Ne pas imposer SERIALIZABLE partout ; commencer par le verrou de l'agrégat concerné et une règle commune à tous ses écrivains.

### À corriger maintenant : ne pas appeler générique ce qui ne l'est pas encore

Sources : [catalogue](./architecture/building-catalog.md), [service.ts](../apps/api/src/modules/villages/service.ts), [economy.ts](../apps/api/src/modules/villages/economy.ts), [contrats](../packages/contracts/src/villages.ts).

La spec définit la superficie par `progressionMode = spatial`. Le serveur autorise plusieurs cellules et multiplie les coûts seulement pour `item.code === 'garden'`. La production surfacique teste également `buildingType === 'garden'`. Ajouter un autre type spatial au catalogue ne donne donc pas le comportement décrit.

Correction : utiliser les deux stratégies fermées déjà présentes, progression et production ; pas de registre universel de comportements. Remplacer progressivement les projections `garden/storedCarrots` par des buffers de ressources et une emprise indépendants du nom du bâtiment, au plus tard avec le deuxième type récoltable. Retirer ensuite les doubles champs `resources` et `wood/carrots` plutôt que maintenir deux contrats indéfiniment.

Autre piège précis : dans `villageProductionPerHour`, le filtre `productionMode = direct` porte sur une jointure gauche vers `buildingTypes`, mais la jointure suivante vers `buildingLevelProduction` dépend de `buildings`, pas du succès de ce filtre. Un bâtiment buffered produisant une ressource qui possède aussi un flux de village pourrait donc être additionné au flux direct. Les deux ressources actuelles ne suffisent pas à exposer ce cas. Attacher réellement la production additionnée au mode direct avant d'étendre le catalogue.

### À la prochaine tranche : distinguer monde métier et fenêtre affichée

Source : `snapshot()` et `assertBuildable()` dans [service.ts](../apps/api/src/modules/villages/service.ts).

La région est un carré de 64 × 64 centré sur le village. `assertBuildable` consulte cette même fenêtre pour décider du terrain ; hors fenêtre, `terrainAt` retourne `undefined`, donc le terrain est refusé même s'il serait constructible dans le monde. C'est une vraie limite d'expansion, pas seulement une limite de caméra.

Correction minimale : lire les chunks des cellules demandées pour valider une commande, indépendamment de la fenêtre envoyée au navigateur. Réutiliser ce chargement une fois par sélection : actuellement chaque cellule rappelle `assertBuildable`, qui recharge terrain, clairières et emprises. Une sélection de 100 cellules multiplie inutilement ces lectures. Pas besoin de Redis : charger le contexte une fois dans la transaction suffit.

Le déplacement de la fenêtre client viendra ensuite. Le monde existe en base à grande échelle, mais le client n'en est pas encore un navigateur complet.

### Avec les gisements : invalider le bon état visuel

Source : `#createWorldFeatures` dans [BabylonVillageScene.ts](../apps/world-web/src/scene/BabylonVillageScene.ts).

La signature contient seulement la version de génération et l'origine de région. Elle ignore le contenu des features et l'identité du monde. À région identique, retirer un gisement du snapshot ne reconstruit pas son visuel. Le décor est en outre fusionné par matériau pour toute la région et non adressable par gisement.

Correction : distinguer cache de terrain immuable et objets métier mutables ; invalider au changement de contenu/révision et conserver un lien `featureId → représentation`. L'identité peut rester dans une table de correspondance ou des proxies de picking : pas besoin d'un mesh par arbre. Pour la première exploitation, une reconstruction bornée des groupes concernés suffit.

### Avant ouverture publique, pas avant la prochaine session locale

- `config.ts` applique `CONSTRUCTION_DURATION_MS` même en production, contrairement au catalogue documentaire. Refuser ou ignorer explicitement cet override en production.
- `auth/routes.ts` et `app.ts` ne montrent pas de limitation de tentatives de connexion. Prévoir le durcissement auth au jalon inscription/publication, ainsi que la politique d'origine/cookies entre sous-domaines. Cette revue n'est pas un audit de sécurité complet.
- Rendre les retries persistants visibles : `lastError` et `attempts` existent, mais une tâche peut réessayer indéfiniment. Un log exploitable et une requête d'inspection suffisent avant une console d'administration.

## Réponses aux 33 questions

### Architecture

**1. Monolithe modulaire réel ? — Oui, encore jeune.**
`app.ts` compose des routes auth/villages ; le worker appelle des handlers métier ; Kysely est injecté. Il n'y a pas de service distant simulé par trois couches inutiles. Le dossier villages concentre encore beaucoup du jeu, ce qui est compréhensible aujourd'hui.

**2. Frontières réelles ou dossiers ? — Les deux.**
Auth, scheduler et moteur Rust sont des responsabilités identifiables. En revanche, `villages/service.ts` possède aussi la lecture du terrain et les règles de disponibilité spatiale. Extraire ce petit accès mondial lorsque l'exploitation/spawn en a besoin, pas fabriquer des interfaces de repository partout.

**3. Transport, métier, persistance séparés ? — Correctement, mais pas hermétiquement.**
`database/schema.ts` décrit Kysely ; `packages/contracts` décrit le JSON ; les routes valident les entrées. Les services renvoient directement `VillageState` et lèvent `HttpError`. Acceptable pour ce monolithe ; les doublons métier dans le contrat et les branches Jardin sont plus gênants que l'absence d'une couche supplémentaire de DTO.

**4. Infrastructure à supprimer ? — Pas de gros coup de balai.**
Pas de Redis, broker ou bus artificiel. Le chemin `LegacyBuildRequestSchema` et `constructBuilding` doublonne le chemin spatial : lorsque les consommateurs/tests ont basculé, faire passer la construction d'une cellule par la même commande. Ne pas entretenir une compatibilité externe imaginaire pour un prototype local.

**5. Frontières peu coûteuses à préserver ? — Deux priorités.**
Un point d'entrée économique temporel par village ; un accès cellules/chunks indépendant du viewport. Ils répondent à des problèmes déjà observables. Un système générique de workflows/topologies ne le ferait pas.

### Serveur et persistance

**6. Commandes idempotentes ? — Effets protégés, retries HTTP pas totalement.**
Les réservations uniques empêchent de construire deux fois la même zone ; les verrous empêchent de récolter deux fois le même stock. Mais rejouer un POST d'amélioration après l'achèvement peut lancer le niveau suivant : absence de clé de commande ou de niveau attendu. Avant les retries automatiques, ajouter au minimum `expectedLevel`, et une identité de commande quand il faut rejouer exactement la même réponse. Un bouton désactivé ne couvre ni le réseau ni un second onglet.

**7. Actions différées sûres ? — Bonne primitive, ordre économique incomplet.**
La prise SKIP LOCKED, le savepoint et l'achèvement dans la même transaction sont adaptés aux handlers courts exclusivement PostgreSQL. Un crash avant commit annule les effets. Cela garantit bien davantage qu'un timer Node, mais ne résout pas l'ordre entre effets qui partagent le même flux : voir priorité principale. Un futur appel externe ne devra pas être présenté comme atomique avec PostgreSQL.

**8. Les lectures écrivent-elles ? — Seulement intentionnellement sur échéance, dans les chemins lus.**
`state()` réconcilie les échéances dues, puis `projectVillageResource`/`projectBuildingBuffer` calculent sans UPDATE permanent. C'est conforme au modèle choisi : GET n'est pas strictement sans écriture, mais le compteur ne provoque pas un tick DB. Les petits restes numériques restent privés ; le stock exposé est entier.

**9. world_id est-il structurellement sûr ? — Plutôt solide.**
Les migrations 004/006/008 posent des FK composites monde/village/bâtiment ; l'occupation a une PK `(world_id, cell_x, cell_y)`. `ownedVillage` exige appartenance au monde et propriété du village. Certaines jointures utilisent seulement l'UUID global ; ce n'est pas en soi une fuite démontrée. Conserver le contexte explicite et tester deux mondes au jalon spawn. Les catalogues sont globaux : des règles économiques différentes par monde nécessiteront une décision de versionnement, pas simplement une nouvelle ligne `worlds`.

**10. Transactions adaptées ? — Oui pour l'atomicité, à compléter pour l'ordonnancement.**
Débit, bâtiment, emprise et tâche sont atomiques ; les collisions perdantes annulent le tout. Une extension possède un index unique partiel interdisant deux chantiers simultanés du même bâtiment. La génération prend un verrou de monde et devient ready dans sa transaction. Garder cette génération hors du chemin d'une requête joueur longue ; ne pas la distribuer prématurément.

**11. Protection test/dev/prod ? — Le défaut dangereux a été retiré.**
`test-environment.ts` exige `TEST_DATABASE_URL` et le suffixe `_test`, sans fallback dev. `reset-e2e.ts` revérifie l'URL ; Vitest et Playwright sérialisent leurs propres tests. Ce garde-fou n'est pas une séparation de privilèges : un rôle dédié au test la renforcerait. Deux agents lançant deux suites contre la même base peuvent encore se perturber ; un worktree ne duplique pas PostgreSQL.

### Client et Babylon

**12. Frontière React/Babylon ? — Bonne.**
`VillageScene.tsx` crée/détruit la scène, transmet snapshots et callbacks. Babylon gère géométrie/picking/caméra, React le HUD et les actions. Le monde ne devient pas un arbre React par frame. Un import du type `ScreenAnchor` depuis l'UI est un petit couplage de type, pas un problème justifiant un refactor.

**13. Travail par frame inutile ? — Pas l'ancien travers de reprojection généralisée.**
La boucle met à jour le profil caméra, son wrapping et le rendu, plafonné dans le code. Les signatures visuelles sont calculées lors des updates de snapshot, pas à chaque frame. Le coût probable à surveiller est la reconstruction de tous les meshes village lorsqu'un état visuel ou le mode construction change, pas le compteur React chaque seconde. Mesurer avant de remplacer.

**14. Instances, fusion ou statique ? — Plusieurs bons choix existent déjà.**
Terrain construit en meshes par blocs de 8 × 8 ; décor fusionné par matériau et matrices figées ; matériaux réutilisés. La fusion de toute la région limite toutefois la finesse du culling et l'édition d'un gisement. À l'exploitation, grouper spatialement ou utiliser des instances avec correspondance d'identité. Les petits bâtiments interactifs peuvent rester indépendants.

**15. Picking correct ? — Oui dans le principe, avec une réserve de relief.**
La sélection normale utilise `scene.pick` et respecte `isPickable`. La sélection de surface projette un rayon sur un plan horizontal à y=0,075 : simple et valide pour la clairière plate, mais pas une sélection exacte du terrain sur relief. Passer au picking du terrain pour les futures zones élevées ; validation serveur inchangée. La sensation tactile et les conflits caméra/drag demandent la vérification utilisateur.

**16. Mobile protégé par l'architecture ? — Partiellement, pas certifié.**
Région bornée, fusion du décor, matériaux partagés, pas de framework graphique additionnel : bonnes bases. Un profil Playwright Pixel 7 n'est pas une mesure GPU sur téléphone. Débit réel, chauffe, mémoire et qualité visuelle restent à observer sur appareil ; aucun chiffre de performance ne peut être déduit de cette lecture.

**17. Coordonnées monde/UI séparées ? — Oui, avec quelques doublons.**
Cellules entières autoritatives, coordonnées locales `x/z`, puis ancre DOM. Le contrat transporte les deux premières représentations ; ce n'est pas nécessairement mauvais. La taille 2,5 et le delta torique sont répétés dans plusieurs fichiers : centraliser les petites fonctions mathématiques neutres lorsque ces usages évoluent, sans y déplacer les droits de construction serveur.

### Espace

**18. Hypothèses planes problématiques ? — La topologie, moins que le relief et la fenêtre.**
Le wrapping est déjà traité dans `coordinates.ts` et les sélections. Les points concrets sont la fenêtre 64 × 64 utilisée comme vérité de terrain, le picking sur un plan et les hauteurs fixes des bâtiments/grilles face aux élévations du sol. Pas besoin de courber physiquement le gameplay pour les résoudre.

**19. Plus petite abstraction de distance/trajet ? — Celle qui existe, enrichie au besoin.**
Garder normalisation, delta signé et distances nommées dans le module spatial. Pour une première mission, définir explicitement sa métrique et sa route, plutôt qu'un vague `distance()`. La possibilité de choisir un trajet long est une question produit future ; ne pas forcer le plus court dans toutes les commandes. Pas de classe `Topology` polymorphe maintenant.

**20. Rendu cartésien local et monde torique ? — Oui.**
C'est déjà l'approche : cellules canoniques et décalages enveloppés autour d'une origine. La révélation donut peut être une représentation distante distincte. Elle n'oblige pas les bâtiments, les récoltes ou la future recherche de chemin à fonctionner en coordonnées 3D de tore.

### Moteur Rust — dépôt voisin Waar-v3, pas encore intégré à Arbestra

Sources principales : [lib.rs](../../waar-v3/rust/src/lib.rs), [batch.rs](../../waar-v3/rust/src/batch.rs), [spécification 3.1](../../waar-v3/docs/combat-engine-v3.1-specification.md).

**21. Indépendant du framework ? — Oui.**
Le crate dépend de serde, serde_json et sha2, pas de Symfony/Doctrine/PostgreSQL. Il possède une bibliothèque Rust et une frontière C/JSON. L'indépendance technique est réelle ; l'indépendance du ruleset Waar n'est pas encore complète.

**22. API assez grossière pour batcher ? — Oui.**
`resolve_batch` reçoit scénarios, nombre d'itérations et seed ; les combats et agrégations s'enchaînent en Rust sans aller-retour PHP par combat. Il est mono-thread ; aucune nécessité de modifier cela sans mesure. Le mécanisme d'appel depuis Node reste à choisir à l'intégration, sans imposer un service réseau.

**23. Rejeu exact suffisamment défini ? — Bon départ, pas une garantie universelle.**
Le `CombatRequest` transporte armées, ruleset et snapshot versionné. Le `CombatSnapshot` seul ne contient ni les armées ni tout le ruleset : archiver la requête complète ou des références véritablement immuables. Le code vérifie le libellé de version, pas une empreinte de contenu. Le sampler utilise aussi `ln/cos/sqrt` flottants : ne pas promettre le même résultat sur toute plateforme future sans vecteurs de conformité. Préserver les entrées et l'identité du moteur, pas seulement un seed.

**24. Facile à fuzz/property-tester ? — Oui à sa frontière pure.**
Pas besoin de démarrer un serveur pour appeler `resolve_combat`. Il existe des tests Rust et des comparaisons PHP/FFI ; pas de dépendance proptest/fuzz dans le Cargo.toml lu. Avant publication/intégration, borner payloads, effectifs, rounds et chaînes ; vérifier conservation des effectifs et absence de panique. Ce n'est pas une invitation à lancer une campagne maintenant.

**25. Fuite du domaine web/jeu ? — Pas de web, mais du Waar.**
`UnitType::{Soldier,Spearman,Archer,Knight}`, tableaux 4 × 4 et coût dans le ruleset sont présents. Le coût contribue au départage par valeur : ce n'est pas forcément une erreur, mais il faut décider si valeur de combat et coût économique doivent être identiques dans Arbestra. Ne pas présenter la 3.1 générique comme déjà livrée.

**26. Représentation assez expressive ? — Pour les quatre archétypes actuels, oui.**
Cohortes, structure résiduelle, ciblage prioritaire/pondéré et engagements donnent des mécanismes explicites. Ajouter un cinquième type exige aujourd'hui du code. À l'intégration, choisir entre un premier ruleset quatre types assumé et la généralisation minimale N types ; ne pas importer automatiquement Caserne, mobilité, encerclement et toute la feuille de route 3.1.

### Tests et calibration

**27. Assez d'invariants, pas seulement des snapshots ? — La base teste de vrais comportements.**
Arbestra teste débit unique, concurrence, rollback, retry, échéances, capacité et lecture sans matérialisation systématique. Rust teste fixed-point, RNG et combats ; la suite PHP compare aussi les sorties natives et batch. Mais la parité peut être ignorée si DLL/FFI absentes, et deux implémentations identiques peuvent partager une erreur. Le manque prioritaire est l'ordre économique multi-échéances, pas cent nouveaux snapshots.

**28. Seeds comparables dans la soufflerie ? — Oui.**
`InteractiveCombatLab` emploie le même seed pour baseline/draft ; le batch garde les indices globaux d'itération. Les corpus utilisent une dérivation par identifiant de scénario ; les profils ont une dérivation par indice de couple. Donc comparaison appariée oui, invariance à toute modification de la sélection des profils non garantie par le même mécanisme.

**29. Filtrage avant calcul ? — Oui au niveau des profils.**
Le Lab filtre baseline et draft avant d'appeler le runner. Ce dernier génère ensuite tous les couples ordonnés des profils sélectionnés, y compris les miroirs. Une sélection de profils n'est donc pas une sélection arbitraire de couples. Si l'UX demande « seulement A contre B », cette granularité doit être transportée avant la simulation, pas cachée après.

**30. Comprendre pourquoi un ruleset réagit ainsi ? — Des données utiles, pas encore un diagnostic complet.**
Résultats par round, pertes, blessés, ExtraBalls et métriques d'engagement permettent une inspection. Les agrégats seuls peuvent masquer des extrêmes. Prochaine amélioration utile : ouvrir un couple puis un combat représentatif avec seed et entrées, plutôt qu'ajouter vingt courbes. La télémétrie causale étendue de la 3.1 reste un objectif documentaire.

### Assets et contenu

**31. Kit modulaire favorisé ? — La silhouette oui, le pipeline n'existe pas encore.**
La Scierie assemble déjà charpente, toiture, volumes sombres et accessoires, avec variations selon niveau. C'est une bonne maquette de kit. `visualKey/visualVariant` existent au catalogue mais les recettes sont encore codées en Babylon. Au premier asset, définir échelle, pivot au sol, emprise et points d'accroche ; ne pas créer un importateur universel.

**32. Variation cosmétique distincte du serveur ? — Oui, à conserver.**
Une feature serveur a une identité, une emprise et un `variantSeed`. Ses quelques arbres sont une représentation, pas autant de stocks ou d'entités métier. Une fleur purement décorative n'a rien à faire en PostgreSQL. Attention à préserver l'identité du gisement quand son dessin est fusionné.

**33. Pipeline maintenable avec davantage d'assets ? — Pas encore éprouvé.**
La grande classe de scène mélange caméra, interactions et recettes. Pas besoin de la réécrire ; sortir la recette Scierie quand Tristan l'édite ou la remplace par un kit, puis les autres à mesure. La qualité d'intégration au sol, les dimensions et les variantes cohérentes feront plus que le nombre de modèles.

## Ordre de travail conseillé

1. Consolider ordre temporel/verrous du village, avec deux ou trois cas de régression précis.
2. Aligner les stratégies du catalogue et corriger la jointure des productions directes. Unifier les chemins de commande encore doublonnés.
3. Découpler validation terrain et fenêtre client ; préparer l'invalidation des features dans la tranche exploitation.
4. Compte/spawn et deuxième joueur/deuxième monde : éprouver l'autorisation, les clairières et les collisions réellement partagées.
5. Faire vivre un petit kit artistique en parallèle, sans confondre livraison visuelle et preuve de build.

À ne pas construire maintenant : event sourcing, système de workflow, moteur de topologies arbitraires, pipeline de streaming complet, bus distribué, éditeur de gameplay universel. Aucun n'est requis pour les corrections ci-dessus.

## Organisation avec les modèles et Codex

Ces conseils sont une proposition de travail pour ce projet, pas un classement officiel des modèles ni une estimation de leurs tarifs/quotas.

### Répartition simple

| Rôle | Qui, avec vos noms de travail | Mission |
|---|---|---|
| Produit et validation visuelle | Tristan | Intentions, arbitrages, sensation de jeu, acceptation réelle |
| Discussion/conception | ChatGPT en chat, Sol ou Astra | Comparer les options ; produire une décision courte, pas un roman à implémenter |
| Implémentation courante | Terra en premier essai | Tranche bornée, existant cité, invariants définis |
| Petit correctif mécanique | Luna si elle donne satisfaction sur vos cas | Modification locale sans invention de règle ni migration sensible |
| Review difficile / blocage | Sol ou Astra | Temps, concurrence, frontières de données, diagnostic transversal |

Le modèle plus coûteux doit surtout intervenir là où une erreur serait coûteuse à découvrir. Ce n'est pas obligatoirement celui qui écrit le plus de lignes. Si deux tentatives ciblées échouent, passer à un diagnostic avec les faits déjà recueillis, pas demander « réessaie plus fort » dans une boucle.

### Un écrivain, des responsabilités claires

Un seul agent modifie le checkout courant à la fois. Un autre peut relire, ou travailler sur une branche/worktree indépendante si les tâches sont vraiment disjointes. Les worktrees isolent les fichiers Git, **pas les ports, les bases et les serveurs de dev**. La documentation officielle décrit leur usage pour travailler en parallèle : [Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees).

Ne pas faire commenter le même patch par trois modèles systématiquement. Review indépendante pour une migration ou le temps métier ; contrôle léger pour un texte ou un matériau.

### Quatre documents, quatre usages

- `AGENTS.md` court, à créer séparément si validé : règles de travail, base de test obligatoire, commandes permises, critères de livraison, pas de commit sans demande. Aucun fichier de ce nom trouvé dans l'inventaire courant du repo. Codex charge ces instructions au démarrage : [documentation officielle](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
- `docs/architecture/*` : règles actuelles validées. Une règle n'a qu'un emplacement autoritaire.
- Le brief de Sol : intentions et idées, explicitement distinctes des engagements.
- `SESSION-HANDOFF.md` : état actuel, travail restant, fichiers touchés, validation réellement exécutée. Une page de reprise en tête ; Git conserve l'histoire, le handoff n'a pas à devenir une seconde conversation infinie.

Ce document de revue ne remplace aucun de ces documents et n'autorise pas une implémentation automatique.

### Brief de tranche réutilisable

```text
But joueur : [comportement observable].
Référence : [spec + fichiers de départ].
À préserver : [2 à 4 invariants].
Hors scope : [ce qu'il est tentant d'ajouter].
Livrable : [un parcours court / résultat].
Validation : [tests ciblés autorisés ; UX manuelle par Tristan].
Si une règle manque : demande-moi, ne l'invente pas.
Fin : diff résumé, commandes terminées + résultat réel, reste à vérifier.
Pas de commit/push sans demande.
```

Une commande lancée n'est pas une commande réussie. Un build vert ne montre pas que la scène est visible. Une validation manuelle n'est pas une preuve de verrouillage concurrent. Demander la bonne preuve à chaque tranche économise du temps sans sacrifier les choses importantes.

### Git, sans cérémonial

Une tranche acceptée mérite un commit lisible, après revue du diff. Ne pas laisser cinq tranches hétérogènes s'accumuler sous un futur `fix stuff`. Le worktree actuel contient beaucoup de modifications et de nouveaux fichiers : demander un checkpoint propre avant de repartir sur plusieurs métiers. Ne pas faire `git add .` aveuglément lorsque tu modifies aussi le code.

### TristanGPT : où reprendre la main

Tu n'as pas besoin de réapprendre vingt ans de frameworks avant de contribuer. Ton expérience Lua et console t'a déjà familiarisé avec états, déclencheurs et conséquences temporelles ; ici il faut surtout distinguer une prévisualisation locale d'une décision persistante du serveur.

Bonnes premières micro-tranches :

1. Ajuster une notification ou un menu React, avec les conditions d'affichage expliquées.
2. Extraire puis régler une palette ou une recette Scierie, sans toucher au gameplay.
3. Écrire une petite fonction pure : format de durée, arrondi d'affichage, voisinage torique ; faire expliquer entrée/sortie et cas limite.
4. Fabriquer une pièce Blender réutilisable, après avoir fixé échelle, pivot et emprise avec le runtime.
5. Définir un cas d'acceptation métier concret ; laisser l'agent le traduire en test PostgreSQL lorsque nécessaire.

À apprendre en priorité : lire un diff Git ; objets/tableaux/fonctions TypeScript ; `async/await` ; état React ; transaction SQL et contrainte unique. Pas besoin de maîtriser Rust, Kubernetes et les shaders simultanément.

Pour apprendre avec l'agent : « montre-moi le fichier, explique ce bloc, laisse-moi modifier, puis relis mon diff ». Tu gardes un vrai geste de développeur, au lieu d'être réduit à donner le prochain prompt.

## Limites et questions produit restantes

- Les catalogues doivent-ils rester communs aux mondes ou chaque monde figera-t-il son ruleset économique ? L'identité mondiale est isolée, les paramètres ne le sont pas encore.
- Pendant une amélioration verticale, le bâtiment doit-il continuer à étendre le rayon constructible ? La production ancienne continue, mais les candidats actuels filtrent les bâtiments `completed`. À trancher, pas corriger au jugé.
- Quand le combat arrivera, garde-t-on quatre archétypes pour la première intégration ou exige-t-on immédiatement N types ? La réponse fixe une grande partie du coût de reprise du Rust.

Les guides PostgreSQL ont servi à contrôler la distinction entre attribution de tâche et sérialisation métier ; OpenAI Docs a servi uniquement aux recommandations documentées sur AGENTS.md et les worktrees. Aucune configuration n'a été changée par leur utilisation.
