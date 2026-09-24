#!/usr/bin/env bash
# Gateway smoke test: does a tool result round-trip through the gateway, and is prompt caching reported?
#   bash ~/.claude/tools/gateway-smoke.sh [model]      (default: the session default model)
# Runs `claude -p` twice on a throwaway folder with the same env the `claude` wrapper uses: the model must
# read a file and echo a code from it (tool round-trip); the second run should report cache_read > 0.
set -uo pipefail
MODEL="${1:-}"
# same environment as the claude() wrapper in ~/.zshrc (this script runs under bash, where that function does not exist)
unset CLAUDE_CONFIG_DIR ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN
source "$HOME/.claude/aircall-gateway.env" || { echo "✗ ~/.claude/aircall-gateway.env missing"; exit 1; }
export ANTHROPIC_AUTH_TOKEN="$(node -e 'console.log(require(process.env.HOME+"/.aircode/config.json").harness.llm_keys.llmgateway)')"
command -v claude >/dev/null || { echo "✗ claude binary not in PATH"; exit 1; }

DIR="$(mktemp -d)"; CODE="$(printf '%04X%04X' "$RANDOM" "$RANDOM")"
printf 'smoke test file\ncode: %s\n' "$CODE" > "$DIR/smoke.txt"
echo "model: ${MODEL:-$ANTHROPIC_DEFAULT_MODEL (default)} · gateway: $ANTHROPIC_BASE_URL · code: $CODE"
run() {
  ( cd "$DIR" && GUARD_BRANCH=off claude -p "Read the file smoke.txt in this folder with the Read tool and reply with ONLY the 8-character code it contains, nothing else." \
      --output-format json --allowedTools Read ${MODEL:+--model "$MODEL"} 2>"$DIR/stderr.log" )
}
parse() { node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{ if(!s.trim()){console.log(JSON.stringify({error:"empty output"}));return;}
let j; try{j=JSON.parse(s)}catch{console.log(JSON.stringify({error:"not json",head:s.slice(0,120)}));return;}
const u=j.usage||{}; console.log(JSON.stringify({result:String(j.result||"").trim().slice(0,40),input:u.input_tokens,cache_read:u.cache_read_input_tokens,cache_create:u.cache_creation_input_tokens,output:u.output_tokens,cost:j.total_cost_usd,turns:j.num_turns,model:Object.keys(j.modelUsage||{})[0]||null,is_error:j.is_error||false}));});'; }
echo "▸ run 1 (tool round-trip)"; R1="$(run | parse)"; echo "  $R1"
[ -s "$DIR/stderr.log" ] && { echo "  stderr:"; head -5 "$DIR/stderr.log" | sed 's/^/    /'; }
echo "▸ run 2 (cache)";           R2="$(run | parse)"; echo "  $R2"
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }; bad(){ printf '  \033[31m✗\033[0m %s\n' "$*"; }
echo
if grep -q "$CODE" <<<"$R1"; then ok "tool result round-trip: the model returned the code from the file"
else bad "tool round-trip FAILED: the model did not return the code $CODE (see result above). The gateway may be dropping tool results, or the model ignored the Read tool."; fi
if node -e 'const r=JSON.parse(process.argv[1]); process.exit((r.cache_read||0)>0?0:1)' "$R2"; then ok "prompt caching reported on the 2nd run (cache_read > 0): cache prices apply"
else bad "no cache_read on the 2nd run: the gateway does not cache this model, or does not report it. You pay full input price; cc-cost prices it as input."; fi
rm -rf "$DIR"
