#!/usr/bin/env bash
# dist をビルドして gh-pages ブランチへ反映する（GitHub Pages）
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build
TMP=$(mktemp -d)
cp -r dist/. "$TMP/"
touch "$TMP/.nojekyll"
REMOTE=$(git remote get-url origin)
cd "$TMP"
git init -q -b gh-pages
git -c user.name="uenokun516-ai" -c user.email="uenokun516@gmail.com" add -A
git -c user.name="uenokun516-ai" -c user.email="uenokun516@gmail.com" commit -qm "公開用ビルド $(date -u +%Y-%m-%dT%H:%MZ)"
git push -f "$REMOTE" gh-pages
echo "deployed"
