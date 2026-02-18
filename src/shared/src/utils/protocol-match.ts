/**
 * Match a protocol string against an array of protocol rules.
 * Supports exact match and trailing wildcard (e.g. "acurite-*" matches "acurite-609txc").
 * Returns the first matching rule or null.
 */
export function matchProtocolRule<T extends { pattern: string }>(
  protocol: string,
  rules: T[]
): T | null {
  const lower = protocol.toLowerCase();

  // Exact match first
  for (const rule of rules) {
    if (rule.pattern.toLowerCase() === lower) {
      return rule;
    }
  }

  // Wildcard prefix match (pattern ending with *)
  for (const rule of rules) {
    const p = rule.pattern.toLowerCase();
    if (p.endsWith("*")) {
      const prefix = p.slice(0, -1);
      if (lower.startsWith(prefix)) {
        return rule;
      }
    }
  }

  return null;
}
