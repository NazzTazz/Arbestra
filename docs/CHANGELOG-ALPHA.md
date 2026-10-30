# Changelog de l'alpha

Résumé orienté joueur et testeur de chaque version `alpha-*` déployée, de la plus récente à la plus ancienne. Chaque version couvre les commits depuis le tag alpha précédent ; la première (alpha-2026.10.16.1) regroupe l'historique antérieur, soit le socle de l'alpha.

Généré le 30 octobre 2026.

## alpha-2026.10.29.1 — 29 octobre 2026

- Le bois se récolte désormais arbre par arbre : chaque arbre contient 500 de bois, un lot en prélève jusqu'à 100, le premier lot abat l'arbre, le tronc garde le reste, puis il ne subsiste qu'une souche.
- En mode Exploitation, on désigne les arbres un par un avec le geste de balayage ; on peut mettre des gestes de coupe ou de défrichage en file et en annuler un. Les anneaux de récolte et les satellites de défrichage montrent ce qui est ciblé, et un retour visuel s'affiche par arbre.
- Défricher retire les arbres puis les souches ; la case redevient constructible une fois la dernière souche enlevée, et les troncs disparaissent des trajets.
- Les jardins actifs ne sont plus des routes : ils deviennent un passage coûteux.
- Le fleuve se lit mieux : l'eau est teintée de bleu près des berges et le lit s'assombrit avec la profondeur ; les lacs ne laissent plus apparaître le fond régional.
- Une colonne de lumière s'élève au-dessus de l'hôtel de ville quand une transaction de marché crédite le village.
- Le réseau de déplacement de chaque village est conservé entre les redémarrages de l'API et n'est plus recalculé inutilement quand un bosquet franchit un seuil.
- Conversion de données au déploiement : le stock de bois existant des bosquets est converti en arbres réels (arbres de 500, cases reconstituées à partir du stock restant, lots en cours conservés).
- *Technique :* migrations 063 à 069, appliquées pendant la maintenance après une répétition sur une copie de la base (bois par arbre, conversion idempotente) et réutilisation des captures de présentation pour accélérer les lectures concurrentes.

## alpha-2026.10.28.3 — 28 octobre 2026

- La nuit devient bleue et lisible, avec un crépuscule et une aube progressifs.
- Les fanaux sont moins coûteux à afficher (lumières regroupées, maçonnerie partagée) et la maçonnerie ainsi que l'hôtel de ville du marché sont pré-calculés : chargement plus fluide.
- Les équipes de bois s'installent autour de l'arbre abattu réel, y compris quand le test ordinaire ne trouve pas de place ; l'arbre abattu apparaît dès le début du lot.
- Fin des tentatives répétées des équipes de bois autour d'un arbre abattu, et correction d'un gel de la page du village.

## alpha-2026.10.28.2 — 28 octobre 2026

- L'ensemble du chantier de bois est disposé autour de l'arbre réel du bosquet.

## alpha-2026.10.28.1 — 28 octobre 2026

- Un arbre réel du bosquet est abattu pendant un lot de bois.

## alpha-2026.10.27.15 — 27 octobre 2026

- Les jeunes arbres poussent à l'écart des racines de leur souche.

## alpha-2026.10.27.14 — 27 octobre 2026

- Les bosquets sont dessinés avec le kit d'arbres : souches, jeunes arbres et troncs couchés.

## alpha-2026.10.27.13 — 27 octobre 2026

- Pas de changement visible ; mise en forme d'un test et spécification.

## alpha-2026.10.27.12 — 27 octobre 2026

- Chaque arbre d'un bosquet est cerclé en mode Exploitation et le balayage peut choisir des arbres.
- La fiche d'un bosquet indique le bois disponible et le bois déjà coupé.
- Correction : un bosquet garde ses vrais arbres pendant le rafraîchissement de son terrain.
- *Technique :* mémorisation du bois coupé sur chaque bosquet.

## alpha-2026.10.27.11 — 27 octobre 2026

- Un chantier de bois abat un arbre, coupe le tronc et empile une pile de bûches.
- L'hôtel de ville a une double porte avec voies d'entrée et de sortie à sens unique.

## alpha-2026.10.27.10 — 27 octobre 2026

- Les calculs de trajet des commandes disposent de 90 secondes après un démarrage à froid.

## alpha-2026.10.27.9 — 27 octobre 2026

- Le chargement initial du village réutilise les captures déjà prises et se relance en cas d'échec.

## alpha-2026.10.27.8 — 27 octobre 2026

- Un gros village dispose de 90 secondes pour construire son premier réseau de trajets.
- Annulation de la correction de circulation à la sortie de la mairie.

## alpha-2026.10.27.7 — 27 octobre 2026

- Annulation d'une correction de circulation à la sortie de la mairie.

