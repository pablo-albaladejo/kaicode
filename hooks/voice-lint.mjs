#!/usr/bin/env node
// voice-lint (PreToolUse): every message that goes out under the user's name to a person — Slack drafts/sends, and
// replies on MRs (glab mr note) — must read like him: B1 English, human, simple, direct, humble, useful, and without
// the marks that make text look machine-written. The deterministic part is checked here and the message is sent back
// with the exact fragments to rewrite; the rest (tone per reader) lives in lead.md "Voice" and people.mjs.
// Ignored when checking: `code`, ```blocks```, URLs, Slack mentions <@U…>/<#C…>, ticket keys (APR-123), emails.
// In the sport channels below the format checks (marks, bold, long sentences, total words) are skipped on purpose: a
// race announcement there is a long bilingual bulletin for a whole channel, so bullets and long sentences are the house
// style. The rest of the lint (machine words, headings) still applies, and `--check` stays strict.
// Test: echo 'text' | node voice-lint.mjs --check
import fs from "node:fs";

// Channels where a Sports Club / race announcement is a bulletin for the whole channel, not a short reply to one
// person: the office writes them bilingual and long, with bullets and several bold bits, so those four format checks
// would block every one of them. Only the checks about sounding like a machine still run there.
const SPORT_ANNOUNCEMENT_CHANNELS = ["C0210R5DC06", "C09LHJB32TF"];   // #oficina-madrid, #carreras-aircall-2026
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
  // Commentary on the conversation or on the writer's own earlier opinion, instead of the current fact. The words are
  // plain and the sentence is short, so nothing else here catches it; it reads as a machine performing deference.
  ["you are right", "(drop it, state the fact)"], ["you're right", "(drop it, state the fact)"], ["you were right", "(drop it, state the fact)"],
  ["you are correct", "(drop it, state the fact)"], ["you're correct", "(drop it, state the fact)"], ["partly right", "(drop it, state the fact)"],
  ["good catch", "(drop it, state the fact)"], ["my bad", "(drop it, state the fact)"], ["the nit was mine", "(drop it, state the fact)"],
  ["i was wrong", "(drop it, state the fact)"], ["less than i first thought", "(drop it, state the fact)"],
];

