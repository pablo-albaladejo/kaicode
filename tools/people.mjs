#!/usr/bin/env node
// people: who is who across projects, and how to write to each person. Read before drafting any message for someone;
// updated whenever we learn something (a Slack profile, a correction from the user on tone or level).
// Stored in ~/.claude/knowledge/people.json — local only: kaicode's .gitignore versions knowledge/*.md, not this file.
// Work facts only (role, team, projects, how they prefer to be written to). Nothing personal, no judgements.
//
//   node ~/.claude/tools/people.mjs get <name|slack id|email> [...]      entries to write for (add "me" for the user's own style)
//   node ~/.claude/tools/people.mjs set <name> role="UX Designer" slack=U07… email=… team=… projects+=proj-x style="…" source=slack-profile
//   node ~/.claude/tools/people.mjs note <name> "<what we learned>"      dated note (e.g. a correction from the user)
//   node ~/.claude/tools/people.mjs list [--project <name>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spanish } from "../hooks/english-guard.mjs";

const CFG = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(CFG, "knowledge", "people.json");
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return { people: [] }; } };
const save = (db) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 2) + "\n"); };
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const today = () => new Date().toISOString().slice(0, 10);
const find = (db, q) => { const n = norm(q); return db.people.find((p) => [p.slack, p.email].some((x) => x && norm(x) === n)) || db.people.find((p) => norm(p.name) === n) || db.people.filter((p) => norm(p.name).includes(n)).sort((a, b) => a.name.length - b.name.length)[0]; };
const show = (p) => [
  `## ${p.name}${p.role ? ` — ${p.role}` : " — role unknown"}`,
  [p.team && `team: ${p.team}`, p.slack && `slack: ${p.slack}`, p.email && `email: ${p.email}`].filter(Boolean).join(" · "),
  p.projects?.length ? `projects: ${p.projects.join(", ")}` : "",
  p.style ? `write to them: ${p.style}` : "",
  ...(p.notes || []).slice(-6).map((x) => `- ${x.date}: ${x.text}`),
  p.updated ? `(updated ${p.updated}${p.source ? `, source: ${p.source}` : ""})` : "",
].filter(Boolean).join("\n");

const [cmd, who, ...rest] = process.argv.slice(2);
{ const es = ["set", "note"].includes(cmd) ? spanish(rest.join(" ")) : null;   // knowledge is English only
  if (es) { console.error(`people: this looks Spanish (${es.join(", ")}). Write it in English.`); process.exit(1); } }
const db = load();
if (cmd === "get") {
  const qs = [who, ...rest].filter(Boolean);
  for (const q of qs) { const p = find(db, q); console.log(p ? show(p) : `## ${q} — not in people.json. Look up their Slack profile (slack_read_user_profile: title) and record it with people.mjs set; until then write for a mixed audience.`); console.log(); }
} else if (cmd === "set") {
  if (!who) { console.error("usage: set <name> key=value …"); process.exit(1); }
  // exact slack/email/name, else a unique partial name match ("Lidia"), else a new person
  const n = norm(who), partial = db.people.filter((x) => norm(x.name).includes(n));
  let p = db.people.find((x) => [x.slack, x.email, x.name].some((y) => y && norm(y) === n)) || (partial.length === 1 ? partial[0] : null);
  if (!p) { p = { name: who }; db.people.push(p); }
  for (const kv of rest) { const m = kv.match(/^(\w+)(\+?=)([\s\S]*)$/); if (!m) continue; const [, k, op, v] = m;
    if (k === "projects") { const add = v.split(",").map((s) => s.trim()).filter(Boolean); p.projects = op === "+=" ? [...new Set([...(p.projects || []), ...add])] : add; }
    else if (k === "name") p.name = v; else p[k] = v; }
  p.updated = today(); save(db); console.log(show(p));
} else if (cmd === "note") {
  const p = find(db, who); const text = rest.join(" ").trim();
  if (!p) { console.error(`people: ${who} not found — set them first`); process.exit(1); }
  if (!text) { console.error("usage: note <name> \"text\""); process.exit(1); }
  (p.notes ||= []).push({ date: today(), text }); p.updated = today(); save(db); console.log(show(p));
} else if (cmd === "list") {
  const i = rest.indexOf("--project"), proj = who === "--project" ? rest[0] : i >= 0 ? rest[i + 1] : null;
  const ps = db.people.filter((p) => !proj || (p.projects || []).some((x) => norm(x).includes(norm(proj))));
  for (const p of ps) console.log(`${p.name} — ${p.role || "role unknown"}${p.projects?.length ? ` · ${p.projects.join(", ")}` : ""}`);
  if (!ps.length) console.log("nobody recorded" + (proj ? ` for ${proj}` : ""));
} else {
  console.log("usage: people.mjs get|set|note|list … (see the header of this file)"); process.exit(cmd ? 1 : 0);
}
