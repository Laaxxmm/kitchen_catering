/**
 * Unit comparison for stock posting.
 *
 * A GRN only credits inventory when the PO's unit matches the ingredient's
 * catalogue unit, because posting 4 "pct" as 4 "kg" would corrupt the on-hand
 * quantity and the moving-average cost. That check used to be a raw string
 * compare, so harmless spelling differences ("pcts" vs "pct", "Nos" vs "nos",
 * "Kgs" vs "kg") counted as a mismatch and the goods silently never reached
 * stock. Normalising first keeps the protection where it matters — genuinely
 * different measures like packet vs kilogram — without punishing typing.
 */

/** Canonical form per family of spellings. Keys are already lowercased. */
const SYNONYMS: Record<string, string> = {
  // count
  pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs",
  no: "pcs", nos: "pcs", number: "pcs", numbers: "pcs", unit: "pcs", units: "pcs",
  ea: "pcs", each: "pcs",
  // packets
  pkt: "pkt", pkts: "pkt", pct: "pkt", pcts: "pkt",
  packet: "pkt", packets: "pkt", pack: "pkt", packs: "pkt", pouch: "pkt", pouches: "pkt",
  // mass
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g",
  // volume
  l: "l", lt: "l", ltr: "l", ltrs: "l", litre: "l", litres: "l", liter: "l", liters: "l",
  ml: "ml", mls: "ml",
  // containers
  box: "box", boxes: "box",
  tray: "tray", trays: "tray",
  tin: "tin", tins: "tin",
  bottle: "bottle", bottles: "bottle",
  can: "can", cans: "can",
  bundle: "bundle", bundles: "bundle",
  roll: "roll", rolls: "roll",
  bag: "bag", bags: "bag",
  set: "set", sets: "set",
  dozen: "dozen", dozens: "dozen",
};

/** Lowercase, trim, strip punctuation/spaces, then map through SYNONYMS. */
export function normaliseUnit(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[.\s_-]/g, "");
  return SYNONYMS[cleaned] ?? cleaned;
}

/**
 * True when two unit labels mean the same measure. Deliberately conservative:
 * only spelling variants collapse — "pkt" and "kg" stay different, because
 * converting between them needs a pack size only a human knows.
 */
export function unitsEquivalent(a: string, b: string): boolean {
  return normaliseUnit(a) === normaliseUnit(b);
}
