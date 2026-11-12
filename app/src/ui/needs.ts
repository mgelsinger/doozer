// How a need is shown: its name, icon, and the level -> colour mapping used by every
// meter and ring in the kit (DESIGN_SPEC.md section 8). No DOM here.
//
// Colour is never the only signal. A level is always shown by the bar or ring length too,
// 'urgent' adds a "!" badge and a striped fill, and the accessible text spells it out.

import type { Limits, NeedKey, NeedLevel } from '../core/contract';
import type { IconName } from './icons';

export const NEED_KEYS: readonly NeedKey[] = ['tummy', 'fun', 'energy', 'clean'];

export interface NeedArt {
  readonly label: string;
  readonly icon: IconName;
}

/** Each need shares its icon with the action that restores it, so the two are easy to pair up. */
export const NEED_ART: Readonly<Record<NeedKey, NeedArt>> = {
  tummy:  { label: 'Tummy',  icon: 'feed' },
  fun:    { label: 'Fun',    icon: 'play' },
  energy: { label: 'Energy', icon: 'sleep' },
  clean:  { label: 'Clean',  icon: 'wash' },
};

/** Four colour steps as a need falls: green, yellow, amber, red. */
export type NeedTone = 'good' | 'fair' | 'low' | 'urgent';

export const TONE_COLOR: Readonly<Record<NeedTone, string>> = {
  good: '#6FCF97',
  fair: '#F5CF4A',
  low: '#F7A440',
  urgent: '#F0647A',
};

export function clampNeed(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

/** The brain's three levels, from its own thresholds. */
export function needLevel(value: number, limits: Limits): NeedLevel {
  const v = clampNeed(value);
  return v < limits.urgent ? 'urgent' : v < limits.low ? 'low' : 'ok';
}

/** The colour step. 'fair' is the upper half of the way down to 'low': a visual warning only. */
export function needTone(value: number, limits: Limits): NeedTone {
  const v = clampNeed(value);
  if (v < limits.urgent) return 'urgent';
  if (v < limits.low) return 'low';
  return v < limits.low * 2 ? 'fair' : 'good';
}

/** "Tummy 23%, low" - for tooltips and screen readers. */
export function needText(key: NeedKey, value: number, limits: Limits): string {
  const level = needLevel(value, limits);
  const percent = `${Math.round(clampNeed(value))}%`;
  return `${NEED_ART[key].label} ${percent}${level === 'ok' ? '' : `, ${level}`}`;
}
