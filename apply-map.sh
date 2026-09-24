#!/usr/bin/env bash
# Phase 2 of the agentic SDLC: /map — the codebase map the agents read instead of the tree.
#   tools/repo-map.mjs (deterministic scan + one flash call, ~$0.05) · commands/map.md
#   agents investigator/planner/implementer: "The map first" · /ship prepare runs repo-map (free when fresh)
#   Learn writes repo gotchas into the map; ~/.claude/knowledge/repos/<repo>.md is user-level (never committed).
# Usage: bash ~/.claude-work/apply-map.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
mkdir -p "$DST/commands" "$DST/tools" "$DST/knowledge/repos"
cp "$SRC/tools/repo-map.mjs" "$DST/tools/repo-map.mjs";     ok "tools/repo-map.mjs"
cp "$SRC/commands/map.md" "$DST/commands/map.md";           ok "commands/map.md  (/map [--refresh] [--in-repo])"
cp "$SRC/tools/cc-cost.mjs" "$DST/tools/cc-cost.mjs";       ok "cc-cost: map rows"
cp "$SRC/commands/ship.md" "$DST/commands/ship.md";         ok "commands/ship.md (prepare runs the map · briefs start from it · Learn appends Gotchas)"
for a in investigator planner implementer; do cp "$SRC/agents/$a.md" "$DST/agents/$a.md"; done; ok "agents: investigator · planner · implementer read the map first"
"$NODE" "$DST/tools/gen-effort-variants.mjs" --clean >/dev/null; "$NODE" "$DST/tools/gen-effort-variants.mjs" | tail -1 | sed 's/^/  ✓ /'
rm -f "$DST"/agents/task--*.md "$DST"/agents/lead--*.md "$DST"/agents/solo--*.md
echo
echo "  Try (inside a repo):  node ~/.claude/tools/repo-map.mjs --dry-run   # what it would read, no call"
echo "                        claude → /map                                 # builds ~/.claude/knowledge/repos/<repo>.md"
echo "  Restart claude for the agent prompts."
