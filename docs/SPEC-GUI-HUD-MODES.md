# Récolte par intention — décision du 10 octobre 2026

Cette décision de Tristan remplace, pour le parcours courant de récolte, les prescriptions historiques ci-dessous imposant une estimation Auto affichée avant envoi.

- En mode Exploitation, clic gauche maintenu + balayage désigne les ressources. Le simple survol et les mouvements de caméra ne sélectionnent rien. Le relâchement transmet le geste sans formulaire ni confirmation d'effectif.
- Le client transmet uniquement les cibles et une identité idempotente. Le serveur reçoit durablement les demandes, les valide puis les regroupe dans les chantiers automatiques compatibles. Il choisit les équipes avec les règles d'énergie, de portée et de trajets existantes. Les lots déjà engagés conservent leur équipe et leur échéance.
- La réception de la demande ne doit pas attendre le verrou économique du village. Le worker existant traite les demandes ; une demande encore à traiter reste signalée discrètement sur le terrain. Les demandes reçues et leurs résultats survivent à la reconnexion. Une retransmission conserve la même identité.
- Après validation, un bref « +quantité » flotte au-dessus de la ressource : vert pour les Jardins, marron clair pour le bois, gris clair pour la pierre, contour noir de 1 px. Cette quantité désigne l'objectif confié à la récolte, jamais un crédit immédiat. Les stocks augmentent au retour des habitants.
- Un refus apparaît brièvement au-dessus de la cible, sans long récapitulatif dans le HUD. Les autres cibles admissibles peuvent être retenues. Un doublon déjà prévu ne crée pas de deuxième mission.
- Le HUD courant conserve les filtres Tout/Jardins/Bois/Pierre et un accès aux chantiers. Les plafonds, cohortes et durées ne sont plus demandés pour ce geste. Le balayage coupe le bois avec repousse ; il ne défriche pas définitivement.
- Échap annule le balayage non envoyé. Les intentions déjà reçues restent suivies ; les commandes de chantier existantes permettent d'arrêter le travail. Un ancien ordre envoyé dont le résultat était incertain conserve son chemin de vérification idempotent.

**Statut : direction produit validée ; implémentation et preuves suivies dans SESSION-HANDOFF.md.** La vitesse de réception et celle de validation/départ doivent être mesurées séparément.

---

# HUD principal et grammaire des actions dans le monde

**Prototype Marché du 6 octobre :** clic ordinaire sur l’hôtel de ville en Exploitation ouvre sa fiche et le marché. Au niveau 1, bouton d’amélioration avec coût 500 bois d’œuvre + 120 pierres taillées ; au niveau 2 achevé, choix des ressources et de la quantité, devis Oracle serveur, confirmation et suivi des livraisons. Les cinq ressources sont issues du catalogue négociable. Solde des Anneaux affiché à zéro, usages monétaires futurs. Formulaire provisoire explicitement demandé ; présentation et UX finales restent à Tristan. [Spec Marché](SPEC-MARCHE-ORACLE.md).

**Ajustement validé le 6 octobre :** Construire → Habitat montre directement Maison en troncs, Maison en madriers et Maison en pierre dans le showroom. Chaque modèle a sa miniature et son coût ; son clic choisit simultanément la recette et la variante. Le sélecteur préalable de matériau est supprimé. Troncs : 25 bois bruts ; madriers : 25 bois d’œuvre ; pierre : 25 bois d’œuvre + 10 pierres taillées. Voir le [catalogue](architecture/building-catalog.md) pour les améliorations.

**Infrastructure implémentée dans le worktree, recette en cours :** [Infrastructure, voirie et atelier](SPEC-INFRASTRUCTURE-VOIRIE-ATELIER.md) définit les routes et bordures, braseros éditables, accès factory, rotation R et commandes immédiates. Ses gestes spécialisés (clic droit des routes / équipements) et son périmètre priment sur les propositions historiques ci-dessous. Voir le handoff pour les validations actuelles ; les anciennes mentions « à venir » décrivent la livraison HUD précédente.

## Ajustements interactifs du 4 octobre — prioritaires sur la disposition historique

**Complément implémenté :** un réglage activé dans le drawer DEV expose dans chacun des showrooms Bâtiments et Infrastructure une entrée supplémentaire « Créer un bâtiment », ouvrant l'atelier correspondant. Il s'agit d'un lanceur sans coût ni placement, disponible sur le serveur de développement seulement. Les deux entrées disparaissent lorsque l'option est désactivée. Voir les règles d'accès et de retour dans la [spec Infrastructure](SPEC-INFRASTRUCTURE-VOIRIE-ATELIER.md).

Dernier ajustement validé : Bâtiments/Infrastructure deviennent deux icônes verticales exclusives (maison factory niveau 1 ; carrefour avec brasero). Le bloc ne contient que ces icônes ; devis et erreurs restent visibles dans une fiche séparée. Changer de domaine annule l'outil courant ; les outils Infrastructure restent à venir. Suppression de Masquer les modèles et Quitter. Le showroom utilise désormais un dégradé blanc **15 % gauche → 0 % droite**, sans bordure ni halo, remplaçant les valeurs historiques ci-dessous.

- Recliquer le mode actif replie le HUD : seul ce mode reste visible, ses paramètres sont conservés et son outil monde est suspendu. Recliquer le rouvre. Vue libre démarre repliée ; son ouverture expose Moment visualisé / Temps réel. Coin supérieur droit du sélecteur arrondi. Palette secondaire réduite de 10 px ; bloc Construction et showroom à 142 px de haut.
- Quatre entrées en colonne, à gauche de la palette : **Vue libre**, **Constructions**, **Population**, **Exploitation**. Les anciennes entrées racines Aménagement et Armée ne sont plus affichées.
- Constructions comporte **Bâtiments** et **Infrastructure**. Infrastructure regroupe à terme routes et décoration ; elle reste explicitement « à venir » dans cette tranche. Aucun outil manuel ne remplace les routes/braseros automatiques.
- Construction contextuelle : sélectionner une recette puis viser une emprise de même type prépare son amélioration ; un tracé Jardin commençant sur un Jardin existant prépare son extension. Le point de départ détermine le Jardin, jamais un voisin rencontré ensuite. Les extensions restent limitées aux Jardins, seule capacité spatiale existante. Aucun sélecteur Construire/Améliorer/Étendre. Le devis affiché et la cible sont revalidés avant envoi, puis par le serveur ; un simple clic sans nouvelle parcelle ne lance pas d'extension.
- Les catégories Habitat / Production / Savoir / Administration longent la barre des ressources. Les modèles occupent un showroom séparé à droite : hauteur alignée sur la partie principale du HUD, voile blanc à 18 %, contour bleu clair 2 px, aucun cadre par modèle. Nom au-dessus, modèle en bas, ressources à sa droite. Coût, action contextuelle et erreurs restent dans la palette ; les slogans, invitations à choisir et rappels clavier sont retirés. Les raccourcis eux-mêmes restent utilisables.
- Ressources en barre basse ; DEV à son extrémité droite. Le panneau DEV conserve les contrôles techniques, dont le nouveau Passe-muraille. L'aperçu solaire reste dans Vue libre.
- Bleu nuit : fond principal à 80 %, palette contextuelle à 60 %, bordure claire de 2 px et ombres. Les fiches se placent près de leur ancre sans passer sous la palette ; leur contenu défile si la hauteur disponible est insuffisante.
- Décision de recette du 5 octobre : aucun sélecteur LOD dans le HUD, ni miniature ni accès texte Village/Région/Monde. Navigation par zoom/dézoom ; les contrôles et transitions de caméra existants restent en place.
- Population : sélectionner un représentant immobilise son apparence, sans suspendre le travail serveur. Fiche avec prénom visuel stable, énergie et qualifications de la cohorte, activité et destination. Aucun habitant individuel persistant n'est créé.
- « Voir en POV » suit le trajet du représentant à une hauteur équivalente à 1,70 m à l'échelle des figurants. ZQSD prend la main et passe en marche libre sur le plan, à une case par seconde ; glisser la souris oriente le regard. Les emprises bâties, eau et obstacles de ville bloquent cette marche. Passe-muraille DEV ignore les obstacles, mais conserve le sol et la limite du terrain chargé.
- « Bloquer caméra » suit le représentant de dos en vue village, inclinaison 45°. Échap ou retour explicite retrouve la caméra village au lieu observé. Changer de mode métier ou d'échelle libère le suivi.

