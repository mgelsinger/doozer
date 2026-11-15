// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BAND, SPOT, WALK, roomGeometry } from '../../../src/views/room/layout';
import { MIN, START } from '../../core/helpers';
import { click, finishSessions, mount, pass, pointer, restoreClock, settle, unrest, useRoomClock, windowInfo } from './helpers';

beforeEach(() => useRoomClock());
afterEach(restoreClock);

/** Play the scene through, noting everything that was on screen on the way. */
async function watch(r: ReturnType<typeof mount>, limitMs = 30_000) {
  const seen = { scenes: new Set<string>(), poses: new Set<string>(), maxEmotes: 0, maxProps: 0, minX: Infinity, maxX: -Infinity, bowls: new Set<number>() };
  for (let waited = 0; waited < limitMs; waited += 100) {
    const s = r.snap();
    if (s.scene) seen.scenes.add(s.scene);
    seen.poses.add(s.pose);
    seen.maxEmotes = Math.max(seen.maxEmotes, s.emotes);
    seen.maxProps = Math.max(seen.maxProps, s.props);
    seen.minX = Math.min(seen.minX, s.x);
    seen.maxX = Math.max(seen.maxX, s.x);
    seen.bowls.add(s.bowl);
    if (waited > 0 && unrest(s) === '' && !s.busy && s.emotes === 0) break;
    await pass(r, 100, 100);
  }
  return seen;
}

describe('the room', () => {
  it('is a framed scene with a title bar, a strip of meters, and Doozer in its soft style', async () => {
    const r = mount();
    const { root, frame, title, scene, strip, doozer } = r.parts();
    expect(root.classList.contains('dzk')).toBe(true);
    expect(title.querySelector('.roomv-title-name')?.textContent).toBe('Doozer’s room');
    expect(frame.contains(scene) && frame.contains(strip)).toBe(true);
    expect(strip.querySelectorAll('[role="meter"]')).toHaveLength(4);
    expect(strip.querySelector('.dzk-needs')?.getAttribute('data-layout')).toBe('strip');
    expect(doozer.style).toBe('soft');
    expect(scene.contains(doozer.el)).toBe(true);
    // The picture: the window with its sky, both shelves, and everything in the furniture table.
    for (const part of ['.roomv-window', '.roomv-sun', '.roomv-moon', '.roomv-stars', '.roomv-f-bed', '.roomv-f-bowl', '.roomv-f-soap', '.roomv-f-lamp', '.roomv-f-jar', '.roomv-f-clock', '.roomv-books', '.roomv-ball']) {
      expect(scene.querySelector(part), part).not.toBeNull();
    }
    expect(unrest(r.snap())).toBe('');
    expect(r.snap()).toMatchObject({ station: 'free', x: SPOT.start, place: 'floor', lamp: true, open: 'none' });
  });

  it('has a button for every piece of furniture you can click, and none for the window', async () => {
    const r = mount();
    const { furniture, scene } = r.parts();
    expect(Object.keys(furniture).sort()).toEqual(['ball', 'bed', 'bowl', 'clock', 'jar', 'lamp', 'soap']);
    for (const button of Object.values(furniture)) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.dataset.tip).toBe(button.getAttribute('aria-label'));
    }
    expect(scene.querySelector('[data-furniture="window"]')).toBeNull();
    expect(furniture.bowl.dataset.tip).toBe('Fill the bowl (0 of 3)');
    expect(furniture.clock.dataset.tip).toBe('Start a 25-minute focus session');
  });

  it('follows the meters of the real brain', async () => {
    const r = mount();
    const tummy = r.parts().strip.querySelector('[data-need="tummy"]');
    expect(tummy?.getAttribute('aria-valuenow')).toBe('80');
    r.brain.debug?.setNeeds({ tummy: 20 });
    expect(tummy?.getAttribute('aria-valuenow')).toBe('20');
    expect(tummy?.getAttribute('data-level')).toBe('low');
    expect(r.parts().doozer.mood).toBe('hungry');
  });

  it('wears the palette, the glasses and the grime the brain says', async () => {
    const r = mount();
    r.brain.setSetting('palette', 'sky');
    expect(r.parts().doozer.palette).toBe('sky');
    r.brain.debug?.setNeeds({ clean: 10 });
    expect(r.parts().doozer.el.dataset.dirt).toBe('1');
  });
});

