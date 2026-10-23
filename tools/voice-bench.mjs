#!/usr/bin/env node
// voice-bench <cases.json> <out dir> [models…]: writes each case with several models in the user's voice (voice-profile +
// samples of the same kind), then builds a blind sheet (candidates shuffled and lettered per case) and a key file.
// Models go through LLM Gateway (/v1/messages); "fable" goes through the claude-anthropic profile CLI if present.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
const [casesF, outDir, ...mArgs] = process.argv.slice(2);
const MODELS = mArgs.length ? mArgs : ["gemini-4-argon", "claude-opus-5-5", "gpt-6.1-sol", "claude-sonnet-5-5", "fable"];
const H = os.homedir(), CL = path.join(H, ".claude");
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
let key = ""; try { key = JSON.parse(read(path.join(H, ".aircode", "config.json"))).harness.llm_keys.llmgateway; } catch {}
const profile = read(path.join(CL, "templates", "voice-profile.md"));
const ANTI = ["2025-08-27", "2025-10-13", "2025-10-21", "2025-10-27", "2025-10-28", "2025-10-30", "2025-10-31", "2025-03-26"];
const samples = (kind) => { const f = { slack: "voice-samples.md", mr: "voice-samples-mr.md", jira: "voice-samples-jira.md" }[kind];
  return read(path.join(CL, "knowledge", f)).split(/\n(?=## )/).filter((b) => /^## \d{4}-/.test(b) && !ANTI.some((d) => b.startsWith(`## ${d}`)) && b.length < 1800); };
const cases = JSON.parse(read(casesF));
const system = (c) => { const pool = samples(c.kind); const pick = pool.sort(() => Math.random() - 0.5).slice(0, 8).join("\n\n");
  return `You write messages that Pablo, a software engineer at Aircall, sends under his own name. They must read exactly as if he typed them himself.\n\nHis voice profile:\n${profile}\n\nReal messages he wrote (${c.kind}), the reference for tone, length and shape:\n${pick}\n\nWrite ONE ${c.kind === "mr" ? "GitLab MR review comment" : c.kind === "jira" ? "Jira comment" : "Slack message"} for the situation the user gives. Output only the message text, nothing before or after. Use Slack emoji codes like :pray: only in Slack.`; };
const user = (c) => `Reader: ${c.reader}\nSituation and facts (use only these facts):\n${c.context}`;
async function viaGateway(model, c) {
  const r = await fetch("https://api.llmgateway.io/v1/messages", { method: "POST", headers: { "x-api-key": key, Authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 700, temperature: 0.9, system: system(c), messages: [{ role: "user", content: user(c) }] }) });
  const j = await r.json(); if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}
function viaFable(c) {
  const bin = ["/opt/homebrew/bin/claude", "/usr/local/bin/claude", path.join(H, ".local/bin/claude"), path.join(H, ".claude/local/claude")].find((p) => fs.existsSync(p));
  if (!bin) throw new Error("claude CLI not found");
  return execFileSync(bin, ["-p", `${system(c)}\n\n---\n${user(c)}`, "--model", "claude-fable-5-1", "--tools", ""], { encoding: "utf8", timeout: 170000, env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(H, ".claude-anthropic") } }).trim();
}
fs.mkdirSync(outDir, { recursive: true });
const results = [];
for (const c of cases) {
  const cands = [];
  for (const m of MODELS) { try { const t = m === "fable" ? viaFable(c) : await viaGateway(m, c); cands.push({ source: m, text: t }); console.log(`case ${c.id} · ${m}: ${t.split(/\s+/).length} words`); } catch (e) { console.log(`case ${c.id} · ${m}: FAILED ${e.message.slice(0, 160)}`); } }
  if (c.mine) cands.push({ source: "claude-cowork-rewrite", text: c.mine });
  if (c.original) cands.push({ source: "pablo-original", text: c.original });
  cands.sort(() => Math.random() - 0.5); cands.forEach((x, i) => (x.letter = String.fromCharCode(65 + i)));
  results.push({ id: c.id, kind: c.kind, reader: c.reader, context: c.context, cands });
}
fs.writeFileSync(path.join(outDir, "key.json"), JSON.stringify(results, null, 2));
const sheet = [`# Voice test (blind)\n\nFor each case: rank the candidates best to worst (e.g. \`C > A > E ...\`), and mark any that you would send as it is with ✓.\nWrite your answer on the "Ranking:" line. The key is kept separately.\n`];
for (const r of results) { sheet.push(`\n---\n## Case ${r.id} · ${r.kind} · to ${r.reader}\n\n_${r.context}_\n`); for (const x of r.cands) sheet.push(`\n### ${x.letter}\n\n${x.text}\n`); sheet.push(`\n**Ranking:** \n`); }
fs.writeFileSync(path.join(outDir, "blind.md"), sheet.join(""));
console.log(`\nblind sheet: ${path.join(outDir, "blind.md")}`);
