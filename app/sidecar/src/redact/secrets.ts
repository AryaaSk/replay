// Regex layer: replaces matched secrets with [REDACTED:<kind>] in any text
// fields before they are sent to the model.

interface Pattern {
  kind: string;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { kind: "anthropic", re: /sk-ant-api[a-z0-9_-]{20,}/gi },
  { kind: "openai", re: /sk-(?:proj-)?[a-z0-9_-]{20,}/gi },
  { kind: "github_pat", re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { kind: "bearer", re: /Bearer\s+[A-Za-z0-9._-]{20,}/gi },
  { kind: "aws_access_key", re: /AKIA[A-Z0-9]{16}/g },
  { kind: "credit_card", re: /\b(?:\d[ -]*?){13,19}\b/g },
];

export interface SecretMatch {
  kind: string;
  start: number;
  end: number;
}

/** Returns redacted text plus the matches found. */
export function redactSecrets(text: string): { redacted: string; matches: SecretMatch[] } {
  let redacted = text;
  const matches: SecretMatch[] = [];
  for (const p of PATTERNS) {
    let m: RegExpExecArray | null;
    p.re.lastIndex = 0;
    while ((m = p.re.exec(text)) !== null) {
      matches.push({ kind: p.kind, start: m.index, end: m.index + m[0].length });
    }
  }
  // Apply replacements (sort by start desc so indices stay valid).
  const sorted = [...matches].sort((a, b) => b.start - a.start);
  for (const match of sorted) {
    redacted =
      redacted.slice(0, match.start) +
      `[REDACTED:${match.kind}]` +
      redacted.slice(match.end);
  }
  return { redacted, matches };
}
