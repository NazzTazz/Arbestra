# Profil du pipeline de construction RC1 — 10 octobre 2026

Base mesurée : `9a6e68ede99c8bd44e9e055d80bf92130ce47d16`. Demande : mesurer la lenteur de création d'un bâtiment. **Diagnostic seulement : aucune correction applicative dans cette tranche.** Bressuire est consulté en lecture seule ; les commandes de test concernent deux mondes UUID jetables, ensuite nettoyés.

## Résultat principal

Deux coûts se cumulent : des lectures village peuvent s'empiler avant la construction, puis la commande reconstruit son terrain et le snapshot complet avant de répondre. Les écritures du bâtiment lui-même ne dominent pas les mesures à chaud.

### Constructions récentes de Bressuire

Les horodatages persistés donnent le temps entre début de transaction et borne économique : `construction_started_at - buildings.created_at`. `created_at` utilise `now()` (début de transaction) ; la borne est lue après les verrous village et navigation. Ce délai inclut donc lecture du propriétaire, attente des deux verrous et leurs allers-retours ; **ce n'est ni la durée totale du clic, ni une mesure exclusivement du verrou village**.

| Bâtiment, début UTC | Avant la borne après verrous | De la borne au reçu de commande |
| --- | ---: | ---: |
| Tailleur de pierre, 20:23:17 | **22 732 ms** | 207 ms |
| Scierie, 20:27:35 | **17 480 ms** | 373 ms |
| Scierie, 20:28:21 | **41 ms** | 444 ms |

Le reçu est créé avant les validations de pose et le snapshot final. Ces chiffres ne permettent pas de dater le commit ou l'affichage. Ils établissent néanmoins que deux lenteurs commencent bien avant la création du bâtiment. Une observation `pg_stat_activity` montre aussi une transaction en cours et plusieurs autres lecteurs attendant `villages … FOR UPDATE` ; faute de corrélation par requête, ne pas attribuer cette observation à un POST précis.

### Empilement des lectures confirmé dans le client

`App.refresh()` vérifie seulement `actionInFlight`, sans garde pour une lecture déjà en vol. L'intervalle est de **500 ms** dès qu'un chantier/une transition rapide existe, 2 s pour certaines activités, 10 s sinon. Les événements focus/visibility peuvent aussi demander une lecture. Une commande arrête les nouveaux rafraîchissements, mais les précédents continuent.

Reproduction navigateur avec le **vrai App**, scène substituée, snapshot contenant une maison en construction, réponses GET suivantes volontairement retenues : **8 lectures village simultanées**, intervalles principalement entre 446 et 557 ms. Aucune mutation ni lecture métier réelle. Le test n'invente pas une latence serveur ; il vérifie que le client permet l'accumulation lorsque le serveur ralentit. Première tentative invalide à cause d'une interception trop large des imports `/src/api/` ; corrigée avant la mesure exploitable.

Les GET village prennent eux-mêmes le verrou économique. Déduction : une commande envoyée après ces GET peut attendre leur traitement en série. Le fait de préchauffer la géographie ne corrige pas cet empilement.

## Décomposition d'une pose sans contention

Fixture RC1 canonique, HDV seul `(140,20)`, maison en troncs `(142,20)`. Un GET village est terminé avant cette série, pour reproduire un joueur déjà entré et persister sa première connaissance du terrain. Le chemin exact du HUD est `constructBuildingArea`, même pour une case.

Chronométrage de fonctions dans une **copie compilée ignorée** du service, sans modification des sources applicatives. Les mêmes règles et SQL s'exécutent ; seules des entrées/sorties de fonctions sont chronométrées. Chaque commande instrumentée produit effectivement sa maison et son snapshot, puis une exception sentinelle annule la transaction. Vérification après rollback : seul le HDV subsiste. Les durées de fonctions imbriquées ne sont pas additionnables.

Troisième passage stabilisé :

| Phase | Durée |
| --- | ---: |
| Début, autorité, verrous, économie, reçu et définition | ~85 ms |
| Validation de l'emprise | **162 ms**, dont terrain 109 ms |
| Débit, insertion, occupation, tâche et reçu final | **32 ms** |
| Reconstruction du village retourné | **1 084 ms**, dont terrain 161 ms |
| Total de la commande instrumentée, rollback compris | **1 365 ms** |

