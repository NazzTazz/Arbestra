# Déploiements natifs OVH : alpha et staging

Deux installations indépendantes partagent le VPS et sa passerelle Caddy existante. Aucune image Docker Arbestra, aucune base dans un conteneur. Les projets déjà présents ne sont pas déplacés. PostgreSQL 17 et Node 24.22.0 tournent sur l'hôte ; le build est effectué sur GitHub, avec pnpm 10.15.1 et le lockfile.

| Environnement GitHub | Lobby | Jeu | NOC | Tag |
| --- | --- | --- | --- | --- |
| `alpha` | `play.arbestra.world` | `alpha.arbestra.world` | `noc.arbestra.world` | `alpha-*` |
| `staging` | `play-beta.arbestra.world` | `beta.arbestra.world` | `noc-beta.arbestra.world` | `staging-*` |

Les six enregistrements A doivent pointer vers le VPS. Ne pas publier d'AAAA vers une autre machine. Les comptes, mondes, villages et sessions ne sont jamais copiés automatiquement entre les bases.

## État vérifié le 16 octobre 2026

Les deux environnements sont installés et leurs six domaines répondent en HTTPS avec certificats publics valides. Commit applicatif déployé : `9c89057bd0027ab4bb2c1657b6d3eb0b4fc3018d`.

