#!/usr/bin/env bash
# Built-in Claude Code agents (general-purpose, Plan, …) launched by the lead are now routed like `task`:
# the router assigns one of our roles (+ model · effort variant) instead of letting them run with all tools.
# Also: lead rules 7-8 (never launch built-ins; one session = one ticket worktree, otherwise `claude @ticket <T>`).
# Usage: bash ~/.claude-work/apply-builtins.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$DST/hooks/model-router.mjs" "$DST/hooks/model-router.mjs.bak-$TS"
cp "$SRC/hooks/model-router.mjs" "$DST/hooks/model-router.mjs"; ok "hooks/model-router.mjs (builtinAgents routed like the placeholder)"
cp "$SRC/agents/lead.md" "$DST/agents/lead.md";                 ok "agents/lead.md (rules 7-8: never launch built-ins; one session = one ticket worktree)"
cp "$SRC/CLAUDE.md" "$DST/CLAUDE.md";                           ok "CLAUDE.md (one session, one ticket)"
"$NODE" "$DST/hooks/model-router.mjs" --dump-config | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log("  builtins routed:",(c.builtinAgents||[]).join(", "),"· routeBuiltins",c.routeBuiltins)})'
echo "  Off: \"routeBuiltins\": false in ~/.claude/router.json. Restart claude for lead.md."
