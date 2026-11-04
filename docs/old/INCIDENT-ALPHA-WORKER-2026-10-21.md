# Alpha : reprises de récolte et saturation CPU

21 octobre 2026. Release observée : `a32c1fe40e02f0a10cb1e11d26fbceab19934469`.

**Suite autorisée par Tristan :** publication complète depuis `main` en staging et alpha, construction rapide comprise, puis correction du trajet. La préparation du hotfix isolé ci-dessous reste une preuve ; elle n'est plus le périmètre de publication demandé. L'état effectif du déploiement figure dans le handoff courant.

## Stabilisation appliquée

À 09:05 UTC, l'API alpha PID 3238354 affichait 98,9 % CPU moyen depuis son démarrage ; six notifications `harvest.intent` échouaient continuellement, avec 5 585 à 5 587 tentatives, sur « Calcul du trajet interrompu. Réessayez. ». Elles appartiennent à Pinkystan, chacune pour un bosquet de bois ; aucun reçu d'acceptation. Les services staging et génération ne portaient pas cette charge.

Après autorisation explicite de Tristan, les **six tâches identifiées** ont été différées de deux heures, jusqu'au **21 octobre à 11:08 UTC / 13:08 Paris**. Seul `available_at` a changé : tâches, intentions, échéances, compteurs et erreurs conservés. Les lignes étaient filtrées par UUID, type, état non terminé, erreur exacte et au moins 5 000 tentatives. `FOR UPDATE SKIP LOCKED` a laissé finir la tâche déjà acquise ; une seconde passe a différé celle-ci après sa libération. Aucun redémarrage de service, déploiement, suppression de tâche ou modification des stocks.

Sauvegarde avant intervention : `/var/lib/arbestra/incidents/alpha-harvest-retries-20261021T090759Z.json`, accès root uniquement. Il s'agit d'une intervention opérateur exceptionnelle ; les commandes métier ne modifient toujours aucune notification existante.

Après report : CPU API mesuré par delta du compteur systemd sur dix secondes, **1,4 % d'un cœur**, puis **3,7 %** au contrôle suivant. Six extractions normales terminées après l'intervention, compteurs des six reprises stables (5 598 à 5 601), aucune d'entre elles immédiatement éligible. `/api/health` local répond 200 en 5 ms ; cela ne vaut pas recette complète d'un parcours joueur.

## Cause établie et correctif préparé

Un seul trajet problématique a été reproduit avec les modules réellement déployés, dans un processus isolé à priorité réduite et PostgreSQL forcé en lecture seule. Erreur interne du worker : **`Refinement search budget exhausted`**, enveloppée en `NAVIGATION_UNAVAILABLE`. Échec après 7 029 ms à froid. Ce résultat établit la limite de recherche atteinte ; il ne prouve pas que la destination est inaccessible. Aucune limite de navigation n'a été augmentée et aucune demande réactivée par ce diagnostic.

Le scheduler reprogrammait chaque erreur à `transaction_timestamp() + 1 seconde`. Cette borne date du début du traitement : après un échec de plusieurs secondes, la tâche pouvait être immédiatement reprise. Les échecs persistants ne ralentissaient jamais.

Le correctif local calcule le délai après le rollback du handler, à `statement_timestamp()`, puis augmente les reprises à 1, 2, 4, 8 secondes, etc., avec plafond de cinq minutes. Le scheduler ne reprogramme que sa propre tâche acquise. L'intention et l'échéance métier restent conservées ; les autres tâches sont traitées normalement. L'option explicite de délai nul des tests est conservée. Ce correctif empêche la boucle intensive ; il ne résout pas le trajet de Pinkystan.

Trois régressions constatées rouges sur le code précédent : reprise déjà passée au moment de l'échec, absence de recul à 5 600 tentatives, absence de progression au troisième échec. Suite dédiée ensuite **4/4 verte**, incluant rollback des écritures réellement observées, poursuite d'une tâche saine et retry explicite immédiat. Schéma isolé sur `127.0.0.1/arbestra_test`, supprimé à la fin ; aucune donnée de développement réinitialisée.

Préparation dans `test-results/alpha-worker-hotfix`, branche `hotfix/alpha-worker-retries`, base `a32c1fe`. Seul le scheduler et ses tests y changent ; les modifications de construction du worktree principal sont exclues. Build API du worktree isolé réussi ; dernière passe dédiée et connexe **7/7 verte** (quatre régressions scheduler, achèvement unique, reprise après erreur et rollback métier). Lint ciblé et contrôle du diff réussis. Correctif non commité, non poussé, non déployé. Artefacts de diagnostic ignorés : `test-results/alpha-worker-incident/`.

