---
description: Run one ticket through the agentic loop — worktree, understand, plan, plan review, TDD implementation, code review, STOP before the MR, open MR, pipeline, MR review, close + learn. Resumable; merge is never automatic. Usage: /ship <TICKET> [--status | --reset | --from <stage> | --budget <usd>]
argument-hint: <TICKET | change slug> [--status] [--reset] [--from <stage>] [--budget <usd>]
allowed-tools: Bash(node ~/.claude/tools/ship-state.mjs:*), Bash(bash ~/.claude/tools/ship-inventory.sh:*), Bash(bash ~/.claude/tools/cc-ticket.sh:*), Bash(node ~/.claude/tools/cc-cost.mjs:*), Bash(cd:*), Bash(git:*), Bash(glab:*), Bash(acli:*), Bash(cat:*), Bash(ls:*), Bash(test:*), Agent, Skill
---
You are the lead running the ticket loop for `$ARGUMENTS`. You coordinate; you never edit code, never review, never judge quality yourself. Every decision below has a source of truth that is not your opinion: a command exit code, a field in a subagent's output, or the user.

State lives in `.claude/ship/<TICKET>/state.json` (managed by `node ~/.claude/tools/ship-state.mjs`, called `ship-state` below). Read it first, act from it, write every transition to it. Never keep the loop in your head.

Conventions used in every stage:
- **Launch** = `task` with description `"<TICKET> · <stage>"` and the brief given. Never another agent type.
- **Gate** = a condition checked against a command result or a field in the output. Failing a gate ⇒ `ship-state attempt <T> <gate>`; exit code 2 ⇒ STOP (below). Never a third round.
- **STOP** = `ship-state stop <T> "<reason>"`, then tell the user in ≤ 6 lines what happened, what you need, and the exact options; end your turn. Do nothing else until they answer.
- **Budget** = after every stage: `ship-state cost <T>` (exit 2 ⇒ STOP with the amount).
- A subagent output that does not match its format counts as a failed gate. Do not "read between the lines".
- A hook `deny` is terminal for that stage: report its text verbatim, do not work around it.
- **Only STOPs are questions.** Between two STOPs the loop runs on its own: after a resolved STOP or a passed gate, go to the next stage without asking. Housekeeping on the unpushed branch (reword `wip` messages, squash fixups, rebase) and corrections to `.claude/ship/<T>/*` (plan prose proven wrong by a measurement) are the lead's calls: do them, say so in one line. The user decides plans (gate-human), the MR (stop-mr), Jira comments and merges — nothing else.
- **Briefs are the contract.** Send each stage's brief as written below, filled in; do not add extra asks ("also verify X against the real files", "also check Y"). If something must be verified, it belongs to the stage whose job that is (facts → understand/investigator, code → review-code). An inflated brief turns a 3-minute plan review into a 15-minute audit.

## 0. Arguments and resume
Parse: `T` = first argument (ticket key like `APR-1234`, or a change slug from `/plan`). Flags: `--status` (print `ship-state status T --json` summarised in 5 lines and stop), `--reset` (`ship-state reset T` then continue as new), `--from <stage>` (force the stage, only when the user asks), `--budget <usd>` (`ship-state set T budget_usd=<usd>`).
Then:
```bash
node ~/.claude/tools/ship-state.mjs init <T>        # idempotent; prints "exists: … stage X" when resuming
node ~/.claude/tools/ship-state.mjs status <T>
```
If it exists, continue from `stage` (respecting `attempts`); tell the user in one line where you are resuming from. If `stopped` is set, repeat the STOP question instead of continuing.

