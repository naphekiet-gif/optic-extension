// Generates placeholder icons for the Optic Chrome extension.
// Renders an SVG (rounded indigo square + amber ring) and rasterises it
// at the four sizes Chrome's manifest references. Run with: npm run icons
//
// The ring is drawn as a stroked circle (no text element) so output is
// pixel-identical across platforms regardless of installed fonts.

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const BG = '#1E2444';   // deep indigo
const FG = '#F4A261';   // warm amber
const SIZES = [16, 32, 48, 128];

function buildSvg(size) {
  const corner = size * 0.2;
  const center = size / 2;
  const radius = size * 0.32;
  const stroke = Math.max(1, size * 0.12);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${corner}" ry="${corner}" fill="${BG}"/>
  <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${FG}" stroke-width="${stroke}"/>
</svg>`;
}

await mkdir(ASSETS_DIR, { recursive: true });

console.log('Generating icons:');
for (const size of SIZES) {
  const svg = buildSvg(size);
  const outPath = path.join(ASSETS_DIR, `icon-${size}.png`);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outPath);
  console.log(`  wrote ${outPath}`);
}

console.log('\nVerifying:');
let allOk = true;
for (const size of SIZES) {
  const file = path.join(ASSETS_DIR, `icon-${size}.png`);
  const meta = await sharp(file).metadata();
  const ok = meta.format === 'png' && meta.width === size && meta.height === size;
  if (!ok) allOk = false;
  console.log(`  icon-${size}.png  ${meta.width}x${meta.height}  format=${meta.format}  ${ok ? 'OK' : 'FAIL'}`);
}

if (!allOk) {
  console.error('\nOne or more icons failed verification.');
  process.exit(1);
}
console.log('\nAll icons generated and verified.');
