#!/usr/bin/env bash
# Read shunt (after Spotify's shunt plugin, without Portal): agents on expensive models (pro/sol/opus variants) may
# not Read files > 350 lines whole; the read-shunt hook denies it and points them to tools/bulk-read.mjs, which sends
# the files to a cheap model through the Aircall gateway and returns cited bullets (~90% fewer tokens on big reads).
# Usage: bash ~/.claude-work/apply-shunt.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$SRC/hooks/read-shunt.mjs" "$DST/hooks/read-shunt.mjs";                   ok "hooks/read-shunt.mjs (PreToolUse Read)"
cp "$SRC/tools/bulk-read.mjs" "$DST/tools/bulk-read.mjs";                     ok "tools/bulk-read.mjs (cheap reader via gateway)"
mkdir -p "$DST/skills/bulk-read"; cp "$SRC/bulk-read.SKILL.md" "$DST/skills/bulk-read/SKILL.md"; ok "skills/bulk-read"
for a in investigator planner reviewer; do cp "$SRC/agents/$a.md" "$DST/agents/$a.md"; done; ok "agents investigator · planner · reviewer: 'Reading cheaply' section"
cp "$SRC/tools/cc-cost.mjs" "$DST/tools/cc-cost.mjs";                         ok "tools/cc-cost.mjs (bulk-read rows per session)"
cp "$DST/settings.json" "$DST/settings.json.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1],node=process.argv[2],home=process.env.HOME;
const d=JSON.parse(fs.readFileSync(p,"utf8")); d.hooks??={}; d.hooks.PreToolUse??=[];
if(!JSON.stringify(d.hooks.PreToolUse).includes("read-shunt.mjs"))
  d.hooks.PreToolUse.push({matcher:"Read",hooks:[{type:"command",command:`${node} ${home}/.claude/hooks/read-shunt.mjs`,timeout:5}]});
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("  \u001b[32m✓\u001b[0m settings.json: PreToolUse(Read) → read-shunt (backup .bak-"+process.argv[3]+")");' "$DST/settings.json" "$NODE" "$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; const d=JSON.parse(fs.readFileSync(p,"utf8"));
d.shuntMode??="on"; d.shuntMinLines??=350; d.shuntAliases??=["pro","sol","opus"]; d.shuntModel??="fireworks/deepseek-v4.1-flash";
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n"); console.log("  \u001b[32m✓\u001b[0m router.json: shuntMode on · shuntMinLines 350 · shuntAliases pro,sol,opus · shuntModel "+d.shuntModel);' "$DST/router.json"
"$NODE" "$DST/tools/gen-effort-variants.mjs" --clean >/dev/null; "$NODE" "$DST/tools/gen-effort-variants.mjs" | tail -1 | sed 's/^/  ✓ /'
rm -f "$DST"/agents/task--*.md "$DST"/agents/lead--*.md "$DST"/agents/solo--*.md
echo
echo "  Try it now (no session needed): node ~/.claude/tools/bulk-read.mjs \"what does this file export\" ~/.claude/tools/cc-cost.mjs"
echo "  Reports: node ~/.claude/hooks/read-shunt.mjs --report · cc-cost shows a bulk-read row per session"
echo "  Off: \"shuntMode\": \"off\" in ~/.claude/router.json (no restart). Restart claude for the agent prompts."
