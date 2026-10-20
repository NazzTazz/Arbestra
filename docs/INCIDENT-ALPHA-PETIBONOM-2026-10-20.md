# Petibonom : chargement interrompu en alpha

Correctif d'urgence du 20 octobre 2026, préparé depuis la release alpha `14c6bed932f373e28f3fc38fd385e1652a3aaabb`. **Déployé en alpha**, commit `6283fb835293b9098730d37df8fdcefd3dca79cc`, tag `alpha-2026.10.20.1`, branche `hotfix/alpha-petibonom-navigation`. La terraformation de staging et le HUD Population/Exploitation ne font pas partie de ce correctif.

## Diagnostic et changement

Signalement : chargement progressivement plus lent avec l'agrandissement du village de Number, jusqu'à l'erreur de connexion. Le village identifié est **Petibonom**, dans `alpha-rc1`. Lecture ciblée : 143 bâtiments persistés, 98 parcelles de jardin, 3 270 cellules projetées, 712 sommets de terrain modifiés. Aucun changement manuel des données du joueur.

Les journaux alpha contiennent une lecture village interrompue à 31,8 s et une autre réussie à 27 s. Ces lignes seules ne permettent pas d'attribuer chaque requête au joueur. La capture géométrique ciblée reproduit le calcul lent : 48 019 ms, dont environ 33 s CPU dans `rc1NetworkGround.sample`.

Deux caches bornés évinçaient leur plus ancienne entrée en recréant `Map.keys()` à chaque insertion. Une fois saturé, cet itérateur parcourt à répétition les emplacements supprimés. Une liste circulaire conserve l'ordre FIFO et les capacités existantes : 32 768 échantillons de navigation, 100 000 échantillons du terrain partagé. Hauteurs, eau, rochers, arbres, chemins et règles économiques sont inchangés. Aucun timeout, budget de recherche, limite de worker ou migration modifié.

## Vérifications terminées avant publication

- Capture spatiale seule depuis la projection alpha, connexion PostgreSQL forcée en lecture seule. Le premier collecteur remplace le calcul uniquement pour capturer son entrée ; il ne constitue pas une preuve de chargement réussi.
- Calcul réel avant/après sur la même capture : **48 019 → 22 057 ms**, **131 trajets / 7 312 points**, sortie strictement identique. Mesures locales ponctuelles, pas un percentile ni un budget garanti.
- SHA-256 de l'entrée : `59cabce906aa2cc060a30245b7131176e07c6396715e5f8590b561594cde8b8a` ; sortie avant et après : `abb31b6a6a5014258c0da566f1261493b4fa1b49eabc6a71bd9cb8c81a5d0ac9`.
- **54 tests réussis**, processus terminé : `network-compute` (15), `rc1-network-ground` (1), `spawn-map` (14), `infrastructure-navigation` (24). Les tests vérifient la géographie après plusieurs tours d'éviction, la réutilisation torique, les passages et le comportement du worker partagé.
- Builds contracts/API et lint ciblé réussis. Les tests de résultat ne sont pas présentés comme des régressions rouges : le dépassement initial est reproduit par la capture et son profil CPU.
- Le worker avec les limites de production a encore dépassé 30 s sur le poste Windows. Ce résultat n'est pas écarté ni présenté comme vert.
- **Contre-vérification sur le VPS**, processus temporaire isolé à priorité réduite, copie des modules compilés et deux correctifs seulement, base en lecture seule : `readVillageProjection` réel de Petibonom, `NavigationCompute` inchangé, **11 038 ms à froid puis 468 ms**, **131 trajets**. Aucun service live remplacé pour cet essai. La copie temporaire est supprimée en fin de diagnostic.

## Limites et suivi

[Déploiement alpha réussi](https://github.com/NazzTazz/Arbestra/actions/runs/39472131445), build complet dans le workflow et procédure habituelle de sauvegarde/déploiement, sans nouvelle migration. Répertoire courant vérifié : `6283fb835293b9098730d37df8fdcefd3dca79cc-20261020T180927323459`. Trois services actifs. [Six contrôles publics réussis](https://github.com/NazzTazz/Arbestra/actions/runs/39472485694).

Sur la release déployée, **`getVillageState` complet réussi en 11 708 ms** pour Petibonom : 3 270 cellules, 131 trajets, 110 habitants. Cette vérification inclut le réveil économique ordinaire du GET joueur et le vrai raffinement worker, sans nouvelle commande ni modification manuelle. Un premier passage avait terminé la lecture mais échoué dans l'affichage du rapport (`population.total` au lieu de `village.population.total`) ; la mesure publiée provient du second passage, terminé avec code 0.

La vérification appelle le service dans un processus dédié, pas via la session HTTP du joueur ni le pool partagé du service live. Le rendu navigateur, le chargement des tuiles et la tenue sous charge simultanée restent à confirmer. Une demande de nouvel essai a été transmise à Tristan pour Number ; aucun retour joueur acquis à cette clôture.

Six notifications de récolte d'un autre village restent en reprises sur erreur de navigation après publication (jusqu'à 611 tentatives observées). Elles n'ont été ni supprimées ni modifiées. Ce sujet reste ouvert, car elles partagent le worker live ; ne pas déclarer toutes les erreurs de navigation résolues. La correction distincte d'accès aux jardins de staging n'est pas incluse dans ce hotfix.

Artefacts de diagnostic locaux ignorés : `test-results/alpha-number-incident/` (capture compressée, profils CPU, sorties et scripts). Ne pas committer la géométrie capturée ni les secrets d'accès.

### Précision sur les reprises, 20 octobre à 18:34 UTC

Lecture ciblée en production : les six demandes appartiennent à **Pinkystan** et visent chacune **un bosquet de bois**, sans jardin ni pierre. Elles comptent 818 à 820 tentatives. Les six reçus restent absents ; aucune intention acceptée ni ordre d'exploitation attaché n'existe pour ces commandes. Le handler annule les effets de la tentative en échec et le scheduler reprogramme la même notification ; ce compteur ne représente pas des récoltes exécutées ni des équipes immobilisées par ces six demandes.

Le délai de reprise est fixe, une seconde calculée depuis le début de la transaction : après un traitement plus long, la tâche peut déjà être rééligible dès le rollback terminé. Cette boucle consomme la navigation partagée et peut ralentir d'autres joueurs. Le message conservé (« Calcul du trajet interrompu. Réessayez. ») ne distingue pas une limite de recherche, une expiration ou une panne worker ; la cause géométrique précise reste à reproduire. Aucun changement de code, de tâche ou de données effectué pour cette vérification.
