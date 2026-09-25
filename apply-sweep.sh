#!/usr/bin/env bash
# Automatic cleanup after merges: cc-sweep runs in the background every time `claude` starts (zsh wrapper) and in
# /ship prepare. It removes worktrees + branches whose MR is merged, skipping dirty trees, the current one and any with
# a live process. cc-clean stays for the explicit, per-ticket form (with --jira-done).
# Usage: bash ~/.claude-work/apply-sweep.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; ZSHRC="$HOME/.zshrc"; TS=$(date +%Y%m%d-%H%M%S); NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$SRC/tools/cc-sweep.sh" "$DST/tools/cc-sweep.sh"; cp "$SRC/tools/cc-clean.sh" "$DST/tools/cc-clean.sh"; chmod +x "$DST"/tools/*.sh; ok "tools/cc-sweep.sh · tools/cc-clean.sh"
cp "$SRC/commands/ship.md" "$DST/commands/ship.md"; ok "commands/ship.md (prepare sweeps)"
cp "$ZSHRC" "$ZSHRC.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; let s=fs.readFileSync(p,"utf8");
if(!s.includes("# >>> claude-gateway >>>")){console.log("  ! claude() wrapper not found in ~/.zshrc");process.exit(1);}
if(s.includes("cc-sweep.sh")){console.log("  \u001b[32m✓\u001b[0m wrapper already sweeps");process.exit(0);}
const anchor="\n    if [ \"$1\" = \"@ticket\" ]; then\n";
if(!s.includes(anchor)){console.log("  ! @ticket block not found; run apply-worktree-guard.sh first");process.exit(1);}
const snip=`
    # merged tickets clean themselves: background sweep of this repo on every start (log: ~/.claude/logs/sweep.log)
    ( bash ~/.claude/tools/cc-sweep.sh --quiet >/dev/null 2>&1 & )
`;
s=s.replace(anchor, snip+anchor); fs.writeFileSync(p,s); console.log("  \u001b[32m✓\u001b[0m wrapper: cc-sweep in the background on every claude start (backup .zshrc.bak-"+process.argv[2]+")");' "$ZSHRC" "$TS"
echo; echo "  source ~/.zshrc · dry run now:  cd ~/development/conv-ai-settings && bash ~/.claude/tools/cc-sweep.sh --dry-run"
