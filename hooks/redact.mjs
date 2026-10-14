// redact(text): masks credentials before anything is logged or printed. Shared by bash-guard, retro-report and
// log-scrub. Keeps the first 4 characters so a reader can still tell which kind of secret it was.
const PATTERNS = [
  /ATATT[A-Za-z0-9_=-]{20,}/g,                         // Atlassian API token
  /xox[a-z]-[A-Za-z0-9.-]{10,}(?:\.xox[a-z]-[A-Za-z0-9-]+)?/g, // Slack tokens (incl. xoxe.xoxp-)
  /xoxe\.[A-Za-z0-9.-]{10,}/g,
  /glpat-[A-Za-z0-9_-]{16,}/g,                         // GitLab PAT
  /gh[pousr]_[A-Za-z0-9]{30,}/g,                       // GitHub tokens
  /(?:AKIA|ASIA)[A-Z0-9]{16}/g,                        // AWS access key id
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /sk-[A-Za-z0-9_-]{20,}/g,                            // OpenAI-style keys
  /(?<=Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g,
  /(?<=-u\s+["']?[^:\s"']+:)[^\s"'$][^\s"']{11,}/g,    // curl -u user:literal-token (not $VAR)
  /(?<=\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)\s*[=:]\s*["']?)[^\s"'$][^\s"']{11,}/g,
];
export function redact(s) {
  if (s == null) return s;
  let t = String(s);
  for (const re of PATTERNS) t = t.replace(re, (m) => m.slice(0, 4) + "…[redacted]");
  return t;
}
export function redactDeep(o) {
  if (typeof o === "string") return redact(o);
  if (Array.isArray(o)) return o.map(redactDeep);
  if (o && typeof o === "object") { const r = {}; for (const [k, v] of Object.entries(o)) r[k] = redactDeep(v); return r; }
  return o;
}
