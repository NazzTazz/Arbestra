# Vues Village, Région et Monde torique

Date : 1er octobre 2026. Base relue : `main`, `0a0873a`, avec l'implémentation streaming non commitée du worktree. Babylon installé : **8.56.2**.

Statut : **implémentation autorisée par Tristan le 1er octobre 2026, en cours de validation dans le worktree**. Cette spec reste la cible et sa liste de vérifications n'est pas une preuve de livraison. Les comportements exécutés et les limites constatées figurent dans [la passation courante](../SESSION-HANDOFF.md).

Cette tranche prolonge [le streaming existant](SPEC-STREAMING-TERRAIN.md). Elle remplace, dans la cible proposée, sa couverture globale fixe de 48 cases et son exclusion des LOD et de la vue planète. Elle conserve ses garanties de cache, fraîcheur, monde, mémoire bornée et temps serveur. Le document antérieur reste la description de l'étape déjà implémentée.

Suite validée le 1er octobre 2026 : [cosmologie du tore, du soleil et du Chat](SPEC-COSMOLOGIE-TORE-SOLEIL-CHAT.md). Le tore physique, la rotation et le soleil en huit restent les axiomes de cette suite. La décision visuelle ci-dessous remplace la révélation du décor sous le meuble. Les paramètres lumineux restent à calibrer ; cette suite ne clôture pas les vérifications des trois vues et n'introduit aucun calcul de gravitation.

## Décision visuelle courante — nuages et ciel, 1er octobre 2026

Raccourci de recette C : ouvre la vue torique et cadre les yeux du Chat avec une caméra détachée du tore. Éclairage du tapetum inchangé ; pas de validation automatique de quête depuis ce cadrage. Retour Région/Village par les contrôles existants avec restauration de la navigation sauvegardée. Champs de saisie exclus.

Vent nuageux : mouvement hélicoïdal continu autour de l'anneau et de sa section, deux enroulements autour du tube par tour de l'anneau (120 s). Pas légèrement ondulant pour donner des volutes ; couche maintenue autour du tore. Le champ de couverture, le volume et le garde d'occultation du Chat suivent ce mouvement commun. Effet visuel uniquement, à recetter.

Recette de vitesse : dans la vue torique, nuages ×10 ; soleil et rotation du tore ×5 à distance. La caméra attachée accompagne toujours le tore ; sa rotation se voit lorsque la caméra est détachée. Accélération de présentation uniquement, atténuée au rapprochement pour retrouver la phase lumineuse locale avant la transition. Les périodes de production et les échéances des missions restent inchangées.

### Survol clavier V et centrage de l'arrivée

Tristan autorise une séquence de recette sur V (hors champs de saisie) : départ au dézoom maximal du tore, orbite complète de 12 s dans son repère tournant, approche de 6 s vers la normale du village, masque nuageux existant puis cinématique d'arrivée de 5,2 s. La rotation du tore et le mouvement solaire continuent. Les contrôles caméra sont suspendus pendant la séquence et restitués à la fin ; Échap permet l'interruption. Attente globale bornée à 45 s si la préparation échoue. Le survol automatique ne déclenche pas la découverte du Chat.

Au zoom manuel vers la surface torique, redressement progressif vers la normale près du seuil de retour. L'arrivée Région→Village interpole aussi le point visé vers le centre de l'emprise de l'hôtel de ville, calculé en coordonnées canoniques avec gestion des coutures, plutôt que de conserver la cible régionale. Les tests ciblés couvrent ce centre et l'interpolation de directions opposées ; fluidité et cadrage sous tous les angles restent en recette humaine.

**Implémentation autorisée puis réalisée dans le worktree ; recette humaine interactive en cours.** Cette révision suit l'audit du blocage LOD et prévaut sur les anciennes prescriptions de décor et de cadrage debug. Tristan demande des vérifications ciblées, sans campagne E2E ; les appréciations visuelles restent à valider avec lui.

Réglages de cette première recette : masque 450/200/450 ms, attente de préparation/frame opaque bornée à 2,5 s, retour des contrôles et délai de retry de 5 s sur échec ; deux nappes partagent la texture. Shaders Layer et shadowMap importés explicitement dans le graphe du moteur. Nuages mondiaux : enveloppes transparentes périodiques, étoiles : un lot de 2 200 directions fixes. Les yeux sont agrandis ×2, écartement ×2 ; reflet maximal 0,7 (lobe de puissance 32). La découverte exige chaque œil dans les 30 % centraux en largeur et 40 % en hauteur, au moins 12 × 16 pixels CSS et un reflet ≥0,28. Le regard demande 1,8 s continuellement visible ; la disparition de l'onglet annule cette observation. Accomplissement `cat-eyes` persistant dans le journal existant, sans migration ni récompense économique.

Caméra : ancre maintenue sur la surface au lieu du recentrage vers l'origine ; rayon d'entrée dérivé de l'emprise plane et du métrique local du tore, avec transfert du champ de vision. Un dégagement vers le haut/bas évite le tube opposé au dézoom intérieur. Ce dégagement et l'anisotropie de la projection restent à apprécier en recette ; l'emprise est une approximation locale, pas une déformation isométrique. Le cadrage debug restaure la navigation mémorisée. Le sol détaillé s'efface avec les autres détails avant sa suspension.

Arrivée : après recette, noir/titre/atterrissage en 5,2 s (1,2 s avec réduction des animations), restauration lumineuse sur 3 s, puis disparition du titre ; interruption par clic/Échap/molette. Seul un cadrage à moins de 24 cases de l'ancre du village connu déclenche son titre. L'horloge couvre les deux huit du graphe de 24 h ; Midi dispose provisoirement d'une fenêtre de lecture de ±2,5 min autour de 6 h. Matin = premiers 40 % du passage éclairé, crépuscule = derniers 25 %, jour entre les deux. Ces seuils éditoriaux sont des réglages de recette.

### Traversée d'une couche nuageuse plus épaisse

- Le passage Région ↔ Monde traverse une masse nuageuse visuellement plus épaisse : nappes superposées, volumes suggérés, variations de densité et mouvement relatif doux. Augmenter seulement l'alpha final ne suffit pas : le masque actuel vise déjà une opacité de 1.
- Conserver un passage court, avec une phase centrale entièrement opaque effectivement rendue. À la découverte, montrer la région observée et sa courbure, au même cap et à une emprise comparable ; aucun cadrage automatique sur le tore entier.
- **Réglage proposé pour la recette**, non arbitré : couverture 450 ms, palier opaque 150–250 ms, découverte 450 ms. La profondeur visuelle vient d'abord des nappes, pas d'une attente prolongée. La réduction des animations conserve les seules frames nécessaires au masquage.
- Le masque de transition et le voile mondial partagent une palette blanc légèrement bleuté et des motifs de densité compatibles. La dernière nappe se dissipe vers le voile de surface ; éviter une coupure entre écran couvert et tore entièrement découvert. Le retour utilise la même continuité en sens inverse.

### Voile persistant sur le tore

- En vue Monde, conserver des nuages discontinus et semi-transparents au-dessus de la surface : eau, côtes et grands repères restent lisibles à travers les éclaircies. Le voile persiste après la transition et reste perceptible au dézoom global.
- Les nuages sont associés aux coordonnées canoniques du tore et suivent son parent tournant ; ils ne sont pas collés à l'écran. La caméra attachée retrouve donc le même lieu et sa couverture. La tranche météo ci-dessous autorise désormais une dérive autonome dans ce repère canonique.
- **Mécanisme proposé** : une enveloppe torique légèrement surélevée, matériau Babylon transparent et texture périodique réutilisée. Conserver les occlusions par le tore, les coutures et une altitude hors du sol ; les nuages ne capturent aucun picking et ne masquent pas tous les repères de sélection. Le masque plein écran reste une Layer distincte, car il doit cacher toute la bascule, y compris hors de la silhouette du tore.
- Les nuages restent une présentation : aucun effet sur la référence jour/nuit, l'agriculture ou les durées économiques. Après rejet des enveloppes puis des sprites, Tristan autorise le prototype volumétrique borné décrit ci-dessous ; cette décision remplace l'exclusion initiale du raymarching. Pas de simulation atmosphérique physique.

### Météo environnementale — décision du 1er octobre 2026

**Validé :** premières interactions avec l'environnement, effets agricoles reportés. Aucune modification de rendement, ressources, transport ou autorité serveur.

Champ périodique déterministe par monde, coordonnées canoniques et temps serveur : éclaircies, masses nuageuses advectées, pluie sous couverture dense ; champ partagé aux trois LOD. En Monde, `TorusFog` remplace les coquilles et le SolidParticleSystem rejetés en recette : brouillard continu entre les altitudes 0,015 et 0,52 au-dessus du tube, densité érodée par un bruit 3D à trois échelles. Rotation canonique et dérive 1200/2400 s conservées. Aucun sprite ni maillage nuageux visible.

Babylon 8.56.2 fournit PostProcess, RawTexture3D et DepthRenderer ; le shader de volume est spécifique au tore. Intégration à demi-largeur et demi-hauteur, au maximum 96 pas par rayon, arrêt sur profondeur opaque et extinction ; composition avec la scène originale. Texture de bruit 32³, cibles intermédiaires demi-flottantes et décalage des échantillons pour réduire les bandes. Ressources liées au cycle de vie de la scène Monde.

