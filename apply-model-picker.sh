#!/usr/bin/env bash
# Puts the gateway models in Claude Code's /model picker (settings.json "modelPicker", the same key aircode uses).
# Usage: bash ~/.claude-work/apply-model-picker.sh            curated menu (the router table: 6 models)
#        bash ~/.claude-work/apply-model-picker.sh --all      every gateway model from ~/.claude/pricing.json, sorted by price
# Re-run any time to switch; settings.json is backed up each time.
set -euo pipefail
DST="$HOME/.claude"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "✗ node not found"; exit 1; }
cp "$DST/settings.json" "$DST/settings.json.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1];
const d=JSON.parse(fs.readFileSync(p,"utf8"));
const E=["low","medium","high","max"];
// label · model · behavesAs (what Claude Code assumes about the model: opus | sonnet | haiku) · default effort · description
const OPTIONS=[
  ["Flash — DeepSeek V4.1 Flash", "fireworks/deepseek-v4.1-flash", "sonnet", "high",   "$0.22/$0.66 · default: explore, lookups, mechanical edits, cheap agentic work"],
  ["Luna — GPT-6 Luna",           "gpt-6-luna",                    "haiku",  "medium", "$0.10/$0.50 · text: summaries, docs, MR descriptions"],
  ["Pro — DeepSeek V4 Pro",       "fireworks/deepseek-v4-pro",     "sonnet", "medium", "$1.32/$3.96 · implementation with judgement (medium complexity)"],
  ["Sol — GPT-6 Sol",             "gpt-6-sol",                     "opus",   "high",   "$2/$10 · plans, reviews, hard implementation"],
  ["Opus 5.5",                    "claude-opus-5-5",               "opus",   "high",   "$4/$20 · architecture, security review, root cause, migrations"],
  ["Kimi K3",                     "fireworks/kimi-k3",             "opus",   "high",   "$3/$15 · A/B against Sol for agentic work"],
];
let options=OPTIONS.map(([label,model,behavesAs,defaultEffort,description])=>({model,label,description,behavesAs,supportedEfforts:E,defaultEffort}));
if(process.argv[3]==="--all"){
  const prices=JSON.parse(fs.readFileSync(process.argv[4],"utf8")); delete prices._source;
  const money=n=>"$"+(n<1?n.toFixed(2):String(+n.toFixed(2)));
  // bare ids only (no provider prefix), skip dated Anthropic duplicates; provider-pinned ids stay reachable via /model <provider>/<id>
  const bare=Object.entries(prices).filter(([k])=>!k.includes("/")&&!/-\d{8}$/.test(k));
  const curated=new Map(OPTIONS.map(o=>[o[1].split("/").pop(),o]));
  options=bare.sort((a,b)=>a[1].output-b[1].output||a[1].input-b[1].input).map(([id,p])=>{
    const c=curated.get(id); const behavesAs=c?c[2]:p.output>=10?"opus":p.output>=2?"sonnet":"haiku";
    return {model:c?c[1]:id,label:(c?c[0].split(" — ")[0]+" · ":"")+id,description:`${money(p.input)} in · ${money(p.output)} out · ${money(p.cacheRead)} cache`+(c?" · "+c[4].split(" · ")[1]:""),behavesAs,supportedEfforts:E,defaultEffort:c?c[3]:"medium"};
  });
}
d.modelPicker={replaceBuiltInOptions:true,options};
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("  \u001b[32m✓\u001b[0m modelPicker: "+options.length+" gateway models in /model (backup settings.json.bak-"+process.argv[2]+")");
for(const o of options.slice(0,8)) console.log("     "+o.label.padEnd(34)+o.description); if(options.length>8) console.log("     … "+(options.length-8)+" more");' "$DST/settings.json" "$TS" "${1:-}" "$DST/pricing.json"
echo; echo "  Open a new claude session and run /model. If the list is unchanged, this Claude Code build ignores the key: tell me and we fall back to aliases."
