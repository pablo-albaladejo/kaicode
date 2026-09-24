#!/usr/bin/env bash
# Fix for "PreToolUse hook for Agent returned updatedInput that failed schema validation (model)":
# Claude Code only accepts model aliases in the Agent tool, so the router no longer rewrites `model`. The table's
# model and effort now live in generated variants <role>--<model alias>-<effort>.md and the router swaps subagent_type.
# Usage: bash ~/.claude-work/apply-variants-v2.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$DST/hooks/model-router.mjs" "$DST/hooks/model-router.mjs.bak-$TS"
cp "$SRC/hooks/model-router.mjs" "$DST/hooks/model-router.mjs";               ok "hooks/model-router.mjs (never rewrites model; variant = <role>--<alias>-<effort>)"
cp "$SRC/tools/gen-effort-variants.mjs" "$DST/tools/gen-effort-variants.mjs"
cp "$SRC/tools/cc-cost.mjs" "$DST/tools/cc-cost.mjs"; cp "$SRC/statusline.mjs" "$DST/statusline.mjs"; ok "cc-cost + statusline (variant names normalised)"
cp "$SRC/agents/lead.md" "$DST/agents/lead.md";                                 ok "agents/lead.md (no retries on launch errors, ≤ 2 parallel)"
"$NODE" "$DST/tools/gen-effort-variants.mjs" --clean >/dev/null
"$NODE" "$DST/tools/gen-effort-variants.mjs" | tail -1 | sed 's/^/  ✓ /'
rm -f "$DST"/agents/task--*.md "$DST"/agents/lead--*.md "$DST"/agents/solo--*.md
echo "  variants now: $(ls "$DST/agents" | grep -c -- '--')  (e.g. $(ls "$DST/agents" | grep -- '--' | head -3 | tr '\n' ' '))"
echo; echo "  Restart claude (agent list is read at startup), then retry the three prompts."
