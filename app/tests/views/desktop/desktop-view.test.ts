// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CARRY_LIMIT_MS, CARRY_QUIET_MS } from '../../../src/views/desktop/body';
import { PACES } from '../../../src/views/desktop/pace';
import { SIZE_PX, hitRegion } from '../../../src/views/desktop/stage';
import { MIN } from '../../core/helpers';
import {
  AT_REST, INFO, cardButton, cleanUp, click, doozerAt, inRegion, infoFor, mountDesktop, pickUp, pointer, radialButton, restReport,
  settle, tap, tick, useFakeClock,
} from './harness';

beforeEach(useFakeClock);
afterEach(cleanUp);

describe('standing on the taskbar', () => {
  it('asks for the overlay and stands on the bottom edge of the work area', async () => {
    const r = mountDesktop();
    expect(r.view.id).toBe('desktop');
    expect(r.view.window({ settings: r.brain.settings, position: null })).toEqual({ kind: 'overlay' });
    const s = r.snap();
    expect(s.stage).toMatchObject({ w: 2560, h: 1392, size: 112, taskbar: 'bottom' });
    // The soles are a few pixels above the edge: the shadow under them ends just inside the window.
    expect(s.ground).toBe(1386);
    expect(s.y).toBe(s.ground);
    expect(s.x).toBeGreaterThan(s.stage.minX);
    expect(s.x).toBeLessThan(s.stage.maxX);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('catches the mouse on Doozer and nowhere else', async () => {
    const r = mountDesktop();
    const regions = r.view.hitRegions();
    expect(regions).toHaveLength(1);
    const s = r.snap();
    const region = regions[0]!;
    expect(region).toEqual(hitRegion(112, s.x, s.y));
    expect(region.w).toBeCloseTo(78.4);
    expect(region.h).toBeCloseTo(94.1, 1);
    // Inside the window, and not a pixel of it below the taskbar line.
    expect(region.y + region.h).toBeLessThanOrEqual(s.stage.h);
    expect(inRegion(region, s.x, s.y - 50)).toBe(true);
    expect(inRegion(region, s.x + 60, s.y - 50)).toBe(false);
    expect(inRegion(region, s.x, s.y - 120)).toBe(false);
    // The empty corner of the sprite's box is not Doozer.
    expect(inRegion(region, region.x + 2, region.y + 2)).toBe(false);
  });

  it('draws Doozer where the view says it is', async () => {
    const r = mountDesktop();
    const s = r.snap();
    const { pet } = r.parts();
    expect(pet.style.transform).toBe(`translate(${(s.x - 56).toFixed(2)}px, ${(s.y - 112 * 0.93).toFixed(2)}px)`);
  });

  it('wears the colour and the size from the settings', async () => {
    const r = mountDesktop();
    r.brain.setSetting('palette', 'mint');
    expect(r.parts().doozer.palette).toBe('mint');
    r.brain.setSetting('size', { ...r.brain.settings.size, desktop: 'large' });
    const s = r.snap();
    expect(s.stage.size).toBe(SIZE_PX.large);
    expect(s.y).toBe(s.ground);
    expect(r.parts().root.style.getPropertyValue('--deskv-size')).toBe('136px');
    expect(r.view.hitRegions()[0]).toEqual(hitRegion(136, s.x, s.y));
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('is still at rest: nothing animates, apart from a blink in two redraws', async () => {
    const r = mountDesktop();
    await tick(6000);
    expect(r.snap()).toMatchObject({ lively: false, atRest: true });
    const { doozer } = r.parts();
    let blinks = 0;
    for (let i = 0; i < 300; i++) {
      await tick(100);
      if (doozer.el.dataset.blink === '1') blinks++;
      expect(r.snap().lively).toBe(false);
    }
    expect(blinks).toBeGreaterThan(1);
    expect(doozer.el.dataset.blink).not.toBe(undefined);
  });
});

describe('the pace levels', () => {
  it('Still never moves from its spot', async () => {
    const r = mountDesktop({ pace: 'still' });
    const x = r.snap().x;
    for (let i = 0; i < 60; i++) {
      await tick(MIN);
      expect(r.snap().x).toBe(x);
    }
    expect(r.snap().scenes).toEqual({});
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('Calm takes a short slow stroll now and then, and stays near its spot', async () => {
    const r = mountDesktop({ pace: 'calm' });
    const home = r.snap().home;
    let farthest = 0;
    let fastest = 0;
    let walkedFor = 0;
    let last = r.snap().x;
    const step = 500;
    for (let t = 0; t < 30 * MIN; t += step) {
      await tick(step);
      const s = r.snap();
      // A peek goes all the way to the edge of the screen and back; a stroll never goes far.
      if (s.scene !== 'peek') farthest = Math.max(farthest, Math.abs(s.x - home));
      if (s.scene === 'stroll') {
        walkedFor += step;
        fastest = Math.max(fastest, (Math.abs(s.x - last) / step) * 1000);
        expect(['walk', 'idle']).toContain(s.pose);
      }
      expect(s.y).toBe(s.ground);
      last = s.x;
    }
    const strolls = r.snap().scenes.stroll;
    // Every 45-120 s it *may* stroll: between a handful and forty in half an hour.
    expect(strolls?.finished ?? 0).toBeGreaterThanOrEqual(6);
    expect(strolls?.finished ?? 0).toBeLessThanOrEqual(40);
    expect(farthest).toBeLessThanOrEqual(PACES.calm.roamPx! + 1);
    // About 30 px a second. (The position is read between steps, so allow a step's worth.)
    expect(fastest).toBeLessThanOrEqual(30 * 1.1);
    expect(fastest).toBeGreaterThan(25);
    // Mostly it stays where it is.
    expect(walkedFor).toBeLessThan(30 * MIN * 0.2);
    expect(r.snap().rescues).toEqual([]);
    expect(r.snap().overruns).toEqual([]);
  });

  it('Lively is off again a moment after arriving, anywhere along the line, at a trot', async () => {
    const r = mountDesktop({ pace: 'lively' });
    let leftmost = Infinity;
    let rightmost = -Infinity;
    let fastest = 0;
    let last = r.snap().x;
    const poses = new Set<string>();
    const step = 250;
    for (let t = 0; t < 10 * MIN; t += step) {
      await tick(step);
      const s = r.snap();
      leftmost = Math.min(leftmost, s.x);
      rightmost = Math.max(rightmost, s.x);
      if (s.scene === 'stroll') {
        poses.add(s.pose);
        fastest = Math.max(fastest, (Math.abs(s.x - last) / step) * 1000);
      }
      last = s.x;
    }
    const s = r.snap();
    expect(s.scenes.stroll?.finished ?? 0).toBeGreaterThan(20);
    expect(rightmost - leftmost).toBeGreaterThan(1200);
    expect(poses.has('trot')).toBe(true);
    expect(fastest).toBeLessThanOrEqual(PACES.lively.strollSpeed * 1.15);
    expect(fastest).toBeGreaterThan(40);
    expect((s.scenes.peek?.finished ?? 0) + (s.scenes.peek?.interrupted ?? 0)).toBeGreaterThan(1);
    expect(s.rescues).toEqual([]);
    expect(s.overruns).toEqual([]);
  });

  it('changing the setting changes the pace at once', async () => {
    const r = mountDesktop({ pace: 'lively' });
    await tick(30_000);
    expect(r.snap().scenes.stroll).toBeDefined();
    r.brain.setSetting('desktopActivity', 'still');
    expect(await settle(r)).toBe(true);
    const x = r.snap().x;
    await tick(10 * MIN);
    expect(r.snap().x).toBe(x);
    expect(r.snap().timers).not.toContain('decide');
    expect(r.snap().timers).not.toContain('peek');
    r.brain.setSetting('desktopActivity', 'calm');
    expect(r.snap().timers).toContain('decide');
    expect(r.snap().timers).toContain('peek');
  });

  it('the hit region follows Doozer as it walks', async () => {
    const r = mountDesktop({ pace: 'calm' });
    expect(r.view.act('stroll')).toBe(true);
    const before = r.host.state.regions;
    let moved = 0;
    for (let i = 0; i < 20; i++) {
      await tick(100);
      const s = r.snap();
      if (s.scene !== 'stroll') break;
      moved++;
      expect(r.view.hitRegions()[0]).toEqual(hitRegion(112, s.x, s.y));
    }
    expect(moved).toBeGreaterThan(5);
    // The host was told about every step of the walk.
    expect(r.host.state.regions - before).toBeGreaterThan(moved * 2);
  });

  it('with motion reduced Doozer does not wander', async () => {
    const r = mountDesktop({ pace: 'lively' });
    r.brain.setSetting('reduceMotion', 'on');
    expect(await settle(r)).toBe(true);
    const x = r.snap().x;
    await tick(5 * MIN);
    expect(r.snap().x).toBe(x);
    expect(r.view.act('stroll')).toBe(false);
    expect(r.view.act('peek')).toBe(false);
    expect(restReport(r)).toEqual(AT_REST);
  });
});

describe('carry and set-down', () => {
  it('a press and a drag picks Doozer up; letting go in mid-air floats it gently down', async () => {
    const r = mountDesktop();
    const start = r.snap();
    const to = { x: start.x - 400, y: 500 };
    pickUp(r, to);
    let s = r.snap();
    expect(s).toMatchObject({ state: 'carried', pose: 'carried', pressed: true });
    expect(r.parts().pet.dataset.held).toBe('1');
    expect(s.y).toBeLessThan(700);
    // The hit region is under the pointer all the way.
    expect(inRegion(r.view.hitRegions()[0]!, to.x, to.y)).toBe(true);

    pointer(r.parts().hit, 'pointerup', to);
    s = r.snap();
    expect(s).toMatchObject({ state: 'float', pressed: false });
    expect(r.parts().pet.dataset.held).toBeUndefined();

    // Down it comes: never faster than a drift, never below the line, and it lands.
    const heights: number[] = [s.y];
    for (let i = 0; i < 40 && r.snap().state === 'float'; i++) {
      await tick(100);
      heights.push(r.snap().y);
    }
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!).toBeGreaterThanOrEqual(heights[i - 1]!);
      expect(heights[i]! - heights[i - 1]!).toBeLessThan(90);
    }
    expect(heights.length).toBeGreaterThan(8);
    s = r.snap();
    expect(s.y).toBe(s.ground);
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
    // It then stays near that spot.
    expect(Math.abs(r.snap().home - (start.x - 400 + 6))).toBeLessThan(30);
    expect(r.snap().drops).toEqual({ up: 1 });
  });

  it('a press without a drag is a poke, not a carry', async () => {
    const r = mountDesktop();
    const x = r.snap().x;
    const at = doozerAt(r);
    const { hit } = r.parts();
    pointer(hit, 'pointerdown', at, { buttons: 1 });
    pointer(hit, 'pointermove', { x: at.x + 3, y: at.y + 2 }, { buttons: 1 });
    expect(r.snap().state).toBe('idle');
    pointer(hit, 'pointerup', { x: at.x + 3, y: at.y + 2 });
    click(hit);
    expect(r.snap()).toMatchObject({ x, open: 'radial', pressed: false });
    expect(r.snap().drops).toEqual({});
  });

  it('cannot be carried off the screen or below the taskbar line', async () => {
    const r = mountDesktop();
    pickUp(r, { x: -500, y: -500 });
    let s = r.snap();
    expect(s.x).toBeGreaterThan(30);
    expect(s.y).toBeGreaterThan(80);
    pointer(r.parts().hit, 'pointermove', { x: 9000, y: 9000 }, { buttons: 1 });
    s = r.snap();
    expect(s.x).toBeLessThan(s.stage.w - 30);
    expect(s.y).toBe(s.ground);
    pointer(r.parts().hit, 'pointerup', { x: 9000, y: 9000 });
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('put down on the line, it is simply down', async () => {
    const r = mountDesktop();
    const at = doozerAt(r);
    pickUp(r, { x: at.x + 300, y: at.y });
    expect(r.snap().state).toBe('carried');
    pointer(r.parts().hit, 'pointerup', { x: at.x + 300, y: at.y });
    expect(r.snap().state).toBe('idle');
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('can be caught again on the way down', async () => {
    const r = mountDesktop();
    const up = pickUp(r, { x: 800, y: 400 });
    pointer(r.parts().hit, 'pointerup', up);
    await tick(300);
    expect(r.snap().state).toBe('float');
    const again = pickUp(r, { x: 1500, y: 300 });
    expect(r.snap().state).toBe('carried');
    pointer(r.parts().hit, 'pointerup', again);
    expect(await settle(r)).toBe(true);
    expect(Math.abs(r.snap().x - 1500)).toBeLessThan(30);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('the click that ends a carry does not open the menu', async () => {
    const r = mountDesktop();
    const at = doozerAt(r);
    const to = pickUp(r, { x: at.x + 200, y: at.y });
    pointer(r.parts().hit, 'pointerup', to);
    click(r.parts().hit);
    expect(r.snap().open).toBe('none');
  });

  it('a sleeping Doozer is carried asleep', async () => {
    const r = mountDesktop({ setup: (brain) => { brain.debug?.setNeeds({ energy: 40 }); brain.sleep(); } });
    await tick(3000);
    const to = pickUp(r, { x: 900, y: 600 });
    expect(r.snap().state).toBe('carried');
    expect(r.brain.state.asleep).toBe(true);
    expect(r.parts().doozer.showing).toBe('asleep');
    pointer(r.parts().hit, 'pointerup', to);
    expect(await settle(r)).toBe(true);
    expect(r.brain.state.asleep).toBe(true);
    expect(r.parts().doozer.pose).toBe('sleep');
  });

  it('with motion reduced there is no float: it is back on the line', async () => {
    const r = mountDesktop({ setup: (brain) => brain.setSetting('reduceMotion', 'on') });
    const to = pickUp(r, { x: 700, y: 300 });
    expect(r.snap().state).toBe('carried');
    pointer(r.parts().hit, 'pointerup', to);
    expect(r.snap().state).toBe('idle');
    expect(restReport(r)).toEqual(AT_REST);
  });
});

describe('every way a carry ends', () => {
  const lift = (r: ReturnType<typeof mountDesktop>) => {
    const to = pickUp(r, { x: 1000, y: 450 });
    expect(r.snap().state).toBe('carried');
    return to;
  };
  const landed = async (r: ReturnType<typeof mountDesktop>, cause: string) => {
    expect(r.snap().state).not.toBe('carried');
    expect(r.snap().pressed).toBe(false);
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
    expect(r.snap().drops).toEqual({ [cause]: 1 });
  };

  it('on mouse-up', async () => {
    const r = mountDesktop();
    pointer(window, 'pointerup', lift(r));
    await landed(r, 'up');
  });

  it('on pointercancel', async () => {
    const r = mountDesktop();
    pointer(r.parts().hit, 'pointercancel', lift(r));
    await landed(r, 'cancel');
  });

  it('on lost pointer capture', async () => {
    const r = mountDesktop();
    pointer(r.parts().hit, 'lostpointercapture', lift(r));
    await landed(r, 'lost-capture');
  });

  it('when the shell says every button is up, though no mouse-up ever arrived', async () => {
    const r = mountDesktop();
    lift(r);
    r.shell.emit('pointer-released', { x: 2000, y: 100 });
    await landed(r, 'released');
  });

  it('when the shell could not even say where the pointer was', async () => {
    const r = mountDesktop();
    lift(r);
    r.shell.emit('pointer-released', null);
    await landed(r, 'released');
  });

  it('when the window loses focus', async () => {
    const r = mountDesktop();
    lift(r);
    window.dispatchEvent(new Event('blur'));
    await landed(r, 'blur');
  });

  it('as soon as the pointer moves with no button held', async () => {
    const r = mountDesktop();
    const at = lift(r);
    pointer(window, 'pointermove', { x: at.x + 6, y: at.y }, { buttons: 0 });
    await landed(r, 'no-button');
  });

  it('by itself, when nothing at all is heard from the pointer', async () => {
    const r = mountDesktop();
    lift(r);
    await tick(CARRY_QUIET_MS - 1000);
    expect(r.snap().state).toBe('carried');
    await tick(1500);
    await landed(r, 'quiet');
  });

  it('by itself, however long it is held', async () => {
    const r = mountDesktop();
    const at = lift(r);
    // Keep wiggling, button down, for two minutes.
    for (let t = 5000; t < CARRY_LIMIT_MS; t += 5000) {
      await tick(5000);
      pointer(r.parts().hit, 'pointermove', { x: at.x + (t % 10_000 ? 4 : -4), y: at.y }, { buttons: 1 });
      expect(r.snap().state).toBe('carried');
    }
    await tick(6000);
    await landed(r, 'limit');
    // The hand that is still holding the button moves on: nothing picks Doozer up again.
    pointer(r.parts().hit, 'pointermove', { x: at.x + 90, y: at.y - 90 }, { buttons: 1 });
    expect(r.snap().state).toBe('idle');
  });

  it('a press that never moves and never ends is forgotten, and toggles nothing', async () => {
    const r = mountDesktop();
    pointer(r.parts().hit, 'pointerdown', doozerAt(r), { buttons: 1 });
    expect(r.snap().pressed).toBe(true);
    await tick(11_000);
    expect(r.snap()).toMatchObject({ pressed: false, open: 'none', state: 'idle' });
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('the mouse-up that arrives after the shell already said so changes nothing', async () => {
    const r = mountDesktop();
    const at = lift(r);
    r.shell.emit('pointer-released', at);
    pointer(window, 'pointerup', at);
    pointer(r.parts().hit, 'lostpointercapture', at);
    await landed(r, 'released');
  });
});

describe('the Radial, the Card and the settings', () => {
  it('a click pokes Doozer and opens the Radial; another closes it', async () => {
    const r = mountDesktop();
    tap(r);
    expect(r.snap().open).toBe('radial');
    expect(r.parts().radial.isOpen).toBe(true);
    // Doozer and the six buttons catch the mouse.
    expect(r.view.hitRegions()).toHaveLength(7);
    tap(r);
    expect(r.snap().open).toBe('none');
    expect(r.parts().radial.isOpen).toBe(false);
    expect(r.view.hitRegions()).toHaveLength(1);
  });

  it('a double click counts once', async () => {
    const r = mountDesktop();
    tap(r);
    tap(r, 120);
    expect(r.snap().open).toBe('radial');
  });

  it('the Radial acts on the pet and gets out of the way', async () => {
    const r = mountDesktop({ setup: (brain) => brain.debug?.setNeeds({ tummy: 40 }) });
    tap(r);
    click(radialButton(r, 'feed'));
    expect(r.brain.state.needs.tummy).toBe(72);
    expect(r.snap()).toMatchObject({ open: 'none', scene: 'eat' });
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('More opens the Card over Doozer, and a click on Doozer puts it away', async () => {
    const r = mountDesktop();
    tap(r);
    click(radialButton(r, 'more'));
    expect(r.snap().open).toBe('card');
    expect(r.parts().card.isOpen).toBe(true);
    const regions = r.view.hitRegions();
    expect(regions).toHaveLength(2);
    const s = r.snap();
    const box = regions[1]!;
    // Above Doozer's head, on the screen.
    expect(box.y + box.h).toBeLessThan(s.y - 80);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(s.stage.w);
    expect(Math.abs(box.x + box.w / 2 - s.x)).toBeLessThan(2);
    tap(r);
    expect(r.snap().open).toBe('none');
    expect(r.parts().card.isOpen).toBe(false);
    expect(r.view.hitRegions()).toHaveLength(1);
  });

  it('never asks for the keyboard for the Radial or the Card, only for the settings', async () => {
    const r = mountDesktop();
    tap(r);
    click(radialButton(r, 'more'));
    click(cardButton(r, 'feed'));
    expect(r.host.calls.filter((call) => call === 'focusable:true')).toEqual([]);
    click(cardButton(r, 'settings'));
    expect(r.snap().open).toBe('settings');
    expect(r.host.state.focusable).toBe(true);
    // Closing the settings goes back to the Card it came from.
    click(r.parts().settings.el.querySelector<HTMLElement>('[aria-label="Close settings"]')!);
    expect(r.snap().open).toBe('card');
    expect(r.host.state.focusable).toBe(false);
  });

  it('the tray can open the settings, and closing them leaves nothing open', async () => {
    const r = mountDesktop();
    r.view.openSettings?.();
    expect(r.snap().open).toBe('settings');
    expect(r.parts().settings.isOpen).toBe(true);
    click(r.parts().settings.el.querySelector<HTMLElement>('[aria-label="Close settings"]')!);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('the Card switches view through the host, and unbuilt views are coming soon', async () => {
    const r = mountDesktop();
    r.view.setOpen('card');
    const { card } = r.parts();
    click(card.el.querySelector<HTMLElement>('[data-view="pill"]')!);
    expect(r.host.calls).toContain('switch:pill');
    expect(card.el.querySelector<HTMLButtonElement>('[data-view="room"]')?.disabled).toBe(true);
    expect(card.el.querySelector<HTMLButtonElement>('[data-view="desktop"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('picking Doozer up closes whatever is open', async () => {
    for (const what of ['radial', 'card', 'settings'] as const) {
      const r = mountDesktop();
      r.view.setOpen(what);
      expect(r.snap().open).toBe(what);
      const to = pickUp(r, { x: 900, y: 700 });
      expect(r.snap()).toMatchObject({ open: 'none', state: 'carried' });
      expect(r.host.state.focusable).toBe(false);
      pointer(r.parts().hit, 'pointerup', to);
      expect(await settle(r)).toBe(true);
      expect(restReport(r)).toEqual(AT_REST);
      r.view.unmount();
    }
  });

  it('nothing opens around a Doozer that is in the air', async () => {
    const r = mountDesktop();
    pickUp(r, { x: 900, y: 500 });
    r.view.setOpen('card');
    r.view.openSettings?.();
    expect(r.snap().open).toBe('none');
  });

  it('menus close by themselves when nobody is there', async () => {
    const r = mountDesktop();
    tap(r);
    await tick(13_000);
    expect(r.snap().open).toBe('none');
    r.view.setOpen('card');
    await tick(119_000);
    expect(r.snap().open).toBe('card');
    await tick(2000);
    expect(r.snap().open).toBe('none');
    r.view.openSettings?.();
    await tick(181_000);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('a pointer that is still there keeps the Card open', async () => {
    const r = mountDesktop();
    r.view.setOpen('card');
    for (let i = 0; i < 10; i++) {
      await tick(60_000);
      pointer(r.parts().card.el, 'pointermove', { x: 1800, y: 900 });
    }
    expect(r.snap().open).toBe('card');
  });

  it('the Radial leans away from the edge of the screen', async () => {
    const r = mountDesktop();
    const to = pickUp(r, { x: 40, y: 1340 });
    pointer(r.parts().hit, 'pointerup', to);
    expect(await settle(r)).toBe(true);
    expect(r.snap().x).toBe(r.snap().stage.minX);
    tap(r);
    const first = radialButton(r, 'feed').style.getPropertyValue('--a');
    const last = radialButton(r, 'more').style.getPropertyValue('--a');
    expect(first).toBe('-100deg');
    expect(last).toBe('0deg');
  });

  it('right-click asks the host for the native menu', async () => {
    const r = mountDesktop();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    r.parts().hit.dispatchEvent(event);
    expect(r.host.calls).toContain('menu');
    expect(event.defaultPrevented).toBe(true);
  });

  it('Doozer does not wander off while something is open or the pointer is on it', async () => {
    const r = mountDesktop({ pace: 'lively' });
    expect(await settle(r, 60_000)).toBe(true);
    r.view.setOpen('card');
    const x = r.snap().x;
    for (let i = 0; i < 20; i++) {
      await tick(3000);
      pointer(r.parts().card.el, 'pointermove', { x: 100, y: 100 });
    }
    expect(r.snap().x).toBe(x);
    r.view.setOpen('none');
    await tick(20_000);
    expect(r.snap().x).not.toBe(x);
  });

  it('opening the menu stops a stroll where it is', async () => {
    const r = mountDesktop({ pace: 'calm' });
    expect(r.view.act('stroll')).toBe(true);
    await tick(1000);
    expect(r.snap().scene).toBe('stroll');
    tap(r);
    expect(r.snap()).toMatchObject({ scene: null, open: 'radial', pose: 'idle' });
    const x = r.snap().x;
    await tick(3000);
    expect(r.snap().x).toBe(x);
  });
});

describe('petting', () => {
  it('stroking across Doozer is a pet; a pointer that only crosses is nothing', async () => {
    const r = mountDesktop();
    const { hit } = r.parts();
    const at = doozerAt(r);
    let pets = 0;
    r.brain.on('action', (event) => { if (event.type === 'pet') pets++; });
    // A crossing: a few fast moves and gone.
    for (let i = 0; i < 5; i++) pointer(hit, 'pointermove', at, { movementX: 40 });
    pointer(hit, 'pointerleave', at);
    expect(pets).toBe(0);
    expect(r.snap().hover).toBe(false);
    await tick(1000);
    // A visit: the pointer stays, and strokes back and forth.
    pointer(hit, 'pointermove', at);
    await tick(250);
    for (let i = 0; i < 6; i++) {
      pointer(hit, 'pointermove', at, { movementX: 30 });
      await tick(40);
    }
    expect(pets).toBe(1);
    expect(r.snap().hover).toBe(true);
    expect(r.snap().lively).toBe(true);
    // The hover look gives up by itself even if the pointer never says goodbye.
    await tick(4200);
    expect(r.snap().hover).toBe(false);
    await tick(6000);
    expect(r.snap().lively).toBe(false);
  });
});

describe('placement', () => {
  it('follows a display change: Doozer stays on the new line', async () => {
    const r = mountDesktop();
    const before = r.snap();
    // The same monitor at 100 % scaling: the work area is 3840 x 2088 CSS pixels now.
    r.view.windowChanged?.({ ...INFO, scale: 1, cssWidth: 3840, cssHeight: 2088, monitor: { ...INFO.monitor, scale: 1 } });
    const s = r.snap();
    expect(s.stage).toMatchObject({ w: 3840, h: 2088 });
    expect(s.y).toBe(s.ground);
    expect(s.ground).toBe(2082);
    // The same place across the screen.
    expect(s.x / s.stage.w).toBeCloseTo(before.x / before.stage.w, 3);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('a display change in the middle of anything ends on the line', async () => {
    const small = infoFor({ x: 0, y: 0, w: 1280, h: 720 }, { x: 0, y: 0, w: 1280, h: 680 });
    for (const prepare of [
      (r: ReturnType<typeof mountDesktop>) => void r.view.act('stroll'),
      (r: ReturnType<typeof mountDesktop>) => void r.view.act('peek'),
      (r: ReturnType<typeof mountDesktop>) => void r.brain.play(),
      (r: ReturnType<typeof mountDesktop>) => void r.view.setOpen('card'),
      (r: ReturnType<typeof mountDesktop>) => { pointer(r.parts().hit, 'pointerup', pickUp(r, { x: 2000, y: 300 })); },
      (r: ReturnType<typeof mountDesktop>) => void pickUp(r, { x: 2000, y: 300 }),
    ]) {
      const r = mountDesktop({ pace: 'lively' });
      prepare(r);
      await tick(700);
      r.view.windowChanged?.(small);
      const s = r.snap();
      expect(s.stage).toMatchObject({ w: 1280, h: 680, monitor: '1280x720@0,0' });
      expect(s.x).toBeLessThanOrEqual(s.stage.w);
      expect(s.y).toBeLessThanOrEqual(s.ground);
      pointer(window, 'pointerup', { x: 600, y: 300 });
      r.brain.setSetting('desktopActivity', 'still');
      expect(await settle(r)).toBe(true);
      expect(restReport(r)).toEqual(AT_REST);
      r.view.unmount();
    }
  });
});