describe('the sky and the light', () => {
  it('shows the real time of day outside the window', async () => {
    const r = mount();
    // Nine in the morning.
    expect(r.snap()).toMatchObject({ sky: 'day', time: '9:00 AM' });
    const { scene } = r.parts();
    expect(scene.querySelector('.roomv-sun')?.getAttribute('opacity')).toBe('1');
    expect(scene.querySelector('.roomv-stars')?.getAttribute('opacity')).toBe('0');
    expect(scene.querySelector<HTMLElement>('.roomv-dark')?.style.opacity).toBe('0');
  });

  it('moves on by itself: by evening it is dusk, by night the moon and stars are out', async () => {
    const r = mount();
    const { scene } = r.parts();
    const topAtNine = scene.querySelector('.roomv-sky-top')?.getAttribute('stop-color');
    vi.setSystemTime(START + 9 * 60 * MIN - 30_000);   // just before six in the evening
    await pass(r, 61_000, 1000);
    expect(r.snap()).toMatchObject({ sky: 'dusk', time: '6:00 PM' });
    expect(scene.querySelector('.roomv-sky-top')?.getAttribute('stop-color')).not.toBe(topAtNine);
    vi.setSystemTime(START + 14 * 60 * MIN - 30_000);  // just before eleven at night
    await pass(r, 61_000, 1000);
    expect(r.snap()).toMatchObject({ sky: 'night', time: '11:00 PM' });
    expect(scene.querySelector('.roomv-stars')?.getAttribute('opacity')).toBe('1');
    expect(scene.querySelector('.roomv-sun')?.getAttribute('opacity')).toBe('0');
    expect(Number(scene.querySelector('.roomv-moon')?.getAttribute('opacity'))).toBe(1);
    // The room is darker, and the lamp glows.
    expect(Number(scene.querySelector<HTMLElement>('.roomv-dark')?.style.opacity)).toBeGreaterThan(0.2);
    expect(Number(scene.querySelector<HTMLElement>('.roomv-glow')?.style.opacity)).toBeGreaterThan(0.5);
  });

  it('follows the lamp: lights off is dim even at noon, with no glow', async () => {
    const r = mount();
    r.view.setSkyHour(12);
    const { scene, furniture } = r.parts();
    const dark = () => Number(scene.querySelector<HTMLElement>('.roomv-dark')?.style.opacity);
    const glow = () => Number(scene.querySelector<HTMLElement>('.roomv-glow')?.style.opacity);
    expect([dark(), glow()]).toEqual([0, 0.18]);
    click(furniture.lamp);
    expect(r.snap().lamp).toBe(false);
    expect([dark(), glow()]).toEqual([0.3, 0]);
    expect(scene.querySelector('.roomv-f-lamp')?.getAttribute('data-on')).toBe('0');
  });

  it('can be shown any hour for a picture, and goes back to the real one', async () => {
    const r = mount();
    r.view.setSkyHour(23);
    expect(r.snap().sky).toBe('night');
    r.view.setSkyHour(null);
    expect(r.snap().sky).toBe('day');
  });
});

