import { describe, expect, it } from 'vitest';
import { createBrain } from '../../src/core';
import { SAVE_VERSION } from '../../src/core/save';
import { HOUR, MIN, START, fakeClock, rig, seeded } from './helpers';

interface SaveShape {
  v: number;
  lastSeen: number;
  pet: { needs: Record<string, number>; treats: number; bowl: number; favourite: string; bond: number; name: string; asleep: boolean };
  focus: { minutes: number; status: string; endsAt: number; remainingMs: number };
  progress: { sessions: number; streak: number; best: number; lastDay: number | null };
  settings: Record<string, unknown>;
}

function load(save: unknown, now = START) {
  return createBrain({ save, now: () => now, random: seeded(1), debug: true });
}

/** A realistic save from a pet that has been lived with for a while. */
function usedSave(): SaveShape {
  const r = rig();
  r.debug.setNeeds({ tummy: 55, fun: 44, energy: 66, clean: 33 });
  for (let i = 0; i < 4; i++) {
    r.brain.startFocus();
    r.debug.finishFocusNow();
  }
  r.debug.setNeeds({ tummy: 80 });
  r.brain.fillBowl();
  r.brain.setSetting('palette', 'mint');
  r.brain.setSetting('sound', true);
  r.brain.setFocusLength(50);
  return JSON.parse(JSON.stringify(r.brain.serialize())) as SaveShape;
}

describe('serialize', () => {
  it('is plain JSON and carries a version', () => {
    const save = rig().brain.serialize() as SaveShape;
    expect(save.v).toBe(SAVE_VERSION);
    expect(JSON.parse(JSON.stringify(save))).toEqual(save);
  });

  it('round-trips: the restored pet is the same pet', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 55.5, fun: 44.25, energy: 66, clean: 33 });
    r.brain.fillBowl();
    r.brain.giveTreat();
    r.brain.setSetting('palette', 'sky');
    r.brain.setSetting('size', { pill: 'small', room: 'large', island: 'medium', desktop: 'medium' });
    const later = r.restart();
    expect(later.brain.state).toEqual(r.brain.state);
    expect(later.brain.settings).toEqual(r.brain.settings);
    expect(later.brain.serialize()).toEqual(r.brain.serialize());
  });

  it('hands out a copy: changing it does not change the pet', () => {
    const r = rig();
    const save = r.brain.serialize() as SaveShape;
    save.pet.needs.tummy = 0;
    save.settings.palette = 'sky';
    expect(r.brain.state.needs.tummy).toBe(72);
    expect(r.brain.settings.palette).toBe('peach');
    expect((r.brain.serialize() as SaveShape).pet.needs.tummy).toBe(72);
  });

  it('does not advance time or fire events', () => {
    const r = rig();
    r.clock.advance(HOUR);
    const save = r.brain.serialize() as SaveShape;
    expect(save.lastSeen).toBe(START);
    expect(r.events).toHaveLength(0);
  });

  it('keeps the hidden bond', () => {
    const r = rig();
    r.brain.pet();
    const bond = (r.brain.serialize() as SaveShape).pet.bond;
    expect(bond).toBeGreaterThan(12);
    expect((r.restart().brain.serialize() as SaveShape).pet.bond).toBe(bond);
  });
});

describe('loading: no save or a ruined one gives a newly hatched Doozer', () => {
  const ruined: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['a boolean', true],
    ['not JSON', 'definitely not json'],
    ['truncated JSON', '{"v":2,"pet":{"needs":{"tum'],
    ['an empty string', ''],
    ['an array', [1, 2, 3]],
    ['an empty object', {}],
    ['no version', { pet: { needs: { tummy: 5 } } }],
    ['a text version', { v: 'two', pet: { needs: {} } }],
    ['version zero', { v: 0, pet: { needs: {} } }],
    ['a fractional version', { v: 1.5, pet: { needs: {} } }],
    ['no pet', { v: 2 }],
    ['pet is null', { v: 2, pet: null }],
    ['pet is a string', { v: 2, pet: 'Doozer' }],
    ['needs missing', { v: 2, pet: { name: 'X' } }],
    ['needs is an array', { v: 2, pet: { needs: [1, 2, 3, 4] } }],
    ['a version 1 save with no needs', { v: 1, name: 'Doozer' }],
    ['a function', () => 1],
  ];
  for (const [name, save] of ruined) {
    it(name, () => {
      let brain!: ReturnType<typeof load>;
      expect(() => (brain = load(save))).not.toThrow();
      const s = brain.state;
      expect(s.needs).toEqual({ tummy: 72, fun: 64, energy: 80, clean: 88 });
      expect(s.treats).toBe(2);
      expect(s.bowl).toBe(0);
      expect(s.bornAt).toBe(START);
      expect(s.sessionsCompleted).toBe(0);
      expect(brain.settings.palette).toBe('peach');
      expect(() => brain.tick()).not.toThrow();
      expect(() => brain.serialize()).not.toThrow();
    });
  }

  it('survives a getter that throws', () => {
    const trap = {
      get v(): number {
        throw new Error('boom');
      },
    };
    expect(() => load(trap)).not.toThrow();
    expect(load(trap).state.treats).toBe(2);
  });

  it('survives a clock or random source that returns nonsense', () => {
    expect(() => createBrain({ now: () => NaN, random: () => NaN }).tick()).not.toThrow();
    expect(() => createBrain({ now: () => Infinity, random: () => -5 }).feed()).not.toThrow();
    const brain = createBrain({ save: usedSave(), now: () => NaN, random: () => 7 });
    expect(() => brain.giveTreat()).not.toThrow();
    expect(brain.state.sessionsCompleted).toBe(4);
  });
});

