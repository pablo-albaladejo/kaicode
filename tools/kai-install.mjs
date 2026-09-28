#!/usr/bin/env node
// kai-install: installs the kaicode harness from ~/.claude-work into ~/.claude as an UPDATE, never an overwrite.
// Improvements made in ~/.claude (by an agent or by hand) are kept: every file is merged three ways
// (last installed version ← base, what is in ~/.claude now ← local, the new version in the repo ← upstream).
//   unchanged locally            → replaced by the new version
//   changed locally, no upstream → left alone
//   changed on both sides        → merged (git merge-file); on a conflict the local file stays and the new version is
//                                  written next to it as <file>.kaicode-new, with the merge attempt in <file>.kaicode-conflict
//
//   node ~/.claude-work/tools/kai-install.mjs [paths…]     install all (or only these repo paths, e.g. agents/lead.md)
//   node ~/.claude-work/tools/kai-install.mjs --dry-run    say what would happen
//   node ~/.claude-work/tools/kai-install.mjs --status     files changed locally in ~/.claude, with their diff
//   node ~/.claude-work/tools/kai-install.mjs --adopt <path>…  copy a local improvement back into the repo (then commit it)
// Base copies of what was last installed: ~/.claude/.kaicode/base/. Knowledge, router.json and settings.json are never
// installed: they belong to ~/.claude (use the apply-*.sh scripts for settings, knowledge-backup for knowledge).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DST = path.join(os.homedir(), ".claude"), BASE = path.join(DST, ".kaicode", "base");
const argv = process.argv.slice(2), DRY = argv.includes("--dry-run"), QUIET = argv.includes("--quiet");
const only = argv.filter((a) => !a.startsWith("--"));
const TRACK = /^(agents\/[^/]+\.md|commands\/.+|hooks\/[^/]+|tools\/[^/]+|templates\/[^/]+|statusline\.mjs)$/;
const isVariant = (p) => /^agents\/.+--(?:[a-z0-9]+-)?(low|medium|high|xhigh|max)\.md$/.test(p);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const read = (f) => { try { return fs.readFileSync(f); } catch { return null; } };
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "buffer", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
const write = (f, b, mode) => { if (DRY) return; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b); if (mode) fs.chmodSync(f, mode); };
const say = (m) => { if (!QUIET || /✗|!/.test(m)) console.log(m); };

// tracked files: everything git knows plus new files in the working tree (the repo is the source of truth)
let files = [];
try { files = git("ls-files", "--cached", "--others", "--exclude-standard").toString().split("\n").filter(Boolean); } catch { console.error("kai-install: ~/.claude-work is not a git repo"); process.exit(2); }
files = files.filter((p) => TRACK.test(p) && !isVariant(p) && fs.existsSync(path.join(REPO, p)));
if (only.length && !argv.includes("--adopt")) files = files.filter((p) => only.includes(p));

// --status: what changed locally since the last install
if (argv.includes("--status")) {
  let n = 0;
  for (const p of files) { const d = read(path.join(DST, p)); if (d && fs.existsSync(path.join(DST, p) + ".kaicode-new")) console.log(`\n! ${p}: unresolved conflict — compare ${p} with ${p}.kaicode-new (merge attempt: ${p}.kaicode-conflict)`); }
  for (const p of files) { const b = read(path.join(BASE, p)) || read(path.join(REPO, p)), d = read(path.join(DST, p)); if (!b || !d || sha(b) === sha(d)) continue; n++;
    console.log(`\n● ${p} changed in ~/.claude (adopt it: node ~/.claude-work/tools/kai-install.mjs --adopt ${p})`);
    try { execFileSync("diff", ["-u", path.join(BASE, p), path.join(DST, p)], { stdio: "inherit" }); } catch {} }
  console.log(n ? `\n${n} file(s) with local changes` : "no local changes in ~/.claude"); process.exit(0);
}
// --adopt: local improvement → repo
if (argv.includes("--adopt")) {
  for (const p of only) { const d = read(path.join(DST, p)); if (!d) { console.log(`✗ ${p}: not in ~/.claude`); continue; }
    write(path.join(REPO, p), d); write(path.join(BASE, p), d); console.log(`✓ ${p}: ~/.claude version copied into the repo — review and commit it`); }
  process.exit(0);
}

