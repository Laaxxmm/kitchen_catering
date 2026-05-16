/**
 * Regenerate brand PNG icons from public/icons/icon.svg.
 *
 * Run with: node scripts/regen-icons.mjs
 *
 * Produces:
 *   - favicon-32.png         (browser tab fallback)
 *   - icon-192.png           (PWA + Android home-screen)
 *   - icon-512.png           (PWA + Android splash)
 *   - icon-maskable-512.png  (PWA maskable variant with safe padding)
 *   - apple-touch-icon.png   (iOS home-screen, 180×180)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const ICONS_DIR = resolve(process.cwd(), "public/icons");
const svgPath = resolve(ICONS_DIR, "icon.svg");
const svg = readFileSync(svgPath);

const variants = [
  { file: "favicon-32.png", size: 32 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

for (const v of variants) {
  const out = resolve(ICONS_DIR, v.file);
  const png = await sharp(svg, { density: v.size * 4 })
    .resize(v.size, v.size)
    .png()
    .toBuffer();
  writeFileSync(out, png);
  console.log(`✓ ${v.file} (${v.size}×${v.size})`);
}

// Maskable variant — same drawing but with extra ~10% padding so the
// OS-applied mask never crops into the toque.
{
  const size = 512;
  const innerSize = Math.round(size * 0.78);
  const inner = await sharp(svg, { density: innerSize * 4 })
    .resize(innerSize, innerSize)
    .png()
    .toBuffer();
  const out = await sharp({
    create: { width: size, height: size, channels: 4, background: "#0F6E56" },
  })
    .composite([{ input: inner, gravity: "center" }])
    .png()
    .toBuffer();
  writeFileSync(resolve(ICONS_DIR, "icon-maskable-512.png"), out);
  console.log(`✓ icon-maskable-512.png (${size}×${size}, maskable)`);
}

console.log("\nAll icons regenerated from", svgPath);