## alpha-2026.10.27.6 — 27 octobre 2026

- La sortie de la mairie reste fluide entre un convoi et des jardiniers qui la traversent (correction annulée dans la version suivante).

## alpha-2026.10.27.5 — 27 octobre 2026

- Toutes les équipes d'extraction rentrent en convoi, y compris celles des chantiers ouverts ; correction d'un retour bloqué.

## alpha-2026.10.27.4 — 27 octobre 2026

- Les équipes de bois compactes descendent la route en convoi.
- La scie à deux hommes est tenue par ses poignées de part et d'autre du tronc.

## alpha-2026.10.27.3 — 27 octobre 2026

- Un bosquet dont le centre est dans un tronc devient accessible.

## alpha-2026.10.27.2 — 27 octobre 2026

- Les villageois sont affichés comme des figurines, avec des gestes planifiés sur les chantiers.

## alpha-2026.10.27.1 — 27 octobre 2026

- Les trajets préparés sont conservés pendant le chargement d'un gros village.

## alpha-2026.10.26.6 — 26 octobre 2026

- Les habitants sont mieux synchronisés dans le temps (décalage mesuré à la réception).

## alpha-2026.10.26.5 — 26 octobre 2026

- Une liste de marché ouverte se met à jour quand d'autres villages publient des offres.

## alpha-2026.10.26.4 — 26 octobre 2026

- Chargement du village plus robuste : tous les composants de l'état privé sont bornés.

## alpha-2026.10.26.3 — 26 octobre 2026

- Seuls les ordres d'exploitation ouverts ou récents sont chargés à l'ouverture.

## alpha-2026.10.26.2 — 26 octobre 2026

- Un échec de la lecture initiale est retenté au lieu de basculer sur l'ancien mode ; moins de versions de terrain conservées par monde.

## alpha-2026.10.26.1 — 26 octobre 2026

- Pas de changement visible.
- *Technique :* journalisation des appelants de l'ancienne lecture du village.

## alpha-2026.10.25.19 — 25 octobre 2026

- Les mises à jour de bâtiments à emprise connue ne déclenchent plus de relecture inutile.

## alpha-2026.10.25.18 — 25 octobre 2026

- Pas de changement visible ; tests de navigation entre les vues.

## alpha-2026.10.25.17 — 25 octobre 2026

- Le repos des habitants se termine correctement dans le nouveau mode de synchronisation.
- *Technique :* synchronisation V2 activée par défaut en développement ; études de transport attelé et de foules de chevaux.

## alpha-2026.10.25.16 — 25 octobre 2026

- Le HUD de population suit l'état du village après un geste.
- Les relectures dues à la seule extraction sont différées à 30 s.
- *Technique :* prototypes de chantiers animés et de figurines (pas encore visibles).

## alpha-2026.10.25.15 — 25 octobre 2026

- Les jardins passent au kit « carré potager ».

## alpha-2026.10.25.14 — 25 octobre 2026

- La récolte des jardins se fait plante par plante.

## alpha-2026.10.25.13 — 25 octobre 2026

- Les jardins terminés s'affichent avec le kit V8 d'Astra et des niveaux de détail.

## alpha-2026.10.25.12 — 25 octobre 2026

- Fin d'un gel de la synchronisation : les itinéraires des habitants au repos ne sont recalculés que pour les maisons modifiées.

## alpha-2026.10.25.11 — 25 octobre 2026

- Chargement du village plus fluide : les instantanés sont réconciliés sans resérialiser des états entiers ; correction d'un gel au chargement.

## alpha-2026.10.25.10 — 25 octobre 2026

- Les lumières des brasiers groupés sont créées hors de la liste des lumières de la scène.

## alpha-2026.10.25.9 — 25 octobre 2026

- Les maisons identiques partagent leurs modèles générés.

## alpha-2026.10.25.8 — 25 octobre 2026

- Les feux de l'hôtel de ville et de la maçonnerie ne s'allument que la nuit du village.

## alpha-2026.10.25.7 — 25 octobre 2026

- Moins de maillages inutiles proposés au rendu.

## alpha-2026.10.25.6 — 25 octobre 2026

- Chargement plus rapide du terrain diffusé (cases de route transmises sans rescanner le monde).

## alpha-2026.10.25.5 — 25 octobre 2026

- Maçonnerie des brasiers partagée ; moins de resérialisation des routes à l'arrivée au sol.

## alpha-2026.10.25.4 — 25 octobre 2026

- Les bâtiments et ouvriers ne sont reprojetés que si le sol ou l'origine change.

## alpha-2026.10.25.3 — 25 octobre 2026

- *Technique :* laboratoire et banc de rendu activables en option sur les versions déployées.

## alpha-2026.10.25.2 — 25 octobre 2026

