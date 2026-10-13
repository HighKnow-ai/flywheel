#!/usr/bin/env bash
# Flywheel sidecar launcher — the `bundle.externalBin` entry for `binaries/flywheel-sidecar`.
#
# GENERATED: `packages/sidecar/scripts/stage-runtime.mjs` copies this template to
# `packages/desktop/src-tauri/binaries/flywheel-sidecar-<target-triple>`. That copy is a build
# output and is NOT tracked in git (D-192) — edit THIS file, then re-run
# `npm --prefix packages/sidecar run build:dist`.
#
# WHY A LAUNCHER AND NOT A SINGLE-FILE BINARY (pkg / nexe / Node SEA): the sidecar writes Claude
# Code hook commands as `${process.execPath} <path to dist/*-hook.js>` and resolves five sibling
# modules through `import.meta.url` (claude-code-adapter.ts). Inside a single-file binary
# `process.execPath` is not a Node interpreter and the hook files are not on the real filesystem,
# so every fail-closed gate would brick every session. The bundle therefore carries a real Node
# runtime (`flywheel-node`), the compiled `dist/` tree and `flywheel-shim` (D-192).
#
# RESOLUTION ORDER:
#   1. Packaged: `$SCRIPT_DIR/flywheel-node` is executable AND
#      `$SCRIPT_DIR/../Resources/sidecar/dist/index.js` is readable — the `Contents/MacOS/` ->
#      `Contents/Resources/` layout Tauri produces. No PATH lookup for the interpreter (T-11-02).
#   2. Source tree (`tauri dev`, the sidecar's own tests): walk up from this script's PHYSICAL
#      directory for `packages/sidecar/dist/index.js` (G-02-1: a fixed hop count is wrong, this
#      file runs from two depths) and exec the developer's own `node`.
#   3. Neither: print both probed locations and exit 127. Never fall through to an unresolved exec.
set -euo pipefail

# Resolve BASH_SOURCE[0] to its physical directory, following symlinks one hop at a time — not
# `readlink -f`, which macOS's BSD `readlink` lacks.
resolve_physical_dir() {
  local target="$1"
  while [ -L "$target" ]; do
    local link
    link="$(readlink "$target")"
    case "$link" in
      /*) target="$link" ;;
      *) target="$(dirname "$target")/$link" ;;
    esac
  done
  (cd "$(dirname "$target")" && pwd -P)
}
SCRIPT_DIR="$(resolve_physical_dir "${BASH_SOURCE[0]}")"

PACKAGED_NODE="$SCRIPT_DIR/flywheel-node"
PACKAGED_ENTRY="$SCRIPT_DIR/../Resources/sidecar/dist/index.js"
if [ -x "$PACKAGED_NODE" ] && [ -f "$PACKAGED_ENTRY" ] && [ -r "$PACKAGED_ENTRY" ]; then
  exec "$PACKAGED_NODE" "$PACKAGED_ENTRY" "$@"
fi

ENTRY=""
dir="$SCRIPT_DIR"
while :; do
  if [ -f "$dir/packages/sidecar/dist/index.js" ]; then
    ENTRY="$dir/packages/sidecar/dist/index.js"
    break
  fi
  [ "$dir" = "/" ] && break
  dir="$(dirname "$dir")"
done

if [ -z "$ENTRY" ] || [ ! -f "$ENTRY" ] || [ ! -r "$ENTRY" ]; then
  echo "flywheel-sidecar: no packaged runtime (${PACKAGED_NODE} + ${PACKAGED_ENTRY}) and no packages/sidecar/dist/index.js above ${SCRIPT_DIR}." >&2
  echo "flywheel-sidecar: if the sidecar is unbuilt, run: npm --prefix packages/sidecar run build:dist" >&2
  echo "flywheel-sidecar: (older hint, source tree only: npm --prefix packages/sidecar run build)" >&2
  exit 127
fi

exec node "$ENTRY" "$@"
