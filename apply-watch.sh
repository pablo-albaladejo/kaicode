#!/usr/bin/env bash
# claude @watch [@ticket T] [args]: tmux layout with the session on the left and one pane per live subagent on the
# right (cc-tail --panes), plus the /ship status. (Native agent teams are deliberately not used: they bypass the router.)
# Usage: bash ~/.claude-work/apply-watch.sh   then   source ~/.zshrc
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; ZSHRC="$HOME/.zshrc"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$SRC/tools/cc-tail.mjs" "$DST/tools/cc-tail.mjs"; cp "$SRC/tools/cc-watch.sh" "$DST/tools/cc-watch.sh"; chmod +x "$DST/tools/cc-watch.sh"; ok "tools/cc-tail.mjs (--panes, --only) · tools/cc-watch.sh"
# Router hook: Jev 2.5s max, hook timeout 20s. A hook killed by Claude Code (timeout) = launch goes out unrouted as `task`,
# with no line in logs/model-router.jsonl — that is the "ROUTER FALLBACK" signature.
cp "$SRC/hooks/model-router.mjs" "$DST/hooks/model-router.mjs"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; const d=JSON.parse(fs.readFileSync(p,"utf8")); let n=0,found=0;
for(const g of (d.hooks?.PreToolUse||[])) for(const h of (g.hooks||[])) if(h.command&&h.command.includes("model-router.mjs")){found++; if(!h.timeout||h.timeout<20){h.timeout=20;n++;}}
if(!found) console.log("  ! no PreToolUse hook running model-router.mjs in settings.json → every launch is unrouted; re-run apply-variants-v2.sh");
else { if(n) fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n"); console.log("  \u001b[32m✓\u001b[0m router hook: timeout 20s ("+found+" entr"+(found>1?"ies":"y")+(n?", updated":", already")+") · Jev cap 2.5s"); }' "$DST/settings.json"
cp "$ZSHRC" "$ZSHRC.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; let s=fs.readFileSync(p,"utf8");
if(!s.includes("# >>> claude-gateway >>>")){console.log("  ! claude() wrapper not found in ~/.zshrc");process.exit(1);}
if(s.includes("@team")){ s=s.split("\n").filter(l=>!l.includes("@team")).join("\n"); fs.writeFileSync(p,s); console.log("  \u001b[32m✓\u001b[0m removed @team from the wrapper"); }
if(s.includes("@watch")){console.log("  \u001b[32m✓\u001b[0m @watch already in the wrapper");process.exit(0);}
const anchor="\n    if [ \"$1\" = \"@ticket\" ]; then\n";
if(!s.includes(anchor)){console.log("  ! @ticket block not found; run apply-worktree-guard.sh first");process.exit(1);}
const snip=`
    # @watch: tmux layout (session | one pane per live subagent + /ship status)
    if [ "$1" = "@watch" ]; then shift; exec bash ~/.claude/tools/cc-watch.sh "$PWD" "$@"; fi
`;
s=s.replace(anchor, snip+anchor); fs.writeFileSync(p,s);
console.log("  \u001b[32m✓\u001b[0m wrapper: claude @watch (backup .zshrc.bak-"+process.argv[2]+")");' "$ZSHRC" "$TS"
echo; echo "  source ~/.zshrc · then:  claude @watch            (inside a ticket worktree)"
