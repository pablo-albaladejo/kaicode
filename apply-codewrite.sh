#!/usr/bin/env bash
# code-write (second half of the shunt idea): implementer variants on pro/sol can have a cheap model write mechanical
# files (fixtures, table tests, migrations, types, mirrored modules) straight to disk from a spec + reference files.
# Guard rails: refuses on main, no overwrite without --overwrite, bash-guard denies it to every other agent.
# Usage: bash ~/.claude-work/apply-codewrite.sh   (run apply-shunt.sh first)
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$SRC/tools/code-write.mjs" "$DST/tools/code-write.mjs";                   ok "tools/code-write.mjs"
cp "$SRC/hooks/bash-guard.mjs" "$DST/hooks/bash-guard.mjs";                   ok "hooks/bash-guard.mjs (code-write only for implementer--pro|sol-*)"
mkdir -p "$DST/skills/code-write"; cp "$SRC/code-write.SKILL.md" "$DST/skills/code-write/SKILL.md"; ok "skills/code-write"
cp "$SRC/agents/implementer.md" "$DST/agents/implementer.md";                 ok "agents/implementer.md ('Generating mechanical code cheaply')"
cp "$SRC/tools/cc-cost.mjs" "$DST/tools/cc-cost.mjs";                         ok "tools/cc-cost.mjs (code-write rows per session)"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; const d=JSON.parse(fs.readFileSync(p,"utf8"));
d.codeWriteAgents??="^implementer--(pro|sol)-"; d.codeWriteMaxChars??=600000;
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n"); console.log("  \u001b[32m✓\u001b[0m router.json: codeWriteAgents "+d.codeWriteAgents);' "$DST/router.json"
"$NODE" "$DST/tools/gen-effort-variants.mjs" --clean >/dev/null; "$NODE" "$DST/tools/gen-effort-variants.mjs" | tail -1 | sed 's/^/  ✓ /'
rm -f "$DST"/agents/task--*.md "$DST"/agents/lead--*.md "$DST"/agents/solo--*.md
echo; echo "  Report: node ~/.claude/tools/code-write.mjs --report   (kept vs edited afterwards = does delegating pay off)"
echo "  Restart claude for the implementer prompt."