describe('the furniture table, against the real brain', () => {
  it('bowl: a click fills it, and Doozer walks over and eats when it is hungry', async () => {
    const r = mount();
    const { furniture } = r.parts();
    click(furniture.bowl);
    expect(r.brain.state.bowl).toBe(3);
    expect(r.snap().bowl).toBe(3);
    expect(furniture.bowl.dataset.tip).toBe('The bowl is full');
    // Not hungry: it leaves the food where it is.
    await pass(r, 3000);
    expect(r.snap()).toMatchObject({ bowl: 3, scene: null });

    // Hungry: the brain has it eat a serving, and the room shows it going to get it.
    r.brain.debug?.setNeeds({ tummy: 60 });
    expect(r.brain.state).toMatchObject({ bowl: 2, needs: { tummy: 92 } });
    expect(r.snap()).toMatchObject({ scene: 'eat-bowl', bowl: 3, pose: 'walk' });   // still in the bowl until it gets there
    const seen = await watch(r);
    expect(seen.scenes.has('eat-bowl')).toBe(true);
    expect(seen.maxProps).toBeGreaterThan(0);   // crumbs
    expect(r.snap()).toMatchObject({ bowl: 2, x: SPOT.bowl, station: 'free' });
    expect(await settle(r)).toBe('');
  });

  it('bowl: a full one says so with a wiggle and a "?", never a message', async () => {
    const r = mount();
    const { furniture, scene } = r.parts();
    click(furniture.bowl);
    click(furniture.bowl);
    expect(scene.dataset.nudge).toBe('bowl');
    expect(r.parts().doozer.showing).toBe('no');
    expect(r.snap().emotes).toBe(1);
    await pass(r, 500);
    expect(scene.dataset.nudge).toBeUndefined();
    expect(await settle(r)).toBe('');
  });

  it('ball: a click tosses it, and Doozer chases it if it has the energy', async () => {
    const r = mount();
    const { furniture } = r.parts();
    const before = { fun: r.brain.state.needs.fun, ball: r.snap().ballX };
    r.brain.debug?.setNeeds({ fun: 40 });
    click(furniture.ball);
    expect(r.brain.state.needs.fun).toBe(68);
    expect(r.snap()).toMatchObject({ scene: 'play', pose: 'trot' });
    expect(r.snap().ballX).not.toBe(before.ball);
    const seen = await watch(r);
    expect(seen.maxX - seen.minX).toBeGreaterThan(60);   // it really ran about
    expect(await settle(r)).toBe('');
    // It ends up beside the ball.
    expect(Math.abs(r.snap().x - r.snap().ballX)).toBeLessThan(80);
  });

  it('ball: too tired or asleep, the ball only hops and Doozer says no', async () => {
    const r = mount();
    const { furniture, scene } = r.parts();
    r.brain.debug?.setNeeds({ energy: 8 });
    const ball = r.snap().ballX;
    const fun = r.brain.state.needs.fun;
    click(furniture.ball);
    expect(r.brain.state.needs.fun).toBe(fun);
    expect(r.snap().scene).toBeNull();
    expect(Math.abs(r.snap().ballX - ball)).toBe(26);
    expect(scene.dataset.nudge).toBe('ball');
    expect(r.parts().doozer.showing).toBe('no');
    expect(await settle(r)).toBe('');
  });

  it('ball: an unlocked toy takes its turn', async () => {
    const r = mount({ setup: (brain) => finishSessions(brain, 6) });
    const { furniture } = r.parts();
    expect(r.brain.state.unlocked).toContain('yarn');
    const toys = new Set<string>();
    for (let i = 0; i < 12 && toys.size < 2; i++) {
      r.brain.debug?.setNeeds({ fun: 30, energy: 80, tummy: 80 });
      click(furniture.ball);
      toys.add(r.snap().toy);
      await settle(r);
    }
    expect([...toys].sort()).toEqual(['ball', 'yarn']);
    expect(['Toss the ball', 'Toss the yarn ball']).toContain(furniture.ball.dataset.tip);
  });

  it('soap: a click starts a bath, and Doozer is scrubbed where it stands', async () => {
    const r = mount();
    r.brain.debug?.setNeeds({ clean: 20 });
    const x = r.snap().x;
    click(r.parts().furniture.soap);
    expect(r.brain.state.needs.clean).toBe(100);
    expect(r.snap().scene).toBe('wash');
    const seen = await watch(r);
    expect(seen.maxEmotes).toBeGreaterThanOrEqual(5);   // bubbles
    expect([seen.minX, seen.maxX]).toEqual([x, x]);
    expect(await settle(r)).toBe('');
  });

  it('soap: with the rubber duck unlocked, it turns up for the bath', async () => {
    const r = mount({ setup: (brain) => finishSessions(brain, 25) });
    click(r.parts().furniture.soap);
    expect(r.parts().scene.querySelector('.roomv-duck')).not.toBeNull();
    await settle(r);
    expect(r.parts().scene.querySelector('.roomv-duck')).toBeNull();
  });

  it('lamp: lights off sends Doozer to bed, lights on wakes it', async () => {
    const r = mount();
    const { furniture } = r.parts();
    click(furniture.lamp);
    expect(r.brain.state.asleep).toBe(true);
    expect(r.snap()).toMatchObject({ lamp: false, scene: 'to-bed', pose: 'walk' });
    expect(r.parts().doozer.showing).toBe('sleepy');   // not sleepwalking with its eyes shut
    expect(furniture.lamp.dataset.tip).toBe('Lights on: wake up');
    expect(await settle(r)).toBe('');
    expect(r.snap()).toMatchObject({ station: 'bed', place: 'bed', pose: 'sleep', x: SPOT.bed.x, lamp: false });
    expect(r.parts().scene.dataset.place).toBe('bed');

    click(furniture.lamp);
    expect(r.brain.state.asleep).toBe(false);
    expect(r.snap()).toMatchObject({ lamp: true, scene: 'get-up' });
    expect(await settle(r)).toBe('');
    expect(r.snap()).toMatchObject({ station: 'free', place: 'floor', lamp: true });
    expect(r.snap().x).toBeGreaterThanOrEqual(WALK.min);
  });

  it('lamp: lights off in the middle of a game ends the game at once; lights on mid-way to bed and it is simply up', async () => {
    const r = mount();
    const { furniture } = r.parts();
    click(furniture.ball);
    await pass(r, 600, 50);
    expect(r.snap().scene).toBe('play');
    click(furniture.lamp);
    // Not "after this kick": now.
    expect(r.snap()).toMatchObject({ scene: 'to-bed', pose: 'walk', lamp: false });
    await pass(r, 500, 50);
    const onTheWay = r.snap().x;
    click(furniture.lamp);
    expect(r.brain.state.asleep).toBe(false);
    expect(r.snap()).toMatchObject({ scene: null, station: 'free', lamp: true, place: 'floor', x: onTheWay });
    expect(await settle(r)).toBe('');
  });

  it('lamp: not sleepy, it stays up and the lamp stays on', async () => {
    const r = mount();
    r.brain.debug?.setNeeds({ energy: 96 });
    click(r.parts().furniture.lamp);
    expect(r.brain.state.asleep).toBe(false);
    expect(r.snap()).toMatchObject({ lamp: true, scene: null, station: 'free' });
    expect(r.parts().scene.dataset.nudge).toBe('lamp');
    expect(await settle(r)).toBe('');
  });

  it('bed: a click tucks Doozer in, another wakes it', async () => {
    const r = mount();
    const { furniture } = r.parts();
    expect(furniture.bed.dataset.tip).toBe('Tuck Doozer in');
    click(furniture.bed);
    expect(r.brain.state.asleep).toBe(true);
    expect(await settle(r)).toBe('');
    expect(r.snap()).toMatchObject({ station: 'bed', pose: 'sleep', lamp: false });
    expect(furniture.bed.dataset.tip).toBe('Wake Doozer');
    click(furniture.bed);
    expect(r.brain.state.asleep).toBe(false);
    expect(await settle(r)).toBe('');
    expect(r.snap()).toMatchObject({ station: 'free', lamp: true });
  });

  it('bed: asleep, it can still be petted, and everything else is refused without waking it', async () => {
    const r = mount();
    const { furniture, petHit } = r.parts();
    click(furniture.bed);
    await settle(r);
    const fun = r.brain.state.needs.fun;
    click(petHit);
    expect(r.brain.state.needs.fun).toBe(fun + 3);
    for (const id of ['ball', 'soap', 'jar', 'clock'] as const) {
      click(furniture[id]);
      expect(r.brain.state.asleep).toBe(true);
      expect(r.snap()).toMatchObject({ station: 'bed', scene: null });
    }
    expect(r.brain.state.focus.status).toBe('idle');
    await pass(r, 4000);
    expect(unrest(r.snap())).toBe('');
  });

  it('window: nothing to click; Doozer wanders over and looks out by itself', async () => {
    const r = mount({ seed: 3 });
    const scenes = new Set<string>();
    let reachedWindow = false;
    // Somebody is watching, so it does not keep them waiting long.
    for (let i = 0; i < 1200 && !reachedWindow; i++) {
      pointer(r.parts().scene, 'pointermove');
      await pass(r, 250);
      const s = r.snap();
      if (s.scene) scenes.add(s.scene);
      if (s.scene === 'look-out' && s.x === SPOT.window) reachedWindow = true;
    }
    expect(reachedWindow).toBe(true);
    expect(await settle(r)).toBe('');
    // And it does not stay standing in front of the bed.
    expect(r.snap().x).toBeGreaterThanOrEqual(WALK.min);
  });

  it('treat jar: a click gives a treat, and Doozer comes running', async () => {
    const r = mount();
    const { furniture, scene } = r.parts();
    expect(furniture.jar.dataset.tip).toBe('Give a treat (2 treats in the jar)');
    click(furniture.jar);
    expect(r.brain.state.treats).toBe(1);
    expect(r.snap()).toMatchObject({ scene: 'treat', pose: 'trot' });
    const seen = await watch(r);
    expect(seen.maxProps).toBe(1);   // the snack, dropped from the jar
    expect(seen.maxEmotes).toBeGreaterThanOrEqual(3);
    expect(r.snap().x).toBe(SPOT.jar);
    expect(scene.querySelector('.roomv-snack')).toBeNull();
    expect(await settle(r)).toBe('');
  });

  it('treat jar: the jar empties as treats are given, and an empty one is refused', async () => {
    const r = mount();
    const { furniture, scene } = r.parts();
    const level = () => scene.querySelector('.roomv-f-jar')?.getAttribute('data-level');
    expect(level()).toBe('1');
    r.brain.debug?.addTreats(18);
    expect(level()).toBe('3');
    r.brain.debug?.addTreats(-20);
    expect(level()).toBe('0');
    expect(furniture.jar.dataset.tip).toContain('empty');
    click(furniture.jar);
    expect(r.snap().scene).toBeNull();
    expect(scene.dataset.nudge).toBe('jar');
    expect(r.parts().doozer.showing).toBe('no');
    expect(await settle(r)).toBe('');
  });

  it('clock: a click starts a session and Doozer fetches its book; another stops it', async () => {
    const r = mount();
    const { furniture, scene, doozer } = r.parts();
    click(furniture.clock);
    expect(r.brain.state.focus.status).toBe('running');
    expect(r.brain.state.quiet).toBe(true);
    expect(r.snap()).toMatchObject({ scene: 'fetch-book', time: '25:00' });
    expect(doozer.el.dataset.glasses).toBe('1');
    expect(furniture.clock.dataset.tip).toBe('Stop the session (25 min left)');
    const seen = await watch(r);
    expect(seen.minX).toBeLessThanOrEqual(SPOT.books);   // it went to the books first
    expect(r.snap()).toMatchObject({ station: 'reading', pose: 'read', bookHeld: true, x: SPOT.rug });
    expect(scene.querySelector('.roomv-books')?.getAttribute('data-book')).toBe('held');
    // The clock on the shelf runs.
    const clock = scene.querySelector('.roomv-f-clock');
    expect(clock?.getAttribute('data-status')).toBe('running');
    const wedge = scene.querySelector('.roomv-clock-wedge')?.getAttribute('d');
    expect(wedge).toMatch(/^M268 80/);
    await pass(r, 5 * MIN, 1000);
    // Nobody has been in the room for five minutes: the title bar counts in whole minutes.
    expect(r.brain.state.focus.remainingMs).toBeGreaterThan(19 * MIN + 50_000);
    expect(r.brain.state.focus.remainingMs).toBeLessThanOrEqual(20 * MIN);
    expect(r.snap().time).toBe('20 min');
    expect(scene.querySelector('.roomv-clock-wedge')?.getAttribute('d')).not.toBe(wedge);
    expect(unrest(r.snap())).toBe('');

    click(furniture.clock);
    expect(r.brain.state.focus.status).toBe('idle');
    expect(r.snap()).toMatchObject({ station: 'free', bookHeld: false });
    expect(r.snap().time).toMatch(/AM$/);
    expect(clock?.getAttribute('data-status')).toBe('idle');
    expect(doozer.el.dataset.glasses).toBe('0');
    expect(await settle(r)).toBe('');
  });

  it('clock: a session that runs its course ends in a celebration, with the treats in the jar', async () => {
    const r = mount();
    r.brain.setFocusLength(15);
    click(r.parts().furniture.clock);
    await settle(r);
    expect(r.snap().station).toBe('reading');
    const treats = r.brain.state.treats;
    await pass(r, 15 * MIN, 1000);
    expect(r.brain.state.focus.status).toBe('idle');
    expect(r.brain.state.treats).toBe(treats + 2);   // 1 for 15 minutes, 1 for the first of the day
    expect(r.brain.state.sessionsCompleted).toBe(1);
    expect(await settle(r)).toBe('');
    expect(r.snap()).toMatchObject({ station: 'free', bookHeld: false });
    expect(r.host.state.focusable).toBe(false);   // it never asked for the keyboard
  });

  it('a double-click counts once: the lamp, the bed and the clock do not undo themselves', async () => {
    const r = mount();
    const { furniture } = r.parts();
    click(furniture.clock);
    click(furniture.clock, 120);
    expect(r.brain.state.focus.status).toBe('running');
    click(furniture.clock);
    expect(r.brain.state.focus.status).toBe('idle');
    click(furniture.lamp);
    click(furniture.lamp, 200);
    expect(r.brain.state.asleep).toBe(true);
    click(furniture.jar, 2000);
    click(furniture.jar, 100);
    expect(r.brain.state.treats).toBe(2);   // asleep: refused, and not spent twice either
  });
});