Les règles d'exécution, de revalidation serveur et d'annulation ci-dessous restent applicables. Ces ajustements ne modifient aucune économie.

Spécification consolidée le 4 octobre 2026 pour GPT-5.6-Sol. Statut : **corrections de contre-recette implémentées, validation humaine de la finition restante**. Base de travail : branche main, commit 197a8e0 ; état Git et validations courantes dans le [handoff](../SESSION-HANDOFF.md). Les comportements ci-dessous restent le contrat fonctionnel de la tranche.

Les correctifs couvrent factory/ghost, devis d'amélioration, annulation native, consentement au relâchement, Auto, paramètres corrigés après refus, défrichage non persistant et regroupement DEV. Les tests ciblés et la recette navigateur sont détaillés en tête du [handoff](../SESSION-HANDOFF.md), avec leurs limites : ne pas assimiler ces vérifications à une couverture de tous les scénarios ci-dessous. Aménagement et Armée restent inactifs. Aucun correctif ne modifie le périmètre fonctionnel validé.

**La barre prépare. Le monde exécute.** Le joueur règle son intention dans une palette compacte, voit ses conséquences dans le monde, puis exécute par clic ou relâchement. Une rangée de boutons ouvrant des formulaires ne satisfait pas cette spec.

## Autorité et périmètre

Cette version remplace les dispositions antérieures de ce fichier imposant un récapitulatif après chaque swipe et une confirmation ordinaire de construction. Les descriptions historiques du [handoff](../SESSION-HANDOFF.md) ne doivent pas réintroduire ces étapes. Les mécaniques économiques validées restent en vigueur.

| Décision validée | Conséquence pour cette livraison |
|---|---|
| Palette maintenue ouverte, repli manuel | Après succès, conserver l'outil et ses préférences pour répéter l'action ; effacer uniquement le geste terminé. |
| Maximum automatique contextuel | Auto est le défaut ; mémoriser cette stratégie, jamais le nombre calculé pour une ancienne sélection. |
| Exécution au relâchement | Récolte, coupe, extraction et construction ordinaires n'ouvrent aucun formulaire après le geste. |
| Exception de défrichage | L'irréversibilité justifie une confirmation compacte dans la palette, sans modale. |
| Jardins inchangés | Une tournée, un villageois, plusieurs parcelles successives, un seul retour. |
| Deux cas opérationnels obligatoires | Exploitation et Construction utilisent réellement le même shell et la même grammaire. |
| Aménagement spécifié mais non activé | Palette et gestes décrits ici ; routes, braseros et décor actuels conservent leur fonctionnement automatique. |
| Séparation joueur et DEV | Aperçu d'éclairage en Exploration ; laboratoire cosmologique, métriques et visualisations techniques dans le drawer DEV. |

Hors périmètre : nouveau système de métiers, armée, économie, réseau routier éditable, mobilier persistant, matériaux achetables sans recette métier, nouvelles règles de transport, refonte du streamer ou des transitions LOD. Ne pas changer les rythmes de travail pour faire correspondre l'économie à un exemple d'interface.

Les coûts illustratifs de la conversation ne sont pas des barèmes. L'exemple « 7 parcelles, 7 travailleurs » n'autorise pas sept récolteurs : l'interface doit ici afficher une tournée de sept parcelles à **un** villageois.

## Diagnostic de la première passe

L'existant est une base réutilisable, pas une livraison conforme à cette reprise.

| Existant vérifié | Écart à corriger |
|---|---|
| WorldModeBar et world-mode organisent six intentions exclusives et la mémoire entre échelles. | Une famille doit ouvrir une véritable palette d'outils et de paramètres, pas seulement changer quelques boutons. |
| ExploitationToolbar prépare certains paramètres ; collectExploitation ouvre ExploitationRecap au relâchement ; launchMixed nécessite « Lancer ». | Déplacer configuration et récapitulatif vivant dans la palette avant et pendant le geste. Retirer le passage obligatoire par ExploitationRecap. |
| Le geste d'exploitation n'est capturé que si sa première cellule est exploitable. | Un outil actif possède son geste dès le départ sur le terrain, même si la première cellule est vide. |
| ConstructionPanel expose catalogue/coûts, puis « Confirmer » après sélection de l'emprise. | Fournir palette visuelle, ghost fidèle et validation dans le monde. |
| L'ordre mixte possède déjà plafond partagé, échéance, activités enfants, transaction et commandId. | Réutiliser cette coordination ; ne pas la remplacer par des appels indépendants Jardin/bois/pierre. |
| L'aperçu d'exploitation retourne cibles, exclusions, rendements estimés et retour Jardin. | Il n'expose pas encore tout le calcul nécessaire aux maxima/admissions par activité. Cette extension bornée fait partie de la reprise. |
| La factory génère les bâtiments et dispose d'un atelier. | Elle n'est pas déjà un service de miniatures ; ses variantes visuelles ne sont pas toutes des options économiques persistées. |
| Les commandes de construction actuelles n'ont pas le commandId de l'ordre d'exploitation. | Ne pas leur appliquer aveuglément les retries de l'exploitation. Définir leur reprise sûre, comme indiqué plus bas. |
| Plusieurs contrôles techniques restent flottants dans App et VillageScene. | Retirer leurs accès concurrents du HUD joueur et les regrouper dans DEV. |

La cause UX commune est le partage incomplet de l'état d'intention entre barre, geste et ancien panneau de commande : le monde produit un brouillon à administrer ensuite. Cette reprise donne au monde l'exécution d'une intention déjà préparée, avec une seule autorité d'état côté HUD.

## Anatomie du poste de commande

La référence Cities: Skylines porte sur la disposition et la grammaire montrées dans la capture fournie, pas sur son économie ni son style graphique.

De bas en haut, quatre couches :

| Couche | Contenu et comportement |
|---|---|
| Bande d'informations globales | Village actif, stocks importants, population disponible/total, variations utiles et état de connexion discret. Données économiques réelles ; détail au survol ou inspection. |
| Barre permanente des familles | Exploration, Exploitation, Population, Construction, Aménagement, Armée. Position stable, mode actif identifiable, libellés accessibles. |
| Palette contextuelle | Outils, vignettes, réglages et conséquences de l'intention courante. Développée au-dessus de la barre, sans recouvrir le centre de la scène par une fenêtre. |
| Familles internes et paramètres secondaires | Onglets de catalogue et variantes liés à la palette ; « Détailler par activité » se développe dans cette même zone. Pas de panneau indépendant concurrent. |

Le monde conserve la majorité de la surface visible et reste manipulable autour de la palette. Ne pas doubler les mêmes compteurs en haut et en bas. Les notifications et le journal peuvent garder un accès discret distinct ; le bas ne devient pas un dashboard.

