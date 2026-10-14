#!/bin/bash
# Installs kai-runner as a launchd agent: runs when ~/.claude-work/.kaicode-queue changes and every 10 minutes.
# Remove: launchctl bootout gui/$(id -u)/com.kaicode.runner && rm ~/Library/LaunchAgents/com.kaicode.runner.plist
set -e
REPO="$HOME/.claude-work"; NODE="$(command -v node)"; PL="$HOME/Library/LaunchAgents/com.kaicode.runner.plist"
[ -n "$NODE" ] || { echo "node not found"; exit 1; }
mkdir -p "$REPO/.kaicode-queue" "$REPO/.kaicode-review/out" "$HOME/.claude/logs" "$(dirname "$PL")"
cat > "$PL" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.kaicode.runner</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$REPO/tools/kai-runner.mjs</string></array>
  <key>WatchPaths</key><array><string>$REPO/.kaicode-queue</string></array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict><key>HOME</key><string>$HOME</string><key>PATH</key><string>$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>StandardOutPath</key><string>$HOME/.claude/logs/kai-runner.out</string>
  <key>StandardErrorPath</key><string>$HOME/.claude/logs/kai-runner.out</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/com.kaicode.runner" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PL"
sleep 2; cat "$REPO/.kaicode-review/heartbeat" 2>/dev/null && echo "✓ kai-runner installed" || echo "✗ no heartbeat yet: check ~/.claude/logs/kai-runner.out"
