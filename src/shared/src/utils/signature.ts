import { createHash } from "crypto";

const SIGNATURE_SALT = "rf-telemetry-v1";

/**
 * Compute a privacy-preserving device signature from protocol + stable fields.
 * SHA-256(salt + protocol + sorted(key=value) pairs)
 */
export function computeSignature(
  protocol: string,
  fields: Record<string, unknown>
): string {
  const sortedEntries = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("&");

  const input = `${SIGNATURE_SALT}:${protocol}:${sortedEntries}`;
  return createHash("sha256").update(input).digest("hex");
}
