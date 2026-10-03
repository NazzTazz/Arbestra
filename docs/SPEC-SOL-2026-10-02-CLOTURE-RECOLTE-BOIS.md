# Passation GPT-6.1-Sol — clôture visuelle, première récolte, coupe de bois

Date : 2 octobre 2026. Base relue : `main`, HEAD `0a0873a`, avec une importante tranche non commitée. Destinataire : GPT-6.1-Sol, un seul agent ; aucune délégation demandée.

**Statut : B1 et B2 implémentées dans le worktree, recette humaine à faire.** La clôture graphique reste à valider sur l'existant. L'ordre et les règles B2 ci-dessous ont été arbitrés avec Tristan ; « implémente la spec » autorise leur réalisation. Aucun commit/push autorisé.

**Arbitrages B2 fermés le 2 octobre 2026.** Tristan valide la portée de 8 cases et le défrichage pendant des missions, avec conservation des lots déjà réservés. Défrichage public, instantané, sans gain, à ≤10 % ; les missions existantes se terminent normalement. Il autorise ensuite les tests ciblés et exclut les e2e pour l'instant ; la suite complète attendra l'avant-commit. Les seules décisions produit n'autorisaient pas une migration : l'instruction d'implémentation couvre désormais la migration additive nécessaire à la recette locale.

### Reprise Sol — 2 octobre 2026 (historique, avant les arbitrages suivants)

Tristan a lancé la reprise (« allons y »). B1 est implémenté dans le worktree, à valider : insertion transactionnelle `first-harvest`, page du journal et notification sur nouvelle entrée. Compatibilité sans backfill annoncée ; aucune migration nécessaire. Restriction sans tests conservée, aucune preuve d'exécution revendiquée. B2 reste en cadrage : Tristan souhaite modifier les règles proposées et une question ouverte lui demande les changements ; aucune règle de la section 5 n'est considérée approuvée.

Inventaire de livraison A : (1) API terrain/aperçus/villages, contrats terrain et branchements ; (2) rendu streaming/LOD/caméras/cosmologie/météo/routes/braseros et UI ; (3) preuves ciblées déjà présentes et documents de référence. Ces groupes ont des dépendances : ne pas prétendre que chaque groupe peut être livré indépendamment sans vérifier ses imports. B1 ajoute seulement garden-harvest.ts et les branches UI/docs correspondantes. Les scripts de calibration/déménagement demandent une décision d'inclusion comme outils locaux ; l'export `codex-session-01a07944-0d99-7ab3-9983-b16b69419275.md` et les sauvegardes/captures ne font pas partie du produit. Lot A reste à valider sur le parcours humain des transitions ; aucun commit préparé dans l'index ni push autorisé à cette reprise.

## 1. Mission et décisions acquises

Ordre accepté par Tristan : finir et livrer proprement le lot graphique actuel, puis compléter la première récolte et ajouter la coupe de bois. Ne pas ouvrir marché, TRY, population/humeur, combat ou effets agricoles de la météo dans cette tranche.

- Le temps est central : allonger un trajet allonge uniquement le transport, jamais le travail sur place. Vitesse provisoire actuelle : une seconde par case ; chemins orthogonaux, détours possibles.
- Jardin : récoltes par parcelle, fusion et agrandissement déjà implémentés. Ne pas les réécrire.
- La première récolte récompense par les carottes effectivement récoltées, sans bonus économique supplémentaire.
- Pierre et bois sont deux découvertes parallèles, sans obligation de terminer l'une pour essayer l'autre.
- La coupe de bois doit être une activité distincte de la production passive de la scierie et permettre de dégager le terrain.
- Les cohortes sont les entités simulées ; les personnages Babylon restent des représentants visuels.
- Recette visuelle interactive par Tristan. Instruction courante : **tests ciblés autorisés, aucun e2e pour l'instant** ; suite complète avant commit. Cette instruction remplace la restriction historique sans tests.

## 2. Reprise et existant vérifié

Lire `AGENTS.md`, la tête de `SESSION-HANDOFF.md`, cette spec et les documents concernés dans `docs/architecture/README.md`. Commencer par `git status --short` et le dernier commit ; les nombreux changements présents ne constituent pas un diff jetable.

