// three.js is for the Island view only, loaded on demand (WORK_PLAN.md section 3). This
// walks what the app loads at start-up, following every import that is not a dynamic
// `import()`, and fails if three.js is anywhere in it.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'src');

/** The modules a file loads when it is loaded: its static imports and re-exports, but not `import type`. */
function staticImports(file: string): string[] {
  const text = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  const pattern = /^\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
  for (const match of text.matchAll(pattern)) {
    if (match[2]) continue;                          // import type / export type: gone when compiled
    found.push((match[4] ?? match[5]) as string);
  }
  return found;
}

function resolveModule(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;       // a package
  const bare = specifier.replace(/\?.*$/, '');
  const base = resolve(dirname(from), bare);
  for (const candidate of [base, `${base}.ts`, resolve(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every source file loaded with `entry`, and every package named along the way. */
function loadedWith(entry: string): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (files.has(file) || !file.endsWith('.ts')) continue;
    files.add(file);
    for (const specifier of staticImports(file)) {
      const target = resolveModule(file, specifier);
      if (target) queue.push(target);
      else if (!specifier.startsWith('.') && !packages.has(specifier)) packages.set(specifier, file);
    }
  }
  return { files, packages };
}

const isThree = (name: string): boolean => name === 'three' || name.startsWith('three/');

describe('three.js stays out of what the app loads at start-up', () => {
  const app = loadedWith(resolve(SRC, 'main.ts'));

  it('the walk really does follow the app: it reaches the views, the kit and the brain', () => {
    const reached = (path: string): boolean => app.files.has(resolve(SRC, path));
    expect(reached('views/island/index.ts')).toBe(true);
    expect(reached('views/pill/index.ts')).toBe(true);
    expect(reached('ui/card.ts')).toBe(true);
    expect(reached('core/brain.ts')).toBe(true);
    expect(app.packages.has('@tauri-apps/api/core')).toBe(true);
  });

  it('no module loaded at start-up imports three.js', () => {
    const offenders = [...app.packages].filter(([name]) => isThree(name)).map(([name, file]) => `${file} imports ${name}`);
    expect(offenders).toEqual([]);
  });

  it('the three files that do import it are not loaded at start-up', () => {
    for (const path of ['views/island/stage3d.ts', 'views/island/props3d.ts', 'character/doozer3d.ts']) {
      const file = resolve(SRC, path);
      expect(staticImports(file).some(isThree), `${path} imports three.js`).toBe(true);
      expect(app.files.has(file), `${path} is loaded at start-up`).toBe(false);
    }
  });

  it('the Island view reaches them with a dynamic import, made on mount', () => {
    const text = readFileSync(resolve(SRC, 'views/island/index.ts'), 'utf8');
    expect(text).toMatch(/import\('\.\/stage3d'\)/);
    expect(text).toMatch(/import\('\.\.\/\.\.\/character\/doozer3d'\)/);
  });

  it('the character folder\'s front door does not hand out the 3D Doozer', () => {
    const front = loadedWith(resolve(SRC, 'character/index.ts'));
    expect(front.files.has(resolve(SRC, 'character/doozer3d.ts'))).toBe(false);
    expect([...front.packages.keys()].filter(isThree)).toEqual([]);
    // The body's arithmetic has no three.js in it either, so it can be tested and reused freely.
    expect([...loadedWith(resolve(SRC, 'character/body-motion.ts')).packages.keys()].filter(isThree)).toEqual([]);
  });

  it('the world, the director, the regions and the loop have no three.js in them', () => {
    for (const path of ['views/island/world.ts', 'views/island/director.ts', 'views/island/regions.ts', 'views/island/camera.ts', 'views/island/loop.ts', 'views/island/layout.ts']) {
      expect([...loadedWith(resolve(SRC, path)).packages.keys()].filter(isThree), path).toEqual([]);
    }
  });

  it('the scripted checks are only loaded in a test run', () => {
    expect(app.files.has(resolve(SRC, 'views/island/checks.ts'))).toBe(false);
    expect(app.files.has(resolve(SRC, 'views/island/dev/playground.ts'))).toBe(false);
  });
});
