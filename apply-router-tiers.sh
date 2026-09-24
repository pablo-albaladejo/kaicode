#!/usr/bin/env bash
# Upgrades the model router to three tiers (cheap / mid / strong) with the use-case table Jev chooses from.
# Keeps your router.json (mode, Jev settings); only adds the "mid" tier if missing.
# Usage: bash ~/.claude-work/apply-router-tiers.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "✗ node not found"; exit 1; }
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }

cp "$DST/hooks/model-router.mjs" "$DST/hooks/model-router.mjs.bak-$TS" 2>/dev/null || true
cp "$SRC/hooks/model-router.mjs" "$DST/hooks/model-router.mjs"; ok "hooks/model-router.mjs (3 tiers, --criteria, use cases → Jev)"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1];
let d={}; try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}
const t={cheap:"fireworks/deepseek-v4.1-flash",mid:"gpt-6-sol",strong:"fireworks/kimi-k3",...(d.tiers||{})};
d.tiers={cheap:t.cheap,mid:t.mid,strong:t.strong};
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("  \u001b[32m✓\u001b[0m router.json tiers → "+JSON.stringify(d.tiers)+" (mode "+(d.mode||"shadow")+")");' "$DST/router.json"
echo; "$NODE" "$DST/hooks/model-router.mjs" --criteria
