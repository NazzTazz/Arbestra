# Arrivées progressives des habitants

Décision de Tristan du 16 octobre 2026 : la population vise 50 % des logements ; cadence confirmée de **1 habitant par minute et par village**, avec rattrapage des anciens villages. Implémentation et preuves courantes dans le handoff.

La cible est `floor(capacité disponible / 2)`, HDV compris. Les capacités existantes restent 30 pour l'HDV, 5 pour une maison de niveau 1, 25 au niveau 2. Un chantier neuf ne compte qu'à son achèvement. Une amélioration conserve la capacité du niveau déjà construit jusqu'à son échéance. Les habitants au-dessus de la cible sont conservés : aucun départ ou décès ajouté.

Lorsque la capacité augmente et que le village était à sa cible, la première arrivée est prévue une minute après l'achèvement réel. Lorsqu'une progression est déjà en cours, son reste de minute est conservé. Le temps passé à la cible ne s'accumule pas pour une future maison. Les habitants deviennent disponibles avec l'énergie initiale 10 ; leur origine et rattachement sont le village d'accueil, sans qualification offerte ni affectation immédiate imposée. L'énergie évolue ensuite suivant les règles communes à partir de chaque date d'arrivée.

Les 15 habitants initiaux restent en place. Un kit comportant des logements supplémentaires commence ensuite sa progression. La pose séparée de la maison du kit suit la même règle.

La migration 043 conserve les cohortes, missions et stocks. Elle démarre une horloge de rattrapage à son application pour les villages sous la cible. Aucun calcul depuis l'âge historique de leurs maisons ni remplissage instantané. Une interruption de service postérieure est rattrapée selon les minutes réellement écoulées, sans dépasser la cible.

`population/growth.ts` avance le curseur persistant `village_populations.next_arrival_at` sous le verrou du village. Les arrivées sont intercalées avant les transitions économiques dues et la nouvelle capacité est prise en compte à chaque achèvement. Les insertions tardives conservent les dates d'énergie individuelles. Les notifications `population.arrive` réveillent le scheduler existant ; chaque échéance possède une notification idempotente. La réconciliation ne modifie ni n'acquitte une notification existante. Seul le scheduler acquitte sa tâche acquise. La prochaine échéance peut être créée avant cet acquittement, avec une exception d'unicité limitée à ce type de notification.

Le snapshot expose la cible, la cadence et la prochaine date dans `population.growth`. Le panneau Habitants les affiche sans créer d'habitant côté client ni ajouter de polling. Les projections MVCC et les lectures NOC restent sans mutation.

Hors scope : satisfaction, repas automatiques, mortalité, départs, transferts entre villages, nouveau système d'identités individuelles et animation dédiée d'immigration. Ces évolutions demandent leurs propres décisions.
