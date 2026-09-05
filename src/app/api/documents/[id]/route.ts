import { NextResponse, type NextRequest } from "next/server";
import { DocumentEntityType, Role } from "@prisma/client";
import { requireSession, AuthenticationError } from "@/server/rbac";
import { db } from "@/server/db";
import { streamDocument } from "@/lib/storage";
import { Readable } from "node:stream";

// Authenticated download of a stored Document. The DB row carries the
// storagePath (relative under UPLOAD_ROOT); we stream the file back if
// the caller's role is allowed to see the entity the document hangs off.
// Mirrors the middleware's module gates — without this, any signed-in
// user could pull any attachment (vendor bills, petty cash proofs…) by
// enumerating document ids.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL_STAFF: Role[] = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.STORE_KEEPER, Role.KITCHEN_HEAD,
  Role.ACCOUNTS, Role.DELIVERY, Role.FNB_SERVICE,
];
const FINANCE: Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];
const ENTITY_ROLES: Record<DocumentEntityType, Role[]> = {
  [DocumentEntityType.ORDER]: ALL_STAFF,
  [DocumentEntityType.QUOTE]: [Role.ADMIN, Role.MANAGER, Role.SALES],
  [DocumentEntityType.CUSTOMER_INVOICE]: [...FINANCE, Role.SALES, Role.DELIVERY, Role.FNB_SERVICE],
  [DocumentEntityType.VENDOR_PO]: [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.ACCOUNTS],
  [DocumentEntityType.VENDOR_BILL]: FINANCE,
  [DocumentEntityType.DELIVERY]: [Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD, Role.DELIVERY, Role.FNB_SERVICE],
  [DocumentEntityType.PETTY_CASH_VOUCHER]: FINANCE,
  [DocumentEntityType.PURCHASE_REQUISITION]: [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.ACCOUNTS],
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // requireSession, not auth(): the token alone is not enough any more —
  // a deactivated user's token stays valid until it expires, and the row
  // check is what ends it (rbac.ts).
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    if (e instanceof AuthenticationError) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    throw e;
  }
  const { id } = await params;
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const allowed = ENTITY_ROLES[doc.entityType] ?? [Role.ADMIN];
  const role = session.user.role as Role;
  if (role !== Role.ADMIN && !allowed.includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const file = await streamDocument(doc.storagePath);
  if (!file) {
    return NextResponse.json(
      { error: "File missing on disk" },
      { status: 410 }, // Gone
    );
  }
  // Convert Node ReadStream → Web ReadableStream for NextResponse.
  const web = Readable.toWeb(file.stream) as unknown as ReadableStream;
  return new NextResponse(web, {
    status: 200,
    headers: {
      "content-type": doc.mimeType,
      "content-length": String(file.size),
      "content-disposition": `inline; filename="${doc.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      "cache-control": "private, max-age=300",
    },
  });
}