Radiance : nuages éclairés blancs, très légèrement chauds, diffusion renforcée vers le soleil ; occultation du soleil par le tore par marche de distance bornée à 20 pas, faible lueur nocturne bleutée fluctuante. Après recette « trop gris », lumière directe relevée et atténuation des cœurs réduite. L'atténuation interne est stylisée ; pas de calcul complet d'auto-ombrage des nuages. La détection des yeux emploie un garde conservateur de traversée des bancs denses. Volume observé dans le navigateur ; dernier réglage du blanc, qualité de la sortie d'éclipse, finesse du bruit et coût GPU prolongé restent à recetter.

Terrain assombri sous les nuages et par l'humidité ; pluie puis séchage accéléré par l'ensoleillement. L'humidité est une mémoire visuelle bornée à 20 minutes, recalculable après rechargement, sans persistance métier. Eau : anneaux de pluie ; végétation : faible déformation au vent. ParticleSystem natif Babylon : au maximum 480 gouttes dans une emprise de 48 unités autour de la cible, seulement en Village sous rayon 160. Gouttes arrêtées au sol connu ; aucun chargement de détail pour la météo.

Texture commune 128 × 64 (couverture/humidité/pluie), actualisation visée toutes les 2 s ; humidité sur grille 16 × 8 toutes les 30 s. Calcul réparti en petits lots, budget coopératif de 2 ms/image, publication d'une texture complète. StandardMaterial/MaterialPluginBase conservent textures, lumières, brouillard et thin instances. Ombres nuageuses stylisées par atténuation sous la couverture, sans projection exacte depuis le soleil. Aucun paquet supplémentaire, simulation atmosphérique physique, collision de pluie avec les toitures ni effet agricole. Qualité et performance prolongée restent en recette humaine.

### Fond noir et étoiles dans le repère solaire

Dernier ajustement validé en recette : faible lueur bleutée des nuages, légèrement renforcée, surtout près du bord apparent (incidence rasante), pour deviner le tore de nuit. Fluctuation lente par zones, périodes de 24/40 s, amplitude combinée 25 %. Le sol reste noir hors éclairage solaire. Éclairs évoqués comme alternative, non implémentés dans cette passe.

Réglage du ciel : 2 200 directions pseudo-aléatoires reproductibles, sans spirale régulière ; tailles et éclats continus avec quelques étoiles dominantes, teintes chaudes/neutres/froides, cœur doux texturé. Un lot de géométrie et une texture partagée. Un ParticleSystem distinct ajoute jusqu'à 180 poussières spatiales à profondeur réelle dans le repère solaire, dérive lente et apparition/extinction progressive ; les étoiles conservent leurs directions fixes. Les ressources sont détruites avec la scène Monde.

- La vue Monde a un fond noir, avec 2 200 étoiles de positions et luminosités stables, plus lumineuses que les 520 initiales. Aucun éclairage ambiant ni émission propre du terrain/nuages en Monde : seule la face éclairée par le soleil est visible. Soleil emissif HDR, halo GlowLayer limité au soleil (512²), cinq LensFlare natifs avec occultation par le tore. Les vues planes conservent leur éclairage de lisibilité.
- « Fixes par rapport au plan solaire » signifie un ciel directionnel fixe dans le repère non tournant qui contient la trajectoire solaire, actuellement le plan XY. Les étoiles se répartissent sur la voûte céleste, pas uniquement sur ce plan. Elles ne suivent ni la position instantanée du soleil ni la rotation du tore.
- La caméra accompagne le tore : les étoiles défilent donc naturellement dans son champ pendant la rotation. Une rotation manuelle change également le ciel visible. Elles ne doivent pas rester figées aux mêmes pixels ni présenter une parallaxe de proximité.
- **Mécanisme proposé** : un fond céleste Babylon à directions déterministes, rendu en un lot ou une texture partagée, sans parent tournant. Le tore, le soleil et les nuages passent devant les étoiles ; celles-ci n'éclairent pas la scène. Aucun objet persistant ou téléchargement par étoile.
- Retirer de la scène mondiale le meuble/table, le modèle corporel du Chat (tête, oreilles, silhouette et patte), le sol de la pièce et ses poussières, ainsi que le bouton « Apercevoir le Chat » et son état de cadrage persistant. Seule l'exception du regard discret décrite ci-dessous demeure. Le terrain habitable et le sous-sol technique des vues planes ne sont pas concernés. Le lore du donut de l'Oracle reste documenté.
- Le debug solaire peut conserver sondes et profil du huit ; sortir de son cadrage externe doit restaurer la navigation attachée, sans état caché imposé à l'entrée Monde suivante.

### Exception validée — un regard de Chat à chercher dans le noir

Tristan précise la décision : une paire d'yeux peut flotter dans le fond obscur, avec le tapetum révélé par le soleil. Sa découverte demande de chercher ; elle ne doit pas attirer immédiatement l'attention. Cette exception ne rétablit ni le modèle du Chat ni son ancien cadrage.

- Présence limitée à la vue Monde : deux reflets ténus, contours diffus et pupilles suggérées, sans visage éclairé. Garder le fond noir et les étoiles ; aucun halo étendu ou contraste dominant le tore et le soleil.
- Réglage de recette : yeux et écartement ×2, reflet maximal 0,7. Découverte : chaque œil dans les 30 % centraux en largeur et 40 % en hauteur, emprise minimale 12 × 16 pixels CSS, reflet ≥0,28, observation continue 1,8 s. Prévenir la découverte d'un regard trop petit pour être remarqué ; conserver les accomplissements déjà enregistrés.
- Le regard occupe une zone restreinte du décor, dans le repère non tournant du plan solaire. Il n'est pas lié à la caméra ni automatiquement placé au centre du champ. **Proposition de mise en scène** : une dérive très lente, bornée et déterministe pour suggérer le flottement, sans poursuivre le joueur ni modifier les étoiles fixes.
- Le tapetum est un **reflet solaire stylisé**, pas une paire de lampes permanentes : sa visibilité dépend de la position courante du soleil, de la direction d'observation et d'un alignement favorable. Apparition et extinction progressives ; éviter flash, clignotement ou pulsation qui signalerait l'easter egg. Respecter l'occultation par le tore et l'atténuation par les nuages ; le regard ne doit pas apparaître par-dessus eux.
- La géométrie décorative, l'orientation et la largeur de la fenêtre de reflet sont à régler pour garantir des occasions réellement observables sur le cycle solaire, sans imposer un nouvel événement aléatoire ou un long délai arbitraire. À position caméra et date identiques, le résultat est reproductible. Un même reflet ne reste pas visible sous tous les angles.
- Avant découverte : aucun bouton de révélation, marqueur, notification d'indice ou rotation automatique de caméra. Le parcours standard de sortie des nuages ne cadre pas volontairement les yeux. La découverte accomplit la quête cachée décrite ci-dessous. Un diagnostic interne peut vérifier l'alignement, sans réintroduire de commande joueur « Apercevoir le Chat » ni attribuer l'accomplissement.
- Réalisation légère proposée : deux petites surfaces partageant un matériau, dont l'intensité visuelle est pilotée par un calcul borné depuis le soleil existant. Aucune lumière supplémentaire, simulation animale ou conséquence sur la cosmologie et l'économie.
- **Recette spécifique** : vérifier qu'en navigation normale le regard peut passer inaperçu, qu'une recherche volontaire à l'angle et à la phase favorables permet de le trouver, puis qu'il s'efface en quittant cet alignement. Vérifier aussi occultations, absence de cadrage forcé, stabilité pendant les transitions et coût borné. Teinte, luminosité, taille et amplitude de dérive restent des réglages artistiques proposés, à apprécier en recette.

### Quête cachée — « Les yeux dans les yeux »

**Décision produit validée par Tristan :** découvrir le regard termine une quête cachée, accorde une entrée du journal intitulée exactement **« Les yeux dans les yeux »**, puis déclenche une intervention de l'Oracle. Elle cherchait son chat et demande au joueur s'il l'a aperçu, **sans lui laisser la possibilité de répondre**. Aucun objectif, emplacement vide nommé ou indice dans le journal ne révèle cette quête avant sa découverte.

Séquence : regard effectivement découvert → accomplissement confirmé par le serveur → entrée persistante dans le Grimoire → intervention de l'Oracle. Il n'est pas nécessaire d'ouvrir le journal pour déclencher la scène. L'Oracle ne déplace pas la caméra et ne désigne pas les yeux ; son intervention arrive après la découverte, sans transformer la recherche en guidage.

**Texte proposé, à valider en recette :** « Je cherche mon chat… Vous ne l'auriez pas aperçu ? » Aucun choix oui/non, champ de réponse ou branche de dialogue. Le joueur peut fermer la présentation ou poursuivre la navigation ; ce geste ne constitue pas une réponse. Une fermeture accessible au clavier et au tactile évite de bloquer les contrôles. La durée d'affichage et le texte descriptif de l'entrée restent des réglages éditoriaux.

**Déclencheur proposé :** constater le regard réellement visible dans le cadrage, avec reflet solaire suffisant, hors masque de transition et occultation, pendant une courte observation continue dans l'onglet visible. Le simple chargement des yeux, leur présence hors champ ou un survol furtif ne suffisent pas. La durée et la tolérance de cadrage restent à régler ; aucun clic sur les yeux n'est demandé dans cette proposition. Le mode de présentation cosmologique forcé/debug ne doit pas accomplir la quête. Cette détection signale une découverte visuelle ; elle ne prétend pas prouver que l'humain a reconnu l'image.

