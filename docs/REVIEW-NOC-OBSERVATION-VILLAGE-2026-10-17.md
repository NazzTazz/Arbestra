# Revue — NOC observation de village

17 octobre 2026. Spec relue : [SPEC-NOC-OBSERVATION-VILLAGE.md](SPEC-NOC-OBSERVATION-VILLAGE.md), version locale non commitée. Base applicative : `main` / `6a08fe4`. Revue documentaire et lecture du code uniquement ; aucune reproduction de charge, aucun test applicatif ni accès production.

**Avis initial : bonne architecture générale, quatre réserves à traiter avant implémentation.** P1 = résultat métier trompeur ou risque de perturbation du jeu ; P2 = comportement fonctionnel ou borne incomplets. Les conséquences décrites sont des risques déduits du code et de la spec, pas des incidents reproduits de la future fonctionnalité.

**Suivi d’implémentation :** le feu vert ultérieur autorise la tranche corrigée jusqu’à revue humaine. Le [dossier local](IMPLEMENTATION-NOC-OBSERVATION-VILLAGE-2026-10-17.md) remplace les mentions ci-dessous « preuves à produire » pour connaître les tests effectivement exécutés, sans transformer cet avis initial en approbation humaine. Budget de charge et recette de saturation restent explicitement à valider avant déploiement.

**Suivi du 17 octobre : recommandations intégrées à la spec sur demande de Tristan.** R1 : admission basse priorité, annulation coopérative à prouver, bornes DB et dégradation NOC (§6). R2 : récoltes pending et décisions partielles, reçus et preuves séparées métier/HTTP (§4). R3 : heartbeat confirmant la pose, fraîcheur de source à 15 s et protocole par mode (§3/§5/§6). R4 : une connexion par bail, générations et budgets globaux SSE/terrain (§6). La recette §8 couvre ces quatre points et les compléments de corrélation/scène. Les numéros de lignes ci-dessous désignent la version initiale relue. Réserves traitées **dans la spécification uniquement** ; les preuves d’implémentation restent à produire. La bannière joueur et l’exclusion du mode habitant restent des propositions produit distinctes.

## R1 — P1 : la protection du calcul de navigation n’est pas définie

Spec §5/§6, lignes 95 et 114–118. Deux projections simultanées côté observation ne suffisent pas à préserver les joueurs. `readVillageProjection()` (`apps/api/src/modules/villages/service.ts:470`) utilise `compute.network()` ; `apps/api/src/app.ts:82` partage le même `NavigationCompute` entre les projections joueur et le coordinateur d’expéditions. Le pool possède un ou deux workers, une file réseau FIFO et aucune priorité NOC/joueur (`modules/navigation/compute.ts`). `ExpeditionCoordinator` attend une lane disponible avant acquisition d’une demande, alors que les demandes ont déjà une date d’expiration.

Scénario : plusieurs villages observés deviennent invalides après des écritures du monde. Deux projections NOC peuvent occuper toutes les lanes et prolonger l’attente des projections joueur et des expéditions. Le contrôle des révisions est mondial (`modules/villages/sync-revision.ts`), donc l’activité d’un voisin peut également entraîner ces recalculs. La cible de p95 +5 % ne définit pas le comportement à saturation ni ne mesure les expirations d’admission asynchrone.

**Correction recommandée :** définir une admission basse priorité des calculs d’observation et leur budget ; partager les projections déjà en vol avec le jeu lorsque leur contexte et fraîcheur conviennent ; ne jamais basculer sur le calcul inline dans le thread API. À saturation, servir l’état daté avec statut dégradé ou refuser temporairement la lecture NOC. Définir aussi les bornes SQL/pool de ces nouvelles lectures. Éviter de réserver automatiquement un nouveau worker sans mesurer la machine cible.

**Preuve attendue :** un worker volontairement occupé, plusieurs observations et une nouvelle expédition ; vérifier l’ordre d’admission, la dégradation NOC et l’absence de starvation des joueurs. Mesurer aussi le délai et le taux d’expiration des expéditions, pas seulement le p95 HTTP.

## R2 — P1 : les récoltes asynchrones et leurs résultats partiels sont absents du modèle

Spec §4, lignes 63–67 et recette ligne 136. L’exploitation est déclarée couverte, mais seul le cycle asynchrone des expéditions est spécifié. Le vrai endpoint `POST …/harvest-intents` (`modules/villages/routes.ts:88`) répond HTTP 200 avec `pending: true`. Le worker produit ensuite un `HarvestReceipt` contenant des listes `accepted` et `refused`, qui peuvent coexister (`modules/villages/harvest-submissions.ts`). C’est un parcours utilisé par le client, pas un chemin historique dormant (`apps/world-web/src/api/client.ts:8`).

