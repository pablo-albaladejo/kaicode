---
description: Handle peer and bot review on an open MR — list the threads waiting on you, triage (accept / answer / ask), one implementer run for the accepted ones, proposed replies, post on your word, resolve what was answered. Usage: /feedback [!iid | MR URL] (default: the MR of the current branch)
argument-hint: [!iid | MR URL]
allowed-tools: Bash(node:*), Bash(git:*), Bash(glab:*), Agent, Read
---
# /feedback $ARGUMENTS

Target: `$ARGUMENTS`, or the current branch's MR (`glab mr view --output json | jq .iid`). Then run stage **10b. feedback** of `~/.claude/commands/ship.md` exactly as written there (mr-feedback → triage → one implementer run for accepted threads → review-code → push → STOP with the replies → "post" → reply/resolve → re-check). If the branch has a /ship state, record the stage (`ship-state stage <T> feedback`) so the loop can resume; if not, run it standalone and do not create one.
Never approve, merge, or resolve a thread you did not answer. The merge is the user's.
