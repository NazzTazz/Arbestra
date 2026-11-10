# Feuille de route

4 novembre 2026. Proposée avec Tristan après l'alpha `alpha-2026.11.04.1` (fin de la synchro V2). C'est un ordre **proposé** et réordonnable, pas un engagement : Tristan tranche le gameplay et l'ordre. L'état courant des tranches reste dans le [handoff](../SESSION-HANDOFF.md).

## Principe

On ordonne les idées d'après ce dont elles ont besoin pour exister, pas en les comparant entre elles. Deux règles tiennent le cap :

- **Un seul chantier structurant à la fois** (règle du 1er novembre, qui a permis de finir la V2).
- **Alterner l'invisible et le visible** : après une fondation, une tranche que les joueurs voient.

## Dépendances

| Idée | A besoin de | Débloque |
|---|---|---|
| **Taille du monde** (décision) | Test de charge | Carte (tuilage de l'atlas), trajets, nombre de joueurs par monde |
| **Refonte des trajets** (invisible pour le joueur) | Méthode de Tristan, taille du monde | Trajets alternatifs, convois, déplacements d'armées |
| **Carte** : morphing depuis la région, HUD monde, marché mondial | Taille du monde | Brouillard, relevé en deux clics, expéditions depuis la carte |
| **Brouillard de renseignement** | Carte (support), règles de Tristan | Intérêt du combat, rôle du géographe |
| **Trajets alternatifs du marché, convois** | Refonte des trajets, carte (pour les voir) | Convois publics, base de la dimension militaire |
| **Combat** | Trajets, brouillard, convois, arbitrages de l'[étude karma](ETUDE-KARMA-VOISINAGE.md) §5 | — |

Le combat arrive en dernier par nature : il repose sur tout le reste.

## Ordre proposé

1. **Test de charge** (environ une semaine) : bots scriptés sur staging à 10, 30 puis 100 joueurs ; latence des commandes, retard du worker, charge PostgreSQL et CPU. Outil livré et validé en local le 4 novembre ([test de charge](TEST-DE-CHARGE.md)) ; passage sur staging à décider. Ensuite, éventuellement, quelques PNJ joués par Claude Haiku 5.5 comme testeurs exploratoires. Puis **décision de Tristan sur la taille du monde** et le nombre de joueurs par monde.
2. **Refonte des trajets** (méthode de Tristan) : caches locaux par région au lieu de l'invalidation par le sol du monde entier ([dette](DETTE-TECHNIQUE.md), « Trajets »). Peut avancer en parallèle de la carte : le code touché est différent.
3. **Carte** ([orientation du 3 novembre](SPEC-VUES-TERRAIN-REGION-MONDE-TORIQUE.md), en tête) : vue Régions détaillée, morphing région ↔ carte, atlas en défilement infini, HUD monde (population, villages, bois et pierre mondiaux, joueurs), marché mondial, relevé du géographe au réticule violet. Le tore devient la cinématique d'Astronomie 1.
4. **Brouillard de renseignement**, sur la carte, quand les règles de Tristan sont prêtes.
5. **Trajets alternatifs du marché et convois publics**, sur les nouveaux trajets.
6. **Combat.**

## Petites tranches à intercaler

- Routes de terre et de gravats en pente ([dette](DETTE-TECHNIQUE.md)).
- Mobile, correctifs rapides : résolution de rendu (`setHardwareScalingLevel`), écran « Tourne ton téléphone » et plein écran paysage sur Android ; le z-fighting ensuite s'il reste. Personne ne joue sur téléphone à ce jour.
- Synchro V2 : migrations de nettoyage I.5 et I.6, après la fenêtre de retour arrière de l'alpha.
- Voirie S5 et S6 (après l'alpha ; S5 attend les modèles Blender de Tristan).
- Verrous mondiaux et worker hors du processus de l'API : chantier structurant à ouvrir seul, éclairé par le test de charge.

## Questions ouvertes pour Tristan

- **Taille du monde et nombre de joueurs par monde.** Avec les règles actuelles (une habitation loge 25 habitants au niveau 2), cent joueurs à 300 000 habitants demandent environ 9 fois le monde RC1 actuel (512 × 256 cases), en logement seul. Leviers : monde plus grand, logement plus dense, moins de joueurs par monde.
- **Règles du brouillard de renseignement** (en cours chez Tristan), et si le HUD monde montre tout le monde ou seulement ce qui a été relevé.
- **Méthode de la refonte des trajets.** Décisions de game design tranchées le 10 novembre ([décisions 7 à 11](DECISIONS-NAVIGATION-2026-10-31.md#décisions-de-game-design-du-10-novembre-2026)) ; reste la méthode technique.
- **Règles mobiles pour les nouveaux outils** (pas d'action au seul survol ou au seul clavier, vérification en paysage mobile, cibles de 44 px) : à décider plus tard.
