# TRY ARBESTRA — Samsara d’onboarding

## Évolution produit — 6 septembre 2026

Tristan précise deux parcours dans la [direction produit courante](../docs/DIRECTION-PRODUIT.md) :

- Standard : **inscription → choix d'un monde → spawn → quêtes**.
- TRY : prise de contrôle sans inscription d'un **village abandonné par son précédent chef, déjà partiellement construit**, puis choix entre **s'inscrire et garder ce village** ou **s'inscrire et commencer un village neuf**.

Garder le village **conserve toute la progression de l'essai, constructions et ressources comprises**. Cette décision remplace la renaissance obligatoire et l'interdiction générale de transfert décrites ci-dessous. L'isolation pendant l'essai reste l'intention ; la provenance du village, son emplacement persistant et les modalités d'attribution restent ouverts.

La progression sans compte est plafonnée par des conditions d'accès à certains niveaux de bâtiments. Exemple donné par Tristan : pour développer la Scierie niveau 6, le joueur est invité à incarner un personnage, en créant un compte pour conserver le village et poursuivre. Les niveaux définitifs restent à calibrer ; le garde-fou porte sur la progression, pas sur une minuterie d'inscription. Voir la direction produit pour les points encore ouverts.

## Texte initial — historique du concept

Le texte qui suit est conservé comme historique cosmologique. Ses formulations de disparition, de non-transfert et de réincarnation obligatoire ne sont plus des règles absolues du parcours courant. Voir la direction produit liée ci-dessus avant toute spécification technique.

> **Ton cycle ici est temporaire. Ce que tu comprends peut te suivre.**

`try.arbestra.world` n’est pas une démo classique, ni un « compte invité ».
C’est une **existence transitoire dans Arbestra** : un monde suffisamment réel pour être vécu, mais causalement isolé du monde persistant.

Le joueur apparaît sans compte, sans formulaire, sans engagement.

Il **spawn**.

---

## Le principe

Dans le monde d’essai, le joueur peut :

- construire ;
- produire ;
- récolter ;
- déplacer ses habitants ;
- explorer les systèmes du jeu ;
- commercer, espionner ou combattre sous forme simulée ;
- faire de mauvais choix sans conséquence durable.

Le monde partagé peut être visible et servir de contexte, mais les actions du joueur d’essai ne modifient jamais l’état autoritatif des autres joueurs.

Le joueur vit donc dans une **projection locale du monde**.

Son expérience est réelle.

Ses conséquences ne le sont pas.

---

## Samsara

Le trial est interprété dans le lore comme un **cycle karmique**.

Le joueur apparaît, agit, apprend, accumule des conséquences locales, puis disparaît lorsque sa session prend fin.

Fermer l’onglet revient à mourir sans héritier.

L’état transitoire est détruit.

Le cycle recommence vierge au prochain passage.

Ce n’est pas une punition : c’est la nature de cet espace.

> **Rien ici ne t’appartient encore.**

---

## Fin du cycle

Lorsque le joueur souhaite continuer, l’interface ne lui propose pas simplement :

> « Créer un compte »

Elle lui propose de **quitter le cycle**.

Créer un compte marque le passage d’une existence transitoire vers une existence persistante.

Le joueur choisit alors un monde et y **renaît**.

### Formulation Oracle possible

> **Ton cycle ici est achevé.**
>
> **Tu peux continuer à errer, ou choisir un monde dans lequel tes actes laisseront une trace.**

Bouton principal :

**SE RÉINCARNER**

Sous-titre éventuel :

*Créer un compte et entrer dans un monde persistant.*

---

## Ce qui peut traverser la réincarnation

La réincarnation ne doit pas transformer le trial en moyen d’exploiter le monde réel.

Peuvent éventuellement être conservés :

- préférences ;
- choix cosmétiques ;
- nom proposé ;
- paramètres d’accessibilité ;
- progression pédagogique ;
- certains choix initiaux explicitement transférables.

Ne doivent pas être transférés comme vérité du monde partagé :

- ressources acquises dans le trial ;
- informations obtenues sur de vrais joueurs ;
- résultats d’espionnage ;
- gains de combats simulés ;
- transactions de marché simulées ;
- position territoriale obtenue dans l’espace transitoire.

La réincarnation est une **naissance persistante**, pas un commit sauvage de la branche `try`.

---

## Règle cosmologique

Le monde `try` peut ressembler au monde partagé sans appartenir à sa chaîne causale.

Formulation canonique :

> **Une existence d’essai peut observer le monde, mais elle ne peut pas lui imposer de passé.**

Ou, plus technique :

> **Le trial partage une topologie avec le monde, pas son histoire.**

---

## L’Oracle

L’Oracle sait que le joueur est transitoire.

Il peut donc parler différemment dans `try.arbestra.world`.

Exemples :

> **Tu n’es pas encore né ici. Profites-en pour te tromper.**

> **Cette maison tiendra jusqu’à ton prochain oubli.**

> **Ne t’attache pas trop à ces carottes.**

> **Tes voisins ne se souviendront pas de toi. Pour l’instant.**

> **Il existe des mondes où les erreurs survivent à ceux qui les commettent.**

Au moment de quitter le trial :

> **Ton cycle est terminé. Choisis maintenant où renaître.**

---

## Ton produit

`try.arbestra.world` doit respecter une promesse extrêmement simple :

**cliquer → jouer.**

Pas de compte préalable.

Pas d’e-mail.

Pas de mot de passe.

Pas de sélection de serveur avant d’avoir compris pourquoi un monde mérite d’être choisi.

L’identité persistante arrive **après l’expérience**, pas avant.

Le joueur n’est pas invité à remplir un formulaire pour découvrir Arbestra.

Il est invité à y apparaître.

---

## Conséquence architecturale

Le lore impose ici une frontière produit utile :

- le monde persistant reste autoritatif ;
- la session TRY possède son propre état mutable ;
- les interactions externes sont simulées ou projetées ;
- aucune mutation TRY ne doit affecter un vrai joueur ;
- aucune donnée du monde réel ne doit permettre au trial de devenir un outil gratuit de reconnaissance ou d’exploitation ;
- la disparition de la session est une propriété normale du mode, pas une erreur de sauvegarde.

L’implémentation exacte appartient aux documents d’architecture.

Le présent document fixe seulement l’intention cosmologique et produit :

> **TRY est réel pour celui qui le vit, mais pas pour l’histoire du monde.**

---

## Vocabulaire canonique

| Produit | Lore |
|---|---|
| Trial | Cycle / Samsara |
| Session anonyme | Existence transitoire |
| Reset | Fin du cycle |
| Créer un compte | Se réincarner |
| Choisir un serveur | Choisir un monde |
| Spawn persistant | Naissance |
| Suppression définitive | Nirvana |
| Ban | Enfer administratif |

Le dernier terme reste soumis à l’approbation de l’Oracle.