## 1. prepare
First, what already exists (read-only, one command):
```bash
bash ~/.claude/tools/ship-inventory.sh <T> --human   # branches, worktrees, MRs (open/closed/merged), openspec, /ship state, Jira
```
Show its output to the user as is, then act on `situation`:
- `fresh` → continue below.
- `branch-only` → reuse the branch/worktree; understand runs against the ticket **and** `git log origin/main..<branch>`; plan only what is missing. If the worktree has uncommitted files, STOP and ask (commit, stash or discard is the user's call).
- `mr-open` → reuse; skip to stage 9/10 (`ship-state set <T> mr.iid=<iid> mr.url="<url>"`, verdicts unknown ⇒ run review-mr first, treat its verdict as the code verdict); an MR with review threads by others ⇒ stage 10b.
- `mr-closed-unmerged` → STOP and ask: reuse the branch (rebase on origin/main, then implement any gap and review-code onwards) or start fresh from main. Never decide this yourself.
- `merged` → STOP: say it is merged and ask what the user wants.
- `ship_state` present → that is a resume: continue from its stage (0.), the inventory is only informative.

Goal of this stage: the session runs **in** the ticket's worktree (the shell's working directory does not persist between Bash calls, so the loop can only run correctly in a session started there: hooks, the status line and the implementer's own worktree all follow the session's directory).
```bash
bash ~/.claude/tools/cc-ticket.sh <T>           # creates or reuses the worktree; ff-syncs main; prints the path
git rev-parse --show-toplevel                   # where THIS session lives
```
- If the printed worktree path equals this session's toplevel → continue: `git status -sb`, then `node ~/.claude/tools/ship-state.mjs init <T>`.
- Otherwise → initialise the state **in the worktree** (`cd <path> && node ~/.claude/tools/ship-state.mjs init <T> && node ~/.claude/tools/ship-state.mjs stage <T> understand`) and STOP with exactly this message, then end your turn:
  > The worktree for <T> is ready at <path>. This loop must run in a session started there. Open a terminal and run: `claude @ticket <T>` then `/ship <T>` — it resumes from the saved state. Nothing else was changed.
  Never continue from here with `cd <path> && …` prefixes: subagents and hooks would still act on this worktree.
Gate: `cc-ticket` exit 0 and `git status --porcelain` empty (untracked files are fine). Divergence or dirty tree ⇒ STOP (show `git status -sb`).
Sweep: `bash ~/.claude/tools/cc-sweep.sh --quiet` — merged tickets' worktrees and branches of this repo are removed (never this one, never a dirty or live one); one line if it removed something.
Shared folders: `bash ~/.claude/tools/cc-link.sh` — `openspec/` is untracked in this repo and lives in the main tree; the link makes it visible here so specs are read and written in one place (never copied). Every later `openspec …` command and every `openspec/changes/<slug>` path is relative to this worktree and resolves through the link.
Jira: `acli jira workitem view <T> --fields status` — if the status is `To Do` (or `Open`, `Backlog`, `Selected for Development`), move it: `acli jira workitem transition --key <T> --status "In Progress"` and say so in one line. Any other status (already In Progress, In Review, Done…) is left alone and reported. This is the one Jira transition /ship does on its own; every other transition is the user's.
Sync: `bash ~/.claude/tools/sync-check.sh --fix` — fetches, rebases the ticket branch on origin/main when it is behind (clean tree), reports a diverged upstream. Exit 1 after --fix (conflicts, diverged) ⇒ STOP with its output.
Map: `node ~/.claude/tools/repo-map.mjs` (prints `fresh:` and costs nothing when a map exists; builds one for ~$0.05 otherwise). Every later brief says "start from the map".
If a spec exists for this ticket — `openspec/changes/<slug>/` or `.claude/ship/<T>/spec.md` (written by `/plan`) — record it: `ship-state set <T> spec="<path>"`. (`openspec/` is often untracked: a new worktree does not inherit it; that is fine, it is optional.)
`ship-state stage <T> understand`.

