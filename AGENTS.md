# Travailler sur Arbestra

## À chaque reprise

1. Lire la demande courante, puis `git status --short` et le dernier commit. Les modifications présentes appartiennent à l'utilisateur ; ne pas les écraser ou les inclure dans un commit sans en comprendre la portée.
2. Lire la tête de [SESSION-HANDOFF.md](SESSION-HANDOFF.md), la spec de la tranche demandée et les seuls documents d'architecture concernés. L'index est dans [docs/architecture/README.md](docs/architecture/README.md).
3. Vérifier les fonctions et chemins réels avant de proposer ou modifier quoi que ce soit. Le code prouve l'existant ; une spec décrit une cible, pas une livraison acquise.
4. Identifier le résultat demandé : étude, spec, implémentation, revue ou clôture. Une étude n'autorise pas à implémenter sa proposition. Exécuter les actions déjà autorisées sans redemander une confirmation de routine.

## Décisions et périmètre

- Les instructions de la session prévalent sur les anciennes notes du dépôt. Un handoff historique ne crée pas une interdiction permanente.
- Tristan tranche le gameplay. Distinguer **validé**, **proposé**, **ouvert** et **hors scope**. Un « oui » ciblé n'approuve pas automatiquement toutes les hypothèses des paragraphes précédents.
- Si une décision produit manque, proposer une recommandation précise et continuer les travaux indépendants. Ne pas bloquer toute la tranche pour un choix local de nommage ou d'extraction ; ne pas inventer une mécanique pour débloquer le code.
- Implémenter une tranche bornée. Pas d'infrastructure ou de refactor général préventif, pas de système de qualifications/combat/transport parce qu'une extension future l'utilisera peut-être.
- Les noms Astra, Terra et Sol identifient des interlocuteurs, pas une hiérarchie obligatoire. L'agent qui implémente doit aussi valider et corriger son travail. Ne pas lancer une boucle de délégation/revue sans besoin ni autorisation.
- Procédure et modèles de passation : [docs/AGENT-WORKFLOW.md](docs/AGENT-WORKFLOW.md).

## Invariants techniques à préserver

- Monolithe Fastify/PostgreSQL ; contrats JSON partagés dans `packages/contracts`. React porte l'interface, Babylon le rendu. Le client ne décide ni des ressources ni des autorisations.
- Toute entité mondiale et tout accès métier respectent `world_id`. Les coordonnées sont canoniques sur un tore ; le viewport n'est pas une frontière d'autorité serveur.
- Économie : `beginVillageEconomy()` prend le village avant les verrous métier ; borne `statement_timestamp()` lue **après** acquisition. Commande et snapshot partagent cette borne et cette transaction.
- Réconcilier les transitions dues par échéance, ID et type. Conserver les restes/cursors aux changements de production ; ne pas traiter chaque catégorie temporelle en bloc si leurs échéances s'entrelacent.
- Worker : tâche acquise avec `SKIP LOCKED` → village → métier. Réconciliation et commandes ne verrouillent/modifient/acquittent aucune notification existante. Le scheduler ne finalise que sa propre tâche. Pas de `SERIALIZABLE` global.
- Une notification peut être ancienne : l'état métier décide ce qui est dû. Respecter l'exception d'unicité `building.complete` introduite par 009.
- Pierre : préparer et verrouiller tous les gisements dus et la cible éventuelle par UUID canonique après le village, avant toute transition. Ne jamais prendre un autre village après un gisement. `population/work.ts` porte l'affectation commune Jardin/pierre ; les détails et commandes partagent les règles d'éligibilité.
- Les apparences et animations ne déclenchent pas les crédits économiques. Les éléments décoratifs ne deviennent pas des entités persistantes individuelles.

## Vérification proportionnée

- Bug : écrire une régression qui vérifie le résultat métier ; lorsque faisable, constater son échec avant correction. Si la correction existe déjà, une reproduction rétrospective isolée est valable, à nommer comme telle.
- Concurrence : deux promesses ne prouvent pas un entrelacement. Forcer les points pertinents avec barrières bornées, observer l'attente PostgreSQL si nécessaire, libérer et attendre toutes les transactions même en échec.
- Rollback : prouver que les changements ont eu lieu avant l'erreur injectée, identifier cette erreur, puis comparer toutes les données touchées. Ne pas accepter n'importe quelle exception comme preuve.
- Vérifier les comportements modifiés et les suites connexes ; ne pas relancer indéfiniment des suites vertes sans nouvelle raison. Une modification documentaire demande une vérification documentaire, pas une campagne de tests applicatifs.
- Pour une tranche visuelle, prévoir une vérification navigateur du parcours. Les anciennes notes disant « à Tristan » ne dispensent pas de validation. Respecter toutefois toute répartition explicite encore applicable dans la session ; rapporter les vérifications manuelles restantes sans les prétendre faites.
- Ne pas annoncer un test vert tant que son processus n'a pas terminé avec succès. Rapporter séparément lecture du code, inférence, reproduction et validation.

## Commandes et données

- Dev : `corepack pnpm dev`. Lire `package.json` pour les scripts à jour.
- Test ciblé : `corepack pnpm --filter @arbestra/contracts build`, puis `corepack pnpm exec vitest run <fichier> -t '<cas>'`. Éviter `pnpm test -- <fichier>` comme filtre supposé : le script racine enveloppe la commande.
- Suite : `corepack pnpm test`. Selon le diff : `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm build`, `corepack pnpm test:e2e`.
- Les tests DB utilisent `TEST_DATABASE_URL` / `.env.test` et refusent un nom sans suffixe `_test`. Le suffixe est un garde-fou, pas une autorisation de viser une base arbitraire. Vérifier la cible sans afficher de secrets.
- Ne pas exécuter deux suites qui réinitialisent la même base de test en parallèle. Leurs fixtures partagées se détruiraient mutuellement.
- Ne jamais réinitialiser la base de développement pour tester. `db:test:setup` réinitialise des données de test ; `db:setup` migre puis seed et n'est pas une commande de simple démarrage.
- Les migrations nouvelles sont additives/conservatrices et validées sur test. Appliquer au développement ou déployer exige que cette action soit couverte par la demande ; une autorisation déjà donnée n'a pas à être redemandée.
- Ne pas lire/afficher les fichiers `.env` complets, copier des secrets dans les handoffs ou committer des artefacts de tests.

## Clôture

- Faire les corrections de finition et les vérifications requises avant d'annoncer la livraison. Si une preuve manque, statut **à valider**, pas **terminé**.
- Mettre à jour le handoff courant et uniquement les docs de référence affectées. Ne pas recopier un ancien compte de tests comme résultat actuel.
- Commit/push lorsqu'autorisés pour la tâche, sans confirmation supplémentaire. Examiner les fichiers inclus, `git diff --cached --check`, puis vérifier branche et résultat du push. Aucun force-push par défaut.
- Le bilan final donne le résultat, les preuves, les limites restantes et l'état Git réel. Une relecture distincte peut être utile ; elle ne remplace pas l'auto-validation de l'implémenteur.
