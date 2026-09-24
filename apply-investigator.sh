#!/usr/bin/env bash
# Installs the "investigator" subagent and adds the subagent routing rules to ~/.claude/CLAUDE.md.
set -euo pipefail
cp ~/.claude-work/agents/investigator.md ~/.claude/agents/investigator.md
grep -q "^## Choosing a subagent" ~/.claude/CLAUDE.md || cat >> ~/.claude/CLAUDE.md <<'MD'

## Choosing a subagent
- `aircall-aircode-agents:explore` / `scout`: quick local code lookups only (no Bash, 4–8 turns).
- `Explore`: code reading and search, returns summaries with path:line.
- `investigator`: anything that needs CLIs (glab, git, aws-vault/aws, acli, CI logs, running a test). Read-only.
- Never give a task that needs glab/aws/acli to a subagent without Bash.
MD
echo "investigator installed."; grep -n "^## " ~/.claude/CLAUDE.md
