# Coffre et journal de l'Oracle — tranche pour Sol

Date : 6 septembre 2026 ; mise à jour d'implémentation le 7 septembre. Base relue : `master`, `1da6df0`, avec consolidation documentaire non commitée. Implémenteur : **Sol**.

**Statut : clôturée.** Coffre, crédit unique, accomplissement PostgreSQL, journal et célébration sont validés et publiés dans `38b801a` ; voir le [handoff du socle](./HANDOFF-SOL-2026-09-07-COFFRE-JOURNAL-ORACLE.md). L'indice validé est implémenté et testé : [preuves de clôture](./HANDOFF-2026-09-07-INDICE-ORACLE.md). Aucune migration de développement. Référence produit : [direction consolidée](./DIRECTION-PRODUIT.md).

## Résultat demandé

Validation technique du socle après revue : [réserves levées](./REVIEW-ASTRA-2026-09-07-COFFRE-JOURNAL.md), 83 tests et 4 parcours Playwright verts. Tristan a ensuite autorisé commit/push ; la restriction historique de publication de cette spec est remplacée par cette demande. La base de développement reste non migrée.

Le joueur découvre librement le coffre de l'Hôtel de ville. L'ouverture accomplit la première quête implicite et verse les 2 000 carottes une seule fois. L'Oracle célèbre l'accomplissement ; une trace durable reste consultable dans un journal. Tristan valide le stockage de l'accomplissement dans PostgreSQL : « le maître c'est l'Oracle, et son grimoire c'est Postgres ».

Une présentation en trophées est une possibilité visuelle, pas un second système de progression. Pour cette tranche, recommandation : entrée légère « Journal » ouvrant la liste des accomplissements. Pas de liste d'objectifs révélant le coffre avant sa découverte. Les libellés, la mise en page et l'extraction de composants appartiennent à Sol.

## Existant vérifié par lecture

- `apps/api/src/modules/villages/service.ts` : `discoverBuildingSupplies()` vérifie le village possédé, appelle `beginVillageEconomy()`, verrouille `buildingHiddenSupplies`, renseigne `claimedAt`, crédite la ressource puis retourne `state()` dans la transaction. Une réserve déjà réclamée produit actuellement `409 SUPPLIES_ALREADY_DISCOVERED`.
- Migration 010 : `building_hidden_supplies` porte monde, village, bâtiment, ressource, quantité et date de réclamation. La réserve de l'Hôtel de ville vaut 2 000 carottes.
- `packages/contracts/src/villages.ts` expose `hiddenSuppliesAvailable`. `apps/world-web/src/ui/PlayerPanels.tsx` porte le bouton de fouille et l'état coffre vide.
- `apps/world-web/src/ui/NotificationStack.tsx` porte des notifications transitoires avec `aria-live`. Ce n'est pas un journal persistant.
- `apps/world-web/src/ui/Hud.tsx` et `App.tsx` portent les entrées HUD et l'orchestration. La régression client existante couvre le rafraîchissement après refus du coffre concurrent ; la préserver ou l'adapter explicitement si le contrat change.

## Persistance et autorité — recommandation technique

Conserver un accomplissement unique par `(world_id, village_id, code)` avec une date serveur de complétion. Code proposé : `town-hall-supplies`. Pour cette tranche, le journal est celui du village courant ; aucune agrégation entre mondes ou identité de personnage future n'est à inventer.

La complétion persistée devient l'autorité du crédit unique. Une migration additive peut créer la table d'accomplissements, reprendre les coffres déjà réclamés avec leur `claimed_at`, et conserver l'ancienne table comme donnée du coffre. Dans ce cas, son état de réclamation devient subordonné et ne constitue plus une seconde voie de crédit. Sol peut choisir une autre structure bornée, à condition de démontrer la même unicité et la compatibilité ; pas besoin d'un arbitrage produit pour un nom de table.

Ne pas créer de bus d'événements, moteur de conditions JSON, catalogue universel de récompenses, journal exhaustif d'actions ou entité Oracle autonome. Les textes peuvent rester dans la présentation ; PostgreSQL conserve la vérité métier, pas nécessairement les phrases humoristiques.

### Migration et commande

