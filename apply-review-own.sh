#!/usr/bin/env bash
# /review-mr: your own MRs (author = you, or the session's branch) get scope full and are NOT posted to GitLab (findings
# stay in the chat with an offer to fix); other people's MRs keep blockers + inline posting. --full/--blockers, --post/--no-post force.
# Usage: bash ~/.claude-work/apply-review-own.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
mkdir -p "$DST/commands"; cp "$SRC/commands/review-mr.md" "$DST/commands/review-mr.md"; ok "commands/review-mr.md (own MR → full, chat only)"
echo "  Takes effect on the next /review-mr (commands are read per invocation)."