describe('loading: a save that is mostly fine keeps what is valid', () => {
  it('reads a good save completely', () => {
    const save = usedSave();
    const s = load(save).state;
    expect(s.needs.tummy).toBe(80);
    expect(s.bowl).toBe(3);
    expect(s.sessionsCompleted).toBe(4);
    expect(s.streak).toEqual({ current: 1, best: 1 });
    expect(s.focus.minutes).toBe(50);
    expect(load(save).settings.palette).toBe('mint');
    expect(load(save).settings.sound).toBe(true);
  });

  it('accepts the save as a JSON string', () => {
    expect(load(JSON.stringify(usedSave())).state.sessionsCompleted).toBe(4);
  });

  it('clamps numbers that are out of range', () => {
    const save = usedSave();
    save.pet.needs = { tummy: 500, fun: -20, energy: 50, clean: 100 };
    save.pet.treats = 999;
    save.pet.bowl = 12;
    save.pet.bond = 1e9;
    const brain = load(save);
    expect(brain.state.needs).toMatchObject({ tummy: 100, fun: 0, clean: 100 });
    expect(brain.state.treats).toBe(20);
    expect(brain.state.bowl).toBe(3);
    expect((brain.serialize() as SaveShape).pet.bond).toBeLessThanOrEqual(100);
  });

  it('replaces single bad fields with defaults and keeps the rest', () => {
    const save = usedSave() as unknown as Record<string, Record<string, unknown>>;
    const pet = save.pet as Record<string, unknown>;
    (pet.needs as Record<string, unknown>).fun = 'lots';
    (pet.needs as Record<string, unknown>).clean = null;
    pet.treats = NaN;
    pet.favourite = 'caviar';
    pet.name = 12;
    pet.asleep = 'yes';
    const brain = load(save);
    const s = brain.state;
    expect(s.needs.tummy).toBe(80); // kept
    expect(s.needs.fun).toBe(64); // default
    expect(s.needs.clean).toBe(88); // default
    expect(s.treats).toBe(2);
    expect(['biscuit', 'cookie', 'donut', 'strawberry', 'onigiri']).toContain(s.favourite);
    expect(s.name).toBe('Doozer');
    expect(s.asleep).toBe(false);
    expect(s.sessionsCompleted).toBe(4); // kept
  });

  it('falls back to defaults for bad settings, one by one', () => {
    const save = usedSave();
    save.settings = {
      palette: 'neon',
      size: { pill: 'small', room: 'gigantic', island: 7 },
      pillDock: 'bottom-left',
      sound: 'yes',
      alwaysOnTop: false,
      hat: 'crown',
      lastView: 'room',
      somethingElse: true,
    };
    const settings = load(save).settings;
    expect(settings.palette).toBe('peach');
    expect(settings.size).toEqual({ pill: 'small', room: 'medium', island: 'medium', desktop: 'medium' });
    expect(settings.pillDock).toBe('top-center');
    expect(settings.sound).toBe(false);
    expect(settings.alwaysOnTop).toBe(false); // valid, kept
    expect(settings.hat).toBeNull();
    expect(settings.lastView).toBe('room'); // valid, kept
    expect('somethingElse' in settings).toBe(false);
  });

  it('copes with missing sections', () => {
    const save = usedSave() as Partial<SaveShape>;
    delete save.focus;
    delete save.progress;
    delete save.settings;
    const brain = load(save);
    expect(brain.state.focus).toEqual({ status: 'idle', minutes: 25, remainingMs: 25 * MIN, progress: 0 });
    expect(brain.state.sessionsCompleted).toBe(0);
    expect(brain.state.streak).toEqual({ current: 0, best: 0 });
    expect(brain.settings.palette).toBe('peach');
    expect(brain.state.needs.tummy).toBe(80);
  });

  it('never restores a session with more time left than its length', () => {
    const save = usedSave();
    save.focus = { minutes: 25, status: 'running', endsAt: save.lastSeen + 99 * HOUR, remainingMs: 0 };
    expect(load(save, save.lastSeen).state.focus.remainingMs).toBe(25 * MIN);

    save.focus = { minutes: 15, status: 'paused', endsAt: 0, remainingMs: 99 * HOUR };
    expect(load(save, save.lastSeen).state.focus.remainingMs).toBe(15 * MIN);
  });

  it('drops a session whose details are unreadable', () => {
    const save = usedSave();
    save.focus = { minutes: 25, status: 'running', endsAt: NaN, remainingMs: 0 };
    expect(load(JSON.parse(JSON.stringify(save))).state.focus.status).toBe('idle');
    save.focus = { minutes: 25, status: 'paused', endsAt: 0, remainingMs: -5 };
    expect(load(save).state.focus.status).toBe('idle');
    save.focus = { minutes: 33, status: 'dancing', endsAt: 0, remainingMs: 0 };
    expect(load(save).state.focus).toMatchObject({ status: 'idle', minutes: 25 });
  });

  it('reads what it can from a save written by a newer version', () => {
    const save = usedSave() as SaveShape & { somethingNew?: unknown };
    save.v = SAVE_VERSION + 5;
    save.somethingNew = { shiny: true };
    expect(load(save).state.sessionsCompleted).toBe(4);
  });

  it('treats a missing or impossible last-seen time as "just now"', () => {
    const save = usedSave() as unknown as Record<string, unknown>;
    save.lastSeen = 'yesterday';
    const brain = load(save, START + 5 * HOUR);
    expect(brain.state.needs.tummy).toBe(80); // no catch-up was run
    expect((brain.serialize() as SaveShape).lastSeen).toBe(START + 5 * HOUR);
  });
});

