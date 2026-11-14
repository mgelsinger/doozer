// The room, drawn: soft storybook shapes with no outlines (DESIGN_SPEC.md 6.2), in a
// 380 x 380 box. This file is the picture and the handful of functions that repaint the
// parts of it that change: the sky, the lamp, the bowl, the jar, the clock, the books.
//
// What is drawn is a function of attributes set here. Nothing in the picture animates
// by itself: the clouds and the hands of the clock move when they are repainted, once a
// minute, and the stars do not twinkle. (An animation that never stops costs 13-26 % of
// a processor core in this window: docs/shell-spike.md 2.1.)

import type { ToyId } from '../../core/contract';
import { createMemo, need } from '../../ui/dom';
import { THING } from './layout';
import { roomLight, timerWedge, type Sky } from './sky';

const CLOCK = { cx: 268, cy: 80, r: 11.5 } as const;

/** The wall, the floor and the furniture. `id` keeps gradient and clip names unique. */
function backMarkup(id: string): string {
  const pane = THING.pane;
  return /* html */ `
<svg class="roomv-layer roomv-back" viewBox="0 0 380 380" aria-hidden="true" focusable="false">
  <defs>
    <pattern id="${id}-dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r="1.7" fill="#F7D8C4"/><circle cx="19" cy="19" r="1.7" fill="#F7D8C4"/></pattern>
    <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop class="roomv-sky-top" offset="0" stop-color="#86cdfa"/><stop class="roomv-sky-bottom" offset="1" stop-color="#d6f0ff"/></linearGradient>
    <clipPath id="${id}-pane"><rect x="${pane.x}" y="${pane.y}" width="${pane.w}" height="${pane.h}" rx="8"/></clipPath>
  </defs>

  <!-- wall and floor -->
  <rect width="380" height="270" fill="#FCEBDD"/>
  <rect width="380" height="270" fill="url(#${id}-dots)"/>
  <rect y="206" width="380" height="64" fill="#F8DBC9"/>
  <rect y="202" width="380" height="5" fill="#fff"/>
  <rect y="270" width="380" height="110" fill="#EDC498"/>
  <path d="M0 300h380M0 338h380M70 270v30M210 270v30M320 270v30M140 300v38M270 300v38M40 338v42M190 338v42M330 338v42" stroke="#E0B182" stroke-width="2" fill="none"/>
  <rect y="264" width="380" height="8" fill="#fff"/>

  <!-- the window, and the sky outside it -->
  <g class="roomv-window">
    <rect x="34" y="46" width="136" height="122" rx="14" fill="#fff"/>
    <g clip-path="url(#${id}-pane)">
      <rect x="${pane.x}" y="${pane.y}" width="${pane.w}" height="${pane.h}" fill="url(#${id}-sky)"/>
      <g class="roomv-stars" fill="#fff">
        <circle cx="56" cy="68" r="1.4"/><circle cx="78" cy="84" r="1"/><circle cx="92" cy="64" r="1.6"/>
        <circle cx="118" cy="76" r="1.2"/><circle cx="140" cy="62" r="1.5"/><circle cx="152" cy="92" r="1"/>
        <circle cx="66" cy="104" r="1.2"/><circle cx="128" cy="108" r="1.4"/><circle cx="108" cy="94" r=".9"/>
      </g>
      <circle class="roomv-sun" r="13" fill="#FFD25E"/>
      <g class="roomv-moon"><circle r="11" fill="#FFF6D6"/><circle cx="-3" cy="-2" r="2.6" fill="#EFE3B8"/><circle cx="4" cy="4" r="1.8" fill="#EFE3B8"/></g>
      <g class="roomv-clouds" fill="#fff">
        <g class="roomv-cloud-a"><ellipse cx="52" cy="80" rx="16" ry="7"/><ellipse cx="62" cy="75" rx="10" ry="7"/></g>
        <g class="roomv-cloud-b"><ellipse cx="40" cy="108" rx="13" ry="5.5"/><ellipse cx="49" cy="104" rx="8" ry="5.5"/></g>
      </g>
      <path class="roomv-hills" d="M42 160V142Q70 124 100 140T162 132V160Z" fill="#9ED8A8"/>
    </g>
    <rect x="99.5" y="54" width="5" height="106" fill="#fff"/>
    <rect x="42" y="104" width="120" height="5" fill="#fff"/>
    <rect x="27" y="164" width="150" height="10" rx="5" fill="#fff"/>
    <rect x="34" y="174" width="136" height="3" rx="1.5" fill="#EFCDB8"/>
  </g>
  <path d="M22 38h160" stroke="#D9A774" stroke-width="5" stroke-linecap="round"/>
  <path d="M28 40h30q-4 66-24 132h-6z" fill="#FFB3C7"/>
  <path d="M176 40h-30q4 66 24 132h6z" fill="#FFB3C7"/>

  <!-- a picture of somebody -->
  <rect x="310" y="40" width="50" height="50" rx="9" fill="#D9A774"/>
  <rect x="315.500" y="45.500" width="39" height="39" rx="6" fill="#FFF6EC"/>
  <circle cx="327.500" cy="60" r="4.200" fill="#FFC7A1"/><circle cx="342.500" cy="60" r="4.200" fill="#FFC7A1"/>
  <ellipse cx="335" cy="69.500" rx="11.200" ry="10.600" fill="#FFC7A1"/>
  <circle cx="331.300" cy="67.500" r="1.400" fill="#3A2A26"/><circle cx="338.700" cy="67.500" r="1.400" fill="#3A2A26"/>

  <!-- the top shelf: the treat jar and the clock -->
  <rect x="192" y="98" width="104" height="6.500" rx="3.200" fill="#D9A774"/>
  <path d="M202 104.500l5 8M286 104.500l-5 8" stroke="#C9965F" stroke-width="3" stroke-linecap="round"/>
  <g class="roomv-f roomv-f-jar" data-level="0">
    <rect x="205" y="65" width="32" height="33" rx="9" fill="#E3F3FA"/>
    <g class="roomv-jar-row" data-row="1"><circle cx="214" cy="91" r="4.600" fill="#E9B872"/><circle cx="223" cy="92" r="4.600" fill="#D99A5B"/><circle cx="230.500" cy="90.500" r="4.200" fill="#E9B872"/></g>
    <g class="roomv-jar-row" data-row="2"><circle cx="212.500" cy="83.500" r="4.200" fill="#D99A5B"/><circle cx="221" cy="84" r="4.600" fill="#E9B872"/><circle cx="229.500" cy="83" r="4.400" fill="#D99A5B"/></g>
    <g class="roomv-jar-row" data-row="3"><circle cx="215" cy="76.500" r="4.200" fill="#E9B872"/><circle cx="224" cy="76" r="4.400" fill="#D99A5B"/><circle cx="231" cy="76.500" r="3.600" fill="#E9B872"/></g>
    <rect x="205" y="65" width="32" height="33" rx="9" fill="#fff" opacity=".28"/>
    <path d="M210.500 72v15" stroke="#fff" stroke-width="2.600" stroke-linecap="round" opacity=".85"/>
    <rect x="207.500" y="57" width="27" height="10" rx="4" fill="#FF8FA3"/>
    <rect x="216" y="52.500" width="10" height="6" rx="3" fill="#FFB3C0"/>
  </g>
  <g class="roomv-f roomv-f-clock" data-status="idle">
    <circle cx="258.500" cy="65.500" r="4.600" fill="#FFB36B"/><circle cx="277.500" cy="65.500" r="4.600" fill="#FFB36B"/>
    <path d="M260 96l-3 3M276 96l3 3" stroke="#E3894A" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${CLOCK.cx}" cy="${CLOCK.cy}" r="16" fill="#FF9E7A"/>
    <circle cx="${CLOCK.cx}" cy="${CLOCK.cy}" r="${CLOCK.r}" fill="#FFFAF0"/>
    <path class="roomv-clock-wedge" d="" fill="#FF7A8C"/>
    <path class="roomv-clock-ticks" d="M268 70.500v2M268 87.500v2M258.500 80h2M275.500 80h2" stroke="#D9B9A0" stroke-width="1.400" stroke-linecap="round"/>
    <g class="roomv-clock-hands" stroke="#5A4038" stroke-linecap="round">
      <path class="roomv-clock-hour" d="M268 80v-5.500" stroke-width="2.400"/>
      <path class="roomv-clock-minute" d="M268 80v-8.500" stroke-width="1.700"/>
    </g>
    <circle cx="${CLOCK.cx}" cy="${CLOCK.cy}" r="1.700" fill="#5A4038"/>
  </g>

  <!-- the lower shelf: a plant and the soap -->
  <rect x="196" y="152" width="102" height="7" rx="3.500" fill="#D9A774"/>
  <path d="M206 159l6 10M288 159l-6 10" stroke="#C9965F" stroke-width="3" stroke-linecap="round"/>
  <ellipse cx="214" cy="126" rx="5.500" ry="12" transform="rotate(-26 214 126)" fill="#7FCB9A"/>
  <ellipse cx="228" cy="126" rx="5.500" ry="12" transform="rotate(26 228 126)" fill="#7FCB9A"/>
  <ellipse cx="221" cy="122" rx="5.500" ry="12.500" fill="#93D8A9"/>
  <path d="M208 152l3-17h20l3 17z" fill="#FF9E7A"/>
  <g class="roomv-f roomv-f-soap">
    <rect x="259" y="124" width="24" height="28" rx="7" fill="#AEE3FF"/>
    <rect x="267" y="116" width="8" height="9" fill="#fff"/>
    <path d="M264 112.500h14v4.500h-14zM278 112.500h7v3.200h-7z" fill="#7CB7EE"/>
    <circle cx="267" cy="137" r="3.400" fill="#fff"/><circle cx="275" cy="141" r="2.200" fill="#fff"/>
  </g>

  <!-- the lamp -->
  <g class="roomv-f roomv-f-lamp" data-on="1">
    <rect x="338" y="160" width="5" height="164" rx="2.500" fill="#C9A27A"/>
    <ellipse cx="340.500" cy="325" rx="21" ry="6.500" fill="#B98D63"/>
    <path class="roomv-lamp-shade" d="M322 120h37l12 48h-61z"/>
    <path d="M354 168v19" stroke="#C9A27A" stroke-width="2"/><circle cx="354" cy="190" r="3.600" fill="#FF8FA3"/>
  </g>

  <!-- the rug -->
  <ellipse cx="204" cy="334" rx="112" ry="24" fill="#F9B4C4"/>
  <ellipse cx="204" cy="334" rx="95" ry="17" fill="none" stroke="#fff" stroke-width="2.500" stroke-dasharray="2 9" stroke-linecap="round"/>

  <!-- a few books by the wall; the top one is the one Doozer reads -->
  <g class="roomv-books" data-book="there">
    <rect x="146" y="277" width="36" height="8" rx="2.500" fill="#8FC9E8"/>
    <rect x="149" y="269" width="31" height="8" rx="2.500" fill="#FFD27A"/>
    <path d="M152 271.500h9" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>
    <g class="roomv-book-top"><rect x="147" y="261" width="33" height="8" rx="2.500" fill="#D4627A"/><path d="M151 265h8" stroke="#FFE9C9" stroke-width="2" stroke-linecap="round"/></g>
  </g>

  <!-- the bed (its near edge is drawn in front of Doozer) -->
  <g class="roomv-f roomv-f-bed">
    <ellipse cx="74" cy="308" rx="60" ry="26" fill="#7FB3E6"/>
    <ellipse cx="74" cy="303" rx="47" ry="17" fill="#D6E9FA"/>
    <rect x="24" y="284" width="38" height="21" rx="10" fill="#fff" transform="rotate(-14 43 294)"/>
  </g>

  <!-- the bowl -->
  <g class="roomv-f roomv-f-bowl" data-level="0">
    <g class="roomv-kibble"><ellipse cx="270" cy="312" rx="19" ry="10" fill="#B9794A"/><circle cx="262" cy="306" r="3" fill="#C98B5A"/><circle cx="273" cy="304" r="3" fill="#A86B3F"/><circle cx="280" cy="308" r="2.600" fill="#C98B5A"/></g>
    <path d="M246 312h48l-6 18q-18 6-36 0z" fill="#FF8FA3"/>
    <path d="M246 312h48" stroke="#FFC6D0" stroke-width="4.500" stroke-linecap="round"/>
    <path d="M270 327s-5-3-5-6.500a2.700 2.700 0 0 1 5-1.400 2.700 2.700 0 0 1 5 1.400c0 3.500-5 6.500-5 6.500z" fill="#fff"/>
  </g>
</svg>`;
}

