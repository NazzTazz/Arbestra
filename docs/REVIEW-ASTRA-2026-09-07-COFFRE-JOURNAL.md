# Revue — coffre et journal de l'Oracle

Suite à cette revue : l'arbitrage de l'indice est validé et la tranche clôturée, voir le [handoff final](./HANDOFF-2026-09-07-INDICE-ORACLE.md). Les réserves produit ci-dessous décrivent l'état au moment de la revue.

7 septembre 2026. Revue demandée par Tristan, sur le diff non commité de `master`, base `1da6df0`. Référence : [spec](SPEC-COFFRE-JOURNAL-ORACLE.md). Statut : **implémentée / à valider**, réserves de preuve ci-dessous et indice toujours à arbitrer.

## Levée des réserves — après demande « fix, test, commit push »

Les réserves techniques ci-dessous sont levées. Aucun changement applicatif supplémentaire n'a été nécessaire.

- Migration : comparaison du stock dans la transaction après migration, avant rollback de nettoyage. Mutation rétrospective temporaire ajoutant une carotte : échec attendu `51` contre `50`, puis restauration du fichier.
- Accès : fixtures persistées dans la transaction pour un autre propriétaire dans le même monde et dans un autre monde, avec leurs bâtiments, réserves et stocks. Cinq tentatives refusées ; comparaison des données économiques des villages avant/après, puis nettoyage transactionnel.
- Rollback : le trigger exige `NEW.amount = OLD.amount + 2000` avant l'erreur exacte. Comparaison des ressources, flux, buffers, bâtiments, cohortes, récoltes, extractions, gisements, tâches, réserves et accomplissements après rollback. Mutation rétrospective temporaire créditant zéro : le test échoue car l'erreur attendue n'est plus levée. Fichier restauré et trigger de test nettoyé avant la suite finale.
- Navigateur : ancien accomplissement daté en base (état équivalent à la reprise de migration), stock inchangé, aucune célébration observée depuis le montage React ; accès par Tab, ouverture avec Entrée, fermeture avec Échap, réouverture avec Entrée. Validé sur Chromium desktop et Pixel 7. La migration elle-même est exécutée par le test PostgreSQL distinct.

Commandes finales terminées le 7 septembre 2026 : `corepack pnpm test` **83/83**, `corepack pnpm exec playwright test tests/e2e/oracle-journal.spec.ts` **4/4**, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm build` verts. Avertissement de taille du chunk Babylon inchangé. Base de test locale vérifiée : `127.0.0.1:5432/arbestra_test`. Aucune migration de développement.

Publication autorisée par Tristan : implémentation de Sol, preuves corrigées et documents de référence relus. Le brouillon `apps/world-web/src/hud.css` est exclu. L'indice demeure un arbitrage produit ouvert ; la tranche complète conserve donc le statut **implémentée / à valider pour l'indice**.

## Verdict initial — avant correction

Aucun défaut fonctionnel bloquant identifié par cette lecture. La commande conserve les contrôles d'autorité, le verrou village, la borne économique commune et la transaction unique. La concurrence est testée avec une attente PostgreSQL effectivement observée. Le journal reste borné au village et le premier snapshot ne déclenche pas de célébration.

La clôture exige toutefois de resserrer trois preuves ; les résultats verts rapportés par Sol ne suffisent pas à établir leurs garanties annoncées.

## Réserves initiales — résolues ci-dessus

1. **P2 — préservation des stocks par la migration non prouvée.** Dans `apps/api/src/modules/population/population.integration.test.ts:194`, le stock final est lu après le rollback volontaire du montage. Une migration qui modifierait les stocks serait elle aussi annulée : cette assertion resterait verte. Comparer les stocks dans la transaction, après `migrateVillageAccomplishments()` et avant le rollback de nettoyage. La migration actuelle ne contient pas de modification de stock : le constat concerne la sensibilité du test, pas une corruption observée.

2. **P2 — accès étranger remplacé par accès inexistant.** Au même fichier, ligne 157, les deux cibles sont des `randomUUID()` sans entités correspondantes. Cela vérifie le refus d'identifiants inexistants, pas celui de réserves réellement présentes chez un autre propriétaire ou dans un autre monde. Créer les fixtures étrangères, tenter leur accès et comparer les données des deux villages. Les filtres métier actuels paraissent corrects à la lecture ; aucune fuite n'est démontrée.

3. **P2 — preuve de rollback moins complète que son intitulé.** Ligne 167, le trigger constate un UPDATE carotte, une réclamation et un accomplissement, mais ne vérifie pas le montant crédité (`NEW.amount` / `OLD.amount`). Un UPDATE sans crédit satisferait aussi le trigger. Il faut observer le crédit attendu avant l'erreur exacte, puis comparer toutes les données économiques effectivement touchées par le scénario, comme demandé par la spec ; les assertions actuelles se limitent aux carottes, à la réclamation et au journal.

Complément de validation navigateur : le test livré couvre le parcours neuf et F5, mais n'asserte pas l'absence de célébration au chargement d'un accomplissement ancien/migré ; le contrôle clavier n'est pas documenté. Le code initialisant sans célébration et le raccourci Échap sont présents à la lecture. Ajouter une preuve ciblée, sans rejouer toute la campagne visuelle.

## Portée de la lecture initiale

Lecture du diff, de la commande, migration, contrat, orchestration React, menu, tests et documents concernés. Aucun test applicatif ni parcours navigateur relancé pendant cette revue ; les campagnes du handoff Sol restent ses preuves datées. Aucun changement applicatif, migration de base, commit ou push. Les modifications préexistantes sont conservées.

## Suite

Les preuves ciblées sont corrigées et validées. L'indice de l'Oracle reste un arbitrage produit distinct : son absence n'est pas une régression imputable à Sol.
