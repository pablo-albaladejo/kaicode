#!/usr/bin/env node
// PreToolUse hook (matcher: Agent|Task) — DEBUG ONLY.
// Logs every subagent launch *before* it runs, so we can see what a model router would receive.
// It never blocks or modifies the call: always exits 0 with no output.
//
// Log: <config dir>/logs/agent-launches.jsonl  (one JSON object per launch)
//
// Viewer:
//   node ~/.claude/hooks/log-agent-launch.mjs --tail [N]    last N launches, human-readable (default 10)
//   node ~/.claude/hooks/log-agent-launch.mjs --raw         last raw hook payload (to inspect the schema)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // hooks/.. = config dir
const LOG_DIR = path.join(CFG_DIR, "logs");
const LOG = path.join(LOG_DIR, "agent-launches.jsonl");
const RAW = path.join(LOG_DIR, "agent-launch-last-raw.json");

// ── Viewer mode ───────────────────────────────────────────────────────
if (process.argv[2] === "--tail" || process.argv[2] === "--raw") {
  if (process.argv[2] === "--raw") { try { console.log(fs.readFileSync(RAW, "utf8")); } catch { console.log("No launches logged yet."); } process.exit(0); }
  const n = Number(process.argv[3] || 10);
  let lines = [];
  try { lines = fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).slice(-n); } catch {}
  if (!lines.length) { console.log(`No launches logged yet (${LOG}).`); process.exit(0); }
  for (const l of lines) {
    const e = JSON.parse(l);
    console.log(`\n${e.ts}  session ${String(e.session_id).slice(0, 8)}  ${e.cwd?.replace(os.homedir(), "~") ?? ""}`);
    console.log(`  tool: ${e.tool_name}   subagent: ${e.subagent_type}   model requested: ${e.model ?? "(agent default)"}`);
    if (e.description) console.log(`  description: ${e.description}`);
    console.log(`  prompt (${e.prompt_chars} chars, ~${e.prompt_tokens_est} tokens):`);
    console.log("    " + String(e.prompt ?? "").slice(0, 600).replace(/\n/g, "\n    ") + (e.prompt_chars > 600 ? " …" : ""));
    if (e.other_input_keys?.length) console.log(`  other input fields: ${e.other_input_keys.join(", ")}`);
  }
  process.exit(0);
}

// ── Hook mode ─────────────────────────────────────────────────────────
try {
  const raw = fs.readFileSync(0, "utf8");
  const d = JSON.parse(raw || "{}");
  const input = d.tool_input || {};
  const prompt = input.prompt ?? "";
  const known = new Set(["subagent_type", "description", "prompt", "model"]);
  const entry = {
    ts: new Date().toISOString(),
    session_id: d.session_id,
    cwd: d.cwd,
    agent: d.agent_type ?? null,                 // who is launching (set when a subagent launches another)
    tool_name: d.tool_name,
    tool_use_id: d.tool_use_id ?? null,
    subagent_type: input.subagent_type ?? "general-purpose",
    model: input.model ?? null,                  // model explicitly requested for this launch, if any
    description: input.description ?? null,
    prompt,
    prompt_chars: prompt.length,
    prompt_tokens_est: Math.round(prompt.length / 4),
    other_input_keys: Object.keys(input).filter((k) => !known.has(k)),
  };
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(entry) + "\n");
  fs.writeFileSync(RAW, JSON.stringify(d, null, 2)); // full payload of the last launch, for schema inspection
} catch {
  // Debug hook: never interfere with the session.
}
process.exit(0);
