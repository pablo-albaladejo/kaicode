#!/usr/bin/env bash
# Second profile: `claude-anthropic` = the same harness (agents, hooks, tools, /ship, knowledge) on the Claude login and
# Anthropic models instead of LLM Gateway. ~/.claude is not modified except for the shared code this script refreshes.
#   claude-anthropic [args]              Haiku / Sonnet 5 / Opus 5.5 through the router
#   claude-anthropic --fable [args]      critical rows (architecture, security, hard root cause, migrations) on Fable 5.1
#   claude-anthropic --fable=all [args]  also the lead (main session) on Fable 5.1
#   claude-anthropic @ticket APR-1 …     everything the claude wrapper does works the same
# Usage: bash ~/.claude-work/apply-profile-anthropic.sh && source ~/.zshrc
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; P="$HOME/.claude-anthropic"; ZSHRC="$HOME/.zshrc"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }

# 1. shared code in ~/.claude (both profiles run it)
node "$SRC/tools/kai-install.mjs" hooks/model-router.mjs tools/gen-effort-variants.mjs tools/profile-sync.mjs statusline.mjs   # merges, never overwrites local changes
ok "router profiles · profile-sync · statusline tag (gateway profile variants refreshed)"

# 2. the profile: symlinks + derived settings/router/agents
mkdir -p "$P"
if [ ! -f "$P/.claude.json" ] && [ -f "$HOME/.claude.json" ]; then
  # start with the same MCP servers as the main profile (their OAuth tokens in ~/.mcp-auth are shared); login stays separate
  "$NODE" -e 'const fs=require("fs"),[s,d]=process.argv.slice(1);const j=JSON.parse(fs.readFileSync(s,"utf8"));fs.writeFileSync(d,JSON.stringify({mcpServers:j.mcpServers||{}},null,2)+"\n");fs.chmodSync(d,0o600)' "$HOME/.claude.json" "$P/.claude.json"
  ok "MCP servers copied from ~/.claude.json ($("$NODE" -e 'console.log(Object.keys(require(process.argv[1]).mcpServers).join(", ")||"none")' "$P/.claude.json"))"
fi
"$NODE" "$DST/tools/profile-sync.mjs" "$P" --force

# 3. ~/.zshrc: the claude() wrapper learns KAI_PROFILE=anthropic, plus the claude-anthropic launcher
cp "$ZSHRC" "$ZSHRC.bak-$TS"
"$NODE" - "$ZSHRC" <<'JS'
const fs = require("fs"), p = process.argv[2]; let s = fs.readFileSync(p, "utf8");
if (!s.includes("# >>> claude-gateway >>>")) { console.log("  ! claude() wrapper not found in ~/.zshrc"); process.exit(1); }
if (!s.includes("KAI_PROFILE")) {
  const re = /(\n\s*)export ANTHROPIC_AUTH_TOKEN="\$\(node -e '[^\n]*\)"\n\s*unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN\n/;
  const m = s.match(re); if (!m) { console.log("  ! gateway lines not found in claude(): edit by hand"); process.exit(1); }
  const ind = m[1];
  s = s.replace(re, `${ind}if [ "\${KAI_PROFILE:-}" = anthropic ]; then${ind}  # Claude login: drop every gateway ANTHROPIC_* (JEV_LLMGATEWAY_KEY stays for the router and bash-guard)${ind}  for v in \${(k)parameters[(I)ANTHROPIC_*]}; do unset $v; done${ind}  export CLAUDE_CONFIG_DIR="$HOME/.claude-anthropic"${ind}else${ind}  export ANTHROPIC_AUTH_TOKEN="$(node -e 'console.log(require(process.env.HOME+"/.aircode/config.json").harness.llm_keys.llmgateway)')"${ind}  unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN${ind}fi\n`);
}
s = s.replace(/\n# >>> claude-anthropic >>>[\s\S]*?# <<< claude-anthropic <<<\n?/g, "\n");
s += `
# >>> claude-anthropic >>>
# claude-anthropic: same harness on the Claude login (profile ~/.claude-anthropic, kept in sync with ~/.claude)
#   --fable       critical rows on Fable 5.1 · --fable=all  also the lead · everything else as in claude()
claude-anthropic() {
  local fable="" P="$HOME/.claude-anthropic"
  case "\${1:-}" in --fable|--fable=critical) fable=critical; shift ;; --fable=all) fable=all; shift ;; esac
  node ~/.claude/tools/profile-sync.mjs "$P" --quiet || return 1
  if [ -n "$fable" ] && [ ! -f "$P/.fable-ok" ]; then
    echo "→ checking Fable 5.1 access on this account (once)…"
    if KAI_PROFILE=anthropic claude -p --agent lead-fable "Reply with exactly: OK" 2>/dev/null | grep -qE "^OK\.?$"; then date > "$P/.fable-ok"
    else echo "✗ Fable 5.1 is not available on this account: starting without it (Opus 5.5 for critical work)"; fable=""; fi
  fi
  [ "$fable" = all ] && set -- "$@" --agent lead-fable
  [ -n "$fable" ] && echo "→ Fable 5.1: $fable"
  KAI_PROFILE=anthropic KAI_FABLE="$fable" claude "$@"
}
# <<< claude-anthropic <<<
`;
fs.writeFileSync(p, s); console.log("  \u001b[32m✓\u001b[0m ~/.zshrc: claude() knows KAI_PROFILE=anthropic · claude-anthropic launcher");
JS
echo
echo "  Next:  source ~/.zshrc && claude-anthropic      then /login with your Aircall Claude account"
echo "         /plugin install slack@claude-plugins-official  (if Slack is not listed in /mcp), then authenticate it in /mcp"
echo "  zshrc backup: $ZSHRC.bak-$TS"
