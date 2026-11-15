// @vitest-environment happy-dom
//
// The Room's "never stuck" checks, an hour left alone, and switching views in the
// middle of things. The owner's one complaint about the mockups was that Doozer "would
// get stuck randomly"; every test here ends by asking whether Doozer has come back to
// rest: where it belongs, doing nothing, with nothing left lying about and no timer
// running that should not be.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrain, type Brain, type ViewId } from '../../../src/core';
import { createHost } from '../../../src/host/host';
import { freshHostData } from '../../../src/host/store';
import type { Region, Shell, WindowInfo, WindowMode } from '../../../src/shell';
import { createPillView } from '../../../src/views/pill';
import { createRoomView } from '../../../src/views/room';
import { SCENE_LIMIT_MS } from '../../../src/views/room/behaviour';
import { SPOT } from '../../../src/views/room/layout';
import { HOUR, MIN, seeded } from '../../core/helpers';
import { click, mount, pass, pointer, restoreClock, settle, unrest, useRoomClock, windowInfo, type Rig } from './helpers';

beforeEach(() => useRoomClock());
afterEach(restoreClock);

type Furniture = 'bed' | 'bowl' | 'soap' | 'lamp' | 'jar' | 'clock' | 'ball';
const FURNITURE: readonly Furniture[] = ['bed', 'bowl', 'soap', 'lamp', 'jar', 'clock', 'ball'];

/** A pet that will say yes to everything. */
const ready = (brain: Brain): void => {
  if (brain.state.asleep) brain.wake();
  brain.stopFocus();
  brain.debug?.setNeeds({ tummy: 75, fun: 40, energy: 70, clean: 40 });
  brain.debug?.addTreats(6);
};

/** Each scene the Room can play, and how to start it. */
const SCENES: readonly [string, (r: Rig) => void][] = [
  ['eat-bowl', (r) => { r.brain.fillBowl(); r.brain.debug?.setNeeds({ tummy: 55 }); }],
  ['eat', (r) => { r.brain.debug?.setNeeds({ tummy: 72 }); r.brain.feed(); }],
  ['treat', (r) => void r.brain.giveTreat()],
  ['play', (r) => void r.brain.play()],
  ['wash', (r) => void r.brain.wash()],
  ['to-bed', (r) => void r.brain.sleep()],
  ['fetch-book', (r) => void r.brain.startFocus()],
  ['celebrate', (r) => { r.brain.startFocus(); r.brain.debug?.finishFocusNow(); }],
];
const CUTS = [0, 150, 400, 900, 1500, 2400, 3600, 5200];

/** The brain has Doozer wait five minutes after a serving from the bowl before the next one. */
const BOWL_PACE_MS = 5 * MIN + 10_000;

/** Bring everything back to a calm start. `bowl`: the next thing involves eating from the bowl. */
async function prepare(r: Rig, bowl = false): Promise<void> {
  ready(r.brain);
  r.view.setOpen('none');
  await settle(r);
  if (!bowl) return;
  await pass(r, BOWL_PACE_MS, 1000);
  ready(r.brain);
  await settle(r);
}

/** Start a scene, and say so if it did not start: a test that interrupts nothing proves nothing. */
function begin(r: Rig, name: string, start: (r: Rig) => void, problems: string[], label: string): void {
  start(r);
  const playing = r.snap().scene;
  if (playing !== name) problems.push(`${label}: ${name} did not start (${playing ?? 'nothing'} is playing)`);
}

