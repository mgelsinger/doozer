// The kit's icons, as 24 x 24 SVG markup. Two families:
//   - colour icons (food, toys, needs): soft fills with a warm outline, as in the mockups
//   - glyphs (settings, sound, views...): one colour, drawn with `currentColor`
// Pure strings, no DOM.

import type { FoodId, HatId, ToyId, UnlockId, ViewId } from '../core/contract';

const L = '#5B4636'; // outline of the colour icons
const svg = (body: string): string =>
  `<svg class="dzk-ico" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">${body}</svg>`;
const glyph = (body: string): string =>
  svg(`<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</g>`);

const ONIGIRI = `<path d="M12 3.4c1.500 0 2.600.9 3.500 2.400l4.500 8c1.600 2.900-.2 6.400-3.900 6.400H7.900c-3.700 0-5.500-3.500-3.900-6.400l4.500-8c.9-1.500 2-2.400 3.500-2.400z" fill="#fff" stroke="${L}" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.600 13.800h6.800v6.400H8.600z" fill="#3F4B3B"/><circle cx="10" cy="9.800" r=".7" fill="${L}"/><circle cx="14" cy="9.800" r=".7" fill="${L}"/>`;
const APPLE = `<path d="M12 7.300c-1.700-1.400-4.300-1.300-5.800.5-1.700 2.100-1.300 6.100.5 9 1.300 2 2.900 3.200 5.300 2.200 2.400 1 4-.2 5.300-2.200 1.800-2.900 2.200-6.900.5-9-1.500-1.800-4.100-1.900-5.800-.5z" fill="#FF7A6B" stroke="${L}" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 7.300c0-1.700.5-2.900 1.600-3.700" fill="none" stroke="${L}" stroke-width="1.600" stroke-linecap="round"/><path d="M13.200 5.300c1.200-1.700 3-1.900 4.300-1.300-.4 1.700-2 2.900-4.300 1.300z" fill="#7BCB7A" stroke="${L}" stroke-width="1.200" stroke-linejoin="round"/><path d="M8.300 10.300c.3-.9.900-1.400 1.700-1.600" fill="none" stroke="#fff" stroke-width="1.400" stroke-linecap="round" opacity=".8"/>`;
const BALL = `<circle cx="12" cy="12" r="8.600" fill="#FF8FA3"/><path d="M4.300 9.300c4.600 2.300 10.800 2.300 15.400 0" fill="none" stroke="#fff" stroke-width="2.200" stroke-linecap="round"/><path d="M12 3.500c-2 5-2 12 0 17" fill="none" stroke="#fff" stroke-width="1.400" stroke-linecap="round" opacity=".7"/><circle cx="12" cy="12" r="8.600" fill="none" stroke="${L}" stroke-width="1.600"/>`;
const COOKIE = `<circle cx="12" cy="12" r="8.600" fill="#DDA568" stroke="${L}" stroke-width="1.600"/><circle cx="9" cy="9.400" r="1.400" fill="${L}"/><circle cx="14.600" cy="8.600" r="1.100" fill="${L}"/><circle cx="15.200" cy="14.200" r="1.500" fill="${L}"/><circle cx="9.600" cy="15.200" r="1.200" fill="${L}"/>`;

