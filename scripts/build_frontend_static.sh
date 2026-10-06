#!/usr/bin/env bash
set -euo pipefail

# Build static frontend output on a deployment host without masking the
# builder image's /app/node_modules with a source bind mount.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
builder_image="${IFRAME_FRONTEND_BUILDER_IMAGE:-iframe-frontend-builder:director-1a34522a}"
dependency_volume="${IFRAME_FRONTEND_NODE_MODULES_VOLUME:-iframe-frontend-node-modules}"
source_revision="$(git -C "$repo_root" rev-parse HEAD)"
if [ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ]; then
  echo "Refusing to build from modified tracked files" >&2
  exit 1
fi

docker volume create "$dependency_volume" >/dev/null
docker run --rm \
  -v "$repo_root:/workspace" \
  -v "$dependency_volume:/workspace/frontend/node_modules" \
  -w /workspace/frontend \
  -e DOCKER_BUILD=true \
  -e IFRAME_SOURCE_REVISION="$source_revision" \
  -e IFRAME_SOURCE_DIRTY=false \
  "$builder_image" \
  sh -ceu '
    if cmp -s /app/package-lock.json /workspace/frontend/package-lock.json &&
       [ ! -x /workspace/frontend/node_modules/.bin/next ]; then
      cp -a /app/node_modules/. /workspace/frontend/node_modules/
      cp /workspace/frontend/package-lock.json /workspace/frontend/node_modules/.iframe-package-lock.json
    fi
    if ! cmp -s /workspace/frontend/package-lock.json /workspace/frontend/node_modules/.iframe-package-lock.json; then
      npm ci --include=dev
      cp /workspace/frontend/package-lock.json /workspace/frontend/node_modules/.iframe-package-lock.json
    fi
    npm run build
  '

test -f "$repo_root/frontend/out/build-manifest.json"
grep -q "$source_revision" "$repo_root/frontend/out/build-manifest.json"
echo "Frontend static output: $repo_root/frontend/out"