Cliquer un mode disponible ouvre sa palette et ferme le contexte du précédent. Recliquer le mode actif ne désarme pas l'outil : un contrôle explicite replie/déplie la palette. Le repli conserve un témoin compact avec nom de l'outil, paramètres essentiels et possibilité de l'arrêter. Un outil armé ne peut devenir invisible.

L'outil reste actif après un succès ; les réglages suivants sont recalculés à partir du nouvel état. Une seule palette métier et une seule fiche d'inspection locale peuvent être ouvertes. Les détails complexes restent possibles dans une fiche/fenêtre ; ils ne conditionnent jamais le geste ordinaire déjà préparé.

Sur une largeur réduite : faire défiler horizontalement les familles/catalogues, compacter les paramètres, garder l'outil actif et sa portée lisibles. Aucun changement de sens du geste. Le tactile doit pouvoir reprendre la même palette, sans dépendre du hover.

## Modes et fonctions conservées

| Mode | Monde et interaction |
|---|---|
| Exploration | Navigation, rendu naturel sans grille métier, recentrage et navigation vers les lieux connus. Aperçu d'éclairage local. Pas de récolte, construction, affectation ni inspection métier par clic dans le monde. |
| Exploitation | Exploitables connus accentués ; outils de prélèvement, swipe mixte, suivi des ordres/chantiers et fiches de ressources. |
| Population | Compteurs cohérents, filtres/cohortes, inspection des représentants et activités ; repos, repas, recherche, formation et expéditions existants. Ne construit ni ne récolte. |
| Construction | Catalogue, damier constructible, placement, amélioration et extension existants. |
| Aménagement | Entrée stable « À venir », non activable dans cette livraison. Son contrat de palette et d'outils est défini plus bas. |
| Armée | Entrée stable « À venir », non activable ; aucun recrutement déduit de l'existence graphique d'une caserne. |

Cliquer une entrée non activable conserve le mode actuel et explique son état. Les connaissances/journal sont consultables transversalement ; une commande scientifique ouvre Population sans lancer automatiquement une recherche.

Les anciennes entrées « Gérer les Jardins », « Chantiers », catalogue et Science deviennent des accès au contexte correspondant, pas des systèmes parallèles. Fouiller/actualiser les réserves d'un bâtiment reste en Exploitation ; l'outil est préparé avant le clic sur le bâtiment. Le cas ponctuel de découverte conserve ses règles serveur et n'est pas ajouté artificiellement au swipe de ressources.

Les fiches restent proches de l'objet, avec ancre mondiale reprojetée et bornage hors des barres. Une fiche peut afficher un état, expliquer une indisponibilité ou ouvrir l'outil pertinent ; elle ne demande pas de ressaisir les paramètres d'un geste. Fermer une fiche ne suspend aucune activité serveur. Un représentant graphique renvoie à sa cohorte/activité ; ne pas créer des habitants persistants individuels.

### Échelles et éclairage joueur

Le mode métier est distinct de l'échelle Village/Région/Monde. Sortir du Village mémorise le mode, annule le geste non envoyé, ferme les fiches locales et impose Exploration. Région vers Monde ne réécrit pas cette mémoire. Revenir au Village restaure le mode et ses préférences, **sans ressusciter une sélection, un ghost en attente ou une confirmation**. Un nouvel événement volontaire dans le monde est nécessaire.

Cliquer depuis Région/Monde un mode métier disponible ramène au village actif, puis ouvre le mode demandé ; ce choix prime sur la mémoire. Un changement de village/monde annule les intentions non envoyées et recharge les capacités du nouveau contexte. Les commandes déjà envoyées restent suivies dans leur contexte d'origine.

Nuages, arrivée et cinématique V suspendent les gestes métier. Cette reprise ne recrée pas la scène Babylon à chaque mode, ne vide pas le cache de terrain et ne change pas l'ancre ou la phase solaire.

L'aperçu d'éclairage reste dans Exploration au Village : curseur sur le cycle combiné de 24 h, libellé local et retour « Temps réel ». L'étiquette « Aperçu » est explicite. Sortir de cette combinaison mode/échelle ou entrer en cinématique revient au temps visuel courant. Aucun appel métier, déplacement d'échéance, observation scientifique, prédiction météo ou changement de récupération ; habitants et météo poursuivent leur état réel.

## État de l'intention et transitions

Le shell porte mode, catégorie, outil, variante éventuelle, paramètres, palette ouverte/repliée et cible inspectée. Le geste porte une identité et un contexte immuables : joueur, monde, village, outil et version des paramètres à son début. Les coordonnées transmises sont canoniques, indépendantes du rebase Babylon.

| État | Événement | Résultat |
|---|---|---|
| Navigation | Choix d'un outil disponible | Outil prêt ; paramètres visibles, preview au survol. |
| Outil prêt | Appui principal dans le monde | Début du geste ; paramètres figés pour ce geste, capture du pointeur. |
| Geste en cours | Déplacement | Sélection/forme et conséquences actualisées ; aucune nouvelle commande économique. |
| Geste en cours | Relâchement valide ordinaire | Intention figée, revalidation puis envoi unique ; aucun formulaire. |
| Geste en cours | Relâchement de défrichage valide | Confirmation exceptionnelle dans la palette ; aucune activité de l'ordre encore lancée. |
| Geste en cours | Annulation ou relâchement hors surface autorisée | Brouillon supprimé ; retour à l'outil prêt. |
| Vérification avant envoi | Données nécessaires manquantes | Garder l'intention figée, indicateur « Vérification… », sans augmenter sa portée ni lancer depuis une réponse périmée. |
| Confirmation exceptionnelle | Confirmer dans la palette | Revalidation et envoi de l'intention exacte. Annuler efface le brouillon. |
| Envoi | Succès serveur | Montrer le résultat accepté ; retirer le brouillon, conserver l'outil et rafraîchir l'aperçu suivant. |
| Envoi | Refus métier certain | État à corriger, sélection conservée et raisons visibles ; aucun sous-lancement. |
| Envoi | Résultat réseau indéterminé | État « Résultat à vérifier » ; conserver identité et payload exacts, ne pas créer une nouvelle intention équivalente. |
| À corriger | Modification des paramètres/cibles | Nouvel aperçu dans la palette ; aucun envoi automatique après correction. |
| À corriger | Nouveau geste ou « Réessayer » explicite | Nouvelle tentative revalidée, selon la certitude sur l'échec précédent. |

Le suivi d'une commande envoyée est indépendant de la palette visible. Changer de mode peut annuler un brouillon ou une vérification non envoyée ; cela ne transforme jamais une commande en vol en commande annulée.

Les confirmations et erreurs sont des états du même outil. Elles ne réintroduisent pas une seconde interface de configuration. Après un refus certain, un bouton compact « Réessayer » est une récupération d'erreur exceptionnelle ; il n'apparaît pas sur le parcours normal.

Un nouveau geste commence une nouvelle sélection, remplaçant un brouillon refusé après son abandon explicite par ce geste. Pour conserver ce brouillon, retirer les cibles signalées depuis sa liste compacte dans la palette, ajuster les réglages puis Réessayer. Une nouvelle sélection ne se cumule pas silencieusement avec les cibles du geste précédent. Une intention au résultat indéterminé doit d'abord être résolue.

## Grammaire des gestes

### Souris et clavier

