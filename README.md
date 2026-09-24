# kaicode

An agentic SDLC harness for Claude Code running through an LLM gateway. It turns a plain `claude` session into a
cost-aware, role-based loop: a `lead` that only coordinates, specialised subagents picked per task by a classifier
(Jev) together with the model and effort, one worktree per ticket, hard gates as hooks, and a resumable `/ship` loop
from ticket to merge-ready MR.

Everything here is configuration, small Node scripts and Markdown: no build, no daemon. It installs into `~/.claude`
from a staging copy (`~/.claude-work`) with idempotent `apply-*.sh` scripts.

## What is in here

| Folder / file | Purpose |
|---|---|
| `agents/` | Primary agents (`lead`, `solo`), the `task` entry point, and the five roles: `Explore`, `investigator`, `planner`, `implementer`, `reviewer`. Effort/model variants (`<role>--<alias>-<effort>.md`) are generated, not committed. |
| `commands/` | `/ship` (ticket loop), `/review-mr`, `/ticket`, OpenSpec helpers. |
| `hooks/` | `model-router` (Jev → role · model · effort), `intent-router`, `bash-guard`, `read-shunt`, `ship-gates`, `guard-branch`, loggers. |
| `tools/` | `ship-state`, `ship-inventory`, `cc-ticket`, `cc-cost`, `cc-models`, `bulk-read`, `code-write`, `mr-checkout`, `mr-post`, `gen-effort-variants`, `jev-tune`, `gateway-smoke`. |
| `knowledge/`, `templates/` | User-level knowledge skeleton (index, lessons, process, relations) and the MR description template. |
| `router.json`, `pricing.json`, `models.json` | Routing table and config, gateway price list, model groups. |
| `CLAUDE.md` | User-level instructions (delegation, one session = one worktree, git rules). |
| `cheatsheet.html`, `sdlc.html` | The cheatsheet and the SDLC design (also published as artifacts). |
| `apply-*.sh`, `install-*.sh`, `setup-jev-router.sh` | Installers, one per feature; each backs up what it touches. |

## Principles

- **The lead never edits or reviews.** It writes briefs and launches `task`; the router assigns the role.
- **Cheap by default, expensive by evidence.** A 15-use-case × 3-complexity table maps work to models; classification is one Jev call. Expensive models never read raw files (`read-shunt` → `bulk-read`).
- **Facts are gates, judgement is review.** Tests green, review APPROVE before MR, no edits on main, no merge by agents: hooks. Plan and code quality: reviewers, never the author.
- **One ticket = one branch = one worktree = one MR**, and one session per worktree.
- **State on disk.** `/ship` resumes from `.claude/ship/<T>/state.json`; nothing lives only in a model's context.
- **Humans stop the loop where it matters**: open questions, high-risk plans, every MR before it opens, merge.

## Install

```bash
git clone <this repo> ~/.claude-work
bash ~/.claude-work/install-gateway-models.sh   # gateway wrapper, prices, model picker
bash ~/.claude-work/setup-jev-router.sh          # Jev key → shell, router hooks
bash ~/.claude-work/apply-sota.sh                # agents, deny rules, CLAUDE.md, variants
bash ~/.claude-work/apply-lead.sh && bash ~/.claude-work/apply-task.sh
bash ~/.claude-work/apply-intent.sh && bash ~/.claude-work/apply-shunt.sh && bash ~/.claude-work/apply-codewrite.sh
bash ~/.claude-work/apply-review-mr.sh && bash ~/.claude-work/apply-review-own.sh
bash ~/.claude-work/apply-worktree-guard.sh && bash ~/.claude-work/apply-builtins.sh && bash ~/.claude-work/apply-switch.sh
bash ~/.claude-work/apply-ship.sh
```

Secrets never live in this repo: the gateway key is read live from `~/.aircode/config.json`, the Jev key from the
`JEV_LLMGATEWAY_KEY` environment variable.

## Status

Phase 1 of the SDLC (`/ship`) is implemented and being calibrated on real tickets. Next: `/map` (codebase maps),
`/plan` + `/epic`, `/design` (TDD), `/retro`. See `sdlc.html` for the full design and `cheatsheet.html` for day-to-day use.