const FRONT = /* html */ `
<svg class="roomv-layer roomv-front" viewBox="0 0 380 380" aria-hidden="true" focusable="false">
  <path d="M14 308A60 26 0 0 0 134 308Q74 327 14 308Z" fill="#6CA5DD"/>
</svg>`;

/** The shade that follows the sky: everything but the window pane gets darker at night. */
function lightMarkup(id: string): string {
  const pane = THING.pane;
  return /* html */ `
<svg class="roomv-layer roomv-dark" viewBox="0 0 380 380" aria-hidden="true" focusable="false">
  <path fill-rule="evenodd" fill="#1a2148" d="M0 0H380V380H0ZM${pane.x} ${pane.y}H${pane.x + pane.w}V${pane.y + pane.h}H${pane.x}Z"/>
</svg>
<svg class="roomv-layer roomv-glow" viewBox="0 0 380 380" aria-hidden="true" focusable="false">
  <defs><radialGradient id="${id}-glow"><stop offset="0" stop-color="#ffd27a" stop-opacity=".75"/><stop offset=".5" stop-color="#ffb65c" stop-opacity=".28"/><stop offset="1" stop-color="#ffb65c" stop-opacity="0"/></radialGradient></defs>
  <circle cx="340" cy="170" r="190" fill="url(#${id}-glow)"/>
</svg>`;
}