// base for a file installed before kai-install existed: the repo version it matches, else the one current at its mtime
function bootstrapBase(p, local) {
  let commits = []; try { commits = git("log", "--format=%H %ct", "--", p).toString().trim().split("\n").filter(Boolean).map((l) => l.split(" ")); } catch {}
  const mt = fs.statSync(path.join(DST, p)).mtimeMs / 1000; let atTime = null;
  for (const [h, t] of commits) { let c; try { c = git("show", `${h}:${p}`); } catch { continue; }
    if (sha(c) === sha(local)) return { base: c, exact: true };
    if (!atTime && Number(t) <= mt) atTime = c; }
  return { base: atTime, exact: false };
}

const tally = { new: 0, updated: 0, same: 0, kept: 0, merged: 0, conflict: 0 };
const clearSide = (f) => { if (DRY) return; for (const x of [".kaicode-new", ".kaicode-conflict"]) try { fs.unlinkSync(f + x); } catch {} };
for (const p of files) {
  const src = read(path.join(REPO, p)), dstF = path.join(DST, p), local = read(dstF), mode = p.endsWith(".sh") ? 0o755 : undefined;
  let base = read(path.join(BASE, p)), boot = "";
  if (!local) { write(dstF, src, mode); write(path.join(BASE, p), src); tally.new++; say(`+ ${p}`); continue; }
  if (sha(local) === sha(src)) { if (!base || sha(base) !== sha(src)) write(path.join(BASE, p), src); tally.same++; clearSide(dstF); continue; }
  if (!base) { const b = bootstrapBase(p, local); base = b.base; boot = b.exact ? "" : " (first run: base guessed from git history)"; }
  if (base && sha(local) === sha(base)) { write(dstF, src, mode); write(path.join(BASE, p), src); tally.updated++; clearSide(dstF); say(`↑ ${p}`); continue; }
  if (base && sha(src) === sha(base)) { if (boot) write(path.join(BASE, p), base); tally.kept++; say(`= ${p}: local changes kept, nothing new upstream`); continue; }
  // changed on both sides → three-way merge
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kai-")), [fl, fb, fs_] = ["local", "base", "new"].map((n) => path.join(tmp, n));
  fs.writeFileSync(fl, local); fs.writeFileSync(fb, base || Buffer.from("")); fs.writeFileSync(fs_, src);
  let merged, conflicts = 0;
  try { merged = execFileSync("git", ["merge-file", "-p", "-L", "~/.claude (local)", "-L", "last installed", "-L", "kaicode (new)", fl, fb, fs_], { encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] }); }
  catch (e) { merged = e.stdout; conflicts = e.status || 1; }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!conflicts) { write(dstF, merged, mode); write(path.join(BASE, p), src); tally.merged++; clearSide(dstF); say(`⇄ ${p}: merged, local changes kept${boot}`); }
  else { if (boot && base) write(path.join(BASE, p), base); write(dstF + ".kaicode-new", src); write(dstF + ".kaicode-conflict", merged); tally.conflict++;
    say(`! ${p}: changed on both sides and the merge has ${conflicts} conflict(s)${boot}. Local file untouched; new version in ${p}.kaicode-new, merge attempt in ${p}.kaicode-conflict`); }
}
say(`${DRY ? "(dry run) " : ""}kai-install: ${tally.new} new · ${tally.updated} updated · ${tally.merged} merged · ${tally.kept} local kept · ${tally.conflict} conflict(s) · ${tally.same} already current`);
if (!DRY && fs.existsSync(path.join(DST, "tools", "gen-effort-variants.mjs")) && files.some((p) => p.startsWith("agents/") || p === "hooks/model-router.mjs")) {
  try { execFileSync(process.execPath, [path.join(DST, "tools", "gen-effort-variants.mjs")], { stdio: "ignore" }); for (const f of fs.readdirSync(path.join(DST, "agents"))) if (/^(lead|lead-fable|solo)--/.test(f)) fs.unlinkSync(path.join(DST, "agents", f)); say("  router variants regenerated"); } catch {}
}
process.exit(tally.conflict ? 1 : 0);
