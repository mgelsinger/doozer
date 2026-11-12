// The SVG parts of the 2D rig, as markup. Pure strings, so the structure can be checked
// in a test without a browser.
//
// Drawing space is a 200 x 200 view box. Doozer stands on y = 186 and is centred on x = 100.
//
// PIVOTS - every part that moves is a <g class="dz-p"> carrying its pivot as two custom
// properties (--px, --py) in view-box units. rig.css turns those into
// `transform-box: view-box; transform-origin: var(--px) var(--py)`.
//
// The trap this avoids: a shape that has its own `transform="..."` attribute must never
// also be given a CSS transform-box / transform-origin, because the attribute then pivots
// around the CSS origin and the shape is displaced. So: shapes with a `transform`
// attribute are plain children of a pivot group and never carry `dz-p` themselves, and
// rig.css has no blanket `*` rule. rig-markup.test.ts enforces both.

import type { HatId } from '../core/contract';

export const VIEW_BOX = 200;
/** Where Doozer's feet meet the ground, in view-box units. */
export const GROUND_Y = 186;

export const PIVOTS = {
  root:     [100, 186],   // the ground under the feet: squash, hop, lean
  body:     [100, 186],
  shadow:   [100, 188],
  'foot-l': [75, 178],
  'foot-r': [125, 178],
  tail:     [152, 152],
  'ear-l':  [68, 74],     // where each ear meets the head
  'ear-r':  [132, 74],
  tuft:     [100, 50],    // the root of the tuft
  'arm-l':  [47, 123],    // shoulders
  'arm-r':  [153, 123],
  face:     [100, 112],
  'cheek-l': [60, 124],
  'cheek-r': [140, 124],
  'eye-l':  [74, 106],
  'eye-r':  [126, 106],
  mouth:    [100, 124],
  glasses:  [100, 106],
  hat:      [100, 46],    // the hat attachment point: top of the head
  book:     [100, 162],
} as const;

export type PivotName = keyof typeof PIVOTS;

/** Hats attach here (view-box units). The 3D model uses the same point on its head. */
export const HAT_ANCHOR = { x: PIVOTS.hat[0], y: PIVOTS.hat[1] } as const;

const pivot = (name: PivotName): string => `style="--px:${PIVOTS[name][0]}px;--py:${PIVOTS[name][1]}px"`;

function eye(side: 'l' | 'r'): string {
  const cx = PIVOTS[`eye-${side}`][0];
  const inner = side === 'l' ? 1 : -1; // brows and squeezed eyes point toward the middle
  return `
        <g class="dz-eye dz-eye-${side} dz-p" ${pivot(`eye-${side}`)}>
          <g class="e-open dz-p" ${pivot(`eye-${side}`)}>
            <g class="e-lidclip">
              <ellipse class="e-ball" cx="${cx}" cy="106" rx="8.6" ry="10.8"/>
              <circle class="e-hl" cx="${cx + 3}" cy="101.4" r="3.3"/>
              <circle class="e-hl e-hl2" cx="${cx - 2.6}" cy="110" r="1.5"/>
            </g>
            <path class="e-line e-lid" d="M${cx - 9.8} 95.8 Q${cx} 93.6 ${cx + 9.8} 95.8"/>
          </g>
          <path class="e-line e-happy" d="M${cx - 9} 109 Q${cx} 96 ${cx + 9} 109"/>
          <path class="e-line e-closed" d="M${cx - 9} 104 Q${cx} 113 ${cx + 9} 104"/>
          <path class="e-line e-squeeze" d="M${cx - 7 * inner} 99 L${cx + 6 * inner} 106 L${cx - 7 * inner} 113"/>
          <path class="e-line e-brow" d="M${cx - 9 * inner} 93 L${cx + 9 * inner} 87"/>
        </g>`;
}