| Domaine | Points d'entrée existants |
|---|---|
| Récolte serveur | `apps/api/src/modules/population/garden-harvest.ts` : `startGardenHarvest`, `completeGardenHarvestAt` |
| Temps et transitions | `apps/api/src/modules/villages/reconcile-economy.ts` : borne après verrou village, réconciliation ordonnée |
| Affectation des travailleurs | `apps/api/src/modules/population/work.ts` |
| Extraction de pierre | `apps/api/src/modules/deposits/stone-extractions.ts` : réservations, travailleurs, portée/protection et échéances ; référence à lire, pas abstraction générique à imposer |
| Accomplissements | `villageAccomplishments`, snapshot dans `villages/service.ts`, schéma extensible par code dans `packages/contracts/src/villages.ts` |
| Journal | `apps/world-web/src/ui/OracleJournal.tsx`, orchestration dans `App.tsx` ; coffre et `cat-eyes` existent |
| Terrain et arbres | `worldFeatures`, génération `woodland` dans `worlds/generation.ts`, streaming et aperçu dans `worlds/terrain*.ts` |
| Rendu | `BabylonVillageScene.ts`, `village-roads.ts`, `terrain-renderer.ts`, `terrain-overview-view.ts` |

Aucun système d'exploitation des bosquets équivalent aux gisements de pierre n'a été identifié dans les modules relus. Ne pas assimiler une feature graphique à un stock exploitable déjà livré.

Références produit : [direction produit](DIRECTION-PRODUIT.md), [Jardins](SPEC-JARDINS-PARCELLES-FUSION.md), [coffre et journal](SPEC-COFFRE-JOURNAL-ORACLE.md). La direction produit contient des tableaux historiques : le code actuel prévaut pour l'existant.

## 3. Lot A — clôturer le monde et le village actuels

### Résultat attendu

Un état de livraison identifié, avec limites connues et un parcours visuel accepté. Ne pas recommencer la cosmologie ou empiler une nouvelle architecture de caméra.

Le worktree contient streaming, Village/Région/Monde, tore et soleil, météo visuelle, quête du Chat, cinématique d'arrivée, survol V, raccourci C, routes/braseros, corrections des jardins et déménagement local. Les specs des vues et de cosmologie restent les références de ces systèmes.

Dernier retour humain : grille parasite disparue ; après correction terre/jardins, Tristan dit « C'est beaucoup mieux ». Cela valide une amélioration, pas une absence universelle de défauts.

### Travail minimal

1. Inventorier le diff par sous-lot et identifier fichiers livrables, documentation et artefacts locaux. Ne pas embarquer l'export brut de session ni les captures/sauvegardes dans un commit global.
2. Poursuivre la recette humaine avec un parcours court : zoom/rotation du village, départ/retour Jardin et pierre, Village → Région → Monde → même lieu, puis retour « Mon village ». V/C seulement pour leurs comportements spécifiques. Préserver ciblage, orientation, phase locale et reprise des contrôles.
3. Examiner les régressions restantes et les corriger dans leur couche responsable. Pas de refonte préventive. Distinguer scintillement de texture, conflit de profondeur et reconstruction de mesh.
4. Consolider les preuves existantes sans les présenter comme des tests de l'état final. Les mesures de performance historiques ne prouvent pas le coût de toutes les retouches suivantes. Si la restriction sans tests demeure, déclarer la clôture technique à valider et poursuivre les travaux indépendants.
5. Mettre à jour le handoff et les seules références affectées. Préparer un découpage de commits compréhensible ; commit/push uniquement sur autorisation couvrant cette livraison.

### Précautions spécifiques à cette reprise

- Clairière est désormais à `(1102,21)` dans aube. Les bâtiments et parcelles sont conservés, le paysage a changé. `scripts/relocate-village.ts` est un outil one-off : ne pas le rejouer, ne pas migrer ces données locales vers les autres installations.
- Plaques constructibles invisibles hors construction ; le fondu LOD préserve leur opacité de base.
- Jardins : surface unique relative au terrain, suppression de la face de socle concurrente, filtrage trilinéaire. Terre : +0,012 au-dessus de chaque case, géométrie conservée si le streamer ne change pas ses données utiles.
- Ne pas modifier les vitesses de debug/cinématiques pour corriger une durée économique.

## 4. Lot B1 — première récolte dans le journal

### Expérience visée

