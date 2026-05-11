import { db } from "@/server/db";

/**
 * Typed key/value Settings accessor. Reads `Settings.value` as JSON and
 * casts to `T`. Returns `null` if the key isn't present. Callers should
 * provide a sensible default when the value matters.
 *
 * Direct DB read; not a server action. Safe to call from server components,
 * server actions, and route handlers. Do NOT call from client components —
 * use a server action wrapper.
 */
export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const row = await db.settings.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? null;
}

export async function getSettingOr<T>(key: string, fallback: T): Promise<T> {
  const v = await getSetting<T>(key);
  return v ?? fallback;
}

/**
 * Boolean helper. Treats missing keys and non-boolean values as `false`,
 * unless `defaultValue` says otherwise.
 */
export async function getSettingBool(key: string, defaultValue = false): Promise<boolean> {
  const v = await getSetting<unknown>(key);
  if (typeof v === "boolean") return v;
  return defaultValue;
}
