#!/usr/bin/python3
"""One-time provisioning for the audited Debian VPS; run as root, never via CI."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import urllib.request

SOURCE = Path(__file__).resolve().parent
CONFIG = Path('/etc/arbestra')
NODE_VERSION = '24.22.0'


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def private(path, text, mode=0o600):
    path.write_text(text)
    path.chmod(mode)


def sql(database, query):
    return subprocess.check_output(['runuser', '-u', 'postgres', '--', 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', database], input=query.encode()).decode().strip()


def setup():
    if os.geteuid() != 0:
        raise RuntimeError('Run as root')
    CONFIG.mkdir(mode=0o750, exist_ok=True)
    # Refuse accidental reprovisioning/credential replacement.
    if (CONFIG / 'provisioned').exists():
        raise RuntimeError('Already provisioned. Update explicitly; credentials are preserved.')
    for name in ('alpha', 'staging', 'web', 'deploy'):
        user = 'arbestra-' + name
        if subprocess.run(['id', user], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
            run(['useradd', '--system', '--create-home', '--home-dir', '/var/lib/' + user, '--shell', '/bin/bash' if name == 'deploy' else '/usr/sbin/nologin', user])
    run(['chown', 'root:arbestra-web', str(CONFIG)])
    run(['apt-get', 'update', '-qq'])
    run(['apt-get', 'install', '-y', '--no-install-recommends', 'postgresql-17', 'postgresql-client-17', 'ca-certificates', 'curl'], env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'})
    # Download a pinned official runtime and verify its SHA256 manifest.
    archive = f'node-v{NODE_VERSION}-linux-x64.tar.xz'
    url = f'https://nodejs.org/dist/v{NODE_VERSION}/'
    manifest = urllib.request.urlopen(url + 'SHASUMS256.txt').read().decode()
    expected = next(line.split()[0] for line in manifest.splitlines() if line.endswith('  ' + archive))
    payload = urllib.request.urlopen(url + archive).read()
    if hashlib.sha256(payload).hexdigest() != expected:
        raise RuntimeError('Node checksum mismatch')
    target = Path('/tmp') / archive
    target.write_bytes(payload)
    run(['tar', '-xJf', str(target), '-C', '/opt'])
    target.unlink()
    node = Path('/opt') / f'node-v{NODE_VERSION}-linux-x64/bin/node'
    node_link = Path('/usr/local/bin/node')
    if not node_link.exists():
        node_link.symlink_to(node)
    elif node_link.resolve() != node:
        raise RuntimeError('A different native Node is already installed')
    # Reuse the existing gateway binary, without creating/pulling any image.
    run(['docker', 'cp', 'wai-gateway-caddy-1:/usr/bin/caddy', '/usr/local/bin/arbestra-caddy'])
    Path('/usr/local/bin/arbestra-caddy').chmod(0o755)
    run(['systemctl', 'enable', '--now', 'postgresql'])
    pg_config = Path('/etc/postgresql/17/main/conf.d/arbestra.conf')
    private(pg_config, "listen_addresses = '127.0.0.1'\nshared_buffers = '128MB'\nwork_mem = '4MB'\nmax_connections = 60\n", 0o644)
    run(['systemctl', 'restart', 'postgresql@17-main'])
    state = Path('/srv/arbestra')
    state.mkdir(mode=0o755, exist_ok=True)
    incoming = state / 'incoming'
    incoming.mkdir(mode=0o700, exist_ok=True)
    run(['chown', 'arbestra-deploy:arbestra-deploy', str(incoming)])
    backups = Path('/var/backups/arbestra')
    backups.mkdir(mode=0o700, exist_ok=True)
    access_file = CONFIG / 'private-access.json'
    access = json.loads(access_file.read_text()) if access_file.exists() else {}
    for environment, port, lobby, world, noc in [
        ('alpha', 3100, 'play.arbestra.world', 'alpha.arbestra.world', 'noc.arbestra.world'),
        ('staging', 3200, 'play-beta.arbestra.world', 'beta.arbestra.world', 'noc-beta.arbestra.world'),
    ]:
        database = 'arbestra_' + environment
        owner, app = database + '_owner', database + '_app'
        owner_password, app_password = secrets.token_hex(32), secrets.token_hex(32)
        # Names/passwords are fixed identifiers or hex generated here, never input SQL.
        exists = sql('postgres', f"SELECT count(*) FROM pg_database WHERE datname='{database}'") != '0'
        if exists and not (CONFIG / (environment + '.env')).exists():
            raise RuntimeError('Unmanaged database already exists: ' + database)
        if not exists:
            sql('postgres', f"CREATE ROLE {owner} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '{owner_password}'; CREATE ROLE {app} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 24 PASSWORD '{app_password}';")
            sql('postgres', f'CREATE DATABASE {database} OWNER {owner};')
            sql(database, f'REVOKE ALL ON DATABASE {database} FROM PUBLIC; GRANT CONNECT ON DATABASE {database} TO {app}; REVOKE ALL ON SCHEMA public FROM PUBLIC;')
        common = f'NODE_ENV=production\nHOST=127.0.0.1\nPORT={port}\nCOOKIE_NAME=__Secure-arbestra_{environment}\nCOOKIE_DOMAIN=.arbestra.world\nADMIN_ORIGIN=https://{noc}\nADMIN_ACCOUNT_IDS=\nTRUSTED_PROXY_CIDRS=127.0.0.1\nEXPEDITION_WORKERS=1\nSCHEDULED_TASK_POLL_INTERVAL_MS=1000\nWORLD_GENERATOR_MEMORY_MB=384\n'
        if not exists:
            private(CONFIG / (environment + '.env'), f'DATABASE_URL=postgresql://{app}:{app_password}@127.0.0.1:5432/{database}\n' + common)
            private(CONFIG / (environment + '-migration.env'), f'DATABASE_URL=postgresql://{owner}:{owner_password}@127.0.0.1:5432/{database}\nNODE_ENV=production\n')
        root = state / environment
        (root / 'releases').mkdir(parents=True, mode=0o755, exist_ok=True)
        gate_password = access.get(environment, {}).get('http_password', secrets.token_urlsafe(24))
        hashed = subprocess.check_output(['/usr/local/bin/arbestra-caddy', 'hash-password'], input=(gate_password + '\n').encode()).decode().strip()
        access[environment] = {'http_user': 'arbestra', 'http_password': gate_password, 'lobby': 'https://' + lobby, 'game': 'https://' + world, 'noc': 'https://' + noc}
        private(access_file, json.dumps(access, indent=2) + '\n')
        web_config = '''{
  auto_https off
  admin off
  servers {
    trusted_proxies static 172.18.0.3/32
    trusted_proxies_strict
    client_ip_headers X-Forwarded-For
  }
}
http://:WEB_PORT {
  bind 172.18.0.1
  basic_auth {
    arbestra GATE_HASH
  }
  header {
    X-Robots-Tag "noindex, nofollow"
    X-Content-Type-Options nosniff
    Referrer-Policy same-origin
    Cache-Control "private, no-store"
    -Server
  }
  encode zstd gzip
  @foreignOrigin {
    header Origin *
    not {
      header Origin https://LOBBY
      header Origin https://WORLD
      header Origin https://NOC
    }
  }
  respond @foreignOrigin 403
  @crossSite header Sec-Fetch-Site cross-site
  respond @crossSite 403
  @adminOnPlayer {
    path /api/admin /api/admin/*
    not host NOC
  }
  respond @adminOnPlayer 404
  handle /api/* {
    reverse_proxy 127.0.0.1:API_PORT {
      header_up X-Forwarded-Proto https
      header_up X-Forwarded-Host {http.request.host}
      header_up X-Forwarded-For {client_ip}
      header_up -Authorization
      flush_interval -1
    }
  }
  @lobby host LOBBY
  handle @lobby {
    root * /srv/arbestra/ENVIRONMENT/current/web/play
    try_files {path} /index.html
    file_server
  }
  @noc host NOC
  handle @noc {
    root * /srv/arbestra/ENVIRONMENT/current/web/admin
    try_files {path} /index.html
    file_server
  }
  @world host WORLD
  handle @world {
    root * /srv/arbestra/ENVIRONMENT/current/web/world
    try_files {path} /index.html
    file_server
  }
  handle {
    respond 404
  }
}
'''
        for old, new in [('WEB_PORT', str(port + 1)), ('API_PORT', str(port)), ('GATE_HASH', hashed), ('ENVIRONMENT', environment), ('LOBBY', lobby), ('WORLD', world), ('NOC', noc)]:
            web_config = web_config.replace(old, new)
        private(CONFIG / (environment + '.Caddyfile'), web_config, 0o640)
        run(['chown', 'root:arbestra-web', str(CONFIG / (environment + '.Caddyfile'))])
        run(['/usr/local/bin/arbestra-caddy', 'validate', '--config', str(CONFIG / (environment + '.Caddyfile')), '--adapter', 'caddyfile'])
    private(CONFIG / 'private-access.json', json.dumps(access, indent=2) + '\n')
    for service in [*SOURCE.glob('*.service'), *SOURCE.glob('*.timer')]:
        shutil.copyfile(service, Path('/etc/systemd/system') / service.name)
    shutil.copyfile(SOURCE / 'deploy.py', '/usr/local/sbin/arbestra-deploy')
    Path('/usr/local/sbin/arbestra-deploy').chmod(0o755)
    Path('/usr/local/lib/arbestra').mkdir(exist_ok=True)
    shutil.copyfile(SOURCE / 'deploy-entry.py', '/usr/local/lib/arbestra/deploy-entry.py')
    Path('/usr/local/lib/arbestra/deploy-entry.py').chmod(0o755)
    shutil.copyfile(SOURCE / 'backup.py', '/usr/local/lib/arbestra/backup.py')
    Path('/usr/local/lib/arbestra/backup.py').chmod(0o755)
    private(Path('/etc/sudoers.d/arbestra-deploy'), 'arbestra-deploy ALL=(root) NOPASSWD: /usr/local/sbin/arbestra-deploy\n', 0o440)
    run(['visudo', '-cf', '/etc/sudoers.d/arbestra-deploy'])
    # No external listener; only the current gateway may access internal web ports.
    for port in ('3101', '3201'):
        run(['ufw', 'allow', 'from', '172.18.0.3', 'to', '172.18.0.1', 'port', port, 'proto', 'tcp'])
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'arbestra-backup.timer'])
    for environment in ('alpha', 'staging'):
        run(['systemctl', 'enable', f'arbestra-api@{environment}', f'arbestra-generator@{environment}', f'arbestra-web@{environment}'])
        run(['systemctl', 'start', f'arbestra-web@{environment}'])
    private(CONFIG / 'provisioned', 'Native provisioning complete\n')
    print('Provisioned. Credentials remain in /etc/arbestra/private-access.json (root only).')


if __name__ == '__main__':
    setup()
