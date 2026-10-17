# Alpha — Université de Number et relevés de Yume

17 octobre 2026. Intervention production explicitement demandée par Tristan. Release applicative inchangée : `718af3b1fec2a8a284a3f7a205fdfc367fec854f-20261016T202913101250`. Aucun déploiement du travail NOC local, aucun commit/push pour cette intervention.

## Number : terrasse appliquée

Identification en base : compte de Number, joueur **Canard**, village **Petibonom** (`928d0d18-494d-4d17-905a-322fb41d5ed7`), monde alpha RC1 (`45f81817-cad6-47f8-9e35-ec0dab16cff3`). Les UUID sont vérifiés par la commande de réparation, jamais déduits d’un nom seul à l’écriture.

La construction exige une emprise universitaire de 30 cases dont les hauteurs quantifiées ne diffèrent pas de plus de 1. Le terrain de la zone retenue variait d’environ 0,0625 unité de relief ; l’emprise n’était pas plane selon ce contrôle. La réparation ajoute **30 terrasses locales**, sans modifier le substrat RC1 signé ni ouvrir une mécanique générale de terraformation.

- Zone préparée : **X 57 à 62, Y 198 à 202**, au nord de l’HDV.
- Placement universitaire correspondant : **ancre (59,200), rotation 1 (90°)**.
- Hauteur commune : `0.2512025798568366`, celle de la terrasse initiale du village ; hauteur quantifiée 25 partout, écart 0.
- Aucune université construite automatiquement, aucun coût payé ni ressource accordée à sa place.

La [commande opérateur bornée](../ops/repairs/2026-10-17-number-university.mjs) utilise les modules de la release déployée et le rôle applicatif. Verrou village avant verrou exclusif de navigation ; vérification de la révision physique avant écriture. Elle reprend `assertNoInfrastructure()` pour les voies, trottoirs, équipements et passages engagés. Elle refuse occupations, ressources naturelles gênantes, modification excessive ou sortie de portée. Toutes les hauteurs échantillonnées des fondations existantes doivent rester identiques ; bâtiments, occupations, stocks et cohortes sont comparés avant/après dans la transaction. Les notifications métier ne sont ni modifiées ni acquittées.

Prévalidation : 30 écritures réellement observées, égalité des données protégées et invalidation navigation/SSE constatées, puis rollback par erreur sentinelle identifiée et vérification qu’aucune terrasse ne subsiste. Application ensuite réussie : **42 bâtiments conservés**, **3 051 points de fondation inchangés** dans le monde, **5 trajets engagés protégés**. Le premier contrôle d’infrastructure, trop large à tout le monde, avait refusé avant écriture ; il a été remplacé par le contrôle métier de construction existant, sans désactiver sa protection.

Après commit, une nouvelle lecture vérifie 30 terrasses persistées et la hauteur uniforme. Le worker de navigation de la release trouve un trajet HDV → entrée d’un campus virtuel conforme à cette emprise, longueur **14,902 cases**, avec occupations et infrastructures réelles. Le campus est uniquement ajouté au contexte mémoire du diagnostic ; aucune ligne bâtiment n’est créée. Ce contrôle prouve le terrain et l’accès, pas le paiement/la commande complète ni une recette graphique sous l’identité de Number. Recharger le client pour renouveler le terrain avant placement.

Sauvegarde préalable, root `0600`, catalogue `pg_restore --list` vérifié : `/var/backups/arbestra/alpha-before-number-terrace-20261017T124632Z.dump`, 5 012 508 octets, SHA-256 `c16f68b2621c0fb41c339fbad3e1acd6a8270f3e33c09665a7164f96d0d2ffd6`. Image ciblée avant écriture : `/var/backups/arbestra/alpha-number-terrace-before-20261017T124632Z.json`. Le catalogue n’est pas présenté comme une restauration testée de cette sauvegarde.

Trace d’opération enregistrée dans journald, tag `arbestra-operator`, et dans `/var/backups/arbestra/alpha-number-terrace-audit-20261017.json` (root `0600`) : demandeur, portée, sauvegarde et résultats de conservation. Aucun secret inclus.

