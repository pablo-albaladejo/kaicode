---
description: Close a long session cleanly so a fresh one continues with a small context. Writes .claude/handoff.md with the state that matters and prints the one command to continue. Use when the statusline shows ⚠ /handoff (context over 150k) or before switching to another ticket.
---
You are handing this session over to a fresh one. Every turn re-reads the whole context, so a long session is the most expensive thing the harness does (retro 2026-10-23). Do not start new work.

1. Let running subagents finish or stop them; never leave a half-applied change. If a step is mid-way, commit what is green (on a ticket branch) or note exactly what is uncommitted.
2. Write `.claude/handoff.md` in the current worktree (or the main checkout if there is none), English, at most 60 lines:
   - `Ticket:` key(s) and `ship-state status` / `plan-state status` line for each
   - `Branch:` name, `git log --oneline origin/main..HEAD`, `git diff --stat` (uncommitted)
   - `Done in this session:` 3 to 6 lines, facts only
   - `Next step:` the exact next action, with the command or stage to run
   - `Open:` questions waiting on the user or on another team, with who owns each
   - `Do not redo:` things already measured or decided, with their result, so the next session does not repeat them
   - `Watch out:` anything that broke or surprised you (one line each)
3. Tell the user, in two lines: where the handoff is and the command to continue, e.g. `claude @ticket APR-1234` then `/ship APR-1234` (it resumes from the ship state) or `continue from .claude/handoff.md`.

The next session reads `.claude/handoff.md` first and deletes nothing in it until the work it describes is done.
