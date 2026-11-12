// Development viewer, part 2: the UI kit against the fake brain. The Card and the Radial
// in every state, the settings panel, the smaller pieces, and a "never stuck" bench for
// exercising interruptions and rapid clicks by hand.

import { createBrain } from '../../core';
import type { Brain, NeedKey, ViewId } from '../../core/contract';
import { createDoozer, type Doozer } from '../../character';
import {
  StageDirector, createCard, createEmoteLayer, createFocusChip, createNeedMeters, createRadial, createSettingsPanel,
  type Card, type EmoteKind, type Radial, type RadialOptions, type StageFx,
} from '../index';
import { createFakeBrain, type FakeBrainPreset } from './fake-brain';
import { el, section, type ViewerControls } from './viewer-rig';

type Cleanup = () => void;

/** The states the plan asks to see (WORK_PLAN.md section 8, task 5). */
export const STATES: readonly { id: string; title: string; preset: FakeBrainPreset }[] = [
  { id: 'normal', title: 'Normal', preset: { treats: 5, bowl: 2, sessionsCompleted: 4, streak: { current: 3, best: 7 } } },
  { id: 'asleep', title: 'Asleep', preset: { asleep: true, needs: { energy: 34 }, treats: 3, bowl: 1, sessionsCompleted: 16, streak: { current: 5, best: 9 } } },
  { id: 'focusing', title: 'Focusing', preset: { treats: 4, bowl: 2, sessionsCompleted: 7, streak: { current: 2, best: 4 }, focus: { status: 'running', minutes: 25, elapsedMs: 9 * 60_000 } } },
  { id: 'paused', title: 'Paused', preset: { treats: 4, bowl: 1, sessionsCompleted: 2, streak: { current: 1, best: 4 }, focus: { status: 'paused', minutes: 50, elapsedMs: 31 * 60_000 } } },
  { id: 'no-treats', title: 'No treats', preset: { treats: 0, bowl: 1, sessionsCompleted: 0 } },
  { id: 'bowl-full', title: 'Bowl full', preset: { treats: 2, bowl: 3, needs: { tummy: 96 }, sessionsCompleted: 11, streak: { current: 1, best: 2 } } },
  { id: 'urgent', title: 'A need urgent', preset: { treats: 1, bowl: 0, needs: { tummy: 8, fun: 24, clean: 44, energy: 51 }, sessionsCompleted: 3 } },
];

function log(line: string): void {
  console.info(`[viewer] ${line}`);
}

/** A Doozer with an emote layer that reacts to a brain: what a view would build around the Radial. */
function miniStage(
  brain: Brain, controls: ViewerControls, size = 112, radialOptions: RadialOptions = { idleCloseMs: null },
): { root: HTMLElement; doozer: Doozer; radial: Radial; destroy: Cleanup } {
  const doozer = createDoozer({ palette: controls.palette, style: controls.style, size, reduceMotion: controls.reduceMotion });
  const emotes = createEmoteLayer({ origin: { x: 0.5, y: 0.3, spreadX: 0.22, spreadY: 0.1 } });
  emotes.setReduceMotion(controls.reduceMotion);
  const fx: StageFx = {
    emote: (kind, options) => emotes.emit(kind, options),
    prop: () => ({ bite() {}, remove() {} }),   // a view draws its own props; none here
  };
  const director = new StageDirector(brain, doozer, fx);
  const radial = createRadial(brain, { onMore: () => log('Radial: More (open the Card)'), ...radialOptions });
  const pet = el('button', { class: 'vw-pet', type: 'button', title: 'Click Doozer: poke + Radial' }, [doozer.el, emotes.el]);
  pet.setAttribute('data-radial-toggle', '');
  pet.setAttribute('aria-label', 'Doozer: open the menu');
  pet.addEventListener('click', (event) => {
    doozer.squish(0.8);
    if (radial.isOpen) radial.close();
    else radial.open({ focus: event.detail === 0 });   // detail 0 = activated from the keyboard
  });
  radial.el.style.left = '50%';
  radial.el.style.top = '52%';
  pet.append(radial.el);
  const root = el('div', { class: 'vw-radial-stage vw-bg' }, [pet]);
  return {
    root, doozer, radial,
    destroy() { director.destroy(); radial.destroy(); emotes.destroy(); doozer.destroy(); },
  };
}