| Geste | Navigation ou aucun outil armé | Outil spatial armé |
|---|---|---|
| Survol | Information autorisée par le mode | Ghost/highlight, validité, coût/effort estimés ; aucune commande. |
| Clic gauche | Navigation ou inspection permise par le mode | Exécution sur une cible/position à la fin du clic, après revalidation. |
| Glissé gauche | Caméra | Constitution de la sélection ou forme de l'outil ; relâchement exécute. |
| Glissé droit | Pan caméra | Pan caméra sans sélection ni commande ; ne termine pas un geste métier. |
| Espace maintenu et glissé gauche | Navigation caméra | Emprunt temporaire de la caméra pour l'orbite ; outil conservé, aucun geste métier. |
| Molette | Zoom | Zoom ; si un geste est en cours, l'annuler avant le mouvement de caméra. |
| Échap | Fermer le contexte le plus local | Annuler d'abord geste/vérification non envoyée/confirmation ; sinon désarmer l'outil ; ensuite replier la palette. |

Conserver les raccourcis de caméra existants compatibles ; les liaisons ci-dessus garantissent un accès à la caméra même avec un outil actif. Ne pas changer de propriétaire de geste en cours de route : une touche de navigation apparue pendant une sélection l'annule avant d'emprunter la caméra. Aucun menu contextuel navigateur sur le glissé droit dans le canvas.

Un clic est un appui/relâchement sans déplacement significatif, pas un événement click additionnel après pointerup. Seuil initial ajustable : 8 pixels CSS, cohérent avec l'existant. Un seul geste ne doit pas produire à la fois une commande de relâchement et une commande click.

Le début sur une cellule vide appartient quand même à l'outil actif. Le parcours entre deux événements doit être interpolé pour ne pas sauter des cibles en mouvement rapide. Une cible traversée plusieurs fois n'est retenue qu'une fois. L'exploitation collecte les cellules traversées, pas un rectangle englobant arbitraire.

Les contrôles HUD, fiches, champs, focus clavier et drawer consomment leurs événements. Leurs clics ne traversent pas vers le canvas. Relâcher au-dessus du HUD ou hors du canvas annule le geste, même si une capture de pointeur a maintenu sa réception. Perte de capture, pointercancel, changement de mode/échelle/village, onglet masqué ou perte de fenêtre annulent le geste non envoyé. Un pointerup tardif ne peut agir dans le nouveau contexte.

Pendant la capture, les réglages appartiennent au geste commencé. Ils ne changent pas sous un événement asynchrone ; modifier volontairement un paramètre implique d'avoir terminé ou annulé le geste.

### Adaptation tactile

Un doigt avec outil actif sélectionne/place ; sans outil, il navigue. L'arrivée d'un second doigt annule le geste métier avant de permettre pan/zoom/orbite. Relâcher ensuite les doigts ne déclenche aucune commande. Les retours normalement montrés au hover apparaissent pendant l'appui ; aucun outil indispensable ne dépend d'un clic droit. La configuration reste faite dans la barre avant l'appui.

### Preview et sélection

Différencier visuellement survol, sélection retenue, cible indisponible, vérification en cours et action acceptée. Associer couleur et symbole/texte ; un rouge seul n'explique pas « collision » ou « manque de pierre ». Garder la sélection lisible sur le terrain sans peindre toute la carte.

La preview locale réagit immédiatement à la géométrie et aux données connues. Les évaluations serveur sont regroupées/temporisées, jamais lancées à chaque frame ni pour chaque arbre séparément. Leurs réponses portent une identité de contexte et de révision : une réponse d'un ancien village, outil, réglage ou ensemble de cibles est ignorée. La cadence est un réglage de réalisation ; la protection contre les réponses hors ordre est obligatoire.

Une estimation incomplète affiche « Calcul… » ou « estimation », pas un faux zéro ni une durée certaine. Le relâchement peut attendre automatiquement une vérification identique à l'intention figée, **sans demander une seconde validation ordinaire**. Si aucune borne d'effectif ou aucun coût exploitable n'a pu être montré, ne pas engager une quantité nouvelle à l'aveugle : signaler l'indisponibilité de l'aperçu et laisser recommencer une fois prêt.

Correctif du 7 octobre, après contre-recette : **cible validée par Tristan : départ en moins de 1 000 ms après le relâchement**, hors délais voulus par le gameplay. Pour les jardins seuls, le HUD présente la borne structurelle de 1 habitant en Auto et la disponibilité vérifiée au départ. Le relâchement envoie directement une commande portant toutes les parcelles et les paramètres figés ; le serveur vérifie sélection, accès, énergie et disponibilité dans cette même transaction. Aucun aperçu serveur au survol ou pendant un geste exclusivement Jardin. Le plafond manuel reste celui choisi. Aucun crédit anticipé ni raccourcissement des trajets ou travaux.

Les gestes suivants restent distincts et sont conservés dans leur ordre pendant une réponse en cours ; cette protection contre la perte de saisie ne remplace pas la cible de latence. Un refus ou une réponse incertaine suspend la file. Échap annule les gestes non envoyés, y compris pendant un envoi ; changer de mode vide aussi la file. Une commande déjà envoyée conserve son identité et sa résolution. Pour bois/pierre/mixte, l'aperçu reste nécessaire : au plus un appel en cours, puis uniquement la dernière révision encore utile ; la borne présentée ne peut augmenter au départ. Auto sans borne présentée reste refusé. Aucun nouvel aperçu pendant envoi, incertitude ou confirmation de défrichage. Preuves et limites dans le handoff courant.

Correctif du 10 octobre (RC1) : après un relâchement Auto sans effectif présenté, la palette conserve la sélection dans « Estimation en cours » et désactive Réessayer. À réception du résultat, elle affiche « Estimation prête », le plafond calculé et Réessayer. Aucun ordre ne part à cette réception ; Réessayer fige la borne désormais affichée. Un échec de calcul reste une erreur explicite avec possibilité de relancer. La file reste suspendue jusqu’à la reprise ou l’annulation. Cette distinction remplace le message périmé « Aperçu encore en cours » qui subsistait après réception.

La vérification différée ne peut ajouter des cibles, changer d'intention, augmenter le plafond affiché ou accepter un coût supérieur à celui présenté. Une modification substantielle rend l'intention à corriger. Une durée estimée ou une mobilisation initiale moindre que le plafond n'est pas, à elle seule, une nouvelle intention.

## Exploitation opérationnelle

### Palette avant le geste

La palette présente les filtres **Tout, Jardins, Bois, Pierre**, l'intention bois **Couper/Défricher**, l'effort **Auto/plafond manuel**, la condition de fin, la politique d'équipe et le lien **Détailler par activité**. Ne pas afficher de minerai exploitable inexistant.

Réglages initiaux : toutes les familles actuelles, coupe avec repousse, Auto, jusqu'à l'objectif, habitants disponibles automatiquement. L'option de cohorte choisie désigne une équipe initiale, pas une réserve exclusive de futurs remplaçants.

« Détailler par activité » développe les plafonds et durées enfants dans la palette avant le geste. Les limites restent subordonnées au plafond global ; trois formulaires autonomes ne créent pas trois budgets. Les pages de suivi « Jardins »/« Chantiers » restent accessibles pour consulter, suspendre, reprendre ou arrêter les activités déjà engagées, avec leurs règles existantes.

### Maxima et préférences

| Notion | Sens et présentation |
|---|---|
| Population totale | Capacité humaine globale ; ne signifie pas que tous peuvent partir. |
| Disponibles | Habitants sans affectation, avant vérification de leur énergie et de la mission. |
| Maximum structurel de la sélection | Limites des activités concernées : une tournée Jardin à 1, au plus 10 sur le chantier bois et 10 sur le chantier pierre de cet ordre. Plusieurs bosquets ne multiplient pas ce plafond. |
| Maximum mobilisable maintenant | Effectif effectivement admissible avec cette sélection, ses trajets, énergie, cohorte et activités concurrentes. Le serveur fait autorité. |
| Préférence configurée | Auto ou plafond manuel. La durée et les limites par activité sont des préférences distinctes. |
| Plafond de l'ordre | Nombre figé au relâchement, revalidé au lancement. Compte travail et transports ; ne réserve pas une relève. |
| Mobilisation effective | Personnes réellement affectées par le serveur, possiblement moins nombreuses que ce plafond. |