À la première récolte positive terminée, le joueur retrouve un accomplissement « Première récolte » dans le Grimoire et reçoit un retour bref de l'Oracle. Les seules ressources reçues sont celles de la récolte normale. Pas de nouvelle modale obligatoire ni de quête révélant le coffre avant sa découverte.

### Proposition technique minimale

- Code d'accomplissement proposé : `first-harvest` ; libellé et texte Oracle ajustables sans changer le mécanisme.
- Insérer l'accomplissement dans la transaction qui finalise et crédite effectivement une récolte positive, dans `completeGardenHarvestAt` ou son point de crédit réel après relecture. Ni au départ, ni à l'animation, ni à la consultation du jardin.
- Utiliser l'unicité existante monde/village/code, insertion sans duplication. Date = échéance effective de la transition traitée, pas heure d'affichage navigateur.
- Récoltes simultanées, retries, worker et lecture réconciliatrice doivent produire un seul accomplissement. Toute erreur de transaction annule ensemble crédit et accomplissement.
- Réutiliser snapshot et journal existants. L'interface observe une nouvelle entrée comme pour les accomplissements existants ; un F5 conserve l'entrée sans rejouer systématiquement la célébration.
- Aucun moteur générique de quêtes, aucune nouvelle route « valider ma récolte », aucune migration si le schéma actuel suffit.

### Compatibilité proposée, à annoncer avant implémentation

Pas de backfill déduit des stocks : les carottes peuvent venir du coffre. Pour un village ayant déjà récolté, la prochaine récolte positive terminée après livraison déclenche l'entrée. Si Tristan souhaite dater rétroactivement l'accomplissement depuis l'historique, traiter cette variante explicitement avant toute écriture de rattrapage.

Le jardin initial rempli au tiers reste une intention du parcours d'accueil. Ne pas modifier les stocks de villages existants ; ne pas introduire discrètement un nouveau seed/spawn dans B1. Un ajustement du spawn est une petite tranche séparée après relecture du spawn réel.

### Acceptation

Récolte positive → crédit normal et une entrée ; double finalisation → aucun double crédit/entrée ; monde/village étrangers → aucune mutation ; F5 → entrée conservée. Une récolte nulle ne valide pas l'étape. Tests DB ciblés souhaités lorsque permis, recette humaine d'une récolte et du journal.

## 5. Lot B2 — coupe de bois : arbitrages indispensables

Les valeurs suivantes ont été **validées successivement par Tristan**, au-delà du seul accord initial sur l'ordre de la roadmap. Les paragraphes historiques de reprise décrivent les étapes d'arbitrage, pas des restrictions encore ouvertes.

| Décision | Recommandation pour la première tranche |
|---|---|
| Cible et épuisement | Un bosquet = une feature exploitable persistante et renouvelable. Décision Tristan : case pouvant être reclaimed à partir de 90 % d'épuisement, donc stock restant ≤ 10 % du stock initial. Le stock initial est la référence fixe ; les coupes cumulées ne suffisent pas si le stock a repoussé. Aucun arbre décoratif persistant individuel. |
| Régénération | Décision Tristan : chaque bosquet possède un coefficient de repousse de base persisté lors de la création du monde. Référence retenue : retour de 0 à 100 % en deux semaines réelles (14 jours / 336 h). Ce coefficient n'existe pas encore dans le code/schema relu ; ajouter aussi une initialisation conservatrice des bosquets existants. Formule précise et dispersion entre bosquets restent à cadrer. |
| Lot et temps | Validé par Tristan pour cette première tranche : 100 bois par mission, 10 minutes de travail divisées par 1 à 10 travailleurs ; dernier lot plafonné au restant disponible. Transport ajouté séparément, selon les règles actuelles. Réglage provisoire avant une future passe métier globale sur toutes les missions. |
| Réserve initiale | Réglage de la proposition missions accepté : 300 bois par bosquet, indépendant du nombre de meshes décoratifs, centralisé côté serveur. La future passe métier pourra revoir cette valeur. |
| Accès | Validé : portée torique de 8 cases depuis une emprise terminée ; mêmes protections de clairières que la pierre, sans sa règle de front de taille. Aucun niveau de scierie requis dans cette première tranche. |
| Travail simultané | Validé : une mission active par village et par bosquet. Plusieurs villages peuvent travailler sur le même bosquet ; chaque mission réserve son lot dans la transaction serveur sous verrou du bosquet. Refuser une deuxième mission active du même village sur cette cible et tout lot dépassant le stock disponible non réservé. |
| Scierie | Sa production passive actuelle reste inchangée ; ne pas supprimer une source de revenus existante sous couvert d'ajouter la coupe. |

