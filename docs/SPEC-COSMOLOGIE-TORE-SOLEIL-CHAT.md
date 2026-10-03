# Cosmologie du tore du soleil et du Chat

Date : 1er octobre 2026. Destinataire : Sol. Base relue : `main`, `0a0873a`, avec les travaux streaming et trois vues non commités.

Statut : **validée par Tristan, prototype implémenté dans le worktree, validations détaillées dans le handoff**. Tristan précise la géométrie : le plan du soleil contient l'axe de révolution ; les deux sections du tore sont encerclées par les deux boucles du huit, avec passage au-dessus et en dessous, à vitesse linéaire constante. Il demande ensuite de désynchroniser les deux mouvements, afin que chaque point du grand équateur soit éclairé au moins une fois sur leur cycle combiné. Ce critère remplace le critère de calibration d'un seul jour extérieur par rotation.

## Axiomes validés

Arbestra est physiquement un tore habitable. Dans le lore réel, il s'agit d'un donut appartenant à l'Oracle, tombé au sol puis poussé sous un meuble par son chat. La vie s'est développée sur sa surface. Les habitants ignorent généralement cette origine et ont construit leurs mythologies autour de l'Oracle, du monde annulaire et d'une entité assimilable au Chat.

Le gameplay local reste sérieux et le monde crédible depuis sa surface. **Décision visuelle ultérieure de Tristan, 1er octobre 2026 :** retirer de la scène le meuble/table, le modèle corporel du Chat (tête, silhouette et patte), le sol de la pièce et ses poussières. Leur révélation au dézoom n'est plus un critère de cette tranche ; le lore ci-dessus reste conservé. La vue Monde présente un fond noir étoilé et un voile nuageux sur le tore, relié à une traversée nuageuse plus épaisse. Cette révision est implémentée dans le worktree depuis le feu vert suivant l'audit ; recette visuelle humaine en cours.

Précision ultérieure validée : un regard isolé peut flotter discrètement dans le noir, son tapetum perceptible seulement sous un alignement favorable avec le soleil et la caméra. Il faut le chercher : aucun marqueur, cadrage automatique ou bouton de révélation. Cette exception visuelle est détaillée dans la spec des vues ; elle ne rétablit ni le corps du Chat, ni sa patte, ni le décor de la pièce. Le reflet est une présentation déterministe sans effet sur l’éclairage du monde.

Les étoiles gardent des directions fixes dans le repère non tournant contenant le plan solaire XY. Elles ne sont ni coplanaires au huit, ni attachées au soleil mobile, au tore ou à l'écran. La caméra attachée au tore voit donc le ciel défiler pendant sa rotation. Les nuages suivent au contraire la surface et son repère canonique. Les détails de rendu, le retrait du cadrage Chat et les critères de recette sont centralisés dans la [décision nuages et ciel de la spec des vues](SPEC-VUES-TERRAIN-REGION-MONDE-TORIQUE.md#décision-visuelle-courante--nuages-et-ciel-1er-octobre-2026).

Le tore tourne autour de son axe de révolution. Un soleil local suit une trajectoire de type lemniscate autour du centre du tore. Rotation, mouvement solaire et auto-occultation produisent des régimes lumineux différents selon la position. L'intention initiale d'environ un/deux cycles lumineux extérieur/intérieur par rotation est affinée par la demande courante : **désynchroniser les mouvements pour éclairer chaque point du grand équateur au moins une fois par cycle combiné**. Les comptes intérieurs et intermédiaires restent mesurés, sans imposer silencieusement le ratio initial. Seconds jours courts, doubles crépuscules et occultations partielles sont compatibles avec cette intention.

La cohérence requise est géométrique et déterministe dans les règles d'Arbestra. Aucun réalisme orbital terrestre n'est requis. Ne pas rouvrir ces axiomes sauf contradiction technique réellement bloquante. Si un huit strict ne donne pas les régimes voulus, conserver l'intention et rechercher le plus petit ajustement de courbe nécessaire.

**Suite narrative validée :** découvrir ce regard accomplit une quête cachée et inscrit **« Les yeux dans les yeux »** au journal. L’Oracle, qui cherchait son chat, demande alors au joueur s’il l’a aperçu, sans possibilité de répondre. Cette complétion persistante est la seule extension narrative autorisée ici ; elle ne change pas les ressources ou les cycles lumineux. Le déclencheur visuel proposé et le raccord au Grimoire existant sont décrits dans la spec des vues. Toujours documentaire, non implémenté.

