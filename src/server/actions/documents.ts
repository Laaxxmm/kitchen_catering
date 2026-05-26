"use server";

import { revalidatePath } from "next/cache";
import { DocumentEntityType, DocumentKind, Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import {
  buildStoragePath,
  saveDocument as writeToStorage,
} from "@/lib/storage";
import {
  detectDocumentKind,
  fileMetaForDocumentKind,
} from "@/lib/file-magic";

// Server actions for the polymorphic Document model. PDFs + images
// (JPEG / PNG) are accepted; magic-byte sniffing rejects anything else
// (the audit specifically flagged trusting the client MIME header).

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file — enough for a scan.

const WRITE_ROLES = [
  Role.ADMIN,
  Role.MANAGER,
  Role.STORE_KEEPER,
  Role.ACCOUNTS,
  Role.SALES,
  Role.HOUSEKEEPING_MANAGER,
  Role.MAINTENANCE_MANAGER,
  Role.FNB_SERVICE,
];

const READ_ROLES: Role[] = [...WRITE_ROLES, Role.KITCHEN_HEAD, Role.DELIVERY];

interface UploadInput {
  entityType: DocumentEntityType;
  entityId: string;
  /** Base64-encoded file body — easiest to pass through a Server Action. */
  base64: string;
  fileName: string;
  description?: string | null;
  kind?: DocumentKind;
}

/**
 * Saves an uploaded file to UPLOAD_ROOT and records a Document row.
 * The on-disk filename is random; the user-supplied name is kept as
 * `fileName` metadata for display.
 */
export async function uploadDocument(input: UploadInput) {
  const session = await requireRole(WRITE_ROLES);

  const buf = Buffer.from(input.base64, "base64");
  if (buf.length === 0) throw new Error("File is empty");
  if (buf.length > MAX_BYTES) {
    throw new Error(`File is too large (max ${MAX_BYTES / 1024 / 1024}MB)`);
  }

  const sniff = detectDocumentKind(buf);
  if (!sniff) {
    throw new Error("Unsupported file format. Only PDF, JPEG, PNG accepted.");
  }
  const meta = fileMetaForDocumentKind(sniff);

  const storagePath = buildStoragePath({
    category: input.entityType.toLowerCase().replace(/_/g, "-"),
    entityId: input.entityId,
    ext: meta.ext,
  });
  await writeToStorage({ relativePath: storagePath, buffer: buf });

  const doc = await db.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        kind: input.kind ?? DocumentKind.ATTACHMENT,
        fileName: input.fileName.slice(0, 200),
        fileSize: buf.length,
        mimeType: meta.mime,
        storagePath,
        description: input.description ?? null,
        uploadedById: session.user.id,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DOCUMENT_UPLOADED",
        entity: input.entityType,
        entityId: input.entityId,
      },
    });
    return created;
  });

  // Light revalidation — the parent page typically re-queries via include.
  revalidatePath(`/procurement/vendor-bills/${input.entityId}`);
  revalidatePath(`/petty-cash`);
  return {
    id: doc.id,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
  };
}

export async function listDocuments(
  entityType: DocumentEntityType,
  entityId: string,
) {
  await requireRole(READ_ROLES);
  return db.document.findMany({
    where: { entityType, entityId },
    include: { uploadedBy: { select: { id: true, name: true } } },
    orderBy: { uploadedAt: "desc" },
  });
}

export async function deleteDocument(id: string) {
  const session = await requireRole([Role.ADMIN, Role.MANAGER]);
  // We delete the DB row but leave the disk file in place (cheap; no
  // sensitive enough to require shred). A nightly garbage-collection
  // job can sweep orphans later.
  await db.$transaction(async (tx) => {
    const doc = await tx.document.findUnique({ where: { id } });
    if (!doc) throw new Error("Document not found");
    await tx.document.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DOCUMENT_DELETED",
        entity: doc.entityType,
        entityId: doc.entityId,
      },
    });
  });
}