/** The whole rig. `id` must be unique on the page: it namespaces the body gradient. */
export function rigMarkup(id: string): string {
  return `
<svg class="dz-svg" viewBox="0 0 ${VIEW_BOX} ${VIEW_BOX}" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="${id}-g" cx="36%" cy="28%" r="85%">
      <stop offset="0" style="stop-color: var(--dz-light)"/>
      <stop offset=".5" style="stop-color: var(--dz-body)"/>
      <stop offset="1" style="stop-color: var(--dz-shade)"/>
    </radialGradient>
  </defs>
  <ellipse class="dz-shadow dz-p" ${pivot('shadow')} cx="100" cy="188" rx="52" ry="7"/>
  <g class="dz-root dz-p" ${pivot('root')}>
    <g class="dz-foot dz-foot-l dz-p" ${pivot('foot-l')}><ellipse class="dz-fill-shade dz-stroke" cx="75" cy="180" rx="18" ry="9.5"/></g>
    <g class="dz-foot dz-foot-r dz-p" ${pivot('foot-r')}><ellipse class="dz-fill-shade dz-stroke" cx="125" cy="180" rx="18" ry="9.5"/></g>
    <g class="dz-bodywrap dz-p" ${pivot('body')}>
      <g class="dz-tail dz-p" ${pivot('tail')}><circle class="dz-fill-shade dz-stroke" cx="158" cy="154" r="10"/></g>
      <g class="dz-ear dz-ear-l dz-p" ${pivot('ear-l')}><circle class="dz-fill dz-stroke" cx="60" cy="60" r="19"/><circle class="dz-ear-in" cx="60" cy="61" r="9.5"/></g>
      <g class="dz-ear dz-ear-r dz-p" ${pivot('ear-r')}><circle class="dz-fill dz-stroke" cx="140" cy="60" r="19"/><circle class="dz-ear-in" cx="140" cy="61" r="9.5"/></g>
      <path class="dz-body dz-stroke" fill="url(#${id}-g)" d="M100 44 C142 44 164 82 164 122 C164 162 140 184 100 184 C60 184 36 162 36 122 C36 82 58 44 100 44 Z"/>
      <ellipse class="dz-belly" cx="100" cy="148" rx="37" ry="27"/>
      <g class="dz-tuft dz-p" ${pivot('tuft')}><g class="dz-tuft-sway dz-p" ${pivot('tuft')}>
        <path class="dz-tuft-out" d="M100 52 C95 36 104 22 115 27 C123 31 119 43 111 39"/>
        <path class="dz-tuft-in" d="M100 52 C95 36 104 22 115 27 C123 31 119 43 111 39"/>
      </g></g>
      <g class="dz-dirt">
        <path class="dz-smudge" d="M121 159 q4 -7 11 -3 q7 4 2 8 q-7 4 -13 -5 z"/>
        <path class="dz-smudge" d="M56 148 q3 -6 9 -3 q5 3 1 7 q-6 3 -10 -4 z"/>
        <path class="dz-smudge" d="M134 90 q3 -5 8 -2 q4 3 0 6 q-5 2 -8 -4 z"/>
        <path class="dz-scuff" d="M67 92 l7 4 M65 98 l6 3 M142 138 l6 -3"/>
      </g>
      <g class="dz-hat dz-p" ${pivot('hat')}></g>
      <g class="dz-face dz-p" ${pivot('face')}>
        <ellipse class="dz-cheek dz-p" ${pivot('cheek-l')} cx="60" cy="124" rx="11.5" ry="7.5"/>
        <ellipse class="dz-cheek dz-p" ${pivot('cheek-r')} cx="140" cy="124" rx="11.5" ry="7.5"/>${eye('l')}${eye('r')}
        <g class="dz-mouth">
          <path class="m m-line m-w" d="M90 120 Q95 127.5 100 120 Q105 127.5 110 120"/>
          <path class="m m-line m-smile" d="M91 120 Q100 130 109 120"/>
          <g class="m m-open"><path class="m-fill" d="M89 119 Q100 141 111 119 Z"/><ellipse class="m-tongue" cx="100" cy="128.5" rx="5" ry="3.2"/></g>
          <ellipse class="m m-fill m-o" cx="100" cy="124" rx="4.6" ry="5.6"/>
          <path class="m m-line m-flat" d="M93 123 L107 123"/>
          <path class="m m-line m-frown" d="M92 127 Q100 119 108 127"/>
          <path class="m m-line m-wavy" d="M90 124 Q95 118.5 100 124 Q105 129.5 110 124"/>
          <ellipse class="m m-fill m-chew dz-p" ${pivot('mouth')} cx="100" cy="124" rx="6.6" ry="5.8"/>
          <g class="m m-yawn"><ellipse class="m-fill" cx="100" cy="127" rx="9" ry="11.5"/><ellipse class="m-tongue" cx="100" cy="133" rx="5.4" ry="3.6"/></g>
        </g>
        <path class="dz-drool" d="M108 126.5 q4 7 0 10.5 q-4 -3.5 0 -10.5 z"/>
        <g class="dz-glasses dz-p" ${pivot('glasses')}>
          <circle class="g-lens" cx="74" cy="106" r="15.5"/>
          <circle class="g-lens" cx="126" cy="106" r="15.5"/>
          <path class="g-bridge" d="M89.5 105 Q100 99 110.5 105"/>
          <path class="g-glint" d="M64.5 100 Q66.5 95.5 71 94"/>
          <path class="g-glint" d="M116.5 100 Q118.500 95.5 123 94"/>
        </g>
      </g>
      <g class="dz-book dz-p" ${pivot('book')}>
        <path class="dz-book-pages" d="M70 126 Q85 119 100 124 Q115 119 130 126 L130 131 L70 131 Z"/>
        <path class="dz-book-cover dz-stroke" d="M68 131 Q68 127 72 127 Q86 124 100 128 Q114 124 128 127 Q132 127 132 131 L132 161 Q132 165 128 165 L72 165 Q68 165 68 161 Z"/>
        <path class="dz-book-spine" d="M100 129 L100 164"/>
        <path class="dz-book-mark" d="M116 151 C109.500 146 110 140 113.500 140 C115 140 116 141.300 116 142.200 C116 141.300 117 140 118.500 140 C122 140 122.500 146 116 151 Z"/>
      </g>
      <g class="dz-arm dz-arm-l dz-p" ${pivot('arm-l')}><ellipse class="dz-fill dz-rim" cx="41" cy="134" rx="10.5" ry="15" transform="rotate(18 41 134)"/></g>
      <g class="dz-arm dz-arm-r dz-p" ${pivot('arm-r')}><ellipse class="dz-fill dz-rim" cx="159" cy="134" rx="10.5" ry="15" transform="rotate(-18 159 134)"/></g>
    </g>
  </g>
</svg>`;
}

