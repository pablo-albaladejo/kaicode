#!/usr/bin/env bash
# Installs two Jev-backed hooks for plain `claude` sessions (aircode sessions are skipped automatically):
#   intent-router (UserPromptSubmit): intent + skill for each user message → injected as routing context
#   bash-guard    (PreToolUse Bash):  risky commands classified read/write/destructive; destructive → denied
# Usage: bash ~/.claude-work/apply-intent.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$SRC/hooks/intent-router.mjs" "$DST/hooks/intent-router.mjs"; cp "$SRC/hooks/bash-guard.mjs" "$DST/hooks/bash-guard.mjs"; ok "hooks/intent-router.mjs · hooks/bash-guard.mjs"
cp "$DST/settings.json" "$DST/settings.json.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1],node=process.argv[2],home=process.env.HOME;
const d=JSON.parse(fs.readFileSync(p,"utf8")); d.hooks??={};
d.hooks.UserPromptSubmit??=[];
if(!JSON.stringify(d.hooks.UserPromptSubmit).includes("intent-router.mjs"))
  d.hooks.UserPromptSubmit.push({hooks:[{type:"command",command:`${node} ${home}/.claude/hooks/intent-router.mjs`,timeout:8}]});
d.hooks.PreToolUse??=[];
if(!JSON.stringify(d.hooks.PreToolUse).includes("bash-guard.mjs"))
  d.hooks.PreToolUse.push({matcher:"Bash",hooks:[{type:"command",command:`${node} ${home}/.claude/hooks/bash-guard.mjs`,timeout:8}]});
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("  \u001b[32m✓\u001b[0m settings.json: UserPromptSubmit → intent-router · PreToolUse(Bash) → bash-guard (backup .bak-"+process.argv[3]+")");' "$DST/settings.json" "$NODE" "$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; const d=JSON.parse(fs.readFileSync(p,"utf8"));
d.intentMode??="on"; d.intentMinConfidence??=0.5; d.bashGuardMode??="on"; d.bashGuardMinConfidence??=0.6;
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n"); console.log("  \u001b[32m✓\u001b[0m router.json: intentMode on · bashGuardMode on");' "$DST/router.json"
echo; echo "  Reports:  node ~/.claude/hooks/intent-router.mjs --report     node ~/.claude/hooks/bash-guard.mjs --report"
echo "  Off:      set \"intentMode\": \"off\" / \"bashGuardMode\": \"off\" in ~/.claude/router.json (no restart needed)"
