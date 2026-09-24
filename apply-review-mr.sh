#!/usr/bin/env bash
# Installs /review-mr (command) and the upgraded reviewer agent. Usage: bash ~/.claude-work/apply-review-mr.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
mkdir -p "$DST/agents" "$DST/commands" "$DST/tools"
cp "$SRC/tools/mr-post.mjs" "$DST/tools/mr-post.mjs";       ok "tools/mr-post.mjs (inline discussions via glab api)"
cp "$SRC/tools/mr-checkout.sh" "$DST/tools/mr-checkout.sh"; chmod +x "$DST/tools/mr-checkout.sh"; ok "tools/mr-checkout.sh (URL → local clone + MR worktree)"
[ -f "$DST/agents/reviewer.md" ] && cp "$DST/agents/reviewer.md" "$DST/agents/reviewer.md.bak-$TS"
cp "$SRC/agents/reviewer.md" "$DST/agents/reviewer.md";       ok "agents/reviewer.md (blockers by default, scope full, fix snippets, --spec optional, read-only)"
cp "$SRC/commands/review-mr.md" "$DST/commands/review-mr.md"; ok "commands/review-mr.md → /review-mr [!123|url|branch] [--full] [--spec] [--no-post]"
echo; echo "  Try in a new claude session:  /review-mr !123 (inline comments)   ·   /review-mr !123 --full   ·   /review-mr --no-post"
