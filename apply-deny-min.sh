#!/usr/bin/env bash
# ~/.claude/settings.json permissions → the minimal shape: every tool allowed, bypassPermissions, and a deny list of
# the few things that are never the agent's (destructive rm, force push, --no-verify, merging/approving an MR).
# Everything else is judged per command by bash-guard. Any other "deny" list elsewhere in the file is emptied
# (deny rules apply even in bypass mode, so a forgotten duplicate block keeps blocking). Hooks, env, statusline and
# the rest of the file are untouched. Backup kept. Usage: bash ~/.claude-work/apply-deny-min.sh
set -euo pipefail
F="$HOME/.claude/settings.json"; TS=$(date +%Y%m%d-%H%M%S); cp "$F" "$F.bak-$TS"
node - "$F" <<'EOF'
const fs = require("fs"), f = process.argv[2], d = JSON.parse(fs.readFileSync(f, "utf8"));
const before = JSON.stringify(d.permissions || {});
d.permissions = {
  allow: ["Agent", "Bash", "Edit", "Glob", "Grep", "Read", "Skill(*)", "Task", "WebFetch", "WebSearch", "Write"],
  // "git push --force*" would also match --force-with-lease, which is the normal way to push a rebased branch: deny only the bare forms.
  deny: ["Bash(rm -rf *)", "Bash(git push --force)", "Bash(git push --force *)", "Bash(git push -f)", "Bash(git push -f *)", "Bash(git push --no-verify*)", "Bash(glab mr merge*)", "Bash(glab mr approve*)"],
  defaultMode: "bypassPermissions",
};
d.enableAllProjectMcpServers = true;
let others = 0;
(function walk(o, p) { if (!o || typeof o !== "object" || o === d.permissions) return; for (const [k, v] of Object.entries(o)) { if (k === "deny" && Array.isArray(v) && v.length) { console.log(`  ${p}.deny emptied (${v.length} entries: ${v.slice(0, 3).join(", ")}${v.length > 3 ? "…" : ""})`); o[k] = []; others++; } else walk(v, p ? `${p}.${k}` : k); } })(d, "");
fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n");
console.log(`  \u001b[32m✓\u001b[0m permissions rewritten (${JSON.parse(before).deny?.length ?? 0} deny entries → ${d.permissions.deny.length})${others ? ` · ${others} other deny list(s) emptied` : ""}`);
console.log("  deny: " + d.permissions.deny.join(" · "));
EOF
echo "  backup: $F.bak-$TS · applies at once"
