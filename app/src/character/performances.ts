// One-shot performances: short pieces of choreography with a fixed length and a
// guaranteed end (fall asleep, wake and stretch, celebrate, set-down squish...).
// This file is pure data so the timing can be tested without a browser; the keyframes
// are played by the DOM layer in doozer.ts with the Web Animations API.

import type { ExpressionName, Pose } from './expressions';

/** The rig parts a performance may move. Each has a fixed pivot (see rig-markup.ts). */
export type PartName =
  | 'root' | 'body' | 'face' | 'shadow' | 'tail'
  | 'arm-l' | 'arm-r' | 'foot-l' | 'foot-r' | 'ear-l' | 'ear-r';

/** One keyframe. `offset` is 0..1; without it the frames are spread evenly. */
export interface Frame {
  readonly transform?: string;
  readonly opacity?: number;
  readonly offset?: number;
}

export interface Track {
  readonly part: PartName;
  readonly keyframes: readonly Frame[];
  /** Defaults to the whole performance. */
  readonly duration?: number;
  readonly delay?: number;
  readonly easing?: string;
}

export type PerformanceName =
  | 'squish'       // set-down, poke
  | 'hop'
  | 'celebrate'
  | 'wave'
  | 'yawn'
  | 'fall-asleep'
  | 'wake'         // wake and stretch
  | 'shake-off'    // drying off after a wash
  | 'stir'         // a small roll in its sleep (refusing while asleep)
  | 'nod'
  | 'pop-out'      // leaving a view
  | 'pop-in';      // arriving in a view

export interface PerformanceSpec {
  /** Milliseconds. Fixed, so the end can always be scheduled. */
  readonly duration: number;
  /**
   * The looping pose to hold while this plays. `null` keeps whatever pose is current
   * (for performances that only move the root). `'none'` frees the body for the tracks.
   */
  readonly pose: Pose | null;
  /** Faces to show along the way: [at ms, expression]. After the end the mood face returns. */
  readonly faces?: readonly (readonly [number, ExpressionName])[];
  /** `strength` is 0.5..2, used by squish. */
  readonly tracks: (strength: number) => readonly Track[];
}

const up = (deg: number, lift = -6) => `rotate(${deg}deg) translateY(${lift}px)`;
const REST = 'rotate(0deg) translateY(0px)';