const COLOUR = {
  // ---- needs and actions ----
  feed: svg(APPLE),
  play: svg(BALL),
  wash: svg(`<circle cx="9" cy="14.200" r="6" fill="#BFE8FF" stroke="${L}" stroke-width="1.600"/><circle cx="17.200" cy="7.800" r="3.800" fill="#D9F2FF" stroke="${L}" stroke-width="1.600"/><circle cx="18.600" cy="17.600" r="2.300" fill="#D9F2FF" stroke="${L}" stroke-width="1.400"/><path d="M6.200 12.800a3.200 3.200 0 0 1 2.300-2.300" fill="none" stroke="#fff" stroke-width="1.500" stroke-linecap="round"/>`),
  sleep: svg(`<path d="M15.400 3.600a8.600 8.600 0 1 0 5.200 12.300 7 7 0 0 1-5.200-12.300z" fill="#FFE08A" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><path d="M19.300 3.400l.6 1.500 1.500.6-1.500.6-.6 1.500-.6-1.500-1.500-.6 1.500-.6z" fill="#FFE08A" stroke="${L}" stroke-width=".8" stroke-linejoin="round"/>`),
  wake: svg(`<circle cx="12" cy="12" r="4.600" fill="#FFD25E" stroke="${L}" stroke-width="1.600"/><path d="M12 2.800v2.400M12 18.800v2.400M2.800 12h2.400M18.800 12h2.400M5.500 5.500l1.700 1.700M16.800 16.800l1.700 1.700M5.500 18.500l1.700-1.700M16.800 7.200l1.700-1.700" stroke="#FFD25E" stroke-width="1.800" stroke-linecap="round"/>`),
  treat: svg(COOKIE),

  // ---- food ----
  apple: svg(APPLE),
  bread: svg(`<path d="M5.200 10.400c-1.500-.6-2-2.400-.9-3.900C5.700 4.700 8.600 4 12 4s6.300.7 7.700 2.500c1.100 1.500.6 3.300-.9 3.900v7.500c0 1.100-.9 1.900-1.900 1.900H7.100c-1 0-1.900-.8-1.900-1.900z" fill="#E9B872" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><path d="M7.600 10.200c-.9-.5-1.200-1.500-.6-2.300C8 6.700 9.800 6.300 12 6.300s4 .4 5 1.600c.6.800.3 1.800-.6 2.300v6.600c0 .4-.3.700-.7.700H8.300c-.4 0-.7-.3-.7-.7z" fill="#FFE9C4"/>`),
  carrot: svg(`<path d="M4.700 20.300c-.7.200-1.200-.3-1-1C5.200 14.600 8 9.800 11.600 6.700l5.700 5.700c-3.100 3.600-7.900 6.400-12.600 7.900z" fill="#FF9F4A" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><path d="M9.300 12.300l1.700 1.700M7.200 15.400l1.500 1.500" stroke="${L}" stroke-width="1.300" stroke-linecap="round" opacity=".6"/><path d="M14 9.700c-.9-2.300-.4-4.400 1.100-5.700 1 1.300 1.300 2.700.9 4.200 1.500-.4 2.900-.1 4.200.9-1.300 1.500-3.400 2-5.700 1.100" fill="#7BCB7A" stroke="${L}" stroke-width="1.400" stroke-linejoin="round"/>`),
  biscuit: svg(`<circle cx="12" cy="12" r="8.600" fill="#F4D7A3" stroke="${L}" stroke-width="1.600"/><circle cx="12" cy="12" r="5.800" fill="none" stroke="#DDB572" stroke-width="1.100" stroke-dasharray="1.600 2.100" stroke-linecap="round"/><circle cx="10" cy="10.300" r=".8" fill="#B88A4E"/><circle cx="14" cy="10.300" r=".8" fill="#B88A4E"/><circle cx="12" cy="13.800" r=".8" fill="#B88A4E"/>`),
  cookie: svg(COOKIE),
  donut: svg(`<path d="M12 3.400a8.600 8.600 0 1 0 0 17.200 8.600 8.600 0 0 0 0-17.200zm0 6a2.600 2.600 0 1 1 0 5.200 2.600 2.600 0 0 1 0-5.200z" fill="#EDC08A" fill-rule="evenodd" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><path d="M12 5.300c3.700 0 6.700 3 6.700 6.700 0 1-.9 1.300-1.600 2.100-.8.900-.7 2.300-1.800 2.900-1 .6-2.100-.3-3.300-.3s-2.300.9-3.300.3c-1.100-.6-1-2-1.800-2.900-.7-.8-1.600-1.100-1.600-2.100 0-3.700 3-6.700 6.700-6.700zm0 4.100a2.600 2.600 0 1 0 0 5.200 2.600 2.600 0 0 0 0-5.200z" fill="#FF9EC0" fill-rule="evenodd"/><path d="M8.400 8.600l.9.900M15.400 8l-.8 1M16.600 12.300l1.100.3M7 12.200l1.100-.4" stroke="#fff" stroke-width="1.300" stroke-linecap="round"/><circle cx="12" cy="12" r="2.600" fill="none" stroke="${L}" stroke-width="1.400"/>`),
  strawberry: svg(`<path d="M12 20.800c-4.300-2.300-7.300-6.200-7.300-9.900 0-2.600 2-4.100 4.200-4.100 1.300 0 2.400.5 3.100 1.300.7-.8 1.800-1.300 3.100-1.300 2.200 0 4.200 1.500 4.200 4.100 0 3.700-3 7.600-7.300 9.900z" fill="#FF6B81" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><path d="M7.600 7.400c1.100-2.100 2.700-3 4.400-3s3.300.9 4.400 3c-1.500.9-3 .8-4.400-.3-1.400 1.100-2.900 1.200-4.400.3z" fill="#6FCF97" stroke="${L}" stroke-width="1.400" stroke-linejoin="round"/><path d="M8.800 11.600v.1M12 12.600v.1M15.200 11.600v.1M10.400 15.200v.1M13.600 15.200v.1" stroke="#FFE08A" stroke-width="1.500" stroke-linecap="round"/>`),
  onigiri: svg(ONIGIRI),

  // ---- toys ----
  ball: svg(BALL),
  yarn: svg(`<circle cx="11.400" cy="11.400" r="7.800" fill="#B9A2F2" stroke="${L}" stroke-width="1.600"/><path d="M5.300 8.300c3.300.6 7.400 3.500 9.300 9.900M4 12.500c3 0 7.200 2.600 8.600 6.600M8.200 4.600c4.300 1.400 8.600 5.600 10 10.400M12.300 3.700c3 1.600 5.800 4.600 6.700 8" fill="none" stroke="#fff" stroke-width="1.200" stroke-linecap="round" opacity=".75"/><path d="M16.400 17.600c1.300 1.800 3 2.300 4.300 1.300" fill="none" stroke="${L}" stroke-width="1.500" stroke-linecap="round"/>`),
  duck: svg(`<path d="M4.600 15.300c0-2.600 2.300-4.100 5.200-4.100.6 0 1.200.1 1.800.2-.3-.7-.5-1.400-.5-2.200a4 4 0 1 1 7.500 1.900c.9 1.100 1.400 2.500 1.400 4.200 0 3.100-2.700 4.800-7.700 4.800s-7.700-1.700-7.700-4.800z" fill="#FFD84D" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><path d="M18.600 8l3 .7-2.800 1.600z" fill="#FF9F4A" stroke="${L}" stroke-width="1.200" stroke-linejoin="round"/><circle cx="15.700" cy="7.900" r=".9" fill="${L}"/><path d="M8.200 15.300c1.400 1.300 3.600 1.500 5.200.4" fill="none" stroke="${L}" stroke-width="1.300" stroke-linecap="round" opacity=".6"/>`),

  // ---- hats ----
  nightcap: svg(`<path d="M4.600 16.700c.2-6.400 3.900-11.300 8.900-11.300 3.100 0 5.300 2.100 6.200 5.600-1.700-1.100-3.400-.8-4.300.5-.7 1-.5 2.900.3 5.200z" fill="#7684E0" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><rect x="2.800" y="15.400" width="14.600" height="4" rx="2" fill="#FFF8EC" stroke="${L}" stroke-width="1.500"/><circle cx="20" cy="12.300" r="2.200" fill="#FFF8EC" stroke="${L}" stroke-width="1.400"/>`),
  bow: svg(`<path d="M11 12C8.600 7.600 3.200 7.400 3.200 11.800S8.600 16.600 11 12zM13 12c2.400-4.400 7.800-4.600 7.800-.2S15.400 16.600 13 12z" fill="#FF7A9E" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><ellipse cx="12" cy="12" rx="2.100" ry="2.600" fill="#F2557F" stroke="${L}" stroke-width="1.500"/>`),

  // ---- the pantry, progress, emotes ----
  bowl: svg(`<path d="M6.600 11.200c.7-2.300 2.800-3.700 5.400-3.700s4.700 1.400 5.400 3.700z" fill="#C98B5B" stroke="${L}" stroke-width="1.400" stroke-linejoin="round"/><path d="M3.400 11.300h17.200c0 4.900-3.400 8.200-8.600 8.200s-8.600-3.300-8.600-8.200z" fill="#FF8FA3" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><path d="M12 13.600c.5-.7 1.700-.5 1.700.5 0 .9-1.700 1.900-1.700 1.900s-1.700-1-1.700-1.900c0-1 1.200-1.200 1.700-.5z" fill="#fff" opacity=".9"/>`),
  jar: svg(`<path d="M7.400 8.400h9.200c1.500 1.200 2.400 2.900 2.400 5v3.800c0 1.800-1.400 3.200-3.200 3.200H8.200C6.400 20.400 5 19 5 17.200v-3.800c0-2.100.9-3.800 2.400-5z" fill="#D5F0FF" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><circle cx="9.800" cy="15.900" r="2.300" fill="#DDA568" stroke="${L}" stroke-width="1"/><circle cx="14.300" cy="14.300" r="2.300" fill="#DDA568" stroke="${L}" stroke-width="1"/><rect x="6.800" y="4" width="10.400" height="4.400" rx="1.600" fill="#FFB86B" stroke="${L}" stroke-width="1.600"/>`),
  flame: svg(`<path d="M12.300 3.300c.5 3.100 3.500 4.800 4.700 7.700 1.500 3.800-.7 8.600-5 8.600s-6.600-4.100-5.300-7.800c.5-1.500 1.500-2.300 2-3.600.9 1 1.300 2 1.300 3 1.500-2 2.500-4.700 2.300-7.900z" fill="#FF9F4A" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><path d="M12 18.300c-1.500 0-2.600-1.200-2.400-2.800.2-1.400 1.500-2.100 2.400-3.600.9 1.500 2.200 2.200 2.400 3.600.2 1.600-.9 2.800-2.400 2.800z" fill="#FFE08A"/>`),
  heart: svg(`<path d="M12 20.400s-7.600-4.600-7.600-10.100A4.200 4.200 0 0 1 12 7.900a4.200 4.200 0 0 1 7.600 2.400c0 5.500-7.600 10.100-7.600 10.100z" fill="#FF7A93" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/>`),
  sparkle: svg(`<path d="M12 2.600l2.300 6.300 6.300 2.300-6.300 2.300-2.300 6.300-2.300-6.300-6.300-2.300 6.300-2.300z" fill="#FFD88A" stroke="${L}" stroke-width="1.500" stroke-linejoin="round"/>`),
  // The two letter-emotes are drawn twice (dark, then light) so they read on any wallpaper.
  z: svg(`<path d="M7 6.600h10L7 17.400h10" fill="none" stroke="#3A2A35" stroke-width="6.400" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 6.600h10L7 17.400h10" fill="none" stroke="#D9CCFF" stroke-width="3.200" stroke-linecap="round" stroke-linejoin="round"/>`),
  question: svg(`<path d="M8.100 8.500c0-2.300 1.700-3.800 3.900-3.800s3.900 1.400 3.900 3.500c0 2.900-3.700 3-3.700 5.700M12.200 18.600v.1" fill="none" stroke="#3A2A35" stroke-width="6.400" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.100 8.500c0-2.300 1.700-3.800 3.900-3.800s3.900 1.400 3.900 3.500c0 2.900-3.700 3-3.700 5.700M12.200 18.600v.1" fill="none" stroke="#FFD88A" stroke-width="3.200" stroke-linecap="round" stroke-linejoin="round"/>`),
  bubble: svg(`<circle cx="12" cy="12" r="8.400" fill="rgba(191,232,255,.75)" stroke="#fff" stroke-width="1.200"/><path d="M7.600 10.200a4.800 4.800 0 0 1 3.200-3.400" fill="none" stroke="#fff" stroke-width="1.800" stroke-linecap="round"/>`),
  timer: svg(`<circle cx="12" cy="13" r="7.600" fill="#fff" stroke="${L}" stroke-width="1.600"/><path d="M12 9v4.200l2.600 1.600" fill="none" stroke="${L}" stroke-width="1.600" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.600 2.800h4.800" stroke="${L}" stroke-width="1.800" stroke-linecap="round"/>`),
} as const;

