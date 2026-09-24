#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write|MultiEdit|NotebookEdit) — refuses file edits outside a ticket worktree.
// Denies when: the checked-out branch is main/master, or the cwd is the main working tree (not a worktree).
// Allowed everywhere: a directory that is not a git repo (nothing to protect), and any git worktree on a
// non-protected branch. Override for one session: GUARD_BRANCH=off claude
// Config (optional) in ~/.claude/guard-branch.json: { "protected": ["main","master"], "requireWorktree": true }
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let cfg = { protected: ["main", "master"], requireWorktree: true };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(path.join(CFG_DIR, "guard-branch.json"), "utf8")) }; } catch {}

const deny = (reason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: `guard-branch: ${reason} Start the session with \`claude @ticket <TICKET>\` (creates a worktree from origin/main), or set GUARD_BRANCH=off for this session.` } }));
  process.exit(0);
};
try {
  if (process.env.GUARD_BRANCH === "off") process.exit(0);
  const d = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  const file = d.tool_input?.file_path || d.tool_input?.notebook_path;
  const dir = file ? path.dirname(path.resolve(d.cwd || process.cwd(), file)) : d.cwd || process.cwd();
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  let inside; try { inside = git("rev-parse", "--is-inside-work-tree") === "true"; } catch { process.exit(0); } // not a repo
  if (!inside) process.exit(0);
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (cfg.protected.includes(branch)) deny(`refusing to edit files on branch "${branch}".`);
  if (cfg.requireWorktree) {
    const gitDir = git("rev-parse", "--git-dir"), common = git("rev-parse", "--git-common-dir");
    const isWorktree = path.resolve(dir, gitDir) !== path.resolve(dir, common);
    if (!isWorktree) deny(`"${dir}" is the main working tree (branch ${branch}), not a ticket worktree.`);
  }
} catch {
  // Never block on our own errors.
}
process.exit(0);
