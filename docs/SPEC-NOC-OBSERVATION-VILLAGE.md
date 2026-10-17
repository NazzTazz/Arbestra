# NOC — Observation d’un village et assistance en direct

17 octobre 2026. Base inspectée initiale : `main`, `6a08fe4`. **Statut : implémentation `74d33e2` installée en staging ; disponibilité publique non validée, promotion alpha bloquée par l’accès VPS.** Tristan a explicitement autorisé commit, push et déploiement après la recette locale. Le [dossier d’implémentation](IMPLEMENTATION-NOC-OBSERVATION-VILLAGE-2026-10-17.md) et le [handoff](../SESSION-HANDOFF.md) distinguent les preuves exécutées, l’incident d’accès distant et les validations restantes. La [revue initiale](REVIEW-NOC-OBSERVATION-VILLAGE-2026-10-17.md) demeure une référence historique.

Références : [NOC V1](SPEC-NOC-V1.md), [diagnostic HTTP](SPEC-NOC-V1-1-DIAGNOSTIC-HTTP.md), [exploitation](architecture/operations.md), [synchronisation du village](architecture/village-synchronization.md).

## 1. Résultat attendu et décisions

Depuis le NOC, un administrateur ouvre le village d’un joueur, observe son évolution, suit éventuellement sa caméra et comprend ses commandes acceptées ou refusées. Exemple : assister Yume pendant un relevé et voir la cible demandée, le reçu de préparation puis le motif du refus, sans lancer une expédition à sa place.

**Validé par la demande :** entrée depuis l’administration, lien vers le village ciblé, observation du village, de la caméra et des actions en direct. Les invariants existants restent applicables : permissions serveur, séparation des sessions, monolithe, préservation des mondes.

**Correction utilisateur du 17 octobre :** « Observer » ouvre la scène du client joueur via un lien d’autorisation. Ce choix remplace la première proposition de renderer hébergé dans le NOC. Le client monde réutilise `VillageScene`, le HUD, le chargement et les assets du jeu, avec un transport d’observation strictement en lecture seule.

**Périmètre retenu par le feu vert d’implémentation :** consultation uniquement, caméra libre ou suivie, fil de commandes serveur, collecte éphémère pendant une observation active, information visible du joueur. Les limites chiffrées ci-dessous sont des garde-fous ; leurs preuves et limites de validation figurent dans le dossier d’implémentation.

**Hors scope :** prise de contrôle, connexion sous l’identité du joueur, replay vidéo, partage public, enregistrement permanent des déplacements, capture du DOM ou du clavier, copie des menus et du curseur, réparation économique et refonte des sciences. Il s’agit d’un rendu synchronisé, pas d’une retransmission de pixels : les animations décoratives peuvent différer entre navigateurs.

## 2. État vérifié avant implémentation et conséquences

| Chemin réel | Capacité et limite actuelles |
|---|---|
| `apps/api/src/modules/admin/auth.ts` | Session administrateur dédiée, cookie hôte seul, HttpOnly, Secure en production, SameSite Strict, chemin `/api/admin`. Privilèges par UUID configuré et `noc:read`. Contrôle d’origine NOC ; ce cookie ne doit pas être transféré au domaine du jeu. |
| `apps/api/src/modules/admin/service.ts`, `apps/admin-web/src/pages.tsx` | Fiches compte/village et diagnostics persistés ; aucune scène d’observation. |
| `apps/api/src/modules/villages/service.ts` | `readVillageProjection()` assemble une projection en transaction de lecture. L’entrée actuelle vérifie le propriétaire avec `ownedVillage()` ; un administrateur ne peut pas l’utiliser directement pour un autre compte. |
| `apps/api/src/modules/villages/sync.ts` | Snapshot, trames et reprise SSE disponibles. Le flux joueur authentifie le propriétaire et peut appeler `reconcileSyncDeadline()` : le réutiliser tel quel ferait exécuter une réconciliation à un observateur. |
| `apps/api/src/modules/worlds/terrain-routes.ts`, `terrain.ts` | Terrain, mises à jour et vues globales autorisés avec la session joueur et ses connaissances. Les routes NOC correspondantes restent à créer. |
| `apps/world-web/src/scene/BabylonVillageScene.ts`, `VillageScene.tsx` | Rendu réutilisable et caméra locale. `App.tsx` fournit actuellement un `onCameraMoved` vide ; aucun flux serveur de pose caméra. Le renderer dépend aussi de chargeurs/UI à examiner avant extraction. |
| `modules/science/expeditions.ts` | Intention, reçu pending/admitted/rejected/failed et activité sont distincts. Une réponse HTTP réussie peut seulement confirmer la mise en préparation. |
| `modules/villages/harvest-submissions.ts` | `harvest-intents` répond HTTP 200 avec `pending: true`, puis le worker produit les listes `accepted` et `refused`. Une intention peut avoir une admission partielle ; l’admission ne prouve pas la récolte achevée. |
| `apps/api/src/app.ts`, `modules/navigation/compute.ts` | Les projections joueur et expéditions partagent un pool de un ou deux workers de navigation. La file réseau actuelle ne distingue pas l’observation des joueurs ; une priorité d’admission reste à ajouter. La révision de synchronisation est mondiale, donc des écritures voisines peuvent invalider une projection. |
| `modules/operations/http-diagnostics.ts` | Diagnostic HTTP borné, pas de journal exhaustif des intentions métier. Les refus client et gestes non transmis ne sont pas observables par ce mécanisme. |