- [Staging : workflow manuel réussi](https://github.com/NazzTazz/Arbestra/actions/runs/38943336467).
- [Alpha : workflow par tag réussi](https://github.com/NazzTazz/Arbestra/actions/runs/38943582849), tag `alpha-2026.10.16.1`.
- Chaque base contient ses 43 migrations et aucun compte/monde de développement. L'absence de monde jouable est attendue à cette étape.
- Recette HTTPS réelle : compte éphémère staging, session du lobby reconnue sur le jeu, cookies Secure/HttpOnly, identifiants et cookie refusés par alpha, jeton joueur refusé par le NOC. Compte et sessions de diagnostic supprimés.
- Lobby et formulaire NOC des deux environnements contrôlés dans Chromium, sans erreur JavaScript relevée ; captures staging inspectées. Aucune recette d'un monde habité ni mesure de charge réalisée.
- Sauvegarde quotidienne déclenchée et restaurée dans une nouvelle base temporaire `arbestra_restore_probe_test` : 43 migrations vérifiées, base de recette ensuite supprimée. Refus DDL et connexions à l'autre base vérifiés pour les deux rôles applicatifs.

La copie locale ignorée des identifiants HTTP est `test-results/deployment-credentials/private-access.json`. Leur source reste le fichier root du VPS. Les copies locales des clés SSH privées de déploiement ont été supprimées après configuration des secrets GitHub.

## Déclencher

Depuis un commit de `main` vérifié :

```sh
git tag staging-2026.10.16.1 <commit>
git push origin staging-2026.10.16.1
# Après recette du même commit :
git tag alpha-2026.10.16.1 <commit>
git push origin alpha-2026.10.16.1
```

Les workflows **Deploy staging** et **Deploy alpha** acceptent aussi `workflow_dispatch` sur `main`. Un tag désigne une version immuable ; ne pas déplacer/réutiliser un tag déjà déployé. La promotion utilise le même commit, avec les URL de l'environnement compilées dans les frontends. Les déploiements d'un environnement sont sérialisés côté GitHub ; un verrou serveur sérialise aussi les migrations/sauvegardes des deux environnements.

GitHub Environments contient `VPS_HOST` (variable), `VPS_HOST_KEY` (entrée known_hosts épinglée) et `VPS_DEPLOY_KEY` (secret différent par environnement). Les clés n'autorisent ni shell, ni forwarding, ni accès à l'autre environnement : uniquement `deploy <SHA> <SHA256>`. Les actions externes sont épinglées par SHA ; les permissions du workflow se limitent à la lecture du dépôt. Restreindre les environnements à `main` et leurs tags respectifs. Un reviewer alpha peut être ajouté si souhaité.

## Installation et services

`ops/deploy/bootstrap.py` est une procédure initiale **spécifique au VPS audité**, à exécuter comme root après revue. Elle refuse de remplacer une installation marquée existante. Elle suppose la passerelle `wai-gateway-caddy-1` sur `wai-edge`, adresse `172.18.0.3` et hôte `172.18.0.1`. Ces adresses sont à vérifier après toute recréation de la passerelle. Le binaire Caddy existant est copié pour les deux serveurs web internes natifs ; aucune nouvelle image n'est créée ou téléchargée. `ops/deploy/configure-gateway.py` ajoute les seuls blocs Arbestra à la configuration publique avec sauvegarde, validation et reload ; les directives des autres projets sont conservées. La passerelle publique ne fait que terminer TLS et relayer les trois domaines de chaque environnement vers le serveur natif correspondant.

- API : `arbestra-api@alpha` / `@staging`, localhost 3100 / 3200. Scheduler et workers navigation/expéditions existants inclus.
- Génération : `arbestra-generator@alpha` / `@staging`, worker natif séparé.
- Web : `arbestra-web@alpha` / `@staging`, interface privée Docker-hôte 3101 / 3201, filtrée par UFW à l'IP de la passerelle. Aucun port API/PostgreSQL public.
- Releases : `/srv/arbestra/<environnement>/releases/`, lien `current`, trois versions conservées.
- Configuration : `/etc/arbestra/<environnement>.env`, migration séparée `*-migration.env`, secrets root uniquement.
- PostgreSQL : `arbestra_alpha` / `arbestra_staging`. Propriétaire de migration séparé du rôle applicatif, sans superuser ; le rôle applicatif n'a aucun droit DDL et ne peut pas se connecter à l'autre base.
- Logs : `journalctl -u arbestra-api@staging`, `-u arbestra-generator@staging`, `-u arbestra-web@staging`. Ne pas publier les fichiers env ou les mots de passe.

Les workflows mettent à jour les releases applicatives, pas le contrôleur root, les unités systemd ni la configuration Caddy. Toute évolution de ces fichiers d'exploitation est appliquée séparément sur le VPS après revue ; ne pas relancer le bootstrap sur l'installation existante. Le binaire Caddy natif doit également suivre les mises à jour de sécurité de la passerelle.

Les cookies joueur portent des noms distincts par environnement, `Secure`, `HttpOnly`, `SameSite=Lax`. Le partage lobby/jeu impose ici le domaine `.arbestra.world` : le navigateur transmet donc les deux cookies aux sous-domaines frères, mais chaque API ne reconnaît que le sien et sa propre base. Tous ces sous-domaines doivent rester sous contrôle de confiance. Les cookies administrateur restent limités à leur hôte et `/api/admin`, avec vérification de l'origine et des UUID autorisés à chaque appel. Le proxy rejette les origines étrangères et n'expose pas `/api/admin` sur les hôtes joueur.

Les lobbies et clients jeu sont accessibles sans authentification HTTP préalable : les joueurs utilisent uniquement le formulaire applicatif de connexion/inscription. Les endpoints métier conservent leur authentification serveur. L'authentification HTTP Caddy supplémentaire est limitée aux deux hôtes NOC, en plus des permissions administratives applicatives. Ses identifiants aléatoires sont conservés dans `/etc/arbestra/private-access.json` (root, 0600) ; ils ne sont pas stockés dans GitHub ni dans le dépôt. Cette protection du NOC n'est pas un système d'invitations individuelles pour le jeu.

## Séquence et récupération

Le contrôleur root installé depuis le dépôt n'exécute aucun script uploadé comme root. Il vérifie checksum, identité, contenu et chemins de l'archive ; l'extraction et les migrations tournent sous l'UID applicatif. Il arrête API et générateur, sauvegarde la base en format custom, vérifie le catalogue de sauvegarde, applique les migrations compilées, accorde les droits DML, commute le lien et redémarre. Les vérifications portent sur le démarrage API/workers, une requête SQL réelle avec le rôle applicatif et les services. La recette navigateur reste nécessaire pour accepter une version de jeu ; `/api/health` seul ne prouve pas la fluidité ni la santé métier complète.

En cas d'échec, l'ancien code est rétabli automatiquement **seulement si la liste des migrations n'a pas changé** et qu'une ancienne release existe. Sinon les services restent arrêtés : examiner logs, schéma et sauvegarde avant réparation. Aucun rollback SQL ni reset automatique. Pour une migration appliquée partiellement hors transaction, même une liste identique demande une revue avant réutilisation ; les migrations doivent rester transactionnelles et conservatrices.

Sauvegardes avant déploiement : `/var/backups/arbestra/<environnement>-*.dump`, trois dernières par environnement. `arbestra-backup.timer` ajoute une sauvegarde quotidienne, sept jours conservés. Ce sont des copies locales : une copie hors VPS et sa restauration doivent être organisées avant de considérer une reprise après perte du VPS comme couverte. Pour restaurer, utiliser `pg_restore --exit-on-error` vers une **nouvelle base explicitement dédiée**, jamais écraser un monde actif pendant un test. Les secrets de rôles restent dans les fichiers env root.

Le déploiement refuse moins de 1,5 Gio libres. Sur ce VPS partagé de 4 Go, les limites systemd bornent les processus ; elles ne prouvent pas la capacité à servir deux mondes chargés simultanément. Surveiller mémoire, swap, disque, workers et latence via le NOC avant d'augmenter les invitations.

## Première ouverture

La migration crée le schéma uniquement. **Aucun `db:seed` ni `db:setup` en production** : ces commandes contiennent le compte et les données de développement. Aucun monde local n'est importé. Créer un compte depuis le lobby, puis attribuer explicitement son UUID vérifié dans `ADMIN_ACCOUNT_IDS` et redémarrer l'API. Les droits ne doivent jamais être accordés sur la seule base d'une adresse email déclarative. La création/publication d'un monde et l'activation d'opérateurs de génération demandent leur recette propre ; déployer l'application ne signifie pas qu'un monde jouable est déjà initialisé.

Références : [GitHub Environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments), [ordre explicite des routes Caddy](https://caddyserver.com/docs/caddyfile/directives/route), [sauvegardes PostgreSQL](https://www.postgresql.org/docs/17/backup-dump.html).
