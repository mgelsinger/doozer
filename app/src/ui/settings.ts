// The settings panel: one row for every row of DESIGN_SPEC.md section 9, plus the hat
// (the contract's `settings.hat`). It reads and writes `brain.settings` and nothing else;
// what a setting *does* (docking the pill, starting with Windows) is the host's business.

import './kit.css';
import type { Brain, HatId, PaletteId, Settings, SizeId, ViewId } from '../core/contract';
import { PALETTES, PALETTE_IDS } from '../character/palettes';
import { h, need } from './dom';
import { ICONS, ITEM_NAME } from './icons';
import { Scope } from './lifecycle';
import { watchReduceMotion } from './motion';
import { attachTooltips } from './tooltip';

export interface SettingsPanelOptions {
  /** The close button or Escape was pressed. */
  onClose?(): void;
  /** "Quit Doozer" was pressed. Omit to hide the button. */
  onQuit?(): void;
  /** Which view's size the Size row edits. Default: `brain.settings.lastView`. */
  currentView?(): ViewId;
  /** Start open. Default true. */
  open?: boolean;
}

export interface SettingsPanel {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  focus(): void;
  destroy(): void;
}

interface Choice<T> { value: T; label: string; disabled?: boolean; tip?: string; icon?: string }

const VIEW_NAME: Record<ViewId, string> = { pill: 'Pill', room: 'Room', island: 'Island', desktop: 'Desktop' };
const HAT_AT: Record<HatId, number> = { nightcap: 15, bow: 60 };

