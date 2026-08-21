// Generates every icon asset from scripts/icon-source.mjs.
//
//   npm run icons
//
// The master SVG uses only paths and linearGradients on userSpaceOnUse axes,
// which librsvg (via sharp) renders identically to a browser — verified against
// the design renders. .icns additionally needs macOS (iconutil); that one step
// is skipped with a warning on other platforms.

import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIcon, renderGlyph, tierFor, PALETTE } from './icon-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => path.join(root, ...s);

/** Rasterize an SVG string to a transparent PNG buffer of size x size. */
function raster(svg, size) {
  // librsvg honours the SVG's own width/height, so ask it for the exact pixel
  // size up front rather than rendering once and downsampling.
  const scaled = svg.replace(/width="[\d.]+" height="[\d.]+"/, `width="${size}" height="${size}"`);
  return sharp(Buffer.from(scaled)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

// Tier is picked from the target size so small renders get the thicker,
// wider-gapped geometry instead of a squashed copy of the large one.
const iconPng = (size, variant = 'dark') =>
  raster(renderIcon({ variant, tier: tierFor(size) }), size);

async function write(file, buf) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
  console.log(`  ${path.relative(root, file)}  (${(buf.length / 1024).toFixed(1)} KB)`);
}

// --- .ico -------------------------------------------------------------------

// ICO is a 6-byte header, then one 16-byte directory entry per image, then the
// payloads. Vista and later accept PNG payloads directly, so we embed them.
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, buf } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 encodes 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette size
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.buf)]);
}

// --- .icns ------------------------------------------------------------------

const ICNS_SLICES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

async function buildIcns(target) {
  if (process.platform !== 'darwin') {
    console.log('  skipped tai.icns — iconutil needs macOS');
    return;
  }
  const set = p('public', 'img', 'tai.iconset');
  await fs.rm(set, { recursive: true, force: true });
  await fs.mkdir(set, { recursive: true });
  try {
    for (const [name, size] of ICNS_SLICES) {
      await fs.writeFile(path.join(set, name), await iconPng(size));
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', target]);
  } finally {
    await fs.rm(set, { recursive: true, force: true });
  }
  const { size } = await fs.stat(target);
  console.log(`  ${path.relative(root, target)}  (${(size / 1024).toFixed(1)} KB)`);
}

// --- main -------------------------------------------------------------------

async function main() {
  console.log('\nsource');
  await write(p('public', 'img', 'tai.svg'), Buffer.from(renderIcon({ variant: 'dark' })));
  await write(p('public', 'img', 'tai-light.svg'), Buffer.from(renderIcon({ variant: 'light' })));

  console.log('\napp icon');
  // 1024 is the master; electron-builder downsamples it for the Linux target.
  await write(p('public', 'img', 'tai.png'), await iconPng(1024));
  await buildIcns(p('public', 'img', 'tai.icns'));

  // The .icon bundle composites this layer itself and applies its own shadow,
  // so it takes the flat tile with transparency outside the squircle.
  await write(p('public', 'img', 'tai.icon', 'Assets', 'tai-upgraded.png'), await iconPng(1024));

  console.log('\nwindows');
  const icoImages = [];
  for (const size of [16, 32, 48, 64, 128, 256]) {
    icoImages.push({ size, buf: await iconPng(size) });
  }
  await write(p('build', 'icon.ico'), encodeIco(icoImages));

  console.log('\ntray');
  // True menubar sizes, rendered exactly rather than downsampled — Electron
  // picks the @2x file up by filename convention, and a downscale from a larger
  // render visibly softens at 16px.
  const trayPng = (opts, size) => raster(renderGlyph(opts), size);
  const TRAY = [
    // macOS templates: flat mono plus alpha, recoloured by the OS.
    ['tai-black', { color: '#000000' }],
    ['tai-white', { color: '#FFFFFF' }],
    // Windows/Linux: the accent chevron survives a panel whose actual colour
    // disagrees with the system colour-scheme hint.
    ['tai-tray-on-dark', { color: PALETTE.primaryOnDark, accent: true }],
    ['tai-tray-on-light', { color: PALETTE.primaryOnLight, accent: true }],
  ];
  for (const [name, opts] of TRAY) {
    await write(p('public', 'img', `${name}.png`), await trayPng(opts, 16));
    await write(p('public', 'img', `${name}@2x.png`), await trayPng(opts, 32));
  }

  console.log('\nweb');
  await write(p('docs', 'favicon.png'), await iconPng(256));
  await write(p('docs', 'apple-touch-icon.png'), await iconPng(180));

  console.log('\ndone\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
