---
description: Build or refresh the codebase map of the current repo (one cheap pass, ~$0.05) so understand/plan read the map instead of the tree. Usage: /map [--refresh] [--in-repo]
argument-hint: [--refresh] [--in-repo]
allowed-tools: Bash(node:*), Bash(git:*), Read
---
# /map $ARGUMENTS

One Bash call, no subagent:

```
node ~/.claude/tools/repo-map.mjs $ARGUMENTS
```

- It prints `fresh: …` when a map younger than 30 days with < 40 commits since already exists → say so in one line and stop (the user passes `--refresh` if they want a rebuild).
- Otherwise it writes `~/.claude/knowledge/repos/<repo>.md` (or `docs/codebase-map.md` with `--in-repo`) and one line in `~/.claude/knowledge/index.md`, and prints the path, size and cost.

Then read the map it wrote and report in ≤ 6 lines: path, cost, the Purpose line, how many modules in Layout, and anything it marked "not stated" (those are the questions worth asking a human once and adding to the map by hand). Do not paste the map.

`--in-repo` writes into the repo: tell the user it is uncommitted and let them decide (it belongs in its own MR, `docs: add codebase map`). Never commit or push from here.
