# Installe une instance de développement Arbestra sur un poste Windows neuf.
#
# Usage, depuis la racine du clone, dans Windows PowerShell :
#   powershell -ExecutionPolicy Bypass -File scripts\dev-setup-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\dev-setup-windows.ps1 -Dump D:\dev-2026-11-09.dump -Start
#   powershell -ExecutionPolicy Bypass -File scripts\dev-setup-windows.ps1 -Docker
#
# Sans -Dump : base neuve (migrations puis seed). Avec -Dump : restaure une sauvegarde
# pg_dump -Fc (par exemple celle de ../arbestra-backups) puis applique les migrations
# manquantes. Le script ne vide jamais une base déjà remplie.
# Réexécutable : chaque étape déjà faite est sautée.

param(
  [string]$Dump,
  [switch]$Docker,
  [switch]$Start,
  [string]$PgSuperuser = 'postgres',
  [string]$DefaultWorld
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($message) { Write-Host "`n== $message" -ForegroundColor Cyan }
function Fail($message) { Write-Host "ERREUR : $message" -ForegroundColor Red; exit 1 }
function Run($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { Fail "$exe $($arguments -join ' ') a échoué (code $LASTEXITCODE)" }
}
function Has($name) { $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

# Identifiants de la base locale, alignés sur .env.example et compose.yaml.
$dbUser = 'arbestra'
$dbPassword = 'arbestra'
$dbName = 'arbestra'
$testDbName = 'arbestra_test'

Step 'Prérequis'
if (-not (Has 'git')) { Fail 'Git manquant : winget install -e --id Git.Git' }
if (-not (Has 'node')) { Fail 'Node.js manquant : winget install -e --id OpenJS.NodeJS (version 24 ou plus), puis rouvrir le terminal' }
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) { Fail "Node $(node --version) trop ancien : il faut Node 24 ou plus" }
Write-Host "Node $(node --version)"

if ($Docker) {
  if (-not (Has 'docker')) { Fail 'Docker manquant (Docker Desktop), ou relancer sans -Docker avec PostgreSQL 17 natif' }
} else {
  if (-not (Has 'psql')) {
    $pgBin = 'C:\Program Files\PostgreSQL\17\bin'
    if (Test-Path "$pgBin\psql.exe") { $env:Path = "$pgBin;$env:Path" }
    else { Fail "PostgreSQL 17 introuvable : winget install -e --id PostgreSQL.PostgreSQL.17 --interactive (note le mot de passe de 'postgres'), ou relancer avec -Docker" }
  }
  Write-Host (psql --version)
}

Step 'Dépendances (pnpm via Corepack)'
Run 'corepack' @('pnpm', 'install')

Step 'Configuration locale (.env)'
# Copies plutôt qu'un lien symbolique : un lien demande le mode développeur de Windows.
if (-not (Test-Path '.env.dev')) { Copy-Item '.env.example' '.env.dev'; Write-Host '.env.dev créé depuis .env.example' }
if (-not (Test-Path '.env')) { Copy-Item '.env.dev' '.env'; Write-Host '.env créé' }
if (-not (Test-Path '.env.test') -and (Test-Path '.env.test.example')) { Copy-Item '.env.test.example' '.env.test'; Write-Host '.env.test créé' }

Step 'PostgreSQL : rôle et bases'
function Sql($database, $query) {
  # Requête exécutée en tant que superutilisateur ; renvoie la sortie brute.
  if ($Docker) { $out = docker compose exec -T postgres psql -U $dbUser -d $database -Atc $query }
  else { $out = psql -U $PgSuperuser -h 127.0.0.1 -d $database -Atc $query }
  if ($LASTEXITCODE -ne 0) { Fail "requête PostgreSQL refusée : $query" }
  return $out
}
if ($Docker) {
  # compose.yaml crée le rôle et la base arbestra au premier démarrage.
  Run 'corepack' @('pnpm', 'db:up')
  Write-Host 'Attente de PostgreSQL...'
  for ($i = 0; $i -lt 30; $i++) {
    docker compose exec -T postgres pg_isready -U $dbUser -d $dbName *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 2
  }
} else {
  # Le mot de passe reste dans ce processus PowerShell ; rien n'est écrit sur le disque.
  if (-not $env:PGPASSWORD) {
    $secure = Read-Host "Mot de passe de '$PgSuperuser'" -AsSecureString
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
  if (-not (Sql 'postgres' "select 1 from pg_roles where rolname = '$dbUser'")) {
    Sql 'postgres' "create role $dbUser login createdb password '$dbPassword'" | Out-Null
    Write-Host "rôle $dbUser créé"
  }
  if (-not (Sql 'postgres' "select 1 from pg_database where datname = '$dbName'")) {
    Sql 'postgres' "create database $dbName owner $dbUser" | Out-Null
    Write-Host "base $dbName créée"
  }
}
if (-not (Sql 'postgres' "select 1 from pg_database where datname = '$testDbName'")) {
  Sql 'postgres' "create database $testDbName owner $dbUser" | Out-Null
  Write-Host "base $testDbName créée"
}

Step 'Données de développement'
$initialized = Sql $dbName "select 1 from information_schema.tables where table_name = 'kysely_migration'"
if ($initialized) {
  Write-Host 'Base déjà initialisée : migrations seulement, données conservées.'
  if ($Dump) { Write-Host "-Dump ignoré : la base $dbName contient déjà des données." -ForegroundColor Yellow }
  Run 'corepack' @('pnpm', 'db:migrate')
} elseif ($Dump) {
  if (-not (Test-Path $Dump)) { Fail "sauvegarde introuvable : $Dump" }
  Write-Host "Restauration de $Dump..."
  if ($Docker) {
    # Copie dans le conteneur : PowerShell 5.1 corrompt un flux binaire envoyé à un exécutable.
    Run 'docker' @('compose', 'cp', $Dump, 'postgres:/tmp/arbestra-restore.dump')
    docker compose exec -T postgres pg_restore --no-owner --no-privileges -U $dbUser -d $dbName /tmp/arbestra-restore.dump
    $restoreCode = $LASTEXITCODE
    docker compose exec -T postgres rm -f /tmp/arbestra-restore.dump | Out-Null
  } else {
    $superPassword = $env:PGPASSWORD
    $env:PGPASSWORD = $dbPassword
    pg_restore --no-owner --no-privileges -h 127.0.0.1 -U $dbUser -d $dbName $Dump
    $restoreCode = $LASTEXITCODE
    $env:PGPASSWORD = $superPassword
  }
  if ($restoreCode -ne 0) { Fail 'pg_restore a échoué' }
  Run 'corepack' @('pnpm', 'db:migrate')
  # La copie de Tristan ouvre le monde rc1-dev par défaut.
  if (-not $DefaultWorld) { $DefaultWorld = 'rc1-dev' }
} else {
  Write-Host 'Base vide : migrations puis seed.'
  Run 'corepack' @('pnpm', 'db:setup')
}

if ($DefaultWorld -and -not (Test-Path 'apps\world-web\.env.local')) {
  Set-Content -Path 'apps\world-web\.env.local' -Value "VITE_DEFAULT_WORLD_SLUG=$DefaultWorld" -Encoding ascii
  Write-Host "monde par défaut : $DefaultWorld (apps\world-web\.env.local)"
}

Step 'Base de test'
Run 'corepack' @('pnpm', 'db:test:setup')

Write-Host "`nPrêt. Lancer : corepack pnpm dev" -ForegroundColor Green
Write-Host '  Lobby  http://localhost:5173   Monde  http://localhost:5174/village'
Write-Host '  Compte de dev : player@arbestra.local / arbestra (base neuve)'
if ($Start) { Run 'corepack' @('pnpm', 'dev') }
