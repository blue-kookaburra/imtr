// Regenerate every shipped logo asset from the Illustrator export.
//
// `docs/brand/train-mark-outline.svg` holds TWO stacked copies of the mark —
// an outline-only one and a white-filled one — and its viewBox frames only the
// first, leaving the second off-canvas. Nothing here should depend on that
// clipping, so this script finds the outline copy by rendering each element and
// keeping the ones that land in the upper band, then re-frames it tight.
//
// Run with `npm run brand:build` after a new export lands in docs/brand/.
// Everything it writes is generated — edit the source SVG, not the output.

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "docs/brand/train-mark-outline.svg");

// Paper and ink, matching --bg and --ink in app/globals.css. The mark is drawn
// in ink rather than pure black so an app icon sitting next to the UI reads as
// the same product.
const PAPER = "#f3efe4";
const INK = "#1f2430";

// The two copies are ~482 apart vertically; anything ending above this line is
// the outline copy.
const BAND = 510;

// How much of a tile the mark spans. The mark is fine line art — window
// mullions and grille slats — and below about 32px those lines fall under a
// pixel and grey out. Clear space loses to legibility at favicon size, so the
// 32px icon is cropped tighter than the tiles anyone actually sees large.
const TILE_INSET = 0.78;
const FAVICON_INSET = 0.86;

function drawables(svg: string): string[] {
  return svg.match(/<(?:path|rect|polygon)\b[^>]*\/>/g) ?? [];
}

// Alpha bounds of one element, rendered alone in a box big enough for either
// copy. Rendering beats parsing path data — curve control points overshoot the
// real outline, and this has to be exact to crop against.
async function bounds(el: string) {
  const vx = -100,
    vy = -100,
    vw = 800,
    vh = 1200;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="${vx} ${vy} ${vw} ${vh}">${el}</svg>`;
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x0: vx + minX, y0: vy + minY, x1: vx + maxX, y1: vy + maxY };
}

async function extractMark() {
  const src = readFileSync(SRC, "utf-8");
  const kept: string[] = [];
  let box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const el of drawables(src)) {
    const b = await bounds(el);
    if (!b || b.y1 >= BAND) continue;
    kept.push(el);
    box = {
      x0: Math.min(box.x0, b.x0),
      y0: Math.min(box.y0, b.y0),
      x1: Math.max(box.x1, b.x1),
      y1: Math.max(box.y1, b.y1),
    };
  }
  if (!kept.length) throw new Error("no outline-copy elements found — did the export change?");
  if (kept.some((el) => el.includes("st0"))) {
    // st0 is the white fill of the OTHER copy. If one reaches this side the
    // band split is wrong, and recolouring the mark would flood its body.
    throw new Error("outline copy picked up a white fill — check the band split");
  }
  const ds = kept.map((el) => el.match(/\bd="([^"]+)"/)?.[1]).filter((d): d is string => !!d);
  if (ds.length !== kept.length) throw new Error("outline copy has non-path elements");
  return { ds, w: box.x1 - box.x0 + 1, h: box.y1 - box.y0 + 1, x: box.x0, y: box.y0 };
}

// The mark as standalone SVG markup, drawn in `fill` and cropped tight.
function markSvg(m: Awaited<ReturnType<typeof extractMark>>, fill: string) {
  return {
    viewBox: `${m.x} ${m.y} ${m.w} ${m.h}`,
    body: `<g fill="${fill}">${m.ds.map((d) => `<path d="${d}"/>`).join("")}</g>`,
  };
}

// A square app-icon tile. `inset` is the fraction of the tile the mark spans;
// maskable icons need theirs well inside the safe circle.
function tile(
  m: Awaited<ReturnType<typeof extractMark>>,
  size: number,
  { radius, inset }: { radius: number; inset: number }
) {
  const markW = size * inset;
  const scale = markW / m.w;
  const markH = m.h * scale;
  const tx = (size - markW) / 2 - m.x * scale;
  const ty = (size - markH) / 2 - m.y * scale;
  const bg =
    radius > 0
      ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${PAPER}"/>`
      : `<rect width="${size}" height="${size}" fill="${PAPER}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(5)})" fill="${INK}">${m.ds.map((d) => `<path d="${d}"/>`).join("")}</g></svg>`;
}

// Minimal .ico wrapping a single PNG. Every browser that still asks for
// favicon.ico understands PNG-in-ICO, and it saves pulling in an encoder.
function ico(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);
  return Buffer.concat([header, entry, png]);
}

async function main() {
  const m = await extractMark();
  console.log(`outline copy: ${m.ds.length} paths, ${m.w}×${m.h}`);

  // 1. The in-app mark, as data for components/Logo.tsx. currentColor so it
  //    follows --ink rather than pinning a hex into the header.
  const mark = markSvg(m, "currentColor");
  writeFileSync(
    join(ROOT, "components/brand/mark.ts"),
    `// GENERATED by scripts/build_brand.ts — do not edit.\n` +
      `// Source: docs/brand/train-mark-outline.svg\n\n` +
      `export const MARK_VIEW_BOX = ${JSON.stringify(mark.viewBox)};\n\n` +
      `export const MARK_PATHS: readonly string[] = [\n` +
      m.ds.map((d) => `  ${JSON.stringify(d)},\n`).join("") +
      `];\n`
  );

  // 2. Scalable app icon — the tab favicon in modern browsers and the "any"
  //    icon in the manifest.
  const iconSvg = tile(m, 512, { radius: 112, inset: TILE_INSET });
  writeFileSync(join(ROOT, "public/icon.svg"), iconSvg + "\n");

  // 3. Raster icons. Rounded tile for the manifest's "any" sizes; square
  //    full-bleed for apple-touch (iOS masks its own corners and shows
  //    transparency as black) and for maskable (the platform crops it).
  const rounded = (size: number, inset = TILE_INSET) =>
    tile(m, size, { radius: Math.round(size * 0.22), inset });
  const square = (size: number, inset: number) => tile(m, size, { radius: 0, inset });

  const png = (svg: string, size: number) =>
    sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

  const icon192 = await png(rounded(192), 192);
  const icon512 = await png(rounded(512), 512);
  // 0.52 keeps the mark inside the 80%-diameter safe circle maskable icons
  // are cropped to.
  const maskable = await png(square(512, 0.52), 512);
  const apple = await png(square(180, 0.78), 180);
  const fav32 = await png(rounded(32, FAVICON_INSET), 32);

  writeFileSync(join(ROOT, "public/icon-192.png"), icon192);
  writeFileSync(join(ROOT, "public/icon-512.png"), icon512);
  writeFileSync(join(ROOT, "public/icon-maskable-512.png"), maskable);
  writeFileSync(join(ROOT, "public/apple-touch-icon.png"), apple);
  writeFileSync(join(ROOT, "app/favicon.ico"), ico(fav32, 32));

  console.log("wrote components/brand/mark.ts, public/icon*.png, public/icon.svg, app/favicon.ico");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
