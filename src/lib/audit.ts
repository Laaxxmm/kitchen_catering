import { createHash } from "node:crypto";

/**
 * Deterministic sha256 of the JSON-serialised payload. Used as
 * `AuditLog.payloadHash` so the log is tamper-evident: tampering with the
 * stored payload (or row) breaks the hash.
 *
 * Keys are sorted before serialisation so two equivalent payloads with
 * different key order produce the same hash.
 */
export function sha256Json(payload: unknown): string {
  const json = stableStringify(payload);
  return createHash("sha256").update(json).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
