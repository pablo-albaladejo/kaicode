---
description: Prepare a ticket's worktree (create from origin/main or reuse) and tell the user how to open a session there. Usage: /ticket APR-1234 [slug]
allowed-tools: Bash(bash ~/.claude/tools/cc-ticket.sh:*), Bash(git status:*), Bash(git log:*), Bash(git rev-parse:*)
argument-hint: <TICKET> [slug]
---
Worktree for $ARGUMENTS (created or reused; main fast-forwarded to origin/main first):

!`bash ~/.claude/tools/cc-ticket.sh $ARGUMENTS 2>&1`

The shell's working directory does not persist between Bash calls, so this session cannot move into that worktree. Compare the printed path with `git rev-parse --show-toplevel`:
- same → you are already there; say so and continue with the user's request.
- different → report in three lines: the worktree path and branch, whether it has commits ahead of origin/main or uncommitted changes (`git -C <path> log --oneline origin/main..HEAD | wc -l`, `git -C <path> status --porcelain | wc -l`), and the instruction: "open a terminal and run `claude @ticket <TICKET>` to work there (or `/ship <TICKET>` from that session)". Then stop. Never operate that worktree from here with `git -C` or `cd … &&` prefixes.
