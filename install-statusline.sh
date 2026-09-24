#!/usr/bin/env bash
# Instala la status line en ~/.claude (copia statusline.mjs y fusiona statusLine en settings.json).
set -euo pipefail
DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "No encuentro node en el PATH"; exit 1; }
cp "$HOME/.claude-work/statusline.mjs" "$DST/statusline.mjs"
[ -f "$DST/settings.json" ] || echo '{}' > "$DST/settings.json"
cp "$DST/settings.json" "$DST/settings.json.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1],d=JSON.parse(fs.readFileSync(p,"utf8"));
if(d.statusLine) console.log("statusLine anterior (guardado en el backup):", JSON.stringify(d.statusLine));
d.statusLine={type:"command",command:process.argv[2]+" "+process.env.HOME+"/.claude/statusline.mjs",padding:0};
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");' "$DST/settings.json" "$NODE"
echo "Status line instalada (backup settings.json.bak-$TS). Reinicia aircode."
