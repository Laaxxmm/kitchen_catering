import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { streamDocument } from "@/lib/storage";
import { Readable } from "node:stream";

// Authenticated download of a stored Document. The DB row carries the
// storagePath (relative under UPLOAD_ROOT); we stream the file back if
// the caller is signed in. No role gating yet — every signed-in user
// who can see a vendor bill / petty cash voucher should be able to see
// the attached invoice PDF. Tighten later if a stricter rule emerges.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
