#!/usr/bin/env bash
# gateway-probe [model …]: is a stall the gateway/model or us? For each model: 3 small streaming requests through the
# Aircall gateway, measuring connect, time-to-first-token, total time and the longest gap between chunks (a stall).
# Reads the key live from ~/.aircode/config.json (never printed). Default models: the five in the router table.
#   bash ~/.claude/tools/gateway-probe.sh                 # all five
#   bash ~/.claude/tools/gateway-probe.sh gpt-6-sol       # one model, 3 runs
set -uo pipefail
KEY="$(node -e 'console.log(require(process.env.HOME+"/.aircode/config.json").harness.llm_keys.llmgateway)' 2>/dev/null)"
[ -n "$KEY" ] || { echo "✗ no gateway key in ~/.aircode/config.json" >&2; exit 1; }
BASE="${ANTHROPIC_BASE_URL:-https://api.llmgateway.io}"
MODELS=("$@"); [ ${#MODELS[@]} -gt 0 ] || MODELS=(fireworks/deepseek-v4.1-flash gpt-6-luna fireworks/deepseek-v4-pro gpt-6-sol claude-opus-5-5)
printf '%-32s %4s %8s %8s %8s %9s  %s\n' model run connect first-tok total max-gap status
for m in "${MODELS[@]}"; do
  for run in 1 2 3; do
    BODY=$(printf '{"model":"%s","max_tokens":120,"stream":true,"messages":[{"role":"user","content":"List the numbers 1 to 30 separated by spaces, then say done."}]}' "$m")
    node - "$BASE" "$KEY" "$BODY" "$m" "$run" <<'EOF'
const [base, key, body, model, run] = process.argv.slice(2);
const t0 = Date.now(); let tConn = null, tFirst = null, last = null, maxGap = 0, chunks = 0, status = "";
const ctl = new AbortController(); const killer = setTimeout(() => ctl.abort(), 90000);
try {
  const res = await fetch(`${base}/v1/messages`, { method: "POST", signal: ctl.signal, body, headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", authorization: `Bearer ${key}`, "x-api-key": key } });
  tConn = Date.now();
  if (!res.ok) { status = `HTTP ${res.status} ${(await res.text()).slice(0, 80).replace(/\s+/g, " ")}`; }
  else { const reader = res.body.getReader(); const dec = new TextDecoder();
    while (true) { const { done, value } = await reader.read(); if (done) break; const now = Date.now(); const txt = dec.decode(value);
      if (/"type":"content_block_delta"/.test(txt)) { if (!tFirst) tFirst = now; if (last) maxGap = Math.max(maxGap, now - last); last = now; chunks++; } }
    status = chunks ? "ok" : "no tokens"; }
} catch (e) { status = e.name === "AbortError" ? "TIMEOUT 90s (stalled)" : String(e.message || e).slice(0, 60); }
clearTimeout(killer);
const s = (ms) => (ms == null ? "   -   " : (ms / 1000).toFixed(1) + "s");
console.log(`${model.padEnd(32)} ${String(run).padStart(4)} ${s(tConn && tConn - t0).padStart(8)} ${s(tFirst && tFirst - t0).padStart(8)} ${s(Date.now() - t0).padStart(8)} ${s(maxGap).padStart(9)}  ${status}`);
EOF
  done
done
echo
echo "Read: first-tok > 15s or max-gap > 20s = the gateway/model is stalling for that model, not the harness. Compare models: if only one is slow, lower it in router.json."
