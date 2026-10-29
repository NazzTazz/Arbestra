# Pagination du snapshot privé V2 — conception (29 octobre 2026)

Correctif C3 de [l'audit de la synchro V2](AUDIT-SYNC-V2-2026-10-23.md). Spec : [§7.5, §7.6 et §8.4](SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md). Inventaire : [section « Audit sync »](INVENTAIRE-SYNC-V2-2026-10-29.md).

Aujourd'hui, le snapshot privé d'un village de plus de 4 096 références lève `RangeError` (`readPrivateScopeSnapshot`), traduite en 503 `SYNC_SCOPE_TOO_LARGE` avec `Retry-After`. Le client espace ses relectures, mais le village ne se charge jamais.

## 1. Principe : pages ancrées, puis rattrapage par le journal

1. **Page 1.** Lue comme le snapshot actuel, dans une capture `REPEATABLE READ READ ONLY`. Elle porte pour chaque flux abonné son epoch et sa révision : la révision R₁ du flux privé est l'**ancre**. Les autres flux (connaissance, manifeste, trafic, chunks) y sont complets ; seul le flux privé est découpé.
2. **Pages suivantes.** Chacune dans sa propre capture, pour le seul flux privé, à partir du curseur de la page précédente. Elle porte la révision Rₖ ≥ R₁ de sa capture.
3. **Rattrapage.** Après la dernière page, le client demande un delta ordinaire depuis les curseurs de la page 1 (R₁ → R_f), lu dans une seule capture pour tous les flux. Il l'applique à l'état assemblé, puis publie **une seule fois**.

**Pourquoi c'est cohérent.** Toute écriture d'une entité privée passe par le journal (triggers 053, couverture des écrivains). Pour une clé k :

- non touchée dans ]R₁, R_f] : sa valeur dans sa page (lue à Rₖ ≥ R₁) est sa valeur à R₁ ;
- touchée dans ]R₁, R_f], avant ou après la lecture de sa page : le delta la relit à R_f (valeur ou suppression). Une entité créée entre deux pages, y compris dans une plage déjà lue, arrive par ce delta.

L'état publié est donc exactement « snapshot à R₁ + delta R₁ → R_f », la garantie qu'offre déjà le chemin bootstrap puis flux (§8.1). Les autres flux, complets à la page 1, sont rattrapés par la même capture : l'état inter-flux est celui de cette capture. Les écarts de présence liés au temps (trajets revenus, fenêtres « 20 récents ») sont ceux de ce même chemin, pas un mélange de versions.

**Écartés.** Une transaction ouverte entre plusieurs requêtes (`pg_export_snapshot`) retient une connexion du pool et un instantané pendant des allers-retours HTTP. Une réponse unique contenant toutes les pages dans une seule transaction n'est plus bornée. Le journal fournit déjà la « détection de changement et reprise » prévue au §8.4.

## 2. Ordre, curseur, taille

