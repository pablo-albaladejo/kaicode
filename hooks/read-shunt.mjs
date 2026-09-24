#!/usr/bin/env node
// PreToolUse hook on Read — "shunt" large reads away from expensive models (after Spotify's shunt plugin).
// When an agent running on an expensive model (variant alias pro | sol | opus) asks to Read a file longer than
// shuntMinLines (350) without a small offset/limit window, the read is denied and the agent is told to run
//   node ~/.claude/tools/bulk-read.mjs "<question>" <file …>
// which sends the files to a cheap model through the Aircall gateway and returns structured bullets. The expensive
// model then pays only for the summary (~90% less than reading the file itself). Cheap agents (flash, luna) and
// the lead read directly: shunting flash to flash would only add latency.
// Always allowed: Read with limit ≤ shuntMinLines (the agent is looking at a section to quote or edit), files
// under shuntMinLines, non-text files, and anything when shuntMode is "off". Fail-open on any error.
// Config in ~/.claude/router.json: shuntMode "on"|"off", shuntMinLines 350, shuntAliases ["pro","sol","opus"].
// Log: logs/read-shunt.jsonl (denies + bulk-read calls) · Report: node ~/.claude/hooks/read-shunt.mjs --report [days]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(CFG_DIR, "logs", "read-shunt.jsonl");
const DEFAULTS = { shuntMode: "on", shuntMinLines: 350, shuntAliases: ["pro", "sol", "opus"] };
let cfg = DEFAULTS; try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(CFG_DIR, "router.json"), "utf8")) }; } catch {}
const log = (o) => { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n"); } catch {} };

if (process.argv[2] === "--report") {
  const days = Number(process.argv[3] || 7), since = Date.now() - days * 86400000;
  let rows = []; try { rows = fs.readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => new Date(r.ts).getTime() >= since); } catch {}
  const denies = rows.filter((r) => r.kind === "deny"), reads = rows.filter((r) => r.kind === "bulk-read");
  const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n || 0)));
  console.log(`Read shunt — last ${days} days — mode ${cfg.shuntMode} · min ${cfg.shuntMinLines} lines · aliases ${cfg.shuntAliases.join(",")}`);
  console.log(`  reads shunted: ${denies.length}  (by agent: ${[...denies.reduce((m, r) => m.set(r.agent, (m.get(r.agent) || 0) + 1), new Map())].map(([a, n]) => `${a} ${n}`).join(" · ") || "-"})`);
  const inTok = reads.reduce((a, r) => a + (r.input || 0), 0), outTok = reads.reduce((a, r) => a + (r.output || 0), 0), cost = reads.reduce((a, r) => a + (r.cost || 0), 0);
  const saved = reads.reduce((a, r) => a + ((r.input || 0) * (r.caller_input_price || 0) - (r.cost || 0)), 0);
  console.log(`  bulk-read calls: ${reads.length} · ${k(inTok)} tokens read by the cheap model → ${k(outTok)} tokens returned · cost $${cost.toFixed(4)} · est. saved vs. caller reading itself $${saved.toFixed(3)}`);
  const er = rows.filter((r) => r.error); if (er.length) console.log("  errors: " + [...new Set(er.map((r) => r.error))].join(" | "));
  for (const r of reads.slice(-6)) console.log(`  ${r.ts.slice(5, 16).replace("T", " ")}  ${String(r.agent || "-").padEnd(22)} ${k(r.input)}→${k(r.output)}  ${(r.files || []).length} file(s)  "${(r.question || "").slice(0, 60)}"`);
  process.exit(0);
}

let input = {}; try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
if (cfg.shuntMode === "off") process.exit(0);
if (process.env.AIRCODE_SESSION_METADATA_PATH || /aircall-aircode-agents/.test(process.env.CLAUDE_CODE_AGENT || "")) process.exit(0);
const agent = String(input.agent_type || "");
const alias = agent.match(/--([a-z0-9]+)-(?:low|medium|high|xhigh|max)$/)?.[1] || null;
if (!alias || !cfg.shuntAliases.includes(alias)) process.exit(0);          // cheap model, or the lead: read directly
const ti = input.tool_input || {};
const file = String(ti.file_path || "");
if (!file || (ti.limit && Number(ti.limit) <= cfg.shuntMinLines)) process.exit(0); // a window to quote/edit: fine
if (/\.(png|jpe?g|gif|webp|pdf|ipynb|svg|ico|woff2?|ttf|zip|gz|tar|bin|exe|dylib|so)$/i.test(file)) process.exit(0);
let lines = 0; try { const st = fs.statSync(file); if (!st.isFile() || st.size > 8 * 1024 * 1024) process.exit(0); const tx = fs.readFileSync(file, "utf8"); lines = tx.split("\n").length - (tx.endsWith("\n") ? 1 : 0); } catch { process.exit(0); }
if (lines <= cfg.shuntMinLines) process.exit(0);

const rel = input.cwd && file.startsWith(input.cwd) ? path.relative(input.cwd, file) : file;
log({ kind: "deny", session_id: input.session_id, agent, alias, file: rel, lines, cwd: input.cwd });
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
  permissionDecisionReason: `read-shunt: ${rel} has ${lines} lines and you run on an expensive model (${alias}). Do not read it whole. Either (a) ask a cheap model to read it for you and answer a concrete question:\n  node ~/.claude/tools/bulk-read.mjs "<what you need to know, be specific>" ${JSON.stringify(rel)}\n(you can pass several files or globs; the answer comes back as bullets with file:line references), or (b) if you already know the section you need to quote or edit, Read it with offset and limit (≤ ${cfg.shuntMinLines} lines). Grep first if you are not sure where to look.` } }));