describe('never stuck: furniture clicked while Doozer is in the middle of a walk', () => {
  it('every piece of furniture, at several moments of a walk to the bowl', async () => {
    const r = mount();
    const problems: string[] = [];
    let midWalk = 0;
    for (const id of FURNITURE) {
      for (const at of [100, 600, 1200]) {
        await prepare(r, true);
        begin(r, 'eat-bowl', SCENES[0]![1], problems, `${id}@${at}`);
        // Up to `at` into the walk, but never past its end: how long the walk is depends on where Doozer was.
        for (let waited = 0; waited < at && Math.abs(r.snap().x - SPOT.bowl) > 6; waited += 50) await pass(r, 50, 50);
        if (r.snap().scene === 'eat-bowl' && r.snap().pose === 'walk' && r.snap().x !== SPOT.bowl) midWalk++;
        click(r.parts().furniture[id]);
        const wrong = await settle(r);
        if (wrong) problems.push(`${id}@${at}: ${wrong}`);
        // The bowl shows what the brain has, whatever was interrupted.
        if (r.snap().bowl !== r.brain.state.bowl) problems.push(`${id}@${at}: bowl drawn ${r.snap().bowl}, is ${r.brain.state.bowl}`);
      }
    }
    expect(problems).toEqual([]);
    // Nearly every click really did land mid-walk (once or twice Doozer was already standing at the bowl).
    expect(midWalk).toBeGreaterThanOrEqual(17);   // of 21
  });

  it('a bath begun mid-walk: Doozer stops on the spot, is scrubbed right there, and the walk is over', async () => {
    const r = mount();
    // Out of bed it stands well away from the bowl, so the walk there is a long one.
    click(r.parts().furniture.bed);
    await settle(r);
    click(r.parts().furniture.bed);
    await settle(r);
    const from = r.snap().x;
    r.brain.fillBowl();
    r.brain.debug?.setNeeds({ tummy: 55, clean: 30 });
    expect(r.snap()).toMatchObject({ scene: 'eat-bowl', pose: 'walk' });
    await pass(r, 400, 50);
    const at = r.snap().x;
    expect(at).toBeGreaterThan(from + 10);
    expect(at).toBeLessThan(SPOT.bowl - 10);

    click(r.parts().furniture.soap);
    expect(r.snap()).toMatchObject({ scene: 'wash', x: at });
    for (let waited = 0; waited < 6000 && r.snap().scene === 'wash'; waited += 100) {
      expect(r.snap().x).toBe(at);
      expect(r.snap().pose).not.toBe('walk');
      await pass(r, 100, 100);
    }
    expect(await settle(r)).toBe('');
    expect(r.snap()).toMatchObject({ x: at, bowl: r.brain.state.bowl });
    expect(r.parts().doozer.el.style.getPropertyValue('--dz-dir')).toBe('0');
  });

  it('the same during a stroll it took on its own, and while it is being petted', async () => {
    const r = mount({ seed: 4 });
    const problems: string[] = [];
    let cut = 0;
    for (let i = 0; i < 40 * 60 * 4 && cut < 14; i++) {
      pointer(r.parts().scene, 'pointermove');
      await pass(r, 250);
      const s = r.snap();
      if (s.scene !== 'wander' && s.scene !== 'look-out' && s.scene !== 'nudge-ball') continue;
      const id = FURNITURE[cut % FURNITURE.length]!;
      cut++;
      ready(r.brain);
      click(r.parts().petHit);
      click(r.parts().furniture[id]);
      const wrong = await settle(r);
      if (wrong) problems.push(`${s.scene} cut by ${id}: ${wrong}`);
      // Awake and free again, so that it goes strolling again.
      await prepare(r);
    }
    expect(cut).toBe(14);
    expect(problems).toEqual([]);
  });

  it('hammering everything at once', async () => {
    const r = mount();
    ready(r.brain);
    const { furniture, petHit, cardButton } = r.parts();
    for (let round = 0; round < 30; round++) {
      for (const id of FURNITURE) {
        click(furniture[id], 25);
        click(petHit, 10);
        if (round % 7 === 0) click(cardButton, 400);
        await pass(r, 40, 40);
      }
    }
    r.brain.stopFocus();
    if (r.brain.state.asleep) r.brain.wake();
    r.view.setOpen('none');
    expect(await settle(r)).toBe('');
    // And it still works.
    r.brain.debug?.addTreats(3);
    const treats = r.brain.state.treats;
    click(furniture.jar);
    expect(r.brain.state.treats).toBe(treats - 1);
    expect(await settle(r)).toBe('');
  });
});

