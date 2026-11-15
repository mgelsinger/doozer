// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrain, type Brain, type ViewId } from '../../../src/core';
import type { HostServices, ViewContext } from '../../../src/host/view';
import type { Shell, ShellEvents, WindowInfo } from '../../../src/shell';
import { createPillView, type PillView } from '../../../src/views/pill';
import { WINDOW_HEIGHT, WINDOW_WIDTH } from '../../../src/views/pill/layout';
import { HOUR, MIN, START, fakeClock, seeded } from '../../core/helpers';

// ---- a host and a shell that only record ---------------------------------------------

function fakeHost(options: { needsWelcome?: boolean } = {}) {
  const calls: string[] = [];
  const state = { welcome: options.needsWelcome ?? false, focusable: false };
  const services: HostServices = {
    availableViews: ['pill'],
    currentView: () => 'pill',
    switchView: (view: ViewId) => void calls.push(`switch:${view}`),
    regionsChanged: () => void calls.push('regions'),
    windowChanged: () => void calls.push('window'),
    setFocusable: (on) => { state.focusable = on; calls.push(`focusable:${on}`); },
    showMenu: () => void calls.push('menu'),
    quit: () => void calls.push('quit'),
    chime: () => void calls.push('chime'),
    needsWelcome: () => state.welcome,
    welcomed: () => { state.welcome = false; calls.push('welcomed'); },
  };
  return { services, calls, state };
}

function fakeShell() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const shell = {
    native: false,
    on(event: string, handler: (payload: unknown) => void) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
      return () => void set.delete(handler);
    },
  } as unknown as Shell;
  return {
    shell,
    emit<K extends keyof ShellEvents>(event: K, payload: ShellEvents[K]): void {
      handlers.get(event)?.forEach((handler) => handler(payload));
    },
    listeners: (event: string) => handlers.get(event)?.size ?? 0,
  };
}

const INFO: WindowInfo = {
  kind: 'docked', view: 'pill', x: 0, y: 0, width: 600, height: 1116, scale: 1.5, cssWidth: WINDOW_WIDTH, cssHeight: WINDOW_HEIGHT,
  monitor: { full: { x: 0, y: 0, w: 3840, h: 2160 }, work: { x: 0, y: 0, w: 3840, h: 2088 }, scale: 1.5 }, nativeMs: 0,
};

interface Rig {
  view: PillView;
  brain: Brain;
  clock: ReturnType<typeof fakeClock>;
  host: ReturnType<typeof fakeHost>;
  shell: ReturnType<typeof fakeShell>;
  root: HTMLElement;
  snap: () => NonNullable<ReturnType<PillView['snapshot']>>;
  parts: () => NonNullable<ReturnType<PillView['parts']>>;
}

function mount(options: { needsWelcome?: boolean; save?: unknown; setup?(brain: Brain): void } = {}): Rig {
  const clock = fakeClock(START);
  const brain = createBrain({ save: options.save, now: clock.now, random: seeded(11), debug: true });
  // A settled, happy pet with the sound question already answered, unless a test says otherwise.
  brain.debug?.setNeeds({ tummy: 80, fun: 80, energy: 80, clean: 80 });
  if (!options.needsWelcome) brain.setSetting('soundAsked', true);
  options.setup?.(brain);
  const host = fakeHost(options);
  const shell = fakeShell();
  const root = document.createElement('div');
  document.body.append(root);
  const view = createPillView({ now: () => Date.now(), random: seeded(5) });
  const context: ViewContext = { brain, shell: shell.shell, host: host.services, info: INFO };
  void view.mount(root, context);
  return {
    view, brain, clock, host, shell, root,
    snap: () => view.snapshot() as NonNullable<ReturnType<PillView['snapshot']>>,
    parts: () => view.parts() as NonNullable<ReturnType<PillView['parts']>>,
  };
}

let stamp = 10_000;
/** A click with a real-looking time stamp, `gap` ms after the previous one. */
function click(target: Element, gap = 1000): void {
  stamp += gap;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: stamp });
  target.dispatchEvent(event);
}

function pointer(target: Element, type: string, init: { buttons?: number; button?: number; movementX?: number; movementY?: number } = {}): void {
  const event = new MouseEvent(type, { bubbles: true, button: init.button ?? 0, buttons: init.buttons ?? 0 });
  Object.defineProperty(event, 'movementX', { value: init.movementX ?? 0 });
  Object.defineProperty(event, 'movementY', { value: init.movementY ?? 0 });
  target.dispatchEvent(event);
}

/** Let `ms` pass, running timers and the promise continuations between them. */
const tick = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);
const button = (r: Rig, act: string): HTMLButtonElement => {
  const found = r.parts().card.el.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);
  if (!found) throw new Error(`no card button ${act}`);
  return found;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  // The test DOM's Web Animations stub rejects a promise nobody holds whenever an animation
  // is cancelled. The rig and the kit never depend on an animation (their timing is all
  // timers), so run without one, as they do in any page that cannot animate.
  (Element.prototype as { animate?: unknown }).animate = undefined;
});
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

// ---- tests ---------------------------------------------------------------------------

