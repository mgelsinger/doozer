import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as core from '../../src/core';

const CORE_DIR = fileURLToPath(new URL('../../src/core/', import.meta.url));
const files = readdirSync(CORE_DIR, { recursive: true })
  .map(String)
  .filter((name) => name.endsWith('.ts'));

function source(name: string): string {
  return readFileSync(CORE_DIR + name, 'utf8');
}

/** Source with comments and string contents removed, so words in prose do not count. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
}

describe('core/ is self-contained', () => {
  it('has the files this test expects to be checking', () => {
    expect(files).toEqual(expect.arrayContaining(['brain.ts', 'contract.ts', 'index.ts', 'rules.ts', 'save.ts', 'time.ts', 'tuning.ts']));
  });

  it('imports nothing from outside core/', () => {
    const offenders: string[] = [];
    for (const name of files) {
      const text = source(name);
      const specifiers = [
        ...text.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g),
        ...text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
        ...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
        ...text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]/g),
      ].map((m) => m[1] ?? '');
      for (const spec of specifiers) {
        if (!spec.startsWith('./') || spec.includes('..')) offenders.push(`${name}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('touches no DOM, no storage and no timers', () => {
    const banned =
      /\b(document|window|navigator|localStorage|sessionStorage|indexedDB|fetch|setTimeout|setInterval|requestAnimationFrame|queueMicrotask|performance|process|import\.meta)\b/;
    const offenders: string[] = [];
    for (const name of files) {
      const hit = banned.exec(codeOnly(source(name)));
      if (hit) offenders.push(`${name}: ${hit[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('only reads the clock and the dice it is given, apart from the documented defaults', () => {
    for (const name of files) {
      const code = codeOnly(source(name));
      const dateNow = code.match(/Date\.now/g)?.length ?? 0;
      const mathRandom = code.match(/Math\.random/g)?.length ?? 0;
      if (name === 'brain.ts') {
        expect(mathRandom, 'Math.random is only the default for options.random').toBe(1);
        expect(dateNow, 'Date.now is only the default for options.now').toBeLessThanOrEqual(2);
      } else {
        expect(dateNow, name).toBe(0);
        expect(mathRandom, name).toBe(0);
      }
    }
  });

  it('exports createBrain and nothing else at run time', () => {
    expect(Object.keys(core)).toEqual(['createBrain']);
  });

  it('is deterministic: the same save, clock and seed give the same pet', () => {
    const run = (): unknown => {
      let now = 1_800_000_000_000;
      let seed = 42;
      const random = (): number => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const brain = core.createBrain({ now: () => now, random });
      for (let i = 0; i < 2000; i++) {
        now += 37_000;
        brain.tick();
        if (i % 50 === 0) brain.fillBowl();
        if (i % 70 === 0) brain.play();
        if (i % 90 === 0) brain.giveTreat();
        if (i % 400 === 0) brain.startFocus();
      }
      return brain.serialize();
    };
    expect(run()).toEqual(run());
  });
});
