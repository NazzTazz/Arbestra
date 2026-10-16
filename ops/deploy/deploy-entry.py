#!/usr/bin/python3
"""Forced SSH command. Never evaluates the supplied command in a shell."""
import hashlib
import os
import re
import subprocess
import sys
import tempfile


def main():
    environment = sys.argv[1]
    if environment not in ('alpha', 'staging'):
        raise ValueError('Invalid environment')
    match = re.fullmatch(r'deploy ([a-f0-9]{40}) ([a-f0-9]{64})', os.getenv('SSH_ORIGINAL_COMMAND', ''))
    if not match:
        raise ValueError('Only deploy <commit> <sha256> is allowed')
    revision, expected = match.groups()
    fd, name = tempfile.mkstemp(prefix=environment + '-', suffix='.tar.gz', dir='/srv/arbestra/incoming')
    try:
        total, digest = 0, hashlib.sha256()
        with os.fdopen(fd, 'wb') as target:
            while chunk := sys.stdin.buffer.read(1024 * 1024):
                total += len(chunk)
                if total > 400 * 1024 * 1024:
                    raise ValueError('Release exceeds 400 MiB')
                digest.update(chunk)
                target.write(chunk)
        if digest.hexdigest() != expected:
            raise ValueError('Release checksum mismatch')
        subprocess.run(['sudo', '-n', '/usr/local/sbin/arbestra-deploy', environment, revision, expected, name], check=True)
    finally:
        os.unlink(name)


if __name__ == '__main__':
    main()
