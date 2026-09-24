#!/usr/bin/env bash
# Replaces the Spanish config in ~/.claude with the English versions from ~/.claude-work.
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
BK="$DST/backup-es-$TS"; mkdir -p "$BK/agents" "$BK/hooks"
for f in agents/Explore.md agents/implementer.md agents/reviewer.md hooks/log-subagent.sh statusline.mjs CLAUDE.md; do
  [ -e "$DST/$f" ] && cp "$DST/$f" "$BK/$f"
done
cp "$SRC"/agents/{Explore,implementer,reviewer}.md "$DST/agents/"
cp "$SRC/hooks/log-subagent.sh" "$DST/hooks/" && chmod +x "$DST/hooks/log-subagent.sh"
[ -e "$DST/statusline.mjs" ] && cp "$SRC/statusline.mjs" "$DST/statusline.mjs"
node -e '
const fs=require("fs"),[p,enPath]=process.argv.slice(1);
let t=fs.readFileSync(p,"utf8");const en=fs.readFileSync(enPath,"utf8").trim();
const ours=["## Coste y delegación","## OpenSpec","## GitLab y Jira","## Cost and delegation","## GitLab and Jira"];
const lines=t.split("\n");const out=[];let skip=false;
for(const l of lines){ if(l.startsWith("## ")) skip=ours.includes(l.trim()); if(!skip) out.push(l); }
t=out.join("\n").replace(/\n{3,}$/,"\n").trimEnd()+"\n\n"+en+"\n";
fs.writeFileSync(p,t);' "$DST/CLAUDE.md" "$SRC/CLAUDE.en.md"
echo "Done. Backup of the previous files: $BK"
grep -n "^## " "$DST/CLAUDE.md"
