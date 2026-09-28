#!/usr/bin/env node
// knowledge-backup: copies ~/.claude/knowledge/**/*.md into the kaicode repo (~/.claude-work/knowledge/) so lessons,
// process notes and repo maps are versioned. One way: ~/.claude owns the knowledge, the repo keeps a copy.
// people.json is never copied (colleagues' data stays on this laptop). Files deleted in ~/.claude are reported, not
// deleted from the repo. Run by `retro-report.mjs --close`; by hand: node ~/.claude/tools/knowledge-backup.mjs [--commit]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const SRC = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "knowledge");
const REPO = path.join(os.homedir(), ".claude-work"), DST = path.join(REPO, "knowledge");
const walk = (d, rel = "") => { let out = []; try { for (const e of fs.readdirSync(path.join(d, rel), { withFileTypes: true })) {
  const r = path.join(rel, e.name); if (e.isDirectory()) out = out.concat(walk(d, r)); else if (e.name.endsWith(".md")) out.push(r); } } catch {} return out; };
const src = walk(SRC), dst = new Set(walk(DST));
let changed = 0;
for (const r of src) { const a = fs.readFileSync(path.join(SRC, r)); let b = null; try { b = fs.readFileSync(path.join(DST, r)); } catch {}
  if (b && a.equals(b)) { dst.delete(r); continue; }
  fs.mkdirSync(path.dirname(path.join(DST, r)), { recursive: true }); fs.writeFileSync(path.join(DST, r), a); dst.delete(r); changed++; console.log(`  ↑ knowledge/${r}`); }
for (const r of dst) console.log(`  • knowledge/${r} is in the repo but no longer in ~/.claude (left in place)`);
console.log(`knowledge-backup: ${changed} file(s) updated in ~/.claude-work/knowledge`);
if (changed && process.argv.includes("--commit")) {
  try { execFileSync("git", ["-C", REPO, "add", "knowledge"], { stdio: "ignore" }); execFileSync("git", ["-C", REPO, "commit", "-q", "-m", `knowledge backup ${new Date().toISOString().slice(0, 10)}`], { stdio: "ignore" }); console.log("  committed (push when you like)"); }
  catch { console.log("  ! commit failed: commit it by hand in ~/.claude-work"); }
}