## Périmètre et ordre de travail

1. Dans la vue Monde existante, ajouter un mode debug : rotation, soleil visible, trajectoire, pause et curseur temporel.
2. Placer des sondes aux deux équateurs et entre eux ; afficher leurs intervalles éclairés et compter leurs levers sur une rotation. Calibrer la trajectoire sur plusieurs longitudes.
3. Brancher la même phase et la même règle d'éclairage sur les vues locale et régionale. Vérifier coutures, normales, picking et transitions.
4. Appliquer, après autorisation d'implémenter, la décision visuelle courante : retrait du décor sous le meuble, fond noir, étoiles fixes dans le repère solaire, voile torique et transition nuageuse épaissie. Restaurer d'abord la fiabilité des transitions identifiée par l'audit.
5. Poursuivre ensuite le streamer existant pour les implantations voisines autorisées par le serveur. Cette suite devra préciser ses données publiques et ses règles d'accès avant toute exposition ; elle ne fait pas partie du premier prototype cosmologique.

Le premier résultat attendu est de savoir faire tourner le tore, déplacer le soleil, déterminer qui est éclairé et continuer à streamer une région. Pas de nouveau moteur orbital ni de refonte générale.

## Temps de production et libellés régionaux — décision du 1er octobre 2026

**Validé par Tristan, implémenté dans le worktree pour recette :** une trajectoire solaire complète (les deux lobes du huit) dure **12 heures réelles en production**. Le temps affiché est le temps réellement écoulé depuis le début de cette trajectoire, et non l'heure civile du joueur, le temps de connexion ou une horloge fictive de 24 heures compressée en 12 heures. Ces durées sont également actives par défaut en développement ; le debug permet une accélération temporaire, remise au temps normal à sa fermeture.

| Paramètre | Prototype actuel | Production spécifiée |
| --- | --- | --- |
| Trajectoire solaire complète | 180 s | 12 h = 43 200 000 ms |
| Rotation du tore | 120 s | 8 h = 28 800 000 ms |
| Répétition de la configuration tore/soleil | 360 s | 24 h = 86 400 000 ms |

Les 8 h et 24 h découlent du rapport déjà validé : trois rotations pour deux trajectoires solaires. La demande de 12 h porte sur **un huit complet**, pas sur le cycle combiné. Les vitesses linéaires restent constantes selon la longueur d'arc. Les réglages accélérés de debug restent des outils de recette ; ils ne modifient pas la configuration de production ou l'économie.

Pour une époque commune `t0` et le temps serveur estimé `t` :

```text
Tsoleil = 12 h
ecoule = modulo(t - t0, Tsoleil), dans [0, 12 h[
H = floor(ecoule / 1 h)
MM = floor(ecoule / 1 min) modulo 60, sur deux chiffres
```

Afficher `H:MM`, de `0:00` à `11:59`, puis revenir à `0:00` au début du huit suivant. Le compteur ne repart pas de zéro à chaque lever local ou à l'entrée au village. Toute date de référence est commune au monde ; changer de vue, de fuseau horaire ou recharger l'onglet ne réinitialise ni compteur ni phase. Le temps continue à s'écouler pendant l'écran-titre et son assombrissement temporaire.

**Libellés locaux validés :** chaque région possède son propre graphe d'ensoleillement ; employer « 1er matin », « 2nd matin » lorsque le graphe comporte plusieurs passages, et distinguer les crépuscules correspondants. Certaines régions connaissent deux matins et deux crépuscules. Ne pas fabriquer deux passages partout, ni déduire le matin d'une simple plage globale `H < 6`. Le calcul local provient des normales, du soleil et des occultations déjà définis. Pour le titre d'un village, la référence proposée est sa cellule d'ancrage canonique, afin qu'un petit déplacement du cadrage ne change pas son libellé.

**Midi** désigne le milieu temporel de la trajectoire de 12 h : **6 h écoulées, 6 h restantes**. Ce repère d'horloge n'est pas nécessairement le maximum d'éclairement local. **La nuit affiche uniquement « Nuit », sans heure** ; elle reste prioritaire si la région est sombre à la mi-trajectoire. Exemples de forme, sans imposer leur phase à toutes les régions : `(1er matin 1:24)`, `(2nd matin 8:10)`, `(Midi 6:00)`, `(2nd crépuscule 10:45)`, `(Nuit)`.

