#!/usr/bin/env bash
# One-shot setup: model router (shadow mode) + Jev via LLM Gateway + debug launch log.
# Safe to run several times. Usage:  bash ~/.claude-work/setup-jev-router.sh
set -euo pipefail

SRC="$HOME/.claude-work"; DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "✗ node not found in PATH"; exit 1; }
ZSHRC="$HOME/.zshrc"; KEY_VAR="JEV_LLMGATEWAY_KEY"
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }; step(){ printf '\n\033[36m▸ %s\033[0m\n' "$*"; }

# 1. API key → ~/.zshrc (never into Claude/router config files)
step "LLM Gateway key for Jev"
if [ -z "${!KEY_VAR:-}" ]; then
  read -r -s -p "  Paste the LLM Gateway key (input hidden): " KEY; echo
  [ -n "$KEY" ] || { echo "✗ empty key"; exit 1; }
  export "$KEY_VAR=$KEY"
else
  KEY="${!KEY_VAR}"; ok "using $KEY_VAR already in the environment"
fi
touch "$ZSHRC"; cp "$ZSHRC" "$ZSHRC.bak-$TS"
grep -v "^export $KEY_VAR=" "$ZSHRC.bak-$TS" > "$ZSHRC" || true
printf 'export %s="%s"\n' "$KEY_VAR" "$KEY" >> "$ZSHRC"
chmod 600 "$ZSHRC"
ok "export $KEY_VAR saved in ~/.zshrc (backup .zshrc.bak-$TS)"

# 2. Hooks
step "Hooks"
mkdir -p "$DST/hooks" "$DST/logs"
cp "$SRC/hooks/model-router.mjs" "$DST/hooks/model-router.mjs"
cp "$SRC/hooks/log-agent-launch.mjs" "$DST/hooks/log-agent-launch.mjs"
ok "model-router.mjs and log-agent-launch.mjs copied to ~/.claude/hooks"

# 3. router.json (merge: keeps any custom patterns you added)
step "Router config"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1];
let d={}; try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}
Object.assign(d,{
  mode: d.mode||"shadow",
  classifier:"both",
  jevUrl:"https://api.llmgateway.io/v1/systemone",
  jevModel:"jev-1.13.0",
  jevKeyEnv:process.argv[2],
  jevState:d.jevState||"metadata",
  jevTimeoutMs:4000,
  jevMinConfidence:d.jevMinConfidence??0.6,
  tiers:d.tiers||{cheap:"fireworks/deepseek-v4.1-flash",mid:"gpt-6-sol",strong:"fireworks/kimi-k3"}
});
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("  \u001b[32m✓\u001b[0m ~/.claude/router.json → mode="+d.mode+", classifier=both, jevState="+d.jevState);' "$DST/router.json" "$KEY_VAR"

# 4. settings.json: register hooks (idempotent) + drop invalid allow rule
step "settings.json"
cp "$DST/settings.json" "$DST/settings.json.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1],node=process.argv[2],home=process.env.HOME;
const d=JSON.parse(fs.readFileSync(p,"utf8"));
d.hooks??={}; d.hooks.PreToolUse??=[];
for (const h of ["log-agent-launch.mjs","model-router.mjs"]) {
  if (!JSON.stringify(d.hooks.PreToolUse).includes(h))
    d.hooks.PreToolUse.push({matcher:"Agent|Task",hooks:[{type:"command",command:`${node} ${home}/.claude/hooks/${h}`,timeout:5}]});
}
if (d.permissions?.allow) d.permissions.allow=d.permissions.allow.filter(r=>r!=="mcp__*");
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("  \u001b[32m✓\u001b[0m PreToolUse hooks registered (backup settings.json.bak-"+process.argv[3]+")");' "$DST/settings.json" "$NODE" "$TS"

# 5. Live test against Jev
step "Testing Jev through LLM Gateway"
"$NODE" -e '
const key=process.env[process.argv[1]];
const body={model:"jev-1.13.0",state:{subagent:"reviewer",task_description:"Check lint and format of the diff",prompt_tokens_estimate:40},
  questions:{tier:{type:"choice",instructions:"Pick the cheapest model tier that will do the task well.",
  criteria:{cheap:"search, list, lint, simple edits",strong:"deep review, architecture, tricky bugs"}}}};
const t0=Date.now();
fetch("https://api.llmgateway.io/v1/systemone",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(body)})
 .then(async r=>{const t=await r.text(); if(!r.ok){console.log("  \u001b[31m✗\u001b[0m HTTP "+r.status+" "+t.slice(0,200)); process.exitCode=1; return;}
   const a=JSON.parse(t).answers.tier; console.log(`  \u001b[32m✓\u001b[0m Jev answered "${a.choice}" (confidence ${a.confidence}) in ${Date.now()-t0}ms`);})
 .catch(e=>{console.log("  \u001b[31m✗\u001b[0m "+e.message); process.exitCode=1;});' "$KEY_VAR"

# 6. Hook smoke test (then remove the test line from the log)
step "Hook smoke test"
echo '{"session_id":"setup-test","tool_name":"Agent","tool_input":{"subagent_type":"reviewer","description":"Quick review","prompt":"lint and format only"}}' \
  | "$NODE" "$DST/hooks/model-router.mjs" >/dev/null
LAST=$(tail -1 "$DST/logs/model-router.jsonl")
"$NODE" -e 'const r=JSON.parse(process.argv[1]); console.log(`  \u001b[32m✓\u001b[0m rules → ${r.rules_tier} · jev → ${r.jev?.tier ?? "error: "+r.jev?.error}`);' "$LAST"
grep -v '"session_id":"setup-test"' "$DST/logs/model-router.jsonl" > "$DST/logs/model-router.jsonl.tmp" || true
mv "$DST/logs/model-router.jsonl.tmp" "$DST/logs/model-router.jsonl"

step "Done"
echo "  1) Run:  source ~/.zshrc"
echo "  2) Open a NEW aircode session (so it inherits $KEY_VAR) and work normally."
echo "  3) Later: node ~/.claude/hooks/model-router.mjs --report"
echo "  To apply decisions for real: set \"mode\": \"enforce\" in ~/.claude/router.json"
