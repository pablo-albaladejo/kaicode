#!/usr/bin/env node
// ship-brief <T> [--step n | --all]: prints the implementer brief for /ship stage 5, built from the ticket's state, so
// every run gets the same facts and rules (retro 2026-10-14: briefs that forgot call sites, test counts or the
// no --no-verify rule cost whole runs). The lead pastes the output as the Agent prompt, adding only what is new.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const git = (a) => { try { return execSync(`git ${a}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
const argv = process.argv.slice(2), T = argv.find((a) => /^[A-Z][A-Z0-9]+-\d+$/.test(a));
if (!T) { console.error("usage: ship-brief <TICKET> [--step n | --all]"); process.exit(1); }
const root = git("rev-parse --show-toplevel"), dir = path.join(root, ".claude", "ship", T);
let s = {}; try { s = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")); } catch { console.error(`no ship state for ${T} here`); process.exit(1); }
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };

// plan text: the spec section for this ticket, else plan.md
let plan = "", source = "plan.md";
if (s.spec) { const tasks = read(path.join(root, s.spec, "tasks.md")); const i = tasks.search(new RegExp(`^## ${T}:`, "m"));
  if (i >= 0) { const rest = tasks.slice(i); const j = rest.slice(3).search(/^## /m); plan = j >= 0 ? rest.slice(0, j + 3) : rest; source = `${s.spec}/tasks.md (section ${T})`; } }
if (!plan) plan = read(path.join(dir, "plan.md"));
if (!plan) { console.error("no plan.md and no spec section: run the plan stage first"); process.exit(1); }

// steps: numbered items (1. / - [ ] 1.) with their continuation lines
const steps = []; let cur = null;
for (const line of (plan.split(/^###\s*Steps\s*$/m)[1] || plan).split(/^###\s/m)[0].split("\n")) {
  const m = line.match(/^\s*(?:[-*]\s*\[[ x]\]\s*)?(\d+(?:\.\d+)*)[.)]?\s+(.*)$/);
  if (m) { cur = { n: m[1], text: line.trim() }; steps.push(cur); continue; }
  if (cur && /^\s{2,}\S/.test(line)) cur.text += "\n   " + line.trim(); else if (!line.trim()) cur = null;
}
const si = argv.indexOf("--step"), want = si >= 0 ? Number(argv[si + 1]) : null;
const pick = argv.includes("--all") || want == null ? steps : steps.filter((x) => String(x.n) === String(want) || String(x.n).startsWith(String(want) + "."));
if (want != null && !pick.length) { console.error(`step ${want} not found; steps: ${steps.map((x) => x.n).join(", ")}`); process.exit(1); }
const goal = (plan.match(/^Goal:\s*(.+)$/m) || [])[1] || "";
const acceptance = (s.acceptance || []).length ? s.acceptance.map((a, i) => `${i + 1}. ${typeof a === "string" ? a : a.text || JSON.stringify(a)}`).join("\n") : (read(path.join(dir, "brief.md")).match(/Acceptance[^\n]*\n([\s\S]*?)(\n#|\n\n[A-Z])/i) || [])[1]?.trim() || "(see the plan)";
const head = git("rev-parse --short HEAD"), done = git("log --oneline origin/main..HEAD").split("\n").filter(Boolean);

console.log(`change: ${T}${want != null ? ` step ${want} of ${steps.length}` : ""}. ${goal}
Source: ${source}. Branch ${s.branch || git("rev-parse --abbrev-ref HEAD")} at ${head}${done.length ? `, already on the branch:\n${done.map((l) => "  " + l).join("\n")}` : "."}

Do exactly this:
${pick.map((x) => x.text).join("\n")}

Acceptance (the ticket):
${acceptance}

Rules (the ship gate checks the first four from the repo, not from your report):
- Never \`--no-verify\` or disabled hooks. If the pre-commit check fails because a later step is missing, stop and report partial.
- Every new export is used where the step says (wire:), or Notes says "unwired: <name> — step <n>".
- Add or change the test that proves this step; while iterating run only the step's test: command.
- Tests line counts TESTS, not files${s.tests_max ? ` (best so far on this ticket: ${s.tests_max} passed; the full suite must not report fewer)` : ""}.
- Commit green work as soon as the step's test passes, then run the full relevant suite and the linter once.
- Same test failing 3 times in a row: commit what is green and report partial with the failing test and its output.
- Out of scope: other steps, other tickets' sections, refactors the step does not need.
Report in the implementer format (Status, Branch, Commits, Changed, Tests: <cmd> → passed X / failed Y, Lint, Notes).`);