Si une recommandation est refusée, actualiser cette section avant les mutations dépendantes. La validation de B1 et la clôture graphique ne dépendent pas de ces réponses.

Décision Tristan : libération automatique à stock courant ≤10 % du stock initial, repousse tant que la case reste inutilisée, et option de défrichage explicite. Le bosquet n'est pas supprimé lors de la seule libération de l'occupation. Défrichage validé : instantané, sans gain de bois, disponible seulement à ≤10 %, arrêt durable de repousse ; case inutilisée rebloquée si repousse >10 %. Les futures voies inter-villages pourront nécessiter la coupe/défrichage : intention validée pour préserver cette possibilité, pas un système de routes inter-villages à implémenter ici. Stock, missions et concurrence ont été acceptés séparément ; portée de 8 cases encore proposée. La future passe métier globale ne demande aucun moteur générique de missions dans cette tranche.

Conséquences techniques à préserver : garder le bosquet identifiable même sans occupation de case ; les lectures des ressources ne doivent plus dépendre exclusivement du join des occupations. Une construction/réservation autorisée sur une case libérée doit, dans sa transaction et sous verrou de la ressource, arrêter la repousse et empêcher le retour d'un obstacle sous le bâtiment. Une case inutilisée redevient bloquée quand la repousse porte le stock au-dessus de 10 % ; stock initial et maximum demeurent fixes. La borne de calcul du stock, la libération/réoccupation et la décision de construction doivent être cohérentes après verrou ; ne pas décider avec une valeur périmée du snapshot. Réservation de bois n'est pas coupe : le seuil de libération dépend du stock physique restant après coupe, pas du seul stock disponible moins les lots réservés. Ne pas défricher/supprimer les droits de missions déjà réservées par d'autres villages ; leur articulation avec reclaim/construction reste à préciser avant ces mutations.

### Parcours missions futur — direction retenue, hors B2

Tristan souhaite ensuite sélectionner par swipe/drag plusieurs parcelles de bosquets, choisir une durée d'exploitation et laisser les habitants organiser des rotations d'équipes. Chaque lot coupé donnera lieu à un transport visible vers le village. B2 conserve les missions unitaires actuelles : pas de sélection multibosquets, de planificateur de rotations ou de durée choisie à implémenter maintenant. Conserver une identité de mission et des réservations explicites ; ne pas assimiler un bosquet à une unique mission mondiale ni une animation à un crédit. La future tranche décidera les échéances par lot, le nombre d'équipes et l'organisation des transports ; ne pas les figer en extensions préventives du schéma actuel.

### Propriété des cases et droit de défrichage — décision Tristan

N'importe quel joueur peut défricher une case éligible ; ne pas réserver la commande au propriétaire de la case et ne pas imposer l'attente de toutes les missions actives comme condition produit. Le propriétaire de la case est le village dont l'hôtel de ville est le plus proche, dans le même monde et en respectant les coutures toriques. Cette règle est une cible nouvelle, pas une propriété déjà présente dans `worldCellOccupancies` : les occupations existantes identifient bâtiments/features, pas une partition territoriale mondiale.

Différé à la tranche territoriale : métrique de proximité et traitement des égalités. La portée de coupe est fixée à 8 cases, la construction reste bornée à la grille historique. Défrichage pendant mission : supprimer la végétation résiduelle et arrêter la repousse, mais honorer les lots déjà réservés sans crédit anticipé ni annulation des affectations. Ne pas permettre à la commande de défrichage de modifier/verrouiller les villages étrangers après le verrou du bosquet. Définir les stocks physique/réservé et le seuil de 10 % de sorte que les réservations ne soient ni détruites ni comptées comme coupe avant son échéance.

Confirmation suivante : honorer les lots réservés pendant/après le défrichage est validé. Conserver le bois engagé dans les missions jusqu'à leur livraison ; supprimer uniquement le reliquat non engagé et arrêter toute repousse. Le seuil de défrichage reste calculé sur le stock physique, réservations incluses, afin qu'une réservation seule ne rende jamais un bosquet défrichable. La première tranche utilise le coefficient neutre de référence (0 →100 % en 14 jours) et une repousse linéaire ; variations entre bosquets et modulations environnementales restent des extensions ultérieures.

