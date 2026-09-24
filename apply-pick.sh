#!/usr/bin/env bash
# Adds `claude @pick`: fuzzy-search every gateway model (fzf over pricing.json) and launch claude with it.
# Usage: bash ~/.claude-work/apply-pick.sh && source ~/.zshrc
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; ZSHRC="$HOME/.zshrc"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$SRC/tools/cc-models.mjs" "$DST/tools/cc-models.mjs"; ok "tools/cc-models.mjs (--list)"
command -v fzf >/dev/null && ok "fzf found" || echo "  ! fzf not installed: brew install fzf   (@pick needs it)"
cp "$ZSHRC" "$ZSHRC.bak-$TS"
SNIP="$(mktemp)"; cat > "$SNIP" <<'EOS'
    if [ "$1" = "@pick" ]; then
      command -v fzf >/dev/null || { echo "fzf not installed (brew install fzf)"; return 1; }
      local m; m="$(node ~/.claude/tools/cc-models.mjs --list | fzf --header='model                                    in     out  cache  group  (curated | (price tier))   type to filter' --height=60% --reverse | awk '{print $1}')"
      [ -n "$m" ] || return 1; shift; set -- --model "$m" "$@"; echo "→ model $m"
    fi
EOS
"$NODE" -e '
const fs=require("fs"),p=process.argv[1],snip=fs.readFileSync(process.argv[2],"utf8");let s=fs.readFileSync(p,"utf8");
if(!s.includes("# >>> claude-gateway >>>")){console.log("  ! claude() wrapper not found — run install-gateway-models.sh first");process.exit(1);}
if(s.includes("@pick")){console.log("  \u001b[32m✓\u001b[0m claude @pick already present");process.exit(0);}
const anchor="\n    if [ \"${1:0:1}\" = \"@\" ]; then\n";
if(!s.includes(anchor)){console.log("  ! model-picker line not found in claude()");process.exit(1);}
s=s.replace(anchor,"\n"+snip+anchor.slice(1));
s=s.replace("#   claude @gpt-6-sol any gateway model id","#   claude @pick                    fuzzy-search all gateway models (fzf), then launch\n#   claude @gpt-6-sol any gateway model id");
fs.writeFileSync(p,s); console.log("  \u001b[32m✓\u001b[0m claude @pick added (backup .zshrc.bak-"+process.argv[3]+")");' "$ZSHRC" "$SNIP" "$TS"
rm -f "$SNIP"; echo; echo "  Now: source ~/.zshrc && claude @pick"
