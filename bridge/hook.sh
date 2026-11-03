#!/usr/bin/env bash
# Shared launcher for the visualizer hooks (Cline + Claude Code): finds a node, leaves a breadcrumb, execs hook.mjs.
# VS Code-launched tools get a minimal PATH with no `node`; a bare `node` here died silently and the hooks went dark.
# Fails open (observability + write-lock only): a launcher problem must never block a tool call.
SRC="${1:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EV="-"
[ -n "$2" ] && EV="$2"

NODE=""
for c in "$OFFICE_NODE" "$(command -v node 2>/dev/null)" "$HOME/.hermes/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -n "$c" ] && [ -x "$c" ]; then NODE="$c"; break; fi
done
if [ -z "$NODE" ]; then
  NVM_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
  if [ -n "$NVM_BIN" ] && [ -x "$NVM_BIN/node" ]; then NODE="$NVM_BIN/node"; fi
fi

# Breadcrumb (before node, best-effort, rotated at 200KB): proves the script ran, from which tool, and where node came from.
BC="${OFFICE_HOOK_SHELL_LOG:-$ROOT/.opencode/bridge/hook-shell.log}"
if [ -f "$BC" ] && [ "$(wc -c < "$BC" 2>/dev/null || echo 0)" -gt 204800 ]; then mv -f "$BC" "$BC.1" 2>/dev/null; fi
printf '%s %s %s node=%s ppid=%s\n' "$(date -u +%FT%TZ)" "${SRC:-unknown}" "$EV" "${NODE:-none}" "$PPID" >> "$BC" 2>/dev/null || true

if [ -z "$NODE" ]; then
  [ "$SRC" = cline ] && echo '{"cancel":false}'
  exit 0
fi
exec "$NODE" "$ROOT/.opencode/bridge/hook.mjs" "$@"
