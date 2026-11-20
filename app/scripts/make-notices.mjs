// Writes src-tauri/installer/THIRD-PARTY-NOTICES.txt: the licences of everything by other
// people that is inside the installed program. The installer puts the file beside the
// executable. Run it again whenever a dependency changes (package.json, Cargo.toml):
//
//   node scripts/make-notices.mjs        (in app/)
//
// What is inside the program:
//   - the Fredoka typeface (src/ui/fonts/), SIL Open Font License;
//   - three.js, which draws the Island (MIT);
//   - Tauri's script library (@tauri-apps/api) and the Rust libraries the shell is built
//     from, found by asking cargo which ones a Windows build links (build-only tools and
//     test-only libraries are not in the program and are left out).
//
// For a library offered under a choice of licences the MIT one is taken where there is one.
// Each library's own licence file is copied from its source, so the copyright lines are
// the authors' own; identical texts are printed once, with the libraries they cover.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauri = join(app, 'src-tauri');
const out = join(tauri, 'installer', 'THIRD-PARTY-NOTICES.txt');
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/^﻿/, '').trim();

// ---- the Rust libraries in the program ------------------------------------------------

const metadata = JSON.parse(
  execFileSync('cargo', ['metadata', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc'], {
    cwd: tauri,
    maxBuffer: 256 * 1024 * 1024,
    encoding: 'utf8',
  }),
);
const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
const linked = new Set();
for (const stack = [metadata.resolve.root]; stack.length; ) {
  const id = stack.pop();
  if (linked.has(id)) continue;
  linked.add(id);
  for (const dep of nodes.get(id).deps) {
    // kind null is an ordinary dependency; "build" and "dev" ones never reach the program.
    if (dep.dep_kinds.some((kind) => kind.kind === null)) stack.push(dep.pkg);
  }
}
linked.delete(metadata.resolve.root);

const LICENCE_FILE = /^(licen[cs]e|copying|unlicense|notice)/i;

function licenceFiles(dir, expression) {
  const names = readdirSync(dir).filter((name) => LICENCE_FILE.test(name) && !/\.(rs|toml)$/i.test(name));
  const offersMit = /\bMIT\b/.test(expression) && /\bOR\b|\//.test(expression);
  if (offersMit) {
    const mit = names.filter((name) => /mit/i.test(name));
    if (mit.length) return mit;
  }
  // No choice to make, or no file named for the choice: everything the authors shipped.
  return names;
}

/** text -> { text, covers: [name version], licence } */
const texts = new Map();
const without = [];
const crates = [...linked].map((id) => packages.get(id)).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
for (const pkg of crates) {
  const dir = dirname(pkg.manifest_path);
  const label = `${pkg.name} ${pkg.version}`;
  const expression = pkg.license ?? 'see its licence file';
  const files = licenceFiles(dir, expression);
  if (!files.length) {
    without.push({ label, expression, repository: pkg.repository ?? '' });
    continue;
  }
  for (const file of files) {
    const text = read(join(dir, file));
    const key = createHash('sha256').update(text.replace(/\s+/g, ' ')).digest('hex');
    const entry = texts.get(key) ?? { text, covers: [] };
    entry.covers.push(`${label} (${expression})`);
    texts.set(key, entry);
  }
}

// ---- the page's libraries --------------------------------------------------------------

const modules = join(app, 'node_modules');
const three = JSON.parse(readFileSync(join(modules, 'three', 'package.json'), 'utf8'));
const api = JSON.parse(readFileSync(join(modules, '@tauri-apps', 'api', 'package.json'), 'utf8'));
const apiLicence = ['LICENSE_MIT', 'LICENSE-MIT', 'LICENSE'].map((name) => join(modules, '@tauri-apps', 'api', name)).find(existsSync);

// ---- the file --------------------------------------------------------------------------

const rule = '='.repeat(78);
const thin = '-'.repeat(78);
const parts = [];
parts.push(`THIRD-PARTY NOTICES

Doozer is built with the work of other people. This file lists what is inside the
installed program and gives each piece's licence. It is made by
app/scripts/make-notices.mjs and is not written by hand.

Not in the program, but used by it: the Microsoft Edge WebView2 Runtime, which is
part of Windows and is Microsoft's.

Contents
  1. The Fredoka typeface
  2. three.js
  3. Tauri's script library (@tauri-apps/api)
  4. The Rust libraries of the shell (${crates.length} of them)`);

parts.push(`${rule}
1. The Fredoka typeface
${rule}

${read(join(app, 'src', 'ui', 'fonts', 'OFL-LICENSE.txt'))}`);

parts.push(`${rule}
2. three.js ${three.version}  (https://threejs.org)
${rule}

${read(join(modules, 'three', 'LICENSE'))}`);

parts.push(`${rule}
3. @tauri-apps/api ${api.version}  (https://tauri.app), ${api.license}; used under the MIT licence
${rule}

${apiLicence ? read(apiLicence) : 'Its licence text is the MIT licence of the Tauri libraries, printed in section 4.'}`);

const mpl = crates.filter((pkg) => /MPL/.test(pkg.license ?? ''));
parts.push(`${rule}
4. The Rust libraries of the shell
${rule}

Each text below is printed once, under the names of the libraries that carry it.
Where a library offers a choice of licences, Doozer uses it under the MIT licence.
${
  mpl.length
    ? `
These are under the Mozilla Public License 2.0 and are used unchanged; their source
is where their authors publish it:
${mpl.map((pkg) => `  ${pkg.name} ${pkg.version}  ${pkg.repository ?? `https://crates.io/crates/${pkg.name}`}`).join('\n')}
`
    : ''
}${
  without.length
    ? `
These ship no licence file of their own; the licence each one names applies:
${without.map((w) => `  ${w.label}  (${w.expression})  ${w.repository}`).join('\n')}
`
    : ''
}`);

for (const { text, covers } of [...texts.values()].sort((a, b) => b.covers.length - a.covers.length)) {
  parts.push(`${thin}
${covers.join('\n')}
${thin}

${text}`);
}

writeFileSync(out, parts.join('\n\n') + '\n', 'utf8');
console.log(`${out}: ${crates.length} Rust libraries, ${texts.size} different licence texts, ${without.length} without a file of their own`);
