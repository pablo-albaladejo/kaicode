#!/usr/bin/env node
// agent-trace <session uuid>: for each subagent of a session, its tool calls in order (name + first 140 chars of the
// input, credentials masked) and the size of each tool result, plus any API error. For diagnosing a failed subagent.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const { redact } = await import(new URL("../hooks/redact.mjs", import.meta.url));
let id = process.argv[2];
const root = path.join(os.homedir(), ".claude", "projects"); let dir = null;
// a ticket key instead of a session: the most recent session (last 3 days) with a subagent whose description names it
if (/^[A-Z][A-Z0-9]+-\d+$/.test(id || "")) { let best = null;
  for (const p of fs.readdirSync(root)) { let ds = []; try { ds = fs.readdirSync(path.join(root, p)); } catch { continue; }
    for (const d of ds) { const sd = path.join(root, p, d, "subagents"); if (!fs.existsSync(sd)) continue; const mt = fs.statSync(sd).mtimeMs; if (Date.now() - mt > 3 * 864e5) continue;
      if (fs.readdirSync(sd).some((f) => f.endsWith(".meta.json") && fs.readFileSync(path.join(sd, f), "utf8").includes(id)) && (!best || mt > best.mt)) best = { d, mt }; } }
  if (!best) { console.error(`no recent session mentions ${id}`); process.exit(1); } console.log(`session ${best.d}`); id = best.d; }
if (!/^[0-9a-f-]{36}$/.test(id || "")) { console.error("usage: agent-trace <session uuid | TICKET>"); process.exit(1); }
for (const p of fs.readdirSync(root)) { const d = path.join(root, p, id); if (fs.existsSync(d)) { dir = d; break; } }
if (!dir) { console.error("session folder not found"); process.exit(1); }
const subs = path.join(dir, "subagents"); const files = fs.existsSync(subs) ? fs.readdirSync(subs).filter((f) => f.endsWith(".jsonl")) : [];
for (const f of files) {
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(subs, f.replace(/\.jsonl$/, ".meta.json")), "utf8")); } catch {}
  console.log(`\n== ${meta.agentType || meta.agent_type || "?"} · ${f} · ${redact(String(meta.description || "")).slice(0, 80)}`);
  for (const l of fs.readFileSync(path.join(subs, f), "utf8").split("\n")) { let e; try { e = JSON.parse(l); } catch { continue; }
    for (const b of e.message?.content || []) {
      if (b.type === "tool_use") console.log(`  → ${b.name} ${redact(JSON.stringify(b.input)).slice(0, 140)}`);
      if (b.type === "tool_result") { const c = Array.isArray(b.content) ? b.content : [{ type: "text", text: String(b.content || "") }];
        console.log(`    ← ${c.map((x) => x.type === "image" ? `image ${Math.round((x.source?.data || "").length / 1024)} KB b64` : `text ${(x.text || "").length} chars`).join(", ")}${b.is_error ? " ERROR" : ""}`); }
      if (b.type === "text" && /error|too long/i.test(b.text || "") && e.type === "assistant") console.log(`  ! ${redact(b.text).slice(0, 200)}`);
    }
    if (e.isApiErrorMessage || e.error) console.log(`  ! API error: ${redact(JSON.stringify(e.error || e.message?.content)).slice(0, 200)}`);
  }
}
