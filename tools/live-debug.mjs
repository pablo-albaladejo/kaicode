#!/usr/bin/env node
// live-debug [folder-substring]: why the status line does (not) show a live subagent line. Finds the newest main
// transcript of the project whose folder matches (default: current dir), lists its subagent transcripts and, for each,
// the reasons the status line would skip it (SubagentStop logged, mtime, age).
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
const CFG = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const want = (process.argv[2] || process.cwd()).replace(/[^a-zA-Z0-9]/g, "-");
const projects = path.join(CFG, "projects");
const dirs = fs.readdirSync(projects).filter((d) => d.includes(want) || want.includes(d)).map((d) => path.join(projects, d));
if (!dirs.length) { console.log(`no project dir matching ${want} in ${projects}`); process.exit(1); }
const mains = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(d, f))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const main = mains[0], sid = path.basename(main, ".jsonl");
console.log(`main transcript: ${main}\nsession: ${sid}`);
const sub = path.join(path.dirname(main), sid, "subagents");
let files = []; try { files = fs.readdirSync(sub).filter((f) => f.endsWith(".jsonl")); } catch (e) { console.log(`✗ no subagents dir at ${sub} (${e.code})`); 
  const alt = fs.readdirSync(path.dirname(main)).filter((x) => !x.endsWith(".jsonl")); console.log(`  entries next to the transcript: ${alt.slice(0, 10).join(", ")}`); process.exit(0); }
const stops = new Map();
try { for (const l of fs.readFileSync(path.join(CFG, "logs", "subagents.jsonl"), "utf8").split("\n")) if (l.includes(sid)) { try { const j = JSON.parse(l); for (const k of [j.agent_id, j.agent_transcript_path]) if (k) stops.set(String(k), j.ts); } catch {} } } catch {}
const now = Date.now();
for (const f of files) {
  const p = path.join(sub, f), id = f.replace(/\.jsonl$/, "").replace(/^agent-/, ""), st = fs.statSync(p);
  let type = "?"; try { const m = JSON.parse(fs.readFileSync(p.replace(/\.jsonl$/, ".meta.json"), "utf8")); type = m.agentType || m.agent_type || "?"; } catch {}
  const stop = stops.get(id) || stops.get(p), stopMs = stop ? new Date(stop).getTime() : 0;
  const why = [];
  if (stop) why.push(st.mtimeMs <= stopMs + 3000 ? `SubagentStop at ${stop} and nothing written since → hidden` : `SubagentStop at ${stop} but written after → shown as (continued) with the new statusline`);
  if (now - st.mtimeMs > 600000) why.push(`idle ${Math.round((now - st.mtimeMs) / 60000)} min > 10 → hidden`);
  console.log(`- ${f}  type=${type}  modified ${Math.round((now - st.mtimeMs) / 1000)}s ago  ${why.length ? why.join("; ") : "→ should be shown"}`);
}
const sl = (() => { try { return JSON.parse(fs.readFileSync(path.join(CFG, "settings.json"), "utf8")).statusLine; } catch { return null; } })();
console.log(`statusLine: ${JSON.stringify(sl)}`);
console.log(`installed statusline has the 'continued' fix: ${fs.readFileSync(path.join(CFG, "statusline.mjs"), "utf8").includes("(continued)")}`);
