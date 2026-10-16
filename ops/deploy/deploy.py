#!/usr/bin/python3
"""Root-owned deploy controller. Uploaded application code runs only as its own UID."""
import datetime
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import urllib.error
import urllib.parse


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def sql(database, query):
    return subprocess.check_output(['runuser', '-u', 'postgres', '--', 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', database], input=query.encode()).decode().strip()


def migration_version(database):
    if sql(database, "SELECT to_regclass('public.kysely_migration') IS NOT NULL") != 't':
        return ''
    return sql(database, 'SELECT name FROM kysely_migration ORDER BY name')


def application(command, environment_file, user, directory):
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/nonexistent'}
    for line in environment_file.read_text().splitlines():
        if line and not line.startswith('#'):
            key, value = line.split('=', 1)
            env[key] = value
    account = pwd.getpwnam(user)
    run(command, env=env, cwd=directory, user=account.pw_uid, group=account.pw_gid, extra_groups=[])


def web_smoke(environment):
    access = json.loads(Path('/etc/arbestra/private-access.json').read_text())[environment]
    authorization = 'Basic ' + base64.b64encode((access['http_user'] + ':' + access['http_password']).encode()).decode()
    port = 3101 if environment == 'alpha' else 3201
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(host, path='/', authenticated=True, extra=None):
        headers = {'Host': host}
        if authenticated:
            headers['Authorization'] = authorization
        headers.update(extra or {})
        request = urllib.request.Request(f'http://172.18.0.1:{port}' + path, headers=headers)
        try:
            response = opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        return response.code, response.read()

    hosts = [urllib.parse.urlsplit(access[key]).hostname for key in ('lobby', 'game', 'noc')]
    for index, host in enumerate(hosts):
        is_admin = index == 2
        if request(host, authenticated=False)[0] != (401 if is_admin else 200):
            raise RuntimeError('Unexpected public/private frontend access')
        status, body = request(host, authenticated=is_admin)
        if status != 200 or b'<script' not in body:
            raise RuntimeError('Frontend smoke check failed: ' + host)
        status, body = request(host, '/api/health', authenticated=is_admin)
        if status != 200 or json.loads(body).get('status') != 'ok':
            raise RuntimeError('API proxy smoke check failed')
        if request(host, '/api/health', authenticated=is_admin, extra={'Origin': 'https://untrusted.invalid'})[0] != 403:
            raise RuntimeError('Foreign origin was accepted')
        if not is_admin:
            status, body = request(host, '/api/auth/session', authenticated=False)
            if status != 401 or json.loads(body).get('code') != 'AUTHENTICATION_REQUIRED':
                raise RuntimeError('Player authentication is not enforced')
    if request(hosts[0], '/api/admin/session')[0] != 404:
        raise RuntimeError('Administrative route exposed on player host')
    status, body = request(hosts[2], '/api/admin/session')
    if status != 401 or json.loads(body).get('code') != 'AUTHENTICATION_REQUIRED':
        raise RuntimeError('Administrative authentication smoke check failed')


def main():
    environment, revision, digest, archive_name = sys.argv[1:]
    if environment not in ('alpha', 'staging') or not re.fullmatch('[a-f0-9]{40}', revision) or not re.fullmatch('[a-f0-9]{64}', digest):
        raise ValueError('Invalid deployment arguments')
    archive = Path(archive_name)
    if archive.is_symlink() or archive.parent != Path('/srv/arbestra/incoming') or not archive.is_file():
        raise ValueError('Invalid upload location')
    # One deployment/backup at a time across both environments on this small VPS.
    lock = open('/run/lock/arbestra-deploy.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX)
    if shutil.disk_usage('/srv/arbestra').free < 1536 * 1024 * 1024:
        raise RuntimeError('Less than 1.5 GiB available; deployment refused')
    root = Path('/srv/arbestra') / environment
    # Copy once through a non-following descriptor, into a root-owned directory.
    # The application UID cannot traverse the deploy account's incoming folder.
    verified_archive = root / ('.upload-' + revision + '.tar.gz')
    source_fd = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(source_fd, 'rb') as source, verified_archive.open('wb') as target:
        os.chmod(verified_archive, 0o600)
        shutil.copyfileobj(source, target)
    with verified_archive.open('rb') as source:
        if hashlib.file_digest(source, 'sha256').hexdigest() != digest:
            verified_archive.unlink()
            raise ValueError('Checksum mismatch')
    archive = verified_archive
    release = root / 'releases' / (revision + '-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f'))
    release.mkdir()
    release.chmod(0o755)
    user = 'arbestra-' + environment
    account = pwd.getpwnam(user)
    os.chown(release, account.pw_uid, account.pw_gid)
    with tarfile.open(archive) as bundle:
        members = bundle.getmembers()
        if len(members) > 50000 or sum(member.size for member in members) > 1024 * 1024 * 1024:
            raise ValueError('Expanded archive exceeds deployment limits')
        for member in members:
            target = (release / member.name).resolve()
            if not target.is_relative_to(release) or not member.name.split('/')[0] in ('api', 'web', 'revision', 'environment'):
                raise ValueError('Archive escapes release')
            if not (member.isfile() or member.isdir() or member.issym()):
                raise ValueError('Special/hardlinked archive entry rejected')
            if member.issym() and (Path(member.linkname).is_absolute() or not (target.parent / member.linkname).resolve().is_relative_to(release)):
                raise ValueError('External symlink rejected')
    # Extraction itself is unprivileged, including for hostile archives.
    os.chmod(archive, 0o644)
    try:
        run(['runuser', '-u', user, '--', 'tar', '-xzf', str(archive), '--no-same-owner', '--no-same-permissions', '-C', str(release)], umask=0o022)
    finally:
        archive.unlink()
    (release / 'api').chmod(0o700)
    if (release / 'revision').read_text().strip() != revision or (release / 'environment').read_text().strip() != environment:
        raise ValueError('Release identity mismatch')
    for file in ('api/dist/server.js', 'api/dist/database/migrate.js', 'api/dist/world-generator-worker.js', 'web/play/index.html', 'web/world/index.html', 'web/admin/index.html'):
        if not (release / file).is_file():
            raise ValueError('Incomplete release: ' + file)
    current = root / 'current'
    previous = current.resolve() if current.is_symlink() else None
    database = 'arbestra_' + environment
    version_before = migration_version(database)
    services = [f'arbestra-api@{environment}', f'arbestra-generator@{environment}']
    stopped = False
    migration_started = False
    try:
        run(['systemctl', 'stop', *services])
        stopped = True
        backup = Path('/var/backups/arbestra') / (environment + '-' + release.name + '.dump')
        with backup.open('xb') as output:
            os.chmod(backup, 0o600)
            run(['runuser', '-u', 'postgres', '--', 'pg_dump', '-Fc', database], stdout=output)
        run(['pg_restore', '--list', str(backup)], stdout=subprocess.DEVNULL)
        migration_started = True
        application(['/usr/local/bin/node', 'dist/database/migrate.js'], Path('/etc/arbestra') / (environment + '-migration.env'), user, release / 'api')
        # Runtime can mutate business data, never own tables or execute DDL.
        role = database + '_app'
        sql(database, f'GRANT USAGE ON SCHEMA public TO {role}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role}; REVOKE ALL ON kysely_migration, kysely_migration_lock FROM {role};')
        next_link = root / 'next'
        next_link.unlink(missing_ok=True)
        next_link.symlink_to(release)
        next_link.replace(current)
        run(['systemctl', 'start', *services])
        port = 3100 if environment == 'alpha' else 3200
        for attempt in range(60):
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=2) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('API health check failed')
        # Real runtime-role SQL read and production dependency/worker availability.
        application(['/usr/local/bin/node', '--input-type=module', '-e', "import pg from 'pg'; const p=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1}); try {await p.query('SELECT count(*) FROM worlds');} finally {await p.end();}"], Path('/etc/arbestra') / (environment + '.env'), user, release / 'api')
        run(['systemctl', 'is-active', *services, 'arbestra-web@' + environment])
        web_smoke(environment)
        # Keep current + two older releases. Never prune data/backups here.
        for old in sorted((root / 'releases').iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[3:]:
            if old != current.resolve() and old.is_dir() and not old.is_symlink():
                shutil.rmtree(old)
        for old in sorted(Path('/var/backups/arbestra').glob(environment + '-*.dump'), key=lambda p: p.stat().st_mtime, reverse=True)[3:]:
            old.unlink()
        print(f'DEPLOYED {environment} {revision}', flush=True)
    except Exception:
        if stopped:
            run(['systemctl', 'stop', *services])
            # Only restore old code automatically if the schema did not change.
            if previous and (not migration_started or migration_version(database) == version_before):
                current.unlink(missing_ok=True)
                current.symlink_to(previous)
                run(['systemctl', 'start', *services])
                print('Previous code restored; database unchanged.', flush=True)
            else:
                print('Services stopped: schema changed or first release. Inspect logs/backup; no automatic database restore.', flush=True)
        raise


if __name__ == '__main__':
    main()