- Moins de ralentissements quand le terrain est diffusé par versions successives.

## alpha-2026.10.25.1 — 25 octobre 2026

- Correction de l'état des chemins boisés dans la voie de calcul des commandes.

## alpha-2026.10.24.19 — 24 octobre 2026

- *Technique :* cartes de sources du client publiées et profilage JS autorisé sur les pages du monde.

## alpha-2026.10.24.18 — 24 octobre 2026

- Les commandes calculent leurs réseaux de trajets sur une voie de travail dédiée : réponses plus rapides sur les gros villages.

## alpha-2026.10.24.17 — 24 octobre 2026

- Les grands réseaux de déplacement restent en cache de routes.

## alpha-2026.10.24.16 — 24 octobre 2026

- Pas de changement visible ; test de régression des tentatives de récolte.

## alpha-2026.10.24.15 — 24 octobre 2026

- Une récolte dont la route ne finit jamais n'est plus retentée en boucle.
- Les mondes sont nommés alpha et staging (alpha.arbestra.world, staging.arbestra.fr).

## alpha-2026.10.24.14 — 24 octobre 2026

- Une seule entité de contribution scientifique par bâtiment.

## alpha-2026.10.24.13 — 24 octobre 2026

- Les récoltes et extractions terminées sont exclues de l'instantané privé.

## alpha-2026.10.24.12 — 24 octobre 2026

- Les limites de lecture sont relevées à 4096 ; au-delà, une erreur 503 explicite est renvoyée.

## alpha-2026.10.24.11 — 24 octobre 2026

- Chaque monde a son propre sous-domaine ; le staging passe sur arbestra.fr.

## alpha-2026.10.24.10 — 24 octobre 2026

- Les ressources du village sont renvoyées dans un ordre stable.

## alpha-2026.10.24.9 — 24 octobre 2026

- Pas de changement visible ; test d'installation stabilisé.

## alpha-2026.10.24.8 — 24 octobre 2026

- Suppression de services hérités sans usage (nourrir/reposer, Oracle direct, prévisualisations).

## alpha-2026.10.24.7 — 24 octobre 2026

- Suppression des anciennes routes V1 qu'aucun client n'appelle.

## alpha-2026.10.24.6 — 24 octobre 2026

- Le nivellement est refusé pour un bâtiment déjà à la limite du village.

## alpha-2026.10.24.5 — 24 octobre 2026

- Les autres flux sont relus juste après la confirmation d'un geste.

## alpha-2026.10.24.4 — 24 octobre 2026

- Nivellement, terraformation et changements de chantier passent par le nouveau contrat de commandes V2.
- *Technique :* les déploiements relancent la suite de tests complète et ne se font que si elle passe.

## alpha-2026.10.24.3 — 24 octobre 2026

- Les cohortes d'habitants au repos sont fusionnées par point d'énergie.

## alpha-2026.10.24.2 — 24 octobre 2026

- Les villages de plus de 1 024 cohortes se chargent correctement.

## alpha-2026.10.24.1 — 24 octobre 2026

- Science, découvertes, exploitation et marché joueur passent par le contrat de commandes V2.

## alpha-2026.10.23.9 — 23 octobre 2026

- Les améliorations de bâtiments et les extensions de jardin passent par le contrat V2, avec réouverture au changement d'époque.
- *Technique :* correction d'un blocage entre sites sur la passerelle de staging et d'alpha.

## alpha-2026.10.23.8 — 23 octobre 2026

- Vérification de croisement de chemins moins coûteuse pour les placements ; JIT désactivé pour le pool de l'API.
- *Technique :* profilage détaillé des placements en option, et disponibilité V2 vérifiée dans le catalogue.

## alpha-2026.10.23.7 — 23 octobre 2026

- Un placement ne lit la présentation qu'une seule fois.

## alpha-2026.10.23.6 — 23 octobre 2026

- Les repérages scientifiques de lieux sont collectés en une seule requête.
- *Technique :* Prettier introduit pour formater le code.

## alpha-2026.10.23.5 — 23 octobre 2026

- Un nouveau placement confirmé s'affiche avant la relecture de la présentation.

## alpha-2026.10.23.4 — 23 octobre 2026

- Insertions massives dans le monde regroupées en une requête.

## alpha-2026.10.23.3 — 23 octobre 2026

- Dépendances de lots multi-flux stockées une seule fois.

## alpha-2026.10.23.2 — 23 octobre 2026

- *Technique :* le journal de synchronisation V2 est purgé par passes bornées.

## alpha-2026.10.23.1 — 23 octobre 2026

