// Doozer's five colourways (DESIGN_SPEC.md section 7). One setting, applied in every view.
// The values are the ones the owner saw and liked in the Phase 1 mockups.

import type { PaletteId } from '../core/contract';

export interface Palette {
  readonly name: string;
  /** Main body colour, and the lighter and darker ends of the body's shading. */
  readonly body: string;
  readonly light: string;
  readonly shade: string;
  readonly belly: string;
  readonly cheek: string;
  /** Inner ear. */
  readonly ear: string;
  /** Outline colour in the bold style. */
  readonly line: string;
  /** Eyes, mouth, glasses. */
  readonly ink: string;
}

export const PALETTES: Readonly<Record<PaletteId, Palette>> = {
  peach:    { name: 'Peach',    body: '#FFC7A1', light: '#FFE0C8', shade: '#F3A27A', belly: '#FFF3E6', cheek: '#FF8C8C', ear: '#FFA9A0', line: '#6B4636', ink: '#3A2A26' },
  mint:     { name: 'Mint',     body: '#A9E8CF', light: '#D2F6E7', shade: '#74CBAC', belly: '#F2FFF9', cheek: '#FF9CAB', ear: '#FFBDC8', line: '#2F5D50', ink: '#263B36' },
  lavender: { name: 'Lavender', body: '#CFC0F7', light: '#E6DCFF', shade: '#A692E2', belly: '#F8F3FF', cheek: '#FF9BC5', ear: '#FFBEDB', line: '#4B3F78', ink: '#2E2748' },
  butter:   { name: 'Butter',   body: '#FFE28E', light: '#FFF1C2', shade: '#F0BE4E', belly: '#FFFAE3', cheek: '#FF9B7B', ear: '#FFBB9F', line: '#6E5321', ink: '#3D2F17' },
  sky:      { name: 'Sky',      body: '#AED9FF', light: '#D6ECFF', shade: '#7CB7EE', belly: '#F3FAFF', cheek: '#FF9CB1', ear: '#FFC0CF', line: '#2E4E73', ink: '#22344D' },
};

export const PALETTE_IDS: readonly PaletteId[] = ['peach', 'mint', 'lavender', 'butter', 'sky'];

/** The CSS custom properties a palette sets on the rig's root element. */
export const PALETTE_VARS = ['body', 'light', 'shade', 'belly', 'cheek', 'ear', 'line', 'ink'] as const;

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PALETTES, value);
}