/** The ball and the yarn ball, in the room's own soft style. */
export const TOY_ART: Readonly<Record<Exclude<ToyId, 'duck'>, string>> = {
  ball: /* html */ `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#FF8FA3"/><path d="M2.500 9.500Q12 14.500 21.500 9.500" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="8" cy="6.500" r="2.200" fill="#fff" opacity=".7"/></svg>`,
  yarn: /* html */ `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#B9A3F5"/><path d="M3.500 8Q12 3 20.500 8.500M2 13Q12 7 22 13.500M4 18.500Q12 11 20.500 17M8 2.500Q15 12 11 22.500M14.500 1.800Q20 12 16 22" fill="none" stroke="#DCCFFF" stroke-width="1.600" stroke-linecap="round"/></svg>`,
};

let uid = 0;

export interface SceneArt {
  /** Everything under Doozer: the room. */
  readonly back: string;
  /** What is drawn in front of Doozer when it is in bed. */
  readonly front: string;
  /** The shade and the lamp's glow, over everything. */
  readonly light: string;
}

export function sceneArt(): SceneArt {
  const id = `roomv${++uid}`;
  return { back: backMarkup(id), front: FRONT, light: lightMarkup(id) };
}

export interface ScenePainter {
  sky(sky: Sky): void;
  /** The lamp, and with it the light in the room. */
  light(daylight: number, lampOn: boolean): void;
  /** Servings showing in the bowl, 0..3. */
  bowl(level: number): void;
  /** Treats in the jar. */
  jar(treats: number, cap: number): void;
  /** The clock on the shelf: the time of day, or a session's time left. */
  clock(state: { status: 'idle' | 'running' | 'paused'; remainingMs: number; hands: { hour: number; minute: number } }): void;
  /** Whether the top book is on the pile or with Doozer. */
  book(held: boolean): void;
}