describe('never stuck: every scene interrupted at several moments', () => {
  it('by another thing happening', async () => {
    const r = mount();
    const problems: string[] = [];
    let tookOver = 0;
    for (const [name, start] of SCENES) {
      for (const [other, interrupt] of SCENES) {
        for (const at of [200, 1300, 3000]) {
          await prepare(r, name === 'eat-bowl' || other === 'eat-bowl');
          begin(r, name, start, problems, `${name} then ${other}`);
          await pass(r, at, 50);
          interrupt(r);
          // The brain may say no (a treat for a sleeping Doozer), and Doozer does not
          // leave a game for the bowl: then the first scene simply carries on.
          if (r.snap().scene === other) tookOver++;
          const wrong = await settle(r);
          if (wrong) problems.push(`${name} cut at ${at} by ${other}: ${wrong}`);
          if (r.snap().bowl !== r.brain.state.bowl) problems.push(`${name} cut at ${at} by ${other}: bowl drawn ${r.snap().bowl}, is ${r.brain.state.bowl}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(tookOver).toBeGreaterThan(120);   // of 192
  });

  it('by being sent to bed, and by being woken again at once', async () => {
    const r = mount();
    const problems: string[] = [];
    for (const [name, start] of SCENES) {
      for (const at of CUTS) {
        await prepare(r, name === 'eat-bowl');
        begin(r, name, start, problems, `${name} at ${at}`);
        await pass(r, at, 50);
        r.brain.sleep();
        await pass(r, 300, 50);
        r.brain.wake();
        await pass(r, 300, 50);
        r.brain.sleep();
        let wrong = await settle(r);
        if (!wrong && r.brain.state.asleep && r.snap().station !== 'bed') wrong = 'asleep but not in bed';
        if (wrong) problems.push(`${name} cut at ${at}: ${wrong}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('by the Card being opened and closed', async () => {
    const r = mount();
    const problems: string[] = [];
    for (const [name, start] of SCENES) {
      for (const at of [0, 400, 1500, 3600]) {
        await prepare(r, name === 'eat-bowl');
        begin(r, name, start, problems, `${name} at ${at}`);
        await pass(r, at, 50);
        click(r.parts().cardButton);
        await pass(r, 200, 50);
        click(r.parts().cardButton);
        const wrong = await settle(r);
        if (wrong || r.snap().open !== 'none') problems.push(`${name} at ${at}: ${wrong || 'card left open'}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('by the window being tucked away, and brought back', async () => {
    const r = mount();
    const problems: string[] = [];
    for (const [name, start] of SCENES) {
      for (const at of CUTS) {
        await prepare(r, name === 'eat-bowl');
        begin(r, name, start, problems, `${name} at ${at}`);
        await pass(r, at, 50);
        r.view.setAwake?.(false);
        const hidden = r.snap();
        if (hidden.timers.length !== 0) problems.push(`${name} at ${at}: timers left running while hidden: ${hidden.timers.join(', ')}`);
        if (hidden.scene !== null || hidden.lively || hidden.props !== 0 || hidden.emotes !== 0) problems.push(`${name} at ${at}: not still while hidden`);
        await pass(r, 2000);
        if (r.snap().timers.length !== 0) problems.push(`${name} at ${at}: a timer started while hidden`);
        r.view.setAwake?.(true);
        // Back on screen it is simply where it belongs: no walk to watch.
        const back = r.snap();
        if (back.scene !== null && back.scene !== 'celebrate') problems.push(`${name} at ${at}: playing ${back.scene} on coming back`);
        const wrong = await settle(r);
        if (wrong) problems.push(`${name} at ${at}: ${wrong}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('by Doozer popping out for a window change, with and without the host ever bringing it back', async () => {
    const r = mount();
    const problems: string[] = [];
    for (const [name, start] of SCENES) {
      for (const at of [0, 400, 1500, 3600]) {
        for (const comesBack of [true, false]) {
          await prepare(r, name === 'eat-bowl');
          begin(r, name, start, problems, `${name} at ${at}`);
          await pass(r, at, 50);
          void r.view.leave?.();
          await pass(r, 300, 50);
          if (r.snap().scene !== null) problems.push(`${name} at ${at}: still playing while popped out`);
          if (comesBack) void r.view.enter?.();
          else await pass(r, 1600, 100);   // the host never calls enter(): Doozer is back by itself
          if (r.snap().gone) problems.push(`${name} at ${at}: still gone`);
          const wrong = await settle(r);
          if (wrong) problems.push(`${name} at ${at} (${comesBack ? 'enter' : 'no enter'}): ${wrong}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('a scene that never finishes is ended by its time limit, and Doozer is put where it belongs', async () => {
    const r = mount();
    // A performance whose promise never settles: the scene waiting on it can only time out.
    const { doozer } = r.parts();
    const perform = doozer.perform.bind(doozer);
    doozer.perform = (name, strength) => (name === 'wake' ? new Promise(() => undefined) : perform(name, strength));
    click(r.parts().furniture.bed);
    await settle(r);
    click(r.parts().furniture.bed);
    expect(r.snap().scene).toBe('get-up');
    await pass(r, SCENE_LIMIT_MS - 500);
    expect(r.snap().scene).toBe('get-up');
    await pass(r, 1000);
    expect(r.snap()).toMatchObject({ scene: null, station: 'free', place: 'floor', x: SPOT.start });
    expect(await settle(r)).toBe('');
  });

  it('a missed event is put right the next time anything happens, or within the minute', async () => {
    const r = mount();
    // The view never hears that Doozer fell asleep: hide it, change the brain, show it
    // again without the usual catch-up by starving the view of the event.
    r.view.setAwake?.(false);
    r.brain.sleep();
    r.view.setAwake?.(true);
    expect(r.snap()).toMatchObject({ station: 'bed', scene: null, lamp: false });
    r.view.setAwake?.(false);
    r.brain.wake();
    r.brain.startFocus();
    r.view.setAwake?.(true);
    expect(r.snap()).toMatchObject({ station: 'reading', pose: 'read', bookHeld: true, x: SPOT.rug });
    expect(unrest(r.snap())).toBe('');
  });
});

describe('never stuck: the view switched in the middle of a scene', () => {
  it('unmounting at any moment of any scene leaves no timer and no element behind', async () => {
    const problems: string[] = [];
    for (const [name, start] of SCENES) {
      for (const at of [0, 400, 1500, 3600]) {
        const r = mount();
        ready(r.brain);
        await pass(r, 200);
        begin(r, name, start, problems, `${name} at ${at}`);
        await pass(r, at, 50);
        click(r.parts().cardButton);
        r.view.unmount();
        if (vi.getTimerCount() !== 0) problems.push(`${name} at ${at}: ${vi.getTimerCount()} timers left`);
        if (r.root.childElementCount !== 0) problems.push(`${name} at ${at}: elements left`);
        if (r.shell.listeners('pointer-released') !== 0 || r.shell.listeners('drag-end') !== 0) problems.push(`${name} at ${at}: still listening to the shell`);
        if (r.view.snapshot() !== null || r.view.hitRegions().length !== 0) problems.push(`${name} at ${at}: still answers as if mounted`);
        // The brain goes on without the view, and nothing the view left behind reacts.
        r.brain.giveTreat();
        r.brain.wake();
        await pass(r, 3000);
        if (vi.getTimerCount() !== 0) problems.push(`${name} at ${at}: a timer started after unmount`);
        vi.clearAllTimers();
      }
    }
    expect(problems).toEqual([]);
  });

  it('mounting again starts clean, with Doozer where it belongs', async () => {
    const r = mount();
    r.brain.startFocus();
    await pass(r, 900);
    r.view.unmount();
    const root = document.createElement('div');
    document.body.append(root);
    void r.view.mount(root, { brain: r.brain, shell: r.shell.shell, host: r.host.services, info: windowInfo() });
    expect(r.snap()).toMatchObject({ station: 'reading', pose: 'read', x: SPOT.rug, scene: null, open: 'none' });
    expect(root.querySelectorAll('.roomv')).toHaveLength(1);
    expect(unrest(r.snap())).toBe('');
  });
});

describe('never stuck: a window drag whose mouse-up never arrives', () => {
  async function startDrag(r: Rig): Promise<void> {
    const { title, root } = r.parts();
    pointer(title, 'pointerdown', { buttons: 1, clientX: 120, clientY: 230 });
    pointer(root, 'pointermove', { buttons: 1, clientX: 150, clientY: 250 });
    await pass(r, 50, 50);
  }

  it('ends when the shell says the drag is over, with no pointerup at all', async () => {
    const r = mount({ drag: 'moves' });
    await startDrag(r);
    expect(r.snap().dragging).toBe(true);
    await pass(r, 3000);
    expect(r.snap().dragging).toBe(true);   // the button is still down, as far as anyone knows
    r.shell.emit('drag-end', windowInfo({ x: 40, y: 900 }));
    expect(r.snap()).toMatchObject({ dragging: false, pressed: false });
    expect(await settle(r)).toBe('');
  });

  it('ends when the shell says every button is up', async () => {
    const r = mount({ drag: 'moves' });
    await startDrag(r);
    r.shell.emit('pointer-released', null);
    expect(r.snap().dragging).toBe(false);
  });

  it('ends on the next pointer move that has no button held', async () => {
    const r = mount({ drag: 'moves' });
    await startDrag(r);
    pointer(r.parts().scene, 'pointermove', { buttons: 0 });
    expect(r.snap().dragging).toBe(false);
  });

  it('ends by itself if nobody ever says anything', async () => {
    const r = mount({ drag: 'silent' });
    await startDrag(r);
    expect(r.snap().dragging).toBe(true);
    await pass(r, 19_000);
    expect(r.snap().dragging).toBe(true);
    await pass(r, 1500);
    expect(r.snap().dragging).toBe(false);
    expect(r.parts().root.dataset.dragging).toBeUndefined();
  });

  it('never starts if the shell refuses or fails', async () => {
    for (const drag of ['refuses', 'throws'] as const) {
      const r = mount({ drag });
      await startDrag(r);
      expect(r.snap()).toMatchObject({ dragging: false, pressed: false });
      r.view.unmount();
    }
  });

  it('a press on the title bar that goes nowhere is forgotten', async () => {
    const r = mount({ drag: 'moves' });
    pointer(r.parts().title, 'pointerdown', { buttons: 1, clientX: 120, clientY: 230 });
    expect(r.snap().pressed).toBe(true);
    await pass(r, 7000);
    expect(r.snap().pressed).toBe(false);
    // And a later stray move does not start a drag from it.
    pointer(r.parts().root, 'pointermove', { buttons: 1, clientX: 300, clientY: 300 });
    expect(r.shell.drags).toHaveLength(0);
  });

  it('Doozer carries on with its day while the window is being moved', async () => {
    const r = mount({ drag: 'silent' });
    await startDrag(r);
    r.brain.giveTreat();
    expect(r.snap().scene).toBe('treat');
    expect(await settle(r, 40_000)).toBe('');
  });

  it('a highlighted piece of furniture lets go by itself', async () => {
    const r = mount();
    await pass(r, 300);
    pointer(r.parts().scene, 'pointermove');
    await pass(r, 250, 50);
    pointer(r.parts().furniture.jar, 'pointermove');
    expect(r.snap().hot).toBe('jar');
    await pass(r, 4500);
    expect(r.snap().hot).toBe('');
  });
});

describe('an hour in the Room with a full bowl', () => {
  /** An hour of the fake clock, sampled four times a second. */
  async function hour(r: Rig, minutes = 60) {
    const log = { scenes: new Map<string, number>(), livelyTicks: 0, ticks: 0, longest: 0, unsettled: 0, worstUnsettled: '', ate: 0, slept: 0, woke: 0 };
    r.brain.on('action', (event) => {
      if (event.type === 'auto-eat') log.ate++;
      if (event.type === 'sleep') log.slept++;
      if (event.type === 'wake') log.woke++;
    });
    let last: string | null = null;
    let running = 0;
    for (let i = 0; i < minutes * 60 * 4; i++) {
      await pass(r, 250);
      const s = r.snap();
      log.ticks++;
      if (s.lively) log.livelyTicks++;
      if (s.scene && s.scene !== last) log.scenes.set(s.scene, (log.scenes.get(s.scene) ?? 0) + 1);
      last = s.scene;
      // How long has it been since Doozer was last at rest?
      const wrong = unrest(s);
      running = wrong ? running + 250 : 0;
      if (running > log.longest) { log.longest = running; log.worstUnsettled = wrong; }
    }
    return log;
  }

  it('Doozer looks after itself: it wanders, looks out of the window, eats when hungry, and always comes back to rest', async () => {
    const r = mount({ seed: 21 });
    r.brain.debug?.setNeeds({ tummy: 74, fun: 80, energy: 90, clean: 80 });
    click(r.parts().furniture.bowl);
    expect(r.brain.state.bowl).toBe(3);

    const log = await hour(r);

    // It ate from the bowl by itself when it got hungry, and the room showed it.
    expect(log.ate).toBeGreaterThanOrEqual(1);
    expect(log.scenes.get('eat-bowl')).toBe(log.ate);
    expect(r.brain.state.bowl).toBe(3 - log.ate);
    expect(r.snap().bowl).toBe(r.brain.state.bowl);
    expect(r.brain.state.needs.tummy).toBeGreaterThan(70);
    // It kept itself busy: mostly glancing about, and now and then really going somewhere.
    const glances = log.scenes.get('glance') ?? 0;
    const outings = ['wander', 'look-out', 'nudge-ball', 'fidget'].reduce((sum, name) => sum + (log.scenes.get(name) ?? 0), 0);
    // (About thirty-six things in the hour; six in ten of them real outings.)
    expect(glances).toBeGreaterThanOrEqual(6);
    expect(glances).toBeLessThanOrEqual(26);
    expect(log.scenes.get('wander') ?? 0).toBeGreaterThanOrEqual(2);
    expect(log.scenes.get('look-out') ?? 0).toBeGreaterThanOrEqual(1);
    expect(outings).toBeGreaterThanOrEqual(12);
    expect(outings).toBeLessThanOrEqual(32);
    // Never "in the middle of something" for longer than one scene may last.
    expect(log.longest, log.worstUnsettled).toBeLessThanOrEqual(SCENE_LIMIT_MS);
    // And at the end of the hour it is at rest, still awake, with only its usual timers.
    expect(await settle(r)).toBe('');
    expect(r.snap()).toMatchObject({ station: 'free', lamp: true, open: 'none' });
    await pass(r, 5000);
    expect(r.snap().timers.sort()).toEqual(['blink', 'doozer:act', 'minute']);
    // Left alone, the room is still nearly all of the time. Animating costs about 7 % of a
    // processor core while it lasts (24 frames a second; docs/polish-checks.md section 2),
    // so 5 % of the hour is a third of a percent on the average.
    expect(log.livelyTicks / log.ticks).toBeLessThan(0.05);
  }, 60_000);

  it('a tired Doozer puts itself to bed during the hour, and stays there', async () => {
    const r = mount({ seed: 8 });
    r.brain.debug?.setNeeds({ tummy: 74, fun: 80, energy: 7, clean: 80 });   // worn out in about twenty minutes
    click(r.parts().furniture.bowl);

    const log = await hour(r);

    expect(log.slept).toBe(1);
    expect(log.scenes.get('to-bed')).toBe(1);
    expect(log.woke).toBe(0);
    expect(log.longest, log.worstUnsettled).toBeLessThanOrEqual(SCENE_LIMIT_MS);
    expect(await settle(r)).toBe('');
    expect(r.snap()).toMatchObject({ station: 'bed', pose: 'sleep', lamp: false, place: 'bed', x: SPOT.bed.x });
    // Asleep, nothing is waiting but the blink timer and the minute.
    await pass(r, 5000);
    expect(r.snap().timers.sort()).toEqual(['blink', 'minute']);
  }, 60_000);

  it('three hours on: it sleeps, wakes rested, eats, and is still not stuck', async () => {
    const r = mount({ seed: 2 });
    r.brain.debug?.setNeeds({ tummy: 74, fun: 80, energy: 6, clean: 80 });
    click(r.parts().furniture.bowl);

    const log = await hour(r, 180);

    expect(log.slept).toBeGreaterThanOrEqual(1);
    expect(log.woke).toBeGreaterThanOrEqual(1);
    expect(log.scenes.get('get-up')).toBe(log.woke);
    expect(log.ate).toBeGreaterThanOrEqual(1);
    expect(log.longest, log.worstUnsettled).toBeLessThanOrEqual(SCENE_LIMIT_MS);
    expect(await settle(r)).toBe('');
  }, 120_000);
});

// ---- Pill to Room and back, through the real host --------------------------------------

function hostShell() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const state = { modes: [] as { mode: WindowMode; view: ViewId | null }[], regions: [] as readonly Region[], saves: [] as string[] };
  const info = (mode: WindowMode, view: ViewId | null): WindowInfo => {
    const [w, h] = mode.kind === 'overlay' ? [2560, 1392] : [mode.width, mode.height];
    return {
      kind: mode.kind, view, x: 900, y: 200, width: w * 1.5, height: h * 1.5, scale: 1.5, cssWidth: w, cssHeight: h,
      monitor: { full: { x: 0, y: 0, w: 3840, h: 2160 }, work: { x: 0, y: 0, w: 3840, h: 2088 }, scale: 1.5 }, nativeMs: 1,
    };
  };
  const shell: Shell = {
    native: true,
    async setWindowMode(mode, view) { state.modes.push({ mode, view: view ?? null }); return info(mode, view ?? null); },
    windowInfo: async () => null,
    setHitRegions(regions) { state.regions = regions; },
    regionsFlushed: async () => undefined,
    beginDrag: async () => true,
    setFocusable: async () => undefined,
    setVisible: async () => undefined,
    setAlwaysOnTop: async () => undefined,
    fullscreenInFront: async () => false,
    load: async () => ({ data: null, source: 'none', problem: null }),
    async save(json) { state.saves.push(json); },
    showMenu: async () => undefined,
    setAvailableViews: async () => undefined,
    autostartEnabled: async () => false,
    setAutostart: async () => false,
    quit: async () => undefined,
    on(event, handler) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler as (payload: unknown) => void);
      handlers.set(event, set);
      return () => void set.delete(handler as (payload: unknown) => void);
    },
  };
  const emit = (event: string, payload: unknown): void => { handlers.get(event)?.forEach((handler) => handler(payload)); };
  return { shell, state, emit };
}

function app() {
  const brain = createBrain({ now: () => Date.now(), random: seeded(11), debug: true });
  brain.debug?.setNeeds({ tummy: 80, fun: 80, energy: 80, clean: 80 });
  brain.setSetting('soundAsked', true);
  const root = document.createElement('div');
  document.body.append(root);
  const { shell, state, emit } = hostShell();
  const pill = createPillView({ now: () => Date.now(), random: seeded(5) });
  const room = createRoomView({ now: () => Date.now(), random: seeded(5) });
  const hostData = freshHostData();
  hostData.welcomedPet = brain.state.bornAt;
  const host = createHost({ root, shell, brain, views: [pill, room], hostData, frame: () => Promise.resolve() });
  /** Let the host's switch run to its end: its waits are timers and promises. */
  const go = async (view: ViewId): Promise<boolean> => {
    const done = host.switchTo(view);
    await vi.advanceTimersByTimeAsync(1500);
    return done;
  };
  return { brain, host, pill, room, root, shell: state, emit, hostData, go };
}

describe('switching Pill to Room and back in the middle of a focus session', () => {
  it('loses nothing: the session, the needs, the bowl, the jar and the streak carry over', async () => {
    const a = app();
    void a.host.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(a.host.current()).toBe('pill');
    // The Card no longer says "coming soon" for the Room.
    const roomButton = a.pill.parts()!.card.el.querySelector<HTMLButtonElement>('[data-view="room"]')!;
    expect(roomButton.disabled).toBe(false);

    a.brain.fillBowl();
    a.brain.debug?.addTreats(3);
    a.brain.setFocusLength(25);
    a.brain.startFocus();
    await vi.advanceTimersByTimeAsync(4 * MIN);
    const before = a.brain.state;
    expect(before.focus).toMatchObject({ status: 'running', remainingMs: 21 * MIN });
    // Nobody is looking at the pill: it counts in whole minutes.
    expect(a.pill.snapshot()?.status).toBe('21 min');

    // Into the Room, mid-session.
    expect(await a.go('room')).toBe(true);
    expect(a.host.current()).toBe('room');
    expect(a.pill.snapshot()).toBeNull();
    expect(a.shell.modes.at(-1)).toMatchObject({ view: 'room', mode: { kind: 'floating' } });
    expect(a.brain.settings.lastView).toBe('room');
    const inRoom = a.brain.state;
    expect(inRoom.focus.status).toBe('running');
    expect(inRoom.focus.remainingMs).toBeLessThanOrEqual(21 * MIN);
    expect(inRoom.focus.remainingMs).toBeGreaterThan(21 * MIN - 3000);
    expect({ bowl: inRoom.bowl, treats: inRoom.treats, needs: inRoom.needs, streak: inRoom.streak, sessions: inRoom.sessionsCompleted })
      .toEqual({ bowl: before.bowl, treats: before.treats, needs: before.needs, streak: before.streak, sessions: before.sessionsCompleted });
    // The Room shows the same session its own way: Doozer on the rug with its book, the clock running.
    const room = a.room.snapshot()!;
    expect(room).toMatchObject({ station: 'reading', pose: 'read', bookHeld: true, bowl: 3 });
    expect(room.time).toMatch(/^20:5\d$/);
    expect(a.room.parts()!.doozer.el.dataset.glasses).toBe('1');
    expect(a.room.parts()!.scene.querySelector('.roomv-f-clock')?.getAttribute('data-status')).toBe('running');
    expect(a.shell.regions).toHaveLength(1);

    // Pause it from the Room's Card, wait, resume: paused time does not count.
    a.room.setOpen('card');
    const focusButton = a.room.parts()!.card.el.querySelector<HTMLButtonElement>('[data-act="focus"]')!;
    click(focusButton);
    expect(a.brain.state.focus.status).toBe('paused');
    const pausedAt = a.brain.state.focus.remainingMs;
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(a.brain.state.focus.remainingMs).toBe(pausedAt);
    click(focusButton);
    expect(a.brain.state.focus.status).toBe('running');
    await vi.advanceTimersByTimeAsync(5 * MIN);

    // And back to the Pill, still mid-session.
    expect(await a.go('pill')).toBe(true);
    expect(a.host.current()).toBe('pill');
    expect(a.room.snapshot()).toBeNull();
    const back = a.brain.state;
    expect(back.focus.status).toBe('running');
    expect(back.focus.remainingMs).toBeLessThanOrEqual(pausedAt - 5 * MIN);
    expect(back.focus.remainingMs).toBeGreaterThan(pausedAt - 5 * MIN - 4000);
    expect(a.pill.snapshot()?.status).toMatch(/^15:[45]\d$/);
    expect(a.pill.snapshot()?.ring).toMatch(/^focus:/);

    // It runs out in the Pill and pays in full: 2 for 25 minutes, 1 for the first of the day.
    await vi.advanceTimersByTimeAsync(16 * MIN);
    expect(a.brain.state.focus.status).toBe('idle');
    expect(a.brain.state.sessionsCompleted).toBe(1);
    expect(a.brain.state.treats).toBe(before.treats + 3);
    expect(a.brain.state.streak).toEqual({ current: 1, best: 1 });
    a.host.stop();
  });

  it('the save holds the session whichever view wrote it, and the app reopens in the Room', async () => {
    const a = app();
    void a.host.start();
    await vi.advanceTimersByTimeAsync(500);
    a.brain.startFocus();
    await a.go('room');
    await vi.advanceTimersByTimeAsync(3000);
    await a.host.flush();
    const saved = JSON.parse(a.shell.saves.at(-1)!) as { brain: { settings: { lastView: string }; focus: { status: string } } };
    expect(saved.brain.settings.lastView).toBe('room');
    expect(saved.brain.focus.status).toBe('running');
    a.host.stop();
  });

  it('switching in the middle of a scene, ten times over, leaves one view, its regions, and a Doozer at rest', async () => {
    const a = app();
    void a.host.start();
    await vi.advanceTimersByTimeAsync(500);
    for (let i = 0; i < 10; i++) {
      await a.go('room');
      a.brain.debug?.addTreats(2);
      a.brain.giveTreat();
      expect(a.room.snapshot()?.scene).toBe('treat');
      await vi.advanceTimersByTimeAsync(300 + i * 250);
      await a.go('pill');
      expect(a.room.snapshot()).toBeNull();
      expect(a.root.querySelectorAll('.roomv')).toHaveLength(0);
      expect(a.root.querySelectorAll('.pillv')).toHaveLength(1);
      expect(a.shell.regions).toHaveLength(2);
    }
    await a.go('room');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(unrest(a.room.snapshot()!)).toBe('');
    expect(a.root.querySelectorAll('.roomv')).toHaveLength(1);
    a.host.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the Room\'s window position is remembered from a drag and handed back on the next visit', async () => {
    const a = app();
    void a.host.start();
    await vi.advanceTimersByTimeAsync(500);
    await a.go('room');
    expect(a.shell.modes.at(-1)!.mode).not.toHaveProperty('x');
    a.emit('drag-end', windowInfo({ x: 2222, y: 777 }));
    expect(a.hostData.positions.room).toEqual({ x: 2222, y: 777 });
    await a.go('pill');
    await a.go('room');
    expect(a.shell.modes.at(-1)!.mode).toMatchObject({ kind: 'floating', x: 2222, y: 777 });
    // A new size keeps the same corner.
    a.brain.setSetting('size', { ...a.brain.settings.size, room: 'large' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(a.shell.modes.at(-1)!.mode).toMatchObject({ kind: 'floating', x: 2222, y: 777, width: 484 });
    expect(a.room.snapshot()?.gone).toBe(false);
    a.host.stop();
  });

  it('tucked away behind a fullscreen app in the Room, nothing runs; the session still ends on time and is celebrated on return', async () => {
    const a = app();
    void a.host.start();
    await vi.advanceTimersByTimeAsync(500);
    await a.go('room');
    a.brain.setFocusLength(15);
    a.brain.startFocus();
    await vi.advanceTimersByTimeAsync(10_000);
    a.host.setFullscreen(true);
    expect(a.room.snapshot()).toMatchObject({ awake: false, timers: [], scene: null, lively: false });
    await vi.advanceTimersByTimeAsync(16 * MIN);
    expect(a.brain.state.focus.status).toBe('idle');
    expect(a.brain.state.sessionsCompleted).toBe(1);
    expect(a.room.snapshot()).toMatchObject({ awake: false, timers: [], scene: null });
    a.host.setFullscreen(false);
    expect(a.room.snapshot()).toMatchObject({ awake: true, scene: 'celebrate' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(unrest(a.room.snapshot()!)).toBe('');
    a.host.stop();
  });

  it('an hour passes in the Room behind the host\'s own clock without anything piling up', async () => {
    const a = app();
    void a.host.start();
    await vi.advanceTimersByTimeAsync(500);
    await a.go('room');
    a.brain.fillBowl();
    const timersAtRest = vi.getTimerCount();
    await vi.advanceTimersByTimeAsync(HOUR);
    await vi.advanceTimersByTimeAsync(SCENE_LIMIT_MS);
    // Whatever it is doing right now, an hour has not left more timers running than a single scene needs.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timersAtRest + 12);
    expect(a.root.querySelectorAll('.roomv-snack, .roomv-crumb, .roomv-duck')).toHaveLength(0);
    a.host.stop();
    expect(vi.getTimerCount()).toBe(0);
  }, 60_000);
});
