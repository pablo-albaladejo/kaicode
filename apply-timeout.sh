#!/usr/bin/env bash
# API call timeout for the gateway: a stalled stream (no tokens for minutes) fails after API_TIMEOUT_MS and Claude Code
# retries, instead of an agent sitting on one call for an hour. Added to ~/.claude/aircall-gateway.env.
# Usage: bash ~/.claude-work/apply-timeout.sh [ms]   (default 300000 = 5 min)
set -euo pipefail
MS="${1:-300000}"; ENV="$HOME/.claude/aircall-gateway.env"
[ -f "$ENV" ] || { echo "✗ $ENV missing" >&2; exit 1; }
grep -q '^export API_TIMEOUT_MS=' "$ENV" && sed -i '' "s/^export API_TIMEOUT_MS=.*/export API_TIMEOUT_MS='$MS'/" "$ENV" || printf "export API_TIMEOUT_MS='%s'\n" "$MS" >> "$ENV"
grep -q '^export CLAUDE_CODE_MAX_RETRIES=' "$ENV" || printf "export CLAUDE_CODE_MAX_RETRIES='3'\n" >> "$ENV"
printf '  \033[32m✓\033[0m API_TIMEOUT_MS=%s · retries 3 in %s (new sessions)\n' "$MS" "$ENV"
