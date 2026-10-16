#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  alpha) lobby=https://play.arbestra.world; world=https://alpha.arbestra.world ;;
  staging) lobby=https://play-beta.arbestra.world; world=https://beta.arbestra.world ;;
  *) echo 'Expected alpha or staging' >&2; exit 2 ;;
esac
export VITE_LOBBY_URL="$lobby"
export VITE_WORLD_CLIENT_URL="$world/village"
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
