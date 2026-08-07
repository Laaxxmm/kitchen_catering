"use server";

import { revalidatePath } from "next/cache";
import { DocumentEntityType, DocumentKind, Role } from "@prisma/client";
import { db } from "@/server/db";
import { AuthorizationError, requireRole } from "@/server/rbac";
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
  Role.DELIVERY,
];

const READ_ROLES: Role[] = [...WRITE_ROLES, Role.KITCHEN_HEAD];

/**
 * What an upload may be attached to. `entityId` comes from the client, and
 * WRITE_ROLES above is the whole field staff — so without this a driver
 * could staple a file to a supplier bill, or to no record at all (an orphan
 * row plus a file on disk nothing ever reads).
 *
 * The roles mirror the middleware gate on the module each record lives in
 * (src/middleware.ts). That is as close to "has business with this record"
 * as the schema can answer: nothing records WHICH bill a given store keeper
 * filed, only that filing supplier paper is their desk's job.
 */
const UPLOAD_TARGETS: Record<
  DocumentEntityType,
  { label: string; roles: Role[]; exists: (id: string) => Promise<number> }
> = {
  ORDER: {
    label: "order",
    roles: [Role.ADMIN, Role.MANAGER, Role.SALES, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.ACCOUNTS, Role.DELIVERY, Role.FNB_SERVICE],
    exists: (id) => db.order.count({ where: { id } }),
  },
  QUOTE: {
    label: "quote",
    roles: [Role.ADMIN, Role.MANAGER, Role.SALES],
    exists: (id) => db.quote.count({ where: { id } }),
  },
  CUSTOMER_INVOICE: {
    label: "customer invoice",
    roles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS, Role.SALES, Role.DELIVERY, Role.FNB_SERVICE],
    exists: (id) => db.customerInvoice.count({ where: { id } }),
  },
  VENDOR_PO: {
    label: "purchase order",
    roles: [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.ACCOUNTS],
    exists: (id) => db.vendorPO.count({ where: { id } }),
  },
  VENDOR_BILL: {
    label: "vendor bill",
    roles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS, Role.STORE_KEEPER],
    exists: (id) => db.vendorBill.count({ where: { id } }),
  },
  DELIVERY: {
    label: "delivery",
    roles: [Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD, Role.DELIVERY, Role.FNB_SERVICE],
    exists: (id) => db.delivery.count({ where: { id } }),
  },
  PETTY_CASH_VOUCHER: {
    label: "petty cash voucher",
    roles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS],
    exists: (id) => db.pettyCashVoucher.count({ where: { id } }),
  },
  PURCHASE_REQUISITION: {
    label: "purchase requisition",
    roles: [Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD, Role.STORE_KEEPER],
    exists: (id) => db.purchaseRequisition.count({ where: { id } }),
  },
};

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

  // Target checks after the file checks: those are local, this one is a
  // round trip. Both refuse with AuthorizationError — the same shape the
  // role gate above throws, so a caller has one failure mode to handle.
  const target = UPLOAD_TARGETS[input.entityType];
  if ((await target.exists(input.entityId)) === 0) {
    throw new AuthorizationError(`No ${target.label} with that id — nothing to attach this file to.`);
  }
  if (!target.roles.includes(session.user.role)) {
    throw new AuthorizationError(`Your role cannot attach files to a ${target.label}.`);
  }

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