La nouvelle observation doit donc séparer **état métier**, **résultats des commandes** et **présentation client**, avec leur propre fraîcheur. La caméra envoyée par un client ne prouve jamais la présence humaine ou un résultat économique.

## 3. Parcours et interface

1. NOC → Compte → Monde → Village → **Observer le village**. Afficher le monde, le village et le compte avant ouverture.
2. Le bouton ouvre un nouvel onglet NOC `#/observe?worldId=…&villageId=…`. Après autorisation serveur, ce lanceur redirige vers le client monde `/village?world=…&observe=…#observationToken=…` ; la console initiale reste ouverte.
3. Le bail reste privé à l’administrateur. Le jeton aléatoire est valable 30 s, consommable une seule fois, lié à ce bail et à la session admin d’origine. Il figure seulement dans le fragment, retiré immédiatement par le client, puis est échangé contre un cookie observateur distinct, HttpOnly, hôte seul, SameSite Strict et Secure en production, limité au chemin du bail. Ne jamais placer une session joueur/admin durable dans le lien. Un rechargement utilise ce cookie ; copier ensuite l’URL ne transmet aucun accès. Avant consommation, le lien est une capacité sensible et ne doit pas être partagé.
4. Charger le terrain et préparer la même `VillageScene` que le joueur, avec l’écran d’attente du jeu, avant de révéler le village. Un échec propose une reprise sans afficher un village partiellement chargé comme prêt.
5. Afficher en permanence **Observation — lecture seule**, l’identité du village, les horodatages d’état/caméra et le bouton **Arrêter**.

La scène occupe l’essentiel de l’écran. Un panneau latéral rétractable présente les actions et les diagnostics. L’inspection d’un bâtiment ouvre ses informations disponibles ; aucun outil de construction, récolte, affectation, science, rappel ou annulation n’est exposé. Les raccourcis clavier et gestes tactiles de commandes sont également neutralisés.

### Caméra

- Suivi à l’ouverture si une unique source visible fraîche existe ; sinon attente ou choix explicite. La caméra **libre** reste accessible et ne modifie jamais celle du joueur.
- **Suivre le joueur** seulement lorsqu’une source fraîche est disponible. Position canonique, orientation, zoom et mode village/région/monde sont reproduits avec interpolation courte. Les coordonnées respectent les coutures du tore ; les matrices et origines locales Babylon ne constituent pas le protocole.
- Un geste de déplacement administrateur repasse en libre, avec indication visible. Un bouton permet de reprendre le suivi.
- Plusieurs onglets joueur sont affichés comme sources distinctes, avec identifiant éphémère, mode et fraîcheur. Choisir automatiquement seulement s’il existe une unique source visible fraîche ; sinon demander le choix de source. Ne pas basculer silencieusement entre deux onglets.
- Pas de source : « Caméra indisponible ». Onglet masqué : « Onglet en arrière-plan ». Une caméra immobile reste valide tant qu’un heartbeat confirme sa dernière pose et que la source est visible. Après 15 s sans confirmation valide de source, suspendre le suivi et dater la dernière information. Ne pas déclarer le joueur déconnecté à partir de ce seul signal.
- La vue à hauteur d’habitant est explicitement non suivie dans cette V1 : signaler ce mode et suspendre le suivi ; conserver la caméra libre. Aucun faux cadrage présenté comme celui du joueur.

Le joueur voit « Assistance : observation administrative active » tant qu’au moins un bail valide vise ce village. Aucun enregistrement antérieur de caméra n’est récupéré. Cette information n’ajoute pas de confirmation bloquante dans le parcours joueur ; ce choix fait partie du périmètre autorisé à l’implémentation.

### État du village