## 2. understand
Launch: `understand: <T>. Read the ticket (acli jira workitem view <T>, or the spec at <spec path> if set), the code it touches (start from the codebase map: docs/codebase-map.md or ~/.claude/knowledge/repos/<repo>.md, plus ~/.claude/knowledge/lessons.md lines for this repo; bulk-read for anything big), nearby tests and related merged MRs. Return the understand format: Summary, Acceptance (testable criteria), Touches, Facts needed before planning (with the exact read-only command and who can run it), Conditional scope, Open questions with defaults, Sources.`
Gate: output has `Mode: understand`, ≥ 1 `Acceptance` line and a `Facts needed before planning:` line (even if `none`). Otherwise ⇒ `attempt understand`; second failure ⇒ STOP.
Save: `ship-state set <T> 'acceptance=<JSON array of the criteria>'` and write the whole output to `.claude/ship/<T>/brief.md` (`cat > … <<'EOF'`).
Open questions: if any has no reasonable default, ask the user **once** (all questions in one message) and wait; with answers (or "assume"), append them to brief.md. Never ask twice.

## 2b. gate-facts  (human, only when `Facts needed before planning` is not `none`)
Nothing gets planned on an assumption that a command can replace. `ship-state stage <T> gate-facts`, then:
- `who: agent` facts → **one** `lookup:` investigator with the whole list ("lookup: <T> facts before planning: 1. <fact> — <command> 2. …; return each as `<fact> = <value> (<command>)`, and say `inferred, not measured` when a command only suggests it"). Run a command yourself only when there is a single fact and it is one read-only line. Append the answers as `Facts: <fact> = <value> (<command>, <date>)` to brief.md. No implementer is launched before `plan`: nothing in the repo changes during understand or gate-facts (brief.md is written with `cat > … <<'EOF'`).
- `who: human` is the last resort. Before labelling a fact human, check whether you can run it read-only yourself: `aws-vault list` (a profile with a live session counts), `glab auth status`, `acli jira auth status`, the Atlassian MCP. If a live session covers it, it is `who: agent`. Only what truly needs the user's hands or judgement → STOP with, per fact, the exact command to run (profile, environment, query) and what to paste back. The user runs it or answers "run it as read-only with profile X" — then the investigator runs it. Append the results to brief.md the same way.
- **Persist the facts at once.** As soon as the facts are in, post them as a Jira comment (`Measured before planning (<date>):` + one line per fact with its command) — `brief.md` dies with the worktree, the ticket does not. Do not wait for close.
- **Does the ticket still stand?** Compare the facts with the ticket's premise. If a fact says the work is **not needed** (zero rows, feature already on, nothing to migrate), **belongs elsewhere** (another repo, service, team or AWS account), or **the premise is wrong** (the bug is not where the ticket says) ⇒ `ship-state stage <T> gate-facts` stays, and STOP: "The measurement refutes the ticket: <one line>. Evidence: <facts>. Options: (a) close as Won't Do / re-assign to <owner> with this comment, (b) re-scope to <what is left here>, (c) continue as written." Never invent a smaller deliverable (a docs note, a comment in code) to keep the loop moving — a docs-only MR is plan only if the user picks it. Note it in Learn.
- `Conditional scope` present and the fact confirms the conditional part **is** needed → plan it as written.
Every later brief (plan, implement, review) carries the `Facts:` lines. A plan that builds the conditional part without the fact is a review-plan REQUEST CHANGES, not a judgement call.
`ship-state stage <T> plan`.

## 3. plan
Skip when `spec` is set and it already lists steps/tasks (OpenSpec `tasks.md` or a spec with steps): `ship-state set <T> 'plan={"source":"spec"}'` and go to 5 (the spec was reviewed by `/plan`).
Launch: `plan: <T>. Brief: <contents of brief.md>. acceptance: <the criteria>. Repo conventions: <repo CLAUDE.md if present>. Produce the plan format (Goal, Complexity, Risk, Files, Steps with files and done-when, Covers, Open questions, Risks, Out of scope). Every acceptance criterion must be covered by a step. If the repo has openspec/, also write the OpenSpec proposal for change <T-slug>.`
Gate: output has `Steps:` with ≥ 1 step containing `done when`, and `Risk:` and `Files:` lines. Save the plan to `.claude/ship/<T>/plan.md` and `ship-state set <T> plan.risk=<low|medium|high> plan.files=<n> plan.steps=<count>`.
`ship-state stage <T> review-plan`.