127 requêtes ; aucun transfert de l'artefact immuable (cache vérifié actif). Attente de la requête de verrou village : 3 ms ; verrou navigation : 1 ms. Le snapshot final représente environ **79 %** du total de ce passage.

Deux POST Fastify réels, module de service **non instrumenté**, même payload que le HUD, commits effectifs sur cette fixture, schéma préchauffé par un GET : **HTTP 201 en 1 251 puis 1 129 ms**, 128 requêtes chacun. Temps après fin du commit jusqu'au retour de `inject` : 45 puis 16 ms. Authentification, validation JSON et sérialisation sont incluses ; transport TCP et navigateur ne le sont pas. Réponses d'environ 63 Ko.

### Variabilité à ne pas masquer

Les deux premiers passages du même chemin après GET ont pris **27 724 et 10 767 ms**, malgré zéro transfert de l'artefact et seulement 1–3 ms de verrous. La lecture des modifications forestières de `readRc1Ground` a été comptée entre **9,50 et 15,16 s** dans le chronométrage du driver. Elle revient deux fois : validation, puis snapshot retourné. Au troisième passage, ces lectures sont à 32 et 56 ms.

Le chronométrage driver englobe exécution, transfert, décodage et disponibilité de la boucle Node ; il ne prouve pas une exécution PostgreSQL lente à lui seul. `EXPLAIN (ANALYZE, BUFFERS)` ultérieur sur Bressuire : jointure de 2 018 lignes, **8,89 ms d'exécution**, 17,29 ms de planification, hash join, toutes les pages en cache. Ce plan chaud n'explique pas rétrospectivement les pointes sur la fixture fraîche. Le plan effectif pendant une pointe et la contribution de la charge locale restent à capturer ; aucun index ou changement de règle n'est prescrit sans cette preuve.

Une première série exploratoire utilisait l'ancien endpoint par cellule sans GET préalable. Son premier passage a pris 45,5 s ; les suivants ~5 s, dont ~4,5 s dans `state()`. Les insertions initiales de `science_places` revenaient après chaque rollback. Cette série n'est **pas** présentée comme le coût courant d'une construction sur un village déjà ouvert. Le chemin HUD avec GET préalable ci-dessus est la référence utile.

## Pipeline client et limite de mesure

Lecture du code : geste validé → `executeConstruction` → POST immédiatement, sans temporisation volontaire ; timeout de protection à 15 s. La réponse contient tout le village ; `applySnapshot` l'accepte, puis `VillageScene` appelle le renderer au prochain `requestAnimationFrame`. Un timeout client ne supprime pas la transaction serveur ni les lectures déjà engagées.

**Le délai clic → premier pixel du nouveau bâtiment n'a pas été chronométré.** La recette navigateur de cette tranche prouve le chevauchement des lectures, pas le coût du picking, de React ou de Babylon. Les chiffres serveur ne doivent pas être annoncés comme une latence visuelle complète.

## Corrections recommandées, non implémentées

1. Une seule lecture village en vol par client/contexte, regroupement des demandes de rafraîchissement et temporisation depuis la fin de lecture. Conserver la protection contre les anciens snapshots et les changements de monde ; ne pas considérer un fetch annulé comme une transaction serveur annulée.
2. Réutiliser un contexte terrain à l'échelle de la commande : `assertBuildableCells` fabrique actuellement une région 64 × 64 pour une maison d'une case, puis `state()` recommence. Garder les occupations et permissions autoritaires après les verrous, sans cache global d'état dynamique.
3. Capturer plan PostgreSQL et retard de boucle Node pendant une pointe de lecture forestière avant de décider une optimisation SQL. Le préchauffage seul ne traite pas les délais observés avec cache déjà chaud.

## Reproductibilité et état

Scripts et traces locaux ignorés : `test-results/profile-construction.mjs`, `profile-construction-area.mjs`, `profile-construction-history.mjs`, `profile-construction-polling.mjs`, `profile-construction-explain.mjs`, `construction-*.json`. La copie instrumentée est `apps/api/dist/modules/villages/service-profile.mjs`, ignorée. Deux fixtures terminées et nettoyées ; aucun reset, migration ou ordre économique dans Bressuire. Les services utilisateur sont conservés. Pas de suite applicative relancée : aucun code produit modifié. Ce document et le relais constituent la livraison de diagnostic.
