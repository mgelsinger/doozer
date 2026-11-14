// What goes in the save file, and when it is written.
//
// The file holds two things side by side: the brain's own save (`brain.serialize()`,
// whose format and migrations belong to core/save.ts) and the little the host owns,
// which is about the window rather than the pet (docs/brain-contract.md, "What the
// host does"). Reading never throws: anything unusable gives a fresh start.

import type { ViewId } from '../core/contract';
import { realTimers, type Timers } from '../character/timers';

export const SAVE_DOC_VERSION = 1;

export interface Position {
  x: number;
  y: number;
}

/** The host's own part of the save. */
export interface HostData {
  /** `bornAt` of the pet whose hatching has been shown, or null if none has. */
  welcomedPet: number | null;
  /** Where the user left each floating view's window (physical screen pixels, from the shell). */
  positions: Partial<Record<ViewId, Position>>;
  /**
   * A small note each view may keep about itself (`ViewMemory` in view.ts). The host
   * stores it and hands it back without looking inside. Absent until a view writes one.
   */
  memory?: Partial<Record<ViewId, unknown>>;
}

export interface ParsedSave {
  /** What to hand to `createBrain({ save })`. Undefined when there is nothing usable. */
  brain: unknown;
  host: HostData;
}

const VIEWS: readonly ViewId[] = ['pill', 'room', 'island', 'desktop'];

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);

export function freshHostData(): HostData {
  return { welcomedPet: null, positions: {} };
}

function readHostData(raw: unknown): HostData {
  const data = freshHostData();
  if (!isBag(raw)) return data;
  if (typeof raw.welcomedPet === 'number' && Number.isFinite(raw.welcomedPet)) data.welcomedPet = raw.welcomedPet;
  if (isBag(raw.positions)) {
    for (const view of VIEWS) {
      const at = raw.positions[view];
      if (isBag(at) && Number.isFinite(at.x) && Number.isFinite(at.y)) {
        data.positions[view] = { x: Math.round(at.x as number), y: Math.round(at.y as number) };
      }
    }
  }
  if (isBag(raw.memory)) {
    for (const view of VIEWS) {
      const note = raw.memory[view];
      if (note !== undefined && note !== null) (data.memory ??= {})[view] = note;
    }
  }
  return data;
}

/** Read the save file's text. Never throws. */
export function parseSave(text: string | null): ParsedSave {
  if (text === null) return { brain: undefined, host: freshHostData() };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { brain: undefined, host: freshHostData() };
  }
  if (!isBag(doc)) return { brain: undefined, host: freshHostData() };
  if (isBag(doc.brain)) return { brain: doc.brain, host: readHostData(doc.host) };
  // A bare brain save (no wrapper): still a pet worth keeping.
  if (isBag(doc.pet)) return { brain: doc, host: freshHostData() };
  return { brain: undefined, host: freshHostData() };
}

export function buildSave(brain: unknown, host: HostData): string {
  return JSON.stringify({ app: 'doozer', v: SAVE_DOC_VERSION, brain, host });
}

// ---- when to write --------------------------------------------------------------

export interface SaverOptions {
  /** The document to write, built at the moment of writing. */
  build(): string;
  write(json: string): Promise<void>;
  timers?: Timers;
  /** Something happened (an action, a setting, a session): write this soon after. */
  soonMs?: number;
  /** Only time has passed: writing can wait this long. */
  lazyMs?: number;
  /** A write failed: try again after this long (or sooner, if asked to flush). */
  retryMs?: number;
  onError?(error: unknown): void;
}

export interface Saver {
  /**
   * Something changed. 'soon' for anything that happened; 'lazy' when only the clock
   * moved, which the brain works out again from `lastSeen` on the next start anyway.
   */
  touch(urgency: 'soon' | 'lazy'): void;
  /** Write now if anything is unsaved, and wait for it. Never rejects. */
  flush(): Promise<void>;
  /** True while there is something not yet on disk. */
  readonly dirty: boolean;
  /** Stop the timers. Does not write. */
  dispose(): void;
}

/**
 * Debounced saving. One write at a time; a change that arrives during a write is
 * written afterwards. A failed write leaves the saver dirty, so the next touch or
 * flush tries again.
 */
export function createSaver(options: SaverOptions): Saver {
  const timers = options.timers ?? realTimers;
  const soonMs = options.soonMs ?? 400;
  const lazyMs = options.lazyMs ?? 5 * 60_000;
  const retryMs = options.retryMs ?? 30_000;
  let dirty = false;
  let timer: unknown = null;
  /** When the armed timer fires, as a delay from when it was armed: so 'soon' can replace 'lazy'. */
  let armedFor = Infinity;
  let writing: Promise<void> | null = null;
  let disposed = false;

  const disarm = (): void => {
    if (timer !== null) timers.clear(timer);
    timer = null;
    armedFor = Infinity;
  };

  const arm = (ms: number): void => {
    if (disposed) return;
    // A sooner deadline replaces a later one; a later one never pushes a sooner one back.
    if (timer !== null && armedFor <= ms) return;
    disarm();
    armedFor = ms;
    timer = timers.set(() => {
      timer = null;
      armedFor = Infinity;
      void run();
    }, ms);
  };

  const run = (): Promise<void> => {
    if (writing) return writing;
    if (!dirty) return Promise.resolve();
    disarm();
    dirty = false;
    let json: string;
    try {
      json = options.build();
    } catch (error) {
      dirty = true;
      options.onError?.(error);
      return Promise.resolve();
    }
    let failed = false;
    writing = options.write(json).then(
      () => undefined,
      (error: unknown) => {
        failed = true;
        dirty = true;
        options.onError?.(error);
      },
    ).then(() => {
      writing = null;
      // Something changed while the write was in flight, or the write failed: go again.
      // A failure waits longer, so a disk that keeps refusing is not hammered.
      if (dirty) arm(failed ? retryMs : soonMs);
    });
    return writing;
  };

  return {
    touch(urgency) {
      if (disposed) return;
      dirty = true;
      arm(urgency === 'soon' ? soonMs : lazyMs);
    },
    async flush() {
      // A write in flight may have started before the latest change: wait, then write again.
      if (writing) await writing;
      await run();
    },
    get dirty() { return dirty; },
    dispose() {
      disposed = true;
      disarm();
    },
  };
}