**Précisions de calcul proposées pour l'implémentation :** conserver le graphe de référence sur les 24 h de répétition et en extraire la fenêtre solaire courante de 12 h. Après 12 h, le tore a effectué une rotation et demie : le graphe local du huit suivant n'est donc pas supposé identique au précédent. Numéroter chronologiquement les passages de la fenêtre courante ; un intervalle éclairé commencé avant sa borne est un intervalle déjà en cours, pas un nouveau lever créé à `0:00`. Les règles exactes de passage du libellé matin au crépuscule, le traitement des passages très courts et la durée lisible du libellé Midi restent des réglages à préciser à partir du graphe, sans déplacer les événements lumineux réels. Ne pas plafonner artificiellement un graphe comportant davantage de passages.

La source et la durée de l'heure sont désormais arbitrées ; seules les limites éditoriales de ces libellés restent ouvertes. La recette devra couvrir deux huit consécutifs, les régions à un ou plusieurs passages, la nuit au milieu de cycle, la borne `11:59 → 0:00`, les coutures, le rechargement et l'écran-titre. Aucun calendrier régional supplémentaire n'est requis pour afficher ces valeurs.

## Conventions initiales acceptées

- **Précision ultérieure validée : périodes distinctes**, issues d'une époque commune. Réglage accéléré du prototype : tore 120 s, huit solaire 180 s ; cycle combiné 360 s, soit trois rotations et deux huit. La production adopte les durées 8 h / 12 h / 24 h ci-dessus. Une simple différence de phase avec des périodes identiques ne suffit pas.
- Une rotation de **120 secondes en prototype**, réglable ; ce n'est pas le calendrier définitif du monde.
- Critère courant : chaque point du grand équateur reçoit au moins un passage éclairé sur le cycle combiné. Les nombres de levers intérieurs et intermédiaires sont mesurés sur ce même cycle et publiés ; ne pas les confondre avec des comptes par rotation.
- Aucun effet économique de la lumière pendant cette première passe. Aucune modification des durées de travail, des crédits ou du transport à une seconde par case.
- Une cohorte simulée peut être représentée par quelques PNJ Babylon. Les personnages visibles ne deviennent pas automatiquement des individus persistants.

## Existant à réutiliser

La [spec des trois vues](SPEC-VUES-TERRAIN-REGION-MONDE-TORIQUE.md) et le [handoff courant](../SESSION-HANDOFF.md) décrivent une implémentation encore en validation. Ne pas assimiler leurs critères à des preuves déjà obtenues.

- `apps/world-web/src/scene/world-space.ts` : `WorldSpace`, modulos, projection locale, changement d'origine et demande de chunks.
- `apps/world-web/src/scene/terrain-overview-view.ts` : `torusPoint`, `torusCell`, `RegionalOverview`, `TorusOverview`, texture agrégée et picking du tore.
- `apps/world-web/src/scene/BabylonVillageScene.ts` : `showWorld`, `showRegion`, `showVillage`, chargement de l'aperçu et navigation entre les vues.
- `apps/api/src/modules/worlds/terrain-overview.ts` : aperçu du terrain persisté et densité végétale séparée.
- `terrain-store.ts` et `terrain-renderer.ts` : cache et résidence graphique bornés. Leur identité canonique ne dépend pas de la rotation cosmologique.

