#!/usr/bin/env node
// voice-lint (PreToolUse): every message that goes out under the user's name to a person — Slack drafts/sends, and
// replies on MRs (glab mr note) — must read like him: B1 English, human, simple, direct, humble, useful, and without
// the marks that make text look machine-written. The deterministic part is checked here and the message is sent back
// with the exact fragments to rewrite; the rest (tone per reader) lives in lead.md "Voice" and people.mjs.
// Ignored when checking: `code`, ```blocks```, URLs, Slack mentions <@U…>/<#C…>, ticket keys (APR-123), emails.
// Test: echo 'text' | node voice-lint.mjs --check
import fs from "node:fs";

const MAX_SENTENCE_WORDS = 25, MAX_WORDS = 180;
// Words and phrases that sound like a machine or a sales deck; each maps to the plain alternative.
const PHRASES = [
  ["delve", "look at"], ["leverage", "use"], ["utilize", "use"], ["facilitate", "help"], ["robust", "solid"], ["seamless", "smooth"],
  ["crucial", "important"], ["furthermore", "also"], ["moreover", "also"], ["additionally", "also"], ["nevertheless", "but"],
  ["comprehensive", "full"], ["streamline", "simplify"], ["nuanced", "subtle"], ["notably", "(drop it)"], ["genuinely", "(drop it)"],
  ["honestly", "(drop it)"], ["straightforward", "simple"], ["it's worth noting", "(drop it)"], ["it is worth noting", "(drop it)"],
  ["in summary", "(drop it)"], ["to summarize", "(drop it)"], ["great question", "(drop it)"], ["i hope this helps", "(drop it)"],
  ["feel free to", "you can"], ["don't hesitate", "(drop it)"], ["please note", "(drop it)"], ["key takeaway", "(drop it)"],
  ["obviously", "(drop it, not humble)"], ["clearly", "(drop it, not humble)"], ["as i said", "(drop it, not humble)"],
  ["as mentioned", "(drop it)"], ["needless to say", "(drop it)"], ["in order to", "to"], ["with regard to", "about"], ["regarding", "about"],
];

function lint(raw) {
  const text = String(raw || "")
    .replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " CODE ")
    .replace(/https?:\/\/\S+/g, " URL ").replace(/<[@#!][^>]*>/g, " @X ").replace(/\b[\w.+]+@[\w-]+\.[\w.]+\b/g, " EMAIL ")
    .replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, " TICKET ");
  const issues = [];
  const around = (i, len = 1) => JSON.stringify(text.slice(Math.max(0, i - 18), i + len + 18).replace(/\s+/g, " ").trim());
  // marks
  const marks = [...text.matchAll(/[-–—;→⇒…•]/g)].slice(0, 6);
  if (marks.length) issues.push(`No dashes, semicolons, arrows, ellipsis or bullet marks (use short sentences, "to", "and", or a numbered list): ${marks.map((m) => around(m.index)).join(", ")}`);
  if (/^\s{0,3}#{1,6}\s/m.test(text)) issues.push("No headings: it is a message, not a document.");
  if ((text.match(/\*\*[^*]+\*\*|(^|\s)\*[^*\s][^*]*\*(?=\s|$)/g) || []).length > 2) issues.push("Too much bold: at most one or two words, or none.");
  // words
  const low = text.toLowerCase();
  const hits = PHRASES.filter(([p]) => new RegExp(`\\b${p.replace(/'/g, "['’]")}\\b`).test(low)).slice(0, 8);
  if (hits.length) issues.push(`Say it plainly: ${hits.map(([p, alt]) => `"${p}" → ${alt}`).join(", ")}`);
  // B1: sentence length and total length
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => /[a-z]/i.test(s));
  const long = sentences.filter((s) => s.split(/\s+/).length > MAX_SENTENCE_WORDS);
  if (long.length) issues.push(`Sentences over ${MAX_SENTENCE_WORDS} words (split them, one idea each): ${long.slice(0, 3).map((s) => JSON.stringify(s.slice(0, 70) + "…")).join(", ")}`);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
  if (words > MAX_WORDS) issues.push(`${words} words: too long for a message (max ${MAX_WORDS}). Keep the answer and the one question; move detail to the ticket or a follow-up reply.`);
  return issues;
}

if (process.argv.includes("--check")) { const issues = lint(fs.readFileSync(0, "utf8")); console.log(issues.length ? issues.map((i) => "✗ " + i).join("\n") : "✓ reads fine"); process.exit(issues.length ? 1 : 0); }

let input = {}; try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
const tool = String(input.tool_name || ""), ti = input.tool_input || {};
let body = null, where = "";
if (/^mcp__plugin_slack_slack__slack_(send_message|send_message_draft|schedule_message)$/.test(tool)) { body = ti.message ?? ti.text ?? ti.markdown_text ?? null; where = "Slack message"; }
else if (tool === "Bash") {
  const cmd = String(ti.command || "");
  if (!/\bglab\s+mr\s+note\b/.test(cmd)) process.exit(0);                        // replies to reviewers on an MR
  const here = cmd.match(/<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\s*\1\b/);
  const quoted = cmd.match(/(?:-m|--message)\s+("((?:[^"\\]|\\.)*)"|'([^']*)')/);
  body = here ? here[2] : quoted ? (quoted[2] ?? quoted[3]).replace(/\\n/g, "\n").replace(/\\"/g, '"') : null;
  where = "MR reply";
}
if (body == null) process.exit(0);
const issues = lint(body);
try { fs.appendFileSync(`${process.env.CLAUDE_CONFIG_DIR || process.env.HOME + "/.claude"}/logs/voice-lint.jsonl`, JSON.stringify({ ts: new Date().toISOString(), where, ok: !issues.length, issues: issues.map((i) => i.slice(0, 60)) }) + "\n"); } catch {}
if (!issues.length) process.exit(0);
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
  permissionDecisionReason: `voice-lint: this ${where} goes out under the user's name and does not read like him yet. Rewrite it (lead.md "Voice") and try again:\n- ${issues.join("\n- ")}` } }));
