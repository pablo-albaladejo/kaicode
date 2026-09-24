#!/usr/bin/env bash
# Installs the generic "task" entry point: the lead launches `task` with a brief and the router assigns the role
# (from Jev's use case), the model and the effort. Also installs the role check (enforce) and the updated lead/CLAUDE.md.
# Usage: bash ~/.claude-work/apply-task.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
mkdir -p "$DST/backups"
cp "$DST/hooks/model-router.mjs" "$DST/hooks/model-router.mjs.bak-$TS"; cp "$SRC/hooks/model-router.mjs" "$DST/hooks/model-router.mjs"; ok "hooks/model-router.mjs (placeholder task, role check)"
for a in task lead; do [ -f "$DST/agents/$a.md" ] && cp "$DST/agents/$a.md" "$DST/backups/$a.md.bak-$TS"; cp "$SRC/agents/$a.md" "$DST/agents/$a.md"; done; ok "agents/task.md (entry point) · agents/lead.md (launches task, brief-first)"
cp "$DST/CLAUDE.md" "$DST/backups/CLAUDE.md.bak-$TS"; cp "$SRC/CLAUDE.md" "$DST/CLAUDE.md"; ok "CLAUDE.md"
cp "$SRC/tools/gen-effort-variants.mjs" "$DST/tools/gen-effort-variants.mjs"; "$NODE" "$DST/tools/gen-effort-variants.mjs" >/dev/null; rm -f "$DST"/agents/task--*.md "$DST"/agents/lead--*.md "$DST"/agents/solo--*.md; ok "effort variants regenerated (none for task / lead / solo)"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; const d=JSON.parse(fs.readFileSync(p,"utf8"));
d.roleMode="enforce"; d.placeholder="task"; fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("  \u001b[32m✓\u001b[0m router.json: placeholder task, roleMode enforce (mode "+d.mode+", classifier "+d.classifier+")");' "$DST/router.json"
echo; echo "  Test in a new claude session: ask for something; the lead should launch task and the log should show the assigned role:"
echo "        tail -1 ~/.claude/logs/model-router.jsonl | node -e 'const r=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));console.log(r.subagent,\"→\",r.subagent_final,r.use_case+\"/\"+r.complexity,r.decision,r.effort)'"