Décision suivante de Tristan : les cases hors du périmètre historique de la grille-village restent non constructibles pour cette tranche. Reclaim/défrichage retire un obstacle ; il n'étend ni le périmètre exposé ni l'autorisation serveur de construction. Conserver les règles actuelles d'emprise, rayon, terrain, protection et occupation. L'extension de construction à des cases extérieures sera arbitrée plus tard. La propriété par hôtel de ville le plus proche ne constitue pas une autorisation de construction et n'exige pas une partition persistante de tout le monde dans B2. Métrique/égalité territoriales peuvent rester différées tant qu'aucune commande de cette tranche n'en dépend.

### Extension future validée : météo et ensoleillement

Tristan rappelle que la météo et l'ensoleillement devront à terme agir sur les gisements renouvelables et leur repousse. Distinguer le coefficient de base propre au bosquet (persisté à la génération) du taux effectif dépendant des conditions du lieu et du temps. Pour cette tranche, modulateur environnemental neutre : aucun effet économique de la météo/soleil à ajouter maintenant. La référence de 14 jours n'est pas une durée universelle immuable lorsque ces effets seront introduits.

Le calcul serveur devra pouvoir évoluer d'un taux constant à l'intégration d'un taux variable sur l'intervalle depuis le curseur. Ne pas appliquer rétroactivement la seule météo du moment à toute la période écoulée. Conserver les restes fractionnaires et le curseur de repousse, un plafond de stock et des calculs déterministes respectant le temps serveur. Les shaders et représentations météo accélérées/debug ne sont pas l'autorité économique. Aucun historique météo, scheduler climatique ou nouvelle infrastructure n'est demandé dans B2 ; règles, amplitudes et méthode d'intégration environnementale seront spécifiées dans une tranche ultérieure.

## 6. Lot B2 — contrat de réalisation après arbitrage

### Parcours joueur

Cliquer un bosquet ouvre des détails serveur : stock, disponibilité, travailleurs éligibles, durée de travail et durée de transport distinctes. Lancer « Couper du bois » réserve ce qui doit l'être et affecte les cohortes. Des représentants quittent la porte de l'hôtel de ville et suivent le trajet ; l'affichage ne crédite rien. Au retour selon la règle temporelle existante, le serveur crédite le bois une seule fois et libère les travailleurs. Sol doit vérifier le point exact de crédit actuel de la pierre avant de reprendre son comportement.

À stock restant ≤ 10 % du stock initial, l'occupation est libérée automatiquement. Le bosquet reste identifiable et renouvelable tant que la case est inutilisée, ou jusqu'au défrichage explicite. Une case libérée peut devenir constructible si toutes les autres conditions sont remplies ; refléter le stock, l'occupation et la végétation dans les chunks et aperçus. Ne pas convertir automatiquement un sol rocheux en prairie : retirer le bosquet ne change pas le code du terrain.

### Modifications minimales

- Contrats JSON dédiés dans `packages/contracts`, détails et commande authentifiée bornés au monde/village. Noms de fichiers/routes laissés à Sol ; reprendre les conventions pierre sans renommer tous les modules en « ressources génériques ».
- État persistant du stock et de sa réservation, révision, mission avec chemin/délais/affectation, via migration additive conservatrice. La génération d'un monde neuf et les bosquets déjà présents doivent être couverts sans reset ni nouvelle seed globale.
- Garder l'identité du bosquet et son coefficient de repousse ; distinguer stock faible/nul, repousse et état reclaimed. Une régénération par seed/cache ne doit pas recréer une occupation supprimée. La disparition visuelle seule ne libère pas l'occupation métier.
- Ajouter la transition à la réconciliation et au worker existants. Préserver l'ordre global échéance/ID/type avec Jardin, pierre, construction et production ; ne pas traiter toutes les coupes en bloc après le reste.
- Verrou village avant verrous de ressources, borne lue après acquisition. Définir un ordre global explicite pierre/bois et IDs pour toutes les ressources dues avant toute mutation ; ne pas ajouter un verrou de bosquet au milieu d'une réconciliation déjà engagée sur la pierre sans analyser les entrelacements.
- Affectation via `population/work.ts` ; repas/repos et éligibilité restent cohérents avec détails et commande. Aucune simulation individuelle.
- Réutiliser routes orthogonales, transport et personnages existants. Prolonger uniquement les unions de contrats et branches nécessaires ; pas de nouveau système de navigation.
- Propager la révision/disparition vers détails, chunks et couverture végétale région/monde. Réemployer la fraîcheur bornée existante ; ne pas invalider/retransférer tout le terrain immutable à chaque coupe.
- Une entrée de découverte du bois peut accompagner la première mission positive terminée, sur le modèle B1. Ne pas implémenter en même temps les quêtes d'accueil/humeur. L'accomplissement pierre parallèle doit être cadré comme un petit ajout distinct si absent, pas comme prérequis à la coupe.