**Raccord technique proposé, fondé sur l'existant vérifié :** réutiliser `village_accomplishments` et le snapshot `village.accomplishments`, déjà affichés par `OracleJournal.tsx`. La portée recommandée est celle du Grimoire existant : une fois par `(world_id, village_id, code)`, avec un code dédié proposé `cat-eyes` et une date serveur. Le client signale le critère visuel ; le serveur contrôle l'identité, l'appartenance au monde/village et l'unicité, puis confirme la complétion. La caméra étant locale, ces contrôles ne constituent pas une preuve serveur du rendu effectivement perçu. Aucun moteur générique de quêtes ou de dialogues n'est nécessaire.

L'entrée reste présente après F5, reconnexion et retour entre vues. Retry, réponse perdue ou deux onglets ne créent pas plusieurs accomplissements. Le retour serveur distingue une nouvelle complétion d'un état déjà acquis ; l'intervention ne se rejoue pas à chaque snapshot ou nouvelle apparition du reflet. Le journal et l'intervention sont les seuls effets accordés par cette décision : aucun crédit de ressource ou changement des cycles lumineux. Si la future commande utilise le pipeline économique existant, préserver ses verrous et sa borne de temps ; l'animation ne devient jamais une autorité de crédit.

**Recette à prévoir après implémentation :** aucune révélation avant découverte ; observation valide menant à une seule entrée au titre exact ; intervention de l'Oracle sans réponse possible ni perte de contrôle caméra ; absence de complétion hors champ, derrière les nuages ou depuis le debug ; persistance, retry et concurrence de deux onglets avec unicité serveur. Les seuils de découverte restent à apprécier avec Tristan, sans annoncer une validation acquise.

### Arrivée Région → Village — titre, noir et atterrissage

**Implémenté pour recette interactive.** Les deux derniers retours de Tristan remplacent le voile gris et l'ancien ordre titre/éclairage : fondu au noir, titre plus cinématique, révélation avec un flou gaussien très fin, luminosité cible retrouvée en **3 secondes**, puis disparition du titre. Une brume discrète est autorisée la nuit, seulement pendant la cinématique. Ajouter un atterrissage caméra lisse : rapprochement, puis abaissement de l'altitude et ajustement de l'angle et de la focale.

Réglage initial de recette (durée totale 5,2 s, seuls les 3 s lumineux sont explicitement fixés par Tristan) :

1. 0–450 ms : voile noir jusqu'à **50 % d'opacité**, selon le dernier réglage de recette de Tristan ; début du rapprochement. Même plafond avec réduction des animations.
2. 450–900 ms : apparition du nom du village et du libellé temporel, en serif Palatino/Book Antiqua avec replis système, sur noir. Court maintien.
3. À 1,2 s : le noir se retire en 700 ms, vers le paysage et un flou de 1,15 px maximum, sans aplat gris. La nuit, deux nappes diffuses très faibles accompagnent cette révélation.
4. De 1,2 à 4,2 s : retrouver progressivement la luminosité **courante** en 3 s ; facteur appliqué au soleil et à l'ambiance, avec plancher de lisibilité. Le titre reste lisible.
5. De 4,2 à 4,9 s : disparition du titre ; flou et brume finissent de se dissiper à 5,2 s. Aucun calque, filtre ou assombrissement résiduel.

La caméra conserve son lieu visé et son cap. Le rayon converge vers 36 unités, puis l'inclinaison vers 1 radian et le champ de vision vers 0,501 radian ; ces valeurs sont des réglages visuels, pas des axiomes produit. Les interpolations utilisent des courbes lisses ; le mouvement se termine dans la durée de la séquence. Le profil automatique habituel ne réécrit pas les propriétés durant l'atterrissage. Le streamer ne charge pas le détail pendant la partie encore régionale de la descente (rayon ≥160).

React/CSS couvre `.game-shell`, HUD inclus, avec le titre net au-dessus du flou. Babylon garde l'unique pilotage du temps de présentation, de la caméra et des multiplicateurs lumineux. Les nuages Monde/Région se terminent avant le titre. Une intervention Oracle attend sa fin. Réduction des animations : cadrage final immédiat, titre bref de 1,2 s et dissipation simple, sans trajet caméra ni pulsation lumineuse.

**Nom et heure :** nom réel du snapshot, uniquement lorsque le village connu est effectivement rejoint ; aucun nom inventé sur une implantation voisine. Le gabarit est `Nom du village`, retour à la ligne, `(1er matin H:MM)` ou le libellé local, et `(Nuit)` sans heure. Le huit solaire dure 12 h réelles ; H:MM compte depuis son début, sans remise à zéro au second matin. Midi = 6 h écoulées / 6 h restantes. Les libellés suivent le graphe régional sur 24 h, voir la [spec cosmologique](SPEC-COSMOLOGIE-TORE-SOLEIL-CHAT.md). Figer le texte pendant sa courte apparition ; le temps astronomique et l'économie continuent.

**Interruptions :** une seule séquence par arrivée effective, avec l'hystérésis LOD existant. Échap/clic/Passer termine directement le cadrage ; un dézoom interrompt depuis la pose courante. Nouvelle destination, changement de monde et destruction suppriment les effets. Les clics métier sont interceptés sans traverser le calque. Après disparition, le focus revient au canvas et les contrôles normaux reprennent. L'éclipse de présentation ne change aucune phase, vitesse, occultation de référence ou condition de quête.

**Recette humaine en cours :** rythme noir/titre/révélation, lisibilité et noms longs, atterrissage desktop/portrait, nuit/brume, interruption/rezoom, absence de saut en sortie et de voile persistant. Les tests purs contrôlent l'ordre des phases et la continuité de la descente ; ils ne valident pas le ressenti cinématique.

### Prérequis de fiabilité et recette

Le blocage reproduit pendant l'audit est prioritaire : shaders Layer enregistrés dans une ancienne génération du registre Babylon, repli vers des `.fx` inexistants recevant du HTML, puis attente infinie du masque après détachement des contrôles. Préparer les shaders et le masque avant de détacher la caméra ; sur échec ou délai borné, annuler le passage et rendre la Région navigable. La limite d'attente est un réglage technique à choisir ; elle ne doit jamais prolonger indéfiniment le verrouillage des contrôles. Le masque opaque effectivement rendu reste obligatoire avant tout changement de représentation.

Vérifier après autorisation d'implémenter : molette et boutons, cache navigateur neuf et ancien après reconstruction Vite, échec de shader, retour immédiat, extérieur/intérieur du tore, coutures et portrait. Comparer des repères géographiques avant/après les nuages. À phase figée, rotation manuelle : ciel fixe dans le repère solaire, voile lié au terrain ; à caméra relative immobile et temps actif : tore/voile suivis par la caméra, étoiles défilantes, soleil indépendant. Vérifier fond noir, absence du décor retiré, transparence et picking du voile, pas de saut de lieu/cap/phase et absence d'accumulation de ressources après plusieurs allers-retours. Ces critères sont à valider, pas des preuves acquises.

## Décision de session — transitions et caméra, validée le 1er octobre 2026

Cette décision remplace le fondu et l'exclusion des silhouettes de villages dans la cible précédente.

- **Village ↔ Région** : dézoom continu sur la même projection plane ; un mesh agrégé par village remplace ses volumes détaillés. Conserver les plans d'eau et les masses de forêt/roche. Le réglage initial de mélange des volumes est le rayon Babylon 110–160 ; l'interaction métier reste limitée à Village.
- **Région ↔ Monde** : une couverture nuageuse masque le changement de projection. Entrée face à la normale du point inspecté, avec le même cap d'écran. La forme globale se découvre en orbitant ou en poursuivant le dézoom ; aucune orientation globale automatique à l'entrée.
- **Caméra attachée** : la caméra standard est enfant du parent Babylon tournant du tore. Position, cible et vecteur vertical suivent ce repère ; le joueur conserve son orbite relative. Le soleil garde son mouvement propre. Le cadrage externe « Profil du huit » doit être réversible ; le cadrage « Chat » est retiré par la décision visuelle courante.
- **Retour** : conserver la cellule canonique sélectionnée et le cap/inclinaison régionaux mémorisés ; « Mon village » recentre volontairement sur son implantation.
- **Masque** : une scène de composition Babylon et une Layer partagée par les deux projections. La texture procédurale 256² et le rythme 450 ms/frame opaque/450 ms décrivent le prototype existant ; la décision visuelle courante précise les nappes et le palier proposés. Avec réduction des animations : conserver seulement les frames de masquage nécessaires. Aucun framebuffer copié ni double rendu de géographie. Les intentions de boutons reçues pendant le passage sont coalescées vers la dernière ; le picking est suspendu pendant le passage, avec récupération obligatoire en cas d'échec.
- **Présence régionale publique** : lecture authentifiée dédiée `GET /api/worlds/:slug/terrain/overview/villages?x=&y=`. Monde/version, date, indicateur de troncature et au plus 32 villages proches à distance torique ≤320 cases sur chaque axe ; au plus 64 volumes par village. Seulement ID opaque de village, ancre et rectangles extérieurs, avec indication Jardin. Aucun propriétaire, nom, ID de bâtiment, niveau, stock, mission ou activité. Les aperçus géographie/végétation conservent leur contrat sans identité.
- **Fraîcheur/coût** : une requête d'aperçu à la fois, indépendante de toute réconciliation économique ; remplacement en mémoire, refresh 30 s ou changement de secteur 128 cases. Un mesh par village, un mesh pour les masses naturelles régionales. Les budgets de cache et de chunks détaillés sont conservés.