Babylon apporte les transformations, lumières et ombres. Utiliser une `PointLight` pour la source proche en vue Monde et, si l'approximation est suffisante sur l'emprise locale, une `DirectionalLight` dont la direction vient du même soleil. Les ombres graphiques ne deviennent pas une autorité économique. [Documentation Babylon des lumières](https://doc.babylonjs.com/features/featuresDeepDive/lights/lights_introduction/).

## Coordonnées et rotation

Pour les cellules canoniques `(x, y)` d'un monde de dimensions `W × H` :

```text
u = 2π x/W
v = 2π y/H + π
a = u + Ω(t - t0)

P = ((R + r cos(v)) cos(a), r sin(v), (R + r cos(v)) sin(a))
N = (cos(v) cos(a), sin(v), cos(v) sin(a))
```

`R > r > 0`, axe vertical `Y`. Le décalage de `π` conserve la convention actuelle de projection du donut. Le grand équateur correspond à `v = 0 mod 2π`, le petit à `v = π mod 2π`. `N` est la normale extérieure unitaire.

Cette écriture fixe le sens mathématique choisi ; vérifier les signes de rotation des matrices Babylon par une projection/inverse connue. Ne pas appliquer la rotation à la fois aux coordonnées et au parent graphique. Le picking sur le tore tourné applique la transformation inverse avant `torusCell`.

Les identifiants `(world_id, x, y)`, les tableaux de terrain et les caches restent fixes. La grille conserve sa métrique conventionnelle de gameplay, même si les longueurs physiques sur le tore varient entre extérieur et intérieur. Aucun calcul de gravitation n'est demandé.

## Trajectoire solaire et temps

Géométrie précisée par Tristan pendant la recette : un huit horizontal **dans un plan vertical contenant l'axe Y**. Vu selon Z, les sections circulaires du tore sont centrées en `(-R, 0)` et `(R, 0)` ; chacune est entièrement contenue dans une boucle. Les croisements sont au centre du trou. Le soleil passe alternativement au-dessus puis en dessous de chacune des sections. Les lobes ne sont ni décalés hors du trou, ni relevés ensemble au-dessus du tore, ni empilés le long de Y.

```text
S(q) = (A cos(q), B sin(2q), 0)
A = 5,5 ; B = 3 ; R = 2,4 ; r = 1
S(π/2) = S(3π/2) = (0, 0, 0)
```

Le test d'encerclement vérifie tout le contour de chaque section dans l'intérieur du huit : `y² < 4 B² (x/A)² (1 - (x/A)²)`. La marge est également contrôlée pour la sphère solaire visible de rayon 0,13. La ligne debug est échantillonnée selon `q`, indépendamment de la vitesse temporelle, pour conserver le tracé exact lors des passages rapides.

Tristan précise ensuite que la **vitesse linéaire doit être constante sur toute la trajectoire**. La variation de cadence introduite pour rechercher le ratio 1/2 est retirée. La référence actuelle inverse la longueur cumulée du huit :

```text
L(q) = ∫₀ᑫ sqrt(A² sin²(s) + 4 B² cos²(2s)) ds
f = modulo(ω(t - t0) + φ, 2π) / 2π
q = L⁻¹(f L(2π))
vitesse = L(2π) / période
```

Deux traversées du huit pour trois rotations, sans inversion de mouvement. Une table de 4 096 segments est calculée une seule fois par géométrie, puis inversée par recherche binaire et interpolation. Le test mesure des déplacements pour des durées égales à 1 024 phases, avec une tolérance de vitesse de 0,2 %. Le temps reste évalué directement depuis l'époque commune, sans cumul par frame. Aucun décentrage, torsion hors du plan, relèvement des lobes ou variation de vitesse linéaire n'est permis pour résoudre le critère d'éclairage.

La phase du cycle combiné est `ξ = modulo(2π(t-t0)/Tcombiné, 2π)`, avec `Tcombiné = 360 s` dans le prototype accéléré et `24 h` dans la production spécifiée. La rotation vaut `3ξ`, le progrès solaire à longueur d'arc constante vaut `2ξ`. Le curseur et les intervalles debug portent sur `ξ`. Le réglage de période du tore conserve le ratio 3/2 : période solaire = 1,5 × période du tore ; période combinée = 3 × période du tore. Le compteur H:MM porte sur une trajectoire solaire, pas sur `ξ` entier. Pause de debug, changement d'échelle et suspension navigateur préservent la cohérence des deux phases ; une suspension ordinaire du navigateur ne gèle pas le temps du monde.

**Garantie sur tout le grand équateur** : aux fractions 0, 1/4, 1/2 et 3/4 du cycle combiné, le soleil se trouve aux extrémités `x=±A, y=0` ; les orientations relatives au tore sont séparées de π/2. Toute longitude est donc distante d'au plus π/4 d'une orientation. Pour `ρ=R+r=3,4`, l'incidence minimale du meilleur passage est `(A cos(π/4)-ρ)/sqrt(A²+ρ²-2Aρ cos(π/4)) > 0,12`, largement au-dessus du seuil 0,01. Le rayon part vers l'extérieur avec une distance à l'axe croissante au-delà de `R+r` : il ne traverse pas la matière du tore. Par continuité, ce témoin donne un intervalle éclairé de durée positive, pas un instant isolé. Les tests complètent cette borne continue avec 2 048 longitudes aux quatre témoins et 128 longitudes sur tout le cycle.

La phase dépend directement du temps serveur estimé, d'une époque commune et de la configuration. Éviter l'intégration cumulative par frame. Le curseur debug modifie uniquement le temps de présentation ; il ne touche pas l'économie. Les trois vues évaluent les mêmes fonctions à la même date. Aucun service d'horloge ou moteur orbital supplémentaire n'est requis.

## Éclipse visuelle à l'arrivée au village — décision de présentation

Tristan demande une cinématique Région → Village : fondu au noir, titre village/heure, atterrissage caméra, révélation avec flou très fin, restauration lumineuse sur 3 s, puis disparition du titre ; brume nocturne discrète pendant la séquence. Le soleil s'assombrit temporairement pendant cette séquence. Il s'agit d'un facteur de présentation local, à composer avec les lumières rendues et à remettre à sa valeur normale en fin ou annulation. La trajectoire, les phases, la fonction `illumination()`, les comptes de levers et le temps serveur continuent ; aucune éclipse astronomique ou conséquence économique n'est introduite. L'éclairage révélé est celui du temps courant, pas celui du début du titre. L'heure `H:MM` suit l'arbitrage de production ci-dessus : temps réel écoulé dans le huit de 12 h, libellé lumineux local et « Nuit » sans heure. La séquence et les critères sont détaillés dans la spec des vues. Implémenté pour recette humaine, voir la passation courante.

## Éclairage et occultation

Une position reçoit le soleil direct si `N · normalize(S - P) > 0` et si le segment vers le soleil ne traverse pas le tore. Dans le repère du tore centré :

```text
F(X,Y,Z) = (X² + Y² + Z² + R² - r²)² - 4R²(X² + Z²)
```

La surface vérifie `F = 0`, la matière `F < 0`. Exclure l'intersection de départ avec une tolérance adaptée à l'échelle. Traiter explicitement les rayons tangents, les bords du segment et les imprécisions flottantes. Un soleil ponctuel suffit d'abord. Pour des occultations partielles, échantillonner ensuite un petit disque solaire avec un nombre borné de rayons.

La courbe solaire doit rester hors de la matière du tore. Le sol de la pièce et le meuble sont retirés du rendu. Le voile nuageux décoratif et les étoiles ne participent pas à l'occultation de référence et ne changent pas les régimes lumineux validés.

Une fonction pure constitue la référence de l'éclairage. Le rendu peut en interpoler les résultats sur un petit maillage plutôt que calculer chaque cellule à chaque frame. Comparer cette approximation à la référence près des terminateurs et occultations. Les ombres de bâtiments et du relief restent un détail visuel distinct de l'occultation cosmologique.

## Continuité des vues et du streaming

La vue locale reste chunkée et la vue Monde agrégée ; aucun téléchargement de tous les détails locaux. Reprendre les budgets, gardes de version et règles de fraîcheur de la [spec streaming](SPEC-STREAMING-TERRAIN.md).

Transformer la direction solaire dans le repère tangent du lieu observé. Les voisins partagent une même évaluation canonique de lumière et de temps, y compris aux deux coutures. Tourner le donut ne déclenche ni rechargement de terrain ni mouvement des entités métier. Les transitions conservent la cellule sélectionnée, la phase cosmologique et les phases de missions établies par le serveur.

La chaîne future reste : monde partagé → chunks voisins → implantations visibles → marché → transport/cohortes → interaction/interception/combat léger. Elle guide la compatibilité, pas le périmètre de ce prototype. Aucun modèle individuel de population ni système de combat n'est à créer maintenant.

## État de la contre-validation

**Après les précisions de recette et la désynchronisation, les résultats historiques ci-dessous sont invalides pour le mouvement actuel.** La référence reproductible est `scripts/calibrate-cosmology.ts`, lancée avec `corepack pnpm exec tsx scripts/calibrate-cosmology.ts 8192` : 64 longitudes, neuf bandes, sur un cycle combiné entier, occultation par extrema du polynôme quartique. Le rapport local ignoré est `test-results/cosmology-calibration.json`. Le seuil direct est 0,01 ; un lever significatif dure au moins 1 % d'une rotation (1,2 s pour 120 s), soit 1/300 du cycle combiné, sans cacher les intervalles plus courts. Les résultats sont publiés dans le handoff courant. Le debug expose les périodes des deux mouvements et leurs intervalles réels sur le cycle combiné.

Le bouton **Profil du huit** cadre le plan solaire. Ce cadrage externe est temporaire : sa sortie restaure l'attachement et le lieu observé ; il ne doit pas contaminer les prochaines transitions. Le sol décoratif et le contrôle **Apercevoir le Chat** sont retirés, y compris leur état persistant. L'occultation de référence porte sur le tore.

Une exploration numérique isolée a utilisé `R = 2,4`, `r = 1`, une rotation de phase `t` et le soleil `S = (6,2 + 8,25 cos(t + 0,31), 3,1, 2,75 sin(2(t + 0,31)))`. Sur 64 longitudes, 2 048 instants par rotation et 127 points intérieurs de contrôle par rayon : 59 positions extérieures ont un passage éclairé, cinq aucun ; 61 positions intérieures ont deux passages, trois un seul.

Ces résultats montrent une possibilité qualitative, pas une validation finale. Le décentrage est important, l'occultation échantillonnée peut manquer un passage fin, et les régions intermédiaires peuvent présenter du jour ou de la nuit permanents. Le script exploratoire exécuté en ligne n'a pas été conservé comme test du dépôt. Sol doit produire une vérification reproductible avant de figer les paramètres. Les nombres ci-dessus ne constituent ni un seuil d'acceptation de 59/64 ou 61/64, ni une autorisation implicite de nuits permanentes dans les bandes visées.

## Preuves attendues et critères de sortie

- Rotation, trajectoire et éclairage reproductibles à date identique, indépendants de la cadence, de la pause navigateur et du chargement de chunks.
- Mesures des passages éclairés aux deux équateurs et sur des bandes intermédiaires, sur plusieurs longitudes et des périodes complètes ; distinguer nuit permanente, jour permanent et zéro transition.
- Définition publiée du seuil de lumière, de la durée minimale d'un passage et des tolérances numériques ; ne pas masquer une exception en changeant le seuil silencieusement.
- Occultation correcte sur des rayons dégagés, bloqués, tangents et proches des coutures ; soleil hors matière sur toute sa trajectoire.
- Projection/picking réciproques après rotation ; mêmes coordonnées et éclairage à la sortie et au retour des trois vues.
- Recette navigateur desktop et portrait : debug lisible, navigation fluide, aucun rechargement immuable provoqué par la rotation, pas d'effet sur les crédits ou les phases de missions.
- Mesurer le surcoût CPU/GPU et la mémoire face à la vue existante ; conserver les limites de la spec trois vues. Réutiliser la scène actuelle et des calculs bornés.
- Fond mondial noir, étoiles fixes dans le repère solaire, voile nuageux attaché au tore et traversée nuageuse cohérente. Absence du meuble, du corps du Chat, du sol de pièce et du cadrage Chat ; seule exception : le regard discret, trouvable sous un alignement solaire favorable. Monde local crédible ; la perception artistique reste à apprécier avec Tristan.

## Points ouverts et instructions de reprise pour Sol

Restent ouverts : paramètres solaires finaux, largeur des bandes équatoriales de recette, exceptions régionales admissibles, limites éditoriales des libellés horaires et réglages artistiques des nuages/étoiles. Le décor sous le meuble est hors de la cible visuelle courante. Si la calibration exige une exception produit, montrer une carte et des courbes mesurées à Tristan ; ne pas rouvrir le principe du tore.

Calendriers régionaux, écologies, plantes, rythmes sociaux, mythologies du second lever et conséquences sur agriculture, production ou commerce sont des champs futurs. Aucun de ces systèmes n'est à implémenter dans cette tranche.

À la reprise d'implémentation, après feu vert : lire `AGENTS.md`, le handoff courant et cette spec ; vérifier le diff réel. Le prototype debug/sondes existe : traiter d'abord le blocage de transition documenté, puis la décision visuelle courante, en conservant les fonctions solaires calibrées. Préserver les travaux préexistants, publier les preuves et les limites. Aucun commit/push n'est autorisé par la seule demande de figer cette spec.
