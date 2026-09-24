#!/usr/bin/env bash
# Copia la configuración del brief (agentes, hook, OpenSpec, CLAUDE.md) de ~/.claude-work a ~/.claude
# sin borrar nada de lo existente. Uso: bash ~/.claude-work/install-to-claude.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DST/agents" "$DST/hooks" "$DST/commands/opsx" "$DST/logs"

# 1. Agentes, hook y comandos de OpenSpec (no sobrescribe si ya existen)
for f in "$SRC"/agents/*.md "$SRC"/hooks/*.sh "$SRC"/commands/opsx/*.md; do
  rel="${f#$SRC/}"
  if [ -e "$DST/$rel" ]; then echo "YA EXISTE (no tocado): $DST/$rel"; else cp "$f" "$DST/$rel"; echo "copiado: $rel"; fi
done
chmod +x "$DST/hooks/log-subagent.sh"

# 2. CLAUDE.md: añade el bloque al final si no está
touch "$DST/CLAUDE.md"
if grep -q "## Coste y delegación" "$DST/CLAUDE.md"; then echo "CLAUDE.md ya tiene el bloque"
else cp "$DST/CLAUDE.md" "$DST/CLAUDE.md.bak-$TS"; printf '\n' >> "$DST/CLAUDE.md"; sed '1{/^# /d;}' "$SRC/CLAUDE.md" >> "$DST/CLAUDE.md"; echo "CLAUDE.md actualizado (backup .bak-$TS)"; fi

# 3. settings.json: fusiona hook SubagentStop y permiso de openspec
[ -f "$DST/settings.json" ] || echo '{}' > "$DST/settings.json"
cp "$DST/settings.json" "$DST/settings.json.bak-$TS"
node -e '
const fs=require("fs"),p=process.argv[1],d=JSON.parse(fs.readFileSync(p,"utf8"));
const cmd="bash "+process.env.HOME+"/.claude/hooks/log-subagent.sh";
d.hooks??={}; d.hooks.SubagentStop??=[];
if(!JSON.stringify(d.hooks.SubagentStop).includes("log-subagent.sh"))
  d.hooks.SubagentStop.push({hooks:[{type:"command",command:cmd,timeout:5}]});
d.permissions??={}; d.permissions.allow??=[];
if(!d.permissions.allow.includes("Bash(openspec:*)")) d.permissions.allow.push("Bash(openspec:*)");
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");' "$DST/settings.json"
echo "settings.json fusionado (backup .bak-$TS)"

# 4. Comprobaciones
grep -l "CLAUDE_CODE_SUBAGENT_MODEL_FORCE" "$DST"/settings*.json 2>/dev/null && echo "AVISO: _FORCE activo, anula el enrutado por rol" || echo "OK: sin CLAUDE_CODE_SUBAGENT_MODEL_FORCE"
grep -l "CLAUDE_CODE_SUBAGENT_MODEL\"" "$DST"/settings*.json 2>/dev/null && echo "AVISO: CLAUDE_CODE_SUBAGENT_MODEL fijado; puede pisar el enrutado de aircode" || true
echo "Listo. Reinicia aircode y comprueba /agents, /hooks y /opsx:"