Réglages de présentation : l'ancien rayon fixe 0,48 / seuil 0,32 est remplacé par un rayon dépendant du cadrage, avec retour à 67 % du rayon d'entrée. Marqueurs proportionnés à la distance, lumière ambiante minimale 0,34 sur les aperçus. Cette lumière ne modifie pas la référence géométrique jour/nuit.

Au relais régional complet (rayon 160), suspendre les téléchargements, refreshs et intégrations détaillés ; annuler les requêtes en vol sans pénaliser la reprise. Conserver données et résidents en cache, mais masquer leurs meshes dès que l'aperçu régional est prêt. Le retour Village réactive le détail et sa fraîcheur. Le seuil Monde à 85 % du rayon maximal mémorise l'intention de dézoom même si l'aperçu manque encore ; les requêtes détaillées ne doivent pas monopoliser ses places réseau. Une forte impulsion depuis Village passe d'abord au régime régional. Un rezoom sous le seuil Monde avant réception annule l'intention de passage automatique.

Cette lecture de présence rend visibles des implantations voisines ; aucune interaction, commerce ou combat n'est ajouté. Les preuves de livraison restent dans le handoff, distinctes de cette cible.

## 1. Résultat joueur et décisions

Le joueur passe du village au paysage régional, puis à la représentation entière du monde en donut. Le dézoom découvre davantage de géographie, les côtes restent reconnaissables et le passage d'une échelle à l'autre conserve le lieu regardé. Revenir au village retrouve ses bâtiments, habitants et interactions au temps serveur courant.

### Portée des décisions de session

| Statut | Décision |
| --- | --- |
| Demandé explicitement pour cette spec | Trois échelles au zoom ; monde torique au dézoom total ; abandon de la limite visuelle fixe de 48 cases ; brouillard Babylon natif ; recours accru aux mécanismes du moteur. |
| Déjà validé dans les tranches précédentes | Grille canonique torique ; serveur autoritaire ; transport séparé du travail, 1 seconde par case ; navigation libre du terrain sans nouveau brouillard de guerre. |
| Proposition de cette spec | Navigation sur le donut puis retour régional ; transition nuageuse validée ci-dessus ; agrégat global léger ; végétation instanciée ; valeurs des budgets et seuils ci-dessous. |
| À valider avec la spec | Vue globale de la géographie et de la densité des bois accessible dès l'entrée dans le monde ; interactions métier réservées à la vue Village ; bouton de retour au village. La présence extérieure des villages proches est autorisée par la décision de session ci-dessus. |
| Hors scope | Déformation continue de toute la carte jusqu'au donut ; gravité torique ; nouvelles règles de découverte, commerce, trajet ou colonisation ; interactions avec les villages voisins ; modification du terrain ; migration vers un projet Babylon Editor. |

Les valeurs numériques sont des réglages initiaux proposés, à centraliser et à mesurer. Une modification de budget technique doit être documentée ; retirer une échelle, réduire la couverture à l'ancien cadrage ou changer les interactions exige un nouvel arbitrage produit.

## 2. Existant vérifié et limites constatées

| Élément | Existant dans le worktree |
| --- | --- |
| Monde | `world_chunks`, intérieurs 32 × 32, monde actuel 2048 × 1024 ; dimensions et version transmises par contrat. |
| Lecture | `/terrain` fournit terrain, élévations, halo diagonal et listes évolutives ; `/terrain/updates` ne retransfère pas les tableaux immuables. |
| Store | `terrain-store.ts` : 64 chunks, 2 lots concurrents de 16, revalidation évolutive visible à 5 s, gardes d'incarnation/invalidation/révision. |
| Résidence graphique | `terrain-renderer.ts` : 16 résidents détaillés et réserve transitoire conservatrice de 17 ; unités 4 × 4 ; admission 1 ms ; priorité par proximité. |
| Couverture | `terrain-settings.ts` : carré de rayon 48 cellules autour de la cible ; indépendance du rayon vis-à-vis du dézoom. |
| Bord visuel | `TerrainFade` mélange les matériaux avec un gris sur les 8 dernières cellules du carré ; ce n'est pas le brouillard natif de la scène. |
| Caméra | `ArcRotateCamera`, rayon graphique 8–120, profil de champ de vision/inclinaison ; limiteur manuel à 45 images/s en cadence normale. |
| Décor | `scenery-batch.ts` copie les sommets des recettes ; les gisements utilisent des clones avec UUID pour le picking. |
| Repère | `WorldSpace` assure tore, projection, inverse et changement d'origine. |
| Interaction | React porte HUD/commandes ; Babylon porte présentation et sélection ; missions animées depuis les dates serveur. |

La recette a montré une bordure grise proche donnant un effet de plateau isolé au dézoom. Les performances mesurées de la tranche précédente ne prouvent pas l'acceptabilité de ce cadrage. Le nombre de meshes ne suffit pas non plus à mesurer les appels de dessin d'une scène multi-matériaux.

## 3. Les trois échelles

Les trois niveaux ci-dessous sont des **modes de présentation**. Les LOD internes des meshes peuvent évoluer continûment à l'intérieur de ces modes ; ils ne créent pas d'autres modes pour le joueur.

| | N1 — Village | N2 — Région | N3 — Monde |
| --- | --- | --- | --- |
| But | Construire, gérer et observer | Lire la géographie, se déplacer | Comprendre la forme torique et choisir une région |
| Sol | Cases et côtes détaillées à proximité, fond simplifié au loin | Relief et surfaces simplifiés, détails proches selon leur taille à l'écran | Tore texturé par l'aperçu global |
| Végétation | Recettes 3D provenant des features | Instances là où elles restent lisibles, puis densité de bois agrégée | Teinte de densité, aucun arbre individuel |
| Bâtiments | Ceux du snapshot courant | Silhouettes du village connu tant que lisibles, puis repère | Repère de son village uniquement |
| Habitants, petits cailloux | Présents selon visibilité | Masqués progressivement lorsqu'ils deviennent illisibles | Absents |
| Grille et commandes spatiales | Règles actuelles du serveur | Navigation uniquement | Navigation uniquement |
| HUD économique | Actif | Actif | Actif |
| Géographie | Même monde canonique | Même monde canonique | Même monde canonique |

Cible initiale de cadrage, exprimée en cases sur la petite dimension du viewport au sol : N1 environ 16–64, N2 environ 64–256. En paysage 16:9 sur le monde actuel, le N2 maximal doit montrer au moins 192 cases sur cette petite dimension, soit au moins deux fois la largeur de l'ancienne couverture de 96 cases. Cette cible se vérifie à une inclinaison régionale de référence définie avec la recette, pas sur un rayon frôlant l'horizon.

Les écrans très larges, le portrait et les petits mondes adaptent ces plages pour respecter les limites toriques. N3 cadre le donut complet avec une marge sur les deux axes, y compris sur mobile. Aucun rayon exprimé en unités Babylon ne devient une constante métier.

## 4. Zoom, gestes et transition de mode

### État de navigation

Un contrôleur détient le mode, la progression de zoom, la cellule cible canonique, l'orientation locale, l'orientation du donut et la transition éventuelle. La cible canonique reste la référence lors des rebases, redimensionnements et retours depuis le donut.

Réglage initial proposé : zoom normalisé `z` entre 0, proche, et 1, monde entier. Passage N1 → N2 à 0,50 et retour à 0,42 ; N2 → N3 à 0,90 et retour à 0,82. Cette hystérésis évite les bascules répétées près d'un seuil. La relation entre `z`, le rayon, le champ de vision et l'emprise au sol doit être monotone et indépendante de la fréquence des frames. Les seuils sont des valeurs de configuration, pas des nombres éparpillés dans les callbacks.

- Molette et pincement parcourent les trois niveaux. Une grande impulsion peut traverser plusieurs seuils sans mettre plusieurs transitions en file.
- La dernière intention de navigation remplace la précédente ; les boutons pendant la couverture demandent le passage suivant sans accumulation.
- Rotation et inclinaison locales restent réglables dans leur plage. Une adaptation de sécurité aux petits mondes est progressive et ne ramène pas silencieusement la cible au village.
- En N3, glisser fait tourner le tore ; un clic/tap sélectionne une région. Zoomer ou activer l'action « Voir cette région » ouvre N2 à cette cible. Glisser ne sélectionne pas à la fin du geste.
- L'action « Mon village », accessible au clavier et au toucher, recentre et revient en N1. En N3, Échap revient à la dernière cible régionale ; il ne déclenche pas de commande métier.
- Avec le viewport focalisé, `+`/`−` parcourent les niveaux ; en N3, les flèches font tourner le tore et Entrée sélectionne la surface au centre du viewport si elle existe. Un repère de visée indique cette cible au clavier. Les boutons de navigation ont un focus visible ; les raccourcis ne capturent pas les champs de saisie ni les dialogues.
- Le chargement initial conserve le cadrage Village existant. Persister le mode dans l'URL ou le stockage navigateur est hors scope de cette tranche.

