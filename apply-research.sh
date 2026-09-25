#!/usr/bin/env bash
# Web research as a routed use case: `research:` briefs → investigator on a model with native web search (alias "web").
# Also: lead writes shared artefacts in English and never edits Jira descriptions (comments only).
# Usage: bash ~/.claude-work/apply-research.sh [gateway-model-id-with-web-search]
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; NODE="$(command -v node)"; TS=$(date +%Y%m%d-%H%M%S); ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$DST/hooks/model-router.mjs" "$DST/hooks/model-router.mjs.bak-$TS"; cp "$SRC/hooks/model-router.mjs" "$DST/hooks/model-router.mjs"; ok "hooks/model-router.mjs (use case research → alias web · prefix research:)"
for a in lead investigator; do cp "$SRC/agents/$a.md" "$DST/agents/$a.md"; done; ok "agents: investigator (Research mode, WebSearch/WebFetch) · lead (English artefacts, no Jira description edits, research: briefs)"
if [ -n "${1:-}" ]; then "$NODE" -e '
const fs=require("fs"),p=process.argv[1],m=process.argv[2]; const d=JSON.parse(fs.readFileSync(p,"utf8")); d.models??={}; d.models.web=m; fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n"); console.log("  \u001b[32m✓\u001b[0m router.json models.web = "+m);' "$DST/router.json" "$1"
else echo "  • models.web = gpt-6-luna (\$0.10/\$0.50 + \$0.01 per search; webSearch:true in the gateway catalogue). Others with search: gpt-6-sol, gemini-3.x-flash*, claude-*. Override: bash apply-research.sh <model-id>"; fi
"$NODE" "$DST/tools/gen-effort-variants.mjs" --clean >/dev/null; "$NODE" "$DST/tools/gen-effort-variants.mjs" | tail -1 | sed 's/^/  ✓ /'
rm -f "$DST"/agents/task--*.md "$DST"/agents/lead--*.md "$DST"/agents/solo--*.md
echo; echo "  Try:  research: what flags does 'acli jira workitem edit' accept for an ADF description? quote the docs."