## 4. review-plan
Launch: `review plan: <T>. Plan: <plan.md>. acceptance: <criteria>. spec: <path or none>. Return the reviewer JSON (verdict, findings with path "plan" and line = step number).`
Gate: JSON parses and `verdict` is `APPROVE`. Record: `ship-state verdict <T> plan "<verdict>"`.
- `APPROVE` ⇒ next.
- Otherwise ⇒ `ship-state attempt <T> review-plan` (exit 2 ⇒ STOP with the findings) and `SendMessage` the same planner with the findings verbatim ("Reviewer findings to address: …; return the full plan again"); then review again.
Human gate: if `plan.risk == high` or `plan.files > 15`, **or the plan's Goal differs from the ticket's** (re-scoped after gate-facts, docs-only for a code ticket, work moved to another repo) ⇒ `ship-state stage <T> gate-human`, show the plan (Goal, Risk, Files, Steps titles) and STOP: "approve the plan, change it, or abort". On approval continue.
`ship-state stage <T> implement`.

## 5. implement
Launch **one implementer run for the whole plan**. Split into several runs only when the plan has more than 6 steps, or when the planner marked groups of steps as independent (different modules/services); then one run per group, in order, each with its own gate. `Risk: high` does **not** split the work: the risk is covered by the plan approval and the reviews, not by fragmentation (which multiplies full test-suite runs and cold contexts). Tell the implementer to run the tests of the files it touches while iterating and the full relevant suite plus the linter once at the end.
`change: <T>. Plan: <plan.md or the spec tasks>. Step(s): <which>. acceptance: <criteria>. Work TDD: for each step write or extend the test, see it fail, implement, see it pass; run the full relevant suite and the linter at the end. Commit on this branch with conventional messages. Return the implementer format exactly (Status, Branch, Commits, Changed, Tests: <cmd> → passed X / failed Y, Lint, Notes). Never push.`
Where did the commits land? The implementer works in this worktree, so `git log --oneline origin/main..HEAD` must list its commits. If its report names another branch (an agent with `isolation: worktree` commits in a temporary worktree), integrate before anything else: `git merge --ff-only <that branch>` here, then `git worktree remove <its path>` and `git branch -d <that branch>`; a non-fast-forward means the ticket branch moved meanwhile → STOP.
Gate (checked by the `ship-gates` hook on SubagentStop and mirrored in `state.implement_result`): `Status: done`, `Tests: … failed 0`, `Lint: clean`. Read `node ~/.claude/tools/ship-state.mjs get <T>` → `implement_result.ok`.
- `ok: true` ⇒ next.
- `Status: partial|blocked` ⇒ STOP with the implementer's `Notes`/`Blocked on` verbatim (this is not a retry case: something is missing).
- No format / red tests after the hook's one bounce ⇒ `attempt review-code` counts this round; `SendMessage` the same implementer once with "your previous run ended with: <Tests line>. Fix and report again"; second time ⇒ STOP.
If `openspec/` is used: the implementer ticks `tasks.md`; run `openspec validate <slug>` yourself and treat a failure as a failed gate.
`ship-state stage <T> review-code`.

## 6. review-code
Run the skill: `/review-mr` with no target (current branch vs main; it is your own work ⇒ scope full, nothing posted) — or launch the reviewer directly with `Target: current branch. workdir: <worktree>. scope: full. check spec: <yes if spec>` and the same JSON contract.
Before launching the reviewer: `bash ~/.claude/tools/sync-check.sh --fix` must exit 0 — a review of a branch that is behind main reviews code that will not be what gets merged. Rebase (then `git push --force-with-lease` if the branch was already pushed and the MR exists) and only then review.
Gate: JSON parses; no finding with severity `Critical` or `Major`; sync-check exit 0. Record: `ship-state verdict <T> code "<APPROVE if no Critical/Major, else REQUEST CHANGES>"` (record APPROVE even if the reviewer wrote NEEDS DISCUSSION but left only Minor/Question/Suggestion findings; keep those for the MR description).
- APPROVE ⇒ next.
- Otherwise ⇒ `ship-state attempt <T> review-code` (exit 2 ⇒ STOP with the findings), `ship-state stage <T> implement`, and **continue the same implementer** with `SendMessage`: `Fix these review findings, nothing else: <severity path:line message fix>. Then run the suite and the linter and report the implementer format again.` (it keeps its context and model; a fresh launch only if it is gone or near its turn budget) — then review again.
`ship-state stage <T> stop-mr`.