Le rendu utilise les données du propriétaire ciblé, notamment sa connaissance géographique, pas celles de l’administrateur. L’autorisation d’observer doit être établie séparément de ce contexte de projection. Les stocks et activités privés du village observé sont accessibles au support ; aucune donnée privée supplémentaire des voisins n’est ajoutée.

Le village reste consultable si le joueur ne publie plus de caméra. L’interface indique séparément la fraîcheur de la projection persistée : ouvrir l’observation ne termine pas un chantier ou une fabrication. Les workers continuent normalement ; un retard métier est signalé, pas réparé par le lecteur.

## 4. Fil d’actions et valeur des preuves

Afficher les commandes **reçues par le serveur pendant la collecte**, avec heure serveur, type, cible autorisée, identifiant de commande lorsqu’il existe, référence HTTP, résultat et code de refus sûr. Les informations client ne peuvent pas fournir l’état « accepté ».

Couverture V1 explicite : construction/amélioration/extensions, infrastructure, population, exploitation jardin/bois/pierre, transformation, marché, sciences et soumissions d’expédition. Inventorier chaque route réelle lors de l’implémentation et tester ce catalogue. Toute famille non raccordée apparaît « Non instrumentée » ; une couverture incomplète interdit de déclarer la tranche entièrement livrée.

Pour les commandes synchrones : succès confirmé seulement après le commit métier ; refus métier, erreur serveur et interruption de transport restent distincts. Une interruption ne prouve pas le rollback : indiquer « Résultat non établi » jusqu’à une preuve par reçu/état. Les tentatives d’un même UUID restent consultables mais ne sont pas comptées comme plusieurs opérations économiques.

Le contrat conserve deux axes indépendants : `businessOutcome` (inconnu, en attente, accepté, partiellement accepté, refusé) et `httpOutcome` (en cours, réponse terminée avec statut, transport interrompu). Une erreur de projection ou de sérialisation après commit peut produire « Ordre exécuté, réponse HTTP en erreur » ; elle ne remplace pas une preuve métier déjà acquise. « Accepté » indique l’admission de la commande, pas la fin de ses travaux différés. La preuve du commit est capturée à la sortie réussie de la transaction, avant les opérations de préparation de réponse susceptibles d’échouer. Aucun événement d’admission n’est émis depuis une transaction encore ouverte.

Pour les récoltes asynchrones jardin/bois/pierre : intention reçue → en attente (`HarvestReceipt.pending`) → décision persistée par cible. Reprendre `accepted` et `refused`, y compris lorsqu’elles coexistent, et afficher « Partiellement accepté » avec les motifs par cible. Un HTTP 200 pending signifie uniquement que l’intention est enregistrée. Corréler monde, village, commandId et clés des cibles ; les retries et reconnexions ne créent pas de nouvelle opération. Les crédits et fins de lots restent des faits métier distincts, jamais déduits de l’admission ou du temps écoulé. Les messages de refus sont projetés via un catalogue sûr ; une raison non reconnue reçoit un libellé générique sans exposer d’erreur brute.

Pour les expéditions : HTTP reçu → préparation en attente → admission ou refus/échec, puis activité en cours/terminée/rappelée si une preuve métier l’établit. Corréler par monde, village, commandId et activityId ; ne pas déduire la fin d’activité de sa seule échéance. Reprendre les reçus persistants après reconnexion sans les annoncer comme de nouvelles tentatives.

Les reçus de récolte et d’expédition sont relus indépendamment des projections coûteuses : lot de 64 identifiants au plus, une lecture en vol par village, cadence maximale toutes les 2 s. Suivre les intentions retenues dans la fenêtre bornée du fil ; au-delà, signaler la fin de couverture plutôt qu’accumuler des abonnements. Un reçu retrouvé après reconnexion est une mise à jour d’intention, pas une nouvelle action du joueur.

L’affichage distingue confirmation métier et visibilité dans la scène NOC : « Mise à jour de la scène en attente » tant qu’aucune projection ne prouve l’effet concerné. Une barrière de révision lue après commit peut attester qu’une projection inclut ce commit, sans être présentée comme son identifiant transactionnel. À défaut de preuve corrélée, afficher « Visibilité non établie ». Une séquence du fil ou un timestamp voisin n’est pas une preuve ; même un état appliqué par le NOC ne prouve pas que le navigateur joueur l’a reçu ou rendu. Le suivi caméra ne constitue pas un diagnostic de ses erreurs de rendu locales.

Afficher séparément les transitions de worker issues des données métier, avec source « Serveur », lorsqu’elles sont raccordées. Elles ne sont pas des clics du joueur. La V1 ne promet pas un journal exhaustif de toutes les transitions économiques.