- Coffre déjà réclamé : accomplissement repris, date conservée, aucun changement de stock.
- Coffre disponible : aucun accomplissement, stock inchangé, ouverture toujours possible.
- Première ouverture : complétion, état du coffre et crédit atomiques sous le verrou village et la même borne économique que le snapshot.
- Répétition, double clic, deux onglets ou réponse perdue : une seule complétion et +2 000 au total. Un retour idempotent du snapshot est recommandé ; le contrat de répétition choisi doit être explicite et testé avec le client.
- Conserver les contrôles de monde, propriétaire, village et bâtiment. Ne pas accepter du client une récompense, une date ou un état de complétion.
- Aucune réconciliation ne modifie une notification worker existante. Les animations et notifications ne créditent jamais les stocks.

## Contrat et interface

Étendre le contrat partagé et le snapshot avec les accomplissements du village (code et date serveur suffisent pour cette tranche). Garder une seule commande de fouille/complétion ; une route universelle de quêtes n'est pas nécessaire.

Après ouverture, afficher un retour visible d'accomplissement, la récompense réelle et une phrase de l'Oracle. À la réouverture du journal ou après F5, l'entrée reste présente. Un coffre repris par migration ne doit pas être présenté comme une nouvelle récompense venant d'être versée. Une absence d'accomplissement ne doit pas dévoiler la solution dans le journal vide.

La célébration n'est pas un écran bloquant. Vérifier navigation clavier, affichage tactile et absence d'interception involontaire des clics de la scène. Aucun asset généré n'est requis.

## Indice de l'Oracle — arbitrage validé le 7 septembre

Tristan valide le déclencheur proposé : après 90 secondes dans l'onglet visible, si le coffre reste fermé et qu'aucune action de gameplay n'a réussi, afficher un indice discret une seule fois par session. Le temps caché ne compte pas. Explorer la carte et ouvrir les panneaux ne coupent pas le délai. Une commande refusée n'annule pas l'aide ; une commande en cours diffère son affichage jusqu'au résultat.

Texte validé : « L’ancien chef avait caché des provisions dans l’Hôtel de ville. Une mesure remarquablement efficace, puisque personne ne les a retrouvées. » L'indice n'ouvre aucun panneau. Les 90 secondes restent un réglage de POC à ajuster en jouant.

Implémentation bornée : session d'onglet via `sessionStorage`, isolée par monde et village ; temps et annulation conservés après F5. Si le stockage est indisponible, repli en mémoire pour la page courante. Aucune autorité économique ni état de quête ne dépend de ce cache.

## Vérification et acceptation

Sol implémente, teste, corrige et valide son parcours ; aucune boucle de revue inter-agent imposée.

- Migration sur base test autorisée : cas disponible et réclamé, dates et stocks préservés. Ne pas appliquer au développement sans autorisation couvrant cette action.
- Nominal : une ouverture donne +2 000, une entrée persistante et un coffre réclamé.
- Concurrence : forcer l'attente au verrou pertinent avec barrières bornées, attendre toutes les transactions ; exactement une récompense et un accomplissement. Tester aussi retry après réponse perdue.
- Rollback : injecter une erreur identifiée après avoir observé une mutation ; comparer ensuite accomplissement, coffre et toutes les ressources/données économiques touchées. Ne pas accepter une exception quelconque comme preuve.
- Accès étranger : refus sans mutation pour monde/village/bâtiment hors autorité.
- Navigateur : découverte, ouverture, célébration, journal, F5, état ancien migré et deux onglets ; vérifier l'indice après arbitrage. Adapter le parcours ciblé à l'UI réelle, pas à l'ancien Playwright.
- Exécuter les suites connexes et les vérifications lint/typecheck/build requises selon le diff ; ne pas lancer deux suites réinitialisant la même base en parallèle. Documenter les processus terminés et les limites restantes.

## Hors scope et clôture

Première récolte comme quête, TRY et conservation du village, inscription, personnages, coupe de bois, humeur, croissance, combat, karma, trophées universels et récompenses supplémentaires. Le journal de cette tranche prépare un premier accomplissement, pas tous ces systèmes.

Mettre à jour le handoff et les contrats/documentations affectés après implémentation, avec preuves réelles. Aucune autorisation de commit/push ou de migration de développement n'est déduite de cette spec. Les modifications documentaires préexistantes, `hud.css` et le lore TRY ne doivent pas être inclus aveuglément dans une livraison.
