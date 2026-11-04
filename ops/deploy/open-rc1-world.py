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


# `load` is a dedicated test machine (docs/TEST-DE-CHARGE.md), never the VPS.
DEFAULT_WORLDS = {'alpha': ('alpha', 'Arbestra Alpha'), 'staging': ('staging', 'Arbestra Bêta'), 'load': ('charge-1', 'Charge 1')}
TEST_WORLD_PREFIX = 'charge-'


def world_identity(environment, slug=None, name=None):
    """Slug and name of the world to open. Load-test worlds (charge-*) never go to the alpha."""
    default_slug, default_name = DEFAULT_WORLDS[environment]
    slug, name = slug or default_slug, (name or default_name).strip()
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug) or len(slug) > 64:
        raise ValueError('Invalid world slug')
    if not name or len(name) > 80:
        raise ValueError('Invalid world name')
    if environment == 'alpha' and slug.startswith(TEST_WORLD_PREFIX):
        raise ValueError('Load-test worlds (' + TEST_WORLD_PREFIX + '*) are never opened on the alpha')
    return slug, name


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('environment', choices=['alpha', 'staging', 'load'])
    parser.add_argument('--owner-account-id', required=True)
    parser.add_argument('--slug', help='world slug (default: alpha or staging, as the environment)')
    parser.add_argument('--name', help='world name (default: the environment name)')
    parser.add_argument('--shared-vertices', action='store_true', help='switch the world to shared terrain vertices right after opening')
    args = parser.parse_args()
    if os.geteuid() != 0 or not re.fullmatch(r'[0-9a-f-]{36}', args.owner_account_id):
        raise ValueError('Root access and an existing account UUID are required')
    environment = args.environment
    slug, name = world_identity(environment, args.slug, args.name)
    lock = open('/run/lock/arbestra-deploy.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX)
    release = (Path('/srv/arbestra') / environment / 'current').resolve(strict=True)
    if not (release / 'api/dist/open-rc1-world.js').is_file():
        raise RuntimeError('Deploy a release containing the RC1 operator command first')
    if args.shared_vertices and '--shared-vertices' not in (release / 'api/dist/open-rc1-world.js').read_text():
        raise RuntimeError('This release predates --shared-vertices: deploy a release that contains it first')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')
    backup = Path('/var/backups/arbestra') / f'{environment}-open-rc1-{slug}-{stamp}.dump'
    with backup.open('xb') as output:
        backup.chmod(0o600)
        subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '-Fc', 'arbestra_' + environment], stdout=output, check=True)
    subprocess.run(['pg_restore', '--list', str(backup)], check=True, stdout=subprocess.DEVNULL)
    application = runpy.run_path('/usr/local/sbin/arbestra-deploy')['application']
    application([
        '/usr/local/bin/node', 'dist/open-rc1-world.js', '--owner-account-id', args.owner_account_id,
        '--slug', slug, '--name', name, '--artifact', str(release / 'web/world/studies/t1-alpha512-rc1.json'),
        *(['--shared-vertices'] if args.shared_vertices else []),
    ], Path('/etc/arbestra') / (environment + '.env'), 'arbestra-' + environment, release / 'api')


if __name__ == '__main__':
    main()
