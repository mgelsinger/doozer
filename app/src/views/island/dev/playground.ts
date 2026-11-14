// Development only: the Island view on a plain page, with a real brain and a stand-in for
// the host, so it can be looked at and prodded in a browser. Served by `npm run dev` at
// /island.html. Nothing here ships in the app.
//
//   ?bg=wallpaper|paper|dark|checker   what is behind the transparent window
//   ?size=small|medium|large
//   ?palette=mint                      (or peach, lavender, butter, sky)
//   ?regions=1                         draw the hit regions over the island
//   ?still=1                           no clock and no frames: step it by hand
//
// In the console: `island.view`, `island.brain`, `island.advance(ms)`, `island.shot()`.

import { createBrain } from '../../../core';
import type { PaletteId, SizeId, ViewId } from '../../../core/contract';
import type { HostServices } from '../../../host/view';
import { createBrowserShell, type Region, type WindowInfo } from '../../../shell';
import { createIslandView } from '..';
import { islandLayout } from '../layout';

const params = new URLSearchParams(location.search);
const size = (['small', 'medium', 'large'].includes(params.get('size') ?? '') ? params.get('size') : 'medium') as SizeId;
const still = params.get('still') === '1';
const layout = islandLayout(size);

const style = document.createElement('style');
style.textContent = `
  html, body { margin: 0; height: 100%; }
  body { display: grid; place-items: center; font: 13px system-ui, sans-serif; }
  body[data-bg="wallpaper"] { background: radial-gradient(120% 90% at 30% 20%, #8ec5ff 0, #6aa7ef 30%, #b99cf0 70%, #f3b3c8 100%); }
  body[data-bg="paper"] { background: #f4efe9; }
  body[data-bg="dark"] { background: #1c1924; }
  body[data-bg="checker"] { background: repeating-conic-gradient(#d8d8d8 0 25%, #f4f4f4 0 50%) 0 0 / 24px 24px; }
  #window { position: relative; outline: 1px dashed rgba(0, 0, 0, .18); }
  #regions { position: absolute; inset: 0; pointer-events: none; z-index: 99; }
  #regions i { position: absolute; background: rgba(255, 60, 120, .22); box-shadow: inset 0 0 0 1px rgba(255, 60, 120, .7); }
`;
document.head.append(style);
document.body.dataset.bg = params.get('bg') ?? 'wallpaper';

const frame = document.createElement('div');
frame.id = 'window';
frame.style.width = `${layout.windowWidth}px`;
frame.style.height = `${layout.windowHeight}px`;
const overlay = document.createElement('div');
overlay.id = 'regions';
document.body.append(frame);

const brain = createBrain({ debug: true });
brain.setSetting('size', { ...brain.settings.size, island: size });
if (params.get('palette')) brain.setSetting('palette', params.get('palette') as PaletteId);
brain.debug?.setNeeds({ tummy: 82, fun: 84, energy: 80, clean: 86 });

const shell = createBrowserShell({ getItem: () => null, setItem: () => undefined }, () => ({ width: layout.windowWidth, height: layout.windowHeight }));
const view = createIslandView(still ? { requestFrame: () => 0, cancelFrame: () => undefined } : {});

function drawRegions(): void {
  if (params.get('regions') !== '1') return;
  overlay.replaceChildren(...view.hitRegions().map((r: Region) => {
    const box = document.createElement('i');
    Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, borderRadius: `${r.r ?? 0}px` });
    return box;
  }));
}

const calls: string[] = [];
const services: HostServices = {
  availableViews: ['pill', 'room', 'island', 'desktop'],
  currentView: () => 'island',
  switchView: (to: ViewId) => void calls.push(`switch:${to}`),
  regionsChanged: drawRegions,
  windowChanged: () => void calls.push('window'),
  setFocusable: (on) => void calls.push(`focusable:${on}`),
  showMenu: () => void calls.push('menu'),
  quit: () => void calls.push('quit'),
  chime: () => void calls.push('chime'),
  needsWelcome: () => false,
  welcomed: () => undefined,
};
const rect = { x: 0, y: 0, w: layout.windowWidth, h: layout.windowHeight };
const info: WindowInfo = {
  kind: 'floating', view: 'island', x: 0, y: 0, width: layout.windowWidth, height: layout.windowHeight, scale: 1,
  cssWidth: layout.windowWidth, cssHeight: layout.windowHeight, monitor: { full: rect, work: rect, scale: 1 }, nativeMs: 0,
};

await view.mount(frame, { brain, shell, host: services, info });
frame.append(overlay);
drawRegions();
if (!still) setInterval(() => brain.tick(), 250);

const api = {
  view,
  brain,
  calls,
  /** Take `ms` of frames now. */
  advance: (ms: number) => view.advance(ms),
  /** The island as a PNG data URL (the drawing only, without the menus laid over it). */
  shot: () => view.parts()?.stage.capture() ?? '',
  regions: drawRegions,
};
(window as unknown as { island: typeof api }).island = api;
