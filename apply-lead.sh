#!/usr/bin/env bash
# Makes `lead` (agents/lead.md) the primary agent of every session: settings.json "agent": "lead" (documented key,
# applies to the terminal wrapper and to VS Code alike). `claude @solo` starts with agents/solo.md instead (all tools).
# Usage: bash ~/.claude-work/apply-lead.sh && source ~/.zshrc
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; ENVF="$DST/aircall-gateway.env"; ZSHRC="$HOME/.zshrc"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$SRC/agents/lead.md" "$DST/agents/lead.md"; cp "$SRC/agents/solo.md" "$DST/agents/solo.md"
ok "agents/lead.md (primary: coordinates, no Edit/Write) · agents/solo.md (primary with all tools)"
cp "$SRC/tools/gen-effort-variants.mjs" "$DST/tools/gen-effort-variants.mjs"; "$NODE" "$DST/tools/gen-effort-variants.mjs" >/dev/null; rm -f "$DST"/agents/lead--*.md "$DST"/agents/solo--*.md; ok "effort variants regenerated (none for lead / solo)"
cp "$DST/settings.json" "$DST/settings.json.bak-$TS"
"$NODE" -e 'const fs=require("fs"),p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,"utf8"));d.agent="lead";fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");' "$DST/settings.json"
ok "settings.json: \"agent\": \"lead\" (backup settings.json.bak-$TS)"
[ -f "$ENVF" ] && grep -q '^export CLAUDE_CODE_AGENT=' "$ENVF" && { cp "$ENVF" "$ENVF.bak-$TS"; grep -v '^export CLAUDE_CODE_AGENT=' "$ENVF.bak-$TS" > "$ENVF"; ok "removed CLAUDE_CODE_AGENT from aircall-gateway.env (settings.json wins)"; } || true
cp "$ZSHRC" "$ZSHRC.bak-$TS"
SNIP="$(mktemp)"; cat > "$SNIP" <<'EOS'
    if [ "$1" = "@solo" ]; then shift; set -- --agent solo "$@"; echo "→ primary agent: solo (all tools)"; fi
EOS
"$NODE" -e '
const fs=require("fs"),p=process.argv[1],snip=fs.readFileSync(process.argv[2],"utf8");let s=fs.readFileSync(p,"utf8");
s=s.split("\n").filter(l=>!(l.includes("\"@solo\"")||l.startsWith("#   claude @solo"))).join("\n"); // drop any previous @solo line
const anchor="\n    if [ \"${1:0:1}\" = \"@\" ]; then\n";
if(!s.includes(anchor)){console.log("  ! model-picker line not found in claude()");process.exit(1);}
s=s.replace(anchor,"\n"+snip+anchor.slice(1));
s=s.replace("#   claude @gpt-6-sol any gateway model id","#   claude @solo                    primary agent solo (all tools, can edit files itself)\n#   claude @gpt-6-sol any gateway model id");
fs.writeFileSync(p,s); console.log("  \u001b[32m✓\u001b[0m claude @solo → --agent solo (backup .zshrc.bak-"+process.argv[3]+")");' "$ZSHRC" "$SNIP" "$TS"
rm -f "$SNIP"
echo; echo "  Now: source ~/.zshrc && claude   → the session starts as lead (check with /agents or by asking it to edit a file: it must delegate)."
