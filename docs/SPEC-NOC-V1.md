# NOC Arbestra — V1 en lecture seule

15 octobre 2026 — base relue `9c8dde4`, branche main. Statut : V1 utilisable et vérifiée localement, domaine public non déployé. Architecture et runbook : [opérations](architecture/operations.md). Les résultats terminés et limites de recette figurent dans le [handoff courant](../SESSION-HANDOFF.md).

## Résultat et périmètre validés

Console `admin.arbestra.world`, intégrée au monolithe : React dans `apps/admin-web`, endpoints Fastify dans `modules/admin`, contrats partagés. Consultation de toute l'installation et navigation monde → village/compte → activité → diagnostic. Aucun changement de ressources, bâtiments, monde ou activité depuis le NOC. Les quatre espaces sont Infrastructure/Overview, Mondes, Comptes/support et Administration future.

La V1 observe le processus API qui répond, les workers qu'il possède, les connexions SSE qu'il héberge et les données partagées PostgreSQL. Elle ne prétend pas découvrir d'autres machines ni superviser un processus externe sans instrumentation. Le générateur externe reste explicitement inconnu ; les métadonnées persistées des mondes restent consultables. Une mesure absente vaut `null`/inconnu, jamais zéro inventé.

## Architecture retenue

- `modules/operations` collecte HTTP, processus, erreurs classées, cycle scheduler/navigation et SSE. Séries et incidents bornés en mémoire, identifiés par instance/démarrage ; aucune promesse de conservation après redémarrage ni d'agrégation multi-instance. L'instrumentation est associée au serveur HTTP `app.server`, commun aux plugins Fastify encapsulés.
- `modules/admin` lit uniquement les projections de support et agrégats métier. Transactions `READ ONLY`, délais SQL bornés, listes limitées, cache de 15 s, une collecte partagée par clé et quatre collectes distinctes simultanées au maximum. Aucun appel aux commandes, réconciliations ou projections qui déclenchent l'économie.
- Une sonde PostgreSQL séparée borne connexion et requêtes ; elle ne prend pas de verrou métier. Les statistiques n'exposent ni texte SQL, ni chaînes de connexion, ni erreurs internes brutes.
- Contrats JSON distinguent mesures techniques, métriques métier, événements d'exploitation et diagnostics. Les commandes administratives futures auront leurs propres permissions, validations métier, idempotence et journal durable ; aucun endpoint de mutation métier V1.
- Frontend même origine pour `/api/admin`, servie en production par reverse proxy HTTPS. Développement sur 5175. Pas de nouvelle base, Redis, Kafka ni service indépendant.

## Sécurité

Liste explicite `ADMIN_ACCOUNT_IDS` d'UUID de comptes préexistants maîtrisés ; vide signifie refus par défaut. Aucune élévation par adresse email. Vérification serveur à chaque endpoint. Sessions admin séparées des sessions joueur, cookie host-only HttpOnly, Secure en production et SameSite strict ; origine contrôlée sur création/suppression de session. Limitation des tentatives de connexion, traces structurées d'accès/refus sans mot de passe, token, cookie ou requête utilisateur dans les journaux dédiés. Les lectures réussies restent dans ces logs ; `ADMIN_ACCESS` est exclu du tampon d'incidents pour que les rafraîchissements ne chassent pas les erreurs. Connexions, déconnexions et refus restent dans le tampon borné.

Le proxy n'expose que l'application et `/api/admin`, jamais les routes privilégiées historiques du générateur ni les endpoints de jeu sous ce domaine. La confiance proxy est explicite, jamais tous les proxies. Protection indépendante par VPN ou contrôle d'accès recommandée pour l'alpha. Aucun compte réel n'est privilégié automatiquement pendant l'implémentation.

## Sémantique des indicateurs

