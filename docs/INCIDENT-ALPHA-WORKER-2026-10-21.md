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

## Limite opérationnelle

Le report manuel expire à **13:08 Paris**. Sans publication du correctif ou nouvelle décision opérateur, les six reprises retrouveront l'ancien comportement. Le trajet et le traitement final de ces demandes restent à corriger ; elles n'ont été ni refusées définitivement ni présentées comme exécutées.