### Passage Région ↔ Monde

Transition nuageuse décrite dans la décision de session : entrée suivant la normale du point regardé et caméra attachée au tore. Le retour restaure l'orientation régionale mémorisée, avec la nouvelle cible si une région a été sélectionnée.

Un seul Engine Babylon. Deux scènes géographiques et une scène de composition nuageuse transitoire sont permises pour isoler les caméras, matériaux et brouillards. Hors transition, seule la scène active est rendue. Une scène suspendue ne recalcule pas terrain, figurants ou picking ; l'état économique continue à être reçu. Les objets Babylon liés à une scène ne sont pas partagés aveuglément entre les deux scènes.

Pour le passage, utiliser la Layer nuageuse décrite dans la décision de session. Attendre qu'une frame opaque ait réellement été rendue avant de basculer ; libérer la texture et la scène de composition à la destruction du contrôleur. Aucune RenderTargetTexture géographique n'est nécessaire.

La scène sortante reste affichée tant que la représentation entrante minimale n'est pas prête. Un échec d'aperçu global laisse N2 utilisable avec une reprise explicite ; aucun écran vide ni attente bloquant la caméra. Le retour depuis N3 peut immédiatement utiliser le terrain régional simplifié déjà en mémoire pendant l'arrivée du détail.

## 5. Supprimer la couverture globale fixe de 48 cases

`radiusCells: 48` cesse de décider de l'horizon, du brouillard et de l'ensemble des demandes. La sélection utilise l'emprise réellement visible, une marge de préchargement et des budgets distincts pour le détail et le terrain simplifié.

1. Déterminer l'emprise du frustum sur une enveloppe conservatrice des hauteurs du terrain, incluant côtes et objets. Tenir compte de l'aspect du viewport et de l'inclinaison.
2. Borner les directions proches de l'horizon par une distance lointaine explicite, cohérente avec la fin du brouillard. Un rayon sans intersection ne doit jamais provoquer une demande infinie.
3. Couvrir toute cette emprise utile avec le terrain simplifié ; construire le détail uniquement là où la taille projetée des cases le justifie, dans son budget propre.
4. Charger en priorité la cible et le visible manquant ; conserver la consolidation à environ 100 ms et le préchargement borné.
5. Lors d'un déplacement rapide, remplacer les demandes obsolètes et garder la dernière représentation valide jusqu'au remplacement.

La zone détaillée peut rester comparable à la couverture actuelle à certains zooms ; elle ne masque plus tout ce qui se trouve au-delà. Le plafond de 16 résidents détaillés ne compte pas un patch régional simplifié comme un chunk détaillé complet.

En vue plane, aucune double image interactive d'une même cellule : l'emprise déroulée, marge comprise, reste strictement inférieure à une dimension mondiale sur chaque axe. Avant de dépasser cette borne, réduire la marge puis borner progressivement le cadrage régional ; le dézoom suivant mène à N3. Cette règle doit être vérifiée en diagonale, après rotation et sur un petit monde, pas seulement sur une caméra alignée.

Une baisse de qualité réduit d'abord cailloux, finesse des arbres et précision du fond. Elle ne recrée pas une bordure carrée opaque au milieu du viewport.

## 6. Terrain simplifié et raccords

Le fond régional provient d'un aperçu agrégé du terrain **persisté**, jamais d'une nouvelle génération à partir de la seed. Il décrit tout le monde avec une résolution limitée. La même source alimente la texture du donut.

- Géométrie régionale en patches bornés et alignés sur les coordonnées canoniques ; pas de mesh par cellule mondiale.
- Hauteurs simplifiées, proportions d'eau/roche et densité de bois donnent la lecture à distance. Un échantillon mixte conserve ses proportions ; le choix arbitraire d'une seule case ne doit pas effacer toutes les petites eaux.
- Le détail existant garde ses rives, atlas et élévations. Le fond lointain n'est jamais utilisé pour autoriser une action ou placer précisément un habitant.
- Chaque zone au sol a un propriétaire de rendu pour éviter doubles surfaces, z-fighting et doubles arbres. L'ancien propriétaire reste en place tant que le remplaçant n'est pas prêt.
- La transition détail/fond exige des raccords de hauteur explicites : bords communs repris du détail disponible, bande de transition bornée et/ou couture géométrique. Une interpolation de couleur seule ne ferme pas une fissure.
- Les interfaces avec l'eau gardent le même niveau d'eau de présentation. Aucun flanc de fermeture ne doit créer une falaise visible à la frontière de chargement.
- Les échantillons voisins de l'aperçu sont lus avec modulo sur les deux axes. Les coutures canoniques reçoivent exactement les mêmes règles que les limites ordinaires.
- Les masses de bois agrégées sont une teinte de paysage non sélectionnable ; elles ne deviennent pas des arbres ou des ressources supplémentaires.

Privilégier une granularité de raccord compatible avec les unités détaillées 4 × 4. Les patches régionaux peuvent couvrir davantage de cases, avec masquage local des zones remplacées. Le choix concret des indices et des bandes appartient à l'implémentation, mais les invariants ci-dessus et les plafonds doivent être démontrés.

## 7. Brouillard Babylon natif

Retirer l'usage de `TerrainFade` comme brouillard permanent, ainsi que le grand fond gris utilisé pour simuler un horizon terminé. Un éventuel fond temporaire de chargement doit rester identifiable comme indisponibilité, sans représenter de fausse eau ou de faux terrain.