describe('what Doozer does on its own', () => {
  it('wanders about, and always stops again', async () => {
    const r = mount();
    const places = new Set<number>();
    const scenes = new Set<string>();
    for (let i = 0; i < 40 * 60 * 4; i++) {
      await pass(r, 250);
      const s = r.snap();
      if (s.scene) scenes.add(s.scene); else places.add(s.x);
    }
    expect(scenes.has('wander')).toBe(true);
    expect(places.size).toBeGreaterThan(3);
    for (const x of places) {
      expect(x).toBeGreaterThanOrEqual(WALK.min);
      expect(x).toBeLessThanOrEqual(WALK.max);
    }
    expect(await settle(r)).toBe('');
  });

  it('left alone, between its outings it glances about, and a glance animates nothing', async () => {
    const r = mount({ seed: 6 });
    await pass(r, 5000);
    const seen = { glances: 0, outings: 0, livelyDuringGlance: 0, looked: false };
    let last: string | null = null;
    for (let i = 0; i < 45 * 60 * 4; i++) {
      await pass(r, 250);
      const s = r.snap();
      if (s.scene === 'glance') {
        if (s.lively || r.parts().doozer.el.dataset.live !== '0') seen.livelyDuringGlance++;
        if (r.parts().doozer.el.style.getPropertyValue('--dz-look-x') !== '0.00') seen.looked = true;
        // Its feet stay where they are.
        expect(s.pose).toBe('idle');
      }
      if (s.scene && s.scene !== last) { if (s.scene === 'glance') seen.glances++; else seen.outings++; }
      last = s.scene;
    }
    // Three quarters of an hour: about twenty-seven things, six in ten of them real outings.
    expect(seen.glances).toBeGreaterThanOrEqual(4);
    expect(seen.outings).toBeGreaterThanOrEqual(8);
    expect(seen.outings).toBeGreaterThan(seen.glances);
    expect(seen.livelyDuringGlance).toBe(0);
    expect(seen.looked).toBe(true);
    expect(await settle(r)).toBe('');
    // And its eyes are back where they were.
    expect(r.parts().doozer.el.style.getPropertyValue('--dz-look-x')).toBe('0.00');
  });

  it('is livelier with somebody watching than alone', async () => {
    /** Things it really went and did (not glances) in ten minutes. */
    const count = async (watched: boolean): Promise<number> => {
      const r = mount({ seed: 9 });
      let outings = 0;
      let last: string | null = null;
      for (let i = 0; i < 10 * 60 * 4; i++) {
        if (watched) pointer(r.parts().scene, 'pointermove');
        await pass(r, 250);
        const scene = r.snap().scene;
        if (scene && scene !== last && scene !== 'glance') outings++;
        last = scene;
      }
      r.view.unmount();
      return outings;
    };
    const alone = await count(false);
    const watched = await count(true);
    expect(alone).toBeLessThanOrEqual(4);
    expect(watched).toBeGreaterThan(40);
  });

  it('goes to bed when it is worn out, without being told, and the light goes out', async () => {
    const r = mount();
    r.brain.debug?.setNeeds({ energy: 5 });
    r.brain.debug?.setTimeScale(60);   // a pet minute every second
    let asleepAfter = -1;
    for (let i = 0; i < 240 && asleepAfter < 0; i++) {
      await pass(r, 250);
      if (r.brain.state.asleep) asleepAfter = i;
    }
    r.brain.debug?.setTimeScale(1);
    expect(asleepAfter).toBeGreaterThanOrEqual(0);
    expect(await settle(r)).toBe('');
    expect(r.snap()).toMatchObject({ station: 'bed', pose: 'sleep', lamp: false, place: 'bed' });
  });

  it('wakes by itself when it is rested, gets up and carries on', async () => {
    const r = mount();
    click(r.parts().furniture.bed);
    await settle(r);
    r.brain.debug?.setNeeds({ energy: 97 });
    r.brain.debug?.setTimeScale(60);
    for (let i = 0; i < 240 && r.brain.state.asleep; i++) await pass(r, 250);
    r.brain.debug?.setTimeScale(1);
    expect(r.brain.state.asleep).toBe(false);
    expect(await settle(r)).toBe('');
    expect(r.snap()).toMatchObject({ station: 'free', lamp: true, place: 'floor' });
  });

  it('reads through a session: no wandering, no emotes, only a page turned now and then', async () => {
    const r = mount();
    r.brain.startFocus();
    await settle(r);
    const scenes = new Set<string>();
    let livelyTicks = 0;
    let emotes = 0;
    for (let i = 0; i < 20 * 60; i++) {
      await pass(r, 1000, 1000);
      const s = r.snap();
      if (s.scene) scenes.add(s.scene);
      if (s.lively) livelyTicks++;
      emotes += s.emotes;
      expect(s.x).toBe(SPOT.rug);
    }
    expect([...scenes]).toEqual([]);
    expect(emotes).toBe(0);
    expect(livelyTicks).toBeGreaterThan(0);      // it turned a page
    expect(livelyTicks).toBeLessThan(20 * 60 * 0.06);
    expect(unrest(r.snap())).toBe('');
  });

  it('eats from the bowl during a session without leaving its book', async () => {
    const r = mount();
    click(r.parts().furniture.bowl);
    r.brain.startFocus();
    await settle(r);
    r.brain.debug?.setNeeds({ tummy: 50 });
    expect(r.brain.state.bowl).toBe(2);
    expect(r.snap()).toMatchObject({ station: 'reading', scene: null, bowl: 2, x: SPOT.rug });
    await pass(r, 3000);
    expect(unrest(r.snap())).toBe('');
  });

  it('a paused session keeps it on the rug; falling asleep mid-session sends it to bed', async () => {
    const r = mount();
    r.brain.startFocus();
    await settle(r);
    r.brain.pauseFocus();
    await pass(r, 2000);
    expect(r.snap()).toMatchObject({ station: 'reading', pose: 'read' });
    r.brain.resumeFocus();
    r.brain.debug?.setNeeds({ energy: 3 });
    expect(r.brain.state.asleep).toBe(true);
    expect(await settle(r)).toBe('');
    expect(r.snap()).toMatchObject({ station: 'bed', bookHeld: false, lamp: false });
  });

  it('says hello after time away, unless it is asleep or reading', async () => {
    const r = mount();
    await pass(r, 6000);
    vi.setSystemTime(Date.now() + 20 * MIN);
    r.brain.tick();
    expect(r.snap().scene).toBe('hello');
    expect(await settle(r)).toBe('');
  });
});

