---
description: Refine tickets that already exist (an epic and its children, or one or more tickets) into one reviewed spec with a section per ticket, verified against the real repo, with every open decision assigned to someone. /ship then implements each ticket from its section. No code changes. Usage: /plan <EPIC or TICKET> [MORE TICKETS…] [--status]
---
You are running **/plan**: the step between "the tickets exist" and "/ship". The tickets already say what is wanted, at a high level or in detail. Your job is to turn them into something /ship can execute without guessing: verified facts, decided or assigned questions, a contract, and per ticket testable acceptance and ordered steps. You change no code and create no tickets unless the user approves it. State: `node ~/.claude/tools/plan-state.mjs`. Every artefact is English; messages to people follow lead.md Voice and People.

Conventions:
- **Run it in the repo that owns the work**, main checkout (`git rev-parse --git-common-dir`); the spec goes to `openspec/changes/<slug>/` there, and `cc-link` makes it visible in every ticket worktree later.
- **Only STOPs are questions**: the facts a human must provide (gate-facts), decisions only the owning team can take, the spec approval (gate-human), and any Jira write beyond comments.
- **Claims in a ticket are hypotheses until checked here.** "The helper exposes no continuation token", "no migration needed", "8 to 10 files" were written from a reading, possibly of another repo; verify each against this repo before the spec relies on it.

## 0. Arguments and resume
`K` = first key (an Epic or a ticket); more keys = more tickets in the same spec. `--status` → `plan-state status K` and stop.
```bash
node ~/.claude/tools/plan-state.mjs init <K> --slug <kebab-summary>
node ~/.claude/tools/plan-state.mjs status <K>
```
Resuming: continue from `stage`; if `stopped` is set, repeat that question.

## 1. prepare
- Tickets: if `K` is an Epic, its children (`acli jira workitem search --jql "parent = K"`; check the flags with `--help` first) plus any extra keys; else the keys given. `plan-state set K tickets='[…]'`.
- Repo: the codebase map (`~/.claude/knowledge/repos/<repo>.md` or `docs/codebase-map.md`). Missing or older than 30 days ⇒ run `/map` first; a repo you do not know yet is exactly when the map pays off.
- References: files and links the tickets cite (a study in another repo's `.claude/ship/…`, a Confluence page, a Slack thread). Copy local files into `openspec/changes/<slug>/references/` now: a path inside another worktree disappears when that worktree is cleaned. Links stay links, read with the Atlassian or Slack tools.
- `cc-link.sh` if `openspec/` is untracked in this repo.
`plan-state stage K understand`.

## 2. understand
One `understand:` investigator for all tickets: "understand: <K> (spec for tickets <list>). For each ticket return: Ask (one line), Already decided (quote), Claims to verify against this repo (each with the file or command that proves or disproves it), Facts needed before planning (with the exact read-only command and who can run it), Open questions (each with: who decides — us, the owning team, product — and a proposed default), Depends on / blocks (keys), References. Across tickets: overlaps, gaps (work none of the tickets covers), a proposed order. Read the codebase map first; verify claims in code, do not repeat them."
Gate: every ticket has an Ask and an Open questions line (even `none`). Save the output to `.claude/plan/<K>/brief.md` and `plan-state set K gaps='[…]'`.
`plan-state stage K gate-facts`.

## 3. gate-facts
Same rules as /ship 2b: agent before human (check `aws-vault list`, `glab auth status`, the MCPs before labelling a fact human), one `lookup:` investigator for all agent facts, a STOP with exact commands for the human ones, results appended to brief.md as `Facts: <fact> = <value> (<command>, <date>)`, and a Jira comment per ticket with the facts measured for it. A claim that turns out false is a fact too: write it plainly ("Claim: no migration needed. Fact: the index does not exist, see <file>").
**Decisions owned by someone else** (the owning team, product): do not decide them. STOP with the list (question, our default, why it matters) and offer a Slack draft to the owners (`people.mjs get <owner>` first, Voice rules, left as a draft for the user to send). Continue when the user answers or says "use our defaults" (then record each default as `Decision (default, pending <owner>): …`).
`plan-state stage K shape`.

## 4. shape
One `plan:` planner run for the whole spec: "plan: spec <slug> for tickets <list>. Brief: <brief.md>. Facts: <facts>. Decisions: <decided and pending>. Write the OpenSpec change: proposal.md (Why, What changes, Out of scope, Tickets covered), design.md (Context, the Contract with exact inputs, outputs, errors and what each value means and does not mean, Decisions as options → choice → why, with pending ones marked, Risks), and tasks.md with one section per ticket, headed exactly `## <KEY>: <summary>`, each with Acceptance (testable, numbered), Steps (files, done when; at most 6, more ⇒ propose splitting the ticket), Depends on, Estimate (files, S/M/L). Order sections by dependency."
Gate: every ticket has a `## <KEY>:` section with ≥ 1 acceptance line and ≥ 1 step with `done when`; the design has a Contract section when the work adds or changes an interface. `plan-state stage K review-spec`.

## 5. review-spec
`review plan: spec <slug>. Files: <proposal, design, tasks>. Tickets: <list with their original text>. Facts: <facts>. Check: every ticket's ask is covered or explicitly out of scope, acceptance is testable, the contract says what each value does NOT mean, no step relies on an unverified claim, pending decisions are marked and not silently assumed. Return the reviewer JSON.`
`APPROVE` ⇒ `plan-state set K verdict=APPROVE`, next. Otherwise `plan-state attempt K review-spec` (exit 2 ⇒ STOP with the findings) and `SendMessage` the same planner with the findings verbatim; review again.
`plan-state stage K gate-human`.

## 6. gate-human
STOP with: the order of tickets, per ticket its acceptance in one or two lines and its estimate, the decisions (taken, defaulted, pending with owner), gaps found (proposed new tickets, not created), claims that proved false. "Approve the spec, change it, or stop." On approval `plan-state stage K publish`.

## 7. publish
- Write the files to `openspec/changes/<slug>/` (`cat > … <<'EOF'`; you have no Write tool, and this is spec text, not code). `openspec validate <slug>` if the CLI exists; a failure is a failed gate.
- Jira, per ticket: one comment, English, no hard wraps: `Refined in spec <repo>:openspec/changes/<slug> (section <KEY>). Acceptance: 1… 2… Depends on: … Decisions: … Pending: … (owner).` Never edit a description. New tickets for gaps: only the ones the user approved at gate-human, with their exact text.
- `plan-state set K spec=openspec/changes/<slug>` and `plan-state stage K done`.

## 8. done
Tell the user in a few lines: where the spec is, the order, and the next command for the first ticket that has no pending dependency: `claude @ticket <KEY>` then `/ship <KEY>` (ship finds the section by the key and skips its own plan). Record anything the harness should learn in `~/.claude/knowledge/process.md` (English).

## Rules
- No implementer, no code, no commits in the repo: the spec folder is the only thing you write, plus Jira comments.
- One question round per STOP; never ask the same thing twice.
- Cost: report `cc-cost --days 1` for this session at done; a /plan should cost a fraction of a /ship.