Les clics sans requête, devis locaux et refus dans le navigateur restent hors couverture. La sélection d’un objet peut être envoyée comme présentation client uniquement si son type/id est autorisé ; elle ne fait pas partie du périmètre obligatoire V1.

Au démarrage et après perte de collecte, afficher la date de début de couverture et les trous connus. Aucun historique antérieur n’est inventé à partir de la projection actuelle.

## 5. Architecture et contrats proposés

Conserver le monolithe, PostgreSQL et SSE/HTTP. Aucun Redis, WebSocket ou service supplémentaire requis pour le déploiement actuel à une instance API par environnement. La collecte éphémère porte un `instanceId` ; un redémarrage invalide les baux et annonce une rupture de couverture. Le multi-instance sans affinité est hors scope et doit être refusé ou déclaré non pris en charge, pas simulé.

### API administrateur, même origine NOC

| Route proposée sous `/api/admin/observations` | Fonction |
|---|---|
| `POST /` avec worldId, villageId | Vérifier les droits et la cible ; créer un bail de 30 min maximum. |
| `POST /launch` avec worldId, villageId | Créer le bail et le lien à usage unique vers le client monde. |
| `GET /:id` | Métadonnées, sources, couverture et expiration du bail. |
| `POST /:id/heartbeat` | Maintenir l’intérêt du lecteur, sans dépasser l’expiration absolue. |
| `GET /:id/snapshot` | Projection métier strictement en lecture seule. |
| `GET /:id/events` | Snapshot/trames, reçus, actions, poses et changements de couverture typés. |
| `GET /:id/terrain…` | Adaptateurs des lectures terrain/updates/overviews nécessaires aux trois vues. |
| `DELETE /:id` | Fermer ce bail et ses flux. |
| `POST /:id/follow` | Auditer le choix d’une source ou le retour en libre. |

Chaque requête vérifie la session administrateur, le droit `noc:read`, l’origine, le propriétaire du bail et son contexte. Un UUID de bail n’est jamais une autorisation. Conserver la granularité actuelle ; une permission support distincte pourra être ajoutée ultérieurement. Les POST/DELETE ne mutent que le contrôle d’observation, jamais les tables métier.

Sur l’origine monde, `POST /api/observation/exchange` consomme le jeton et délivre le cookie dédié après revalidation de la session admin en base. Cette étape ne dépend pas des lectures de projection : un retard de lecture ne doit pas consommer le jeton sans délivrer le cookie. Les routes `/api/observation/:id/{snapshot,events,terrain,heartbeat,follow}` et `GET/DELETE /api/observation/:id` réutilisent les mêmes handlers de contrôle et de lecture que le namespace admin. Chaque requête contrôle l’origine monde, le cookie lié exactement au bail, la session admin d’origine et le privilège courant ; les livraisons de données revalident le propriétaire. La révocation coupe aussi les SSE. `WORLD_ORIGIN` fixe l’origine de destination en production ; en développement local seulement, le port 5174 est utilisé à défaut. Aucune session joueur n’est nécessaire à l’observateur, aucune session admin n’est transférée au jeu et ce cookie ne permet aucune commande joueur.

Extraire seulement le minimum nécessaire de l’assembleur de lecture pour accepter un contexte interne autorisé. Ne pas ajouter un `accountId` arbitraire aux endpoints joueur ni un booléen public contournant `ownedVillage()`. Revalider le propriétaire ciblé ; en cas de transfert, arrêter et demander une nouvelle ouverture. Les lectures terrain doivent suivre la même règle.

Réutiliser `villageFrame`, les révisions et la reprise par snapshot. Le lecteur d’observation ne reçoit aucun callback de réconciliation : ni `reconcileSyncDeadline()`, ni `beginVillageEconomy()`, ni initialisation scientifique. Vérifier aussi cette propriété pour les sous-lectures. Partager une collecte par monde/village/propriétaire entre observateurs ; contrôle d’autorisation individuel avant chaque livraison.

### Émission côté joueur

Ajouter des routes authentifiées sur l’origine du jeu, séparées de `/api/admin`, pour ouvrir une source éphémère et publier sa caméra. Le serveur déduit compte, monde et village de la session et de la propriété ; aucune publication au nom d’un autre joueur n’est possible. Vérifier Origin/CSRF selon les conventions des commandes existantes et limiter les tentatives.

Le flux joueur annonce seulement si une observation valide est active pour son village, pas les identifiants ni sessions administrateur. La publication démarre uniquement dans ce cas, s’arrête avec la dernière observation et ne requiert aucune lecture complète supplémentaire du village. Une notification légère ou un heartbeat de contrôle peut compléter le SSE sans attendre une nouvelle révision métier.