Utiliser `scene.fogMode`, `fogColor`, `fogStart` et `fogEnd`. Le mode **linéaire** est le choix initial pour garantir une opacité complète à la limite réellement couverte. Les modes exponentiels pourront être comparés visuellement si la couverture demeure suffisante. [Mécanisme Babylon](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/environment/environment_introduction.md#fog)

Les distances sont calculées depuis la caméra et exprimées dans le même repère que le rendu. Elles dépendent de la hauteur, du cadrage et du niveau de vue : une caméra très haute ne doit pas plonger tout le sol dans le brouillard. En vue régionale descendante, le paysage utile doit rester lisible jusque dans la partie haute de l'écran ; l'extinction se situe au-delà. En vue rasante, la zone complètement masquée précède la fin de couverture.

Invariant : tout fragment de terrain visible avant extinction possède une représentation chargée ou un état de chargement explicite. Lorsque la couverture disponible se dégrade, conserver le cadrage précédent ou son fond simplifié ; ne pas avancer brusquement un mur de brouillard.

Les paramètres changent de façon lissée avec le zoom. Couleur du ciel/fond et extinction doivent s'accorder. Configurer les variantes de shaders avant gel des matériaux ; dégeler/recompiler explicitement si une propriété change les defines. Le gel des matériaux ne dispense pas de vérifier les mises à jour d'uniformes.

N3 utilise son propre environnement : le brouillard régional ne doit pas effacer la face arrière du donut. Aucun Depth of Field n'est requis pour cette tranche. La recette vérifie sol, eau, arbres, silhouettes, traits et overlays ; un matériau incompatible doit être adapté, pas laissé hors du traitement par accident.

## 8. Répartition Babylon / Arbestra

| Mécanisme | Choix de la tranche | Responsabilité conservée par Arbestra |
| --- | --- | --- |
| Caméras | `ArcRotateCamera`, contrôles natifs | Modes, cible canonique, seuils et retour au village |
| Brouillard | Brouillard natif de scène | Réglages artistiques et cohérence couverture/extinction |
| LOD | `Mesh.addLODLevel`, taille à l'écran quand adaptée | Création des variantes, coutures, disponibilité et résidence mémoire |
| Répétition statique | Thin instances par groupe spatial et variante | Correspondance avec les features/occupations, éviction et mises à jour |
| Objets sélectionnables | Instances ordinaires ou meshes à UUID stable | Règles de sélection, révisions et commandes |
| Monde 3D | `CreateTorus`, textures et picking Babylon | Projection canonique, aperçu agrégé, navigation entre échelles |
| Visibilité | Frustum, bounding info et culling natifs | Demandes réseau avant construction des meshes |
| Cadence | `engine.maxFPS`, cible initiale 45 en usage normal | Adaptation mesurée de qualité et rendu seulement de la vue active |
| Mesures | `SceneInstrumentation`, `EngineInstrumentation` | Délais de publication, files, cache, octets et pertes de contexte |

Les LOD natifs sélectionnent une représentation déjà préparée ; ils ne téléchargent pas nos chunks JSON et ne libèrent pas automatiquement les variantes inutilisées. Les variantes et buffers retenus comptent dans le budget. [LOD Babylon](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/mesh/LOD.md)

Le limiteur manuel de `runRenderLoop` est remplacé par `engine.maxFPS`. Sur un affichage régulier à 60 Hz, le seuil manuel de 22,2 ms peut ne rendre qu'une frame sur deux ; le moteur possède un accumulateur temporel. Cette analyse du code n'est pas une mesure de gain. Garder les éventuels réglages spécifiques E2E explicites ; les mesures d'acceptation utilisent la cadence normale. [Source 8.56.2](https://github.com/BabylonJS/Babylon.js/blob/8.56.2/packages/dev/core/src/Engines/abstractEngine.ts)

## 9. Végétation, gisements et LOD des objets

Créer une petite bibliothèque de géométries partagées pour troncs, feuillages et cailloux, avec variations déterministes de position, rotation, taille et teinte. Remplacer progressivement le baking systématique des sommets de chaque bosquet par des buffers de transformations.

Les thin instances sont regroupées par zone, variante et matériau. Un groupe mondial unique serait inadapté : la visibilité des thin instances est collective, et leurs ajouts/retraits ont un coût. Taille initiale de groupe : unité de 4 ou 8 cases, à comparer avant de figer le réglage. [Thin instances Babylon](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/mesh/copies/thinInstances.md)

- Ne créer que les arbres des features reçues ; conserver leur seed et leur cellule propriétaire. LOD et agrégats ne modifient aucune quantité exploitable.
- Chaque suppression ou changement d'occupation met à jour le groupe concerné, sans rebâtir toute la végétation visible.
- Garder une table de propriété des instances ; lors d'une compaction de buffer, mettre à jour les index associés. Rafraîchir les bounding info après ajout, retrait ou déplacement/rebase.
- Babylon 8.56.2 stocke les attributs `world0..world3` des thin instances sur la Geometry : deux bosquets à matrices différentes ne doivent pas partager cette Geometry. `cloneWoodland` appelle `makeGeometryUnique()` avant de poser les matrices ; matériaux partagés, petite géométrie dupliquée par bosquet. Régression : créer/détruire un voisin conserve les positions GPU et les bounds du premier.
- Ne pas supposer un LOD individuel automatique pour les thin instances. Choisir les variantes par groupes spatiaux ; le LOD des instances ordinaires peut être porté par leur mesh source. La combinaison retenue doit être vérifiée sur 8.56.2.
- Les gisements restent sélectionnables par UUID et révision. Conserver les clones existants est acceptable dans cette tranche si leur coût est faible ; toute migration d'instanciation préserve sélection, épuisement et surbrillance.
- Les habitants gardent leur silhouette et leur progression serveur. Masquage régional/global et retour ne redémarrent ni mission ni animation économique.

Le système de particules solides ou la fusion native peuvent remplacer certaines recettes mixtes ponctuelles, mais ne sont pas ajoutés en parallèle sans besoin. Un mesh multi-matériaux n'est pas compté comme un appel de dessin unique.

## 10. Aperçu global : contrats et agrégation

### Contrats proposés

Conserver les deux endpoints détaillés existants. Ajouter trois lectures authentifiées, dans `packages/contracts`, avec la même autorisation d'accès au monde par village possédé :

- `GET /api/worlds/:worldSlug/terrain/overview` : géographie immuable agrégée.
- `GET /api/worlds/:worldSlug/terrain/overview/vegetation` : densité actuelle agrégée des bois ; aucun tableau de terrain retransféré.
- `GET /api/worlds/:worldSlug/terrain/overview/villages?x=&y=` : silhouettes publiques proches, contrat et bornes décrits dans la décision de session.

Les noms sont proposés ; la séparation immuable/évolutif est obligatoire. Ne pas modifier le sens des réponses `/terrain` déjà consommées.

Chaque réponse matricielle contient `world` avec ID, dimensions, taille de chunk et `generationVersion`, plus `overviewVersion`, `gridWidth`, `gridHeight`. `overviewVersion` versionne l'algorithme d'agrégation, indépendamment de la génération persistée. Toutes les dimensions/tableaux doivent être validés avant allocation.

| Réponse | Données, ordre ligne-major |
| --- | --- |
| Géographie | `meanElevations` (nombres finis, dans l'unité source), `minElevations`, `maxElevations`, `waterCoverage` et `rockCoverage` (entiers 0–255) |
| Végétation | `woodlandCoverage` (entiers 0–255), `sampledAt`, `ageMs`, `maxAgeMs` |

La fraction de prairie est le complément des fractions d'eau et de roche. Quantification déterministe, somme eau + roche au plus 255. Les extrêmes de hauteur servent notamment à borner l'enveloppe visible ; ne pas supposer les élévations entières source limitées à 8 bits. Les hauteurs rendues respectent la conversion actuelle et le niveau d'eau.

Résolution initiale : plus grand côté au plus 512 échantillons, autre côté proportionnel, avec au moins un échantillon par axe, sans dépasser le nombre de cellules de chaque axe. Plafond 262 144 échantillons. Monde actuel : 512 × 256, soit des blocs 4 × 4.

Pour toute dimension `W`, le bucket `i` couvre exactement les cellules de `floor(i × W / gridWidth)` inclus à `floor((i + 1) × W / gridWidth)` exclu ; même règle en Y. Cette partition couvre chaque cellule une seule fois, même si les dimensions ne sont pas divisibles par une taille de bloc supposée. Les UV de la carte et les centres géométriques utilisent ces mêmes bornes.

Si les buckets ont des largeurs inégales, leur index normalisé n'est pas une coordonnée mondiale. La texture finale est rééchantillonnée dans l'espace canonique uniforme `(x/W, y/H)` à partir des bornes ci-dessus ; le terrain simplifié lit ces mêmes bornes. Une texture plaquant naïvement un pixel par bucket décalerait les repères et le picking sur ces dimensions.

La densité des bois compte les cellules canoniques distinctes occupées par une feature `woodland`, pas le nombre de sous-meshes ni le nombre d'arbres décoratifs d'une recette. Dédupliquer les emprises. Ne transmettre ni UUID mondiaux, ni identités de villages, ni stocks ou missions dans ces aperçus.

### Lecture et cache serveur

Toutes les jointures sont filtrées par `world_id`. Lecture read-only repeatable-read lors du calcul ; aucune économie, notification, génération ou migration n'est déclenchée. Vérifier monde prêt, version et complétude des chunks avant de publier l'agrégat immuable. Une lacune produit `WORLD_NOT_READY`, jamais une case de prairie inventée.

Calculer la géographie depuis les `world_chunks` persistés par lots bornés, avec accumulateurs typés de taille fixe. Éviter de matérialiser tous les chunks source ou toutes les entités du monde dans le processus API. La densité de végétation est agrégée en SQL ou parcourue en flux borné ; elle ne transporte pas toute la table des features vers le client.

Cache dérivé en mémoire du processus API, clé `(worldId, generationVersion, overviewVersion)`. Déduplication des calculs concurrents d'une même clé ; au plus un calcul global actif par processus et quatre clés distinctes en attente. Au-delà, réponse temporaire `503` avec `Retry-After`, sans allouer un nouvel agrégat. Un agrégat complet est publié atomiquement. Prévoir une limite de 32 Mio retenus et une limite distincte du scratch de calcul de 32 Mio ; éviction LRU des entrées inactives. Les représentations JSON sérialisées, anciennes versions encore référencées et buffers temporaires comptent dans ces limites. Pas de cache de promesses rejetées permanent. Un redémarrage permet une reconstruction depuis les mêmes données, sans les modifier.

Chaque requête vérifie son autorisation même si l'agrégat est déjà en cache. Géographie privée et revalidable avec ETag par représentation ; aucune réponse partagée entre comptes par un cache HTTP public. Un 304 est soumis à l'autorisation et à l'identité complète. La végétation utilise initialement une réponse 200 privée sans cache HTTP : son cache applicatif expire après 30 s et se recalcule depuis une nouvelle transaction. `ageMs` indique l'âge réel de l'échantillon au moment de la réponse ; le client revalide après au plus `max(0, maxAgeMs − ageMs)` depuis sa réception, sans supposer ses horloges alignées avec le serveur. Le transport ajoute sa latence à cette cible de fraîcheur. Un aperçu expiré éventuellement conservé est signalé comme ancien et ne reçoit pas une nouvelle date fictive.

Objectifs initiaux : réponse géographique chaude < 300 ms, première préparation sur le monde actuel < 5 s, à mesurer. Calcul serveur limité à 15 s ; timeout explicite, nettoyage du calcul et reprise bornée. Si l'objectif à froid échoue, documenter l'optimisation nécessaire avant livraison ; ne pas introduire silencieusement un worker économique ou une migration. Une persistance dérivée supplémentaire nécessiterait un amendement ciblé à cette spec.

## 11. Caches et fraîcheur côté client

Un propriétaire de données conserve les trois produits : chunks détaillés, aperçu géographique, aperçu de végétation. Clés, gardes de session/monde/version, séquence de requête et incarnation sont explicites. Un changement de monde ou une déconnexion invalide aussi les textures dérivées et les callbacks de construction graphique.

- Précharger l'aperçu géographique après le premier affichage local utilisable, à priorité inférieure au sol visible manquant. Le cache local ne contient qu'un monde actif et une nouvelle entrée transitoire bornée lors d'un changement.
- Ne pas retransférer la géographie au passage N1/N2/N3 ni lors d'une rotation du donut. Les buffers de texture sont réutilisés.
- Charger la densité de végétation quand elle est nécessaire au fond visible. Une seule requête en vol, revalidation selon la durée de fraîcheur restante, au plus 30 s, et après retour au premier plan si expirée ; aucune requête par frame. Les erreurs suivent le backoff, même si la durée restante vaut zéro.
- `sampledAt` décrit la fraîcheur, pas un ordre global fiable entre endpoints. Les séquences et invalidations locales décident de l'acceptation. La densité peut être ancienne jusqu'à la revalidation ; elle n'a aucune autorité métier.
- Les données détaillées et le snapshot remplacent localement l'agrégat. Une révision de gisement ou une occupation récente ne peut pas être annulée par un aperçu plus ancien.
- En N3, suspendre la demande/revalidation de chunks uniquement destinée au rendu local ; garder le snapshot et les commandes nécessaires au jeu. Au retour, revalider les listes évolutives expirées, en conservant les tableaux fixes encore en cache.
- Les données détaillées évincées repartent en lecture complète. L'aperçu global ne marque jamais un chunk détaillé comme chargé ou une cellule comme constructible.
- Les échecs utilisent timeout et backoff bornés ; le rendu connu reste utilisable. Aucune boucle de reconstruction de textures ou de re-téléchargement à chaque tick.

## 12. Représentation du donut et correspondance géographique

Créer un tore avec `MeshBuilder.CreateTorus`, un matériau propre à N3 et les textures de l'aperçu. Réglage visuel initial : grand rayon `R = 2,4`, rayon du tube `r = 1`, tessellation 96 ; ces unités sont artistiques. La première version utilise une surface torique régulière, la couleur décrivant la géographie et les hauteurs ; le déplacement des sommets par un relief global est reporté. [Tore Babylon](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/mesh/creation/set/torus.md)

Convention logique de référence pour le centre d'une cellule `(x, y)` :

```text
u = (x + 0,5) / W ; v = (y + 0,5) / H
theta = 2 pi u ; phi = 2 pi v + pi
P = ((R + r cos(phi)) cos(theta),
     r sin(phi),
     (R + r cos(phi)) sin(theta))
```

L'adaptateur de présentation aligne cette convention avec les axes et UV effectifs du builder Babylon. Son implémentation 8.56.2 contient des décalages angulaires et une orientation V : ne pas supposer que ses UV par défaut coïncident avec la formule. Géographie, marqueurs et picking passent tous par la même convention et son inverse ; éviter trois corrections de signe indépendantes.

Après retrait de la transformation du mesh, l'inverse logique est :

```text
theta = atan2(P.z, P.x)
phi = atan2(P.y, sqrt(P.x² + P.z²) - R)
u = modulo(theta / (2 pi), 1)
v = modulo((phi - pi) / (2 pi), 1)
x = floor(u W) ; y = floor(v H)
```

Le décalage de `pi` place la latitude du village initial sur la face extérieure visible à l'ouverture ; il ne change aucune coordonnée canonique. Cette inverse analytique sert de référence. Le picking peut utiliser les UV interpolés du triangle pour épouser exactement la texture, à condition de démontrer l'accord avec les centres canoniques et les deux coutures. Les frontières utilisent des intervalles semi-ouverts avec normalisation de la valeur 1 vers 0 ; la cellule choisie ne peut pas être `W` ou `H`.

Textures périodiques sur les deux axes ; raccords de filtrage et mipmaps contrôlés pour éviter une ligne claire. Repères du village et de la cible projetés sur la surface avec petit décalage suivant la normale. Le test de profondeur masque les repères derrière le tore ; le bouton « Mon village » reste accessible dans le HUD.

Un clic dans le trou ou dans le fond ne choisit aucune région. Prendre la surface visible la plus proche ; ne pas sélectionner une zone située derrière la face avant. L'intérieur du tube devient sélectionnable en faisant tourner le monde. Les deux axes du monde bouclent sans pôle, et les repères restent continus près des coutures.

Les déformations d'échelle entre intérieur et extérieur du tube sont assumées comme représentation. Aucun trajet, distance métier, calcul de travail ou coût de transport n'est mesuré sur la longueur d'un arc 3D. Aucune nouvelle cosmologie, gravité ou alternance jour/nuit n'est déduite de cette forme.

## 13. Interactions, missions et autorité

Entrer en N2 ou N3 est une navigation, sans effet métier. Un geste Construire/récolte encore incomplet est annulé sans envoyer de commande implicite ; les commandes déjà envoyées gardent leur suivi et leur résultat. Aucun `pointerup` tardif ne doit construire dans la région sélectionnée ensuite.

La grille, les previews et le picking métier sont désactivés hors N1. Le joueur peut revenir en N1 sur un terrain distant, mais les autorisations restent celles du serveur et du snapshot courant. Une cellule sélectionnée sur le donut est une intention de caméra, pas un déplacement de village ou d'habitant.

Les panneaux spatiaux devenus sans ancrage visible sont fermés ; un résultat de commande est néanmoins intégré. Au retour : bâtiments et gisements depuis les dernières révisions, figurants à la phase serveur courante, routes projetées sur le détail réellement disponible. Les missions continuent pendant tout le passage en vue Monde, même si aucun mesh d'habitant n'existe dans la scène active.

Les chemins restent ceux du serveur, en tronçons X/Y. Aucun navmesh, moteur physique, système de foule ou chemin recalculé sur le tore graphique n'entre dans cette tranche.

## 14. Budgets et comportement en saturation

Valeurs initiales proposées pour le monde courant, contrôlées également pendant les transitions :

| Ressource | Budget / cible |
| --- | --- |
| Cache de chunks détaillés | 64 maximum, protocole courant conservé |
| Résidents détaillés | 16, réserve transitoire conservatrice 17 |
| Patches régionaux simplifiés | 256 maximum, chacun avec taille de buffers plafonnée |
| Donut | 1 mesh principal, tessellation au plus 128 ; marqueurs bornés au village et à la cible |
| Aperçu | Au plus 512 × 512 échantillons ; aucun mesh individuel par échantillon |
| JSON d'aperçu | Géographie ≤ 8 Mio décompressés, végétation ≤ 2 Mio ; publier aussi les octets réellement transférés |
| Réseau | Au plus 2 requêtes terrain au total : détaillé ou aperçu ; lots détaillés ≤ 16 |
| Mémoire JS | Cible ≤ 128 Mio après stabilisation du parcours dédié et GC ; comparer aussi au niveau initial |
| Ressources GPU terrain | Estimation comptabilisée ≤ 96 Mio, dont ≤ 16 Mio pour la composition transitoire ; inclure variantes, mipmaps et réserves |
| Intégration | Admission initiale 1 ms/frame ; P95 des frames actives ≤ 4 ms ; aucune tranche synchrone du streamer > 50 ms |
| Cadence | Limiteur natif initial 45 images/s ; sur matériel de référence, intervalle de frame P95 ≤ 40 ms en navigation stabilisée |
| Réactivité | Premier terrain simplifié visible < 2 s une fois l'aperçu disponible ; premier bosquet proche < 5 s à froid, comme la régression actuelle |
| Retour chaud | Région/donut déjà prêts < 500 ms hors durée du fondu ; aucun rechargement immuable conservé |

Mesurer séparément le heap JS, les buffers/textures estimés et les processus navigateur : 27 Mio de heap ne signifient pas 27 Mio de mémoire totale. Les plafonds des collections s'appliquent aussi aux scènes suspendues, requêtes terminées tardivement, variantes LOD et réserves d'instances. Les buffers transitoires sont libérés et ne s'accumulent pas à chaque changement de mode.

En saturation, conserver les représentations les plus grossières utiles, évincer les détails hors champ, diminuer la finesse des groupes et suspendre le préchargement. La proximité et la disponibilité priment sur les travaux décoratifs. Si la couverture minimale ne tient pas, garder la dernière vue valide et signaler la limite : ne pas déclarer la tranche livrée en rétablissant silencieusement le rayon 48.

Les objectifs de performance sont des cibles d'acceptation, pas une promesse pour tout matériel. Publier les mesures sur Intel Iris Plus / Direct3D11 ou équivalent identifié, sur profil mobile et, si disponible, sur téléphone physique. Une émulation responsive ne vaut pas validation de performance mobile.

## 15. Instrumentation et outils de création

Ajouter les compteurs natifs de durée de sélection des meshes, rendu, appels de dessin et compilation ; activer le temps GPU uniquement lorsque l'extension nécessaire est disponible. Garder les métriques propres aux files, résidents, octets, âge des données, construction et délai d'apparition. Rapporter P95 sur toutes les frames et P95 actif séparément, sans éliminer les pics. [Instrumentation Babylon](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/scene/optimize_your_scene.md#instrumentation)

En debug : mode courant, cible canonique, emprise utile, emprise couverte, données manquantes, zones détaillées/simplifiées, fogStart/fogEnd, LOD et compteurs. Aucun panneau technique permanent dans le parcours joueur. L'instrumentation doit tolérer l'absence de données après éviction ; elle ne doit pas arrêter le rendu.

| Outil | Usage retenu / limite |
| --- | --- |
| Inspector | Examiner visuellement caméra, brouillard, matériaux, bounding boxes et compteurs pendant la future recette ; conserver ensuite les réglages retenus dans le dépôt. |
| Node Material Editor | Outil possible pour élaborer les matériaux. Aucun graphe complexe imposé si `StandardMaterial` suffit. |
| Node Geometry Editor | Outil possible pour préparer les variantes d'assets ; éviter de régénérer un graphe complet pour chaque arbre à chaque chargement. |
| Babylon Editor | Préparation d'assets/scènes de référence ; aucune conversion du monolithe React/Vite vers le template de l'éditeur. |
| Snippets / Playground | Exploration et partage de prototypes. Exporter les définitions et assets validés, documenter leur origine et les versionner pour le jeu. Aucun chargement arbitraire de snippet à chaque démarrage en production. |
| SpriteManager | Candidat pour effets et marqueurs ; le passage de tous les habitants/arbres en sprites n'est pas inclus. |
| SpriteMap | Grille plane utile pour un affichage cartographique dédié ; ne remplace pas automatiquement nos côtes et reliefs. |
| Dynamic Terrain | Extension à évaluer uniquement si le fond régional décrit ici s'avère insuffisant. Son adoption n'est pas une dépendance ni un préalable de cette spec. |

L'éditeur de terrain évoqué par Tristan reste à identifier précisément. Aucun engagement de compatibilité n'est pris sans son nom/version. Ne pas remplacer le générateur autoritaire par une peinture de terrain côté client. Les assets exportés et les capacités requises doivent fonctionner avec Babylon 8.56.2 ; une mise à niveau moteur éventuelle nécessite un diff et une validation distinctement motivés.

## 16. Découpage d'implémentation proposé

1. **Socle mesurable** : extraire le contrôleur de vue, utiliser le limiteur natif et l'instrumentation, préserver le parcours Village. Ne pas refactorer toute la scène.
2. **Aperçu autoritaire** : contrats, agrégation bornée, caches serveur/client et gardes de version. Vérifier indépendance de l'économie et absence de téléchargement de tous les détails.
3. **Vue régionale** : couverture par cadrage, terrain simplifié, raccords, brouillard natif et remplacement du bord carré.
4. **Objets répétés** : instances, variantes LOD, suppression des features, picking des gisements et comptabilité mémoire.
5. **Vue Monde** : tore, texture, repères, inverse canonique, sélection d'une région et retour au village.
6. **Transitions et finition** : gestes, annulation, accessibilité, erreurs réseau, changement de monde, reprises de missions et mesures du parcours complet.
7. **Clôture** : architecture décrivant seulement le livré, handoff avec preuves et limites, commit/push uniquement si autorisés pour cette tranche.

Tristan a ensuite donné le feu vert global pour l'implémentation. Les étapes bornent toujours la tranche et ses vérifications.

## 17. Vérifications à exécuter après autorisation

### Calculs purs et contrats

- Projection/inverse du tore : centres de cellules, quatre coutures, coins, vue intérieure/extérieure, dimensions non centrales et retournement des axes. Picking accordé avec la texture et les repères.
- Agrégation : chaque cellule source comptée une fois ; eau/roche et hauteurs d'un jeu connu ; distinction de deux mondes ; pas de couture périodique ; limites d'allocation et valeurs non finies rejetées.
- Modes : seuils aller/retour, inversion rapide, grande impulsion, resize, réduction des animations et annulation d'une transition.
- Couverture : empreinte conservatrice sur relief, rays sans sol, vue rasante, diagonale, portrait/ultralarge, petit monde et absence de double image interactive.
- Cache : réponse tardive, ancienne incarnation, changement de session/version, 304, aperçu incomplet, échec et reprise ; réutilisation des tableaux immuables au retour après 15 s.
- Instances : retrait réel d'une feature et d'une occupation, compaction des index, bounding info après rebase, libération des variantes et buffers.

### API et PostgreSQL

- Authentification et accès au monde sur réponse chaude, froide et 304 ; aucune information d'un autre monde.
- Lectures d'aperçu sans crédit, mutation de ressource, mission, occupation ou notification.
- Cohérence de la densité sous mutation concurrente forcée : barrière bornée entre lectures pertinentes, transaction read-only repeatable-read, aucune réponse partiellement publiée.
- Deux demandes d'une même clé partagent un calcul ; plusieurs mondes respectent les budgets et la file bornée. Erreur/timeout ne laisse ni promesse bloquée ni connexion occupée.
- Monde incomplet ou version changée : rejet explicite ; aucune régénération du monde prêt.
- Comptage des lectures : refresh de végétation sans tableaux immuables ; retour chaud sans relire tous les chunks persistés.

### Recette navigateur et perception

1. Partir de son village, gérer une parcelle et inspecter un gisement. Dézoomer progressivement : paysage étendu, côte continue, petits décors qui s'effacent sans faire disparaître le sol.
2. Répéter zoom-in → déplacement → rotation → zoom-out, puis retour après 15 s. Aucun nouveau mur carré, aucune reconstruction systématique des unités retenues, aucune requête immuable superflue.
3. Atteindre N3 : surface inspectée face caméra, puis donut lisible en orbitant/dézoomant, mêmes plans d'eau reconnaissables, repère du village correctement placé, aucune grille ou figurant géant.
4. Tourner le donut, choisir les faces extérieure et intérieure, revenir en N2 puis N1. Vérifier la cellule canonique réellement visée, pas uniquement une capture ressemblante.
5. Traverser séparément les deux coutures et leur intersection, près de la frontière zéro et après un tour complet ; retour au village et sélection effective d'un bâtiment.
6. Répéter les transitions pendant une récolte/extraction : même mission et phase serveur ; aucun crédit supplémentaire, aucun redémarrage du trajet.
7. Retarder ou échouer l'aperçu, couper le réseau, revenir au premier plan, changer de monde pendant une requête et inverser le zoom pendant le fondu. Navigation utilisable et aucun asset étranger à la scène active.
8. Construire/drag en cours au changement de mode, click/tap sur le trou du donut, glisser puis relâcher, HUD superposé, Échap et « Mon village » : aucune commande métier accidentelle.
9. Vérifier desktop, portrait mobile, resize et réduction des animations. Captures au même lieu/cadrage avant et après ; appréciation humaine des raccords, de l'horizon et de la révélation du tore.

### Mesures prolongées

Exécuter un parcours de 60 s de déplacement régional, 60 s de repos, même parcours préchargé, puis au moins 20 cycles N1 ↔ N2 ↔ N3 avec cibles distinctes, suivis d'un reload. Vérifier que les cibles et modes changent réellement ; des métriques figées ne constituent pas un test vert. Rapporter erreurs navigateur, crash, contexte perdu, heap, ressources estimées, draw calls, files et transferts.

La mémoire après GC doit plafonner : dernier tiers du parcours au plus +20 % et +8 Mio par rapport au premier tiers stabilisé, tout en respectant le plafond absolu. Vérifier aussi les textures et buffers estimés afin qu'un heap stable ne cache pas une fuite GPU. Les scènes suspendues et buffers de fondu sont inclus.

Exécuter ensuite les suites liées aux changements, typecheck/lint/build nécessaires et parcours métier affectés. Tests DB/E2E séquentiels sur la base `_test` identifiée ; aucun reset de développement. Ne pas recopier les anciens comptes de tests comme preuve de cette tranche.

## 18. Conditions de livraison

- Les trois échelles sont atteignables au clavier/souris/toucher et reviennent au même lieu canonique.
- La vue régionale satisfait la couverture minimale proposée sans afficher la limite carrée de 48 cases comme horizon.
- Brouillard natif, terrain et transitions sont cohérents à fort dézoom, en rotation et en vue rasante.
- Le donut représente le monde réellement persisté ; sa sélection revient au bon terrain, y compris aux coutures et à l'intérieur du tube.
- Les ressources sont bornées pendant le parcours prolongé ; délais et distributions de performance sont publiés, avec les conditions matérielles.
- Les gisements, Jardins, bâtiments et missions conservent leurs règles et leurs révisions ; aucune autorité métier n'est transférée au rendu.
- Aucun outil d'édition, snippet distant ou téléchargement de tous les détails mondiaux n'est requis pour utiliser la vue Monde.
- Les points non démontrés restent explicitement « à valider ». Les captures et métriques locales ne remplacent pas l'acceptation visuelle de Tristan.

## 19. Références et statut de la recherche

- [Streaming implémenté](SPEC-STREAMING-TERRAIN.md), [monde et grille](architecture/world-grid.md), [génération persistée](architecture/world-generation.md), [occupation](architecture/world-space-and-occupancy.md), [temps serveur](architecture/server-time.md).
- [Babylon — brouillard](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/environment/environment_introduction.md), [LOD](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/mesh/LOD.md), [instances](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/instances), [thin instances](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/mesh/copies/thinInstances.md), [tore](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/mesh/creation/set/torus.md), [instrumentation](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/scene/optimize_your_scene.md).
- [Node Geometry Editor](https://github.com/BabylonJS/Documentation/blob/master/content/toolsAndResources/nge.md), [Node Material Editor](https://github.com/BabylonJS/Documentation/blob/master/content/toolsAndResources/nme.md), [Babylon Editor](https://editor.babylonjs.com/documentation), [SpriteMap](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/sprites/sprite_map.md), [Dynamic Terrain](https://github.com/BabylonJS/Extensions/blob/master/DynamicTerrain/documentation/dynamicTerrainDocumentation.md).

Recherche fondée sur le code du worktree, les déclarations et sources du package Babylon 8.56.2 installé, et la documentation officielle consultée le 1er octobre 2026. Les choix de couverture, agrégation, budgets, contrôles et transitions ci-dessus sont des propositions propres à Arbestra ; ils ne sont pas des capacités intégrées promises par la documentation Babylon. Aucun prototype, test applicatif ou benchmark nouveau n'a été exécuté pour rédiger cette spec.
