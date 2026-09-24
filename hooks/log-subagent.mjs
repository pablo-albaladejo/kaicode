#!/usr/bin/env node
// SubagentStop: logs which subagent finished, how long it ran and on which model — the data behind the HUD's
// per-agent ETA (median duration per agent type · model) and cc-cost. Log: <config dir>/logs/subagents.jsonl
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(CFG_DIR, "logs", "subagents.jsonl");
let d = {}; try { d = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
let started = null, model = null, calls = 0, base = String(d.agent_type || "").replace(/--(?:[a-z0-9]+-)?(low|medium|high|xhigh|max)$/, "") || null;
try {
  const lines = fs.readFileSync(d.agent_transcript_path, "utf8").split("\n");
  for (const l of lines) { try { const e = JSON.parse(l); if (!started && e.timestamp) started = e.timestamp; if (e.type === "assistant" && e.message?.model) { model = e.message.model; if (e.message.usage) calls++; } } catch {} }
} catch {}
const rec = { ts: new Date().toISOString(), event: d.hook_event_name, agent_type: d.agent_type ?? null, base, model, calls, agent_id: d.agent_id ?? null, session_id: d.session_id ?? null, cwd: d.cwd ?? null, agent_transcript_path: d.agent_transcript_path ?? null,
  duration_s: started ? Math.round((Date.now() - new Date(started).getTime()) / 1000) : null, stop_hook_active: !!d.stop_hook_active };
try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify(rec) + "\n"); } catch {}
process.exit(0);
