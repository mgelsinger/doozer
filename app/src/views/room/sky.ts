// The sky outside the room's window, and the light in the room (DESIGN_SPEC.md 6.2:
// "follows the real time of day - sun, moon, stars, dusk - and the room's light follows
// the sky and the lamp"). Pure: an hour in, colours and positions out.

import { THING } from './layout';

/** Hour of the day, sky colour at the top of the pane, sky colour at the bottom. */
const SKY: readonly (readonly [number, string, string])[] = [
  [0, '#0c1230', '#1d2b5c'],
  [5, '#1a2452', '#45508a'],
  [6.5, '#f6a6a0', '#fde2b8'],
  [9, '#86cdfa', '#d6f0ff'],
  [16, '#7cc6f8', '#d9f1ff'],
  [18.5, '#ff9a76', '#ffd7a3'],
  [20, '#3b3f7a', '#8a6fa8'],
  [21.5, '#0f1638', '#24316a'],
  [24, '#0c1230', '#1d2b5c'],
];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const channels = (hex: string): number[] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

export function mix(a: string, b: string, t: number): string {
  const A = channels(a);
  const B = channels(b);
  return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i] ?? v, clamp(t, 0, 1)))).join(',')})`;
}

export interface Sky {
  readonly top: string;
  readonly bottom: string;
  /** Daylight, 0 (night) to 1 (full day). */
  readonly light: number;
  readonly sun: { readonly x: number; readonly y: number; readonly visible: boolean };
  readonly moon: { readonly x: number; readonly y: number; readonly opacity: number };
  readonly stars: number;
  readonly clouds: number;
  /** How far along their slow drift the two clouds are, in pixels. */
  readonly drift: readonly [number, number];
  readonly hills: string;
  readonly phase: 'night' | 'dawn' | 'day' | 'dusk';
}

/** The hour of the day as a number: 18.5 is half past six in the evening. */
export function hourOf(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

export function skyAt(hour: number): Sky {
  const h = ((Number.isFinite(hour) ? hour : 12) % 24 + 24) % 24;
  let i = 0;
  while (i < SKY.length - 2 && h >= (SKY[i + 1]?.[0] ?? 24)) i++;
  const [h0, top0, bottom0] = SKY[i] as readonly [number, string, string];
  const [h1, top1, bottom1] = SKY[i + 1] as readonly [number, string, string];
  const t = clamp((h - h0) / (h1 - h0), 0, 1);

  const pane = THING.pane;
  const left = pane.x - 2;
  const right = pane.x + pane.w + 2;
  const horizon = pane.y + pane.h - 10;

  // The sun is up from six to six; the moon takes the other half of the day.
  const sunArc = Math.sin(((h - 6) / 12) * Math.PI);
  const light = clamp(0.5 + 2.2 * sunArc, 0, 1);
  const moonHour = (h + 6) % 24;
  const moonArc = Math.sin((moonHour / 12) * Math.PI);

  return {
    top: mix(top0, top1, t),
    bottom: mix(bottom0, bottom1, t),
    light,
    sun: { x: lerp(left, right, clamp((h - 6) / 12, 0, 1)), y: horizon - 84 * Math.max(0, sunArc), visible: h > 5.5 && h < 18.6 },
    moon: { x: lerp(left, right, clamp(moonHour / 12, 0, 1)), y: horizon - 80 * Math.max(0, moonArc), opacity: moonHour < 12 ? 1 - light : 0 },
    stars: 1 - light,
    clouds: 0.25 + 0.7 * light,
    // One crossing takes most of an hour, so a repaint once a minute moves a cloud a few pixels.
    drift: [((h * 60) / 44 % 1) * 220 - 70, (((h * 60) / 67 + 0.4) % 1) * 220 - 70],
    hills: mix('#27425a', '#9ED8A8', light),
    phase: light >= 1 ? 'day' : light <= 0 ? 'night' : h < 12 ? 'dawn' : 'dusk',
  };
}

/**
 * The light in the room: how dark the shade over everything is, and how strong the
 * lamp's glow. With the lamp off (Doozer is asleep) the room is dim even at noon.
 */
export function roomLight(light: number, lampOn: boolean): { dark: number; glow: number } {
  const dark = 1 - clamp(light, 0, 1);
  return lampOn
    ? { dark: Math.round(dark * 0.34 * 100) / 100, glow: Math.round((0.18 + dark * 0.7) * 100) / 100 }
    : { dark: Math.round((0.3 + dark * 0.42) * 100) / 100, glow: 0 };
}

/** The time on the title bar, the way a clock on the wall would say it. */
export function wallClock(date: Date): string {
  const h = date.getHours();
  return `${h % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Angles of the two hands of the clock on the shelf, in degrees from twelve. */
export function clockHands(date: Date): { hour: number; minute: number } {
  const minutes = date.getMinutes() + date.getSeconds() / 60;
  return { hour: Math.round(((date.getHours() % 12) + minutes / 60) * 30), minute: Math.round(minutes * 6) };
}

/**
 * The slice of the clock's face that stands for the time left in a session: a kitchen
 * timer, where the whole face is an hour. `d` is an SVG path around (cx, cy).
 */
export function timerWedge(remainingMs: number, cx: number, cy: number, r: number): { degrees: number; d: string } {
  const minutes = clamp(remainingMs / 60_000, 0, 60);
  const degrees = Math.round(minutes * 6);
  if (degrees <= 0) return { degrees: 0, d: '' };
  if (degrees >= 360) return { degrees: 360, d: `M${cx} ${cy - r}A${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}Z` };
  const a = (degrees * Math.PI) / 180;
  const x = Math.round((cx + r * Math.sin(a)) * 100) / 100;
  const y = Math.round((cy - r * Math.cos(a)) * 100) / 100;
  return { degrees, d: `M${cx} ${cy}V${cy - r}A${r} ${r} 0 ${degrees > 180 ? 1 : 0} 1 ${x} ${y}Z` };
}