Auto affiche le maximum pertinent pour la sélection actuelle, avec sa répartition estimée. Il ne se calcule pas par la seule formule « minimum de la population et 10 ». Sans cible, afficher Auto et la disponibilité générale, sans promettre une affectation. Jardins seuls : maximum structurel 1, même s'il y a vingt parcelles et cent habitants disponibles.

Une sélection mixte avec trois familles peut structurellement aller jusqu'à 21, mais ce nombre n'est ni un défaut universel ni un effectif garanti. L'énergie nécessaire à toute la tournée Jardin, les trajets et les plafonds détaillés peuvent réduire l'admission. Auto à zéro interdit un lancement opportuniste ; afficher la cause.

Au relâchement, Auto devient le **nombre affiché pour cette intention** : si d'autres habitants se libèrent avant la transaction, ce plafond n'augmente pas. Si certains ne sont plus disponibles, une mobilisation moindre peut être admise sans dépasser ce plafond ; afficher le résultat réel. Si aucune première activité n'est admissible en Auto, refuser et conserver la sélection. Une cible devenue invalide relève toujours du rejet intégral décrit plus bas.

Le plafond manuel reste réglable de 1 à la population totale, sans l'écraser silencieusement au nombre disponible. Afficher par exemple « Plafond 10 · 4 mobilisables maintenant · autres départs selon disponibilité ». Les activités peuvent attendre leur tour dans les règles existantes ; une cohorte initiale devenue invalide est un refus explicite, pas un remplacement silencieux.

Après succès, Auto est recalculé pour le prochain geste ; l'ordre créé conserve son plafond. Ne jamais mémoriser « Auto = 17 ». Conserver pendant la session, par village et outil, le choix Auto/manuellement, le plafond manuel, filtres, durées et détails. Une préférence dépassant une nouvelle borne est montrée comme à ajuster, pas envoyée hors limite. Le choix de défrichage revient à Couper lorsqu'on quitte Exploitation. Une cohorte initiale est revalidée à chaque usage et n'est pas reportée vers un autre village.

### Pendant le geste et au relâchement

Le HUD remplace les textes d'aide par un récapitulatif vivant : cibles retenues par famille, exclusions déjà connues, rendements estimés, plafond global, répartition/admission initiale et temps pertinent. Exemple correct : « 7 parcelles · ~4 200 carottes · 1 villageois · retour estimé… », calculé avec les valeurs réelles.

La carte montre les cibles retenues. Une cible déjà connue comme inéligible est distincte et exclue avant engagement ; elle compte dans un signal « 2 ignorées : déjà exploitées ». Une vérification inachevée n'est pas assimilée silencieusement à une exclusion acceptée. La borne maximale de cibles est visible ; son dépassement invalide le geste au lieu de le découper en commandes cachées.

Au relâchement, l'ensemble exact retenu devient une demande unique. Si tout est vide/invalide, aucune commande. Si valide, revalidation serveur puis création atomique de l'ordre et des activités enfants ; feedback bref et maintien de l'outil. Aucun panneau « Préparer l'exploitation » ni bouton « Lancer » normal.

Si une cible **retenue** devient indisponible, aucun sous-ensemble n'est lancé. Conserver la sélection, marquer la cible et expliquer le refus ; l'utilisateur peut la retirer ou refaire son geste. Une mise à jour du snapshot ne déclenche jamais une relance.

Si Défricher concerne au moins un bosquet retenu, toute la demande mixte attend la confirmation compacte : nombre de bosquets, caractère définitif de l'arrêt de repousse, autres activités incluses, boutons Défricher/Annuler. Aucun Jardin ne part pendant cette attente. Une modification de sélection ou de paramètres invalide cette confirmation. C'est l'unique confirmation supplémentaire de création prévue dans cette tranche ; le prix élevé d'un bâtiment ne crée pas une autre exception.

### Règles métier conservées

| Famille | Objectif et travail |
|---|---|
| Jardins | Une tournée regroupée, un villageois, 60 s par parcelle, un seul retour et crédit au retour. Énergie suffisante pour la tournée prévue. |
| Bois | Couper jusqu'à 10 % restant puis laisser repousser ; Défricher suit le seuil et les règles de défrichage déjà validés. |
| Pierre | Exploiter jusqu'à épuisement avec lots, transports, énergie et livraisons existants. |

Le plafond commun compte tout habitant à l'aller, au travail et au retour. Allocation existante : exemple 5 disponibles et trois familles admissibles = 1 Jardin, 2 bois, 2 pierre ; budgets plus petits imposent une alternance, pas un dépassement. Une activité bloquée ne réserve pas une place inutilisable au détriment des autres.

Après la livraison des Jardins, la place libérée peut servir au prochain lot bois/pierre admissible. Ni renfort au milieu d'un lot, ni réservation d'une relève complète, ni augmentation silencieuse d'un plafond détaillé. Conserver repos automatique et alternance des départs après commandes manuelles.

« Pendant une durée » signifie fenêtre réelle depuis l'acceptation serveur, attentes et pauses comprises. Elle interdit de nouveaux lots à son échéance ; elle ne rappelle pas les habitants. Les lots engagés et **toute la tournée Jardin déjà engagée** sont terminés et livrés. Montrer séparément fin des départs et retour estimé ; une durée de chantier n'est pas une promesse de livraison à cet instant.

Pas de nouvelle récolte automatique répétitive des Jardins. Pause/arrêt restent des commandes de suivi respectant les engagements en cours. Déconnexion ou sortie de mode n'arrêtent pas l'ordre. Ne pas inventer des rendements garantis ou un compte à rebours précis pour un chantier qui attend une relève inconnue.

## Construction opérationnelle

Construction est le second cas complet qui prouve que le shell n'est pas spécifique à la sélection de ressources. Il doit être utilisable à la livraison, pas illustré par une palette statique.

### Catalogue visuel et outils

Catégories issues des bâtiments réels : Habitat, Production, Savoir, Services ou Administration selon le classement retenu. Les futures familles Artisanat/Stockage n'imposent pas des cases vides décoratives. Un ordre de catégories est une présentation, pas une règle de déblocage.

Chaque carte montre nom, miniature, coût réel, emprise et disponibilité. Le survol donne les informations essentielles : durée, fonction/capacité, limite d'instances ou motif d'indisponibilité. Les objets connus mais temporairement inaccessibles peuvent être visibles avec motif ; ne pas révéler de contenu scientifique encore inconnu.

Utiliser les recettes de la factory pour des miniatures cohérentes avec le résultat construit. Réutiliser les générateurs, pas la totalité de l'atelier et son interface. Prévoir un rendu partagé/borné ou des images mises en cache par recette, niveau et variante ; aucun moteur/scène WebGL permanent par vignette. Libérer les ressources de rendu et ne pas régénérer toutes les images à chaque snapshot.

Les miniatures générées sont aussi conservées entre rechargements dans un cache navigateur versionné, borné à 24 images et 2 Mio. Consulter ce cache avant de charger le renderer ; une image connue s'affiche dès l'ouverture de sa carte. Un stockage refusé, plein ou corrompu laisse fonctionner le cache mémoire et la génération. Dans l'implémentation actuelle, incrémenter `THUMBNAIL_REVISION` dans `building-thumbnails.ts` après toute modification de présentation, des factories/transitives, des matériaux/textures (dont `public/tiles/garden-4.png`), du cadrage ou de la résolution. Une future variante de matériau devra aussi entrer dans la clé ; aucun paramètre joueur/village n'est nécessaire aux présentations actuelles.

