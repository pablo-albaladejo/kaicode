#!/usr/bin/env bash
# Phase 1 of the agentic SDLC: /ship <TICKET> — the resumable ticket loop with on-disk state and hard gates.
#   commands/ship.md · tools/ship-state.mjs · hooks/ship-gates.mjs (SubagentStop implementer, PreToolUse Bash)
#   agent contracts (investigator understand:, planner Risk/Files/Covers, reviewer review plan:) · templates/mr.md
#   ~/.claude/knowledge/ (index, lessons, process, relations) · cc-cost --ticket · statusline ship:<stage>
# Usage: bash ~/.claude-work/apply-ship.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
mkdir -p "$DST/commands" "$DST/tools" "$DST/hooks" "$DST/templates" "$DST/knowledge"
cp "$SRC/commands/ship.md" "$DST/commands/ship.md";                 ok "commands/ship.md"
cp "$SRC/tools/ship-state.mjs" "$DST/tools/ship-state.mjs"; cp "$SRC/tools/ship-inventory.sh" "$DST/tools/ship-inventory.sh"; ok "tools/ship-state.mjs · tools/ship-inventory.sh"
cp "$SRC/hooks/ship-gates.mjs" "$DST/hooks/ship-gates.mjs";         ok "hooks/ship-gates.mjs"
cp "$SRC/hooks/log-subagent.mjs" "$DST/hooks/log-subagent.mjs";     ok "hooks/log-subagent.mjs (duration + model per finished subagent → HUD ETAs)"
cp "$SRC/templates/mr.md" "$DST/templates/mr.md";                   ok "templates/mr.md"
for f in index lessons process relations; do [ -f "$DST/knowledge/$f.md" ] || cp "$SRC/knowledge/$f.md" "$DST/knowledge/$f.md"; done; ok "knowledge/ (index · lessons · process · relations; existing files kept)"
for a in investigator planner reviewer; do cp "$SRC/agents/$a.md" "$DST/agents/$a.md"; done; ok "agents: investigator understand: · planner Risk/Files/Covers · reviewer review plan:"
cp "$DST/hooks/model-router.mjs" "$DST/hooks/model-router.mjs.bak-$TS"; cp "$SRC/hooks/model-router.mjs" "$DST/hooks/model-router.mjs"; ok "hooks/model-router.mjs (status use case also covers understand:)"
cp "$SRC/tools/cc-cost.mjs" "$DST/tools/cc-cost.mjs"; cp "$SRC/statusline.mjs" "$DST/statusline.mjs"; ok "cc-cost --ticket <T> · statusline ship:<stage>"
cp "$DST/settings.json" "$DST/settings.json.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1],node=process.argv[2],home=process.env.HOME;
const d=JSON.parse(fs.readFileSync(p,"utf8")); d.hooks??={};
d.hooks.SubagentStop??=[];
// log-subagent.sh → log-subagent.mjs (adds duration_s and model)
d.hooks.SubagentStop=d.hooks.SubagentStop.map(g=>({...g,hooks:(g.hooks||[]).map(h=>h.command&&h.command.includes("log-subagent.sh")?{...h,command:`${node} ${home}/.claude/hooks/log-subagent.mjs`,timeout:h.timeout||10}:h)}));
if(!JSON.stringify(d.hooks.SubagentStop).includes("log-subagent.mjs"))
  d.hooks.SubagentStop.push({hooks:[{type:"command",command:`${node} ${home}/.claude/hooks/log-subagent.mjs`,timeout:10}]});
if(!JSON.stringify(d.hooks.SubagentStop).includes("ship-gates.mjs"))
  d.hooks.SubagentStop.push({hooks:[{type:"command",command:`${node} ${home}/.claude/hooks/ship-gates.mjs`,timeout:10}]});
d.hooks.PreToolUse??=[];
if(!JSON.stringify(d.hooks.PreToolUse).includes("ship-gates.mjs"))
  d.hooks.PreToolUse.push({matcher:"Bash",hooks:[{type:"command",command:`${node} ${home}/.claude/hooks/ship-gates.mjs`,timeout:5}]});
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("  \u001b[32m✓\u001b[0m settings.json: SubagentStop → log-subagent.mjs + ship-gates · PreToolUse(Bash) → ship-gates (backup .bak-"+process.argv[3]+")");' "$DST/settings.json" "$NODE" "$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; const d=JSON.parse(fs.readFileSync(p,"utf8"));
d.shipBudgetUsd??=5; d.shipMaxAttempts??=2;
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n"); console.log("  \u001b[32m✓\u001b[0m router.json: shipBudgetUsd "+d.shipBudgetUsd+" · shipMaxAttempts "+d.shipMaxAttempts);' "$DST/router.json"
"$NODE" "$DST/tools/gen-effort-variants.mjs" --clean >/dev/null; "$NODE" "$DST/tools/gen-effort-variants.mjs" | tail -1 | sed 's/^/  ✓ /'
rm -f "$DST"/agents/task--*.md "$DST"/agents/lead--*.md "$DST"/agents/solo--*.md
echo
echo "  Try:   claude   →   /ship APR-7556        (resumes if state exists;  /ship APR-7556 --status)"
echo "  State: <worktree>/.claude/ship/<T>/state.json (git-excluded) · node ~/.claude/tools/ship-state.mjs list"
echo "  Restart claude for the agent prompts. Hooks apply at once."