// Tells that give away an AI-written message even when every word is plain (manager feedback, 2026-10): commentary
// sentences, labels used as sentences, bows tied at the end, report register. Each maps to what to do instead.
const TELLS = [
  [/\bone thing that (may|might) matter\b/i, "\"one thing that may matter\": just say the thing"],
  [/\bi (may|might) not have the full picture\b/i, "a formula hedge: ask a real question instead (\"Am I missing something?\")"],
  [/\bthat way you (never|don'?t|do not|won'?t)\b/i, "a bow-tying closing line: stop after the point"],
  [/\b(it|this) (does not|doesn'?t) block you\b/i, "a bow-tying closing line: stop after the point"],
  [/\b(that|this) is on us\b/i, "\"that is on us\": say what you will do, or nothing"],
  [/\bhere'?s why:|\bhere is why:/i, "\"here's why:\" is report register: just give the reason"],
  [/\bworth (most |the most )?attention\b/i, "\"worth most attention\": say \"the bit I'd look at is…\""],
  [/\b(hope this helps|let me know if you have any (other )?questions|happy to help)\b/i, "a stock closing: drop it"],
  [/(→|->).*(→|->)/, "an arrow chain: write it as a sentence or a short list"],
  [/\b(serves as|maintaining consistency|in terms of|it is worth noting|it's worth noting)\b/i, "report register: say it the way you'd say it out loud"],
];
const EXPANDED = /\b(do not|does not|did not|is not|are not|was not|were not|have not|has not|i am|i will|we will|it is|that is|there is|we are|you are|cannot|can not|will not|would not|should not|could not|i have|we have)\b/gi;
const CONTRACTED = /\b\w+['’](t|s|re|ll|ve|m|d)\b/i;

function lint(raw, { skipFormat = false, where = "message" } = {}) {
  const urls = (String(raw || "").match(/https?:\/\/\S+|<https?:[^>]+>/g) || []).length;
  const text = String(raw || "")
    .replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " CODE ")
    .replace(/<https?:[^>]+>|https?:\/\/\S+/g, " URL ").replace(/<[@#!][^>]*>/g, " @X ").replace(/\b[\w.+]+@[\w-]+\.[\w.]+\b/g, " EMAIL ")
    .replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, " TICKET ");
  const issues = [];
  if (/^\s{0,3}#{1,6}\s/m.test(text)) issues.push("No headings: it is a message, not a document.");
  if (!skipFormat && (text.match(/\*\*[^*]+\*\*|(^|\s)\*[^*\s][^*]*\*(?=\s|$)/g) || []).length > 2) issues.push("Too much bold: one or two words at most, or none.");
  const low = text.toLowerCase();
  const hits = PHRASES.filter(([p]) => new RegExp(`\\b${p.replace(/'/g, "['’]")}\\b`).test(low)).slice(0, 8);
  if (hits.length) issues.push(`Say it plainly: ${hits.map(([p, alt]) => `"${p}" → ${alt}`).join(", ")}`);
  const tells = TELLS.filter(([re]) => re.test(text)).map(([, why]) => why);
  // labels used as sentences, checked sentence by sentence: "About why the field is locked." / "Eligible lines."
  const sentences = text.split(/(?<=[.!?:])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  if (sentences.some((x) => /^(about|regarding) (why |how |the )?[^.?!]{0,70}\.$/i.test(x))) tells.push("a label used as a sentence (\"About why X.\"): start with the point itself");
  if (sentences.some((x) => /^[A-Z][a-z]+( [a-z]+){0,2}\.$/.test(x) && !/^(Thanks|Thank you|Sure|Done|Agreed|Sorry|Cheers|Merged|Fixed|Deployed|Yes|No|Nice|Great|Perfect|Okay|Ok)\b/.test(x))) tells.push("a two or three word label (\"Eligible lines.\"): fold it into a sentence");
  if (tells.length) issues.push(`Reads as AI-written: ${[...new Set(tells)].slice(0, 5).join("; ")}`);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
  const expanded = (text.match(EXPANDED) || []).length;
  if (words > 30 && expanded >= 2 && !CONTRACTED.test(text)) issues.push(`No contractions in ${words} words ("${(text.match(EXPANDED) || []).slice(0, 3).join('", "')}"): people write "don't", "it's", "I'll". Use contractions.`);
  const max = where === "Slack message" ? 150 : 250;
  if (!skipFormat && words > max) issues.push(`${words} words: too long for a ${where} (about ${max} at most; Slack is usually 1 to 6 lines). Keep the point and the question; detail goes to the MR or ticket.`);
  if (!skipFormat && where === "Slack message" && urls > 2) issues.push(`${urls} links in one Slack message: keep one, put the rest in the MR or ticket.`);
  return issues;
}

if (process.argv.includes("--check")) { const issues = lint(fs.readFileSync(0, "utf8"), { where: process.argv.includes("--mr") ? "MR reply" : "Slack message" }); console.log(issues.length ? issues.map((i) => "✗ " + i).join("\n") : "✓ reads fine"); process.exit(issues.length ? 1 : 0); }

let input = {}; try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
const tool = String(input.tool_name || ""), ti = input.tool_input || {};
let body = null, where = "", skipFormat = false;
if (/^mcp__plugin_slack_slack__slack_(send_message|send_message_draft|schedule_message)$/.test(tool)) {
  body = ti.message ?? ti.text ?? ti.markdown_text ?? null; where = "Slack message";
  skipFormat = SPORT_ANNOUNCEMENT_CHANNELS.includes(String(ti.channel_id || ""));   // thread_ts is irrelevant: the channel decides
}
else if (tool === "Bash") {
  const cmd = String(ti.command || "");
  if (/\bmr-feedback\.mjs\b/.test(cmd) && /--reply\b/.test(cmd)) {              // replies to review threads on an MR
    const here = cmd.match(/--reply\s+\S+\s+<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\s*\1\b/);
    const single = cmd.match(/--reply\s+\S+\s+'([^']*)'/);
    const double = cmd.match(/--reply\s+\S+\s+"((?:[^"\\]|\\.)*)"/);
    body = here ? here[2] : single ? single[1] : double ? double[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : null;
    where = "MR reply";
  } else if (/\bglab\s+mr\s+note\b/.test(cmd)) {                                // replies to reviewers on an MR
    const here = cmd.match(/<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\s*\1\b/);
    const quoted = cmd.match(/(?:-m|--message)\s+("((?:[^"\\]|\\.)*)"|'([^']*)')/);
    body = here ? here[2] : quoted ? (quoted[2] ?? quoted[3]).replace(/\\n/g, "\n").replace(/\\"/g, '"') : null;
    where = "MR reply";
  } else process.exit(0);
}
if (body == null) process.exit(0);
// The main session must have the writer agent draft it (2026-10-23: the lead judged a "late to standup" message too
// simple to delegate and wrote a generic one). Checked in the transcript: a writer launch after the user's last message.
// Subagents (the writer itself, investigators) and replies of six words or fewer are exempt.
if (!input.agent_type && input.transcript_path && String(body).trim().split(/\s+/).length > 6) {
  let lines = []; try { lines = fs.readFileSync(input.transcript_path, "utf8").trim().split("\n").slice(-400); } catch {}
  let lastUser = -1, writerAt = -1;
  lines.forEach((l, i) => { try { const e = JSON.parse(l);
    if (e.type === "user" && !e.isSidechain && (typeof e.message?.content === "string" || (e.message?.content || []).some((b) => b.type === "text"))) lastUser = i;
    if (e.type === "assistant") for (const b of e.message?.content || []) if (b.type === "tool_use" && /^(Agent|Task)$/.test(b.name) && /^writer\b/.test(String(b.input?.subagent_type || ""))) writerAt = i;
  } catch {} });
  if (lines.length && writerAt < lastUser) {
    try { fs.appendFileSync(`${process.env.CLAUDE_CONFIG_DIR || process.env.HOME + "/.claude"}/logs/voice-lint.jsonl`, JSON.stringify({ ts: new Date().toISOString(), where, ok: false, issues: ["no writer"] }) + "\n"); } catch {}
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
      permissionDecisionReason: `voice-lint: messages that go out under the user's name are drafted by the writer agent, however short. Launch it (subagent_type "writer") with: channel, reader(s), the facts, what you need from them. Then use its text here. For Slack, find where he usually posts this kind of message first (search his own messages, e.g. from:@me <topic>), and only draft into a channel he is a member of.` } }));
    process.exit(0);
  }
}
const issues = lint(body, { skipFormat, where });
try { fs.appendFileSync(`${process.env.CLAUDE_CONFIG_DIR || process.env.HOME + "/.claude"}/logs/voice-lint.jsonl`, JSON.stringify({ ts: new Date().toISOString(), where, ok: !issues.length, issues: issues.map((i) => i.slice(0, 60)) }) + "\n"); } catch {}
if (!issues.length) process.exit(0);
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
  permissionDecisionReason: `voice-lint: this ${where} goes out under the user's name and does not read like him yet. Rewrite it (lead.md "Voice") and try again:\n- ${issues.join("\n- ")}` } }));