Retour arrière : ne pas restaurer toute la base active. Avant toute suppression ciblée des 30 terrasses, reprendre les mêmes verrous et vérifier occupations, passages et image initiale. Si Number a construit entre-temps, conserver le sol de son bâtiment et réauditer ; supprimer aveuglément les terrasses ferait perdre son support. La commande refuse une seconde application sur une zone déjà éditée.

## Yume : diagnostic distinct du trajet et des moyens

Village Pinkystan (`0ff5d261-233d-4126-b49e-cd8e8bc272bd`). Les reçus du 17 octobre 12:25–12:26 UTC montrent :

| Cible | État réel | Résultat du solveur déployé |
|---|---|---|
| (445,23) | Emprise HDV | Extrémité inaccessible |
| (445,25) | Jardin | Extrémité inaccessible |
| (445,29) | Libre et déjà repérée | Route trouvée, 8,802 cases |
| (444,22) | Libre et déjà repérée | Route trouvée, 1,052 case |
| (443,23) | Libre et déjà repérée | Route trouvée, 2,052 cases |

Les chemins sont recalculés en lecture seule avec le contexte de production et le worker réellement déployé ; aucune expédition n’est lancée par le diagnostic. Sur `(445,29)`, le reçu terminal est **`CARTOGRAPHERS_UNAVAILABLE`**, distinct des deux refus `DESTINATION_UNREACHABLE`. Aucun blocage général des routes n’est démontré pour ces demandes.

À 12:48:50 UTC, l’unique cartographe formé était au repos, énergie 1, sans affectation ; projection du code déployé : réveil **17:04:25 UTC / 19:04:25 Europe/Paris**. Le compteur `science.cartographers` inclut les cartographes au repos ; il ne signifie pas qu’ils sont disponibles. L’interface propose aussi par défaut l’ancre occupée de l’HDV en l’absence de cible sélectionnée : ces deux défauts de présentation rendent les refus difficiles à comprendre. Aucune énergie, qualification, activité ou connaissance n’a été modifiée administrativement ; les collisions restent appliquées.

Une **nouvelle formation a été engagée par le jeu**, du 17 octobre **12:43:52 à 12:53:52 UTC** (14:43:52–14:53:52 Paris), un habitant, université niveau 3. Le contrôle initial trouvait aussi 80 candidats non cartographes éligibles à dix minutes de formation. **Aboutissement vérifié à 12:54:45 UTC : formation `completed`, deux cartographes formés, dont un éligible** selon `eligibleWorkers()` pour les **77 604 ms** d’aller/relevé/retour vers **(445,29)**. Aucune affectation n’est forcée par le diagnostic.

Solution immédiate vérifiée sur ses préconditions : soumettre une **nouvelle demande** vers cette case libre déjà repérée, sans conserver l’ancre HDV ou le Jardin comme destination. Le client génère bien un nouvel UUID à chaque soumission ; le rejeu d’un ancien UUID conserve légitimement son reçu refusé. L’admission effective de la nouvelle mission reste à constater par le joueur ; le diagnostic ne l’a pas lancée. Aucun crédit d’énergie ni qualification attribuée administrativement.

Amélioration UX recommandée, non implémentée dans cette intervention : cible explicite sans repli silencieux vers l’HDV, destination occupée identifiée avant soumission, et disponibilité locale des cartographes distinguée du total formé avec motif de repos/affectation. Cela ne justifie pas de désactiver collisions ou fatigue.

## Vérifications et état local

API, générateur et web alpha actifs après intervention. Contrôles réels : `/api/health` local, client alpha et lobby HTTPS **200**. Release, schéma et services non remplacés ; aucune session joueur créée. Scripts temporaires distants et workers de diagnostic fermés dans `finally`. Sources de réparation et ce rapport locaux, sans secrets ; preuves brutes ignorées dans `test-results/prod-urgent-*`. Lint et syntaxe Node de la commande opérateur vérifiés. Aucun changement de règle applicative : aucune campagne de tests économiques locale ni recette sous un compte joueur revendiquée.

Worktree NOC antérieur et fichiers utilisateur préservés sur `main` / `6a08fe4`. Les services de développement sont conservés.
