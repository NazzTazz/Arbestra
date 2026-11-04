#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  # Each world is served on its own subdomain (ops/deploy/sites.py).
  alpha) domain=arbestra.world ;;
  staging) domain=arbestra.fr ;;
  # A dedicated load-test machine (docs/TEST-DE-CHARGE.md): the web bundles are built but never served.
  load) domain=load.invalid ;;
  *) echo 'Expected alpha, staging or load' >&2; exit 2 ;;
esac
export VITE_LOBBY_URL="https://play.$domain"
export VITE_WORLD_CLIENT_URL="https://{world}.$domain/village"
export VITE_WORLD_HOST="{world}.$domain"
pnpm build
# A portable Linux production dependency tree; no install or compilation on VPS.
bundle=$(mktemp -d)
trap 'rm -rf "$bundle"' EXIT
pnpm --filter @arbestra/api deploy --prod --legacy "$bundle/api"
# Legacy pnpm deploy emits an unused self-link to the checkout. Make it portable.
self="$bundle/api/node_modules/.pnpm/node_modules/@arbestra/api"
if test -L "$self"; then
  rm "$self"
  ln -s ../../../.. "$self"
fi
python3 - "$bundle" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1]).resolve()
for path in root.rglob('*'):
    if path.is_symlink() and not path.resolve().is_relative_to(root):
        raise ValueError('Non-portable dependency link: ' + str(path.relative_to(root)))
PY
mkdir -p "$bundle/web"
for app in play world admin; do
  cp -a "apps/$app-web/dist" "$bundle/web/$app"
done
printf '%s\n' "${GITHUB_SHA:-$(git rev-parse HEAD)}" > "$bundle/revision"
printf '%s\n' "$1" > "$bundle/environment"
tar --hard-dereference -czf release.tar.gz -C "$bundle" api web revision environment
# Optional load-test tool (docs/TEST-DE-CHARGE.md): compiled, no dependency of its own (it runs on the
# production tree of api/). Never part of release.tar.gz and never installed into `current` by a deploy.
pnpm --filter @arbestra/load-test build
mkdir -p "$bundle/load-test"
cp -a apps/load-test/dist "$bundle/load-test/dist"
printf '{"type":"module"}\n' > "$bundle/load-test/package.json"
cp "$bundle/revision" "$bundle/environment" "$bundle/load-test/"
tar -czf load-test.tar.gz -C "$bundle/load-test" dist package.json revision environment
