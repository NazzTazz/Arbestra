# Arbitrages ouverts — transition V2 (commandes bornées et synchronisation ciblée)

Ouvert le 22 octobre 2026 pendant une session autonome. **Aucun point ci-dessous n'a été tranché à la place de Tristan.** Pour chacun, le code actuel applique l'option la plus conservatrice (parité avec V1 ou statu quo), réversible sans migration destructive. Répondre par numéro suffit ; la suite s'appliquera sans reprendre le contexte.

Statuts : **ouvert** (décision attendue), **tranché** (décision reçue, à reporter dans la spec).

## Tranchés

| # | Sujet | Décision | Report |
|---|---|---|---|
| T1 | Visibilité des convois | Entités publiques et observables du monde ; données commerciales privées ; base de la future dimension militaire. Pas de mécanique militaire maintenant. | Spec §6.1, flux `traffic` (057), mémoire projet |

## Ouverts

### O1 — Portée de la visibilité publique des convois

- **Question** : un convoi est-il observable par tout joueur du monde, ou seulement dans la zone connue/visible du joueur (connaissance, ligne de vue) ?
- **Contexte** : la décision T1 dit « sous réserve des règles de connaissance et de visibilité du monde », mais aucune règle de vue n'existe encore. V1 montre tous les convois actifs du monde.
- **État du code** : tous les convois actifs du monde, comme V1. Un point de filtrage unique existe déjà côté serveur (`visibleConvoys`, `apps/api/src/modules/villages/sync-v2-traffic-readers.ts`).
- **Options** : (a) monde entier jusqu'à la spécification des règles de vue ; (b) limiter dès maintenant aux zones connues du joueur (`knowledgeCoverage`) ; (c) rayon fixe autour des villages du joueur.
- **Recommandation** : (a). Les règles de vue relèvent de la future dimension militaire ; les fixer maintenant risquerait de contraindre ce design. Le filtrage se branchera au point unique sans changer le protocole.

### O2 — Champs publics d'un convoi

- **Question** : l'identité des villages d'origine et de destination fait-elle partie de l'observable ?
- **Contexte** : le flux public transporte id, origine, destination, effectif, trajet et horaires (comme V1). L'offre et la cargaison sont exclues ; une fuite V1 de `offerId` a été corrigée.
- **Options** : (a) conserver origine et destination (le trajet les révèle de toute façon) ; (b) ne publier que trajet, horaires et effectif, l'identité étant une information à découvrir (espionnage, interception).
- **Recommandation** : (a) pour l'instant, par parité ; (b) reste possible plus tard en retirant deux champs du schéma public, si l'identité doit devenir un enjeu de renseignement.

### O3 — Activation de V2 par défaut

- **Question** : quand basculer le village entier sur V2 par défaut (lot I de la spec), et dans quels environnements d'abord ?
- **État du code** : option désactivée par défaut (`localStorage['arbestra:sync-v2']='1'` ou `VITE_SYNC_V2=1`). L'atelier négocie déjà V2 seul quand le serveur l'offre. Migrations 051–057 appliquées uniquement à `arbestra_test`.
- **Prérequis restants** : suppression du GET V1 initial en mode V2, parcours mobile, mesures sur 30 répétitions, application des migrations en développement puis staging.
- **Recommandation** : staging d'abord avec l'option activée côté build (`VITE_SYNC_V2=1`), recette joueur, puis alpha. Chaque étape demande ton accord explicite (migrations et déploiement ne sont pas couverts par l'autorisation de commit).

### O4 — Rythme visible de l'économie en V2

- **Question** : est-il acceptable que l'affichage d'une échéance (fin de lot, récolte…) dépende du planificateur plutôt que de la lecture du joueur ?
- **Contexte** : conforme à la spec (« la progression continue sans navigateur ») ; en V1, ouvrir le village déclenchait un rattrapage. En V2, la fin d'un lot apparaît après le passage du planificateur, puis au plus ~2 s de relève du flux.
- **Recommandation** : accepter ; mesurer la latence réelle échéance → affichage en staging. Les animations client restent indicatives et ne créditent rien.

### O5 — Historique affiché des chantiers d'exploitation

- **Question** : faut-il conserver la limite V1 des 32 chantiers les plus récents ?
- **État du code** : V2 affiche tous les chantiers du flux (la date de création n'est pas transmise). Effet visible seulement au-delà de 32 chantiers.
- **Recommandation** : décision d'interface mineure ; par défaut je transmettrai la date de création pour rétablir la limite V1, sauf avis contraire.