- Le village alpha passe à la synchronisation V2, validée au préalable sur staging : le village se charge sans l'ancienne lecture complète.
- Le placement de bâtiments, l'atelier et les 32 chantiers récents sont gérés par le nouveau contrat de commandes.
- Les convois sont publiés sur un flux public du monde.
- Le terrain n'est envoyé que lorsqu'il change.
- *Technique :* lecture de présentation versionnée, journal et projections de connaissance allégés.

## alpha-2026.10.21.3 — 21 octobre 2026

- Les actions de jeu coûtent moins de requêtes et de projections ; reprises de récolte résolues.

## alpha-2026.10.21.2 — 21 octobre 2026

- Les routes grossières vers les ressources sont certifiées avant la recherche fine globale.

## alpha-2026.10.21.1 — 21 octobre 2026

- Le placement de bâtiments est borné, et les tâches de worker en échec sont espacées.

## alpha-2026.10.20.2 — 20 octobre 2026

- Gestes de population et commandes de chantier partagées.
- Terraformation libre, et correction de l'accès aux jardins.
- Optimisations côté serveur.

## alpha-2026.10.20.1 — 20 octobre 2026

- L'éviction du cache de terrain est bornée pour les villages en croissance.

## alpha-2026.10.19.5 — 19 octobre 2026

- Géométrie du village mise en cache et pathfinding des chantiers déporté : rendu plus fluide.

## alpha-2026.10.19.4 — 19 octobre 2026

- Fin de saccades cycliques de la scène ; halos de ressources affinés.

## alpha-2026.10.19.3 — 19 octobre 2026

- Les changements de ressources sont animés dans le HUD, et les approvisionnements en vue libre sont corrigés.
- Conversion de données : vérifications de la conversion du terrain en sommets partagés et du déploiement consignées.

## alpha-2026.10.19.2 — 19 octobre 2026

- Les mondes peuplés sont préservés pendant la conversion du terrain en sommets partagés (conversion appliquée aux données existantes).

## alpha-2026.10.19.1 — 19 octobre 2026

- Le village s'étend plus loin : la portée de construction s'élargit et la frontière fixe du terrain disparaît.
- Le nivellement du terrain est accéléré, grâce à des sommets de terrain partagés.

## alpha-2026.10.18.5 — 18 octobre 2026

- Les terrains inégaux se préparent par des chantiers de nivellement avant de construire.

## alpha-2026.10.18.4 — 18 octobre 2026

- Les échanges attendent la capacité de navigation partagée avant d'être chiffrés.

## alpha-2026.10.18.3 — 18 octobre 2026

- Les routes de commerce hiérarchiques sont mises en cache et réparées : calcul plus rapide des trajets longue distance.

## alpha-2026.10.18.2 — 18 octobre 2026

- La préparation de routes commerciales longue distance est autorisée, dans des bornes.

## alpha-2026.10.18.1 — 18 octobre 2026

- Un marché entre joueurs et une production artisanale à durée font leur apparition.
- *Technique :* console NOC déployée sur staging et alpha ; vérifications de déploiement depuis un exécuteur indépendant.

## alpha-2026.10.17.1 — 17 octobre 2026

- *Technique :* le NOC observe les villages via le client monde autorisé ; réparation auditée du terrain alpha.

## alpha-2026.10.16.4 — 16 octobre 2026

- Les villages publics de la région affichent des extérieurs reconnaissables.
- *Technique :* incident de chantier alpha et récupération automatique consignés.

## alpha-2026.10.16.3 — 16 octobre 2026

- Les durées de trajet entières sont préservées à l'admission des chantiers.

## alpha-2026.10.16.2 — 16 octobre 2026

- *Technique :* commande explicite d'ouverture du monde RC1 canonique ; l'authentification HTTP est limitée aux hôtes NOC.

## alpha-2026.10.16.1 — 16 octobre 2026

Socle de l'alpha : cette première version regroupe l'historique de développement antérieur (seuls les 60 derniers commits ont été examinés).

- Monde généré de 512×256 cases avec prévisualisations de géographie, intégration à l'atlas, placement de départ et accueil des joueurs.
- Population qui croît progressivement jusqu'à la moitié de la capacité de logement ; gestes de récolte et missions agrégées côté serveur.
- Routes : palette compacte avec variantes, prix affiché au pointeur, grille et tracé continu ; chemins de terre automatiques, rues en pierre avec trottoirs.
- Nouveau bâtiment décoratif : la maçonnerie, avec un clin d'œil « Perlin » sur le mur arrière ; showroom d'exploitation.
- Expéditions préparées de façon asynchrone avec reçus durables.
- Meilleure fluidité : rendu instrumenté, terrain préparé avant l'affichage du village, itinéraires recalculés en arrière-plan.
- Synchronisation du village local par trames serveur (SSE) autoritaires.
- *Technique :* console NOC en lecture seule, atelier de matériaux, workflows de déploiement VPS natifs alpha et staging.
