#!/usr/bin/env bash
# Installs the debug PreToolUse hook that logs every subagent launch (Agent/Task tool).
set -euo pipefail
DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "node not found in PATH"; exit 1; }
mkdir -p "$DST/hooks"
cp "$HOME/.claude-work/hooks/log-agent-launch.mjs" "$DST/hooks/log-agent-launch.mjs"
cp "$DST/settings.json" "$DST/settings.json.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1],d=JSON.parse(fs.readFileSync(p,"utf8"));
const cmd=process.argv[2]+" "+process.env.HOME+"/.claude/hooks/log-agent-launch.mjs";
d.hooks??={}; d.hooks.PreToolUse??=[];
if(!JSON.stringify(d.hooks.PreToolUse).includes("log-agent-launch.mjs"))
  d.hooks.PreToolUse.push({matcher:"Agent|Task",hooks:[{type:"command",command:cmd,timeout:5}]});
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log(JSON.stringify(d.hooks.PreToolUse,null,2));' "$DST/settings.json" "$NODE"
echo "Installed (backup: settings.json.bak-$TS). Restart aircode, launch a subagent, then run:"
echo "  node ~/.claude/hooks/log-agent-launch.mjs --tail"