Un journal construit sur « succès HTTP après commit » pourrait annoncer une récolte acceptée alors que seul le dépôt de l’intention est validé, puis manquer les refus par cible. Le raccord des seuls reçus d’expédition ne couvre pas cette différence.

**Correction recommandée :** ajouter explicitement le cycle intention reçue/en attente → décision par cible, dont admission partielle ; raccorder les reçus de récolte persistés et distinguer admission des lots et exécution économique ultérieure. La déduplication doit conserver la structure par cible, sans convertir un succès partiel en réussite globale.

**Preuve attendue :** HTTP 200 pending puis refus total ; admission mixte jardin/bois/pierre ; retry UUID ; reconnexion entre dépôt et résultat. Aucun refus ne doit disparaître et aucune intention en attente ne doit être libellée « récolte exécutée ».

## R3 — P2 : une caméra immobile devient périmée selon les règles écrites

Spec ligne 48 : absence de pose depuis 5 s = suspension du suivi. Ligne 112 : ne publier une pose que lorsqu’elle change, avec un heartbeat de source au plus toutes les 5 s. Le heartbeat ne renouvelle pas explicitement la validité de la dernière pose. Un joueur qui ne bouge pas la caméra peut donc perdre le suivi, ou provoquer un clignotement avec la moindre latence.

**Correction recommandée :** séparer `lastPoseChangedAt` et `lastSourceSeenAt`. Un heartbeat confirme la dernière séquence de pose toujours courante ; une source vivante et visible garde sa pose immobile valide. Choisir un délai de silence supérieur à la cadence de heartbeat, avec marge réseau. Envoyer immédiatement une pose complète à l’ouverture de source et au retour visible.

**Preuve attendue :** caméra immobile une minute, mouvement repris, heartbeat retardé, onglet masqué puis réouvert. Pas de suspension durant l’immobilité normale ; suspension réelle en cas de perte de source.

## R4 — P2 : les limites de baux ne bornent pas les connexions

Spec lignes 111 et 115. Le plafond de 16 baux ne fixe pas le nombre de `GET /:id/events` ouverts sur un même bail. Chaque connexion peut conserver jusqu’à 1 Mio et exiger sa réauthentification. Même avec une projection partagée, le nombre de sockets, buffers et contrôles DB demeure non borné par la spec. Des reconnexions qui se chevauchent suffisent à faire apparaître ce problème sans supposer un client malveillant.

**Correction recommandée :** une connexion SSE active par bail, avec génération de connexion ; la nouvelle remplace atomiquement l’ancienne. Fixer également un plafond global de flux et un budget global de buffers, ainsi que les bornes de concurrence/rate limit des lectures terrain par bail. Les limites de taille d’une réponse terrain ne bornent pas le nombre de requêtes concurrentes.

**Preuve attendue :** ouverture répétée du même bail, connexion ancienne suspendue pendant l’authentification, reconnexions rapides et lecteur lent. Le nombre de flux et la mémoire restent bornés ; un ancien callback ne réouvre pas de connexion ni ne ferme sa remplaçante.

## Compléments utiles, sans changer le produit

- Conserver deux axes pour une action : résultat métier et livraison HTTP. Le code peut déjà committer puis échouer dans `commandResponse()` (`modules/villages/routes.ts:73`). « Ordre exécuté, réponse en erreur » doit être représentable. La spec pose le bon principe de preuve après commit, mais les futurs contrats devront préserver les deux faits.
- Indiquer quand une action confirmée n’est pas encore reflétée dans la scène. Les séquences d’événements, révisions de snapshot et timestamps n’ont pas la même signification ; leur proximité ne prouve pas que le client joueur a appliqué un état. La caméra suivie ne diagnostiquera pas à elle seule un bug de rendu propre au navigateur joueur.
- Fixer les champs du protocole caméra par mode et tester leur aller-retour avant l’extraction graphique. Le code actuel utilise notamment les repères de `torus-camera.ts` ; « orientation et zoom » reste trop abstrait pour valider l’équivalence des vues village et monde.

## Points solides et portée de la revue

La session admin séparée, l’origine NOC, l’absence de jeton dans le lien, les contrôles serveur, la lecture sans réconciliation, le contexte de connaissances du propriétaire, la reprise SSE, les données inconnues explicites et l’absence de journal permanent de caméra forment une base cohérente. Aucune refonte de l’architecture générale n’est nécessaire pour lever les réserves.

Le suivi de caméra fournit une vue reconstruite ; les menus et refus purement client restent exclus de manière explicite. La bannière joueur et l’exclusion du mode habitant restent des propositions produit de la spec, pas des décisions supplémentaires prises par cette revue.

L’estimation 5–8 jours reste indicative : les raccordements des résultats métier et l’extraction de la scène demandent un inventaire plus précis avant engagement. La revue initiale ne modifiait pas la spec ; sa correction ultérieure autorisée est consignée en tête de ce rapport. Aucune implémentation ou opération en production n’a été effectuée.