Schémas partagés à ajouter dans `packages/contracts` : métadonnées/bail, statut de couverture, source caméra, pose caméra versionnée, événement d’action et enveloppe d’événements avec `instanceId`, séquence et heure serveur. Valider objets fermés, tailles, nombres finis, bornes et modes connus. Une pose porte sourceId et séquence monotone ; ignorer les poses anciennes/doublons et supprimer une source expirée. L’heure client reste informative.

### Protocole caméra V1

Une source est liée côté serveur à la session joueur, au compte, au monde et au village autorisés. Son identifiant n’autorise aucune publication depuis une autre session. L’enveloppe comporte `version: 1`, `sourceId`, `poseSequence` monotone et un mode discriminant. À l’ouverture et au retour visible, envoyer une pose complète ; le heartbeat contient `lastPoseSequence` et la visibilité. Il ne confirme la pose que si cette séquence correspond à la dernière pose validée ; sinon demander une pose complète sans prolonger artificiellement sa validité.

| Mode | Contenu géométrique de la pose |
|---|---|
| `village` / `region` | Cible en coordonnées canoniques fractionnaires `cellX/cellY`, altitude absolue de cible en unités terrain, azimut et inclinaison en radians, distance cible-caméra en unités de case, champ de vision vertical en radians. Convertir depuis/vers le repère local du renderer ; ne pas sérialiser son origine de rebase. |
| `world` | Position de l’œil, cible et vecteur haut dans le repère canonique du tore avant transformation de présentation, champ de vision vertical en radians ; mêmes axes et unité que le modèle torique partagé. Les adaptateurs inversent la transformation de présentation courante. Pas de matrice Babylon ni de coordonnées dépendant du canvas. |
| `inhabitant` | Statut de mode non pris en charge ; aucune pose prétendant reproduire cette vue. |

Normaliser les angles, contrôler les vecteurs non dégénérés et les limites de zoom/FOV du mode courant ; les bornes exactes proviennent des limites du renderer et sont reprises dans les contrats. Les transitions entre modes transmettent une nouvelle pose complète une fois le mode prêt ; pendant la transition, afficher « Changement de vue », sans interpoler deux repères différents. Un canvas d’un autre ratio conserve la cible, la pose et le FOV vertical : le champ horizontal peut différer.

Le serveur distingue `lastPoseChangedAt` (réception d’une nouvelle pose validée) et `lastSourceSeenAt` (réception de cette pose ou d’un heartbeat qui la confirme). Une confirmation de pose immobile renouvelle la fraîcheur de source, pas la date du mouvement. L’interpolation utilise le chemin court sur le tore et reste purement locale. Avant extraction graphique, tester l’aller-retour export/import de chaque mode sur deux scènes avec rebases et dimensions de canvas différents.

### Frontend

Lanceur léger dans `apps/admin-web`, sans renderer ni copie d’assets. `apps/world-web/src/main.tsx` reconnaît le lien, retire immédiatement le jeton et désactive les prélectures joueur ordinaires. `ObservationEntry` monte le même composant `VillageScene` et le même HUD que le jeu, avec `SceneTransport.readOnly`, contrôles neutralisés et suivi caméra ; le contrôleur joueur `App` n’est pas monté. Les assets sont servis par le client monde habituel, sur `alpha` ou `beta`, et le transport passe par le proxy API de cette origine. Ne publier aucune source de caméra joueur depuis l’observateur. Le NOC ne charge plus Babylon.

## 6. Bornes, charge et cycle de vie