/** `scene` is the element holding the markup from `sceneArt()`. */
export function createScenePainter(scene: HTMLElement): ScenePainter {
  const memo = createMemo();
  const part = <T extends Element = SVGElement>(selector: string): T => need<T>(scene, selector);
  const skyTop = part('.roomv-sky-top');
  const skyBottom = part('.roomv-sky-bottom');
  const sun = part('.roomv-sun');
  const moon = part('.roomv-moon');
  const stars = part('.roomv-stars');
  const clouds = part('.roomv-clouds');
  const cloudA = part('.roomv-cloud-a');
  const cloudB = part('.roomv-cloud-b');
  const hills = part('.roomv-hills');
  const lamp = part('.roomv-f-lamp');
  const dark = part('.roomv-dark');
  const glow = part('.roomv-glow');
  const bowl = part('.roomv-f-bowl');
  const jar = part('.roomv-f-jar');
  const clock = part('.roomv-f-clock');
  const wedge = part('.roomv-clock-wedge');
  const hourHand = part('.roomv-clock-hour');
  const minuteHand = part('.roomv-clock-minute');
  const books = part('.roomv-books');
  const round = (v: number): number => Math.round(v * 10) / 10;

  return {
    sky(sky) {
      memo('sky', `${sky.top}|${sky.bottom}`, () => {
        skyTop.setAttribute('stop-color', sky.top);
        skyBottom.setAttribute('stop-color', sky.bottom);
      });
      memo('sun', `${round(sky.sun.x)},${round(sky.sun.y)},${sky.sun.visible}`, () => {
        sun.setAttribute('transform', `translate(${round(sky.sun.x)} ${round(sky.sun.y)})`);
        sun.setAttribute('opacity', sky.sun.visible ? '1' : '0');
      });
      memo('moon', `${round(sky.moon.x)},${round(sky.moon.y)},${round(sky.moon.opacity)}`, () => {
        moon.setAttribute('transform', `translate(${round(sky.moon.x)} ${round(sky.moon.y)})`);
        moon.setAttribute('opacity', String(round(sky.moon.opacity)));
      });
      memo('stars', round(sky.stars), () => stars.setAttribute('opacity', String(round(sky.stars))));
      memo('clouds', round(sky.clouds), () => clouds.setAttribute('opacity', String(round(sky.clouds))));
      memo('drift', `${Math.round(sky.drift[0])},${Math.round(sky.drift[1])}`, () => {
        cloudA.setAttribute('transform', `translate(${Math.round(sky.drift[0])} 0)`);
        cloudB.setAttribute('transform', `translate(${Math.round(sky.drift[1])} 0)`);
      });
      memo('hills', sky.hills, () => hills.setAttribute('fill', sky.hills));
      memo('phase', sky.phase, () => { scene.dataset.sky = sky.phase; });
    },

    light(daylight, lampOn) {
      const { dark: shade, glow: warmth } = roomLight(daylight, lampOn);
      memo('lamp', lampOn, () => { lamp.dataset.on = lampOn ? '1' : '0'; scene.dataset.lamp = lampOn ? 'on' : 'off'; });
      memo('dark', shade, () => { dark.style.opacity = String(shade); });
      memo('glow', warmth, () => { glow.style.opacity = String(warmth); });
    },

    bowl(level) {
      const shown = Math.max(0, Math.min(3, Math.round(level)));
      memo('bowl', shown, () => { bowl.dataset.level = String(shown); });
    },

    jar(treats, cap) {
      // An empty jar is empty; after that a row of biscuits for each third of the jar.
      const level = treats <= 0 ? 0 : Math.max(1, Math.min(3, Math.ceil((treats / Math.max(1, cap)) * 3)));
      memo('jar', level, () => { jar.dataset.level = String(level); });
    },

    clock({ status, remainingMs, hands }) {
      memo('clock-status', status, () => { clock.dataset.status = status; });
      if (status === 'idle') {
        memo('wedge', '', () => wedge.setAttribute('d', ''));
        memo('hands', `${hands.hour}/${hands.minute}`, () => {
          hourHand.setAttribute('transform', `rotate(${hands.hour} ${CLOCK.cx} ${CLOCK.cy})`);
          minuteHand.setAttribute('transform', `rotate(${hands.minute} ${CLOCK.cx} ${CLOCK.cy})`);
        });
        return;
      }
      // A kitchen timer: the coloured slice is the time left, and one hand marks its edge.
      const slice = timerWedge(remainingMs, CLOCK.cx, CLOCK.cy, CLOCK.r);
      memo('wedge', slice.d, () => wedge.setAttribute('d', slice.d));
      memo('hands', `timer/${slice.degrees}`, () => {
        hourHand.setAttribute('transform', `rotate(0 ${CLOCK.cx} ${CLOCK.cy})`);
        minuteHand.setAttribute('transform', `rotate(${slice.degrees} ${CLOCK.cx} ${CLOCK.cy})`);
      });
    },

    book(held) {
      memo('book', held, () => { books.dataset.book = held ? 'held' : 'there'; });
    },
  };
}
