#!/usr/bin/env node
// Generates model+effort variants of the specialist agents so the model router can apply the table's model AND
// effort per launch (the Agent tool accepts neither in updatedInput): for each specialist <name>.md and each
// (model alias, effort) pair used in the router table, writes <name>--<alias>-<effort>.md (same prompt; only
// `model:` and `effort:` differ; description marked as router-managed). Re-run after editing a base agent or the table.
//   node ~/.claude/tools/gen-effort-variants.mjs            generate / refresh
//   node ~/.claude/tools/gen-effort-variants.mjs --clean    remove generated variants
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(CFG_DIR, "agents");
// (alias, effort) pairs from the router table + the model each alias maps to
const cfg = JSON.parse(execFileSync(process.execPath, [path.join(CFG_DIR, "hooks", "model-router.mjs"), "--dump-config"], { encoding: "utf8" }));
const PAIRS = [...new Set(Object.values(cfg.useCases).flatMap((u) => Object.values(u.levels).map(([a, e]) => `${a}-${e}`)))].sort();
const MARK = "# generated-by: gen-effort-variants (do not edit; edit the base agent and re-run)";
const isVariant = (f) => /--(?:[a-z0-9]+-)?(low|medium|high|xhigh|max)\.md$/.test(f);
const PRIMARY = new Set(["lead.md", "solo.md", "task.md"]); // primary (main-session) agents: never launched by the router, no variants

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".md"));
if (process.argv.includes("--clean")) {
  let n = 0; for (const f of files) if (isVariant(f)) { fs.unlinkSync(path.join(DIR, f)); n++; }
  console.log(`removed ${n} variant(s)`); process.exit(0);
}
let made = 0;
for (const f of files) {
  if (isVariant(f) || PRIMARY.has(f)) continue;
  const base = f.slice(0, -3), src = fs.readFileSync(path.join(DIR, f), "utf8");
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) { console.warn(`skip ${f}: no frontmatter`); continue; }
  let [, fm, body] = m;
  fm = fm.split("\n").filter((l) => !/^effort:/.test(l) && !/^model:/.test(l) && !/^name:/.test(l) && !/^description:/.test(l)).join("\n");
  const desc = (src.match(/^description:\s*(.+)$/m)?.[1] || base).replace(/"/g, "'");
  for (const pair of PAIRS) {
    const [alias, e] = pair.split("-"); const model = cfg.models[alias] || alias;
    const out = `---\nname: ${base}--${pair}\ndescription: "Router-managed variant of ${base} (${model} · effort ${e}). Do not call directly: launch task (or ${base}) and the model router picks the variant."\n${fm}\nmodel: ${model}\neffort: ${e}\n---\n${MARK}\n${body}`;
    fs.writeFileSync(path.join(DIR, `${base}--${pair}.md`), out); made++;
  }
  console.log(`${base}: ${PAIRS.length} variants (${PAIRS.join(" ")})`);
}
console.log(`${made} variant file(s) written in ${DIR}`);
