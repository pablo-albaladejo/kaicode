#!/usr/bin/env bash
# Phase 3 of the agentic SDLC: /retro — the harness looks at its own logs once a week and proposes ≤3 changes.
#   tools/retro-report.mjs (numbers from the logs, no model; --close records the retro) · commands/retro.md
# Usage: bash ~/.claude-work/apply-retro.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
mkdir -p "$DST/commands" "$DST/tools" "$DST/knowledge"
cp "$SRC/tools/retro-report.mjs" "$DST/tools/retro-report.mjs"; ok "tools/retro-report.mjs"
cp "$SRC/commands/retro.md" "$DST/commands/retro.md";         ok "commands/retro.md  (/retro [--days 7])"
echo
echo "  Try:  node ~/.claude/tools/retro-report.mjs --days 7    # the numbers, no model"
echo "        claude → /retro                                  # numbers → ≤3 proposals → your OK → applied + recorded"