describe('petting', () => {
  it('a click on Doozer is a pet', async () => {
    const r = mount();
    r.brain.debug?.setNeeds({ fun: 50 });
    click(r.parts().petHit);
    expect(r.brain.state.needs.fun).toBe(53);
    expect(r.snap().emotes).toBe(1);
    expect(r.parts().doozer.showing).toBe('love');
    expect(await settle(r)).toBe('');
  });

  it('stroking across it is a pet too, but not a press-and-drag', async () => {
    const r = mount();
    r.brain.debug?.setNeeds({ fun: 50 });
    const { petHit } = r.parts();
    for (let i = 0; i < 6; i++) pointer(petHit, 'pointermove', { movementX: 30, buttons: 1 });
    expect(r.brain.state.needs.fun).toBe(50);
    for (let i = 0; i < 6; i++) pointer(petHit, 'pointermove', { movementX: 30 });
    expect(r.brain.state.needs.fun).toBe(53);
    // Not again straight away.
    for (let i = 0; i < 6; i++) pointer(petHit, 'pointermove', { movementX: 30 });
    expect(r.brain.state.needs.fun).toBe(53);
    await pass(r, 700);
    for (let i = 0; i < 6; i++) pointer(petHit, 'pointermove', { movementX: 30 });
    expect(r.brain.state.needs.fun).toBe(56);
  });
});

