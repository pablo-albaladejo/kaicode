#!/usr/bin/env bash
# ci-wait <mr-iid> [max-minutes]: wait for the head pipeline of an MR and print the /ship pipeline-stage result.
# No model involved: polls `glab api` every 60s (max 30 min by default) and prints
#   Finding: <success|failed|canceled|timeout|skipped> pipeline <id> (<web_url>)
#   Failed jobs: <stage>/<name> …                       (only when failed)
#   Evidence (<job>): first 5 lines of its trace that look like errors   (only when failed)
# Exit code: 0 success · 1 failed/canceled/skipped · 2 timeout · 3 no pipeline / API error.
# Run inside the repo (glab resolves :id from the remote).
set -uo pipefail
IID="${1:?usage: ci-wait <mr-iid> [max-minutes]}"; IID="${IID#!}"; MAX="${2:-30}"
deadline=$(( $(date +%s) + MAX * 60 ))
while :; do
  MR=$(glab api "projects/:id/merge_requests/$IID" 2>/dev/null) || { echo "Finding: api-error (glab api merge_requests/$IID failed)"; exit 3; }
  PID=$(echo "$MR" | jq -r '.head_pipeline.id // empty'); ST=$(echo "$MR" | jq -r '.head_pipeline.status // empty'); URL=$(echo "$MR" | jq -r '.head_pipeline.web_url // empty')
  if [ -z "$PID" ]; then
    [ $(date +%s) -ge $deadline ] && { echo "Finding: timeout (no pipeline attached to !$IID after ${MAX}m)"; exit 2; }
    sleep 30; continue
  fi
  case "$ST" in
    success) echo "Finding: success pipeline $PID ($URL)"; exit 0 ;;
    failed|canceled|skipped)
      echo "Finding: $ST pipeline $PID ($URL)"
      JOBS=$(glab api "projects/:id/pipelines/$PID/jobs?per_page=100&scope[]=failed" 2>/dev/null || echo "[]")
      echo "Failed jobs: $(echo "$JOBS" | jq -r '[.[] | "\(.stage)/\(.name)"] | join(" · ")')"
      for JID in $(echo "$JOBS" | jq -r '.[].id' | head -5); do
        NAME=$(echo "$JOBS" | jq -r --argjson j "$JID" '.[] | select(.id==$j) | .name')
        echo "Evidence ($NAME):"
        glab api "projects/:id/jobs/$JID/trace" 2>/dev/null | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | grep -iE 'error|fail|✗|exception|expected' | grep -v '^\s*$' | head -5 | sed 's/^/  /'
      done
      exit 1 ;;
    *) # created · waiting_for_resource · preparing · pending · running · manual
      [ $(date +%s) -ge $deadline ] && { echo "Finding: timeout pipeline $PID still $ST after ${MAX}m ($URL)"; exit 2; }
      sleep 60 ;;
  esac
done
