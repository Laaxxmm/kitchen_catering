// Magic-byte validation for uploaded images. The audit flagged the punch-
// photo path as trusting the client-supplied MIME header — an attacker
// could send `Content-Type: image/jpeg` with an executable payload. This
// helper inspects the actual byte signature and only allows known image
// formats.
//
// We only need to support what real cameras/phones produce: JPEG, PNG,
// GIF, WebP, HEIC/HEIF. Anything else is rejected.

export type ImageKind = "jpeg" | "png" | "gif" | "webp" | "heic";

/** Sniff the magic bytes from a buffer; returns null if no known format matches. */
export function detectImageKind(buf: Buffer | Uint8Array): ImageKind | null {
  if (buf.length < 12) return null;
  const b = buf instanceof Buffer ? buf : Buffer.from(buf);

  // JPEG: FF D8 FF (then EE/E0/E1 etc.)
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "png";
  }

  // GIF: "GIF87a" or "GIF89a"
  if (
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  ) {
    return "gif";
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "webp";
  }

  // HEIC / HEIF: "....ftyp" + brand. Brand starts at byte 8; common
  // brands: "heic", "heix", "mif1", "msf1", "heim", "heis", "hevc".
  if (
    b[4] === 0x66 &&
    b[5] === 0x74 &&
    b[6] === 0x79 &&
    b[7] === 0x70
  ) {
    const brand = b.slice(8, 12).toString("ascii").toLowerCase();
    if (
      brand === "heic" ||
      brand === "heix" ||
      brand === "mif1" ||
      brand === "msf1" ||
      brand === "heim" ||
      brand === "heis" ||
      brand === "hevc"
    ) {
      return "heic";
    }
  }

  return null;
}

/** Returns the canonical lowercase extension for a sniffed image kind. */
export function extForImageKind(kind: ImageKind): string {
  return kind === "jpeg" ? "jpg" : kind;
}

// ─── Document format detection (Phase 2 #7) ───────────────────────
// Used by the PO/AMC document upload pipeline. PDF is the primary format;
// JPEG and PNG are also accepted for scanned/photographed copies.

export type DocumentKindMagic = "pdf" | "jpeg" | "png";

/**
 * Sniff the bytes for an allowed document format.
 * Returns null if no known format matches.
 */
export function detectDocumentKind(
  buf: Buffer | Uint8Array,
): DocumentKindMagic | null {
  if (buf.length < 8) return null;
  const b = buf instanceof Buffer ? buf : Buffer.from(buf);

  // PDF: "%PDF-" (25 50 44 46 2D)
  if (
    b[0] === 0x25 &&
    b[1] === 0x50 &&
    b[2] === 0x44 &&
    b[3] === 0x46 &&
    b[4] === 0x2d
  ) {
    return "pdf";
  }

  // Reuse the image sniffer for JPEG/PNG (the others are deliberately not
  // accepted as "documents" — keep the surface tight).
  const img = detectImageKind(buf);
  if (img === "jpeg" || img === "png") return img;

  return null;
}

/** Canonical extension + MIME type for a sniffed document kind. */
export function fileMetaForDocumentKind(kind: DocumentKindMagic): {
  ext: string;
  mime: string;
} {
  switch (kind) {
    case "pdf":
      return { ext: "pdf", mime: "application/pdf" };
    case "jpeg":
      return { ext: "jpg", mime: "image/jpeg" };
    case "png":
      return { ext: "png", mime: "image/png" };
  }
}