Une recette visible dans l'atelier n'est pas automatiquement constructible. La caserne ne reçoit pas un faux prix/recrutement ; l'hôtel de ville n'est pas proposé comme nouvelle construction si le catalogue le refuse. Nouvelle construction au niveau initial prévu par le métier, amélioration via l'action correspondante.

Les futures variantes de matériau se placent **sous le bâtiment sélectionné**, dans la même palette. Dans cette livraison, ne proposer aucune variante économique ni rotation manuelle que la commande serveur ne persiste réellement. Les palettes de couleurs de l'atelier sont un outil visuel, pas une offre commerciale à activer implicitement.

### Placement direct

1. Choisir un bâtiment disponible prépare son outil ; coût, durée, emprise et orientation réelle sont visibles avant l'entrée dans le monde.
2. Le survol montre le ghost de sa recette sur son emprise exacte. Une Université occupe 5 × 6, pas une case avec un grand dessin dépassant autour.
3. Pour une emprise fixe, déplacer le pointeur déplace le ghost ; clic ou relâchement valide sa position finale. Aucune construction au pointerdown.
4. Pour un Jardin surfacique, appui fixe l'ancre, glissé définit la zone, relâchement valide cette zone ; coût et validité évoluent pendant le geste.
5. Le serveur vérifie l'emprise complète et le coût présenté, débite/réserve et crée la construction dans la même commande métier.
6. Au succès, afficher l'état réel « en construction » et conserver l'outil pour un autre placement. Pas de bouton Confirmer intermédiaire.

L'emprise et le mesh partagent dimensions, ancre et orientation persistées. Rotation « R » ou autre sélecteur uniquement si l'action la supporte de bout en bout ; dans la base actuelle, conserver l'orientation serveur plutôt que proposer une rotation éphémère.

Distinguer terrain inconnu, collision, sol incompatible, hors périmètre constructible, ressources insuffisantes, limite d'instances et indisponibilité métier. Le damier ne matérialise que les cellules constructibles connues ; le ghost peut indiquer les cellules qui rendent son emprise complète invalide. Aucune pose partielle ou translation automatique vers un voisin « qui passe ».

### Améliorer et étendre

La palette propose les actions existantes Améliorer et Étendre, préparées comme les autres outils. Améliorer : survol d'un bâtiment compatible = prochain niveau, coût, durée et changements essentiels ; clic = commande revalidée. Pas de choix artificiel de tous les niveaux exposés par la factory.

Étendre un Jardin : choisir cette action, puis un Jardin existant comme cible ; cette première désignation ne dépense rien et fixe clairement le bâtiment dans la palette. Le geste suivant dessine l'extension autorisée ; preview des nouvelles cellules et du coût, puis relâchement = commande. Le clic de désignation ne peut aussi construire une extension. Échap abandonne la zone en cours, puis la cible, puis l'outil.

Les fiches existantes peuvent conduire à ces outils avec leur cible préremplie. Elles ne conservent pas une seconde commande de confirmation concurrente après le geste dans le monde. Les ressources/capacités réellement disponibles sont recalculées après chaque placement ou amélioration.

## Aménagement comme contrat d'extension

La famille reste « À venir » pendant cette livraison. Ce qui suit engage la grammaire du shell, **pas la livraison des outils ni de leurs commandes**.

| Palette future | Paramètres avant action | Geste et preview attendus |
|---|---|---|
| Chemins | Matériau, largeur, bordure/trottoir si disponibles | Tracé continu ; aperçu de l'ensemble et raccords, relâchement = demande de tronçon. |
| Sols | Revêtement, taille/forme de brosse | Peinture de zone dédupliquée ; surface et coût recalculés. |
| Bordures | Recette, matériau, côté | Tracé avec angles/raccords visibles ; aucune pose de pièces aveugle. |
| Éclairage | Modèle, orientation si autorisée | Placement ponctuel avec emprise et portée visuelle indicative. |
| Végétation | Arbre, bosquet ou haie décorative, forme | Placement ou peinture selon la recette, distincts d'un gisement exploitable. |
| Mobilier | Objet et orientation | Placement ponctuel sur emprise valide. |
| Monuments | Monument acquis, socle, variante autorisée, orientation ; plaque si disponible | Préparation dans la palette puis placement ; acquisition scientifique et coût revalidés. |

Ces outils réutiliseront les états prêt/geste/vérification/envoi/refus, l'annulation, les previews et la séparation des autorités. Une forme de geste est une propriété de l'outil ; le shell ne suppose ni « toujours sélectionner des gisements » ni « toujours poser un bâtiment ».

La future résolution des routes assumera droits, topologie des raccords, coût et persistance dans sa tranche. Ici, aucune route automatique convertie en segment joueur, aucun brasero automatiquement généré rendu déplaçable, aucun faux tracé sauvegardé seulement dans le navigateur. Ne pas ajouter d'API, migration ou recette économique pour simuler cette extensibilité.

## Responsabilités et garanties serveur

| Couche | Responsabilité |
|---|---|
| React et shell HUD | Intention unique, paramètres, préférences, état du geste/commande, palette, erreurs et inspections. |
| Babylon | Rendu, picking autorisé, géométrie du geste, ghost/highlights et caméra. Émet des événements ; ne lance pas une seconde commande économique. |
| Contrats partagés | Payloads, aperçus, résultats/refus structurés et limites communes. Pas de règles métier dissimulées dans une couleur de bouton. |
| Fastify et services métier | Identité, monde, connaissance/accessibilité, emprises, ressources, énergie/cohortes, plafonds, réservations, dates et atomicité. |
| PostgreSQL et scheduler existant | Persistance des commandes/activités et transitions dues ; aucun crédit déclenché par l'animation. |

Un descripteur d'outil peut déclarer palette, paramètres, forme de geste, preview, politique d'exécution et éventuelle exception. Rester dans le client et ses services existants : ni framework de plugins, ni moteur universel d'ordres, ni refonte de l'économie.

### Revalidation

Un aperçu est une estimation, pas un verrou. Il ne crée ni ordre, réservation nouvelle, nouvelle affectation ni départ automatique. La réconciliation des transitions déjà dues peut continuer selon la transaction existante ; ne pas la confondre avec un effet du survol.

À la commande, revalider monde/joueur/village, coordonnées canoniques, connaissance, cibles exactes, emprise, limites, accessibilité, coûts, cohortes et énergie. Le viewport n'est jamais une frontière d'autorité. Aucune preview, vignette, cause d'erreur ou highlight ne doit révéler un village ou gisement inconnu.

Pour l'exploitation, une cible acceptée devenue invalide invalide tout le lancement. Les exclusions déjà montrées pendant le geste n'étaient pas dans la demande acceptée ; ce sont deux cas distincts. L'ordre mixte conserve sa transaction atomique. Pour Construction, même principe sur l'emprise entière et les dépenses ; le client ne retire pas les cases gênantes après coup.

Les plafonds sont des limites, pas une obligation de remplir l'équipe. Le résultat serveur indique effectifs/activités réellement admis et éventuelles attentes ; il n'élargit jamais l'ordre au-delà de ce qui a été présenté. Les valeurs économiques ne sont pas tenues pour vraies parce que le client les envoie ; un coût/plafond attendu sert de garde de consentement, pas de tarif.

