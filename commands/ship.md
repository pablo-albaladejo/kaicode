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
- `mr-open` → reuse; skip to stage 9/10 (`ship-state set <T> mr.iid=<iid> mr.url="<url>"`, verdicts unknown ⇒ run review-mr first, treat its verdict as the code verdict).
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
Map: `node ~/.claude/tools/repo-map.mjs` (prints `fresh:` and costs nothing when a map exists; builds one for ~$0.05 otherwise). Every later brief says "start from the map".
If a spec exists for this ticket — `openspec/changes/<slug>/` or `.claude/ship/<T>/spec.md` (written by `/plan`) — record it: `ship-state set <T> spec="<path>"`. (`openspec/` is often untracked: a new worktree does not inherit it; that is fine, it is optional.)
`ship-state stage <T> understand`.

## 2. understand
Launch: `understand: <T>. Read the ticket (acli jira workitem view <T>, or the spec at <spec path> if set), the code it touches (start from the codebase map: docs/codebase-map.md or ~/.claude/knowledge/repos/<repo>.md, plus ~/.claude/knowledge/lessons.md lines for this repo; bulk-read for anything big), nearby tests and related merged MRs. Return the understand format: Summary, Acceptance (testable criteria), Touches, Open questions with defaults, Sources.`
Gate: output has `Mode: understand` and ≥ 1 `Acceptance` line. Otherwise ⇒ `attempt understand`; second failure ⇒ STOP.
Save: `ship-state set <T> 'acceptance=<JSON array of the criteria>'` and write the whole output to `.claude/ship/<T>/brief.md` (`cat > … <<'EOF'`).
Open questions: if any has no reasonable default, ask the user **once** (all questions in one message) and wait; with answers (or "assume"), append them to brief.md. Never ask twice.
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
- Otherwise ⇒ `ship-state attempt <T> review-plan` (exit 2 ⇒ STOP with the findings) and relaunch **plan** with the findings appended verbatim ("Reviewer findings to address: …"); then review again.
Human gate: if `plan.risk == high` or `plan.files > 15` ⇒ `ship-state stage <T> gate-human`, show the plan (Goal, Risk, Files, Steps titles) and STOP: "approve the plan, change it, or abort". On approval continue.
`ship-state stage <T> implement`.

## 5. implement
Launch **one implementer run for the whole plan**. Split into several runs only when the plan has more than 6 steps, or when the planner marked groups of steps as independent (different modules/services); then one run per group, in order, each with its own gate. `Risk: high` does **not** split the work: the risk is covered by the plan approval and the reviews, not by fragmentation (which multiplies full test-suite runs and cold contexts). Tell the implementer to run the tests of the files it touches while iterating and the full relevant suite plus the linter once at the end.
`change: <T>. Plan: <plan.md or the spec tasks>. Step(s): <which>. acceptance: <criteria>. Work TDD: for each step write or extend the test, see it fail, implement, see it pass; run the full relevant suite and the linter at the end. Commit on this branch with conventional messages. Return the implementer format exactly (Status, Branch, Commits, Changed, Tests: <cmd> → passed X / failed Y, Lint, Notes). Never push.`
Where did the commits land? The implementer works in this worktree, so `git log --oneline origin/main..HEAD` must list its commits. If its report names another branch (an agent with `isolation: worktree` commits in a temporary worktree), integrate before anything else: `git merge --ff-only <that branch>` here, then `git worktree remove <its path>` and `git branch -d <that branch>`; a non-fast-forward means the ticket branch moved meanwhile → STOP.
Gate (checked by the `ship-gates` hook on SubagentStop and mirrored in `state.implement_result`): `Status: done`, `Tests: … failed 0`, `Lint: clean`. Read `node ~/.claude/tools/ship-state.mjs get <T>` → `implement_result.ok`.
- `ok: true` ⇒ next.
- `Status: partial|blocked` ⇒ STOP with the implementer's `Notes`/`Blocked on` verbatim (this is not a retry case: something is missing).
- No format / red tests after the hook's one bounce ⇒ `attempt review-code` counts this round; relaunch once with "your previous run ended with: <Tests line>. Fix and report again"; second time ⇒ STOP.
If `openspec/` is used: the implementer ticks `tasks.md`; run `openspec validate <slug>` yourself and treat a failure as a failed gate.
`ship-state stage <T> review-code`.

## 6. review-code
Run the skill: `/review-mr` with no target (current branch vs main; it is your own work ⇒ scope full, nothing posted) — or launch the reviewer directly with `Target: current branch. workdir: <worktree>. scope: full. check spec: <yes if spec>` and the same JSON contract.
Gate: JSON parses; no finding with severity `Critical` or `Major`. Record: `ship-state verdict <T> code "<APPROVE if no Critical/Major, else REQUEST CHANGES>"` (record APPROVE even if the reviewer wrote NEEDS DISCUSSION but left only Minor/Question/Suggestion findings; keep those for the MR description).
- APPROVE ⇒ next.
- Otherwise ⇒ `ship-state attempt <T> review-code` (exit 2 ⇒ STOP with the findings), `ship-state stage <T> implement`, and relaunch **implement** with `change: <T>. Fix these review findings, nothing else: <severity path:line message fix>` then review again.
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
`/review-mr !<iid>` (own MR ⇒ full, chat only). Gate as in stage 6; findings ⇒ same loop back to implement (shares the `review-code` counter). Record `ship-state verdict <T> mr <verdict>`.
`ship-state stage <T> close`.

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
3. `ship-state stage <T> ready-for-merge` and report in ≤ 8 lines: MR URL, pipeline, review verdicts, attempts per gate, cost (`ship-state status`), lessons. **The merge is the user's.**

## Anything else
- `--status`: `ship-state status <T> --json` → 5 lines: stage, attempts, verdicts, MR, cost; plus `stopped.reason` if any.
- If the user says "stop", "pause" or asks something unrelated mid-loop: answer, leave the state as is; `/ship <T>` resumes.
- Work done outside the loop while stopped (a review run by hand that returned APPROVE, a fix committed on the branch) counts, but only once it is in the state: `ship-state verdict <T> code APPROVE`, `ship-state stage <T> <stage>`. The gates read `state.json`, not the conversation — record first, then push/open.
- If `state.json` is missing but a branch/worktree exists (work started outside /ship): `init`, then run stage 1 and jump to the first stage whose artefact is missing (no acceptance ⇒ understand; no plan and no spec ⇒ plan; commits already there ⇒ review-code). Say what you inferred.
