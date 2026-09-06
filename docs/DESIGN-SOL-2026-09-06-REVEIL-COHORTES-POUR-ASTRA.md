# Note de design pour Astra — rendre le réveil des cohortes lisible

Date : 6 septembre 2026. Auteur : Sol, à la demande de Tristan. Statut : **proposition en cadrage**. Cette note n'autorise ni implémentation gameplay supplémentaire, ni migration, ni modification des données.

## Problème joueur observé

Tristan a vu ses 800 habitants à `Énergie 7`, tous « au repos » et aucun disponible. Le repos était automatique, mais l'interface ne disait ni pourquoi ils dormaient, ni depuis quand, ni quand ils reviendraient. L'absence de lits et de bois donnait alors l'impression d'un soft-lock.

La lecture seule de la base a montré un état cohérent : plusieurs cohortes sans affectation, endormies automatiquement à quelques minutes d'intervalle, avec des réveils prévus entre 20 h 45 et 20 h 52. La forte synchronisation vient ici de l'ajout manuel massif d'habitants ; le problème de compréhension existe néanmoins aussi avec une population normale.

Un défaut distinct de rafraîchissement a été corrigé dans le worktree : tant que des habitants sont au repos, le front redemande maintenant un snapshot toutes les dix secondes. Cela actualise l'état, mais ne l'explique pas.

## Existant prouvé

- Le serveur conserve pour chaque cohorte `memberCount`, l'activité, l'énergie exacte, `energyUpdatedAt` et `restingSince`.
- Un repos continu se termine cinq heures après `restingSince`. Le calcul serveur projette déjà automatiquement le retour à `idle`.
- Le contrat public ne livre que les totaux `available`, `working`, `resting` et `energyCounts`. Il ne permet donc pas au client de calculer honnêtement les échéances de réveil.
- `serverTime` et l'offset serveur sont déjà utilisés dans le front pour les autres comptes à rebours.
- Les cohortes sont des groupes techniques, pas des personnes ni des identités à exposer au joueur.
- Les couchages sont actuellement une capacité informative dérivée des bâtiments ; il n'existe pas d'attribution individuelle des lits et le manque de couchages ne bloque pas le repos.

## Résultat UX recommandé

Le bouton population du HUD doit signaler un sommeil en cours sans devenir anxiogène : petite lune ou `zzz`, puis texte court tel que `800 dorment · prochain réveil 59 min`.

Le panneau Habitants devrait contenir une section **Au dortoir** :

- une phrase principale : `136 habitants se réveillent dans 58 min` ;
- si plusieurs vagues existent : les deux ou trois prochaines, puis `+ N autres vagues` ;
- une conclusion stable : `Tout le monde debout vers 20 h 52` ;
- lorsque l'heure approche : `Réveil imminent…`, puis disparition automatique de la vague au snapshot suivant.

Pour une population très fragmentée, ne pas afficher vingt lignes presque identiques. Regrouper visuellement les réveils proches dans une fenêtre d'une minute est acceptable, à condition que le serveur fournisse les échéances exactes et que ce regroupement reste uniquement de présentation.

La jauge d'énergie peut rester complémentaire, mais ne doit pas servir d'horloge : `Énergie 7` ne permet pas de déduire la fin d'un repos volontaire, qui reste qualifié par cinq heures continues.

## Contrat minimal proposé

Étendre le résumé population du snapshot avec des vagues de repos, sans IDs techniques :

```ts
restingWaves: Array<{
  memberCount: number;
  wakesAt: string; // date ISO absolue, autorité serveur
}>;
```

Le serveur projette d'abord les cohortes à la borne économique du snapshot, élimine celles déjà réveillées, puis agrège les états ayant exactement la même échéance. Le client utilise `serverTime`/`serverOffsetMs` pour l'affichage relatif et peut regrouper davantage les lignes uniquement pour la lisibilité.

Cette forme est préférée à un seul `nextWakeAt` : elle permet d'annoncer combien de personnes reviennent et d'afficher la dernière vague sans exposer les cohortes. Si la taille du JSON devient mesurable, une synthèse bornée (`nextWaves` + `lastWakeAt`) pourra être décidée sur données réelles plutôt que préventivement.

## États et textes utiles

| État | Présentation suggérée |
|---|---|
| Personne au repos | Ne pas afficher la section dortoir. |
| Une vague | `15 dorment · réveil dans 2 h 14` puis l'heure locale en détail. |
| Plusieurs vagues | Prochaines vagues avec effectif ; `Tous réveillés vers HH:mm`. |
| Moins d'une minute | `Réveil imminent…` plutôt qu'un compteur nerveux à la seconde. |
| Snapshot en retard ou requête échouée | Garder la dernière heure connue et signaler discrètement que l'état se resynchronise ; ne pas inventer le réveil côté client. |
| Population au-dessus des couchages | Avertissement séparé `N couchages manquants`, sans prétendre que cela retarde le réveil dans les règles actuelles. |

Les libellés doivent distinguer `au travail`, `disponibles` et `au repos`. Éviter « indisponibles » seul, qui ne dit pas si les habitants travaillent ou dorment.

## Décisions

### Validé par l'observation et le code

- Le joueur doit pouvoir savoir quand les cohortes se réveillent.
- Le serveur reste l'autorité temporelle.
- Le rafraîchissement doit continuer pendant le repos.
- Le manque de couchages ne doit pas être présenté comme la cause du sommeil avec les règles actuelles.

### Proposition de Sol

- Exposer `restingWaves` dans le snapshot.
- Résumer le prochain effectif et l'heure du dernier réveil dans le panneau ; signal plus compact dans le HUD.
- Arrondir seulement la présentation, jamais les échéances métier.

### Ouvert pour Astra et Tristan

- Ton final : « dortoir », « repos », ou une formulation plus diégétique liée au village.
- Afficher ou non toutes les vagues au-delà des trois premières.
- Ajouter plus tard un réveil anticipé. Ce serait une nouvelle règle gameplay avec conséquences sur le quota alimentaire ; ce n'est pas nécessaire pour résoudre le problème d'information.
- Donner ultérieurement un effet réel au manque de couchages. Ne pas le coupler à cette tranche d'affichage sans arbitrage gameplay explicite.

## Tranche d'implémentation suggérée

1. Ajouter `restingWaves` au contrat partagé et au snapshot serveur, calculé depuis les cohortes projetées à la même borne.
2. Tester les vagues : une échéance, plusieurs échéances, cohorte déjà réveillée, longue absence, absence d'IDs techniques.
3. Afficher le prochain réveil et `tous réveillés vers…` dans `PopulationPanel`, puis un signal compact dans `Hud`.
4. Utiliser l'horloge serveur existante ; conserver le polling uniquement tant qu'une vague reste présente.
5. Vérifier au navigateur les passages `1 min → imminent → disponible`, plusieurs vagues et surcapacité de couchages.

## Critère d'acceptation joueur

En ouvrant le panneau Habitants alors que tout le monde dort, Tristan peut répondre immédiatement à trois questions : **combien dorment, quel groupe revient ensuite, et à quelle heure tout le monde sera de nouveau disponible**, sans confondre énergie, couchages et durée du repos.

## Git

Note documentaire uniquement. Aucun code, test applicatif, accès en écriture à la base, commit ou push au titre de cette note.