### Évolutions minimales des contrats

Ces extensions sont nécessaires pour implémenter la grammaire sans inventer des capacités dans React. Le nom exact des champs est un choix de réalisation ; leur sémantique est imposée.

| Contrat | Données nécessaires en plus de l'existant |
|---|---|
| Aperçu d'exploitation | Maximum structurel, maximum Auto admissible, répartition initiale estimée par activité, admissibilité de la cohorte et motifs d'attente/refus. Conserver cibles, exclusions, rendements et retour Jardin existants. |
| Commande d'exploitation | Plafond numérique figé et politique d'admission initiale : Auto exige au moins un premier départ admissible, le plafond manuel autorise l'attente selon les règles métier. Cette politique appartient au payload idempotent ; le serveur ne reçoit pas le nom du mode HUD. |
| Commandes de construction couvertes | Identité de commande, payload canonique, cible/niveau attendu pour l'amélioration, emprise exacte pour pose/extension et borne de coût acceptée. Le serveur calcule le prix, refuse une dépense supérieure à la borne et valide les autres contraintes indépendamment. |
| Résultats et refus | Identité/contexte de commande, résultat accepté identifiable, mobilisation réelle et motifs structurés avec cibles concernées lorsqu'elles sont connues du joueur. Permettre la mise à jour de la palette sans analyser une phrase d'erreur libre. |

L'aperçu et la commande partagent les règles d'admission existantes ; ne pas entretenir un second algorithme d'énergie/affectation dans le HUD. Une quantité « mobilisable maintenant » exige une évaluation compatible avec les trajets et lots concernés, pas la simple lecture d'un compteur de population. L'aperçu peut devenir périmé : ces champs ne remplacent jamais la transaction finale.

