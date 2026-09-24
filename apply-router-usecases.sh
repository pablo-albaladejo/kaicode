#!/usr/bin/env bash
# Installs the use-case router: (use case, complexity) → model + effort, Jev with two questions.
# Keeps your router.json (mode, Jev key env, URL). Usage: bash ~/.claude-work/apply-router-usecases.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "✗ node not found"; exit 1; }
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }

cp "$DST/hooks/model-router.mjs" "$DST/hooks/model-router.mjs.bak-$TS" 2>/dev/null || true
cp "$SRC/hooks/model-router.mjs" "$DST/hooks/model-router.mjs"; ok "hooks/model-router.mjs (use cases × complexity → model · effort)"
mkdir -p "$DST/tools"; cp "$SRC/tools/jev-tune.mjs" "$DST/tools/jev-tune.mjs"; ok "tools/jev-tune.mjs (bench)"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1];
let d={}; try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}
delete d.tiers; delete d.jevState;                 // old two-tier keys, no longer used
d.mode??="shadow"; d.classifier="both"; d.effortMode??="log";
d.jevUrl??="https://api.llmgateway.io/v1/systemone"; d.jevModel??="jev-1.13.0"; d.jevKeyEnv??="JEV_LLMGATEWAY_KEY";
d.jevTimeoutMs??=4000; d.jevMinConfidence??=0.6; d.jevHighThreshold??=0.65;
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("  \u001b[32m✓\u001b[0m router.json → mode "+d.mode+", classifier both, effortMode "+d.effortMode+", P(high) ≥ "+d.jevHighThreshold);' "$DST/router.json"
echo; "$NODE" "$DST/hooks/model-router.mjs" --criteria
echo; echo "  Old two-tier log lines are ignored by --report. Next: work normally, then  node ~/.claude/hooks/model-router.mjs --report"
