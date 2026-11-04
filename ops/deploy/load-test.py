#!/usr/bin/python3
"""Explicit operator command for the load-test tool (docs/TEST-DE-CHARGE.md); not part of deployments.

  load-test.py install ENVIRONMENT load-test.tar.gz
  load-test.py run ENVIRONMENT [--staging-worlds W1,W2 | --dedicated-host HOST] SCRIPT [-- SCRIPT ARGUMENTS]

ENVIRONMENT is `staging` (the VPS) or `load` (a dedicated test machine). The alpha is not an
option: there is no code path for it. The tool is installed beside the release, never inside
`current`, and runs under the service UID with the service environment file; the database URL
reaches it through its environment (LOAD_DATABASE_URL), never through its arguments.
"""
import argparse
import fcntl
from pathlib import Path
import pwd
import re
import runpy
import shutil
import subprocess
import os
import sys
import tarfile

ENVIRONMENTS = ('staging', 'load')
SCRIPTS = ('provision', 'run', 'sampler', 'cleanup')
ALLOWED = ('dist', 'package.json', 'revision', 'environment')
GUARD_VARIABLES = {'staging_worlds': 'ARBESTRA_LOAD_STAGING', 'dedicated_host': 'ARBESTRA_LOAD_DEDICATED_HOST'}


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def paths(environment):
    root = Path('/srv/arbestra') / environment
    return root, root / 'load-test'


def revision_of(directory):
    return (directory / 'revision').read_text().strip()


def check_environment(environment):
    if environment not in ENVIRONMENTS:
        raise ValueError('Environment must be one of ' + ', '.join(ENVIRONMENTS))
    if os.geteuid() != 0:
        raise ValueError('Root access is required')


def install(environment, archive):
    check_environment(environment)
    root, base = paths(environment)
    release = (root / 'current').resolve(strict=True)
    revision = revision_of(release)
    account = pwd.getpwnam('arbestra-' + environment)
    with tarfile.open(archive) as bundle:
        members = bundle.getmembers()
        if len(members) > 5000 or sum(member.size for member in members) > 64 * 1024 * 1024:
            raise ValueError('Archive exceeds load-test limits')
        for member in members:
            name = Path(member.name)
            if name.is_absolute() or '..' in name.parts or name.parts[0] not in ALLOWED:
                raise ValueError('Archive entry outside the load-test layout: ' + member.name)
            if not (member.isfile() or member.isdir()):
                raise ValueError('Links and special entries are rejected: ' + member.name)
    base.mkdir(mode=0o755, exist_ok=True)
    out = base / 'out'
    out.mkdir(mode=0o700, exist_ok=True)
    os.chown(out, account.pw_uid, account.pw_gid)
    target = base / revision
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(mode=0o700)
    os.chown(target, account.pw_uid, account.pw_gid)
    # Extraction itself is unprivileged, as for a release: the archive is copied where the service UID can read it.
    upload = base / '.upload.tar.gz'
    shutil.copyfile(archive, upload)
    upload.chmod(0o644)
    try:
        run(['runuser', '-u', 'arbestra-' + environment, '--', 'tar', '-xzf', str(upload), '--no-same-owner', '--no-same-permissions', '-C', str(target)], umask=0o077)
    finally:
        upload.unlink()
    if revision_of(target) != revision or (target / 'environment').read_text().strip() != environment:
        shutil.rmtree(target)
        raise ValueError('The tool was built for another revision or environment than the current release (' + revision + ')')
    if not (target / 'dist/load-test/src/run.js').is_file():
        shutil.rmtree(target)
        raise ValueError('Incomplete load-test archive')
    # Dependencies are those of the release (kysely, pg, @arbestra/contracts): a link, no install.
    (target / 'node_modules').symlink_to(release / 'api/node_modules')
    latest = base / 'current'
    if latest.is_symlink() or latest.exists():
        latest.unlink()
    latest.symlink_to(target)
    print('Installed ' + str(target) + ' (revision ' + revision + '). Results and credentials go to ' + str(out) + '.')


def execute(environment, script, arguments, staging_worlds=None, dedicated_host=None):
    check_environment(environment)
    root, base = paths(environment)
    if script not in SCRIPTS:
        raise ValueError('Script must be one of ' + ', '.join(SCRIPTS))
    if environment == 'staging' and (not staging_worlds or dedicated_host):
        raise ValueError('Staging requires --staging-worlds (the worlds named by the target guard), not --dedicated-host')
    if environment == 'load' and (not dedicated_host or staging_worlds):
        raise ValueError('A dedicated machine requires --dedicated-host (the host of its API), not --staging-worlds')
    guard = staging_worlds or dedicated_host
    if not re.fullmatch(r'[a-z0-9][a-z0-9.,_-]{0,200}', guard.lower()):
        raise ValueError('Invalid guard value')
    release = (root / 'current').resolve(strict=True)
    tool = (base / 'current').resolve(strict=True)
    if revision_of(tool) != revision_of(release):
        raise ValueError('The installed tool is for revision ' + revision_of(tool) + ' but the release is ' + revision_of(release) + ': install it again')
    variable = GUARD_VARIABLES['staging_worlds' if environment == 'staging' else 'dedicated_host']
    application = runpy.run_path('/usr/local/sbin/arbestra-deploy')['application']
    # The shell only renames the service's DATABASE_URL; the secret never appears in argv.
    application([
        '/bin/sh', '-c', 'LOAD_DATABASE_URL="$DATABASE_URL" exec "$@"', 'sh',
        '/usr/bin/env', variable + '=' + guard, 'LOAD_OUT_DIR=' + str(base / 'out'),
        '/usr/local/bin/node', str(tool / 'dist/load-test/src' / (script + '.js')), *arguments,
    ], Path('/etc/arbestra') / (environment + '.env'), 'arbestra-' + environment, base / 'out')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    installer = commands.add_parser('install')
    installer.add_argument('environment')
    installer.add_argument('archive')
    runner = commands.add_parser('run')
    runner.add_argument('environment')
    runner.add_argument('--staging-worlds')
    runner.add_argument('--dedicated-host')
    runner.add_argument('script')
    runner.add_argument('arguments', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    lock = open('/run/lock/arbestra-deploy.lock', 'w')
    if args.command == 'install':
        fcntl.flock(lock, fcntl.LOCK_EX)
        install(args.environment, args.archive)
    else:
        arguments = args.arguments[1:] if args.arguments[:1] == ['--'] else args.arguments
        execute(args.environment, args.script, arguments, args.staging_worlds, args.dedicated_host)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, FileNotFoundError, subprocess.CalledProcessError) as error:
        sys.exit('Refused: ' + str(error))
