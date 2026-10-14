#!/usr/bin/env node
// log-scrub [dir]: rewrites the harness logs (default ~/.claude/logs) with every credential masked (hooks/redact.mjs).
// Prints how many lines changed per file. Safe to run any time; run it after a leak, then rotate the credential.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const { redact } = await import(path.join(here, "..", "hooks", "redact.mjs"));
const dir = process.argv[2] || path.join(os.homedir(), ".claude", "logs");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(jsonl|log|json|md|txt|out)$/.test(e.name) ? [path.join(d, e.name)] : []);
let total = 0;
for (const f of walk(dir)) {
  const src = fs.readFileSync(f, "utf8"); const lines = src.split("\n"); let n = 0;
  const out = lines.map((l) => { const r = redact(l); if (r !== l) n++; return r; }).join("\n");
  if (n) { fs.writeFileSync(f, out); console.log(`${path.relative(dir, f)}: ${n} line(s) masked`); total += n; }
}
console.log(total ? `${total} line(s) masked in ${dir}` : `nothing to mask in ${dir}`);