- 4 baux par administrateur, 16 au total par instance ; dépassement explicite `429 OBSERVATION_LIMIT`. Un bail sans heartbeat depuis 45 s se ferme ; heartbeat toutes les 15 s tant que la page est visible. L’expiration absolue exige une nouvelle ouverture explicite.
- Caméra : au plus 5 publications de pose/s/source, corps ≤ 2 Kio, dernière pose seule conservée, au plus 4 sources/village. Après la pose initiale, envoyer les poses lors des changements ; heartbeat toutes les 5 s en l’absence de pose envoyée, confirmant sa séquence. Suspendre après 15 s sans confirmation valide, supprimer après 30 s de silence. Lissage local, pas de post à chaque frame. Page masquée : arrêter les poses et publier le statut si possible, avec expiration serveur comme filet. La reprise visible exige une pose complète.
- Actions : anneau par village observé de 500 événements/15 min, plafond global 8 Mio sérialisés. Éviction et limite de taille annoncées ; pas d’écriture SQL supplémentaire dans les transactions économiques. Collecter les résultats hors verrou après preuve du commit ; une perte de collecte ne transforme jamais une commande réussie en erreur joueur.
- Projection : contrôle de révision initialement toutes les 2 s, partagé par contexte, une projection en vol, aucune projection complète par pose caméra. Les lectures auth/receipts restent distinctes et légères. Réutiliser uniquement une projection joueur déjà terminée, de même propriétaire/monde/village, de révision exacte et âgée d’au plus 2 s. Ne pas attendre une projection joueur en vol ni provoquer de lecture réconciliatrice pour remplir le cache NOC.
- SSE : une connexion active par bail et au plus 16 par instance, avec budget global de sortie de 8 Mio en plus du plafond de 1 Mio/connexion. Nouvelle connexion autorisée : remplacer atomiquement l’ancienne et incrémenter sa génération ; les callbacks anciens ne peuvent ni republier ni fermer la remplaçante. Réserver la génération dès l’admission d’ouverture, revalider après les attentes, puis rejeter les ouvertures dépassées. Limiter aussi les ouvertures en cours à une par bail ; les tentatives concurrentes supplémentaires reçoivent 429. Fermer le lecteur lent au dépassement individuel ; au plafond global, fermer d’abord le flux au plus gros buffer puis reprendre par snapshot. Caméra coalescée, aucune accumulation de poses. Un trou d’actions est signalé avec séquence minimale disponible ; une reconnexion ne promet pas de replay au-delà de l’anneau.
- Terrain : au plus 2 lectures en vol par bail, 4 par instance, 5 départs de requête/s/bail avec rafale maximale de 5, en conservant les limites de chunks et de réponse existantes. Pas de file illimitée : 429 avec Retry-After à saturation, regroupement/coalescence des besoins de viewport côté client et abandon des réponses de générations anciennes. Ces plafonds couvrent terrain, updates et overviews ensemble.
- Réauthentifier chaque flux au plus toutes les 10 s, y compris lorsque la projection est lente ; session expirée, retrait de privilèges ou bail clos arrête livraison et émission. Vérifier la fermeture avant/après les attentes pour éviter les abonnements orphelins.

### Admission et dégradation des lectures NOC

L’ouverture et l’actualisation du village ne dépendent pas du réseau de trajets prévisionnels. Le lecteur d’observation utilise le même assemblage cohérent en lecture seule, conserve les infrastructures persistées et les chemins des missions engagées, et omet la recherche des trajets automatiques. Un cache de navigation RC1 froid ou une lane occupée ne doit donc pas empêcher d’inspecter le village, même sans joueur connecté. Aucun nouveau worker ni calcul inline de remplacement. Les trajets prévisionnels peuvent être présents dans une projection joueur fraîche réutilisée ; leur absence dans une lecture autonome ne signifie pas « pas de chemin ».

La préparation de la géographie immuable RC1 se fait après contrôle de propriété et avant la transaction bornée ; le snapshot revalide son identité et lit les modifications locales dans sa vue cohérente. Les cellules restent disponibles au renderer partagé ; la lecture autonome neutralise `canBuild` et omet les coûteuses prévisualisations de construction, sans changer les règles des lectures joueur.

La primitive de diagnostic de navigation existante reste hors du chemin de lecture V1. Si un futur diagnostic l’utilise, il doit conserver les gardes déjà définies : lane libre, aucune demande joueur/expédition prête, un seul calcul NOC actif, annulation coopérative et recherche bornée à 1 s ; refus du cache froid, aucun arrêt du worker partagé. Ce diagnostic facultatif ne conditionne jamais la livraison du village.

Sans capacité DB : conserver le dernier snapshot cohérent et son heure, afficher « Observation retardée », maintenir séparément les flux légers. Sans snapshot initial, répondre 503 avec Retry-After et signaler « Lecture initiale retardée » ; ne pas prétendre conserver un état jamais reçu. Le statut de santé est publié après chaque tentative, et un contrôle réussi retire l’avertissement même si la révision n’a pas changé. Un snapshot ancien n’est pas rebaptisé avec l’heure du dernier contrôle. Un résultat déjà en vol est ignoré s’il n’a plus de lecteur valide.

