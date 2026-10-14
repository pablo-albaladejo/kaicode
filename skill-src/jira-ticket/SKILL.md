---
name: jira-ticket
description: Write and create a Jira ticket in the team's format (outcome panel, why it matters, evidence, what to build, contract, numbered acceptance, constraints, expected impact) with the description in ADF, the parent epic, links and fields set. Use when the user asks to create, draft or split a Jira ticket, or when /plan approves new tickets for gaps.
---
# jira-ticket

Reference: APR-7795 (`node ~/.claude/tools/jira-api.mjs get APR-7795` prints its fields and ADF). A new ticket reads
like it: the outcome in one line, the evidence with dates and sources, and acceptance lines anyone can check.

## Steps
1. **Facts first.** Collect the numbers and sources the ticket will cite: measurements with date, environment and
   command; MR and ticket keys; doc links. A claim with no source goes to "Open questions", never into the facts.
   Read the parent epic and one or two sibling tickets with `jira-api get` to copy their title tags and fields.
2. **Draft** the markdown in `.claude/tickets/<slug>.md` (main checkout or ticket worktree; local, not committed)
   with the template below.
3. **Convert and dry-run:**
   `node ~/.claude/tools/jira-adf.mjs .claude/tickets/<slug>.md --out .claude/tickets/<slug>.json`
   `node ~/.claude/tools/jira-api.mjs create .claude/tickets/<slug>.json --dry-run`
4. **Show the user** the title, the fields (parent, links, blast radius, dates) and the full text as it will read in
   Jira. STOP: "create it, change it, or stop". Creating a ticket is a Jira write and needs their words.
5. **Create** only after they say so:
   `CC_CONFIRMED=1 node ~/.claude/tools/jira-api.mjs create .claude/tickets/<slug>.json`
   Report the key and the link. Sprint and assignee only if the user asked (`acli jira workitem edit`).

Never use this skill to rewrite the description of an existing ticket; changes to an existing ticket go as a comment.

## Template
```markdown
---
project: APR
type: Task
summary: [<Epic tag>] [<repo>] <outcome in plain words>
parent: <EPIC-KEY>
blocks: <KEY>, <KEY>
relates: <KEY>
blast_radius: S
start: 2026-10-15
due: 2026-10-22
---
> **Outcome:** <who> <can do what>, <measured how>, in one sentence.

### Why it matters
- **<The point in a few words>.** <The problem, with the number that shows it.>

### Evidence
- **<Environment> measured <YYYY-MM-DD>, <scope>:** <result> (<command, dashboard or MR>).

### What to build
1. <A deliverable a reviewer can see, with the ticket that provides what it depends on.>
2. …

### Contract
- **FROZEN.** <What must not change: field, shape, counts, signals.>
- **<Rule>.** <What a value means and what it does NOT mean.>

### Acceptance criteria
1. **<Short label>** <checkable statement: a test, a command, a measured number, a visible behaviour>.
2. …

### Constraints
- <A limit that is not negotiable, and why.>

### Expected impact
- <The number after against the number before, and what it unlocks.>
```
Leave out "Contract" when nothing public changes. Without measurements, drop "Evidence" and say so in "Why it
matters". Add `### Open questions` (each with an owner and our default) when something is undecided.

## Writing rules
- English, B1, plain and direct, as the user writes (lead.md Voice): short sentences, no filler, no em dashes.
- Bullets in "Why it matters", "Evidence" and "Contract" start with a bold label ending in a period or colon;
  acceptance lines start with a bold short label. Bold nowhere else.
- Title: the epic's tags first (`[MVP] [Activation] …`, `[Batch] [conv-ai-settings] …`), then the outcome. Never
  internal codes like "G1 to G8".
- Write ticket keys plain (APR-1234): they become Jira links.
- Numbers carry unit, date and source. Every acceptance line is numbered and checkable.
- One ticket, one outcome. More than 5 items in "What to build" or two outcomes: propose two tickets.

## Fields set by jira-adf
project, type, summary, description (ADF), parent, labels, Blast Radius (`customfield_10188`, S known; for M or L
read a ticket that has it and add the option id to `BLAST` in jira-adf.mjs), Start date (`customfield_10015`), due
date, and the links: `blocks` and `relates` (the new ticket blocks or relates to those keys).
