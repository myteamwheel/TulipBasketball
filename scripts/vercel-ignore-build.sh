#!/usr/bin/env bash
set -euo pipefail

# No parent means Vercel cannot prove this is a G-League-only change, so build.
if ! git rev-parse HEAD^ >/dev/null 2>&1; then
  exit 1
fi

# Exit 0 only when every changed file belongs exclusively to the unrelated
# G League static-data pipeline. Any Dynasty app/config/dependency change exits
# 1 so Vercel builds normally.
while IFS= read -r path; do
  case "$path" in
    gleague-static/*|scripts/mirror-live-site.mjs|scripts/sync-gleague-data.mjs|scripts/audit-gleague-data.mjs|scripts/gleague-data-summary.json|site.tar.gz)
      ;;
    *)
      exit 1
      ;;
  esac
done < <(git diff --name-only HEAD^ HEAD)

exit 0
