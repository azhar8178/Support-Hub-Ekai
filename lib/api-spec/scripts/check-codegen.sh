#!/usr/bin/env bash
# Codegen drift check: regenerates the API clients from openapi.yaml and fails
# if the committed generated output differs (i.e. someone edited the spec but
# forgot to run `pnpm --filter @workspace/api-spec run codegen`).
#
# The check never leaves the working tree modified: the current generated
# output is snapshotted first and always restored afterwards.
set -euo pipefail

cd "$(dirname "$0")/.."           # lib/api-spec
ROOT="$(cd ../.. && pwd)"          # workspace root

GENERATED_DIRS=(
  "lib/api-client-react/src/generated"
  "lib/api-zod/src/generated"
)

SNAP="$(mktemp -d)"

snap_name() {
  # lib/api-zod/src/generated -> lib__api-zod__src__generated
  echo "${1//\//__}"
}

restore() {
  for d in "${GENERATED_DIRS[@]}"; do
    local src="$SNAP/$(snap_name "$d")"
    if [ -d "$src" ]; then
      rm -rf "${ROOT:?}/$d"
      cp -R "$src" "$ROOT/$d"
    fi
  done
}

cleanup() {
  restore
  rm -rf "$SNAP"
}
trap cleanup EXIT

# Snapshot committed generated output
for d in "${GENERATED_DIRS[@]}"; do
  if [ ! -d "$ROOT/$d" ]; then
    echo "codegen:check: missing generated dir $d — run 'pnpm --filter @workspace/api-spec run codegen'" >&2
    exit 1
  fi
  cp -R "$ROOT/$d" "$SNAP/$(snap_name "$d")"
done

# Regenerate in place
npx orval --config ./orval.config.ts >/dev/null

# Compare regenerated output against the snapshot
DRIFT=0
for d in "${GENERATED_DIRS[@]}"; do
  if ! diff -ru --strip-trailing-cr "$SNAP/$(snap_name "$d")" "$ROOT/$d" >/tmp/codegen-drift-diff.txt 2>&1; then
    if [ "$DRIFT" -eq 0 ]; then
      echo "" >&2
      echo "ERROR: generated API clients are out of date with lib/api-spec/openapi.yaml" >&2
      echo "Run: pnpm --filter @workspace/api-spec run codegen (and commit the result)" >&2
      echo "" >&2
    fi
    DRIFT=1
    echo "--- drift in $d ---" >&2
    cat /tmp/codegen-drift-diff.txt >&2
  fi
done

if [ "$DRIFT" -ne 0 ]; then
  exit 1
fi

echo "codegen:check: generated clients are up to date with openapi.yaml"