## Publication complète et correction du trajet

Le backoff et la construction bornée sont publiés depuis `main` dans **`9df41b5`**, tags alpha/staging du 21 octobre `.1`. Les deux workflows et les douze contrôles publics ont réussi ; révisions des releases, services et health contrôlés directement. La préparation isolée décrite ci-dessus est historique et n'a pas été publiée séparément.

La géométrie des six demandes a été capturée en lecture seule pour reproduction locale. Le village a maintenant un domaine de 109 × 119 cases ; le raffinement ignorait un guide grossier de près de cent cases et tentait une recherche globale au huitième. Cinq demandes disposent d'un guide praticable ; la sixième n'a que ses deux extrémités, la grille de centres n'ayant pas trouvé de parcours.

Correction dans `travel-paths.ts` : certifier chaque segment du guide, raccorder la vraie porte par une recherche locale bornée, puis mémoriser seulement le trajet réussi. Un guide devenu obstrué n'est pas une autorisation de traverser : essai du planificateur physique existant à grille grossière et raccordements fins, puis recherche historique en dernier recours. Limites explicites 1 024 points voisins, 2 048 nœuds de raccordement et 8 192 nœuds / 1 s pour l'essai de planification ; budget historique et watchdog inchangés. Borne de détour de seize cases conservée ; aucune promesse d'optimum de coût de voirie. Aucun changement de droits, stocks, affectations, durée unitaire ou SQL.

Deux régressions rouges avant correction puis dix tests dédiés verts : longue route et couture, absence de guide, obstacles ajoutés (bâtiment, équipement, tronc, eau, pente), destination bloquée, distinction limite/inaccessibilité, copies et invalidation du cache. La suite connexe a révélé un ancien test qui exigeait explicitement qu'un trajet traverse un obstacle distant ; son assertion vérifie désormais la praticabilité intégrale dans les deux planificateurs. Dernière passe ciblée **26/26 verte** ; les cinq autres fichiers connexes ont terminé verts (**57 tests**) avant cette finition.

Builds finaux contracts et API, lint des trois fichiers TypeScript modifiés et vérification du diff terminés avec succès. Les six captures passent dans le vrai worker local, sans SQL, avec recertification indépendante de chaque segment et contrôle de la porte/destination. Première passe sous charge locale concurrente : première requête froide **10 672 ms** (démarrage du worker, transfert, décodage et géographie inclus), suivantes **133–512 ms**. Dernière passe après compilation finale : **2 409 ms à froid puis 66–198 ms**, six succès. Une reproduction du premier calcul seul mesurait 244 ms contre 6,4 s puis dépassement avant correction. Ces chiffres ne constituent ni un percentile ni une mesure HTTP en production. Artefacts ignorés dans `test-results/alpha-worker-incident/` ; aucun monde capturé commité.

## Résolution en production

Correctif de trajet **`8234926` déployé en staging et alpha**, tags `staging-2026.10.21.2` et `alpha-2026.10.21.2`. Builds complets CI, douze contrôles publics, révisions et services vérifiés. Liens des quatre workflows dans le handoff. Les six trajets relus et calculés avec la release réellement installée ont réussi, sous PostgreSQL read-only et priorité réduite : 3 501 ms à froid puis 189–286 ms, SQL inclus.

À **09:56:09 UTC / 11:56:09 Paris**, retrait du report temporaire sur les seuls six `available_at`, après sauvegarde root `/var/lib/arbestra/incidents/alpha-resume-six-20261021T095609Z.json`. Révision déployée et dates du report contrôlées par le script ; ni intention, ni échéance, ni compteur réécrit par l'opération. Le worker normal a ensuite terminé les six notifications et persisté **six reçus acceptés, zéro refus, une seule intention durable par commande**. Compteurs d'erreurs inchangés, `last_error` effacé par l'achèvement normal. L'échéance manuelle de 13:08 Paris est donc levée, sans tâche laissée artificiellement en attente.

À 09:56:29 UTC : aucune notification éligible en retard, **CPU API 1,4 % d'un cœur sur dix secondes**, health HTTP 200 en 3 ms. Ce contrôle ponctuel ne certifie pas la charge générale. Les cibles sont admises dans les files d'exploitation ; il ne s'agit pas d'un crédit anticipé des quantités de bois affichées dans les reçus. Aucun nouveau parcours navigateur authentifié distant revendiqué.