## 7. stop-mr  (human)
Build the MR text from `~/.claude/templates/mr.md`: title `<type>(<scope>): <summary> (<T>)`, body from plan/spec + `git log origin/main..HEAD --oneline` + `git diff --stat origin/main..HEAD` + minor findings as "Follow-ups". Then STOP and show: title, the body, `diff --stat`, `ship-state status` (cost). Options: "open it", "open as draft", "change: …", "abort". Wait.

## 8. open-mr
On "open": `git push -u origin <branch>` then `glab mr create --title "<title>" --description "$(cat .claude/ship/<T>/mr.md)" --source-branch <branch> --target-branch main [--draft] --remove-source-branch`. (The `ship-gates` hook allows both only with `verdicts.code = APPROVE`.)
Gate: exit 0 and an MR URL. Save: `ship-state set <T> mr.iid=<iid> mr.url="<url>"` · `ship-state stage <T> pipeline`. Errors ⇒ STOP with glab's message.

## 9. pipeline
No subagent and no hand-rolled `glab api` calls: run `bash ~/.claude/tools/ci-wait.sh <iid>` (polls the MR's head pipeline for up to 30 min, exit 0 success · 1 failed · 2 timeout · 3 api error; prints `Finding:`, `Failed jobs:`, `Evidence (<job>):`). One Bash call with `timeout: 1900000`. Use its output verbatim as the evidence below.
Gate: exit 0. Save `ship-state set <T> pipeline.status=<status>`.
- `failed` ⇒ `ship-state attempt <T> pipeline` (exit 2 ⇒ STOP) then launch `root cause: <T> pipeline failure: <evidence>` (investigator), then `ship-state stage <T> implement` and relaunch **implement** with the cause and the fix to make; after it passes review-code (stage 6 runs again, its attempts counter continues), push (the MR exists, the hook allows it) and return to 9.
- `timeout|canceled` ⇒ STOP.
`ship-state stage <T> review-mr`.

## 10. review-mr
`bash ~/.claude/tools/sync-check.sh --fix` first (main moves while the pipeline runs); if it rebased, `git push --force-with-lease` and wait for the new pipeline (stage 9 again) before reviewing. Then `/review-mr !<iid>` (own MR ⇒ full, chat only). Gate as in stage 6; findings ⇒ same loop back to implement (shares the `review-code` counter). Record `ship-state verdict <T> mr <verdict>`.
`ship-state stage <T> feedback`.

## 10b. feedback  (peers and bots)
The MR now belongs to the reviewers. This stage is a loop that runs each time you are asked to continue (`/ship <T>`), until the MR is approved and no thread waits on you.
1. `node ~/.claude/tools/mr-feedback.mjs --mr <iid>` — open threads started by others that are waiting on you (🤖 = bot), plus approvals and pipeline. Do not read the MR page yourself.
2. Triage every thread into exactly one bucket, in ≤ 1 line each:
   - **accept** → a code change. Collect all accepted threads into ONE implementer run: `change: <T>. Address MR feedback, nothing else: <thread id · path:line · what to change>`; then stage 6 (review-code, shares its counter), push (the MR exists, the hook allows it).
   - **answer** → no code change; a reply with the reason or the evidence (quote a command output, a line, a doc). Disagreeing is fine when you have the evidence; "I think" is not evidence.
   - **ask** → the comment is unclear; one reply with the precise question.
   A bot finding gets the same treatment as a human one, except that a bot false positive is "answer" with the reason, never silently resolved.
3. STOP: show the triage (id · bucket · the reply text, or the commit for accepted ones) and wait for "post". Replies are written to GitLab in the user's name: never post without that word.
4. On "post": for each thread `mr-feedback --reply <id> "<text>"` (accepted ones: "Done in <sha>: <one line>"); resolve only threads you answered with a change or a fact (`--resolve <id>`), never a human's open question; then re-run step 1.
5. Every round starts with `bash ~/.claude/tools/sync-check.sh --fix`: a rebase after peers' approval re-runs the pipeline but keeps the approvals (GitLab keeps them unless the project resets approvals on push — if it does, say so and ask for re-approval). Never push a branch that is behind main.
6. Exit: `approvals: approved`, "no open threads waiting on you" and sync-check exit 0 (rebased on the current origin/main) ⇒ `ship-state stage <T> close`. An approved MR that is behind main is not ready: rebase, let the pipeline pass, then close. Three rounds without reaching that ⇒ STOP and report which threads are stuck and why. Never approve, never merge, never resolve a thread you did not answer.

## 11. close + learn
1. Jira: propose the comment text and **ask the user before posting**; on yes: `acli jira workitem comment create --key <T> --body "<text>"` (or the equivalent your acli version supports). No status transitions unless asked. Shape of the comment — Jira keeps line breaks literally, so **never hard-wrap lines** (one paragraph = one line, blank line between paragraphs), keep it short, and use this skeleton:
   ```
   MR !<iid> (<draft|ready>): <url>

   What: <one line>.
   Measured: <what was measured, where, when — or "not measured">.
   To test: `<one command>` (<n> assertions, <what it needs>).
   Hold: <only if something must not happen on merge — one line>.
   ```
2. Learn: look at `ship-state get <T>` history (attempts, verdicts, hook bounces, pipeline failures) and `logs/ship-gates.jsonl`. Lessons come from those records and from command output only — never from your own narrative of the session. Write **at most 3** lessons, each one line, each to its place:
   - repo lesson (a gotcha future work here needs) → append `- <date> <T>: <lesson>` under `## Gotchas` in `docs/codebase-map.md` if the file exists (separate commit on this branch, it ships with the MR), else in `~/.claude/knowledge/repos/<repo>.md` (kept across `/map --refresh`);
   - personal / cross-repo lesson → append `- <date> <T> <repo>: <lesson>` to `~/.claude/knowledge/lessons.md`;
   - process lesson (router chose badly, a gate misfired, a prompt was unclear) → append to `~/.claude/knowledge/process.md` for `/retro`.
   Save them: `ship-state set <T> 'lessons=<JSON array>'`. No lesson is also fine: say so.
3. `bash ~/.claude/tools/sync-check.sh` exit 0 (still rebased, pipeline green on that sha) — otherwise back to 10b. Then `ship-state stage <T> ready-for-merge` and report in ≤ 8 lines, ending with the one line the user runs after merging — `bash ~/.claude/tools/cc-clean.sh <T> --jira-done` (archives the ship state, removes worktree and branches, comments and closes the ticket). Never remove this worktree yourself: the session lives in it.
Report: MR URL, pipeline, review verdicts, attempts per gate, cost (`ship-state status`), lessons. **The merge is the user's.**

## Anything else
- `--status`: `ship-state status <T> --json` → 5 lines: stage, attempts, verdicts, MR, cost; plus `stopped.reason` if any.
- If the user says "stop", "pause" or asks something unrelated mid-loop: answer, leave the state as is; `/ship <T>` resumes.
- **Merged while the loop was still in feedback** (the user merged by hand): `/ship <T>` sees `glab mr view` = merged → skip to stage 11 (close + learn) immediately — the lessons are the point, the merge is done. Then `ready-for-merge` and the `cc-clean` line.
- Work done outside the loop while stopped (a review run by hand that returned APPROVE, a fix committed on the branch) counts, but only once it is in the state: `ship-state verdict <T> code APPROVE`, `ship-state stage <T> <stage>`. The gates read `state.json`, not the conversation — record first, then push/open.
- If `state.json` is missing but a branch/worktree exists (work started outside /ship): `init`, then run stage 1 and jump to the first stage whose artefact is missing (no acceptance ⇒ understand; no plan and no spec ⇒ plan; commits already there ⇒ review-code). Say what you inferred.
