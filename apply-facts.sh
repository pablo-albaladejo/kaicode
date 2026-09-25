#!/usr/bin/env bash
# "Facts before code": understand reports the facts a ticket needs before planning (measure / check / confirm against a
# real system) and any conditional scope; /ship gets a human stage `gate-facts` after understand; planner and plan
# reviewer refuse to design a conditional part before its fact exists. Stage lists updated (15 stages).
# Usage: bash ~/.claude-work/apply-facts.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$SRC/commands/ship.md" "$DST/commands/ship.md";                  ok "commands/ship.md (2b gate-facts)"
for a in investigator planner reviewer lead; do cp "$SRC/agents/$a.md" "$DST/agents/$a.md"; done; ok "agents: investigator (Facts needed · Conditional scope) · planner (facts before design) · reviewer (plan gate) · lead"
cp "$SRC/tools/ship-state.mjs" "$DST/tools/ship-state.mjs"; cp "$SRC/statusline.mjs" "$DST/statusline.mjs"; cp "$SRC/tools/retro-report.mjs" "$DST/tools/retro-report.mjs"; ok "stage lists: gate-facts (human) between understand and plan"
"$NODE" "$DST/tools/gen-effort-variants.mjs" --clean >/dev/null; "$NODE" "$DST/tools/gen-effort-variants.mjs" | tail -1 | sed 's/^/  ✓ /'
rm -f "$DST"/agents/task--*.md "$DST"/agents/lead--*.md "$DST"/agents/solo--*.md
echo; echo "  Restart claude for the agent prompts."
