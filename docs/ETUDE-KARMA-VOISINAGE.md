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

## 3 bis. Arbitrages de Tristan (29 octobre, réponse à Jean-Michel)

**Validé** :

- **Les convois ne sont jamais protégés**, quel que soit le karma du propriétaire. Attaquer un convoi est une agression et coûte du karma à l'agresseur. Un joueur à karma positif peut avoir des gardes et escorter ses échanges sans perdre sa protection.
- **Échanges sécurisés** : l'Oracle, avec une marge de 30 % et des taux défavorables.
- **Le cycle « attaque, 14 jours exposé »** est voulu : un pacifiste tenté par un convoi lucratif doit peser ses 15 jours de vulnérabilité, plus coûteux encore à côté d'un voisin agressif.
- Le **land grab** soulevé par Jean-Michel est un vrai problème, à étudier.

## 4 bis. Propositions de Jean-Michel (29 octobre, non validées)

- **Distinguer trois protections** : militaire (empêcher ou atténuer une attaque), territoriale (empêcher l'empiètement constructif), économique (échanges et convois). Le karma fixe le *niveau* de protection ; l'*assiette territoriale* dit quels bâtiments projettent un rayon. Option minimale : seuls des bâtiments structurants projettent la protection (parade au *land grab* : dix maisons espacées de 16 cases privatisent une région).
- **Cycle des 14 jours** : il permet structurellement une attaque tous les 14 jours, au prix de deux semaines d'exposition. Pas forcément un exploit ; c'est un arbitrage pour Tristan, sans pénalité cumulative ajoutée d'office.
- **Grief** : rattaché à un événement identifié (par exemple la construction litigieuse), il autorise une action de contestation déterminée, puis il est consommé ou expire. Pas de relation d'hostilité durable, pour éviter la récursion riposte → vengeance → riposte. À ne pas valider avant de définir les moyens concrets de contestation.
- **Oracle** : distinguer **immunité** (attaque interdite) et **protection de combat** (attaque permise, conséquences limitées), et préciser ce que l'Oracle préserve (infrastructures, population, stocks, éléments fondamentaux).
- **Convois** : modèle A (le karma du propriétaire protège ses convois) ou modèle B (convois attaquables, l'agresseur paie en karma, le propriétaire garde sa protection territoriale). Jean-Michel préfère B, cohérent avec les escortes.
- **Villages existants** : ne détruire, déplacer ni invalider aucune construction acceptée ; nouvelles règles pour les tentatives futures ; chevauchements historiques enregistrés comme acquis.
- **Harcèlement par provocation** : construire près d'un pacifique pour provoquer une riposte qui le ferait sortir de sa protection. Le serveur doit connaître le contexte métier d'une action (riposte autorisée ou attaque initiée), pas seulement qui a cliqué.

## 4 ter. Deuxième cycle (29 octobre)

- **Claude-Opus** propose un *cœur* de village (bâtiments à moins de R du centre de l'hôtel de ville, R selon son niveau) seul à projeter l'exclusion, une bande de confirmation, une frontière médiane en cas de chevauchement, et le report du grief au combat.
- **Jean-Michel** casse trois points, acceptés par Claude-Opus :
  1. un bâtiment éligible au bord de R projette encore 8 cases : l'exclusion atteint R + 8, R ne borne rien ;
  2. la frontière médiane change une interdiction absolue en priorité de propriété (une case à 5 de A et 7 de B serait constructible par A, bien que dans l'exclusion de B) ;
  3. la bande de confirmation est un engagement dans l'hostilité plus qu'un frein : une fois à karma nul, chaque empiètement suivant ne fait que relancer la même horloge de 14 jours.
- Il note aussi le risque multi-comptes (un débutant obtient d'emblée la protection maximale), argument pour une protection bornée et non extensible par des bâtiments ordinaires.
- Points d'accord : non-rétroactivité ; grief reporté au combat ; séparation entre droit de construire (portée) et droit d'exclure.
- **Question fondamentale pour Tristan** : le karma protège-t-il un **territoire** (zone géographique du village, frontières, souveraineté) ou une **distance minimale de voisinage** autour des bâtiments, variable selon le karma ? Jean-Michel et Claude-Opus pensent que l'intention est la seconde, plus simple.
- Version simplifiée (Claude-Opus) si c'est la distance de voisinage : interdit de construire à moins de D cases d'un bâtiment terminé d'un autre village, D = 8 (karma positif), 4 (nul), 0 (négatif) ; entre D et 8, confirmation et perte de karma.

## 4 quater. Troisième cycle : territoire et tours de guet (29 octobre)

**Proposé (Tristan)** : l'hôtel de ville crée un rayon de territoire revendiqué ; on l'étend par des **tours de guet**, qui surveillent aussi les mouvements commerciaux. Une construction ordinaire ne projette plus d'exclusion. La portée de construction de 8 cases reste une règle distincte.

**Brief de Jean-Michel** (conception déjà discutée avec Tristan sur le militaire, à ne pas considérer comme décidée sauf mention) :

- caserne ; gardes formés depuis la population existante, avec une compétence de garde ; affectables aux tours ou aux escortes ; former des soldats ne coûte pas de karma ;
- tours de guet garnies de gardes ou d'espions, qui détectent les mouvements hostiles, neutres et commerciaux et les transmettent à la caserne (« Convoi commercial détecté à l'est du village »), avec une interception possible ;
- escortes : unités militaires accompagnant physiquement les convois ; chevaux réutilisés entre transport et cavalerie ;
- parcours d'interception envisagé : détection → renseignement → interception décidée par le joueur → vérification serveur et coût de karma → combat avec escortes → conséquences publiées ;
- espionnage et contre-espionnage : pistes seulement ;
- alertes sobres, sans répétition, avec expiration, et précises à la mesure de ce que le serveur sait ;
- aucune formule de combat, composition d'armée ou règle de victoire n'est décidée.

**Penchants de Jean-Michel** : la construction revendique, la garnison active la surveillance ; revendication persistante, protection conditionnelle au karma.

**Analyse de Claude-Opus (proposée)** :

1. Revendication = disque de Chebyshev torique autour de l'hôtel de ville (rayon selon son niveau) et de chaque tour.
2. Continuité : une tour ne se pose que dans son propre territoire.
3. **Plafond** de tours lié au niveau de l'hôtel de ville : c'est ce qui borne vraiment le land grab.
4. **Premier arrivé** : une case appartient à la plus ancienne revendication qui la couvre ; territoire dérivé de la liste des revendications, sans cadastre.
5. Tour vide : garde son territoire, ne détecte rien.
6. Dans un territoire : karma positif → aucun étranger ne construit ; nul → confirmation et perte de karma ; négatif → libre. Les frontières ne varient pas avec le karma, seule leur étanchéité.
7. Hors territoire : portée de 8 cases, avant-postes non protégés.
8. Anti-encerclement : pendant la protection d'arrivée, aucune revendication étrangère ne peut couvrir le disque qu'aurait l'hôtel de ville du débutant au niveau maximal.
9. Villages existants : disque de l'hôtel de ville, priorité à la date d'installation ; les constructions déjà chez autrui restent et s'améliorent sur leur emprise.
10. Détection : les trajets des convois sont connus au départ ; on intersecte le trajet avec les disques de surveillance des tours garnies et on programme les alertes à échéance (tâches comme l'économie), sans balayage continu.

**Décisions indispensables avant une spec** : rayons (hôtel de ville par niveau, tour, surveillance) ; plafond de tours ; protection selon le karma (point 6) ; parade anti-encerclement ; ce que révèle une détection. Le territoire peut être livré avant la surveillance.

## 4 quinquies. Quatrième cycle (29 octobre)

**Jean-Michel** :

- Plafond de tours lié au niveau de l'hôtel de ville : oui, hypothèse principale.
- Invariant : une revendication n'existe que tant que sa tour existe. Une tour coupée du cœur cesse de revendiquer jusqu'au rétablissement de la continuité (proposé).
- « Premier arrivé » déconseillé : il fige l'expansion d'un voisin qui investit plus tard, et pose la question des joueurs inactifs. Alternative : territoire dérivé des bâtiments existants, revendications pouvant se chevaucher sans propriété exclusive.
- Pas d'annexion : une construction étrangère légale dans un territoire vulnérable ne revendique pas les cases déjà revendiquées. Intrusion et conquête restent distinctes.
- Alertes : programmer à l'échéance est bon, mais elles doivent être invalidées ou recalculées quand le convoi change (retard, détour, attaque, annulation) ; recalcul ponctuel à la garnison ; distinguer détection et identification.

**Claude-Opus** se range à ces points. Précision : le « premier arrivé » ne demandait pas de cadastre (date de fin de construction du bâtiment), mais l'objection de fond tient. Variante soutenue : une case revendiquée par deux villages n'est protégée pour aucun des deux contre l'autre, seulement contre les tiers ; le disque de l'hôtel de ville ne peut être chevauché par aucune tour étrangère. Joueurs inactifs : hors première tranche, à noter.

**Arbitrages soumis à Tristan** :

1. Revendications concurrentes : chevauchements possibles sans propriété exclusive, ou priorité à la plus ancienne ?
2. Construire chez un voisin vulnérable permet-il d'annexer son territoire ? (Jean-Michel et Claude-Opus : non.)
3. Une tour coupée du territoire principal cesse-t-elle de revendiquer, ou conserve-t-elle sa revendication ?

## 4 sexies. Cinquième cycle : chevauchements et pactes (29 octobre)

- **Jean-Michel** casse la variante de chevauchement de Claude-Opus : si un chevauchement neutralise la protection mutuelle, un voisin étend une tour sur un pacifique et construit chez lui sans perdre de karma (« invasion pacifiste »). Correction acceptée.
- **Validé (Tristan)** : pour des revendications qui se chevauchent, **personne n'a de priorité** (ni ancienneté, ni niveau d'hôtel de ville, ni proximité).
- **Règle d'application (Jean-Michel, reprise par Claude-Opus)** : chevauchement ≠ conquête, chevauchement ≠ levée de protection. Chaque nouvelle construction respecte indépendamment les protections de chaque village concerné, selon son karma. Deux pacifistes peuvent laisser une zone contestée inconstructible pour les deux : frontière de fait. Bâtiments déjà posés conservés.
- **Proposé (Tristan)** : une mécanique de négociation ou de pactes après la notification d'une construction voisine.
- **Jean-Michel** : trois pactes envisageables (voisinage, non-agression, droit de passage) ; prudence sur la non-agression, qui contournerait le karma si elle était une immunité ; première étape minimale : événement territorial → notification → contact ; aucun pacte ne cède le territoire d'un tiers. Question à Tristan : contrats exécutés par le serveur ou engagements politiques rompables ?
- **Claude-Opus** : les deux, selon ce que touche le pacte. Le serveur n'exécute un pacte que s'il modifie un droit qu'il applique déjà : le pacte de voisinage lève, entre les deux signataires seulement, l'interdiction ou la perte de karma de construire chez l'autre (permission bilatérale révocable, sans effet sur les tiers ni les revendications). La non-agression reste un engagement politique rompable, jamais une immunité ; sa rupture peut être un événement public. Le pacte de voisinage serait le premier pacte formel.

## 4 septies. Pactes, et moteur de combat existant (29 octobre)

- **Validé (Tristan)** : le combat d'Arbestra réutilisera le **moteur de combat de Waar** et sa soufflerie d'équilibrage (`../waar-micro-combat`, conçu pour 4 unités de Waar, `../waar-sf`) : banc de tests et d'équilibrage, sandbox macroscopique, joueurs simulés, slots Lua. Pas de second moteur. Astra (Sol en effort Pro) rejoint l'étude.
- **Astra** : résolution agrégée par cohortes, actions simultanées depuis l'état de début de round, rapports rejouables, distinction entre résolution physique et politiques de conséquences (blessés, morts, prisonniers). Cœur natif Rust avec une interface JSONL (`resolve`, `batch`, `campaignBatch`). Spécialisé sur soldat, lancier, archer, chevalier : la correspondance avec les habitants d'Arbestra reste à définir.
- **Séparation proposée (Astra, approuvée par Claude-Opus)** : Arbestra autorise et prépare l'engagement → le moteur résout → Arbestra applique les conséquences (tâche à échéance, sous verrou du village, idempotente). Le moteur ignore tours, pactes et karma. La soufflerie éprouve l'équilibrage, elle ne tourne pas pendant une attaque.
- **Oracle** : choisir d'abord entre « aider le défenseur à gagner » (résolution) et « limiter les conséquences d'une défaite » (conséquences). Pas de multiplicateur arbitraire avant.
- **Pactes (Jean-Michel puis Astra)** :
  - la révocation retire une permission future, sans réécrire le passé : les constructions acceptées sous pacte actif restent ; la permission compte au moment où le serveur accepte la commande ;
  - une permission de construire n'accorde implicitement aucun autre droit (renseignement, commerce, militaire, priorité territoriale) ; bénéficiaires nommés village par village ; aucun effet sur un tiers ;
  - le premier pacte de voisinage autorise les constructions ordinaires, **pas les bâtiments revendicatifs** (une tour demanderait un consentement spécifique), pour qu'une tour posée sous pacte ne contraigne pas ensuite le village qui l'a permise. Claude-Opus retire son idée qu'une révocation coupe les revendications d'une tour ;
  - question de Jean-Michel à Tristan : le pacte permet-il seulement de construire chez l'autre, ou aussi de partager une zone de revendication (quartier commun) ?
- Claude-Opus étudie le moteur en lecture seule avant de proposer un raccord.

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
