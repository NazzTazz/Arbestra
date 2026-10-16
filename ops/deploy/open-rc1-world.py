#!/usr/bin/python3
"""Explicit operator command; not part of routine deployments or migrations."""
import argparse
import datetime
import fcntl
import os
from pathlib import Path
import re
import runpy
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('environment', choices=['alpha', 'staging'])
    parser.add_argument('--owner-account-id', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0 or not re.fullmatch(r'[0-9a-f-]{36}', args.owner_account_id):
        raise ValueError('Root access and an existing account UUID are required')
    environment = args.environment
    slug, name = ('alpha-rc1', 'Arbestra Alpha') if environment == 'alpha' else ('beta-rc1', 'Arbestra Bêta')
    lock = open('/run/lock/arbestra-deploy.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX)
    release = (Path('/srv/arbestra') / environment / 'current').resolve(strict=True)
    if not (release / 'api/dist/open-rc1-world.js').is_file():
        raise RuntimeError('Deploy a release containing the RC1 operator command first')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')
    backup = Path('/var/backups/arbestra') / f'{environment}-open-rc1-{stamp}.dump'
    with backup.open('xb') as output:
        backup.chmod(0o600)
        subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '-Fc', 'arbestra_' + environment], stdout=output, check=True)
    subprocess.run(['pg_restore', '--list', str(backup)], check=True, stdout=subprocess.DEVNULL)
    application = runpy.run_path('/usr/local/sbin/arbestra-deploy')['application']
    application([
        '/usr/local/bin/node', 'dist/open-rc1-world.js', '--owner-account-id', args.owner_account_id,
        '--slug', slug, '--name', name, '--artifact', str(release / 'web/world/studies/t1-alpha512-rc1.json'),
    ], Path('/etc/arbestra') / (environment + '.env'), 'arbestra-' + environment, release / 'api')


if __name__ == '__main__':
    main()
