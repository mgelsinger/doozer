// ui/ - the dark-glass kit shared by every view (DESIGN_SPEC.md 5.3 and 8).
// It talks to the pet only through `Brain` (core/contract.ts) and to the rest of the app
// through plain callbacks. It imports nothing from views/ or shell.ts.

export { createCard } from './card';
export type { Card, CardOptions } from './card';
export { createRadial } from './radial';
export type { Radial, RadialOptions } from './radial';
export { createSettingsPanel } from './settings';
export type { SettingsPanel, SettingsPanelOptions } from './settings';
export { createFocusChip } from './focus-chip';
export type { FocusChip } from './focus-chip';
export { createNeedMeters } from './meters';
export type { NeedMeters, NeedMetersOptions } from './meters';
export { createEmoteLayer } from './emotes';
export type { EmoteLayer, EmoteLayerOptions, EmoteOptions } from './emotes';
export { attachTooltips } from './tooltip';
export type { TooltipOptions } from './tooltip';

export { StageDirector, expressionFor, interruptOnActivity, syncDoozer } from './presenter';
export type { EmoteKind, PetActor, StageDirectorOptions, StageFx, StageProp } from './presenter';
export { Disclosure, SceneRunner, Scope, Transients } from './lifecycle';
export type { CloseReason, Disposer, SceneContext, SceneOutcome } from './lifecycle';

export { ICONS, ITEM_NAME, VIEW_ICON, icon } from './icons';
export type { IconName } from './icons';
export { NEED_ART, NEED_KEYS, TONE_COLOR, needLevel, needText, needTone } from './needs';
export type { NeedTone } from './needs';
export { clockText, formatClock, quietClock, quietRemaining } from './format';
export { resolveReduceMotion, systemPrefersReducedMotion, watchReduceMotion } from './motion';