describe('the pill face', () => {
  it('shows the name, a status line and a ring, and catches the mouse on the pill and on Doozer', async () => {
    const r = mount();
    const { pill } = r.parts();
    expect(pill.querySelector('.pillv-name')?.textContent).toBe('Doozer');
    expect(r.snap()).toMatchObject({ open: 'none', status: 'is overjoyed', statusTone: 'plain', ring: 'wellbeing:80' });
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    expect(pill.getAttribute('aria-label')).toContain('Doozer is overjoyed');
    expect(r.view.hitRegions()).toHaveLength(2);
    expect(r.parts().root.dataset.dock).toBe('top-center');
  });

  it('follows the brain: hungry in amber, then a countdown while focusing', async () => {
    const r = mount();
    r.brain.debug?.setNeeds({ tummy: 20 });
    expect(r.snap()).toMatchObject({ status: 'is hungry', statusTone: 'low' });
    r.brain.debug?.setNeeds({ tummy: 80 });
    r.brain.startFocus();
    expect(r.snap()).toMatchObject({ status: '25:00', statusTone: 'focus', ring: 'focus:0' });
    r.clock.advance(5 * MIN);
    r.brain.tick();
    expect(r.snap()).toMatchObject({ status: '20:00', ring: 'focus:20' });
    expect(r.parts().mini.el.dataset.glasses).toBe('1');
  });

  it('a session nobody is watching is counted in minutes: the pill changes once a minute, not once a second', async () => {
    const r = mount();
    r.brain.startFocus();
    // Just started: Doozer is lively for a moment, and the pill counts the seconds.
    expect(r.snap()).toMatchObject({ status: '25:00', lively: true });
    await tick(20_000);
    expect(r.snap().lively).toBe(false);
    expect(r.snap().status).toBe('25 min');
    // Two minutes, ticked every second as the host's clock does it.
    const statusEl = r.parts().root.querySelector('.pillv-status');
    let shown = statusEl?.textContent;
    let changes = 0;
    for (let i = 0; i < 120; i++) {
      r.clock.advance(1000);
      r.brain.tick();
      if (statusEl?.textContent !== shown) { changes++; shown = statusEl?.textContent; }
    }
    expect(changes).toBeLessThanOrEqual(2);
    expect(r.snap().status).toMatch(/^2[23] min$/);
    // The pointer comes to rest on the pill: seconds again.
    const pill = r.parts().pill;
    pointer(pill, 'pointerenter');
    await tick(250);
    pointer(pill, 'pointermove');
    expect(r.snap().lively).toBe(true);
    expect(r.snap().status).toMatch(/^2[23]:\d\d$/);
    // And it goes back to minutes by itself once the pointer has gone.
    pointer(pill, 'pointerleave');
    await tick(20_000);
    expect(r.snap().lively).toBe(false);
    expect(r.snap().status).toMatch(/^2[23] min$/);
  });

  it('wears the palette and the size from the settings', async () => {
    const r = mount();
    r.brain.setSetting('palette', 'mint');
    expect(r.parts().mini.palette).toBe('mint');
    r.brain.setSetting('size', { ...r.brain.settings.size, pill: 'large' });
    expect(r.parts().root.querySelector<HTMLElement>('.pillv-face')?.style.getPropertyValue('--pillv-zoom')).toBe('1.18');
    expect(r.host.calls).toContain('regions');
  });

  it('moves to the dock the host re-placed it at', async () => {
    const r = mount();
    r.brain.setSetting('pillDock', 'bottom-right');
    r.view.windowChanged?.(INFO);
    expect(r.parts().root.dataset.dock).toBe('bottom-right');
    expect(r.view.windowSettings).toEqual(['pillDock']);
    expect(r.view.window({ settings: r.brain.settings, position: null })).toMatchObject({ kind: 'docked', anchor: 'bottom-right' });
  });
});

