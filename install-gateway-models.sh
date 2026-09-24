#!/usr/bin/env bash
# Installs: full LLM Gateway price list, model groups, `cc-models` picker, and the `claude @tier` launcher.
# Safe to run several times. Usage:  bash ~/.claude-work/install-gateway-models.sh && source ~/.zshrc
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; ZSHRC="$HOME/.zshrc"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "✗ node not found in PATH"; exit 1; }
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }; step(){ printf '\n\033[36m▸ %s\033[0m\n' "$*"; }

step "Prices and model groups"
mkdir -p "$DST/tools"
cp "$SRC/pricing.json" "$DST/pricing.json";      ok "pricing.json: $("$NODE" -e 'const p=require(process.argv[1]);console.log(Object.keys(p).length-1)' "$DST/pricing.json") models"
cp "$SRC/models.json"  "$DST/models.json";       ok "models.json (groups cheap / mid / strong)"
cp "$SRC/tools/cc-models.mjs" "$DST/tools/cc-models.mjs"; ok "tools/cc-models.mjs"
cp "$SRC/tools/cc-cost.mjs"   "$DST/tools/cc-cost.mjs";   ok "tools/cc-cost.mjs (price lookup now strips the provider prefix)"
cp "$SRC/statusline.mjs"      "$DST/statusline.mjs";      ok "statusline.mjs (same fix)"

step "~/.zshrc"
cp "$ZSHRC" "$ZSHRC.bak-$TS"
# Drop the previous claude() function (with or without markers) and the old cc-models alias, then append the new block.
"$NODE" -e '
const fs=require("fs"),p=process.argv[1];let s=fs.readFileSync(p,"utf8");
s=s.replace(/\n# >>> claude-gateway >>>[\s\S]*?# <<< claude-gateway <<<\n?/g,"\n");
s=s.replace(/\n# claude → Aircall LLM Gateway[^\n]*\nclaude\(\) \{\n[\s\S]*?\n\}\n/g,"\n");
s=s.replace(/\nalias cc-models=[^\n]*\n/g,"\n");
fs.writeFileSync(p,s.replace(/\n{3,}/g,"\n\n"));' "$ZSHRC"
cat >> "$ZSHRC" <<'EOF'

# >>> claude-gateway >>>
# claude → Aircall LLM Gateway (same env as aircode; key read live from ~/.aircode/config.json)
#   claude            default model (fireworks/deepseek-v4.1-flash)
#   claude @strong    first model of the "strong" group   ·  claude @mid:2   second of "mid"
#   claude @gpt-6-sol any gateway model id                ·  cc-models       list groups + prices
claude() {
  (
    source ~/.claude/aircall-gateway.env || return 1
    export ANTHROPIC_AUTH_TOKEN="$(node -e 'console.log(require(process.env.HOME+"/.aircode/config.json").harness.llm_keys.llmgateway)')"
    unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN
    if [ "${1:0:1}" = "@" ]; then
      local m; m="$(node ~/.claude/tools/cc-models.mjs --resolve "${1#@}")" || return 1
      shift; set -- --model "$m" "$@"
    fi
    command claude "$@"
  )
}
alias cc-models='node ~/.claude/tools/cc-models.mjs'
# <<< claude-gateway <<<
EOF
ok "claude() launcher + cc-models alias (backup .zshrc.bak-$TS)"

step "Check"
"$NODE" "$DST/tools/cc-models.mjs" --resolve strong >/dev/null && ok "cc-models --resolve strong → $("$NODE" "$DST/tools/cc-models.mjs" --resolve strong)"
[ -f "$DST/aircall-gateway.env" ] && ok "aircall-gateway.env present" || echo "  ! ~/.claude/aircall-gateway.env missing — capture it from an aircode session first"
echo; echo "  Now run:  source ~/.zshrc && cc-models"