| Indicateur | Source / limites |
|---|---|
| API disponible | Réponse de l'instance courante ; ne suffit pas à déclarer l'installation saine. |
| PostgreSQL | Sonde réelle et délai observé ; indisponible en échec, détails internes masqués. Une panne complète peut aussi bloquer la validation de session avant cette lecture : le NOC ne constitue pas une supervision hors bande. |
| HTTP | Fenêtre glissante de cinq minutes, compteurs et percentiles sur échantillon borné signalé ; flux SSE séparés des requêtes courtes. |
| CPU / mémoire | CPU processus en pourcentage d'un cœur (peut dépasser 100), RSS/heap du processus courant ; CPU inconnu avant premier intervalle. |
| Workers | État réellement observé, succès/erreur et fraîcheur ; processus externe sans heartbeat : inconnu. |
| Présence | Connexions SSE et comptes distincts sur cette instance ; ni joueurs actifs ni sessions authentifiées. |
| Expéditions | Totaux exacts du périmètre pour demandes en préparation et activités exploration/relevé en cours. Admis, terminées, refus et échecs sont comptés dans les 1 000 derniers reçus au maximum ; taille/troncature explicites. Une admission n'est pas une fin d'expédition. |
| Retard scheduler | Notification encore due, pas preuve à elle seule d'une transition métier non accomplie. |
| Activités / historique | Listes bornées de reçus d'expédition récents, sciences en cours et notifications en attente ; détails persistés accessibles par identifiant. Incidents runtime depuis démarrage, sans journal exhaustif des activités achevées. |

Les séries temporelles proviennent exclusivement d'échantillons observés. Le statut agrégé conserve les états dégradé, indisponible et couverture inconnue. L'interface montre la date de collecte, les données périmées, chargements, refus et reprises.

## Critères d’acceptation

1. Anonyme refusé ; joueur ordinaire refusé ; administrateur autorisé par ID ; révocation effective à la requête suivante après application de la nouvelle configuration et redémarrage des instances ; token joueur non accepté comme admin.
2. Connexion bornée et limitée, origine/cookies testés ; réponses et événements sans secrets internes.
3. Agrégats multi-mondes exacts sur fixtures privées ; toutes les consultations sans modification métier, aucun reset de base.
4. Mesures réellement variables sous requêtes ; erreurs et panne de sonde présentées sans faux vert ; stockage mémoire borné et fin des observateurs à l'arrêt.
5. Parcours navigateur login → overview → monde → village/compte/activité, filtres, erreurs et affichage responsive.
6. Types, lint, builds et tests liés terminés avec succès. Le déploiement DNS/TLS public reste une opération d’exploitation distincte. L’accès local a été attribué au compte existant explicitement choisi par Tristan, par son UUID dans la configuration ignorée.

## Vérifications du 15 octobre 2026

37 tests NOC et 12 tests connexes de synchronisation passent, soit 49 cas distincts. Ils couvrent les limites d’accès, cookies/origine, séparation des tokens, révocation, limitation des tentatives, isolation multi-mondes, lectures économiques sans écriture, précision des stocks, borne des métriques, panne de sonde et flux SSE réel. Le cas SSE a été renforcé puis rejoué : une connexion/un compte sur le bon monde, exclusion des requêtes HTTP courtes, retour à zéro après fermeture. Fixtures privées nettoyées dans `arbestra_test`, aucun reset de base ni migration NOC.

Build, lint et typecheck du monorepo terminés avec succès ; avertissement existant sur les gros chunks du client monde. Recette navigateur locale : connexion/déconnexion, overview, infrastructure, filtre monde, monde → village → compte → activité/diagnostic, recherche compte, monde absent avec reprise, desktop et viewport 390 × 844. Aucune erreur JavaScript observée. Le proxy Vite a été corrigé après reproduction réelle d’un refus d’origine ; la règle serveur reste stricte.

La recette ne constitue pas une preuve de charge/endurance ni un déploiement public. Historique runtime en mémoire, couverture externe explicitement inconnue, absence d’alerting hors bande et de mutation métier maintenues.

## Hors scope

CRUD administratif, sanctions, invitations, maintenance et mutations de monde ; collecte multi-hôtes, historique longue durée, alerting externe, refonte des mécanismes de synchronisation. Les espaces futurs expliquent leur indisponibilité sans boutons simulant une action.
