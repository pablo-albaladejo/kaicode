#!/usr/bin/env bash
# /ship stage 10b "feedback" + /feedback: peer and bot review on the open MR — threads waiting on you, triage,
# one implementer run, replies on your word, resolve what was answered, exit when approved.
#   tools/mr-feedback.mjs · commands/feedback.md · commands/ship.md (10b) · ship-state + statusline stage lists
# Usage: bash ~/.claude-work/apply-feedback.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$SRC/tools/mr-feedback.mjs" "$DST/tools/mr-feedback.mjs"; ok "tools/mr-feedback.mjs (--mr · --all · --json · --reply · --resolve)"
cp "$SRC/commands/feedback.md" "$DST/commands/feedback.md";  ok "commands/feedback.md  (/feedback [!iid])"
cp "$SRC/commands/ship.md" "$DST/commands/ship.md";          ok "commands/ship.md (stage 10b feedback between review-mr and close)"
cp "$SRC/tools/ship-state.mjs" "$DST/tools/ship-state.mjs"; cp "$SRC/statusline.mjs" "$DST/statusline.mjs"; ok "ship-state + statusline know the feedback stage"
cp "$SRC/agents/lead.md" "$DST/agents/lead.md";              ok "agents/lead.md (a deny is a deny)"
echo
echo "  Try (inside the MR's worktree):  node ~/.claude/tools/mr-feedback.mjs --mr 248     # read-only"
echo "                                   claude → /feedback !248                          # the loop"
