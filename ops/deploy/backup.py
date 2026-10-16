#!/usr/bin/python3
"""Daily local snapshots. An off-VPS copy is still required for disaster recovery."""
import datetime
import fcntl
from pathlib import Path
import os
import subprocess


def main():
    lock = open('/run/lock/arbestra-deploy.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')
    root = Path('/var/backups/arbestra')
    for environment in ('alpha', 'staging'):
        path = root / f'daily-{environment}-{stamp}.dump'
        with path.open('xb') as output:
            os.chmod(path, 0o600)
            subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '-Fc', 'arbestra_' + environment], stdout=output, check=True)
        subprocess.run(['pg_restore', '--list', str(path)], check=True, stdout=subprocess.DEVNULL)
        for old in sorted(root.glob(f'daily-{environment}-*.dump'), reverse=True)[7:]:
            old.unlink()


if __name__ == '__main__':
    main()
