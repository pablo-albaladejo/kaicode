#!/usr/bin/env bash
# Applies the state-of-the-art review actions:
#   1. settings.json: effort per model (modelSettings) + deny list of irreversible commands
#   2. agents: Explore, investigator, implementer rewritten; planner added; reviewer effort moved to modelSettings
#   3. CLAUDE.md rewritten (delegation table, git workflow, gateway rules)
#   4. mr-post dedupe, .worktreeinclude support in cc-ticket / mr-checkout, gateway smoke test
#   5. effort per launch: generated <agent>--<effort> variants + router effortMode "variant"
# Safe to re-run. Usage: bash ~/.claude-work/apply-sota.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "✗ node not found"; exit 1; }
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }; step(){ printf '\n\033[36m▸ %s\033[0m\n' "$*"; }
mkdir -p "$DST/agents" "$DST/tools" "$DST/backups"

step "settings.json"
cp "$DST/settings.json" "$DST/settings.json.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; const d=JSON.parse(fs.readFileSync(p,"utf8"));
// Effort per model (documented key). Subagents without an effort in their frontmatter inherit it;
// with the router in enforce, the model chosen from the table brings its effort with it.
d.modelSettings={...(d.modelSettings||{}),
  "fireworks/deepseek-v4.1-flash":{effortLevel:"high"},   // cheap output: high costs little and helps tool use
  "gpt-6-luna":{effortLevel:"low"},
  "fireworks/deepseek-v4-pro":{effortLevel:"medium"},
  "gpt-6-sol":{effortLevel:"high"},
  "claude-opus-5-5":{effortLevel:"high"},
  "fireworks/kimi-k3":{effortLevel:"high"}};
// Hard guarantees (deny is evaluated first; aws-vault with prod profiles stays allowed on purpose)
d.permissions??={}; const deny=new Set(d.permissions.deny||[]);
for (const r of ["Bash(git push --force*)","Bash(git push -f*)","Bash(git push * --force*)","Bash(git push * -f*)",
  "Bash(git branch -D *)","Bash(git checkout main)","Bash(git switch main)","Bash(rm -rf /*)","Bash(rm -rf ~*)","Bash(rm -rf $HOME*)",
  "Bash(glab mr approve*)","Bash(glab mr merge*)","Bash(glab mr close*)","Bash(glab mr update*)"]) deny.add(r);
d.permissions.deny=[...deny];
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("  \u001b[32m✓\u001b[0m modelSettings (effort per model) + "+d.permissions.deny.length+" deny rules (backup settings.json.bak-"+process.argv[2]+")");' "$DST/settings.json" "$TS"

step "Agents"
for a in Explore investigator implementer planner reviewer; do
  [ -f "$DST/agents/$a.md" ] && cp "$DST/agents/$a.md" "$DST/backups/$a.md.bak-$TS"
  cp "$SRC/agents/$a.md" "$DST/agents/$a.md"
done
ok "Explore (maxTurns 25, fixed output) · investigator (lookup / root-cause script) · implementer (TDD, summary-only, docs mode)"
ok "planner (new: plan / OpenSpec proposal / ADR, read-only, gpt-6-sol) · reviewer (effort now from modelSettings)"

step "CLAUDE.md"
cp "$DST/CLAUDE.md" "$DST/backups/CLAUDE.md.bak-$TS" 2>/dev/null || true
cp "$SRC/CLAUDE.md" "$DST/CLAUDE.md"; ok "CLAUDE.md rewritten ($(wc -l < "$DST/CLAUDE.md") lines; backup in backups/)"

step "Tools"
cp "$SRC/tools/mr-post.mjs" "$DST/tools/mr-post.mjs";            ok "mr-post.mjs: re-runs skip findings already posted (hidden marker)"
cp "$SRC/tools/cc-ticket.sh" "$DST/tools/cc-ticket.sh";          ok "cc-ticket.sh: copies files listed in <repo>/.worktreeinclude (.env etc.) into new worktrees"
cp "$SRC/tools/mr-checkout.sh" "$DST/tools/mr-checkout.sh";      ok "mr-checkout.sh: same"
cp "$SRC/tools/gateway-smoke.sh" "$DST/tools/gateway-smoke.sh"; chmod +x "$DST/tools/"*.sh; ok "gateway-smoke.sh"

step "Effort per launch: agent variants + router"
cp "$SRC/hooks/model-router.mjs" "$DST/hooks/model-router.mjs";        ok "model-router.mjs (effortMode variant: swaps subagent_type to <agent>--<effort>)"
cp "$SRC/tools/gen-effort-variants.mjs" "$DST/tools/gen-effort-variants.mjs"
"$NODE" "$DST/tools/gen-effort-variants.mjs" | tail -1 | sed 's/^/  ✓ /'
cp "$SRC/tools/cc-cost.mjs" "$DST/tools/cc-cost.mjs"; cp "$SRC/statusline.mjs" "$DST/statusline.mjs"; ok "cc-cost + statusline report variants under their base agent"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; let d={}; try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}
d.effortMode="variant"; fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n"); console.log("  \u001b[32m✓\u001b[0m router.json: effortMode variant (mode "+(d.mode||"shadow")+", classifier "+(d.classifier||"both")+")");' "$DST/router.json"

echo; echo "  Next:  bash ~/.claude/tools/gateway-smoke.sh            (tool round-trip + cache through the gateway)"
echo "         bash ~/.claude/tools/gateway-smoke.sh gpt-6-sol  (same for another model)"
echo "  Optional, for whoever manages the gateway org settings (managed settings only): modelPricing → see pricing.json"
