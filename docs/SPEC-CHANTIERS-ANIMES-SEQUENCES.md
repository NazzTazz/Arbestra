# Chantiers localement animés : séquences, réactions et lisibilité

Date : 25 octobre 2026. Base relue : `wip/v2-commandes-bornees`, `9d4eefb`.

Statut : **spécification proposée, arbitrages de Tristan intégrés, implémentation non autorisée par cette rédaction.**

Ce document complète [SPEC-DEPLACEMENTS-ET-ANIMATION-CHANTIERS.md](SPEC-DEPLACEMENTS-ET-ANIMATION-CHANTIERS.md). Toutes ses garanties validées restent en vigueur et ne sont pas rouvertes :
- autorité du serveur et décalage visuel accepté ;
- conservation de tous les participants ;
- tables de rôles bois et pierre ;
- unicité de l'incarnation ;
- reconstruction après F5 sans rejeu.

Ce complément remplace uniquement la **façon de jouer la phase de travail** : gestes, enchaînements, accessoires et effets.

## 1. Décisions

| Sujet | Statut |
|---|---|
| Récit | **Validé** : activité continue faite de petites séquences crédibles, organisée et non chorégraphiée. Abattage, débitage et transport coexistent. Pas de « film » de 12 s. |
| Autorité | **Validé** : le client produit des réactions locales (vibrations, copeaux, éclats, poussière, feuilles, paniers qui se remplissent). Il ne décide jamais qu'une ressource a été produite. L'animation peut anticiper une action, pas inventer son résultat métier. |
| Fin | **Validé** : aucun personnage ne travaille après la fin du travail fixée par le serveur. |
| Jardin | **Validé** : un seul jardinier, règle métier inchangée. Il se penche, saisit une carotte et la dépose dans un panier. La disparition progressive des touffes existante est la base. |
| Lisibilité | **Validé** : priorité au zoom moyen (villageois d'environ 17 px). Le zoom rapproché ajoute des détails, sans être nécessaire pour comprendre. |
| Arbre accessoire | **Validé** : un arbre de présentation tombe une fois au début du chantier ; son tronc se consomme ensuite jusqu'à la fin du travail. |
| Tas de chantier | **Validé** : un petit tas grossit pendant le travail et repart avec les porteurs ; il ne représente pas du stock. |
| Ambition | **Validé** : on ne cherche pas la perfection narrative, mais une indication claire de ce qui se passe. |

## 2. Existant et écarts

Référence de code : [village-workers.ts](../apps/world-web/src/scene/village-workers.ts), [worksite-layout.ts](../apps/world-web/src/scene/worksite-layout.ts), [worker-motion.ts](../apps/world-web/src/scene/worker-motion.ts), [garden-kit.ts](../apps/world-web/src/scene/garden-kit.ts).

| Existant | Écart |
|---|---|
| Les gestes ne sont que des rotations X des bras et des jambes, en sinusoïde au carré à cadence fixe par rôle, déphasée par `index × 1.7`. | Aucune flexion du buste. Aucun temps marqué en haut du geste ni à l'impact. Mêmes cadences pour tous. |
| Un cycle global de 12 s pilote les rôles alternés, les relais aux postes compacts et la scie, visible 8 s sur 12. | Synchronie visible de tout le chantier. |
| La scie est un pavé qui va et vient ; le tronc est un cylindre fixe ; les blocs sont des pavés immobiles, sauf celui du porteur. | Aucune réaction à un coup. Aucun avancement visible pendant le travail. |
| Les arbres (`woodlandTrees`) et les roches rapetissent par paliers selon le stock restant, à la synchronisation. | À conserver : c'est l'état serveur. |
| Le jardinier suit le tracé `gardenSweep` à vitesse constante. Les touffes disparaissent selon `gardenHarvestState`, soit `remaining = round(12 × (1 − p))`. | Le geste n'est pas relié à la touffe : pas de flexion, pas de carotte, pas de panier qui se remplit. |
| Loin de la caméra, les membres sont recalculés toutes les 120 ms (`hooks.detailed`). | Pas de niveau de détail par taille à l'écran ; aucun effet à dégrader. |

## 3. Deux couches qui ne se mélangent pas

**Ressource serveur** : bosquet, amas rocheux, touffes du jardin.
- Sa taille, son nombre et sa disparition restent dictés par le serveur.
- Elle peut seulement **réagir** : éclats et poussière au point d'impact, feuilles. Le mesh partagé du bosquet ou de la roche n'est pas déformé.
- Les touffes gardent leur calendrier existant ; seul le geste du jardinier s'y aligne (section 8).

**Matière de chantier**, de présentation :
- arbre accessoire, tronc couché, tronçons, bûches, blocs, gravier, panier, tas ;
- elle appartient au groupe de chantier et est nettoyée avec lui ;
- elle ne déclenche aucun appel au serveur, n'est jamais chiffrée et ne figure pas dans le HUD ;
- ses quantités sont stylisées et plafonnées. Elles ne promettent aucune conversion en unités économiques.

## 4. Temps : une horloge, un calcul pur

**Fenêtre de travail** `[W0, W1]`, en temps serveur :
- Extraction : `W0 = startedAt + transportMs`, `W1 = completesAt − transportMs` (comme aujourd'hui).
- Jardin : `W0 = startedAt + stop.arrivesAfterMs`, `W1 = startedAt + stop.workEndsAfterMs`.
- Avancement : `p = clamp((now − W0) / (W1 − W0), 0, 1)`.

**Planificateur pur.** Pour un villageois, `plan(seed, role, effectif, fenêtre, t)` renvoie l'action en cours, sa phase, la pose et les événements de l'intervalle `[t_précédent, t]`. Pour un chantier, `site(seed, fenêtre, t)` renvoie l'état de la matière de chantier : arbre debout ou couché, tronçons restants, blocs, niveau du tas.

- La graine combine la clé du chantier (déjà utilisée pour les apparences) et l'indice du représentant.
- Le temps est découpé en **blocs de 30 s**. Chaque bloc tire ses actions de sa propre graine `(graine, indice de bloc)` et se termine sur une pose neutre. L'évaluation est donc en O(1) à n'importe quel instant, identique pour tous les joueurs et stable après F5, sans précalcul de toute la fenêtre.
- Après un F5, on calcule directement l'état à `now`. Les événements passés (impacts, chute) ne sont pas rejoués, et aucune particule n'est émise pour le passé.

**Arrivée en retard** (décalage visuel déjà accepté). Un villageois qui atteint son poste après `W0` rejoint son plan à la prochaine frontière d'action. L'état de la matière de chantier, calculé en temps serveur, ne l'attend pas, avec une exception : la chute de l'arbre.

**Fin du travail** :
- À `W1`, le geste en cours se termine s'il lui reste moins de 0,4 s ; sinon on passe directement au retour à la pose neutre.
- Ensuite, rangement des outils et chargement, comme dans la spécification existante. Aucun nouveau geste n'est lancé.
- Si la mission quitte l'instantané avant `W1`, on coupe vers le retour immédiatement. La matière de chantier non chargée disparaît en fondu de 350 ms (même retrait que les figures).
- Par construction, `site(…, W1)` donne un tronc entièrement consommé et un tas prêt à charger. Aucun état ne prétend que le travail continue.

## 5. Grammaire des gestes

**Pivot de taille.** On ajoute une articulation au bas du buste, à 0,25 m du sol. Le corps, la tête, les cheveux, le visage et les bras pivotent ensemble autour de l'axe X ; les jambes restent fixes. C'est la seule articulation ajoutée. Elle s'applique aux pavés actuels comme à la figurine de [blender-elements/villageois](../blender-elements/villageois/README.md) : il suffit d'insérer un `TransformNode` « buste » entre la racine et ces pièces.

**Poses clés.** Les gestes passent d'une pose clé à l'autre, avec un découpage type :

| Préparation | Tenue | Frappe | Impact | Retour |
|---:|---:|---:|---:|---:|
| 40 % | 10 % | 8 %, accélérée | 7 % de tenue | 35 % |

L'événement d'impact est émis au début de la tenue d'impact. La durée d'un geste est tirée par villageois, avec ±12 % autour de la cadence du rôle.

**Valeurs initiales**, calées dans le prototype Blender (radians, rotation X de chaque articulation). Mêmes signes dans Babylon pour ce squelette, mais pas pour toutes les articulations :
- bras et jambes : négatif = vers l'avant ;
- buste : **positif = penché en avant**.

Source de vérité : [poses.json](../blender-elements/villageois/poses/poses.json), qui contient aussi la position des jambes.

**Les bras sont portés par le buste** : leur angle par rapport au monde vaut « bras − buste ». Pencher le buste en avant ramène donc les bras vers l'arrière d'autant. Les angles d'impact ci-dessous en tiennent compte : l'outil arrive à la hauteur de sa cible au lieu de taper le sol.

| Cible | Hauteur | Distance devant le villageois |
|---|---:|---:|
| Tronc | 0,3 m | 0,7 m |
| Haut de bûche | 0,4 m | 0,77 m |
| Paroi rocheuse | 0,2 m | 0,69 m |
| Bloc | 0,2 m | 0,67 m |

Le fer de la hache et du merlin est du côté qui frappe quand le bras s'abat.

| Geste | Préparation : bras / buste | Impact : bras / buste | Cadence |
|---|---|---|---|
| Hache (abattage, ébranchage) | −2,7 / −0,15 | −1,72 / +0,38 | 1,6 s |
| Fendre (bûche verticale) | −2,9 / −0,1 | −2,02 / +0,5 | 1,8 s |
| Scie de long, à deux | −1,75 ± 0,25 / +0,25 ± 0,1 | alternance en opposition de phase avec le partenaire | 1,1 s par aller-retour |
| Pioche | −2,4 / −0,1 | −1,6 / +0,4 | 1,7 s |
| Masse (casser) | −2,2 / 0 | −1,59 / +0,42 | 1,5 s |
| Ramasser, déposer | −0,6 / +1,0 | — | 0,9 s |
| Porter | −0,9 / −0,12, pas réduit de 30 % | — | marche |
| Arracher une carotte | se pencher −0,5 / +0,95, puis tirer −1,1 / +0,6 | — | 0,7 s |

**Micro-pauses.** Toutes les 4 à 9 frappes (tirage par bloc), le villageois fait une pause de 0,6 à 2,5 s : se redresser en cambrant le buste (−0,22), s'essuyer le front (bras −2,0 un instant), regarder la ressource (rotation de la racine de ±0,4), changer de prise, souffler. Les pauses ne sont jamais synchronisées entre villageois, sauf entre les deux scieurs d'un binôme.

**Lisibilité au zoom moyen.** Le geste doit dépasser la silhouette : outil au-dessus de la tête, buste qui suit, tenue visible en haut et à l'impact. Ce n'est qu'au zoom rapproché qu'on ajoute la carotte en main, l'orientation fine de l'outil et des particules nombreuses.

## 6. Bois

**Matière de chantier :**
- un arbre accessoire debout, au poste d'abattage contre la lisière, dans l'enveloppe du chantier ;
- un tronc couché, découpé en 6 tronçons ;
- un chevalet ;
- un billot de fente ;
- un tas de bûches, d'au plus 3 niveaux.

**Déroulé, par villageois et en parallèle :**
- **Abattage.**
  - Effectif 1 : à la hache.
  - Effectif 2 et plus : le premier binôme à la scie, sur l'arbre accessoire.
  - Chaque frappe fait trembler l'arbre (±0,02 rad, amortie en 0,4 s) et tomber 2 à 3 feuilles.
- **Chute de l'arbre.**
  - Planifiée en temps serveur à `W0 + min(10 s, 12 % de la fenêtre)`. Si l'abatteur n'est pas encore à son poste, elle attend sa troisième frappe visible, au plus tard jusqu'à 30 % de la fenêtre. Au-delà, ou après un F5, l'arbre est montré déjà couché.
  - Animation : bascule de 90° en 1,2 s, angle proportionnel à t², puis rebond de 0,08 rad, anneau de poussière et pluie de feuilles. C'est l'événement le plus lisible au zoom moyen ; il est toujours joué quand il est vu en direct.
- **Débitage.**
  - Les binômes suivants trouvent un tronc déjà couché à l'arrivée.
  - Le tronc perd un tronçon aux seuils `p = k/6`. Le planificateur du binôme aligne une série de va-et-vient pour qu'elle se termine juste à ce seuil.
  - Le tronçon passe ensuite sur le chevalet.
- **Fente.** Le fendeur prend un tronçon et le fend : 3 à 4 frappes, puis deux demi-bûches et un éclat de copeaux.
- **Transport et tas.**
  - Le porteur, ou à défaut le fendeur, empile les bûches. Le tas grossit avec `p`.
  - À `W1`, les bûches du tas deviennent les charges du retour, comme aujourd'hui.

**À un seul villageois** : il abat, puis alterne ébranchage à la hache, fente et empilage, selon l'avancement.

Les tables de rôles validées restent inchangées. Seul ce que fait chaque rôle à chaque instant change.

## 7. Pierre

**Matière de chantier :**
- un réservoir de 3 blocs au plus au pied du front de taille ;
- 1 à 3 blocs en cours de débitage ;
- un panier de gravier par manutentionnaire ;
- un tas de gravier près du chemin d'accès, d'au plus 3 niveaux.

**Déroulé :**
- **Pioche.**
  - Le piocheur frappe le vrai amas rocheux : éclats et poussière au point de contact, sans déformation de l'amas.
  - Toutes les 4 à 6 frappes, un bloc se détache et roule de 0,2 m, tant que le réservoir n'est pas plein. Réservoir plein : seulement des éclats.
- **Débitage.** Le manutentionnaire apporte un bloc au casseur. Le bloc rétrécit en 3 états, un par série de frappes, puis devient du gravier.
- **Manutention.**
  - Le manutentionnaire remplit son panier au poste du casseur, le porte au tas en se penchant en arrière, puis le vide en inclinant le buste.
  - Il circule sur la boucle interne existante.
  - Le tas grossit avec `p`.
- **À un et deux villageois** : enchaînement pioche, casse et transport, comme la répartition validée. Les changements de tâche dépendent désormais du réservoir de blocs et du planificateur, plus du cycle de 12 s.

## 8. Jardin

Le jardinier est seul ; la règle métier est inchangée.

**Calendrier des touffes**, déjà autoritaire pour l'affichage : la touffe k (0 à 11, dans l'ordre serpentin de `harvestSlots`) disparaît à `t_k = W0 + (k + 0,5) / 12 × (W1 − W0)`, soit l'instant où `round(12 × (1 − p))` diminue.

**Séquence par touffe**, calée pour que l'arrachage coïncide avec `t_k` :

| Étape | Durée initiale |
|---|---|
| Marcher jusqu'à la touffe par l'allée la plus proche (y ≈ 0,84 ou 1,66 m, ou les bords) | 0 à 0,8 s |
| Se pencher : buste +0,95 | 0,35 s |
| Arracher (la touffe disparaît de l'affichage à cet instant) : buste +0,6, bras −1,1, carotte dans la main droite | 0,35 s |
| Se redresser et déposer dans le panier | 0,4 s |

Si l'intervalle `Δ = (W1 − W0) / 12` est inférieur à 2,4 s, la séquence est compressée : pas de marche si la touffe suivante est à moins de 0,6 m, gestes à 70 % de leur durée, minimum 0,8 s. Au-delà de la séquence, le temps restant est occupé par des actions de jardin, tirées par bloc :
- désherber, penché sur le buste à +0,9 avec un petit geste répété ;
- tasser la terre ;
- regarder le rang ;
- s'étirer.

**Panier.**
- Porté au bras gauche entre deux touffes, posé au sol pendant l'arrachage.
- Son contenu suit le nombre de touffes arrachées sur la parcelle courante : ce sont les carottes déjà réservées, rien n'est inventé.
- Il change de parcelle avec le jardinier. Au retour, c'est la charge existante.

Si le jardinier arrive en retard, les touffes passées ont déjà disparu, comme aujourd'hui. Il commence à la touffe suivante.

## 9. Réactions et effets

Tous les effets sont des pièces partagées en *thin instances*, puisées dans un réservoir. Aucun maillage ni matériau n'est créé par impact.

| Effet | Pièce | Nombre par événement | Durée | Seuil de taille à l'écran |
|---|---|---:|---:|---|
| Copeaux | losange de 2 triangles, couleur bois | 4 à 6 | 0,6 s, trajectoire balistique | rapproché seulement |
| Éclats de pierre | tétraèdre de 4 triangles | 3 à 5 | 0,5 s | rapproché ; 1 éclat au zoom moyen |
| Poussière | disque à 8 triangles, opaque clair, qui s'agrandit et s'enfonce dans le sol | 1 | 0,7 s | moyen et rapproché |
| Feuilles | losange vert, chute en zigzag | 2 à 3, 12 à la chute | 1,5 s | moyen (chute) et rapproché |
| Anneau de chute d'arbre | disque de poussière de 0,8 m | 1 | 1 s | toujours, sauf vue lointaine |

**Budget :**
- au plus 40 particules actives par chantier, 300 pour tout le village ;
- au-delà, les nouveaux événements n'émettent rien ;
- pas de transparence triée : la poussière s'enfonce dans le sol au lieu de devenir transparente.

**Niveaux de détail**, selon la hauteur d'un villageois à l'écran, calculée depuis la distance caméra et le champ de vision :

| Hauteur | Gestes | Effets |
|---|---|---|
| ≥ 40 px | complets à chaque image | tous |
| 12 à 40 px (cible principale) | complets à chaque image | poussière, chute d'arbre, feuilles de chute, 1 éclat |
| < 12 px | toutes les 120 ms, comme aujourd'hui | aucun, sauf l'arbre accessoire qui reste couché ou debout selon son état |

## 10. Performances

- Le planificateur coûte O(1) par villageois et par image : aucune allocation par image, blocs mis en cache par villageois et invalidés au changement de bloc.
- La matière de chantier se réduit à quelques maillages partagés par type de pièce (tronçon, bûche, bloc, gravier, panier, tas), en *thin instances*. Le nombre de maillages ne grandit pas avec le nombre de chantiers.
- Mesures attendues avant livraison :
  - coût CPU du planificateur et des effets avec 8 chantiers de 10 villageois plus des jardins ;
  - appels de dessin ajoutés ;
  - cadence sur MX230 et Catmark.
- Aucune annonce de gain sans mesure.

## 11. Vérification

**Tests unitaires purs** (Vitest) :
- même `plan` et même `site` pour la même graine et le même `t`, quel que soit le chemin d'appel (pas à pas ou saut direct) ;
- aucune action de travail après `W1` ; pose neutre et rangement au plus tard à `W1 + 0,4 s` ;
- tronc entièrement consommé et tas prêt à charger à `W1` ;
- au jardin, l'événement « arracher k » tombe à ±1 image de `t_k` pour une fenêtre normale, et la séquence se compresse sans croiser `t_{k+1}` pour une fenêtre courte ;
- chute de l'arbre : planifiée, retardée par l'abatteur absent, plafonnée à 30 %, jamais rejouée après un saut de temps ;
- aucun événement du planificateur n'appelle le client API ni ne modifie l'état du village (le test existant de séparation est étendu) ;
- budget de particules respecté à 8 × 10 villageois.

**Recette humaine**, d'abord au zoom moyen, puis au zoom rapproché :
- bois à 1, 2, 3 et 10 villageois ; pierre à 1, 2, 3 et 10 ; jardin sur une, puis plusieurs parcelles ;
- F5 pendant la chute, le débitage et l'arrachage d'une touffe ;
- annulation ou fin anticipée, retour chargé, nuit sous les braseros ;
- critère : à 17 px, on reconnaît sans explication qui abat, qui scie, qui fend, qui pioche, qui casse, qui porte et que le jardinier récolte. L'arbre qui tombe se voit.

## 12. Tranches de réalisation

1. **Pivot de taille, poses clés et planificateur pur**, appliqués aux rôles existants, sans nouvel accessoire. Suppression du cycle global de 12 s. Recette des gestes au zoom moyen.
2. **Jardin** : séquence calée sur les touffes, carotte et panier. Le calendrier existe déjà, c'est la tranche la plus courte.
3. **Bois** : arbre accessoire et chute, tronc consommé, chevalet, fente, tas, copeaux et feuilles.
4. **Pierre** : réservoir de blocs, débitage, paniers, tas, éclats et poussière.
5. **Niveaux de détail des effets, budget et mesures** sur MX230 et Catmark.

Avant la tranche 1, un **prototype dans Blender** avec les figurines valide les poses clés et leur lisibilité à 17 px. Les poses retenues sont exportées en JSON (angles par articulation et par phase) et servent de valeurs initiales au jeu. Ce prototype ne remplace pas la recette dans le navigateur.

L'intégration de la figurine elle-même est indépendante de ce document : chaque tranche fonctionne avec les villageois actuels en pavés.

## 13. Hors périmètre

- Plusieurs jardiniers ou tout changement de règle métier.
- Physique rigide.
- Son, qui pourra se brancher sur les événements d'impact.
- Licorne et spécialisations.
- Arbre ou roche individuels persistants.
- Changement des tables de rôles, des effectifs ou des échéances.