describe('migrations', () => {
  /** What mockups/shared/sim.js wrote to localStorage in Phase 1. */
  const mockupSave = {
    v: 1,
    name: 'Doozer',
    bornAt: START - 3 * 24 * HOUR,
    lastSeen: START,
    age: 259_200,
    needs: { tummy: 41.5, fun: 77, energy: 23, clean: 60 },
    bond: 55,
    asleep: true,
    messes: 2,
    messIn: 4000,
    treats: 31,
  };

  it('brings a version 1 (mockup) save up to date', () => {
    const brain = load(mockupSave);
    const s = brain.state;
    expect(s.needs).toEqual({ tummy: 42, fun: 77, energy: 23, clean: 60 });
    expect(s.asleep).toBe(true);
    expect(s.bornAt).toBe(mockupSave.bornAt);
    expect(s.treats).toBe(20); // the jar now has a cap
    expect(s.bowl).toBe(0);
    expect(s.focus.status).toBe('idle');
    expect(s.streak).toEqual({ current: 0, best: 0 });
    expect(brain.settings.palette).toBe('peach');
  });

  it('writes it back in the current format, with no trace of messes', () => {
    const save = load(mockupSave).serialize() as SaveShape;
    expect(save.v).toBe(SAVE_VERSION);
    expect(save.pet.bond).toBe(55);
    const text = JSON.stringify(save);
    expect(text).not.toContain('mess');
    expect(text).not.toContain('"age"');
  });

  it('runs the catch-up on a migrated save like any other', () => {
    const brain = load(mockupSave, START + 2 * HOUR);
    expect(brain.state.asleep).toBe(false); // slept from 23 to 100, then woke
    expect(brain.state.needs.energy).toBeGreaterThan(90);
  });

  it('is stable: loading a current save and saving again changes nothing', () => {
    const save = usedSave();
    const again = load(save, save.lastSeen).serialize();
    expect(again).toEqual(save);
  });
});

describe('a fake clock that is shared', () => {
  it('lets two brains restore from the same save without affecting each other', () => {
    const clock = fakeClock();
    const a = rig({ clock });
    a.debug.setNeeds({ tummy: 40 });
    const save = a.brain.serialize();
    const b = createBrain({ save, now: clock.now, random: seeded(2) });
    b.feed();
    expect(a.brain.state.needs.tummy).toBe(40);
    expect(b.state.needs.tummy).toBe(72);
  });
});