export function mountKit(host: HTMLElement, controls: ViewerControls): Cleanup {
  const cleanups: Cleanup[] = [];
  const brains: Brain[] = [];
  const roots: HTMLElement[] = [];
  const brainFor = (preset: FakeBrainPreset): Brain => {
    const brain = createFakeBrain({ preset: { ...preset, settings: { palette: controls.palette, reduceMotion: controls.reduceMotion ? 'on' : 'off', ...preset.settings } } });
    brains.push(brain);
    return brain;
  };
  const ticker = setInterval(() => { for (const brain of brains) brain.tick(); }, 250);
  cleanups.push(() => clearInterval(ticker));

  // ---- Card in every state -------------------------------------------------------------
  const cards = section('card', 'The Card',
    'One live Card per state, each on its own fake brain. Everything is clickable; “Reset” puts the state back. Stroke or click Doozer to pet it.');
  const speed = el('select');
  for (const [value, text] of [['1', 'Real time'], ['60', '1 s = 1 min'], ['600', '1 s = 10 min']] as const) speed.append(el('option', { value, textContent: text }));
  speed.addEventListener('change', () => { for (const brain of brains) brain.debug?.setTimeScale(Number(speed.value)); });
  const resetAll = el('button', { type: 'button', textContent: 'Reset every state' });
  resetAll.addEventListener('click', () => { for (const brain of brains) brain.debug?.reset(); });
  cards.body.append(el('div', { class: 'vw-tools' }, [el('label', {}, ['Pet time ', speed]), resetAll]));
  const cardGrid = el('div', { class: 'vw-kit' });
  for (const state of STATES) {
    const brain = brainFor(state.preset);
    const card = createCard(brain, {
      lineStyle: controls.style,
      unavailableViews: state.id === 'no-treats' ? ['island', 'desktop'] : [],
      onSwitchView: (view: ViewId) => { log(`Card (${state.title}): switch to ${view}`); brain.setSetting('lastView', view); },
      onOpenSettings: () => log(`Card (${state.title}): open settings`),
    });
    cleanups.push(() => card.destroy());
    const finish = el('button', { type: 'button', textContent: 'Finish session', title: 'debug.finishFocusNow()' });
    finish.addEventListener('click', () => brain.debug?.finishFocusNow());
    const reset = el('button', { type: 'button', textContent: 'Reset' });
    reset.addEventListener('click', () => brain.debug?.reset());
    const toggle = el('button', { type: 'button', textContent: 'Open / close' });
    toggle.addEventListener('click', () => card.toggle());
    cardGrid.append(el('div', { class: 'vw-state', id: `card-${state.id}` }, [
      el('h3', {}, [state.title]), card.el, el('div', { class: 'vw-tools' }, [toggle, finish, reset]),
    ]));
  }
  cards.body.append(cardGrid);
  host.append(cards.root);
  roots.push(cards.root);

  // ---- Radial in every state -----------------------------------------------------------
  const radials = section('radial', 'The Radial',
    'Six buttons on an arc; the four need buttons carry a ring for that need. Click Doozer to open or close. Here the idle auto-close is off so every state stays visible; the bench below uses the real timing.');
  const radialGrid = el('div', { class: 'vw-kit' });
  for (const state of STATES) {
    const brain = brainFor(state.preset);
    const stage = miniStage(brain, controls);
    cleanups.push(stage.destroy);
    stage.radial.open();
    radialGrid.append(el('div', { class: 'vw-state', id: `radial-${state.id}` }, [el('h3', {}, [state.title]), stage.root]));
  }
  // Edge placements: the arc can be re-aimed when Doozer is against a screen edge.
  for (const [title, center, span] of [['Arc aimed right (left screen edge)', -45, 150], ['Small Doozer, tight arc', -90, 200]] as const) {
    const brain = brainFor(STATES[0]?.preset ?? {});
    const stage = miniStage(brain, controls, title.startsWith('Small') ? 72 : 112);
    cleanups.push(stage.destroy);
    stage.radial.setArc(center, span);
    if (title.startsWith('Small')) { stage.radial.el.style.setProperty('--dzk-radial-r', '72px'); stage.radial.el.style.setProperty('--dzk-radial-b', '40px'); }
    stage.radial.open();
    radialGrid.append(el('div', { class: 'vw-state' }, [el('h3', {}, [title]), stage.root]));
  }
  radials.body.append(radialGrid);
  host.append(radials.root);
  roots.push(radials.root);

  // ---- Settings ------------------------------------------------------------------------
  const settings = section('settings', 'Settings',
    'Every row of spec section 9, plus the hat. The panel and the Card beside it share one brain: change the colour and the Card follows. The Card’s Settings button and the panel’s close button swap the two, as a view would.');
  {
    const brain = brainFor({ treats: 6, bowl: 2, sessionsCompleted: 61, streak: { current: 4, best: 12 } });
    const order = el('div', { class: 'vw-kit' });
    let current: ViewId = 'pill';
    const panel = createSettingsPanel(brain, {
      currentView: () => current,
      onClose: () => { log('Settings: close'); panel.close(); card.open(); },
      onQuit: () => log('Settings: quit'),
    });
    const card: Card = createCard(brain, {
      lineStyle: controls.style,
      currentView: () => current,
      onSwitchView: (view) => { current = view; brain.setSetting('lastView', view); },
      onOpenSettings: () => { card.close(); panel.open(); panel.focus(); },
    });
    cleanups.push(() => { panel.destroy(); card.destroy(); });
    const dump = el('pre', { class: 'vw-log' });
    const show = () => { dump.textContent = JSON.stringify(brain.settings, null, 1); };
    cleanups.push(brain.on('settings', show));
    show();
    order.append(
      el('div', { class: 'vw-state' }, [el('h3', {}, ['Settings panel']), panel.el]),
      el('div', { class: 'vw-state' }, [el('h3', {}, ['Card on the same brain']), card.el]),
      el('div', { class: 'vw-state' }, [el('h3', {}, ['brain.settings']), dump]),
    );
    settings.body.append(order);
  }
  host.append(settings.root);
  roots.push(settings.root);

  // ---- Pieces: meters, emotes, focus chip ---------------------------------------------
  const pieces = section('pieces', 'Meters, emotes, tooltips, focus chip',
    'Drag a slider to move a need through its levels: the bar length, the colour and the “!” flag all change (urgent is striped too), so colour is never the only signal. Hover or Tab to anything for its tooltip.');
  {
    const brain = brainFor({ needs: { tummy: 82, fun: 48, energy: 22, clean: 7 }, focus: { status: 'running', minutes: 15, elapsedMs: 4 * 60_000 } });
    const meters = createNeedMeters(brain, { layout: 'strip' });
    const strip = el('div', { class: 'dzk' }, [meters.el]);
    strip.style.cssText = 'width: 360px; padding: 12px 14px; border-radius: 16px; background: #221b2a; position: relative;';
    const sliders = el('div', { class: 'vw-tools' });
    for (const key of ['tummy', 'fun', 'energy', 'clean'] as NeedKey[]) {
      const input = el('input', { type: 'range', min: '0', max: '100', value: String(brain.state.needs[key]) });
      input.addEventListener('input', () => brain.debug?.setNeeds({ [key]: Number(input.value) }));
      sliders.append(el('label', {}, [key, input]));
    }
    const chip = createFocusChip(brain);
    cleanups.push(() => { meters.destroy(); chip.destroy(); });

    const doozer = createDoozer({ palette: controls.palette, style: controls.style, size: 112, reduceMotion: controls.reduceMotion });
    const emotes = createEmoteLayer({ origin: { x: 0.5, y: 0.3, spreadX: 0.22, spreadY: 0.1 } });
    emotes.setReduceMotion(controls.reduceMotion);
    const emoteStage = el('div', { class: 'vw-radial-stage vw-bg' }, [el('div', { class: 'vw-pet' }, [doozer.el, emotes.el])]);
    emoteStage.style.height = '190px';
    const emoteTools = el('div', { class: 'vw-tools' });
    const KINDS: readonly [EmoteKind, string][] = [['heart', 'heart'], ['sparkle', 'sparkle'], ['z', 'z'], ['snack', 'snack'], ['question', '? (refusal)'], ['bubble', 'soap bubbles']];
    const SNACKS = ['apple', 'bread', 'carrot', 'biscuit', 'cookie', 'donut', 'strawberry', 'onigiri'] as const;
    let snack = 0;
    for (const [kind, label] of KINDS) {
      const b = el('button', { type: 'button', textContent: label });
      b.addEventListener('click', () => emotes.emit(kind, { count: kind === 'bubble' ? 6 : kind === 'sparkle' ? 4 : kind === 'heart' ? 3 : 1, icon: SNACKS[snack++ % SNACKS.length] }));
      emoteTools.append(b);
    }
    const count = el('span', { class: 'vw-cap' });
    const counter = setInterval(() => { count.textContent = `${emotes.count} on screen`; }, 200);
    cleanups.push(() => { clearInterval(counter); emotes.destroy(); doozer.destroy(); });
    emoteTools.append(count);

    pieces.body.append(el('div', { class: 'vw-kit' }, [
      el('div', { class: 'vw-state' }, [el('h3', {}, ['Need meters (strip layout)']), strip, sliders]),
      el('div', { class: 'vw-state' }, [el('h3', {}, ['Focus chip']), el('div', { class: 'vw-bg' }, [chip.el])]),
      el('div', { class: 'vw-state' }, [el('h3', {}, ['Emotes']), emoteStage, emoteTools]),
    ]));
  }
  host.append(pieces.root);
  roots.push(pieces.root);

  // ---- The "never stuck" bench ---------------------------------------------------------
  const bench = section('bench', 'Never stuck — the bench',
    'One brain, one Card, one Radial with its real idle timing. The buttons hammer them the way an impatient hand would. A few seconds after any of them, the status line must read “settled”: the face is the mood face, no scene, no props, no emotes, and the menu is closed unless you opened it.');
  {
    // `?brain=real` runs the bench on the real brain (app/src/core) instead of the fake one.
    const useReal = new URLSearchParams(location.search).get('brain') === 'real';
    let brain: Brain;
    if (useReal) {
      brain = createBrain({ debug: true });
      brain.setSetting('palette', controls.palette);
      brain.setSetting('reduceMotion', controls.reduceMotion ? 'on' : 'off');
      brain.debug?.setNeeds({ tummy: 40, fun: 40, energy: 60, clean: 50 });
      brain.debug?.addTreats(7);
      brains.push(brain);
    } else {
      brain = brainFor({ treats: 9, bowl: 1, needs: { tummy: 40, fun: 40, energy: 60, clean: 50 }, sessionsCompleted: 2 });
    }
    bench.body.append(el('p', {}, [
      useReal ? 'Running on the REAL brain (app/src/core). ' : 'Running on the fake brain. ',
      el('a', { href: useReal ? '?only=kit#bench' : '?only=kit&brain=real#bench', textContent: useReal ? 'Switch to the fake brain' : 'Switch to the real brain' }),
    ]));
    const card = createCard(brain, { lineStyle: controls.style, onOpenSettings: () => log('bench: settings') });
    // Real timing here: this Radial closes by itself after a while.
    const stage = miniStage(brain, controls, 112, { onMore: () => { log('bench: More'); card.open(); } });
    const radial = stage.radial;
    cleanups.push(() => { card.destroy(); stage.destroy(); });

    const status = el('pre', { class: 'vw-log', id: 'bench-status' });
    const paint = () => {
      const props = card.el.querySelectorAll('.dzk-prop').length;
      const emotes = card.el.querySelectorAll('.dzk-emote').length + stage.root.querySelectorAll('.dzk-emote').length;
      const faceOk = card.doozer.showing === card.doozer.mood && stage.doozer.showing === stage.doozer.mood;
      const settled = faceOk && !card.doozer.busy && !stage.doozer.busy && props === 0 && emotes === 0;
      status.textContent =
        `${settled ? 'settled' : 'busy   '}  mood=${brain.state.mood}  card face=${card.doozer.showing} pose=${card.doozer.pose}` +
        `  stage face=${stage.doozer.showing}  props=${props}  emotes=${emotes}  radial=${radial.isOpen ? 'open' : 'closed'}  card=${card.isOpen ? 'open' : 'closed'}` +
        `\nneeds ${Object.entries(brain.state.needs).map(([k, v]) => `${k} ${Math.round(v)}`).join('  ')}  asleep=${brain.state.asleep}  focus=${brain.state.focus.status}  treats=${brain.state.treats}  bowl=${brain.state.bowl}`;
      status.dataset.settled = settled ? '1' : '0';
    };
    const painter = setInterval(paint, 200);
    cleanups.push(() => clearInterval(painter));
    paint();

    const burst = (times: number, gapMs: number, fn: (i: number) => void) => {
      for (let i = 0; i < times; i++) setTimeout(() => fn(i), i * gapMs);
    };
    const tools = el('div', { class: 'vw-tools' });
    const tool = (label: string, run: () => void) => {
      const b = el('button', { type: 'button', textContent: label });
      b.addEventListener('click', run);
      tools.append(b);
    };
    tool('Feed ×10 fast', () => burst(10, 40, () => brain.feed()));
    tool('Pet ×25 fast', () => burst(25, 30, () => brain.pet()));
    tool('Every action, interleaved', () => burst(24, 70, (i) => [() => brain.feed(), () => brain.play(), () => brain.wash(), () => brain.giveTreat(), () => brain.pet(), () => brain.fillBowl()][i % 6]?.()));
    tool('Toggle Card ×11', () => burst(11, 60, () => card.toggle()));
    tool('Toggle Radial ×11', () => burst(11, 60, () => radial.toggle()));
    tool('Open Radial, then Doozer falls asleep', () => { radial.open(); setTimeout(() => brain.debug?.setNeeds({ energy: 3 }), 600); setTimeout(() => brain.tick(), 700); });
    tool('Sleep in the middle of eating', () => { brain.wake(); brain.debug?.setNeeds({ tummy: 30, energy: 50 }); brain.feed(); setTimeout(() => brain.sleep(), 500); });
    tool('Refuse ×8 (treat with empty jar)', () => { brain.debug?.addTreats(-99); burst(8, 80, () => brain.giveTreat()); });
    tool('Flash storm on the rig', () => burst(30, 35, (i) => { const d = card.doozer; if (i % 3 === 0) void d.perform('celebrate'); else if (i % 3 === 1) d.flash('wow', 300); else void d.perform('yawn'); }));
    tool('Start, pause, resume, finish focus', () => { brain.wake(); brain.startFocus(); setTimeout(() => brain.pauseFocus(), 400); setTimeout(() => brain.resumeFocus(), 800); setTimeout(() => brain.debug?.finishFocusNow(), 1400); });
    tool('Wake + restore', () => { brain.debug?.reset(); card.open(); });
    bench.body.append(tools, el('div', { class: 'vw-kit' }, [
      el('div', { class: 'vw-state' }, [el('h3', {}, ['Card']), card.el]),
      el('div', { class: 'vw-state' }, [el('h3', {}, ['Doozer + Radial (click Doozer)']), stage.root]),
    ]), status);
  }
  host.append(bench.root);
  roots.push(bench.root);

  return () => {
    for (const fn of cleanups) fn();
    for (const root of roots) root.remove();
  };
}
