#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write|MultiEdit|NotebookEdit) — refuses file edits outside a ticket worktree.
// Denies when: the checked-out branch is main/master, or the cwd is the main working tree (not a worktree).
// Allowed everywhere: a directory that is not a git repo (nothing to protect), and any git worktree on a
// non-protected branch. Untracked info/exclude files linked from a ticket worktree are also allowed.
// Override for one session: GUARD_BRANCH=off claude
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
  let sharedFileAllowed;
  const allowedSharedFile = () => {
    if (sharedFileAllowed !== undefined) return sharedFileAllowed;
    sharedFileAllowed = false;
    if (!file) return false;
    try {
      const literalFile = path.resolve(d.cwd || process.cwd(), file);
      const entries = git("worktree", "list", "--porcelain", "-z").split("\0\0").filter(Boolean);
      const matches = entries.map((entry) => {
        const fields = entry.split("\0");
        if (!fields[0].startsWith("worktree ")) throw new Error("Invalid worktree entry");
        const root = fields[0].slice("worktree ".length);
        const branches = fields.filter((field) => field.startsWith("branch refs/heads/"));
        return { root, branches };
      }).filter(({ root }) => literalFile.startsWith(root + path.sep));
      matches.sort((a, b) => b.root.length - a.root.length);
      const origin = matches[0];
      if (!origin || (matches[1] && matches[1].root.length === origin.root.length) || origin.branches.length !== 1) return false;
      const originBranch = origin.branches[0].slice("branch refs/heads/".length);
      if (!originBranch || cfg.protected.includes(originBranch)) return false;
      const originGit = (...a) => execFileSync("git", ["-C", origin.root, ...a], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      if (originGit("rev-parse", "--abbrev-ref", "HEAD") !== originBranch) return false;
      if (path.resolve(origin.root, originGit("rev-parse", "--git-dir")) === path.resolve(origin.root, originGit("rev-parse", "--git-common-dir"))) return false;
      const resolvedFile = fs.existsSync(literalFile) ? fs.realpathSync(literalFile) : path.join(fs.realpathSync(dir), path.basename(literalFile));
      try { git("ls-files", "--error-unmatch", "--", resolvedFile); return false; } catch (error) { if (error.status !== 1) return false; }
      const ignored = git("check-ignore", "-v", "--", resolvedFile);
      const match = ignored.match(/^(.+?):[1-9]\d*:([^\t]*)\t[^\n]+$/);
      if (!match || match[2].startsWith("!")) return false;
      const common = git("rev-parse", "--git-common-dir");
      const exclude = path.join(path.isAbsolute(common) ? common : path.resolve(fs.realpathSync(dir), common), "info", "exclude");
      return sharedFileAllowed = path.resolve(git("rev-parse", "--show-toplevel"), match[1]) === exclude;
    } catch { return false; }
  };
  if (cfg.protected.includes(branch) && !allowedSharedFile()) deny(`refusing to edit files on branch "${branch}".`);
  if (cfg.requireWorktree) {
    const gitDir = git("rev-parse", "--git-dir"), common = git("rev-parse", "--git-common-dir");
    const isWorktree = path.resolve(dir, gitDir) !== path.resolve(dir, common);
    if (!isWorktree && !allowedSharedFile()) deny(`"${dir}" is the main working tree (branch ${branch}), not a ticket worktree.`);
  }
} catch {
  // Never block on our own errors.
}
process.exit(0);
