---
description: Review a GitLab merge request (or the current branch) with the reviewer subagent and post each finding as an inline comment on its line in the MR (no general notes). Other people's MRs: scope blockers (critical, major), findings posted inline. Your own MRs (you are the author, or its branch is the session's): scope full, nothing posted, findings stay in the chat with an offer to fix them; --full/--blockers and --post/--no-post force either; --spec also checks the OpenSpec change; --no-post keeps the review in the chat.
argument-hint: [!123 | MR URL | branch] [--full | --blockers] [--spec] [--post | --no-post]
allowed-tools: Bash(glab:*), Bash(git:*), Bash(node:*), Bash(bash:*), Agent
---
Arguments: `$ARGUMENTS`. Parse them:
- target = the first argument that is not a flag: `!123` or a number (MR of the repo in the current folder), an MR URL (works from any folder), or a branch (empty = current branch against main);
- scope = `full` if `--full` is present, `blockers` if `--blockers` is present; otherwise decided in step 0b (own MR → `full`, someone else's → `blockers`);
- check spec = `yes` if `--spec` is present, otherwise `no`;
- post = true if `--post` is present, false if `--no-post` is present; otherwise decided in step 0b (own MR → false, someone else's → true). Never true for a branch with no MR.

## 0. Resolve the target (MR only)
If the target is an MR (URL or number), run `bash ~/.claude/tools/mr-checkout.sh "<target>"`. It prints `<workdir> <iid>`: for a URL it finds the local clone under ~/development (clones it if missing) and checks the MR branch out in a worktree; for a number it is the current repo. From here on only `<workdir>` and `<iid>` are used, so a URL and a number behave the same. If it fails, show its message and stop.

## 0b. Own MR? (decides the default scope)
Unless both scope and post were forced by flags, find out whether this is your own work:
```bash
cd <workdir> && ME=$(glab api user | jq -r .username) && glab mr view <iid> --output json | jq -r --arg me "$ME" '[.author.username == $me, .source_branch] | @tsv'
```
own = author is you, or the source branch equals the branch of the session's worktree (`git rev-parse --abbrev-ref HEAD` in the folder you started in), or the MR was opened in this session. Own → scope `full` and post = false (you want everything before others look at it, and comments on your own MR are noise: the findings are a to-do list for this session, not a review thread); not own → `blockers` and post = true (respect their time, leave the trace in GitLab). For a branch target with no MR: own → `full`, post = false.

## 1. Delegate the review
Launch the `reviewer` subagent with description "Review !<iid> (<scope>)" (or "Review <branch> (<scope>)") and this prompt:

> Target: !<iid> (or the branch). workdir: <workdir>. scope: <scope>. check spec: <yes|no>. Gather the MR or branch diff yourself, apply your severity rules and return ONLY your JSON output. Every finding must have path, line (new file, inside the diff), message and fix.

Do not review the diff in this context; the subagent keeps it out of the main conversation.

## 2. Present
Render the JSON for the chat: `Verdict - Pipeline - Summary`, then one line per finding as `severity path:line - message`. Skip the fix snippets when they are being posted to GitLab; when nothing is posted (your own MR, `--no-post`), include each fix snippet under its finding, since the chat is the only place they will be seen. If scope was `blockers` and the verdict is APPROVE, mention that `--full` would also list minor findings and suggestions. If the MR is your own, say the findings were not posted (they are yours to fix) and end with one line offering to fix them in this worktree (delegate to `task` with a `change:` brief listing the findings by path:line); do nothing until the user answers.

## 3. Post (default)
If post is true and there is at least one finding (never for your own MR unless `--post` was given), run (for the current branch get the iid with `glab mr view --output json | jq .iid`):

```bash
cd <workdir> && node ~/.claude/tools/mr-post.mjs --mr <iid> <<'EOF'
<the subagent's JSON, verbatim>
EOF
```

It creates one inline discussion per finding on its line in the Changes tab (message + proposed fix), and prints `posted` (with URLs) and `not_posted` (file not in the diff, or API error). Show both lists in one line each. The verdict and summary are for the chat only: never post them as a note, never run `glab mr note`, `glab mr approve`, `glab mr merge` or `glab mr update`.
With no findings, post nothing and say so. If the target is a branch with no MR, say the findings cannot be posted.
