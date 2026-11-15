// Development viewer: everything Phase 5 built, on one page, so it can be judged by eye.
// Served by `npm run dev` at /viewer.html. Nothing here ships in the app.

import './viewer.css';
import type { PaletteId } from '../../core/contract';
import { PALETTES, PALETTE_IDS, type LineStyle } from '../../character';
import { AMBIENT_FPS, ATTENDED_FPS, frames } from '../../frames';
import { SOUNDS, SOUND_NAMES, createSound, soundSeconds, type SoundName } from '../../host/sound';
import { mountKit } from './viewer-kit';
import { el, mountRig, section, type ViewerControls } from './viewer-rig';

const host = document.getElementById('viewer');
if (!host) throw new Error('missing #viewer');

const params = new URLSearchParams(location.search);
const controls: ViewerControls = {
  palette: (PALETTE_IDS as readonly string[]).includes(params.get('palette') ?? '') ? (params.get('palette') as PaletteId) : 'peach',
  style: params.get('style') === 'soft' ? 'soft' : 'bold',
  size: Number(params.get('size')) || 62,
  reduceMotion: params.get('motion') === 'reduce',
  live: params.get('live') !== '0',
  matrix: params.get('matrix') === 'one' ? 'one' : 'all',
};
document.body.dataset.bg = params.get('bg') ?? 'paper';

function select<T extends string>(label: string, values: readonly (readonly [T, string])[], current: T, onChange: (value: T) => void): HTMLElement {
  const input = el('select');
  for (const [value, text] of values) input.append(el('option', { value, textContent: text, selected: value === current }));
  input.addEventListener('change', () => onChange(input.value as T));
  return el('label', {}, [label, input]);
}

// ---- How often the page is drawn (src/frames.ts) --------------------------------------------
// The app draws everything that moves 24 times a second with nobody there and 60 while the
// pointer is on Doozer. Here any of those can be held, or the cap taken off, to compare by eye.
type Pace = 'screen' | 'app' | '24' | '30' | '60';
let detachFrames: (() => void) | null = null;
function setPace(pace: Pace): void {
  detachFrames?.();
  detachFrames = null;
  if (pace === 'screen') return;
  frames.setRates(pace === 'app' ? { ambient: AMBIENT_FPS, attended: ATTENDED_FPS } : { ambient: Number(pace), attended: Number(pace) });
  detachFrames = frames.attach(document);
}
const paceNow = ((): Pace => {
  const asked = params.get('fps');
  return asked === 'app' || asked === '24' || asked === '30' || asked === '60' ? asked : 'screen';
})();
setPace(paceNow);

// ---- The sounds (src/host/sound.ts) ----------------------------------------------------------
const WHEN: Readonly<Record<SoundName, string>> = {
  chime: 'a focus session is finished', sparkle: 'something was unlocked (after the chime)', begin: 'a focus session starts',
  munch: 'fed', yum: 'given a treat', kibble: 'the bowl is filled', boing: 'play', bubbles: 'a wash', chirp: 'petted',
  lullaby: 'tucked in', morning: 'woken', hm: 'a refusal', pop: 'moving to another view',
};
function mountSounds(into: HTMLElement): () => void {
  const sound = createSound(() => true);
  const part = section('sounds', 'Sounds',
    'The whole set, synthesised in the page: one small instrument, one five-note scale. Off by default in the app. Click to hear one; "All, in turn" plays them a second and a half apart.');
  const grid = el('div', { class: 'vw-tools' });
  for (const name of SOUND_NAMES) {
    const button = el('button', { type: 'button', textContent: name, title: `${WHEN[name]} · ${SOUNDS[name].length} note${SOUNDS[name].length === 1 ? '' : 's'}, ${soundSeconds(name).toFixed(2)} s` });
    button.addEventListener('click', () => sound.play(name));
    grid.append(button);
  }
  let queue: ReturnType<typeof setTimeout>[] = [];
  const all = el('button', { type: 'button', textContent: 'All, in turn' });
  all.addEventListener('click', () => {
    for (const timer of queue) clearTimeout(timer);
    queue = SOUND_NAMES.map((name, i) => setTimeout(() => sound.play(name), i * 1500));
  });
  grid.append(all);
  const list = el('ul', {}, SOUND_NAMES.map((name) => el('li', {}, [`${name}: ${WHEN[name]}`])));
  part.body.append(grid, list);
  into.append(part.root);
  return () => { for (const timer of queue) clearTimeout(timer); sound.dispose(); part.root.remove(); };
}

