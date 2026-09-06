# Workflow des tranches Arbestra

Ce document complète [AGENTS.md](../AGENTS.md). Objectif : passer d'une intention joueur à une tranche vérifiée sans demander à Tristan de piloter chaque correction technique.

## Sources et statut des informations

| Source | Usage |
|---|---|
| Conversation et décisions explicites de Tristan | Intention et autorisation actuelles ; noter les corrections acceptées dans la spec concernée. |
| Spec de tranche | Cible bornée, invariants, décisions validées et points ouverts. Une proposition n'est pas automatiquement approuvée. |
| Code, migrations et contrats actuels | Preuve de ce qui existe. Un écart avec la cible doit être résolu ou signalé, pas rationalisé. |
| `docs/architecture/` | Conventions durables et comportement implémenté, sauf statut prospectif explicite. |
| `SESSION-HANDOFF.md` | Index de reprise court et daté ; liens vers preuves et travail courant. |
| Handoffs/reviews datés et contexte historique | Preuves au moment de leur rédaction, contexte et pistes. Pas des instructions éternelles. |

Si deux documents se contredisent, vérifier leur date, leur statut et la conversation. Corriger une note obsolète lorsqu'on connaît la décision ; demander uniquement si le conflit porte sur un choix produit réellement indécidable.

## Cycle normal

### 1. Cadrer

Partir de l'action du joueur et de son résultat observable. Lire le code pertinent. Fermer les décisions qui affectent les invariants ; proposer les options seulement lorsqu'elles changent réellement le jeu. Les noms de fonctions, petites extractions et détails de tests appartiennent à l'agent.

### 2. Spécifier

Un `.md` suffit pour la cible technique. Une version PO courte peut accompagner une tranche complexe, mais elle ne doit pas introduire une deuxième règle concurrente. Toute correction d'un arbitrage doit être reportée dans les deux si elle y apparaît.

En tête de spec : date/base relue, statut, périmètre, décisions ouvertes. Corps : résultat joueur, existant, invariants, changements minimums, API/données/temps/verrous si concernés, tests observables, critères d'acceptation et étapes. Les hypothèses non validées sont nommées avant le plan, pas cachées dans des types SQL.

Une spec contenant un point produit bloquant est **en cadrage**, même si le reste est très détaillé. Après réponse, incorporer la règle à l'endroit concerné et retirer l'ambiguïté ; ne pas empiler uniquement des addenda contradictoires.

### 3. Implémenter et prouver

Un agent peut réaliser la tranche de bout en bout. Les étapes servent à limiter le diff et localiser les erreurs, pas à demander un feu vert entre chaque fichier.

Pour chaque invariant risqué, choisir une preuve : test pur pour calcul, PostgreSQL pour atomicité/verrous, navigateur pour picking/animation/parcours. Tester un état initial, une action et un résultat ; éviter les assertions qui recopient seulement l'algorithme.

Exécuter d'abord les tests pertinents, puis les vérifications exigées pour la clôture. Les tests qui partagent `arbestra_test` s'exécutent séquentiellement, y compris entre agents/shells. Lire le résultat final des processus asynchrones. Un build réussi ne prouve pas le parcours visuel.

Une régression introduite avant correction constitue une preuve directe. Si le code est déjà corrigé, on peut réintroduire isolément l'ancien défaut pour mesurer la sensibilité du test : préciser ce qui a été substitué et l'échec obtenu. Cela ne prouve pas tous les entrelacements ni une exécution historique réellement faite avant l'implémentation.

### 4. Relire et finir

L'agent examine son propre diff : règles oubliées, cas limites, migration, erreurs, permissions, test qui passe pour une mauvaise raison, documents devenus faux. Il corrige ces écarts dans la tranche autorisée.

Une revue supplémentaire est indiquée si elle apporte une lecture indépendante sur un risque concret ; pas de chaîne Astra → Terra → Sol → Astra obligatoire. Respecter les règles de délégation de la session. En cas de reprise d'une revue, traiter les réserves précises puis les vérifier ; ne pas relancer une nouvelle architecture générale.

### 5. Livrer

Statuts : **en cadrage**, **prête à implémenter**, **en cours**, **implémentée / à valider**, **clôturée**. Le statut Git est distinct : non commité, commité, poussé. La migration peut être validée sur test sans être appliquée au développement.

« Clôturée » signifie que les critères exigés sont satisfaits. Si le navigateur devait être vérifié mais ne l'est pas, la tranche reste à valider. Si le commit/push est autorisé et demandé, le réaliser puis vérifier son résultat ; sinon fournir le diff sans inventer une autorisation à partir d'une ancienne tranche.

## Handoff minimal à copier et remplir

```markdown
# Handoff — nom de la tranche

Date / agent :
Spec et statut :
Base relue / branche :

## Résultat
Problème corrigé, comportement livré, périmètre effectif.

## Décisions et écarts
Décisions produit validées ; éventuels points ouverts.
Écarts par rapport à la spec, avec justification et statut d'accord.

## Preuves
- Lecture/inférence : ...
- Reproduction : scénario, résultat, ancienne version ou mutation éventuelle.
- Tests exécutés : commande exacte, résultat final, portée et date.
- Navigateur : parcours observé, résultat ; sinon explicitement non vérifié.

## Données et Git
Migrations : test/dev/autre, appliquées ou seulement écrites ; cible sans secret.
Fichiers de la tranche et modifications préexistantes préservées.
Commit/push : état réel, hash si disponible, branche/distant vérifiés.

## Suite
Travail requis restant (ou aucun), blocages et prochaine action concrète.
```

Pas besoin d'un journal de chaque commande ni d'une liste générale de dangers hypothétiques. Rapporter les risques et limites qui affectent l'acceptation.

## Prompts de passage de relais

**Implémentation :** « Lis AGENTS.md, le handoff courant et cette spec. Implémente la tranche et vérifie ses critères. Prends les décisions techniques locales ; isole les décisions produit manquantes. Termine les corrections nécessaires dans le périmètre. [Commit/push autorisé ou non.] »

**Revue seule :** « Confronte cette spec au diff actuel et aux preuves. Identifie les réserves qui empêchent l'acceptation, avec un scénario et les chemins concernés. N'implémente pas. Distingue observations, inférences et comportements reproduits. »

**Finition :** « Reprends les réserves de cette revue, corrige-les et valide la tranche sans élargir son architecture. Mets à jour le handoff avec les preuves réellement obtenues. [Commit/push autorisé ou non.] »
