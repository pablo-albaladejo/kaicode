#!/usr/bin/env bash
# Switch worktrees inside a session: the claude wrapper adds --add-dir <repo>-worktrees so the lead can `cd` to a sibling
# ticket worktree; /ticket <T> creates/reuses it and moves the session there; lead rule 8 forbids remote `git -C` work.
# Usage: bash ~/.claude-work/apply-switch.sh   then   source ~/.zshrc
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; ZSHRC="$HOME/.zshrc"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$SRC/tools/cc-wtbase.sh" "$DST/tools/cc-wtbase.sh"; chmod +x "$DST/tools/cc-wtbase.sh"; ok "tools/cc-wtbase.sh"
mkdir -p "$DST/commands"; cp "$SRC/commands/ticket.md" "$DST/commands/ticket.md";   ok "commands/ticket.md  (/ticket <T> [slug])"
cp "$SRC/agents/lead.md" "$DST/agents/lead.md"; cp "$SRC/CLAUDE.md" "$DST/CLAUDE.md"; ok "agents/lead.md (rule 8: switch the session, never git -C) · CLAUDE.md"
cp "$ZSHRC" "$ZSHRC.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; let s=fs.readFileSync(p,"utf8");
if(!s.includes("# >>> claude-gateway >>>")){console.log("  ! claude() wrapper not found in ~/.zshrc");process.exit(1);}
if(s.includes("cc-wtbase.sh")){console.log("  \u001b[32m✓\u001b[0m wrapper already adds --add-dir (worktrees)");process.exit(0);}
const anchor="    command claude \"$@\"\n";
if(!s.includes(anchor)){console.log("  ! could not find `command claude \"$@\"` in the wrapper");process.exit(1);}
const snip=`    # sibling ticket worktrees reachable from any session (/ticket switches the cwd there)
    local wtb; wtb="$(bash ~/.claude/tools/cc-wtbase.sh 2>/dev/null)"; [ -n "$wtb" ] && set -- --add-dir "$wtb" "$@"
`;
s=s.replace(anchor,snip+anchor); fs.writeFileSync(p,s);
console.log("  \u001b[32m✓\u001b[0m wrapper: --add-dir <repo>-worktrees (backup .zshrc.bak-"+process.argv[2]+")");' "$ZSHRC" "$TS"
echo; echo "  Now:  source ~/.zshrc   · in a session:  /ticket APR-7556   → HUD shows wt:APR-7556"
