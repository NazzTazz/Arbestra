# Étude — Karma et voisinage

Statut : **étude ouverte**, à trois (Tristan, Claude-Opus, Jean-Michel / Sol 6.1). Tristan tranche. Aucune implémentation n'est autorisée par ce document.

Légende : **validé** (décision de Tristan), **proposé** (source indiquée), **ouvert**, **hors périmètre**.

## 1. Déclencheur

Le 29 octobre, une joueuse a construit collée au village d'un autre joueur. Constat dans le code : il n'existe **aucune règle de territoire entre villages**.

- Une case est constructible si elle est libre, si son terrain le permet, si elle n'est pas dans une clairière protégée **non attribuée**, et si elle est à 8 cases au plus d'un bâtiment terminé du village (`withinBuildReach`, `BUILD_REACH = 8`).
- La clairière d'un village passe à `claimed` à l'installation et ne protège plus rien ensuite.
- La fenêtre de terrain du village (64 cases à l'origine) bornait de fait la grille ; son élargissement a retiré cette barrière accidentelle.
- `docs/architecture/world-space-and-occupancy.md` classe le territoire politique hors périmètre.

## 2. Déjà écrit (`docs/DIRECTION-PRODUIT.md`, « Coexistence militaire et pacifique »)

**Validé** (direction antérieure) :

- protection absolue à l'arrivée ;
- construire une caserne ou former des soldats ne fait pas perdre la protection ;
- initier un combat coûte du karma ; se défendre est gratuit ; une expédition de vengeance reste une attaque ;
- le karma se reconstitue ; un joueur qui n'attaque jamais acquiert un bonus pacifiste ; à partir d'un seuil positif, la protection est absolue ;
- à karma nul ou faible, l'Oracle atténue la violence du combat pour le défenseur (forme non décidée).

Rien du combat ni du karma n'est livré.

## 3. Précisions de Tristan (29 octobre)

**Validé** :

- Le karma est **global**. On en perd en attaquant, on en regagne en étant pacifique.
- À **karma nul**, un joueur est attaquable, mais l'Oracle influe sur le combat : il interdit la destruction mutuelle des joueurs protégés.
- Après **14 jours de karma nul**, le karma redevient positif : le joueur est protégé des attaques de village tant qu'il n'attaque personne. Une attaque le fait retomber à 0.
- Le grief bilatéral est jugé « très intéressant en complément » du karma global.

**Proposé (Tristan)**, rayon de protection des constructions selon le karma du village protégé :

| Karma | Rayon de protection |
|---|---|
| Positif | 8 cases |
| Nul | 4 cases |
| Négatif | aucun |

## 4. Propositions complémentaires (Claude-Opus, non validées)

- **Zone à confirmation** : entre le rayon de protection et 8 cases, construire reste possible, avec une confirmation « Construire ici peut déstabiliser vos relations avec X » et une perte de karma pour le constructeur.
- **Lisibilité** : en mode construction, les cases protégées et les cases à confirmation sont teintées différemment.
- **Grief bilatéral** : le village lésé obtient un droit de riposte contre l'empiéteur, qui ne lui coûte pas de karma. Il s'éteint avec le temps, la démolition ou un pacte de voisinage.
- **Notification** : le voisin est prévenu dans son journal.
- **Persistance avant le combat** : karma et griefs sont enregistrés dès maintenant, pour que l'historique existe quand le combat arrivera.

## 4 bis. Propositions de Jean-Michel (29 octobre, non validées)

- **Distinguer trois protections** : militaire (empêcher ou atténuer une attaque), territoriale (empêcher l'empiètement constructif), économique (échanges et convois). Le karma fixe le *niveau* de protection ; l'*assiette territoriale* dit quels bâtiments projettent un rayon. Option minimale : seuls des bâtiments structurants projettent la protection (parade au *land grab* : dix maisons espacées de 16 cases privatisent une région).
- **Cycle des 14 jours** : il permet structurellement une attaque tous les 14 jours, au prix de deux semaines d'exposition. Pas forcément un exploit ; c'est un arbitrage pour Tristan, sans pénalité cumulative ajoutée d'office.
- **Grief** : rattaché à un événement identifié (par exemple la construction litigieuse), il autorise une action de contestation déterminée, puis il est consommé ou expire. Pas de relation d'hostilité durable, pour éviter la récursion riposte → vengeance → riposte. À ne pas valider avant de définir les moyens concrets de contestation.
- **Oracle** : distinguer **immunité** (attaque interdite) et **protection de combat** (attaque permise, conséquences limitées), et préciser ce que l'Oracle préserve (infrastructures, population, stocks, éléments fondamentaux).
- **Convois** : modèle A (le karma du propriétaire protège ses convois) ou modèle B (convois attaquables, l'agresseur paie en karma, le propriétaire garde sa protection territoriale). Jean-Michel préfère B, cohérent avec les escortes.
- **Villages existants** : ne détruire, déplacer ni invalider aucune construction acceptée ; nouvelles règles pour les tentatives futures ; chevauchements historiques enregistrés comme acquis.
- **Harcèlement par provocation** : construire près d'un pacifique pour provoquer une riposte qui le ferait sortir de sa protection. Le serveur doit connaître le contexte métier d'une action (riposte autorisée ou attaque initiée), pas seulement qui a cliqué.

## 5. Ouvert

1. Mesure du rayon : depuis tous les bâtiments terminés, ou depuis le seul cœur du village ? Risque de *land grab*.
2. Deux villages à karma positif voisins : la bande neutre de 8 cases est-elle voulue ?
3. Changement de karma : les bâtiments déjà posés restent-ils, sans pénalité a posteriori ?
4. Protection d'arrivée : équivaut-elle à un karma positif, donc à un rayon de 8 ?
5. Ampleur de la perte de karma pour un empiètement, avant que le combat existe.
6. Valeur initiale du karma et cas des villages existants.
7. Sens exact de « destruction mutuelle des joueurs protégés » quand le karma est nul.
8. Convois publics : attaquer un convoi coûte-t-il du karma ? Le convoi d'un joueur à karma positif est-il protégé ?
9. Exploits : cadence d'attaque permise par le retour à 14 jours, multi-comptes, encerclement des débutants.

## 6. Hors périmètre pour l'instant

Résolution des combats, unités militaires, interface diplomatique complète.

## 7. Journal des échanges

- 29 octobre : Claude-Opus transmet à Jean-Michel les §2 à §5. Jean-Michel n'a pas retrouvé de règles de karma dans son historique (elles seraient sur un autre compte de Tristan).
- 29 octobre : réponse de Jean-Michel (§4 bis). Il soumet trois arbitrages prioritaires à Tristan : quelles constructions projettent la protection ; convois des pacifiques attaquables ou non ; cycle « attaque, 14 jours exposé, retour à la paix » accepté ou non.