export function createSettingsPanel(brain: Brain, options: SettingsPanelOptions = {}): SettingsPanel {
  const scope = new Scope();
  const repaint: (() => void)[] = [];
  const rows = h('div', { class: 'dzk-rows' });
  const closeButton = h('button', { type: 'button', class: 'dzk-icon-btn', 'aria-label': 'Close settings', html: ICONS.close });
  const foot = h('div', { class: 'dzk-settings-foot' }, [h('small', { text: 'Changes are saved as you make them.' })]);
  const el = h('section', { class: 'dzk dzk-settings', 'aria-label': 'Settings', 'data-open': '1' }, [
    h('div', { class: 'dzk-settings-head' }, [h('h2', { text: 'Settings' }), closeButton]),
    rows,
    foot,
  ]);

  const on = (target: EventTarget, type: string, handler: (event: Event) => void) => {
    target.addEventListener(type, handler);
    scope.add(() => target.removeEventListener(type, handler));
  };
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => brain.setSetting(key, value);

  function row(label: string, control: HTMLElement, note = '', stacked = false): HTMLElement {
    const text = h('div', { class: 'dzk-row-label' }, [label, note ? h('small', { text: note }) : null]);
    const node = h('div', { class: 'dzk-row', 'data-stack': stacked ? '1' : '0' }, [text, control]);
    rows.append(node);
    return node;
  }

  /** A radio group drawn as a segmented control. Arrow keys move the choice. */
  function segmented<T extends string>(
    name: string, choices: () => readonly Choice<T>[], current: () => T, change: (value: T) => void, wrap = false,
  ): HTMLElement {
    const group = h('div', { class: 'dzk-seg', role: 'radiogroup', 'aria-label': name, 'data-wrap': wrap ? '1' : '0' });
    const render = () => {
      const value = current();
      const hadFocus = group.contains(document.activeElement);
      group.replaceChildren(...choices().map((choice) => {
        const checked = choice.value === value;
        return h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(checked), 'data-value': choice.value,
          tabindex: checked ? 0 : -1, disabled: choice.disabled === true, 'data-tip': choice.tip,
          html: `${choice.icon ?? ''}<span>${choice.label}</span>`,
        });
      }));
      if (hadFocus) group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    };
    on(group, 'click', (event) => {
      const target = (event.target as Element).closest<HTMLButtonElement>('button[data-value]');
      if (target && !target.disabled) change(target.dataset.value as T);
    });
    on(group, 'keydown', (raw) => {
      const event = raw as KeyboardEvent;
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const enabled = choices().filter((choice) => !choice.disabled);
      const at = enabled.findIndex((choice) => choice.value === current());
      const next = enabled[(at + step + enabled.length) % enabled.length];
      if (next) change(next.value);
    });
    repaint.push(render);
    return group;
  }

  /** An on/off switch. The word beside it says the state, so it is not colour alone. */
  function toggle(name: string, current: () => boolean, change: (value: boolean) => void): HTMLElement {
    const word = h('span', { class: 'dzk-switch-word' });
    const control = h('button', { type: 'button', class: 'dzk-switch', role: 'switch', 'aria-label': name }, [word, h('span', { class: 'dzk-switch-track' })]);
    on(control, 'click', () => change(!current()));
    repaint.push(() => {
      control.setAttribute('aria-checked', String(current()));
      word.textContent = current() ? 'On' : 'Off';
    });
    return control;
  }

  const view = () => options.currentView?.() ?? brain.settings.lastView;

  // ---- Colour -----------------------------------------------------------------------
  const swatches = h('div', { class: 'dzk-swatches', role: 'radiogroup', 'aria-label': 'Colour' });
  for (const id of PALETTE_IDS) {
    const swatch = h('button', {
      type: 'button', class: 'dzk-swatch', role: 'radio', 'data-value': id, 'aria-label': PALETTES[id].name,
      'data-tip': PALETTES[id].name, html: ICONS.check,
    });
    swatch.style.setProperty('--swatch', PALETTES[id].body);
    swatches.append(swatch);
  }
  on(swatches, 'click', (event) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-value]');
    if (target) set('palette', target.dataset.value as PaletteId);
  });
  on(swatches, 'keydown', (raw) => {
    const event = raw as KeyboardEvent;
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = PALETTE_IDS.indexOf(brain.settings.palette);
    const next = PALETTE_IDS[(at + step + PALETTE_IDS.length) % PALETTE_IDS.length];
    if (!next) return;
    set('palette', next);
    swatches.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
  });
  const colourRow = row('Colour', swatches);
  repaint.push(() => {
    for (const swatch of swatches.querySelectorAll<HTMLElement>('[data-value]')) {
      const checked = swatch.dataset.value === brain.settings.palette;
      swatch.setAttribute('aria-checked', String(checked));
      swatch.tabIndex = checked ? 0 : -1;
    }
    const label = need(colourRow, '.dzk-row-label');
    label.replaceChildren('Colour', h('small', { text: PALETTES[brain.settings.palette].name }));
  });

  // ---- Hat (unlocked by focusing) -----------------------------------------------------
  row('Hat', segmented<HatId | 'none'>('Hat', () => {
    const unlocked = brain.state.unlocked;
    const hat = (id: HatId, label: string): Choice<HatId | 'none'> => {
      const has = unlocked.includes(id);
      return {
        value: id, label, disabled: !has, icon: has ? '' : ICONS.lock,
        tip: has ? `Wear the ${ITEM_NAME[id]}` : `Unlocks after ${HAT_AT[id]} focus sessions`,
      };
    };
    return [{ value: 'none', label: 'None' }, hat('nightcap', 'Nightcap'), hat('bow', 'Bow')];
  }, () => brain.settings.hat ?? 'none', (value) => set('hat', value === 'none' ? null : value)), '', true);

  // ---- Size (per view) ----------------------------------------------------------------
  const sizeRow = row('Size', segmented<SizeId>('Size', () => [
    { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' },
  ], () => brain.settings.size[view()], (value) => set('size', { ...brain.settings.size, [view()]: value })), '', true);
  repaint.push(() => {
    need(sizeRow, '.dzk-row-label').replaceChildren('Size', h('small', { text: `in the ${VIEW_NAME[view()]}` }));
  });

  // ---- Pill position ------------------------------------------------------------------
  row('Pill position', segmented<Settings['pillDock']>('Pill position', () => [
    { value: 'top-left', label: 'Top left' }, { value: 'top-center', label: 'Top centre' },
    { value: 'top-right', label: 'Top right' }, { value: 'bottom-right', label: 'Bottom right' },
  ], () => brain.settings.pillDock, (value) => set('pillDock', value), true), '', true);

  // ---- Desktop activity ---------------------------------------------------------------
  row('Desktop activity', segmented<Settings['desktopActivity']>('Desktop activity', () => [
    { value: 'still', label: 'Still', tip: 'Never moves on its own' },
    { value: 'calm', label: 'Calm', tip: 'A short stroll now and then' },
    { value: 'lively', label: 'Lively', tip: 'More strolls, and it chases the ball' },
  ], () => brain.settings.desktopActivity, (value) => set('desktopActivity', value)), '', true);

  // ---- Sound --------------------------------------------------------------------------
  row('Sound', toggle('Sound', () => brain.settings.sound, (value) => set('sound', value)));

  // ---- When a focus session ends ------------------------------------------------------
  row('When a focus session ends', segmented<Settings['onFocusEnd']>('When a focus session ends', () => [
    { value: 'quiet', label: 'Celebrate quietly' }, { value: 'open-card', label: 'Open the Card' },
  ], () => brain.settings.onFocusEnd, (value) => set('onFocusEnd', value)), '', true);

  // ---- Window behaviour ---------------------------------------------------------------
  row('Always on top', toggle('Always on top', () => brain.settings.alwaysOnTop, (value) => set('alwaysOnTop', value)));
  row('Tuck away during fullscreen apps', toggle('Tuck away during fullscreen apps', () => brain.settings.tuckAwayInFullscreen, (value) => set('tuckAwayInFullscreen', value)));
  row('Start with Windows', toggle('Start with Windows', () => brain.settings.startWithWindows, (value) => set('startWithWindows', value)));

  // ---- Interface size -----------------------------------------------------------------
  row('Interface size', segmented<Settings['uiScale']>('Interface size', () => [
    { value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }, { value: 'larger', label: 'Larger' },
  ], () => brain.settings.uiScale, (value) => set('uiScale', value)), '', true);

  // ---- Frame rate (src/frames.ts) -----------------------------------------------------
  const always = (fps: string, more: string): string => `${fps} pictures a second all the time, or as many as your screen shows. ${more}`;
  row('Frame rate', segmented<Settings['frameRate']>('Frame rate', () => [
    { value: 'light', label: 'Light', tip: '24 pictures a second on its own, 60 while you are with it. Lightest on your PC' },
    { value: '30', label: '30', tip: '30 pictures a second on its own, 60 while you are with it' },
    { value: '60', label: '60', tip: always('60', 'Uses more of your PC') },
    { value: '120', label: '120', tip: always('120', 'Uses a lot more of your PC') },
    { value: '144', label: '144', tip: always('144', 'Uses a lot more of your PC') },
  ], () => brain.settings.frameRate, (value) => set('frameRate', value)), 'Smoother uses more of your PC', true);

  // ---- Reduce motion ------------------------------------------------------------------
  row('Reduce motion', segmented<Settings['reduceMotion']>('Reduce motion', () => [
    { value: 'system', label: 'Follow system' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' },
  ], () => brain.settings.reduceMotion, (value) => set('reduceMotion', value)), '', true);

  if (options.onQuit) {
    const quit = h('button', { type: 'button', class: 'dzk-link', text: 'Quit Doozer' });
    on(quit, 'click', () => options.onQuit?.());
    foot.append(quit);
  }

  const paint = () => { for (const fn of repaint) fn(); };

  let isOpen = options.open ?? true;
  const applyOpen = () => {
    el.dataset.open = isOpen ? '1' : '0';
    el.inert = !isOpen;
    if (isOpen) paint();
  };

  const api: SettingsPanel = {
    el,
    get isOpen() { return isOpen; },
    open() { if (scope.disposed || isOpen) return; isOpen = true; applyOpen(); },
    close() { if (scope.disposed || !isOpen) return; isOpen = false; applyOpen(); },
    focus() { if (isOpen) closeButton.focus(); },
    destroy() { scope.dispose(); el.remove(); },
  };

  on(closeButton, 'click', () => options.onClose?.());
  on(el, 'keydown', (raw) => {
    const event = raw as KeyboardEvent;
    if (event.key === 'Escape' && isOpen) { event.stopPropagation(); options.onClose?.(); }
  });
  scope.add(brain.on('settings', () => { if (isOpen) paint(); }));
  // Unlocks arrive through state, and decide which hats can be chosen.
  let unlockedCount = brain.state.unlocked.length;
  scope.add(brain.on('change', () => {
    if (brain.state.unlocked.length !== unlockedCount) { unlockedCount = brain.state.unlocked.length; if (isOpen) paint(); }
  }));
  scope.add(watchReduceMotion(brain, (reduce) => { el.dataset.motion = reduce ? 'reduce' : 'full'; }));
  scope.add(attachTooltips(el));
  applyOpen();

  return api;
}
