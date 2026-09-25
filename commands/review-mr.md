---
description: Review a GitLab merge request (or the current branch) with the reviewer subagent and post each finding as an inline comment on its line in the MR (no general notes). Scope is full by default (Critical, Major, Minor, Nit, Question, Suggestion) — the verdict depends only on Critical/Major; the rest is posted for the author, never a reason not to approve. Other people's MRs: findings posted inline. Your own MRs (you are the author, or its branch is the session's): nothing posted, findings stay in the chat with an offer to fix them. --blockers limits to Critical/Major; --post/--no-post force posting; --spec also checks the OpenSpec change.
argument-hint: [!123 | MR URL | branch] [--full | --blockers] [--spec] [--post | --no-post]
allowed-tools: Bash(glab:*), Bash(git:*), Bash(node:*), Bash(bash:*), Agent
---
Arguments: `$ARGUMENTS`. Parse them:
- target = the first argument that is not a flag: `!123` or a number (MR of the repo in the current folder), an MR URL (works from any folder), or a branch (empty = current branch against main);
- scope = `blockers` if `--blockers` is present, otherwise `full` (all severities; only Critical/Major affect the verdict);
- check spec = `yes` if `--spec` is present, otherwise `no`;
- post = true if `--post` is present, false if `--no-post` is present; otherwise decided in step 0b (own MR → false, someone else's → true). Never true for a branch with no MR.

## 0. Resolve the target (MR only)
If the target is an MR (URL or number), run `bash ~/.claude/tools/mr-checkout.sh "<target>"`. It prints `<workdir> <iid>`: for a URL it finds the local clone under ~/development (clones it if missing) and checks the MR branch out in a worktree; for a number it is the current repo. From here on only `<workdir>` and `<iid>` are used, so a URL and a number behave the same. If it fails, show its message and stop.

## 0b. Own MR? (decides whether findings are posted)
Unless post was forced by a flag, find out whether this is your own work:
```bash
cd <workdir> && ME=$(glab api user | jq -r .username) && glab mr view <iid> --output json | jq -r --arg me "$ME" '[.author.username == $me, .source_branch] | @tsv'
```
own = author is you, or the source branch equals the branch of the session's worktree (`git rev-parse --abbrev-ref HEAD` in the folder you started in), or the MR was opened in this session. Own → post = false (comments on your own MR are noise: the findings are a to-do list for this session, not a review thread); not own → post = true (leave the trace in GitLab, minors included: they are for the author, and the verdict does not depend on them). For a branch target with no MR: post = false.

## 0c. Rebased?
`cd <workdir> && bash ~/.claude/tools/sync-check.sh` (no --fix on someone else's branch). If the MR's branch is behind main, the verdict is shown as `APPROVE — after rebase (<n> commits behind main)` / `REQUEST CHANGES` as usual, and for a posted review the summary line in the chat says it; the reviewer still reviews the diff as is. An MR is never "good to merge" while behind main.

## 1. Delegate the review
Launch the `reviewer` subagent with description "Review !<iid> (<scope>)" (or "Review <branch> (<scope>)") and this prompt:

> Target: !<iid> (or the branch). workdir: <workdir>. scope: <scope>. check spec: <yes|no>. Gather the MR or branch diff yourself, apply your severity rules and return ONLY your JSON output. Every finding must have path, line (new file, inside the diff), message and fix.

Do not review the diff in this context; the subagent keeps it out of the main conversation.

## 2. Present
Render the JSON for the chat: `Verdict - Pipeline - Summary`, then one line per finding as `severity path:line - message`, blockers first. Skip the fix snippets when they are being posted to GitLab; when nothing is posted (your own MR, `--no-post`), include each fix snippet under its finding, since the chat is the only place they will be seen. An APPROVE with minors is still an APPROVE: say "approve — N non-blocking comments" rather than listing them as objections. If the MR is your own, say the findings were not posted (they are yours to fix) and end with one line offering to fix them in this worktree (delegate to `task` with a `change:` brief listing the findings by path:line); do nothing until the user answers.

## 3. Post (default)
If post is true and there is at least one finding (never for your own MR unless `--post` was given), run (for the current branch get the iid with `glab mr view --output json | jq .iid`):

```bash
cd <workdir> && node ~/.claude/tools/mr-post.mjs --mr <iid> <<'EOF'
<the subagent's JSON, verbatim>
EOF
```

It creates one inline discussion per finding on its line in the Changes tab (message + proposed fix), and prints `posted` (with URLs) and `not_posted` (file not in the diff, or API error). Show both lists in one line each. The verdict and summary are for the chat only: never post them as a note, never run `glab mr note`, `glab mr approve`, `glab mr merge` or `glab mr update`.
With no findings, post nothing and say so. If the target is a branch with no MR, say the findings cannot be posted.