describe('the Card and the settings', () => {
  it('the button in the title bar opens the Card over the room, and closes it', async () => {
    const r = mount();
    const { cardButton, card, close } = r.parts();
    expect(r.view.hitRegions()).toHaveLength(1);
    click(cardButton);
    expect(r.snap().open).toBe('card');
    expect(card.isOpen).toBe(true);
    expect(cardButton.getAttribute('aria-expanded')).toBe('true');
    expect(close.hidden).toBe(false);
    // The frame, the Card, and the Card's own close button.
    expect(r.view.hitRegions()).toHaveLength(3);
    expect(r.host.calls.at(-1)).toBe('regions');
    click(cardButton);
    expect(r.snap().open).toBe('none');
    expect(card.isOpen).toBe(false);
    expect(r.view.hitRegions()).toHaveLength(1);
    click(cardButton);
    click(close);
    expect(r.snap().open).toBe('none');
  });

  it('the Card works against the same pet, and never takes the keyboard', async () => {
    const r = mount();
    click(r.parts().cardButton);
    const act = (name: string) => r.parts().card.el.querySelector<HTMLButtonElement>(`[data-act="${name}"]`)!;
    click(act('fill'));
    expect(r.brain.state.bowl).toBe(3);
    expect(r.snap().bowl).toBe(3);
    r.brain.debug?.setNeeds({ tummy: 50 });
    click(act('feed'));
    // Hand-fed: it eats where it stands, in the room as well as on the Card.
    expect(r.snap().scene).toBe('eat');
    expect(r.host.state.focusable).toBe(false);
    expect(r.host.calls).not.toContain('focusable:true');
    expect(await settle(r)).toBe('');
  });

  it('shows the Room as the current view and the unbuilt ones as coming soon', async () => {
    const r = mount();
    click(r.parts().cardButton);
    const view = (id: string) => r.parts().card.el.querySelector<HTMLButtonElement>(`[data-view="${id}"]`)!;
    expect(view('room').getAttribute('aria-pressed')).toBe('true');
    expect(view('pill').disabled).toBe(false);
    expect(view('island').disabled).toBe(true);
    click(view('pill'));
    expect(r.host.calls).toContain('switch:pill');
  });

  it('settings take the Card\'s place, may have the keyboard, and give it back', async () => {
    const r = mount();
    click(r.parts().cardButton);
    click(r.parts().card.el.querySelector('[data-act="settings"]')!);
    expect(r.snap().open).toBe('settings');
    expect(r.host.state.focusable).toBe(true);
    expect(r.view.hitRegions()).toHaveLength(3);
    click(r.parts().settings.el.querySelector('.dzk-icon-btn')!);
    expect(r.snap().open).toBe('card');
    expect(r.host.state.focusable).toBe(false);
    // From the tray, with nothing open: closing goes back to nothing.
    r.view.setOpen('none');
    r.view.openSettings?.();
    expect(r.snap().open).toBe('settings');
    click(r.parts().close);
    expect(r.snap().open).toBe('none');
    expect(r.host.state.focusable).toBe(false);
  });

  it('hangs under the title bar, and slides up when the room is at the bottom of the screen', async () => {
    const g = roomGeometry('medium');
    const r = mount();
    click(r.parts().cardButton);
    const [, card] = r.view.hitRegions();
    expect(card).toMatchObject({ x: g.card.x, y: g.card.y, w: 320 });

    // Dragged to the bottom edge: the lower band hangs off the screen.
    const low = windowInfo({ y: 2088 - Math.round((g.window.height - BAND) * 1.5) });
    r.shell.emit('drag-end', low);
    const [, lowered] = r.view.hitRegions();
    expect(lowered!.y).toBeLessThan(g.card.y);
    expect(lowered!.y + lowered!.h).toBeLessThanOrEqual(g.window.height - BAND);
  });

  it('opens the Card when a session ends, if that is the setting', async () => {
    const r = mount();
    r.brain.setSetting('onFocusEnd', 'open-card');
    r.brain.startFocus();
    await settle(r);
    r.brain.debug?.finishFocusNow();
    expect(r.snap().open).toBe('card');
    expect(r.host.state.focusable).toBe(false);
  });

  it('right-click anywhere in the room asks for the native menu', async () => {
    const r = mount();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    r.parts().title.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(r.host.calls).toContain('menu');
  });
});