Limiter l’observation à 2 connexions DB dédiées au total par instance pour les projections, terrains, reçus et contrôles de révision, via une capacité séparée du pool joueur mais le même rôle runtime. Pas d’augmentation silencieuse du plafond global de connexions : réserver cette part dans le budget de déploiement. Authentification et fermeture gardent une voie de contrôle indépendante, partagée par bail et bornée par le nombre de baux/flux. Acquisition DB maximale 500 ms, `statement_timeout=2s`, `lock_timeout=250ms`, `transaction_timeout=4s` pour les transactions d’observation. Toute acquisition tardive après expiration doit être relâchée sans lancer la requête ; les délais ne doivent pas laisser de travail orphelin. Fermer la transaction avant le calcul CPU. Une lecture expirée dégrade le NOC sans modifier le résultat d’une commande joueur.

Ces plafonds sont des garde-fous de conception, pas des mesures. Budget de recette proposé : au plus 5 % de dégradation du p95 des commandes sur scénario isolé reproductible avec/sans observation ; mesurer aussi le délai de mise en calcul/admission des expéditions et leur taux d’expiration. Les tests déterministes doivent prouver qu’aucun travail NOC en attente ne passe avant un travail joueur prêt et qu’un travail NOC actif cède selon son budget ; aucune expiration supplémentaire imputable au NOC n’est acceptable dans le scénario de référence. Publier effectifs, charge, machine et dispersion. Si ces budgets échouent, réduire les collectes ou corriger avant livraison. Ne pas lancer simultanément plusieurs clients de rendu sur le poste pour conclure sur le coût serveur.

## 7. Sécurité, données et exploitation

Refus par défaut, HTTPS, protections NOC existantes conservées ; aucun Basic HTTP ajouté au login joueur. Les routes joueur de publication n’acceptent jamais le cookie admin comme identité joueur. Les routes de commande habituelles conservent intégralement leurs contrôles de propriété : une URL d’observation ne les autorise pas.

Toutes les réponses API d’observation sont `private, no-store`. Seul le jeton de lancement à usage unique peut figurer dans le fragment de l’URL, jamais dans la query ni dans le chemin : il n’est pas envoyé dans les requêtes HTTP ou le referrer, est retiré immédiatement et n’est pas conservé en localStorage. Aucun token de session durable dans le lien. Pas de CORS générique ni iframe du compte cible. Le NOC garde la session admin séparée ; une connexion admin expirée ne bascule jamais sur la session joueur du même navigateur.

Audit serveur structuré des ouvertures, fermetures, expirations, refus et changements de source suivie : acteur administrateur, monde, village, référence d’observation, heure et motif sûr. Pas de log de chaque pose. Durée de conservation et accès des journaux suivent l’exploitation existante ; l’implémentation doit vérifier que le sink configuré permet effectivement de retrouver ces traces après redémarrage. Les actions/caméras éphémères ne sont pas présentées comme un audit durable.

Jamais de mots de passe, cookies, tokens, email, corps HTTP arbitraire, SQL ou erreur brute dans les événements. Mapper chaque commande à une liste explicite de champs utiles ; les intitulés/messages sont contrôlés. Les filtres monde/village/compte sont établis dans les handlers après authentification et validation, jamais extraits librement d’une URL ou fournis par le client comme preuve.

L’arrêt de la dernière observation coupe la collecte et efface poses et anneau du village. Aucun historique persistant ni nouvelle migration métier requis. Un indicateur d’assistance périmé côté joueur se retire au prochain contrôle/à l’expiration de sa dernière information.

## 8. Recette requise

1. **Accès :** anonyme, joueur ordinaire, cookie joueur recopié, mauvais Origin, bail d’un autre admin, couple monde/village incohérent et bail expiré sont refusés. Retrait de privilèges pendant un SSE ferme le flux en ≤ 10 s, indépendamment d’une lecture lente. Vérifier absence de fuite entre alpha et staging.
   Vérifier aussi le parcours NOC → nouvel onglet client monde, l’échange unique même sous tentatives concurrentes, l’expiration à 30 s, le retrait du fragment avant chargement de la scène, le cookie isolé par bail, la reprise sans jeton et l’absence de prélecture/commande joueur. Une lecture DB bloquée après création du lien ne doit pas empêcher la délivrance du cookie ; aucune donnée métier n’est livrée avant revalidation de la propriété.