- **Ordre stable** : `(component, key)` avec `COLLATE "C"` (ordre des octets, indépendant de la collation de la base). Les clés sont canoniques (UUID, code, `x,y`, `*`) ; les six références fixes (identité, synthèse de population, voirie, installation, deux réserves) sont énumérées dans la même requête.
- **Curseur opaque** : base64url de `{ v, epoch, ancre, dernier composant, dernière clé }`. Il ne donne aucun droit : chaque page réauthentifie et revérifie la propriété du village. Le serveur refuse un curseur mal formé (400 `INVALID_SYNC_PAGE`). Il répond 409 `SYNC_SNAPSHOT_PAGE_EXPIRED` sans rien lire si l'epoch a changé, si la révision est passée sous l'ancre ou si l'ancre est sous le plancher de rétention.
- **Taille** : au plus 4 096 références par page, et pour chaque composant au plus la borne de son schéma (128 succès, 1 024 pour les composants d'historique, 4 096 pour les entités vivantes ; table dérivée du contrat). Un composant plus grand que sa borne, que l'ancien snapshot ne savait pas sérialiser, est donc découpé lui aussi.
- **Forme** : `coverage: "scope-snapshot-page"`, `next` (curseur ou `null` sur la dernière page). La page 1 liste tous les composants du registre, vides compris, comme un snapshot complet (refus fermé d'un registre partiel). Les suivantes ne portent que leurs composants. Aucune page ne porte de suppression.

## 3. Application côté client

Les pages restent dans une liste locale au transport, hors de la session : rien n'est appliqué ni publié pendant la pagination. Après la dernière page, `applySyncV2SnapshotPages` (contrats) :

1. valide chaque page (schéma, monde, village, génération ; flux privé de même epoch et de révision ≥ ancre ; aucune clé en double) ;
2. assemble un état provisoire, chaque flux à la révision de la page 1 ;
3. lui applique le delta de rattrapage avec `applySyncV2Batch` ;
4. le substitue à l'état de la session selon les règles d'un snapshot (epoch différente : reprise par une nouvelle génération ; confirmations plus récentes conservées).

L'état est publié une fois, avec un lot repère `scope-snapshot` qui déclenche la relecture de la présentation. Une pagination est bornée à 64 pages (262 144 références).

## 4. Reprise

| Situation | Comportement |
|---|---|
| Page en échec (réseau, 5xx) | Même curseur, 3 essais espacés de 0,5 puis 1 s. Les pages reçues restent valables : le delta depuis l'ancre les couvre. |
| 409 `SYNC_SNAPSHOT_PAGE_EXPIRED`, pages incohérentes, rattrapage refusé | Reprise depuis la page 1 (3 reprises au plus, puis échec ordinaire du transport). |
| Rattrapage trop gros ou trop ancien (`size`, `floor`) | Le serveur répond directement par une nouvelle page 1 : reprise sans requête de plus. |
| Epoch du village changée par rapport à la session | `SyncV2ResyncRequired` : nouvelle génération et bootstrap complet, comme pour un snapshot non paginé. |
| Session expirée (401) | Expiration habituelle ; rien n'est publié. |
| Transport fermé ou nouvelle génération | Pages abandonnées ; rien n'est publié. |

## 5. Rétrocompatibilité

- **Opt-in par en-tête** `x-arbestra-sync-pages: 1` sur le bootstrap et `/sync/read`. Sans lui, le serveur répond comme aujourd'hui : snapshot complet, ou 503 `SYNC_SCOPE_TOO_LARGE`. Un ancien client ne voit jamais de page.
- **Petit village**, avec l'en-tête : le même lot `scope-snapshot` complet en une réponse, aucune requête de plus.
- **Serveur ramené en arrière** avec un onglet récent : l'en-tête est ignoré, le comportement est celui d'aujourd'hui. Seules les pages 2 et suivantes portent `page.after` dans le corps, et seul un serveur qui a proposé une page les reçoit.

## 6. Coût

Chaque entité est lue une fois. Une page coûte : authentification, lecture du compteur, énumération des clés des seuls composants situés après le curseur (les branches précédentes sont éliminées par le plan), lecture des ≤ 4 096 entités de la page. Le tout est suivi d'un seul delta, qui ne relit que les clés modifiées pendant la pagination. Pour 10 000 références, c'est 3 pages plus 1 delta au lieu d'une lecture : quelques allers-retours de plus, pas une relecture du village par page. Mesures : §8.

## 7. Démarrage du flux (`sync/stream`)

Le flux ne lit plus jamais de snapshot. Quand un curseur exige un snapshot (epoch, plancher, taille, trou), il répond `200` puis `event: reset`, sans lire d'entité. Auparavant, il lisait un snapshot complet pour le jeter, et ouvrait en 503 sur un grand village. Le client lit alors le snapshot paginé par `/sync/read`, puis rouvre le flux avec ses curseurs appliqués.

## 8. Mesures

Base de test locale, machine partagée et chargée (serveur de dev et autres sessions actifs), 29 octobre. Village de test : 9 916 références (6 000 scieries, un jardin de 3 900 parcelles, le village seedé), statistiques à jour (`analyze`). Captures serveur seules (`captureSyncV2`), hors HTTP, 7 tours alternés avec une lecture de référence. Script de mesure non versionné.

- **Lecture unique** : refusée (`RangeError`) en 58 à 77 ms.
- **Snapshot paginé** : 3 pages (4 096, 4 096 et 1 722 entités ; 1 141, 944 et 328 Kio de JSON), puis un delta. Total médian **976 ms** (785 à 1 390 ms).
  - Page 1, avec connaissance, manifeste et trafic complets : médiane 471 ms.
  - Pages suivantes : médiane 200 ms (96 à 497 ms).
  - Delta de rattrapage : 6 ms.
  - Assemblage côté client (`applySyncV2SnapshotPages`, 9 914 entités) : 118 ms.
- **Référence** : les mêmes lecteurs dans une seule capture sans borne, 948 ms en médiane (745 à 1 515 ms), sans les flux partagés. La pagination n'ajoute pas de coût serveur mesurable ; elle ajoute deux allers-retours HTTP et l'assemblage côté client.
- Énumération des clés seule : 9 916 références en 22 à 87 ms.
- Pour comparaison, village sous la borne (3 966 références, une seule lecture de 935 Kio), mesuré dans une autre série : médiane 261 ms.
- **Premier passage après l'insertion en masse, sans statistiques** : une page à 8 à 10 s, due à la projection des parcelles (`projectGardenPlots`) sur 2 187 cases. Disparu après `analyze`. Lecteur existant, même comportement pour un snapshot non paginé ; à surveiller sur un vrai village.

Pas de choix produit révélé : un village de 10 000 références, inchargeable jusqu'ici, se charge en une seconde de lectures serveur environ, soit le coût d'une lecture sans borne.

## 9. Hors de cette tranche

- Snapshot de trafic (plus de 4 096 convois actifs par monde) et snapshot spatial (4 096 et 1 024 par chunk) : même mécanisme possible, non nécessaire aujourd'hui.
- Couverture de connaissance : les ancres (1 024 villages par compte) et les emprises (65 536) forment une entité unique `knowledgeCoverage:*`. Les paginer demande de découper l'entité, donc de changer le contrat du composant.
- Journal : un delta dont un composant dépasse sa borne de schéma (par exemple plus de 1 024 extractions) produit un lot que le client refuse, puis une reprise par snapshot, désormais paginé. Faire demander directement un snapshot au journal serait plus direct ; les succès (128) restent hors d'atteinte avec le catalogue actuel.
