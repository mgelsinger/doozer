// The shared expression vocabulary (DESIGN_SPEC.md section 7). The 2D rig draws these;
// the 3D model (Phase 8) uses the same names for its shape keys, so Doozer is the same
// creature in every home. Pure data: no DOM here.

/** How the eyes are drawn. */
export type Eyes =
  | 'open'      // round, two highlights
  | 'calm'      // open with a slightly lowered lid (reading, focusing)
  | 'half'      // lid halfway down (bored)
  | 'heavy'     // lid most of the way down (sleepy)
  | 'sad'       // open, a little smaller, worried brows
  | 'wide'      // bigger (surprise)
  | 'happy'     // upward arcs  ^ ^
  | 'closed'    // downward arcs (asleep, content shake)
  | 'squeeze';  // > <  (head-shake, big yawn)

export type Mouth = 'w' | 'smile' | 'open' | 'o' | 'flat' | 'frown' | 'wavy' | 'chew' | 'yawn';

/**
 * A body pose: a looping animation selected with `data-pose`. `none` is the neutral
 * stance with no loop, used while a one-shot performance drives the body itself.
 */
export type Pose =
  | 'idle'      // breathe
  | 'settle'    // a quieter breathe, for focusing
  | 'sulk'      // slumped, for low moods
  | 'drowsy'    // nodding off
  | 'sleep'
  | 'walk'      // the calm waddle (spec 6.4)
  | 'trot'      // the livelier walk, close to the mockup's
  | 'hop'
  | 'eat'
  | 'play'
  | 'shake'     // wet-dog shake during a wash
  | 'no'        // head-shake for a refusal
  | 'carried'   // dangling from the cursor
  | 'wave'
  | 'read'      // sitting with a book (Room)
  | 'peek'      // leaning in from a screen edge (Desktop)
  | 'none';

export const POSES: readonly Pose[] = [
  'idle', 'settle', 'sulk', 'drowsy', 'sleep', 'walk', 'trot', 'hop', 'eat', 'play',
  'shake', 'no', 'carried', 'wave', 'read', 'peek', 'none',
];

export type ExpressionName =
  // moods - these eight are exactly the brain's `Mood` values
  | 'joyful' | 'content' | 'meh' | 'hungry' | 'bored' | 'sleepy' | 'dirty' | 'asleep'
  // reactions
  | 'eat' | 'love' | 'wow' | 'cheer' | 'no' | 'shake' | 'yawn'
  // working
  | 'focus';

export interface Expression {
  readonly eyes: Eyes;
  readonly mouth: Mouth;
  /** Tuft angle in degrees: negative is perky, positive droops. The tuft is the mood meter. */
  readonly tuft: number;
  /** The body pose that goes with this face when nothing else asks for one. */
  readonly pose: Pose;
  readonly blush?: boolean;
  readonly glasses?: boolean;
  /** A small extra drawn with the face. */
  readonly extra?: 'drool' | 'dirt';
}

export const EXPRESSIONS: Readonly<Record<ExpressionName, Expression>> = {
  joyful:  { eyes: 'happy',   mouth: 'open',  tuft: -14, pose: 'idle',   blush: true },
  content: { eyes: 'open',    mouth: 'w',     tuft: 0,   pose: 'idle' },
  meh:     { eyes: 'open',    mouth: 'flat',  tuft: 22,  pose: 'idle' },
  hungry:  { eyes: 'sad',     mouth: 'o',     tuft: 38,  pose: 'sulk',   extra: 'drool' },
  bored:   { eyes: 'half',    mouth: 'flat',  tuft: 30,  pose: 'sulk' },
  sleepy:  { eyes: 'heavy',   mouth: 'o',     tuft: 46,  pose: 'drowsy' },
  dirty:   { eyes: 'sad',     mouth: 'wavy',  tuft: 40,  pose: 'sulk',   extra: 'dirt' },
  asleep:  { eyes: 'closed',  mouth: 'smile', tuft: 62,  pose: 'sleep' },

  eat:     { eyes: 'happy',   mouth: 'chew',  tuft: -8,  pose: 'eat',    blush: true },
  love:    { eyes: 'happy',   mouth: 'smile', tuft: -16, pose: 'idle',   blush: true },
  wow:     { eyes: 'wide',    mouth: 'o',     tuft: -20, pose: 'idle' },
  cheer:   { eyes: 'happy',   mouth: 'open',  tuft: -18, pose: 'hop',    blush: true },
  no:      { eyes: 'squeeze', mouth: 'wavy',  tuft: 30,  pose: 'no' },
  shake:   { eyes: 'closed',  mouth: 'smile', tuft: 10,  pose: 'shake' },
  yawn:    { eyes: 'squeeze', mouth: 'yawn',  tuft: 40,  pose: 'idle' },

  focus:   { eyes: 'calm',    mouth: 'smile', tuft: -4,  pose: 'settle', glasses: true },
};

export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS) as readonly ExpressionName[];

export function isExpressionName(value: unknown): value is ExpressionName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EXPRESSIONS, value);
}
