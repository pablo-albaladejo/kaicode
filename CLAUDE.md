# Global instructions

## Cost and delegation
- Keep the main conversation small. Do not read more than two files directly: delegate reading,
  searching and investigating to subagents, which return summaries, never whole files or diffs.
- Do not pass `model:` when launching a subagent. A hook routes every launch to the right model
  from the task (use case × complexity). Only pass a model if the user explicitly asks for one.
- Write the task for a subagent as you would brief a colleague: goal, files or area, constraints,
  and the exact shape of the answer you need. Mark risky work with `complexity: high`
  (production data, auth, migrations, concurrency) so it is routed to a strong model.
- implement → reviewer loop: at most 2 iterations. On the third, stop and report to the user.
- Between the spec phase and the implementation phase, suggest `/compact focus on the approved
  specs` or `/clear`.

## Choosing a subagent
Launch `task` with a clear brief (kind of work first); the router assigns the specialist below from the brief, plus model and effort. Naming a specialist directly is allowed when certain.
| Need | Subagent | Notes |
|---|---|---|
| Find code, explain how something works | `Explore` | read-only, no commands that change state |
| Status or lookups (MR, pipeline, ticket, aws), root-cause of a failure | `investigator` | read-only, has the CLIs (glab, acli, aws-vault, git) |
| Plan a ticket, OpenSpec proposal, design decision / ADR | `planner` | read-only; writes only under openspec/changes/ or docs/adr/ |
| Change code: feature, bug fix, refactor, tests, migration, CI, docs | `implementer` | own worktree; returns a summary |
| Review an MR or branch diff | `reviewer` (via `/review-mr`) | read-only; findings are posted as inline MR comments |
Do not use `general-purpose`. One subagent per task; do not chain a subagent into another.
Agents named `<name>--low|medium|high|max` are effort variants managed by the router: never launch
them directly, launch the base name.

## Git workflow
- Every ticket has its own worktree, branched from a synced `origin/main`: start sessions with
  `claude @ticket <TICKET>`. Editing on `main` or in the main working tree is blocked by a hook;
  if you hit it, tell the user instead of working around it.
- Never push, force-push, rebase shared branches, or delete branches unless the user asks in the
  same conversation. Never run `git checkout main` / `git switch main` inside a session.

## OpenSpec
- The `openspec` CLI is installed globally. Commands: `/opsx:explore`, `/opsx:propose`,
  `/opsx:apply`, `/opsx:update`, `/opsx:sync`, `/opsx:archive`.
- Read `openspec/specs/` before proposing changes: it is the living documentation of the system.
- Specs are OpenSpec changes (`openspec/changes/<id>/`); in repos without OpenSpec, `SPEC-*.md`.
  Start the proposal/spec with `complexity: low | medium | high`.
- If the repo has no `openspec/`, ask before running `openspec init --tools claude`.
- `/opsx:apply` delegates implementation to `implementer` and review to `reviewer`.

## GitLab and Jira
- No MCPs: use `glab` for GitLab and `acli` for Jira. Both are already authenticated; never ask
  for or print tokens. Filter output (`--output json | jq`, `head`) to keep the context small.
- `/review-mr` posts inline review comments by design. Anything else that writes to GitLab or
  Jira (approve, merge, close, transition, assign, general notes) requires confirmation.

## Gateway
- All traffic goes through the Aircall LLM Gateway (traced in Langfuse). Use only gateway model
  ids (`fireworks/deepseek-v4.1-flash`, `gpt-6-sol`, `claude-opus-5-5`, …), never the aliases
  `haiku` / `sonnet` / `opus` unless the user asks.

## One session, one worktree
The session works in the worktree it was started in (`wt:` in the status line); `cd` does not persist between Bash calls, so a session cannot move. Another ticket: `bash ~/.claude/tools/cc-ticket.sh <TICKET>` (or `/ticket <TICKET>`) prepares its worktree, then `claude @ticket <TICKET>` in a new terminal. Never operate another worktree from here with `git -C` or `cd … &&`.
