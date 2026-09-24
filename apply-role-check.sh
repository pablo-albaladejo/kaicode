#!/usr/bin/env bash
# Installs the router's role check with enforce on: when Jev's use case implies another of your roles than the lead
# chose, the launch is rewritten to that role (e.g. Explore → investigator for a glab lookup).
# Usage: bash ~/.claude-work/apply-role-check.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$DST/hooks/model-router.mjs" "$DST/hooks/model-router.mjs.bak-$TS"
cp "$SRC/hooks/model-router.mjs" "$DST/hooks/model-router.mjs"; ok "hooks/model-router.mjs (role check)"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; const d=JSON.parse(fs.readFileSync(p,"utf8"));
d.roleMode="enforce"; fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("  \u001b[32m✓\u001b[0m router.json: roleMode enforce (mode "+d.mode+", classifier "+d.classifier+", effortMode "+d.effortMode+")");' "$DST/router.json"
echo; echo "  Roles (override in router.json \"roles\"): Explore ← explore, explain · investigator ← status, debug · planner ← plan, architecture"
echo "         implementer ← implement, bugfix, refactor, tests, migration, cicd, docs · reviewer ← review, security"
echo "  Watch:  node ~/.claude/hooks/model-router.mjs --report   (line \"Role: …\")"
