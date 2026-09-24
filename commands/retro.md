---
description: Weekly retro of the harness itself — read the logs of the last N days (stages, cost, subagents, router, gates, guard, shunt, open process lessons), propose at most 3 concrete adjustments with the exact command for each, apply them on the user's OK, record the retro. Usage: /retro [--days 7]
argument-hint: [--days 7]
allowed-tools: Bash(node:*), Read
---
# /retro $ARGUMENTS

Nothing here needs a subagent. Numbers first, then judgement, then the user, then the change.

## 1. The numbers
```
node ~/.claude/tools/retro-report.mjs $ARGUMENTS
```
Read it whole. It is short and every line is a fact from a log; do not re-derive anything from memory of past sessions.

## 2. Judgement — at most 3 proposals
Look for these signals, in this order, and stop at 3:
- **Time**: a subagent base whose p90 is > 2× its median, or any run > 30 min → the row for that use case in `~/.claude/router.json` (lower the model or effort, or cap `maxTurns` in the agent file), or a brief that inflates the work.
- **Cost**: a branch far above the others, or a use case landing on `opus`/`sol` at `high` for routine work → move the row one tier down.
- **Router**: launches with no router entry (hook killed) → hook timeout; many "decided by rules (Jev timeout)" → `jevTimeoutMs`; role mismatches → the prefixes table.
- **Gates**: a gate that denies repeatedly for the same reason → its message or the stage that should have recorded the fact; a gate that never fired in a week with tickets → check it is registered.
- **Guard**: denies the user then confirmed → narrow the `destructive` definition in `hooks/bash-guard.mjs`.
- **Shunt**: big reads redirected = 0 while sol/pro agents ran → check `read-shunt` is installed for those variants.
- **Process lessons**: each open lesson maps to one of the above or is closed as "noted".

Each proposal has: the signal (a number from the report), the change (one line), and the exact command that applies it, for example:
```
node -e 'const f=process.env.HOME+"/.claude/router.json",fs=require("fs"),d=JSON.parse(fs.readFileSync(f));d.useCases["review-plan"].medium=["pro","medium"];fs.writeFileSync(f,JSON.stringify(d,null,2)+"\n")'
```
Read the target file first (`~/.claude/router.json`, an agent file) so the command edits what is really there. No proposal without a number behind it; "could be better" is not a signal. If nothing in the report justifies a change, say so — an empty retro is a good retro.

## 3. The user
Show the ≤3 proposals and STOP: "apply 1, 2, 3 / some / none". This is the one question of /retro.

## 4. Apply and record
Run the accepted commands one by one and show each result. Then:
```
node ~/.claude/tools/retro-report.mjs --close "<one line per change applied; 'no change' if none>; lessons reviewed: <n>"
```
That appends `## Retro <date>` to `~/.claude/knowledge/process.md`; lessons above it count as handled. Router and hook changes apply to the next launch; agent-file changes need a new `claude` session — say which is which. Nothing else: no git, no MRs, no Jira.
