// Development viewer: everything Phase 5 built, on one page, so it can be judged by eye.
// Served by `npm run dev` at /viewer.html. Nothing here ships in the app.

import './viewer.css';
import type { PaletteId } from '../../core/contract';
import { PALETTES, PALETTE_IDS, type LineStyle } from '../../character';
import { mountKit } from './viewer-kit';
import { el, mountRig, type ViewerControls } from './viewer-rig';

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

const content = el('div');
let unmount: (() => void) | null = null;
const only = params.get('only');   // 'rig' or 'kit': render half the page (quicker to reload)
function render(): void {
  unmount?.();
  const parts: (() => void)[] = [];
  if (only !== 'kit') parts.push(mountRig(content, controls));
  if (only !== 'rig') parts.push(mountKit(content, controls));
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
  el('nav', {}, [
    el('a', { href: '#expressions', textContent: 'Expressions' }), el('a', { href: '#animations', textContent: 'Animations' }),
    el('a', { href: '#walk', textContent: 'Walk' }), el('a', { href: '#frames', textContent: 'Frames' }), el('a', { href: '#hats', textContent: 'Hats' }),
    el('a', { href: '#card', textContent: 'Card' }), el('a', { href: '#radial', textContent: 'Radial' }),
    el('a', { href: '#settings', textContent: 'Settings' }), el('a', { href: '#pieces', textContent: 'Pieces' }),
    el('a', { href: '#bench', textContent: 'Bench' }),
  ]),
]);

host.append(bar, content);
render();
