// File storage for uploaded documents (Phase 2 #7).
//
// Files live under a single root directory configured by the UPLOAD_ROOT
// env var. In production we point this at a Railway persistent volume
// (/data/uploads) so files survive redeploys. In dev it falls back to
// a project-relative ./uploads directory.
//
// The DB only stores `storagePath`, which is the relative path under the
// root (e.g., "po/clxyz123/abc-def.pdf"). The root never appears in the
// DB so we can move/rename it without a data migration.
//
// Filenames are random tokens so users can't guess paths and can't trigger
// path-traversal abuse via the original filename.

import { randomBytes } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream, type ReadStream } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";

/** Root directory for uploads. Must already exist (or be creatable). */
export function uploadRoot(): string {
  const fromEnv = process.env.UPLOAD_ROOT;
  if (fromEnv && fromEnv.trim() !== "") return fromEnv;
  // Dev fallback. Files written here are NOT durable on Railway —
  // production must set UPLOAD_ROOT=/data/uploads with a persistent
  // volume mounted at /data.
  return join(process.cwd(), "uploads");
}

/** Generates an opaque storage path: "<category>/<entityId>/<random>.<ext>". */
export function buildStoragePath(args: {
  category: string;
  entityId: string;
  ext: string;
}): string {
  const safeCategory = args.category.replace(/[^a-z0-9_-]/gi, "");
  const safeEntityId = args.entityId.replace(/[^a-z0-9_-]/gi, "");
  const safeExt = args.ext.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!safeCategory || !safeEntityId || !safeExt) {
    throw new Error("Invalid storage-path components");
  }
  const token = randomBytes(16).toString("hex");
  return `${safeCategory}/${safeEntityId}/${token}.${safeExt}`;
}

/** Resolves a relative storage path to its absolute on-disk path,
 *  with a defensive check that the result stays under uploadRoot(). */
export function resolveStoragePath(relativePath: string): string {
  const root = uploadRoot();
  // Reject any input that already contains absolute or traversal components.
  if (
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\") ||
    relativePath.includes("..")
  ) {
    throw new Error("Invalid storage path");
  }
  const abs = normalize(join(root, relativePath));
  // Final safety check: normalized path must start with the root (after
  // both have been normalized). Defends against constructed bypasses.
  const rootNormalized = normalize(root);
  if (
    !abs.startsWith(rootNormalized + sep) &&
    abs !== rootNormalized
  ) {
    throw new Error("Storage path escaped UPLOAD_ROOT");
  }
  return abs;
}

/** Saves a buffer under uploadRoot()/<relativePath>, mkdir-p'ing as needed. */
export async function saveDocument(args: {
  relativePath: string;
  buffer: Buffer;
}): Promise<void> {
  const abs = resolveStoragePath(args.relativePath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, args.buffer);
}

/** Returns a Node stream for a stored file, or null if it doesn't exist. */
export async function streamDocument(
  relativePath: string,
): Promise<{ stream: ReadStream; size: number } | null> {
  const abs = resolveStoragePath(relativePath);
  let s;
  try {
    s = await stat(abs);
  } catch {
    return null;
  }
  if (!s.isFile()) return null;
  return { stream: createReadStream(abs), size: s.size };
}

/** Deletes a stored file. Idempotent — silently swallows ENOENT. */
export async function deleteDocument(relativePath: string): Promise<void> {
  const abs = resolveStoragePath(relativePath);
  try {
    await unlink(abs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
