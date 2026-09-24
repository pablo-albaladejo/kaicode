#!/usr/bin/env bash
# Installs the model-router PreToolUse hook (Agent|Task) in SHADOW mode.
set -euo pipefail
DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "node not found in PATH"; exit 1; }
mkdir -p "$DST/hooks"
cp "$HOME/.claude-work/hooks/model-router.mjs" "$DST/hooks/model-router.mjs"
[ -f "$DST/router.json" ] || cp "$HOME/.claude-work/router.json" "$DST/router.json"
cp "$DST/settings.json" "$DST/settings.json.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1],d=JSON.parse(fs.readFileSync(p,"utf8"));
const cmd=process.argv[2]+" "+process.env.HOME+"/.claude/hooks/model-router.mjs";
d.hooks??={}; d.hooks.PreToolUse??=[];
if(!JSON.stringify(d.hooks.PreToolUse).includes("model-router.mjs"))
  d.hooks.PreToolUse.push({matcher:"Agent|Task",hooks:[{type:"command",command:cmd,timeout:5}]});
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");' "$DST/settings.json" "$NODE"
echo "model-router installed in mode: $(grep -o '"mode": *"[a-z]*"' "$DST/router.json")  (backup: settings.json.bak-$TS)"
echo "Report:  node ~/.claude/hooks/model-router.mjs --report"
