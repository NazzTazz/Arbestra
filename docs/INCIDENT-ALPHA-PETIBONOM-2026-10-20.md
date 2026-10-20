# Petibonom : chargement interrompu en alpha

Correctif d'urgence du 20 octobre 2026, préparé depuis la release alpha `14c6bed932f373e28f3fc38fd385e1652a3aaabb`. Publication et contrôle du service à consigner après déploiement. La terraformation de staging et le HUD Population/Exploitation ne font pas partie de ce correctif.

## Diagnostic et changement

Signalement : chargement progressivement plus lent avec l'agrandissement du village de Number, jusqu'à l'erreur de connexion. Le village identifié est **Petibonom**, dans `alpha-rc1`. Lecture ciblée : 143 bâtiments persistés, 98 parcelles de jardin, 3 270 cellules projetées, 712 sommets de terrain modifiés. Aucun changement manuel des données du joueur.

Les journaux alpha contiennent une lecture village interrompue à 31,8 s et une autre réussie à 27 s. Ces lignes seules ne permettent pas d'attribuer chaque requête au joueur. La capture géométrique ciblée reproduit le calcul lent : 48 019 ms, dont environ 33 s CPU dans `rc1NetworkGround.sample`.

Deux caches bornés évinçaient leur plus ancienne entrée en recréant `Map.keys()` à chaque insertion. Une fois saturé, cet itérateur parcourt à répétition les emplacements supprimés. Une liste circulaire conserve l'ordre FIFO et les capacités existantes : 32 768 échantillons de navigation, 100 000 échantillons du terrain partagé. Hauteurs, eau, rochers, arbres, chemins et règles économiques sont inchangés. Aucun timeout, budget de recherche, limite de worker ou migration modifié.

## Vérifications terminées avant publication

- Capture spatiale seule depuis la projection alpha, connexion PostgreSQL forcée en lecture seule. Le premier collecteur remplace le calcul uniquement pour capturer son entrée ; il ne constitue pas une preuve de chargement réussi.
- Calcul réel avant/après sur la même capture : **48 019 → 22 057 ms**, **131 trajets / 7 312 points**, sortie strictement identique. Mesures locales ponctuelles, pas un percentile ni un budget garanti.
- SHA-256 de l'entrée : `59cabce906aa2cc060a30245b7131176e07c6396715e5f8590b561594cde8b8a` ; sortie avant et après : `abb31b6a6a5014258c0da566f1261493b4fa1b49eabc6a71bd9cb8c81a5d0ac9`.
- **54 tests réussis**, processus terminé : `network-compute` (15), `rc1-network-ground` (1), `spawn-map` (14), `infrastructure-navigation` (24). Les tests vérifient la géographie après plusieurs tours d'éviction, la réutilisation torique, les passages et le comportement du worker partagé.
- Builds contracts/API réussis. Les tests de résultat ne sont pas présentés comme des régressions rouges : le dépassement initial est reproduit par la capture et son profil CPU.
- Le worker avec les limites de production a encore dépassé 30 s sur le poste Windows. Ce résultat n'est pas écarté ni présenté comme vert.
- **Contre-vérification sur le VPS**, processus temporaire isolé à priorité réduite, copie des modules compilés et deux correctifs seulement, base en lecture seule : `readVillageProjection` réel de Petibonom, `NavigationCompute` inchangé, **11 038 ms à froid puis 468 ms**, **131 trajets**. Aucun service live remplacé pour cet essai. La copie temporaire est supprimée en fin de diagnostic.

## Limites et suivi

La projection serveur n'est pas un parcours navigateur du joueur : authentification, réconciliation préalable et chargement des tuiles restent à vérifier après publication. Une seule mesure ne certifie pas la tenue sous charge simultanée.

Six notifications de récolte d'un autre village ont également été observées en nombreuses reprises sur erreur de navigation. Elles n'ont été ni supprimées ni modifiées ; surveiller leur évolution après le correctif, car elles partagent le worker. La correction distincte d'accès aux jardins de staging n'est pas incluse dans ce hotfix.

Artefacts de diagnostic locaux ignorés : `test-results/alpha-number-incident/` (capture compressée, profils CPU, sorties et scripts). Ne pas committer la géométrie capturée ni les secrets d'accès.