/** Markup for a hat, drawn inside the hat attachment group. */
export function hatMarkup(hat: HatId): string {
  if (hat === 'nightcap') {
    return `
      <g class="dz-hat-nightcap">
        <path class="dz-cap dz-stroke" d="M66 57 C66 28 92 6 120 9 C145 12 162 34 167 60 C158 47 148 42 141 45 C137 47 134 52 135 57 Q100 27 66 57 Z"/>
        <path class="dz-cap-star" d="M104 24 l2 4.600 4.600 2 -4.600 2 -2 4.600 -2 -4.600 -4.600 -2 4.600 -2 z"/>
        <path class="dz-cap-star" d="M137 26 l1.400 3.200 3.200 1.400 -3.200 1.400 -1.400 3.200 -1.400 -3.200 -3.200 -1.400 3.200 -1.400 z"/>
        <path class="dz-cap-band-out" d="M66 58 Q100 28 134 58"/>
        <path class="dz-cap-band" d="M66 58 Q100 28 134 58"/>
        <circle class="dz-cap-pom dz-stroke" cx="168" cy="66" r="9.5"/>
      </g>`;
  }
  return `
      <g class="dz-hat-bow" transform="translate(69 47) rotate(-24)">
        <path class="dz-bow dz-stroke" d="M-3 0 C-9 -13 -25 -13 -25 -1 C-25 11 -9 12 -3 0 Z"/>
        <path class="dz-bow dz-stroke" d="M3 0 C9 -13 25 -13 25 -1 C25 11 9 12 3 0 Z"/>
        <path class="dz-bow-crease" d="M-9 -1 L-17 -3 M9 -1 L17 -3"/>
        <ellipse class="dz-bow-knot dz-stroke" cx="0" cy="0" rx="5.5" ry="6.5"/>
      </g>`;
}