const GLYPH = {
  settings: glyph(`<circle cx="12" cy="12" r="3"/><path d="M12 3.200l1.200 2.500 2.700-.9.900 2.700 2.800.5-.6 2.800 2.100 1.900-2.100 1.900.6 2.800-2.800.5-.9 2.700-2.700-.9-1.200 2.500-1.200-2.500-2.700.9-.9-2.700-2.800-.5.6-2.800-2.100-1.900 2.100-1.900-.6-2.800 2.800-.5.9-2.700 2.700.9z" stroke-width="1.700"/>`),
  'sound-on': glyph(`<path d="M4 9.600h3.200l4.300-3.600v12l-4.300-3.600H4z"/><path d="M15 9.200a4 4 0 0 1 0 5.600M17.700 6.700a7.600 7.600 0 0 1 0 10.600"/>`),
  'sound-off': glyph(`<path d="M4 9.600h3.200l4.300-3.600v12l-4.300-3.600H4z"/><path d="M15.600 9.600l4.800 4.800M20.400 9.600l-4.800 4.800"/>`),
  close: glyph(`<path d="M6.500 6.500l11 11M17.500 6.500l-11 11"/>`),
  more: svg(`<g fill="currentColor"><circle cx="5.500" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18.500" cy="12" r="2"/></g>`),
  start: svg(`<path d="M8.200 5.600v12.800l10.400-6.400z" fill="currentColor" stroke="currentColor" stroke-width="1.600" stroke-linejoin="round"/>`),
  pause: svg(`<g fill="currentColor"><rect x="6.600" y="5.600" width="3.800" height="12.800" rx="1.300"/><rect x="13.600" y="5.600" width="3.800" height="12.800" rx="1.300"/></g>`),
  stop: svg(`<rect x="6.400" y="6.400" width="11.200" height="11.200" rx="2.400" fill="currentColor"/>`),
  check: glyph(`<path d="M5.200 12.600l4.400 4.400 9.200-9.600" stroke-width="2.400"/>`),
  lock: glyph(`<rect x="5.600" y="10.600" width="12.800" height="9" rx="2.400"/><path d="M8.600 10.600V8.200a3.400 3.400 0 0 1 6.800 0v2.400"/>`),
  'view-pill': glyph(`<rect x="2.800" y="8.200" width="18.400" height="7.600" rx="3.800"/><circle cx="7" cy="12" r="1.300" fill="currentColor" stroke="none"/><path d="M11 12h6"/>`),
  'view-room': glyph(`<path d="M3.800 11.200L12 4.600l8.200 6.600v8.200H3.800z"/><path d="M10 19.400v-4.800h4v4.800"/>`),
  'view-island': glyph(`<path d="M3.200 15.400c2-2.600 5.100-3.900 8.800-3.900s6.800 1.300 8.800 3.900c-2 2.400-5.100 3.600-8.800 3.600s-6.800-1.200-8.800-3.600z"/><path d="M12 11.500V6.400M12 8.300c-1.600-2.200-3.600-2.500-5-1.400M12 7.300c1.500-2 3.400-2.300 4.800-1.300"/>`),
  'view-desktop': glyph(`<rect x="3" y="4.600" width="18" height="11.800" rx="2.200"/><path d="M8.800 20h6.400M12 16.400V20"/>`),
} as const;

export const ICONS = { ...COLOUR, ...GLYPH } as const;
export type IconName = keyof typeof ICONS;

export const VIEW_ICON: Readonly<Record<ViewId, IconName>> = {
  pill: 'view-pill', room: 'view-room', island: 'view-island', desktop: 'view-desktop',
};

/** Every food, toy and hat has an icon of the same name. */
export function unlockIcon(id: UnlockId | FoodId | ToyId | HatId): IconName {
  return id;
}

/** Plain-language names for the things that can be unlocked or eaten. */
export const ITEM_NAME: Readonly<Record<UnlockId | FoodId, string>> = {
  apple: 'apple', bread: 'bread', carrot: 'carrot',
  biscuit: 'biscuit', cookie: 'cookie', donut: 'donut', strawberry: 'strawberry', onigiri: 'onigiri',
  ball: 'ball', yarn: 'yarn ball', duck: 'rubber duck',
  nightcap: 'nightcap', bow: 'tiny bow',
};

export function icon(name: IconName): string {
  return ICONS[name];
}
