// Builds every file in src-tauri/icons/ from the two drawings in assets/icon/.
//
//   node scripts/make-icons.mjs          (in app/)
//
// doozer.svg is the whole creature and is used from 48 pixels up. doozer-small.svg is the
// same creature with the limbs left out and the face made heavier, and is used at 16 to 40
// pixels, where the whole one turns to a peach smudge. Tauri's own `tauri icon` does the
// drawing; what this script adds is the mixing of the two, which that command cannot do.
//
// The 32-pixel layer is written first in icon.ico on purpose: the shell takes the first
// layer for the tray icon (tray.rs, `default_window_icon`), and Windows scales it to the
// tray's 16, 20 or 24 pixels.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(app, 'src-tauri', 'icons');
const whole = join(app, 'assets', 'icon', 'doozer.svg');
const small = join(app, 'assets', 'icon', 'doozer-small.svg');

/** The layers of icon.ico, in the order they are written, and which drawing each comes from. */
const SMALL_SIZES = [32, 16, 20, 24, 40];
const WHOLE_SIZES = [48, 64, 256];

const scratch = mkdtempSync(join(tmpdir(), 'doozer-icons-'));
const tauri = join(app, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const draw = (...args) => execFileSync(process.execPath, [tauri, 'icon', ...args], { cwd: app, stdio: 'ignore' });

try {
  // 1. The standard set, from the whole drawing.
  const full = join(scratch, 'full');
  draw(whole, '-o', full);
  for (const name of readdirSync(full, { withFileTypes: true })) {
    // The phone folders are not ours to ship: v1 is Windows-only.
    if (name.isFile() && name.name !== 'icon.ico' && name.name !== '64x64.png') {
      copyFileSync(join(full, name.name), join(icons, name.name));
    }
  }

  // 2. The layers of the .ico, each from the drawing made for its size.
  const smallOut = join(scratch, 'small');
  const wholeOut = join(scratch, 'whole');
  draw(small, '-o', smallOut, '-p', SMALL_SIZES.join(','));
  draw(whole, '-o', wholeOut, '-p', WHOLE_SIZES.join(','));
  const layers = [
    ...SMALL_SIZES.map((size) => ({ size, png: readFileSync(join(smallOut, `${size}x${size}.png`)) })),
    ...WHOLE_SIZES.map((size) => ({ size, png: readFileSync(join(wholeOut, `${size}x${size}.png`)) })),
  ];
  writeFileSync(join(icons, 'icon.ico'), ico(layers));

  // 3. The one small PNG the bundle lists.
  copyFileSync(join(smallOut, '32x32.png'), join(icons, '32x32.png'));

  console.log(`icons written to ${icons}: icon.ico with ${layers.map((l) => l.size).join(', ')} px`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

/** An .ico file whose layers are PNGs (read by every Windows since Vista). */
function ico(layers) {
  const header = Buffer.alloc(6 + 16 * layers.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // an icon, not a cursor
  header.writeUInt16LE(layers.length, 4);
  let offset = header.length;
  layers.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at); // width; 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, at + 1); // height
    header.writeUInt8(0, at + 2); // no palette
    header.writeUInt8(0, at + 3); // reserved
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...layers.map((l) => l.png)]);
}