2. **Lecture seule :** village avec échéances dépassées, workers de test arrêtés : observation, terrain et cycles SSE ne modifient aucune table métier ni notification et ne font pas avancer la révision. Comparer les tables consommées avant/après ; les écritures de sessions/audit sont distinguées. Aucun verrou économique pris.
3. **Commandes :** catalogue de toutes les familles annoncées, preuve d’un succès après commit, refus métier, rollback injecté, erreur serveur et transport interrompu après commit. Injecter aussi une erreur de projection après commit : conserver simultanément l’admission confirmée et l’échec HTTP. Le résultat incertain ne devient pas « refusé ». Deux retries UUID ne créent pas deux opérations. Vérifier l’indication de scène en attente sans assimilation entre séquence d’action, révision et heure.
4. **Cas Yume :** demande de relevé vers une case occupée, reçu pending puis rejected et code sûr affichés avec les bons identifiants ; aucune activité inventée, aucun nouvel ordre de l’observateur.
5. **Synchronisation :** snapshot initial cohérent, trames, doublons, trou, reconnexion, saturation et redémarrage. Ouvrir plusieurs fois un même bail, maintenir une authentification ancienne derrière une barrière, reconnecter rapidement et simuler un lecteur lent. Vérifier une seule connexion active, plafonds globaux, fermeture/remplacement par génération et restitution des ressources. Pas de mélange entre ancienne/nouvelle observation ni de boucle après fermeture pendant authentification/projection. Réutiliser les tests de barrières bornées existants.
6. **Caméra :** deux vrais contextes navigateur distincts joueur/admin ; zoom, rotation, déplacement, couture torique, région/monde et retour en libre. Tester l’aller-retour du protocole par mode avec rebases et ratios de canvas distincts. Garder une caméra immobile une minute avec heartbeats : aucun suivi suspendu ; reprendre le mouvement, retarder un heartbeat de moins de 15 s, puis couper réellement la source pour vérifier suspension à 15 s et suppression à 30 s. Tester source masquée puis réouverte, confirmation d’une mauvaise séquence, deux onglets, poses hors ordre, retrait de la dernière observation et mode habitant indisponible. Aucune écriture caméra ni requête de publication sans observation.
7. **Scène :** terrain prêt avant révélation, vrais bâtiments/actifs, inspection possible, commandes impossibles par boutons, raccourcis, gestes et appels API avec la session admin. Une comparaison visuelle documente les limites de rendu ; ne pas prétendre reproduire les pixels du joueur.
8. **Charge :** mesurer commande, projection, réseau caméra, mémoire des anneaux/buffers et temps de frame séparément. Prouver qu’ouvrir/actualiser un village ne lance aucun calcul de navigation, même à cache RC1 froid et sans joueur connecté. Vérifier les limites DB, une rafale terrain et la reprise après incident sans nouvelle révision. Les gardes de la primitive de diagnostic de navigation restent testées séparément. Deux observateurs d’un même village partagent la projection et la publication de caméra. Une projection joueur fraîche terminée peut être réutilisée ; une projection en vol n’est pas attendue, une projection antérieure au commit requis est refusée. Pas de secrets dans réponses, bundle et logs.
9. **Récoltes asynchrones :** HTTP 200 pending puis refus total ; décision mixte jardin/bois/pierre avec certaines cibles admises et d’autres refusées ; retry UUID ; reconnexion entre dépôt et décision ; dépassement de fenêtre annoncé. Aucun refus perdu, aucune intention en attente ni admission partielle affichée comme récolte achevée. Les fins de lots restent distinctes.

Tests DB uniquement sur cible de test vérifiée, suites réinitialisantes séquentielles. Recette navigateur locale sur comptes dédiés puis staging ; aucun test économique ni action à la place d’un joueur en alpha. Documenter preuves, limites et rollback avant activation par le circuit de déploiement autorisé.

## 9. Ordre d’implémentation et livraison

1. Contrats, contrôle d’accès, admission basse priorité et service de projection sans effets ; tests d’isolation/immutabilité et de concurrence avec les travaux joueur. Valider le protocole caméra par mode avant extraction de la scène.
2. Lanceur NOC, échange d’autorisation et scène du client monde avec terrain et synchronisation en lecture seule.
3. Fil de commandes et raccord des reçus d’expédition et de récolte, résultats partiels et distinction métier/HTTP ; catalogue de couverture testé.
4. Publication caméra à la demande, sélection de source, bannière joueur et suivi.
5. Recette complète, mesure de charge, documentation d’exploitation et préparation du déploiement.

La tranche n’est terminée que lorsque ces trois capacités sont prouvées ensemble : village synchronisé, caméra suivie lorsqu’elle est disponible, actions serveur diagnostiquables. Une livraison intermédiaire caméra libre doit être annoncée comme partielle.

Estimation initiale : **5 à 8 jours de travail**, validation comprise ; elle reste à réévaluer après inventaire des handlers, étude de l’admission/préemption coopérative dans le pool et extraction ciblée du renderer. Elle ne constitue pas un engagement sur la spec corrigée. Risques principaux : dépendances actuelles de la scène au client joueur, protection des calculs joueur, projection strictement sans réconciliation et couverture correcte des résultats après commit. Aucune modification de gameplay incluse.