const content = el('div');
let unmount: (() => void) | null = null;
const only = params.get('only');   // 'rig', 'kit' or '3d': render part of the page (quicker to reload)

/** The 3D Doozer beside the 2D rig (Phase 8). three.js is only loaded if this part is shown. */
function mount3DLater(host: HTMLElement): () => void {
  let cleanup: (() => void) | null = null;
  let cancelled = false;
  void import('./viewer-3d').then(({ mount3D }) => {
    if (!cancelled) cleanup = mount3D(host, controls);
  });
  return () => { cancelled = true; cleanup?.(); };
}

function render(): void {
  unmount?.();
  const parts: (() => void)[] = [];
  if (only !== 'kit' && only !== '3d') parts.push(mountRig(content, controls));
  if (only !== 'rig' && only !== '3d') parts.push(mountKit(content, controls));
  if (only !== 'rig' && only !== 'kit') parts.push(mount3DLater(content));
  if (only !== 'rig' && only !== '3d') parts.push(mountSounds(content));
  unmount = () => { for (const part of parts) part(); };
}

const bar = el('div', { class: 'vw-bar' }, [
  el('h1', {}, ['Doozer viewer']),
  select('Size', [['62', '62 px (pill)'], ['112', '112 px (desktop)'], ['190', '190 px']], String(controls.size), (v) => { controls.size = Number(v); render(); }),
  select('Palette', PALETTE_IDS.map((id) => [id, PALETTES[id].name] as const), controls.palette, (v) => { controls.palette = v; render(); }),
  select<LineStyle>('Line', [['bold', 'Bold outline'], ['soft', 'Soft']], controls.style, (v) => { controls.style = v; render(); }),
  select('Backdrop', [['paper', 'Paper'], ['wallpaper', 'Wallpaper'], ['dark', 'Dark'], ['room', 'Room'], ['checker', 'Checker']], document.body.dataset.bg ?? 'paper', (v) => { document.body.dataset.bg = v; }),
  select('Matrix', [['all', 'All palettes'], ['one', 'This palette']], controls.matrix, (v) => { controls.matrix = v; render(); }),
  select('Motion', [['full', 'Full'], ['reduce', 'Reduced']], controls.reduceMotion ? 'reduce' : 'full', (v) => { controls.reduceMotion = v === 'reduce'; render(); }),
  select('Loops', [['1', 'Running'], ['0', 'Paused']], controls.live ? '1' : '0', (v) => { controls.live = v === '1'; render(); }),
  select<Pace>('Drawn', [['screen', 'As the screen draws'], ['app', `As the app: ${AMBIENT_FPS} alone, ${ATTENDED_FPS} with you`], ['24', '24 a second'], ['30', '30 a second'], ['60', '60 a second']], paceNow, (v) => setPace(v)),
  el('nav', {}, [
    el('a', { href: '#expressions', textContent: 'Expressions' }), el('a', { href: '#animations', textContent: 'Animations' }),
    el('a', { href: '#walk', textContent: 'Walk' }), el('a', { href: '#frames', textContent: 'Frames' }), el('a', { href: '#hats', textContent: 'Hats' }),
    el('a', { href: '#card', textContent: 'Card' }), el('a', { href: '#radial', textContent: 'Radial' }),
    el('a', { href: '#settings', textContent: 'Settings' }), el('a', { href: '#pieces', textContent: 'Pieces' }),
    el('a', { href: '#bench', textContent: 'Bench' }), el('a', { href: '#three-d', textContent: '2D and 3D' }),
    el('a', { href: '#sounds', textContent: 'Sounds' }),
  ]),
]);

host.append(bar, content);
render();
