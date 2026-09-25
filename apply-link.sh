#!/usr/bin/env bash
# Untracked shared folders (openspec/) visible in every worktree as symlinks to the main tree — one source of truth,
# excluded from git status. cc-ticket links on worktree creation; /ship prepare re-runs it; run it once now for the
# worktrees that already exist.
# Usage: bash ~/.claude-work/apply-link.sh [worktrees-container-dir …]
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$SRC/tools/cc-link.sh" "$DST/tools/cc-link.sh"; chmod +x "$DST/tools/cc-link.sh"; ok "tools/cc-link.sh"
cp "$SRC/tools/cc-ticket.sh" "$DST/tools/cc-ticket.sh"; cp "$SRC/tools/ship-inventory.sh" "$DST/tools/ship-inventory.sh"; ok "cc-ticket links on create · ship-inventory finds the spec in the main tree"
cp "$SRC/commands/ship.md" "$DST/commands/ship.md"; cp "$SRC/statusline.mjs" "$DST/statusline.mjs"; ok "ship.md prepare runs cc-link · statusline spec:<slug> / openspec N"
for c in "$@"; do for w in "$c"/*/; do [ -d "$w/.git" ] || [ -f "$w/.git" ] || continue; printf '  %s: ' "$(basename "$w")"; bash "$DST/tools/cc-link.sh" "$w" 2>&1 | tail -1; done; done
echo; echo "  Existing worktrees: bash ~/.claude-work/apply-link.sh ~/development/conv-ai-settings-worktrees"
