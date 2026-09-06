# Handoff Sol → Astra — première quête joueur

Date : 6 septembre 2026. Destinataire : Astra, pour cadrage architectural. Base Git observée : `master`, HEAD `4dfd494`, worktree non commité préexistant.

**Statut : proposition en cadrage.** Tristan propose d'implémenter des « quêtes joueur » et d'en faire du coffre de l'Hôtel de ville la première quête. La quête, plutôt que l'action de coffre isolée, créditerait les carottes. Cette conversation n'autorise aucune implémentation, migration, commit ou push.

## Intention joueur

Transformer le cadeau initial en premier jalon narratif et en apprentissage de l'interface :

> Fouiller l'Hôtel de ville → découvrir les anciennes réserves → terminer la quête → recevoir 2 000 carottes.

La quête explique ainsi la sélection d'un bâtiment, une action contextuelle, une récompense économique et une progression persistante. Elle doit survivre à un rechargement et ne récompenser qu'une fois malgré double clic, retry ou deux onglets.

## Orientation recommandée

Traiter les premières quêtes comme un **fil d'apprentissage scénarisé du village**, avec quelques jalons structurants. Éviter pour cette tranche les missions répétitives ou quotidiennes du type « récolter 100 carottes ».

Première tranche minimale proposée :

- une quête persistante par village, identifiée par un code stable tel que `town-hall-supplies` ;
- deux états suffisants pour ce cas : `available` et `completed` ;
- l'action contextuelle de l'Hôtel de ville accomplit cette quête ;
- la complétion et le crédit de 2 000 carottes ont lieu dans la même transaction économique du village ;
- le joueur voit la quête à faire, sa récompense, puis son état terminé ;
- retry et concurrence retournent le même résultat métier sans second crédit.

Représentation UI indicative :

```text
À faire
Fouiller les réserves de l'Hôtel de ville
Récompense : 2 000 carottes

Terminée
Les anciennes réserves
```

## Existant à confronter

La migration 010 et `discoverBuildingSupplies()` portent actuellement `building_hidden_supplies` avec `claimed_at`, ressource et quantité. Le snapshot expose depuis la reprise React `building.hiddenSuppliesAvailable`. Cette table et cette commande sont aujourd'hui l'autorité du crédit unique du coffre.

Si la quête devient l'autorité économique, conserver simultanément une autorité « réserve réclamée » et une autorité « quête terminée » créerait deux états concurrents pour le même cadeau. Recommandation : migrer conservativement l'état actuel vers la quête, puis retirer ou réduire `building_hidden_supplies` selon ce que le modèle de quête doit conserver. Ne pas recréditer les villages dont le coffre est déjà réclamé.

Le service de quête devrait demander la complétion de `town-hall-supplies`, marquer sa progression et créditer la récompense atomiquement sous le verrou village et la borne économique existants. La présentation du coffre peut rester liée à l'Hôtel de ville ; elle ne doit plus être une deuxième autorité économique.

## Abstraction à maintenir étroite

Ne pas introduire dès cette première quête :

- objectifs arbitraires configurés en JSON ;
- moteur général d'événements ou bus interne ;
- chaînes universelles de prérequis ;
- quêtes répétables, quotidiennes ou temporaires ;
- catalogue polyvalent de récompenses ;
- langage de conditions extensible.

Une seconde quête réelle doit fournir le besoin qui justifiera l'abstraction suivante. Suite narrative possible, uniquement comme piste : construire une Habitation, améliorer une Habitation au niveau 2, puis accueillir de nouveaux habitants lorsque cette mécanique aura été décidée.

## Invariants attendus

- `world_id` et `village_id` bornent toute persistance et commande.
- Le serveur décide disponibilité, complétion et récompense.
- Complétion et crédit sont atomiques ; aucun crédit sans état terminé, aucun état terminé sans crédit.
- Un code de quête ne peut être complété qu'une fois par village.
- Un retry identique retrouve le résultat ; une concurrence ne verse jamais 4 000 carottes.
- Le client et une animation ne déclenchent aucun crédit local.
- Le backfill préserve exactement les coffres déjà réclamés et ceux encore disponibles.
- La réconciliation économique ne verrouille ni n'acquitte de notification existante.

## Décisions à fermer par Tristan avec recommandation d'Astra

1. **Nature durable des quêtes.** Recommandation Sol : onboarding scénarisé et jalons, pas tâches répétitives.
2. **Visibilité après complétion.** Proposition : conserver la quête terminée dans un petit journal plutôt que la faire disparaître immédiatement.
3. **Déclenchement des futures quêtes.** Ne rien généraliser avant la seconde quête concrète ; décider alors si elles deviennent disponibles explicitement ou par prérequis.
4. **Modèle du coffre.** Choisir si `building_hidden_supplies` disparaît après migration ou devient une donnée narrative subordonnée à la quête. Une seule autorité doit créditer les carottes.

## Preuves à exiger de la future tranche

- Migration conservatrice : coffre disponible → quête disponible ; coffre réclamé → quête terminée ; stocks inchangés pendant le backfill.
- Complétion nominale : stock `S → S+2000`, quête terminée dans la même transaction.
- Deux complétions concurrentes, retries avant/après réponse perdue et F5 : `S+2000` exactement.
- Erreur injectée après changement d'état ou après crédit : rollback des deux, avec preuve de l'erreur exacte.
- Monde/village/bâtiment étrangers : refus sans mutation.
- Parcours navigateur : quête visible, action depuis l'Hôtel de ville, récompense et état terminé après rechargement.

## Travail effectué pour ce handoff

Discussion et mise en forme documentaire uniquement. Aucun code, test, accès à la base, migration, commit ou push pour cette proposition.
