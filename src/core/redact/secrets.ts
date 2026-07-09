/**
 * Local secret redaction, applied to every excerpt BEFORE it can enter model
 * context. This is a data-flow control, not an output instruction: a secret
 * that never leaves this machine cannot end up in an API payload.
 *
 * Rule set follows gitleaks-class structured-token patterns. Known limit
 * (disclosed in the UI): free-prose secrets ("the prod password is hunter2")
 * are not reliably catchable by regex.
 */

interface Rule {
  name: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  { name: "pem-block", pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g },
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
  { name: "github-pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { name: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "openai-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g },
  { name: "connection-string", pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@]+:[^\s@]+@[^\s]+/g },
  { name: "url-basic-auth", pattern: /\bhttps?:\/\/[^\s:@\/]+:[^\s@\/]+@[^\s]+/g },
  // Generic assignment: api_key=..., TOKEN: "...", password = '...'
  {
    name: "assigned-secret",
    pattern: /\b(api[_-]?key|apikey|auth[_-]?token|access[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd)\b\s*[:=]\s*["']?[^\s"']{8,}["']?/gi,
  },
];

export interface RedactionResult {
  text: string;
  /** Count of replacements per rule name, for the local audit log. */
  hits: Record<string, number>;
}

export function redactSecrets(input: string): RedactionResult {
  let text = input;
  const hits: Record<string, number> = {};
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match, ...groups) => {
      hits[rule.name] = (hits[rule.name] ?? 0) + 1;
      // For assignment-style matches keep the key name so the analysis can
      // still see *that* a credential was being set, just not its value.
      if (rule.name === "assigned-secret" && typeof groups[0] === "string") {
        return `${groups[0]}=[REDACTED:${rule.name}]`;
      }
      return `[REDACTED:${rule.name}]`;
    });
  }
  return { text, hits };
}