export const PERFORMANCES: Readonly<Record<PerformanceName, PerformanceSpec>> = {
  squish: {
    duration: 460,
    pose: null,
    tracks: (s) => [{
      part: 'root',
      easing: 'ease-out',
      keyframes: [
        { transform: `scale(${1 + 0.14 * s}, ${1 - 0.16 * s})` },
        { transform: `scale(${1 - 0.07 * s}, ${1 + 0.08 * s})`, offset: 0.4 },
        { transform: `scale(${1 + 0.03 * s}, ${1 - 0.03 * s})`, offset: 0.7 },
        { transform: 'scale(1, 1)' },
      ],
    }],
  },

  hop: {
    duration: 620,
    pose: null,
    tracks: () => [
      {
        part: 'root',
        easing: 'cubic-bezier(.3, .6, .4, 1)',
        keyframes: [
          { transform: 'translateY(0px) scale(1.1, .88)' },
          { transform: 'translateY(-34px) scale(.93, 1.09)', offset: 0.28 },
          { transform: 'translateY(-40px) scale(1, 1)', offset: 0.52 },
          { transform: 'translateY(0px) scale(1.12, .86)', offset: 0.82 },
          { transform: 'translateY(0px) scale(1, 1)' },
        ],
      },
      { part: 'shadow', keyframes: [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.7)', opacity: 0.55, offset: 0.4 }, { transform: 'scale(1)', opacity: 1, offset: 0.82 }, { transform: 'scale(1)', opacity: 1 }] },
      { part: 'arm-l', easing: 'ease-in-out', keyframes: [{ transform: REST }, { transform: up(60), offset: 0.3 }, { transform: up(60), offset: 0.6 }, { transform: REST }] },
      { part: 'arm-r', easing: 'ease-in-out', keyframes: [{ transform: REST }, { transform: up(-60), offset: 0.3 }, { transform: up(-60), offset: 0.6 }, { transform: REST }] },
    ],
  },

  celebrate: {
    duration: 1500,
    pose: 'idle',
    faces: [[0, 'cheer']],
    tracks: () => [
      {
        part: 'root',
        easing: 'cubic-bezier(.3, .6, .4, 1)',
        keyframes: [
          { transform: 'translateY(0px) rotate(0deg) scale(1.1, .88)' },
          { transform: 'translateY(-30px) rotate(-4deg) scale(.94, 1.08)', offset: 0.14 },
          { transform: 'translateY(-36px) rotate(0deg) scale(1, 1)', offset: 0.26 },
          { transform: 'translateY(0px) rotate(0deg) scale(1.12, .86)', offset: 0.4 },
          { transform: 'translateY(0px) rotate(0deg) scale(1.06, .92)', offset: 0.48 },
          { transform: 'translateY(-40px) rotate(5deg) scale(.93, 1.09)', offset: 0.62 },
          { transform: 'translateY(-46px) rotate(0deg) scale(1, 1)', offset: 0.74 },
          { transform: 'translateY(0px) rotate(0deg) scale(1.14, .84)', offset: 0.9 },
          { transform: 'translateY(0px) rotate(0deg) scale(1, 1)' },
        ],
      },
      {
        part: 'shadow',
        keyframes: [
          { transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.72)', opacity: 0.55, offset: 0.24 },
          { transform: 'scale(1)', opacity: 1, offset: 0.42 }, { transform: 'scale(.66)', opacity: 0.5, offset: 0.72 },
          { transform: 'scale(1)', opacity: 1, offset: 0.9 }, { transform: 'scale(1)', opacity: 1 },
        ],
      },
      { part: 'arm-l', easing: 'ease-in-out', keyframes: [{ transform: REST }, { transform: up(75, -7), offset: 0.12 }, { transform: up(58, -7), offset: 0.42 }, { transform: up(80, -7), offset: 0.66 }, { transform: up(70, -7), offset: 0.86 }, { transform: REST }] },
      { part: 'arm-r', easing: 'ease-in-out', keyframes: [{ transform: REST }, { transform: up(-75, -7), offset: 0.12 }, { transform: up(-58, -7), offset: 0.42 }, { transform: up(-80, -7), offset: 0.66 }, { transform: up(-70, -7), offset: 0.86 }, { transform: REST }] },
    ],
  },

  wave: {
    duration: 1300,
    pose: 'idle',
    // The paw lifts out to the side of the head and waggles there, so it reads against the body.
    tracks: () => {
      const out = (deg: number) => `translate(12px, -8px) rotate(${deg}deg)`;
      const rest = 'translate(0px, 0px) rotate(0deg)';
      return [
        {
          part: 'arm-r',
          easing: 'ease-in-out',
          keyframes: [
            { transform: rest },
            { transform: out(-125), offset: 0.16 }, { transform: out(-165), offset: 0.3 },
            { transform: out(-125), offset: 0.44 }, { transform: out(-165), offset: 0.58 },
            { transform: out(-125), offset: 0.72 }, { transform: out(-155), offset: 0.86 },
            { transform: rest },
          ],
        },
        { part: 'root', easing: 'ease-in-out', keyframes: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-2.500deg)', offset: 0.18 }, { transform: 'rotate(-2.500deg)', offset: 0.84 }, { transform: 'rotate(0deg)' }] },
      ];
    },
  },

  yawn: {
    duration: 1400,
    pose: 'none',
    faces: [[140, 'yawn']],
    tracks: () => [
      { part: 'body', easing: 'ease-in-out', keyframes: [{ transform: 'scale(1, 1)' }, { transform: 'scale(.97, 1.05)', offset: 0.32 }, { transform: 'scale(.965, 1.055)', offset: 0.68 }, { transform: 'scale(1.02, .98)', offset: 0.9 }, { transform: 'scale(1, 1)' }] },
      { part: 'arm-l', easing: 'ease-in-out', keyframes: [{ transform: 'rotate(0deg) translate(0px, 0px)' }, { transform: 'rotate(34deg) translate(8px, -10px)', offset: 0.3 }, { transform: 'rotate(34deg) translate(8px, -10px)', offset: 0.7 }, { transform: 'rotate(0deg) translate(0px, 0px)' }] },
      { part: 'ear-l', easing: 'ease-in-out', keyframes: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-9deg)', offset: 0.35 }, { transform: 'rotate(-9deg)', offset: 0.7 }, { transform: 'rotate(0deg)' }] },
      { part: 'ear-r', easing: 'ease-in-out', keyframes: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(9deg)', offset: 0.35 }, { transform: 'rotate(9deg)', offset: 0.7 }, { transform: 'rotate(0deg)' }] },
    ],
  },

  'fall-asleep': {
    duration: 1900,
    pose: 'none',
    faces: [[0, 'sleepy'], [520, 'yawn'], [1280, 'asleep']],
    // Ends exactly on the sleep pose's first frame, so handing over to the loop does not pop.
    tracks: () => [{
      part: 'body',
      easing: 'ease-in-out',
      keyframes: [
        { transform: 'rotate(0deg) scale(1, 1)' },
        { transform: 'rotate(-3deg) scale(1.01, .99)', offset: 0.14 },
        { transform: 'rotate(2.5deg) scale(1.02, .98)', offset: 0.28 },
        { transform: 'rotate(0deg) scale(.975, 1.045)', offset: 0.5 },
        { transform: 'rotate(0deg) scale(.975, 1.045)', offset: 0.64 },
        { transform: 'rotate(0deg) scale(1.13, .81)', offset: 0.88 },
        { transform: 'rotate(0deg) scale(1.1, .84)' },
      ],
    }],
  },

  wake: {
    duration: 1700,
    pose: 'none',
    faces: [[0, 'asleep'], [260, 'yawn'], [1060, 'wow']],
    tracks: () => [
      {
        part: 'body',
        easing: 'ease-in-out',
        keyframes: [
          { transform: 'translateY(0px) scale(1.1, .84)' },
          { transform: 'translateY(0px) scale(1.04, .94)', offset: 0.2 },
          { transform: 'translateY(-2px) scale(.93, 1.12)', offset: 0.46 },
          { transform: 'translateY(-2px) scale(.93, 1.12)', offset: 0.6 },
          { transform: 'translateY(0px) scale(1.06, .94)', offset: 0.8 },
          { transform: 'translateY(0px) scale(1, 1)' },
        ],
      },
      { part: 'arm-l', easing: 'ease-in-out', keyframes: [{ transform: REST }, { transform: REST, offset: 0.2 }, { transform: up(118, -8), offset: 0.44 }, { transform: up(126, -8), offset: 0.6 }, { transform: REST, offset: 0.82 }, { transform: REST }] },
      { part: 'arm-r', easing: 'ease-in-out', keyframes: [{ transform: REST }, { transform: REST, offset: 0.2 }, { transform: up(-118, -8), offset: 0.44 }, { transform: up(-126, -8), offset: 0.6 }, { transform: REST, offset: 0.82 }, { transform: REST }] },
    ],
  },

  'shake-off': {
    // Ten swings of a twelfth of a second each: two pictures a swing at 24 a second, so
    // every swing is seen at its end and at its middle (rig.css, "Timing").
    duration: 833,
    pose: 'none',
    faces: [[0, 'shake']],
    tracks: () => [
      {
        part: 'body',
        easing: 'linear',
        keyframes: [0, -8, 8, -8, 8, -6, 6, -4, 3, -1.5, 0].map((deg) => ({ transform: `rotate(${deg}deg)` })),
      },
      { part: 'ear-l', easing: 'linear', keyframes: [0, 12, -10, 12, -10, 8, -6, 4, 0].map((deg) => ({ transform: `rotate(${deg}deg)` })) },
      { part: 'ear-r', easing: 'linear', keyframes: [0, 12, -10, 12, -10, 8, -6, 4, 0].map((deg) => ({ transform: `rotate(${-deg}deg)` })) },
    ],
  },

  stir: {
    duration: 800,
    pose: null,
    tracks: () => [{
      part: 'root',
      easing: 'ease-in-out',
      keyframes: [0, -3, 3, -1.5, 0].map((deg) => ({ transform: `rotate(${deg}deg)` })),
    }],
  },

  nod: {
    duration: 440,
    pose: null,
    tracks: () => [{
      part: 'root',
      easing: 'ease-in-out',
      keyframes: [{ transform: 'translateY(0px) scale(1, 1)' }, { transform: 'translateY(2px) scale(1.05, .94)', offset: 0.4 }, { transform: 'translateY(0px) scale(.99, 1.01)', offset: 0.75 }, { transform: 'translateY(0px) scale(1, 1)' }],
    }],
  },

  'pop-out': {
    duration: 240,
    pose: null,
    tracks: () => [{
      part: 'root',
      easing: 'ease-in',
      keyframes: [{ transform: 'translateY(0px) scale(1, 1)', opacity: 1 }, { transform: 'translateY(-16px) scale(1.06, 1.06)', opacity: 1, offset: 0.4 }, { transform: 'translateY(-6px) scale(.1, .1)', opacity: 0 }],
    }],
  },

  'pop-in': {
    duration: 300,
    pose: null,
    tracks: () => [{
      part: 'root',
      easing: 'ease-out',
      keyframes: [{ transform: 'scale(.1, .1)', opacity: 0 }, { transform: 'scale(1.12, .9)', opacity: 1, offset: 0.55 }, { transform: 'scale(.97, 1.03)', opacity: 1, offset: 0.8 }, { transform: 'scale(1, 1)', opacity: 1 }],
    }],
  },
};

export const PERFORMANCE_NAMES = Object.keys(PERFORMANCES) as readonly PerformanceName[];

export function isPerformanceName(value: unknown): value is PerformanceName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PERFORMANCES, value);
}