describe('opening and closing', () => {
  it('a click unfolds the Card and another folds it away', async () => {
    const r = mount();
    const { pill, card } = r.parts();
    click(pill);
    expect(r.snap().open).toBe('card');
    expect(card.isOpen).toBe(true);
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    expect(r.view.hitRegions()).toHaveLength(3);
    expect(r.host.calls.at(-1)).toBe('regions');
    click(pill);
    expect(r.snap().open).toBe('none');
    expect(card.isOpen).toBe(false);
    expect(r.view.hitRegions()).toHaveLength(2);
  });

  it('a click on Doozer above the pill counts too', async () => {
    const r = mount();
    click(r.parts().reach);
    expect(r.snap().open).toBe('card');
  });

  it('a double click counts once', async () => {
    const r = mount();
    click(r.parts().pill);
    click(r.parts().pill, 120);
    expect(r.snap().open).toBe('card');
    click(r.parts().pill, 400);
    expect(r.snap().open).toBe('none');
  });

  it('hammering the pill always ends in a definite state', async () => {
    const r = mount();
    for (let i = 0; i < 41; i++) click(r.parts().pill, 330);
    expect(r.snap().open).toBe('card');
    expect(r.parts().card.el.dataset.open).toBe('1');
    expect(r.parts().settings.el.dataset.open).toBe('0');
  });

  it('follows the Card when it closes itself (Escape)', async () => {
    const r = mount();
    click(r.parts().pill);
    r.parts().card.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(r.snap().open).toBe('none');
    expect(r.view.hitRegions()).toHaveLength(2);
  });

  it('never asks for the keyboard for the Card', async () => {
    const r = mount();
    click(r.parts().pill);
    click(button(r, 'feed'));
    click(r.parts().pill);
    expect(r.host.calls.filter((call) => call === 'focusable:true')).toEqual([]);
  });

  it('shows the views that are not built yet as coming soon, and does not switch to them', async () => {
    const r = mount();
    click(r.parts().pill);
    const room = r.parts().card.el.querySelector<HTMLButtonElement>('[data-view="room"]');
    expect(room?.disabled).toBe(true);
    expect(room?.dataset.tip).toContain('coming soon');
    if (room) click(room);
    expect(r.host.calls.filter((call) => call.startsWith('switch'))).toEqual([]);
    expect(r.parts().card.el.querySelector('[data-view="pill"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('a right-click asks for the native menu', async () => {
    const r = mount();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    r.parts().pill.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(r.host.calls).toContain('menu');
  });
});

describe('the Card from the keyboard (the shortcut)', () => {
  const focusCalls = (r: Rig): string[] => r.host.calls.filter((call) => call.startsWith('focusable'));

  it('opens the Card, asks for the keyboard and puts the focus on the first action', async () => {
    const r = mount();
    r.view.openCard?.(true);
    expect(r.snap().open).toBe('card');
    expect(r.parts().card.isOpen).toBe(true);
    expect(r.host.state.focusable).toBe(true);
    expect(document.activeElement).toBe(button(r, 'feed'));
    // The Card catches the mouse as it does when opened with a click.
    expect(r.view.hitRegions()).toHaveLength(3);
  });

  it('Escape closes it and gives the keyboard back', async () => {
    const r = mount();
    r.view.openCard?.(true);
    r.parts().card.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(r.snap().open).toBe('none');
    expect(r.host.state.focusable).toBe(false);
    expect(focusCalls(r)).toEqual(['focusable:true', 'focusable:false']);
  });

  it('the shortcut again closes it, and so does a click on the pill: either way the keyboard goes back', async () => {
    const r = mount();
    r.view.openCard?.(true);
    r.view.openCard?.(true);
    expect(r.snap().open).toBe('none');
    expect(r.host.state.focusable).toBe(false);
    r.view.openCard?.(true);
    expect(r.host.state.focusable).toBe(true);
    click(r.parts().pill);
    expect(r.snap().open).toBe('none');
    expect(r.host.state.focusable).toBe(false);
  });

  it('a Card opened with the mouse never has the keyboard, until the shortcut asks for it', async () => {
    const r = mount();
    click(r.parts().pill);
    click(button(r, 'feed'));
    expect(r.snap().open).toBe('card');
    expect(focusCalls(r).filter((call) => call === 'focusable:true')).toEqual([]);
    // Now from the keyboard: the same Card, with the keyboard.
    r.view.openCard?.(true);
    expect(r.snap().open).toBe('card');
    expect(r.host.state.focusable).toBe(true);
    expect(document.activeElement).toBe(button(r, 'feed'));
    // Closed and opened again with the mouse: back to never.
    click(r.parts().pill);
    expect(r.host.state.focusable).toBe(false);
    click(r.parts().pill);
    expect(r.snap().open).toBe('card');
    expect(r.host.state.focusable).toBe(false);
  });

  it('from the tray menu the Card opens without the keyboard', async () => {
    const r = mount();
    r.view.openCard?.(false);
    expect(r.snap().open).toBe('card');
    expect(focusCalls(r).filter((call) => call === 'focusable:true')).toEqual([]);
  });

  it('keeps the keyboard through the settings and back, and does not invent it for a Card opened with the mouse', async () => {
    const r = mount();
    r.view.openCard?.(true);
    click(button(r, 'settings'));
    expect(r.snap().open).toBe('settings');
    expect(r.host.state.focusable).toBe(true);
    const close = (): HTMLButtonElement | null => r.parts().settings.el.querySelector<HTMLButtonElement>('[aria-label="Close settings"]');
    click(close() as HTMLButtonElement);
    // Back on the Card, still with the keyboard, and the focus is on it again.
    expect(r.snap().open).toBe('card');
    expect(r.host.state.focusable).toBe(true);
    expect(document.activeElement).toBe(button(r, 'feed'));
    click(r.parts().pill);
    expect(r.host.state.focusable).toBe(false);
    // The same journey begun with the mouse ends without the keyboard.
    click(r.parts().pill);
    click(button(r, 'settings'));
    click(close() as HTMLButtonElement);
    expect(r.snap().open).toBe('card');
    expect(r.host.state.focusable).toBe(false);
  });

  it('tucked away, the shortcut opens nothing and asks for nothing', async () => {
    const r = mount();
    r.view.setAwake?.(false);
    r.view.openCard?.(true);
    expect(r.snap().open).toBe('none');
    expect(focusCalls(r).filter((call) => call === 'focusable:true')).toEqual([]);
  });

  it('every action on the Card can be reached and pressed from the keyboard', async () => {
    const r = mount();
    r.brain.debug?.setNeeds({ tummy: 40 });
    r.view.openCard?.(true);
    const card = r.parts().card.el;
    // Everything that can be pressed is a real button, in the tab order, with a name.
    const buttons = [...card.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.disabled && !b.hidden);
    expect(buttons.length).toBeGreaterThanOrEqual(12);
    for (const b of buttons) {
      expect(b.getAttribute('aria-label') || b.textContent?.trim() || b.dataset.tip, b.outerHTML.slice(0, 80)).toBeTruthy();
      // Radio-like groups keep one stop in the tab order (the arrows move within them).
      expect(b.tabIndex === 0 || b.getAttribute('role') === 'radio' || b.closest('[role="radiogroup"]') !== null, b.outerHTML.slice(0, 80)).toBe(true);
    }
    // Enter on the focused button is a press: Doozer is fed.
    const before = r.brain.state.needs.tummy;
    (document.activeElement as HTMLButtonElement).click();
    expect(r.brain.state.needs.tummy).toBeGreaterThan(before);
  });
});

describe('settings', () => {
  it('take the place of the Card, may use the keyboard, and hand both back when closed', async () => {
    const r = mount();
    click(r.parts().pill);
    click(button(r, 'settings'));
    expect(r.snap().open).toBe('settings');
    expect(r.parts().card.isOpen).toBe(false);
    expect(r.parts().settings.isOpen).toBe(true);
    expect(r.host.state.focusable).toBe(true);
    expect(r.view.hitRegions()).toHaveLength(3);
    const close = r.parts().settings.el.querySelector<HTMLButtonElement>('[aria-label="Close settings"]');
    if (close) click(close);
    expect(r.snap().open).toBe('card');
    expect(r.host.state.focusable).toBe(false);
  });

  it('opened from the tray, they close back to the pill alone', async () => {
    const r = mount();
    r.view.openSettings?.();
    expect(r.snap().open).toBe('settings');
    r.parts().settings.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(r.snap().open).toBe('none');
    expect(r.host.state.focusable).toBe(false);
  });

  it('a click on the pill folds the settings away', async () => {
    const r = mount();
    r.view.openSettings?.();
    click(r.parts().pill);
    expect(r.snap().open).toBe('none');
    expect(r.host.state.focusable).toBe(false);
  });

  it('the Quit button asks the host, which saves first', async () => {
    const r = mount();
    r.view.openSettings?.();
    const quit = [...r.parts().settings.el.querySelectorAll('button')].find((b) => b.textContent === 'Quit Doozer');
    expect(quit).toBeDefined();
    if (quit) click(quit);
    expect(r.host.calls).toContain('quit');
  });

  it('every row of the spec is there', async () => {
    const r = mount();
    r.view.openSettings?.();
    const labels = [...r.parts().settings.el.querySelectorAll('.dzk-row-label')].map((node) => node.firstChild?.textContent);
    for (const row of ['Colour', 'Size', 'Pill position', 'Desktop activity', 'Sound', 'When a focus session ends', 'Always on top', 'Tuck away during fullscreen apps', 'Start with Windows', 'Reduce motion']) {
      expect(labels, row).toContain(row);
    }
  });
});

describe('the Card on the real brain', () => {
  it('feeds, fills the bowl, gives a treat, plays, washes and naps', async () => {
    const r = mount({ setup: (brain) => brain.debug?.setNeeds({ tummy: 40, fun: 40, energy: 60, clean: 40 }) });
    click(r.parts().pill);
    click(button(r, 'feed'));
    expect(r.brain.state.needs.tummy).toBe(72);
    click(button(r, 'fill'));
    expect(r.brain.state.bowl).toBe(3);
    const treats = r.brain.state.treats;
    click(button(r, 'treat'));
    expect(r.brain.state.treats).toBe(treats - 1);
    click(button(r, 'play'));
    expect(r.brain.state.needs.fun).toBeGreaterThan(40 + 16);
    click(button(r, 'wash'));
    expect(r.brain.state.needs.clean).toBe(100);
    click(button(r, 'sleep'));
    expect(r.brain.state.asleep).toBe(true);
    expect(r.snap().status).toBe('is napping');
    click(button(r, 'sleep'));
    expect(r.brain.state.asleep).toBe(false);
  });

  it('runs a focus session from the Card and shows the streak', async () => {
    const r = mount();
    click(r.parts().pill);
    const chip = r.parts().card.el.querySelector<HTMLButtonElement>('.dzk-chip[data-min="15"]');
    if (chip) click(chip);
    click(button(r, 'focus'));
    expect(r.brain.state.focus).toMatchObject({ status: 'running', minutes: 15 });
    click(button(r, 'focus'));
    expect(r.brain.state.focus.status).toBe('paused');
    click(button(r, 'focus'));
    click(button(r, 'focus-stop'));
    expect(r.brain.state.focus.status).toBe('idle');
    expect(r.brain.state.sessionsCompleted).toBe(0);
    click(button(r, 'focus'));
    r.brain.debug?.finishFocusNow();
    expect(r.brain.state.sessionsCompleted).toBe(1);
    expect(r.parts().card.el.querySelector('.dzk-streak b')?.textContent).toBe('1');
    expect(r.brain.state.treats).toBe(2 + 1 + 1);
  });

  it('says what each session length earns, from the brain and not from a number of its own', async () => {
    const r = mount();
    click(r.parts().pill);
    const tips = [...r.parts().card.el.querySelectorAll<HTMLElement>('.dzk-chip')].map((chip) => chip.dataset.tip);
    expect(tips).toEqual(['15 minutes earns 1 treat', '25 minutes earns 2 treats', '50 minutes earns 4 treats']);
    expect(button(r, 'focus').dataset.tip).toContain('earns 2 treats, plus 1 for the first session of the day');
    click(button(r, 'focus'));
    expect(button(r, 'focus').dataset.tip).toBeUndefined();
  });

  it('the mute button turns sound on and off', async () => {
    const r = mount();
    click(r.parts().pill);
    click(button(r, 'mute'));
    expect(r.brain.settings.sound).toBe(true);
    click(button(r, 'mute'));
    expect(r.brain.settings.sound).toBe(false);
  });
});

describe('never stuck', () => {
  it('rapid presses on every Card button leave nothing half-done', async () => {
    const r = mount({ setup: (brain) => { brain.debug?.setNeeds({ tummy: 30, fun: 30, energy: 50, clean: 30 }); brain.debug?.addTreats(10); } });
    click(r.parts().pill);
    for (const act of ['feed', 'play', 'wash', 'sleep', 'fill', 'treat', 'focus', 'focus-stop', 'mute', 'feed', 'sleep', 'treat']) {
      for (let i = 0; i < 12; i++) {
        click(button(r, act), 35);
        await tick(35);
      }
    }
    for (const chip of r.parts().card.el.querySelectorAll<HTMLButtonElement>('.dzk-chip')) {
      for (let i = 0; i < 6; i++) click(chip, 35);
    }
    // Everything temporary must end by itself. No scene may run longer than its limit.
    await tick(12_000);
    expect(r.snap()).toMatchObject({ open: 'card', miniBusy: false, stageBusy: false, emotes: 0, pressed: false });
    expect(r.parts().card.el.querySelectorAll('.dzk-prop')).toHaveLength(0);
    expect(r.parts().card.el.querySelectorAll('.dzk-emote')).toHaveLength(0);
    // ...and the Card still works.
    if (r.brain.state.asleep) r.brain.wake();
    r.brain.stopFocus();
    r.brain.debug?.setNeeds({ tummy: 30 });
    const before = r.brain.state.needs.tummy;   // it may have helped itself from the bowl already
    click(button(r, 'feed'));
    expect(r.brain.state.needs.tummy).toBe(before + 32);
    await tick(12_000);
    expect(r.snap()).toMatchObject({ miniBusy: false, stageBusy: false, emotes: 0 });
  });

  it('closing the Card at any moment of any scene cleans the stage completely', async () => {
    const scenes: [string, (brain: Brain) => void][] = [
      ['feed', (brain) => void brain.feed()],
      ['treat', (brain) => void brain.giveTreat()],
      ['play', (brain) => void brain.play()],
      ['wash', (brain) => void brain.wash()],
      ['sleep', (brain) => void brain.sleep()],
      ['focus', (brain) => { brain.startFocus(); brain.debug?.finishFocusNow(); }],
    ];
    for (const [name, act] of scenes) {
      for (let cutAt = 0; cutAt <= 3600; cutAt += 300) {
        const r = mount({ setup: (brain) => { brain.debug?.setNeeds({ tummy: 30, fun: 30, energy: 50, clean: 30 }); brain.debug?.addTreats(5); } });
        click(r.parts().pill);
        act(r.brain);
        await tick(cutAt);
        click(r.parts().pill);
        const label = `${name} cut at ${cutAt} ms`;
        expect(r.snap().open, label).toBe('none');
        expect(r.snap().stageBusy, label).toBe(false);
        expect(r.parts().card.el.querySelectorAll('.dzk-prop, .dzk-emote'), label).toHaveLength(0);
        // The pill's own Doozer finishes what it was doing and comes to rest.
        await tick(12_000);
        expect(r.snap(), label).toMatchObject({ miniBusy: false, emotes: 0, lively: false });
        // Reopening shows a working Card.
        click(r.parts().pill);
        expect(r.parts().card.isOpen, label).toBe(true);
        r.view.unmount();
        document.body.replaceChildren();
      }
    }
  });

  it('a press whose mouse-up never arrives ends when the shell says the button is up', async () => {
    const r = mount();
    pointer(r.parts().pill, 'pointerdown', { buttons: 1 });
    expect(r.snap().pressed).toBe(true);
    // No pointerup, no click: the page hears nothing more. The shell reads the button from Windows.
    r.shell.emit('pointer-released', { x: -500, y: 900 });
    expect(r.snap().pressed).toBe(false);
    expect(r.snap().timers).not.toContain('press');
    // Nothing was toggled by the lost press, and the next click works.
    expect(r.snap().open).toBe('none');
    click(r.parts().pill);
    expect(r.snap().open).toBe('card');
  });

  it('even with no word from the shell, a press does not last', async () => {
    const r = mount();
    pointer(r.parts().pill, 'pointerdown', { buttons: 1 });
    await tick(2999);
    expect(r.snap().pressed).toBe(true);
    await tick(1);
    expect(r.snap().pressed).toBe(false);
  });

  it('a press ends on pointerup, on pointercancel, on leaving, and on a move with no button held', async () => {
    for (const end of ['pointerup', 'pointercancel', 'pointerleave', 'pointermove']) {
      const r = mount();
      pointer(r.parts().pill, 'pointerdown', { buttons: 1 });
      const face = r.parts().pill.parentElement as HTMLElement;
      pointer(end === 'pointerleave' ? face : r.parts().pill, end, { buttons: 0 });
      expect(r.snap().pressed, end).toBe(false);
      r.view.unmount();
    }
  });

  it('the hover look relaxes by itself when the pointer events stop', async () => {
    const r = mount();
    const face = r.parts().pill.parentElement as HTMLElement;
    pointer(face, 'pointermove');
    await tick(200);
    pointer(face, 'pointermove');
    expect(r.snap().hover).toBe(true);
    await tick(4000);
    expect(r.snap().hover).toBe(false);
  });

  it('a focus session ending while the Card is closed: celebrates, pays out, and comes back to rest', async () => {
    const r = mount();
    r.brain.startFocus();
    expect(r.snap().status).toBe('25:00');
    r.clock.advance(25 * MIN + 1000);
    r.brain.tick();
    expect(r.brain.state.focus.status).toBe('idle');
    expect(r.brain.state.treats).toBe(2 + 2 + 1);
    expect(r.snap().lively).toBe(true);
    expect(r.snap().miniBusy).toBe(true);
    // Quietly: the Card stays shut and nothing asks for the keyboard.
    expect(r.snap().open).toBe('none');
    expect(r.host.calls.filter((call) => call.startsWith('focusable'))).toEqual([]);
    await tick(12_000);
    expect(r.snap()).toMatchObject({ open: 'none', miniBusy: false, emotes: 0, lively: false, statusTone: 'plain' });
    expect(r.snap().status).toMatch(/^is /);
    expect(r.snap().ring).toMatch(/^wellbeing:/);
    expect(r.parts().mini.el.dataset.glasses).toBe('0');
    expect(r.view.hitRegions()).toHaveLength(2);
  });

  it('with "Open the Card" chosen, the Card opens when the session ends, still without the keyboard', async () => {
    const r = mount({ setup: (brain) => brain.setSetting('onFocusEnd', 'open-card') });
    r.brain.startFocus();
    r.brain.debug?.finishFocusNow();
    expect(r.snap().open).toBe('card');
    expect(r.host.calls.filter((call) => call === 'focusable:true')).toEqual([]);
    // The Card was open in time for its own Doozer to celebrate too.
    expect(r.snap().stageBusy).toBe(true);
    await tick(12_000);
    expect(r.snap()).toMatchObject({ open: 'card', miniBusy: false, stageBusy: false });
  });

  it('stopping a session early says nothing at all', async () => {
    const r = mount();
    r.brain.startFocus();
    await tick(3000);
    r.brain.stopFocus();
    expect(r.snap()).toMatchObject({ open: 'none', emotes: 0, status: 'is overjoyed' });
  });
});

describe('render on demand', () => {
  it('comes to rest a few seconds after mounting and stays still', async () => {
    const r = mount();
    expect(r.snap().lively).toBe(true);
    await tick(4000);
    expect(r.snap().lively).toBe(false);
    expect(r.parts().mini.el.dataset.live).toBe('0');
    await tick(10 * 60_000);
    expect(r.snap().lively).toBe(false);
  });

  it('is lively while the pointer rests on it, and not for long after', async () => {
    const r = mount();
    await tick(5000);
    const face = r.parts().pill.parentElement as HTMLElement;
    pointer(face, 'pointermove');
    await tick(200);
    pointer(face, 'pointermove');
    expect(r.snap().lively).toBe(true);
    expect(r.parts().mini.el.dataset.live).toBe('1');
    await tick(3500);
    expect(r.snap().lively).toBe(false);
  });

  it('a pointer that only crosses the pill costs nothing: no hover look, no lively spell', async () => {
    const r = mount();
    await tick(5000);
    const face = r.parts().pill.parentElement as HTMLElement;
    // On its way to a title bar or a tab: in and out within a tenth of a second, many times.
    for (let crossing = 0; crossing < 20; crossing++) {
      pointer(face, 'pointerenter');
      for (let i = 0; i < 5; i++) {
        pointer(face, 'pointermove', { movementX: 30 });
        await tick(16);
      }
      pointer(face, 'pointerleave');
      await tick(2000);
    }
    expect(r.snap()).toMatchObject({ lively: false, hover: false });
    expect(r.parts().mini.el.dataset.live).toBe('0');
    expect(r.brain.state.needs.fun).toBe(80);
  });

  it('a press counts as a visit at once', async () => {
    const r = mount();
    await tick(5000);
    pointer(r.parts().pill, 'pointerdown', { buttons: 1 });
    expect(r.snap().hover).toBe(true);
    click(r.parts().pill);
    expect(r.snap()).toMatchObject({ open: 'card', lively: true });
  });

  it('an open Card nobody is looking at goes still, and wakes when something happens', async () => {
    const r = mount();
    click(r.parts().pill);
    expect(r.parts().card.doozer.el.dataset.live).toBe('1');
    await tick(9000);
    expect(r.snap()).toMatchObject({ open: 'card', lively: false });
    expect(r.parts().card.doozer.el.dataset.live).toBe('0');
    r.brain.debug?.setNeeds({ tummy: 50 });
    r.brain.feed();
    expect(r.parts().card.doozer.el.dataset.live).toBe('1');
    await tick(500);
    expect(r.snap().stageBusy).toBe(true);
  });

  it('at rest it only blinks, in two redraws, and not while asleep', async () => {
    const r = mount();
    await tick(5000);
    const mini = r.parts().mini;
    const blink = vi.spyOn(mini, 'blink');
    await tick(60_000);
    expect(blink.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(blink.mock.calls.every((call) => call[0] === true)).toBe(true);
    r.brain.debug?.setNeeds({ energy: 50 });
    r.brain.sleep();
    await tick(12_000);
    blink.mockClear();
    await tick(60_000);
    expect(blink).not.toHaveBeenCalled();
  });

  it('a still blink shuts and opens the eyes with a timer, not an animation', async () => {
    const r = mount();
    const mini = r.parts().mini;
    mini.blink(true);
    expect(mini.el.dataset.blink).toBe('1');
    await tick(200);
    expect(mini.el.dataset.blink).toBe('0');
  });

  it('is quiet during a session: a mood change does not stir it', async () => {
    const r = mount();
    r.brain.startFocus();
    await tick(10_000);
    expect(r.snap().lively).toBe(false);
    r.brain.debug?.setNeeds({ tummy: 5 });
    expect(r.snap().lively).toBe(false);
    expect(r.snap().emotes).toBe(0);
    // Only Doozer's face says so; the pill stays a timer.
    expect(r.snap().statusTone).toBe('focus');
    expect(r.parts().mini.mood).toBe('hungry');
  });
});

describe('tucked away', () => {
  it('stops every clock, folds the Card and forgets the pointer', async () => {
    const r = mount();
    click(r.parts().pill);
    pointer(r.parts().pill, 'pointerdown', { buttons: 1 });
    r.brain.debug?.setNeeds({ tummy: 50 });
    r.brain.feed();
    r.view.setAwake?.(false);
    expect(r.snap()).toMatchObject({ awake: false, open: 'none', lively: false, pressed: false, hover: false, emotes: 0, timers: [] });
    expect(r.parts().mini.el.dataset.live).toBe('0');
    // Nothing wakes it while hidden.
    r.brain.feed();
    click(r.parts().pill);
    await tick(60_000);
    expect(r.snap()).toMatchObject({ open: 'none', lively: false, timers: [] });
  });

  it('comes back as it was, and blinks again', async () => {
    const r = mount();
    r.view.setAwake?.(false);
    r.view.setAwake?.(true);
    expect(r.snap()).toMatchObject({ awake: true, lively: true, timers: ['blink'] });
    click(r.parts().pill);
    expect(r.snap().open).toBe('card');
  });

  it('a session that ended while hidden is celebrated when Doozer is back', async () => {
    const r = mount({ setup: (brain) => brain.setSetting('onFocusEnd', 'open-card') });
    r.brain.startFocus();
    r.view.setAwake?.(false);
    r.brain.debug?.finishFocusNow();
    expect(r.snap()).toMatchObject({ open: 'none', lively: false });
    r.view.setAwake?.(true);
    expect(r.snap()).toMatchObject({ open: 'card', miniBusy: true });
    await tick(12_000);
    expect(r.snap().miniBusy).toBe(false);
  });
});

describe('first run', () => {
  it('Doozer hatches, shows its favourite snack, and then the sound question is asked', async () => {
    const r = mount({ needsWelcome: true });
    expect(r.snap()).toMatchObject({ hatching: true, status: 'is hatching', asking: false });
    expect((r.parts().pill.parentElement as HTMLElement).dataset.hatching).toBe('1');
    await tick(2500);
    // Out of the egg.
    expect((r.parts().pill.parentElement as HTMLElement).dataset.hatching).toBeUndefined();
    await tick(2600);
    expect(r.snap().status).toMatch(/^loves /);
    expect(r.host.calls).not.toContain('welcomed');
    await tick(3000);
    expect(r.snap()).toMatchObject({ hatching: false, status: 'is overjoyed', asking: true });
    expect(r.host.calls).toContain('welcomed');
    expect(r.view.hitRegions()).toHaveLength(3);
  });

  it('the hatching cannot last longer than its limit, whatever happens to its animations', async () => {
    const r = mount({ needsWelcome: true });
    // A performance that never settles (a window that draws no frames).
    vi.spyOn(r.parts().mini, 'perform').mockReturnValue(new Promise(() => undefined));
    await tick(12_000);
    expect(r.snap().hatching).toBe(false);
    expect((r.parts().pill.parentElement as HTMLElement).dataset.hatching).toBeUndefined();
    expect(r.host.calls).toContain('welcomed');
  });

  it('answering yes turns sound on, plays the chime, and is never asked again', async () => {
    const r = mount({ needsWelcome: true });
    await tick(12_000);
    const yes = [...r.parts().ask.querySelectorAll('button')].find((b) => b.textContent === 'Sounds on');
    if (yes) click(yes);
    expect(r.brain.settings).toMatchObject({ sound: true, soundAsked: true });
    expect(r.host.calls).toContain('chime');
    expect(r.snap().asking).toBe(false);
    expect(r.view.hitRegions()).toHaveLength(2);
  });

  it('answering no keeps it silent', async () => {
    const r = mount({ needsWelcome: true });
    await tick(12_000);
    const no = [...r.parts().ask.querySelectorAll('button')].find((b) => b.textContent === 'No thanks');
    if (no) click(no);
    expect(r.brain.settings).toMatchObject({ sound: false, soundAsked: true });
    expect(r.host.calls).not.toContain('chime');
    expect(r.snap().asking).toBe(false);
  });

  it('using the mute button instead answers the question too', async () => {
    const r = mount({ needsWelcome: true });
    await tick(12_000);
    click(r.parts().pill);
    expect(r.snap().asking).toBe(false);
    click(button(r, 'mute'));
    click(r.parts().pill);
    expect(r.brain.settings).toMatchObject({ sound: true, soundAsked: true });
    expect(r.snap().asking).toBe(false);
  });

  it('the question waits while the Card is open or a session runs, and comes back', async () => {
    const r = mount({ needsWelcome: true });
    await tick(12_000);
    click(r.parts().pill);
    expect(r.snap().asking).toBe(false);
    click(r.parts().pill);
    expect(r.snap().asking).toBe(true);
    r.brain.startFocus();
    expect(r.snap().asking).toBe(false);
    r.brain.stopFocus();
    expect(r.snap().asking).toBe(true);
  });

  it('a pet that has been welcomed does not hatch again, but is still asked about sound if it never answered', async () => {
    const r = mount({ setup: (brain) => brain.setSetting('soundAsked', false) });
    expect(r.snap()).toMatchObject({ hatching: false, asking: true });
  });

  it('tucked away in the middle of hatching, it hatches again when it is back', async () => {
    const r = mount({ needsWelcome: true });
    await tick(1500);
    r.view.setAwake?.(false);
    expect(r.snap()).toMatchObject({ hatching: false, timers: [] });
    expect(r.host.calls).not.toContain('welcomed');
    r.view.setAwake?.(true);
    expect(r.snap().hatching).toBe(true);
    await tick(12_000);
    expect(r.host.calls).toContain('welcomed');
  });
});

describe('coming back', () => {
  it('waves hello after time away', async () => {
    const earlier = createBrain({ now: () => START - 3 * HOUR, random: seeded(1) });
    earlier.setSetting('soundAsked', true);
    const r = mount({ save: earlier.serialize() });
    const perform = vi.spyOn(r.parts().mini, 'perform');
    r.brain.tick();
    expect(perform).toHaveBeenCalledWith('wave');
  });
});

describe('switching view', () => {
  it('pops out, and stays out only until it pops in', async () => {
    const r = mount();
    const leaving = r.view.leave?.();
    await tick(1000);
    await leaving;
    expect(r.snap().gone).toBe(true);
    void r.view.enter?.();
    expect(r.snap().gone).toBe(false);
  });

  it('if the pop-in never comes, Doozer comes back by itself', async () => {
    const r = mount();
    const leaving = r.view.leave?.();
    await tick(1000);
    await leaving;
    await tick(1500);
    expect(r.snap().gone).toBe(false);
  });
});

describe('unmounting', () => {
  it('releases everything: elements, listeners and every timer', async () => {
    const r = mount({ needsWelcome: true });
    click(r.parts().pill);
    r.brain.debug?.setNeeds({ tummy: 50 });
    r.brain.feed();
    pointer(r.parts().pill, 'pointerdown', { buttons: 1 });
    await tick(700);
    r.view.unmount();
    expect(r.root.childElementCount).toBe(0);
    expect(r.view.snapshot()).toBeNull();
    expect(r.view.hitRegions()).toEqual([]);
    expect(r.shell.listeners('pointer-released')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // The brain can carry on without anyone listening.
    r.brain.feed();
    r.brain.startFocus();
    r.brain.debug?.finishFocusNow();
    await tick(20_000);
    expect(r.host.calls).not.toContain('welcomed');
  });

  it('can be mounted again afterwards', async () => {
    const r = mount();
    r.view.unmount();
    void r.view.mount(r.root, { brain: r.brain, shell: r.shell.shell, host: r.host.services, info: INFO });
    click(r.parts().pill);
    expect(r.snap().open).toBe('card');
  });
});