Conserver les invariants de [l'économie](architecture/economy.md) : village verrouillé via beginVillageEconomy, borne statement_timestamp après acquisition, verrous métier canoniques, réconciliation chronologique et priorités manuelles avant relance. Ne pas verrouiller un autre village après les gisements, ni acquitter des notifications du scheduler depuis une commande.

### Envoi unique et erreurs réseau

Chaque intention envoyée est suivie avec contexte, identité et payload figés. Bloquer la répétition accidentelle du même geste pendant son envoi ; un double clic ne crée pas deux commandes. Un nouveau geste reste indisponible sur cet outil tant que le résultat ambigu n'est pas résolu, mais navigation/inspection restent possibles.

Exploitation réemploie son commandId et le contrôle du payload exact. Après résultat ambigu, reprendre avec **le même** identifiant et les mêmes données. Après refus métier certain et correction, créer une nouvelle intention. Une temporisation, un statut serveur 5xx ou une réponse perdue ne prouvent pas un rollback.

Pour Construction, ajouter la protection ciblée équivalente aux commandes construct/upgrade/extend couvertes ici : identité de commande, payload vérifié, résultat durable enregistré atomiquement avec l'effet. S'appuyer sur les pratiques d'idempotence du dépôt, sans créer de bus générique. En attendant cette protection, **aucun retry automatique d'une commande de construction potentiellement exécutée**. Vérifier uniquement l'occupation n'est pas une preuve suffisante pour rejouer une amélioration.

Garder les références des intentions ambiguës pendant un rechargement de l'onglet, dans un stockage client de session borné et indexé par contexte utilisateur/monde/village ; aucune donnée secrète. À la reprise, réconcilier le résultat ou rejouer l'identité idempotente. Ne jamais fabriquer un nouvel identifiant au motif que le composant React a été remonté.

| Situation | Retour joueur et suite |
|---|---|
| Rien de retenu ou géométrie invalide | Motif dans palette/monde ; aucune commande. |
| Stock insuffisant, instance maximale, cible invalide | Refus certain, sélection/ghost conservé ; corriger dans la palette ou le monde. |
| Manque d'effectif/énergie | Montrer la cause et distinguer plafond, admission réelle et attente permise ; pas de mobilisation cachée. |
| Preview périmée ou réponse hors ordre | Ignorer le mauvais résultat, recalculer ; aucune commande déclenchée par son arrivée. |
| Refus serveur après release | Résultat atomique nul pour cette nouvelle commande ; pas de lancement automatique après actualisation. |
| Déconnexion avant envoi | Intention non engagée, message discret ; pas d'envoi différé automatique au retour réseau. |
| Réponse perdue après envoi | « Résultat à vérifier », retry/reprise de la même commande ; jamais « Annulé » sans preuve. |
| Coût ou cibles modifiés pendant vérification | À corriger, nouvelles conséquences affichées ; un geste précédent ne consent pas aux nouvelles. |
| Session ou contexte devenu inaccessible | Retirer les previews sensibles, demander la reconnexion normale ; ne pas changer de village pour tenter la commande. |

Annuler une intention non envoyée ne rembourse rien et ne réserve rien. Annuler un geste après une commande envoyée ne stoppe pas le chantier : les véritables commandes Pause/Arrêter gardent leur sens métier et leur interface de suivi.

## Drawer DEV

Un bouton discret DEV, visible uniquement dans le contexte développeur autorisé, ouvre un drawer escamotable distinct de la palette joueur. Les raccourcis techniques respectent la même garde ; masquer le bouton ne suffit pas.

Regrouper chemins/debug, laboratoire et accélérations cosmologiques, contrôle technique de courbure, streaming/chunks, rechargements techniques, métriques, budgets graphiques et autres visualisations temporaires. Inventorier les contrôles d'App, VillageScene et du debug cosmologique, puis supprimer leurs doublons flottants.

Ouvrir DEV annule un geste non envoyé et bloque le passage des événements vers le monde. Fermer DEV ne recrée pas ce geste. Les overlays DEV actifs portent un témoin et un moyen de retour à l'état normal ; les transformations temporaires du labo restent explicitement marquées.

L'aperçu d'éclairage joueur n'est pas déplacé dans DEV. La navigation normale Village/Région/Monde et la découverte progressive de la courbure restent accessibles selon la connaissance scientifique ; retirer un bouton technique n'abolit pas le zoom naturel. V conserve la cinématique joueur conditionnée par les acquis ; un raccourci de visée du Chat ou un bypass scientifique relève de DEV.

Un état de connexion/chargement utile au joueur reste discret dans le HUD public, avec récupération compréhensible en cas d'échec. Les nombres de chunks, métriques et commandes d'inspection vont dans DEV. Ne pas cacher une panne terrain uniquement dans le panneau développeur.

## Points d'intégration et réalisation

| Point du dépôt | Travail attendu |
|---|---|
| apps/world-web/src/App.tsx | Remplacer la chaîne collecte → recap → launch par l'intention préparée et son suivi unique ; conserver les services atomiques. |
| apps/world-web/src/ui/WorldModeBar.tsx et world-mode.ts | Shell, palette, mémoire des modes et transitions ; pas de deuxième état de mode dans chaque panneau. |
| apps/world-web/src/ui/ExploitationPanel.tsx | Réintégrer paramètres et preview vivante dans la palette ; retirer la modale obligatoire. |
| apps/world-web/src/ui/ConstructionPanel.tsx | Palette visuelle, outils de placement/amélioration/extension ; retirer la confirmation normale après geste. |
| apps/world-web/src/scene/BabylonVillageScene.ts | Propriété du geste indépendante de sa première cellule, preview, capture/annulation, commande émise une fois. |
| apps/world-web/src/scene/VillageScene.tsx et VillageSolarPreview.tsx | Coordination échelles/DEV et maintien de l'aperçu d'éclairage joueur. |
| apps/world-web/src/scene/building-plan.ts et factory-preview.ts | Réutiliser les recettes pour les vignettes ; ne pas embarquer un atelier actif par carte. |
| packages/contracts/src/exploitation.ts et villages.ts | Étendre seulement les données de preview/admission, refus et idempotence nécessaires aux commandes couvertes. |
| apps/api/src/modules/villages/service.ts et routes.ts | Réemployer prepareExploitation, previewVillageExploitation et startVillageExploitation ; raccorder les garanties de construction. |

Les noms désignent les points réellement relus, pas l'obligation de conserver tout le code dans ces fichiers. Extraire un composant/réducteur local si utile ; ne pas ouvrir une réarchitecture générale.

Ordre de réalisation conseillé : shell et grammaire commune, Construction comme premier parcours visuel complet, puis Exploitation directe et maxima, puis raccordement des autres accès et nettoyage DEV. **La livraison comprend les deux parcours opérationnels** ; réussir Construction seule ou Exploitation seule ne suffit pas. Aménagement prouve l'extensibilité par son contrat, sans faux outils actifs.

## Critères d'acceptation observables

**Critère global obligatoire : aucune action ordinaire couverte par cette reprise ne doit nécessiter une modale ou un second formulaire après que le joueur a effectué son geste dans le monde.** Cela inclut récolte, coupe, extraction, construction, amélioration et extension. La confirmation de défrichage et la récupération d'un refus sont des exceptions explicites dans la palette, pas des étapes systématiques.

| ID | Parcours de recette | Résultat attendu |
|---|---|---|
| HUD01 | Ouvrir une famille, choisir un outil, replier la palette | Monde dominant ; outil/réglages essentiels toujours identifiables ; réouverture sans perte de préférence. |
| HUD02 | Exécuter deux actions ordinaires successives | Une seule préparation nécessaire ; outil conservé, nouvel état économique pris en compte, aucune modale ni second formulaire. |
| HUD03 | Cliquer/glisser sur le HUD ou relâcher une sélection dessus | Aucune commande dans le monde à travers le HUD. |
| GES01 | Commencer le swipe sur herbe vide, traverser Jardins, bois, pierre | Un geste métier continu ; cibles dédupliquées et preview live, pas de départ avant release. |
| GES02 | Traverser vite les mêmes cibles plusieurs fois | Aucune cible sautée par manque d'événements ni comptée deux fois. |
| GES03 | Échap, second doigt, pointercancel, perte de fenêtre, changement de mode/échelle | Annulation du geste non envoyé ; pointerup tardif inoffensif. |
| GES04 | Pan/orbite/zoom avec outil actif | Caméra accessible, aucune exploitation ni construction accidentelle. |
| EXP01 | Sélectionner plusieurs jardins | Une tournée à un villageois, temps de chaque parcelle et trajet pris en compte, crédit au seul retour. |
| EXP02 | Swipe mixte valide puis relâchement | Un ordre atomique ; paramètres préparés respectés ; aucun bouton Lancer demandé. |
| EXP03 | Auto sur Jardins seuls, puis bois/pierre, puis retour Jardins | Maximum contextuel recalculé ; aucune persistance de l'ancien maximum, plafond Jardin 1. |
| EXP04 | Auto affiche 4 ; davantage d'habitants se libèrent avant acceptation | Cet ordre n'engage jamais un plafond supérieur à 4 ; le prochain geste peut proposer davantage. |
| EXP05 | Une partie des habitants devient indisponible | Plafond non augmenté ; effectif réellement admis expliqué ; refus Auto si aucun premier départ possible. |
| EXP06 | Plafond manuel 10 avec quatre personnes prêtes | Afficher les deux nombres sans remplacer la préférence ; attente/admission restent serveur et dans les limites enfants. |
| EXP07 | Budget commun 5 et trois familles admissibles | Départs 1/2/2 ; après livraison Jardin, place réutilisable au prochain lot admissible, sans renfort en cours de lot. |
| EXP08 | Une cible retenue devient invalide avant transaction | Aucun ordre/activité partiel ; cibles conservées, motif visible, aucune relance automatique. |
| EXP09 | Défricher dans un geste mixte | Confirmation compacte de toute l'intention ; aucune autre activité ne part avant ; annuler n'a aucun effet économique. |
| EXP10 | Fenêtre expire pendant une tournée Jardin ou un retour | Tournée engagée entière/lots honorés ; aucun nouveau départ hors fenêtre ; retour estimé distinct de la fin des départs. |
| CON01 | Choisir un bâtiment dans la palette | Miniature cohérente, coût catalogue et emprise affichés avant le geste ; pas de fenêtre catalogue obligatoire. |
| CON02 | Placer une Université et un Jardin surfacique | Ghost 5 × 6 pour l'une, zone/coût dynamiques pour l'autre ; release valide suffit, pas de confirmation HUD. |
| CON03 | Emprise avec collision, hors périmètre ou stock insuffisant | Raison précise ; aucune pose partielle, dépense ou déplacement automatique du bâtiment. Emprise sans remplissage coloré, bordure vert fluo si possible ou rouge lumineux si refusée ; teintes du ghost conservées. |
| CON04 | Préparer Améliorer puis cliquer ; préparer Étendre puis désigner/tracer | Commandes existantes exécutables avec la grammaire commune ; pas de formulaire après le geste final. |
| CON05 | Examiner caserne et variantes d'atelier | Aucun objet non constructible proposé avec un faux prix ; aucune orientation/variante non persistée présentée comme achetable. |
| NET01 | Réponses de preview inversées après changement de sélection/village | Ancienne réponse ignorée ; aucun changement de nouvelles cibles ou paramètres. |
| NET02 | Serveur accepte puis réponse perdue, double clic ou rechargement | Reprise idempotente d'exploitation et de construction : une création, un débit ; pas de nouvel identifiant sur résultat ambigu. |
| NET03 | Annuler pendant vérification, puis laisser arriver sa réponse | Aucune commande tardive. Après envoi effectif, le HUD n'affirme pas une annulation fictive. |
| NAV01 | Exploitation → Région → Monde → Village | Exploration hors Village ; mode restauré au retour, aucune sélection/confirmation ressuscitée. |
| NAV02 | Ouvrir Construction depuis Région | Retour au village actif dans Construction, prioritaire sur l'ancien mode mémorisé. |
| DEV01 | Utiliser l'aperçu d'éclairage sans DEV puis quitter Exploration | Fonction joueur disponible ; retour temps réel ; aucune conséquence économique/scientifique. |
| DEV02 | Fermer DEV et parcourir le HUD public | Aucun contrôle technique dispersé ; navigation normale et information utile de panne restent disponibles. |
| EXT01 | Examiner Aménagement puis revenir au monde | Entrée À venir ; aucun faux tracé, modification de route/brasero ou nouveau stockage décoratif. |
| PERF01 | Ouvrir/fermer plusieurs fois catalogue et changer de mode | Pas de moteur Babylon par vignette, de fuite de scènes ou de rechargement général du terrain ; palette utilisable pendant la navigation. |

Validation d'implémentation à mener proportionnellement : contrôles ciblés des états/annulations/réponses hors ordre, des plafonds, du rejet atomique et de l'idempotence ; vérification navigateur des deux parcours et des raccourcis, puis recette humaine interactive. Pas de campagne E2E générale dans cette session documentaire ni d'extension automatique de la matrice de tests. Les preuves de la première passe ne valent pas validation de la reprise.

Les durées de fondu, densités de vignettes, teintes et cadence de preview sont ajustables en recette sans réouvrir les règles ci-dessus. Aucun arbitrage produit structurant n'est laissé à inventer pour commencer cette tranche.