describe('the window', () => {
  it('asks for a floating window with its remembered position, and follows the Size setting', async () => {
    const r = mount();
    expect(r.view.id).toBe('room');
    expect(r.view.windowSettings).toEqual(['size']);
    const medium = r.view.window({ settings: r.brain.settings, position: { x: 700, y: 420 } });
    expect(medium).toMatchObject({ kind: 'floating', x: 700, y: 420, width: 408, bleed: BAND });
    expect(r.view.window({ settings: r.brain.settings, position: null })).not.toHaveProperty('x');

    r.brain.setSetting('size', { ...r.brain.settings.size, room: 'large' });
    const large = r.view.window({ settings: r.brain.settings, position: null });
    expect(large).toMatchObject({ kind: 'floating', width: 456 + 28 });
    expect(r.parts().frame.style.getPropertyValue('--roomv-zoom')).toBe('1.2');
    expect(r.view.hitRegions()[0]).toMatchObject({ w: 456, h: 557 });
    expect(r.host.calls).toContain('regions');

    r.brain.setSetting('size', { ...r.brain.settings.size, room: 'small' });
    expect(r.view.hitRegions()[0]).toMatchObject({ w: 327, h: 399 });
    // Another view's size is not this view's business.
    r.brain.setSetting('size', { ...r.brain.settings.size, pill: 'large' });
    expect(r.view.hitRegions()[0]).toMatchObject({ w: 327, h: 399 });
  });

  it('is moved by its title bar: a press that travels becomes a drag, from where the press began', async () => {
    const r = mount({ drag: 'moves' });
    const { title, root } = r.parts();
    pointer(title, 'pointerdown', { buttons: 1, clientX: 120, clientY: 230 });
    expect(r.snap()).toMatchObject({ pressed: true, dragging: false });
    pointer(root, 'pointermove', { buttons: 1, clientX: 121, clientY: 231 });
    expect(r.shell.drags).toHaveLength(0);   // not yet: it has barely moved
    pointer(root, 'pointermove', { buttons: 1, clientX: 131, clientY: 236 });
    expect(r.shell.drags).toEqual([{ clientX: 120, clientY: 230 }]);
    expect(r.snap()).toMatchObject({ pressed: false, dragging: true });
    expect(root.dataset.dragging).toBe('1');
    // The shell says where it was put down.
    r.shell.emit('drag-end', windowInfo({ x: 1500, y: 640 }));
    expect(r.snap().dragging).toBe(false);
    expect(root.dataset.dragging).toBeUndefined();
    expect(r.host.calls.at(-1)).toBe('regions');
  });

  it('a click on the title bar that does not move is not a drag, and the Card button never is', async () => {
    const r = mount({ drag: 'moves' });
    const { title, root, cardButton } = r.parts();
    pointer(title, 'pointerdown', { buttons: 1, clientX: 120, clientY: 230 });
    pointer(root, 'pointerup', { clientX: 120, clientY: 230 });
    expect(r.snap()).toMatchObject({ pressed: false, dragging: false });
    pointer(cardButton, 'pointerdown', { buttons: 1, clientX: 370, clientY: 230 });
    pointer(root, 'pointermove', { buttons: 1, clientX: 300, clientY: 260 });
    expect(r.shell.drags).toHaveLength(0);
    // Nor a right-button press.
    pointer(title, 'pointerdown', { button: 2, buttons: 2, clientX: 120, clientY: 230 });
    expect(r.snap().pressed).toBe(false);
  });
});