### Invariants et preuves attendues

- Pas de stock négatif, sur-réservation, double crédit ou travailleur affecté deux fois ; la scierie conserve ses crédits et restes de production.
- Dernier lot et épuisement exact ; case libérée uniquement quand le serveur le décide ; aucun accès aux bosquets protégés/étrangers.
- Retry après réponse perdue et finalisation concurrente n'ajoutent pas une seconde mission/crédit. Refus cohérent si ce village a déjà une mission sur ce bosquet ou si le stock non réservé est insuffisant, avec état frais retourné/relu. Deux villages peuvent réserver des lots distincts ; leurs finalisations ne détruisent ni les réservations ni les affectations de l'autre.
- Rollback injecté après mutations réelles : mission, stock, réservation, cohortes, ressources et accomplissement reviennent ensemble à l'état initial.
- Échéances Jardin/pierre/bois entrelacées et concurrence sur bosquet : preuves DB avec barrières bornées quand les tests sont autorisés. Pas de deux suites réinitialisant la même base en parallèle.
- Recette humaine : lancer une coupe, observer sortie/retour, épuiser le bosquet, constater sa disparition puis essayer la construction si le terrain est éligible ; déplacement/zoom pendant la mission, F5 et retour au lieu.

## 7. Livraison et budget de vérification

### Réalisation au 2 octobre 2026

B1/B2 sont dans le worktree. Migration 017 appliquée sur test puis développement local sans reset ; détail des preuves courantes dans le [handoff](../SESSION-HANDOFF.md). État renouvelable dans `woodland_deposits`, extraction/cohortes/worker existants étendus par `resource_code`, vue `resource_deposits` uniquement en lecture. Détails et départ réutilisent les routes `/features/:featureId` et `/features/:featureId/extractions`, avec une commande `POST /features/:featureId/clear`. Les contrats distinguent bois/pierre et exposent `blocksCell`, l'éligibilité au défrichage et le transport séparé. Journal `first-harvest` et `first-woodcut` sans bonus économique. Recette visuelle encore à faire ; aucun e2e ni commit.

Ne pas faire payer une campagne E2E complète à chaque changement visuel. Privilégier relecture, quelques preuves ciblées pour les mutations économiques lorsqu'autorisées et recette interactive. Donner séparément ce qui a été lu, exécuté, observé par Tristan et ce qui reste à prouver. Aucun chiffre de tests historique réutilisé comme résultat courant.

Une migration test ne vaut pas autorisation d'appliquer au développement ; vérifier la couverture de la demande avant application. Ne jamais réinitialiser la base de développement. Ne pas committer `.env`, exports de conversation ou sauvegardes locales.

À chaque clôture : état Git réel, périmètre exact, preuves et réserves, prochain geste concret. Aucun besoin d'une revue par un deuxième agent par défaut.

## 8. Prompt de reprise à transmettre

> Lis AGENTS.md, la tête de SESSION-HANDOFF.md et docs/SPEC-SOL-2026-10-02-CLOTURE-RECOLTE-BOIS.md. B1/B2 sont implémentées et la migration locale est appliquée. Préserve le worktree existant ; continue la recette avec Tristan sans refaire le moteur de monde ou l'audit cosmologique. Tests ciblés autorisés, aucun e2e pour l'instant, suite générale avant commit. Ne rouvre pas les arbitrages bois validés. Distingue preuve métier et recette visuelle encore à faire. Ne lance pas de sous-agents. Aucun commit/push autorisé à cette étape.