describe('render on demand', () => {
  it('at rest the room is still: Doozer is paused, and only a blink, the minute and its next outing are waiting', async () => {
    const r = mount();
    expect(r.snap().lively).toBe(true);   // it has just come on screen
    await pass(r, 5000);
    expect(r.snap()).toMatchObject({ lively: false, scene: null });
    expect(r.parts().doozer.el.dataset.live).toBe('0');
    expect(r.parts().root.dataset.lively).toBe('0');
    expect(r.snap().timers.sort()).toEqual(['blink', 'doozer:act', 'minute']);
  });

  it('wakes up for a visit, and not for a pointer that is only crossing', async () => {
    const r = mount();
    await pass(r, 5000);
    const { scene, furniture } = r.parts();
    pointer(scene, 'pointermove');
    expect(r.snap().lively).toBe(false);
    pointer(furniture.bowl, 'pointerenter');
    expect(r.snap().hot).toBe('');
    await pass(r, 250, 50);
    pointer(scene, 'pointermove');
    expect(r.snap().lively).toBe(true);
    pointer(furniture.bowl, 'pointermove');
    expect(r.snap().hot).toBe('bowl');
    pointer(furniture.bowl, 'pointerleave');
    expect(r.snap().hot).toBe('');
    await pass(r, 4000);
    expect(r.snap().lively).toBe(false);
  });

  it('is lively for as long as Doozer is doing something, and no longer', async () => {
    const r = mount();
    await pass(r, 5000);
    r.brain.giveTreat();
    expect(r.snap()).toMatchObject({ lively: true, scene: 'treat' });
    expect(await settle(r)).toBe('');
    await pass(r, 4000);
    expect(r.snap().lively).toBe(false);
  });

  it('a sleeping Doozer breathes z\'s only while somebody is there', async () => {
    const r = mount();
    click(r.parts().furniture.bed);
    await settle(r);
    await pass(r, 6000);
    expect(r.snap()).toMatchObject({ lively: false, emotes: 0 });
    expect(r.snap().timers).not.toContain('snore');
    for (let i = 0; i < 16; i++) {
      pointer(r.parts().scene, 'pointermove');
      await pass(r, 250, 50);
    }
    expect(r.snap().timers).toContain('snore');
    expect(r.snap().emotes).toBeGreaterThan(0);
    await pass(r, 8000);
    expect(r.snap()).toMatchObject({ lively: false, emotes: 0 });
    expect(r.snap().timers.sort()).toEqual(['blink', 'minute']);
  });

  it('honours reduced motion: no walking, Doozer is simply there', async () => {
    const r = mount();
    r.brain.setSetting('reduceMotion', 'on');
    expect(r.parts().root.dataset.motion).toBe('reduce');
    click(r.parts().furniture.bed);
    expect(await settle(r)).toBe('');
    expect(r.snap()).toMatchObject({ station: 'bed', x: SPOT.bed.x });
    click(r.parts().furniture.bed);
    expect(await settle(r)).toBe('');
    r.brain.giveTreat();
    expect(r.snap().x).toBe(SPOT.jar);
    expect(await settle(r)).toBe('');
  });
});

describe('a new Doozer met in the Room', () => {
  it('says hello once and shows its favourite snack', async () => {
    const r = mount({ needsWelcome: true });
    expect(r.snap().scene).toBe('welcome');
    expect(await settle(r)).toBe('');
    expect(r.host.calls).toContain('welcomed');
    expect(r.host.state.welcome).toBe(false);
  });

  it('cut short, the hello is owed again', async () => {
    const r = mount({ needsWelcome: true });
    await pass(r, 800);
    r.view.setAwake?.(false);
    expect(r.host.calls).not.toContain('welcomed');
    r.view.setAwake?.(true);
    expect(r.snap().scene).toBe('welcome');
    expect(await settle(r)).toBe('');
    expect(r.host.calls.filter((call) => call === 'welcomed')).toHaveLength(1);
  });
});
