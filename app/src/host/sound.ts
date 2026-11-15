// Sound. Off by default (DESIGN_SPEC.md section 9); asked about once, at the first run.
//
// A small set, made here and nowhere else: no sound files. Every sound is a handful of
// notes played by the same tiny instrument (a sine wave with a soft attack and a ringing
// decay, through one gentle low-pass filter), and every note is taken from the same
// five-note scale (C major pentatonic: C D E G A), so any two sounds that overlap are in
// tune with each other and the set sounds like one creature. Short, quiet, and round:
// nothing is longer than a second and a half or louder than a tenth of full volume.
//
// The set is data (`SOUNDS`), so what it promises can be tested without a loudspeaker;
// `createSound` plays it through the Web Audio API.
//
// Manners (spec 4.5 and principle 2, "silent unless asked"): the host decides when a
// sound is played (host.ts), and plays one only for something the user did, for a session
// ending, and never during a session apart from its beginning and its end.
//
// Cost: nothing is created until the first sound, and the audio device is let go again a
// moment after the last note has died away, so a Doozer with sound on costs nothing while
// it is quiet.

import { realTimers, type Timers } from '../character/timers';

export type SoundName =
  | 'chime'     // a focus session is finished
  | 'sparkle'   // something was unlocked
  | 'begin'     // a focus session starts
  | 'munch'     // fed
  | 'yum'       // given a treat
  | 'kibble'    // the bowl is filled
  | 'boing'     // play
  | 'bubbles'   // a wash
  | 'chirp'     // petted
  | 'lullaby'   // tucked in
  | 'morning'   // woken
  | 'hm'        // a refusal
  | 'pop';      // moving to another view

/** One note. Times in seconds from the start of the sound; `peak` is 0..1 of full volume. */
export interface Note {
  /** When it starts. */
  readonly at: number;
  /** Its pitch, in Hz. */
  readonly hz: number;
  /** Where the pitch glides to by the end of `glide` seconds, as a ratio (1.5: up a fifth). Default: no glide. */
  readonly bend?: number;
  readonly glide?: number;
  /** How long it rings before it has died away. */
  readonly ring: number;
  readonly peak: number;
}

// The scale, in Hz. Everything is one of these.
const C4 = 261.63, D4 = 293.66, E4 = 329.63, G4 = 392.0, A4 = 440.0;
const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880.0;
const C6 = 1046.5, D6 = 1174.66, E6 = 1318.51, G6 = 1567.98, A6 = 1760.0;
export const SCALE: readonly number[] = [C4, D4, E4, G4, A4, C5, D5, E5, G5, A5, C6, D6, E6, G6, A6];

/** Loudest any note may be, and the longest any sound may last. */
export const MAX_PEAK = 0.1;
export const MAX_SECONDS = 1.5;

export const SOUNDS: Readonly<Record<SoundName, readonly Note[]>> = {
  // Three notes climbing a chord: done, and well done.
  chime: [
    { at: 0, hz: E5, ring: 0.9, peak: 0.07 },
    { at: 0.15, hz: G5, ring: 0.9, peak: 0.07 },
    { at: 0.3, hz: C6, ring: 1.1, peak: 0.075 },
  ],
  // A quick run up the top of the scale, like something catching the light.
  sparkle: [
    { at: 0, hz: C6, ring: 0.3, peak: 0.04 },
    { at: 0.07, hz: E6, ring: 0.3, peak: 0.04 },
    { at: 0.14, hz: G6, ring: 0.32, peak: 0.04 },
    { at: 0.21, hz: A6, ring: 0.5, peak: 0.045 },
  ],
  // One low, settled note and its fifth: sitting down to it.
  begin: [
    { at: 0, hz: C5, ring: 0.6, peak: 0.06 },
    { at: 0.12, hz: G5, ring: 0.7, peak: 0.045 },
  ],
  // Two soft low bites, each dipping as it closes: nom, nom.
  munch: [
    { at: 0, hz: G4, bend: 0.84, glide: 0.07, ring: 0.13, peak: 0.08 },
    { at: 0.15, hz: E4, bend: 0.84, glide: 0.07, ring: 0.15, peak: 0.075 },
  ],
  // A bite, then a small delighted lift.
  yum: [
    { at: 0, hz: G4, bend: 0.84, glide: 0.07, ring: 0.13, peak: 0.075 },
    { at: 0.14, hz: E5, ring: 0.2, peak: 0.055 },
    { at: 0.23, hz: A5, bend: 1.06, glide: 0.1, ring: 0.36, peak: 0.055 },
  ],
  // Dry little taps, falling: food landing in the bowl.
  kibble: [
    { at: 0, hz: A5, ring: 0.05, peak: 0.045 },
    { at: 0.06, hz: G5, ring: 0.05, peak: 0.045 },
    { at: 0.11, hz: A5, ring: 0.05, peak: 0.04 },
    { at: 0.18, hz: E5, ring: 0.08, peak: 0.045 },
  ],
  // One note sliding up a fifth: a bounce.
  boing: [
    { at: 0, hz: C5, bend: 1.498, glide: 0.16, ring: 0.3, peak: 0.07 },
  ],
  // Tiny rising blips, higher and higher.
  bubbles: [
    { at: 0, hz: E6, bend: 1.12, glide: 0.05, ring: 0.08, peak: 0.035 },
    { at: 0.1, hz: G6, bend: 1.12, glide: 0.05, ring: 0.08, peak: 0.035 },
    { at: 0.19, hz: E6, bend: 1.12, glide: 0.05, ring: 0.08, peak: 0.03 },
    { at: 0.3, hz: A6, bend: 1.12, glide: 0.05, ring: 0.1, peak: 0.035 },
  ],
  // A single small rising note: a happy squeak.
  chirp: [
    { at: 0, hz: E6, bend: 1.189, glide: 0.07, ring: 0.16, peak: 0.04 },
  ],
  // Three notes stepping down, slowly: goodnight.
  lullaby: [
    { at: 0, hz: G5, ring: 0.7, peak: 0.05 },
    { at: 0.24, hz: E5, ring: 0.7, peak: 0.05 },
    { at: 0.48, hz: C5, ring: 0.85, peak: 0.055 },
  ],
  // The same three, climbing and brisk: good morning.
  morning: [
    { at: 0, hz: C5, ring: 0.3, peak: 0.055 },
    { at: 0.11, hz: E5, ring: 0.3, peak: 0.055 },
    { at: 0.22, hz: G5, ring: 0.5, peak: 0.06 },
  ],
  // Two low notes, the second lower: uh-uh.
  hm: [
    { at: 0, hz: A4, ring: 0.13, peak: 0.065 },
    { at: 0.15, hz: G4, bend: 0.94, glide: 0.1, ring: 0.2, peak: 0.065 },
  ],
  // A drop falling an octave in a twentieth of a second.
  pop: [
    { at: 0, hz: C6, bend: 0.5, glide: 0.05, ring: 0.07, peak: 0.05 },
  ],
};

export const SOUND_NAMES = Object.keys(SOUNDS) as readonly SoundName[];

/** How long a sound lasts from its first note to the last one dying away, in seconds. */
export function soundSeconds(name: SoundName): number {
  return SOUNDS[name].reduce((end, note) => Math.max(end, note.at + note.ring), 0);
}

export interface Sound {
  /** Play one of the set, if sound is on. Never throws. */
  play(name: SoundName): void;
  /** The chime when a session ends (`play('chime')`). */
  chime(): void;
  dispose(): void;
}

export interface SoundOptions {
  timers?: Timers;
  /** For tests: something that stands in for the browser's AudioContext. */
  createContext?: () => AudioContext;
}

/** How fast a note comes in (never a click), and how long after the last note the audio device is let go. */
const ATTACK_S = 0.012;
const RELEASE_AFTER_MS = 400;
/** Everything above this is rolled off, which is what makes the sine waves sound soft rather than glassy. */
const SOFTEN_HZ = 4200;

export function createSound(enabled: () => boolean, options: SoundOptions = {}): Sound {
  const timers = options.timers ?? realTimers;
  let context: AudioContext | null = null;
  let out: AudioNode | null = null;
  let rest: unknown = null;
  /** When, on the audio clock, the last note scheduled so far has died away. */
  let busyUntil = 0;

  function open(): { audio: AudioContext; out: AudioNode } | null {
    if (!context) {
      if (!options.createContext && typeof AudioContext !== 'function') return null;
      context = options.createContext ? options.createContext() : new AudioContext();
      const soften = context.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = SOFTEN_HZ;
      soften.connect(context.destination);
      out = soften;
    }
    return out ? { audio: context, out } : null;
  }

  /** Let the audio device go once everything has died away; the next sound takes it up again. */
  function restLater(audio: AudioContext): void {
    if (rest !== null) timers.clear(rest);
    const wait = Math.max(0, (busyUntil - audio.currentTime) * 1000) + RELEASE_AFTER_MS;
    rest = timers.set(() => {
      rest = null;
      if (context !== audio) return;
      if (audio.currentTime < busyUntil) { restLater(audio); return; }
      try { void audio.suspend().catch(() => undefined); } catch { /* already closed */ }
    }, wait);
  }

  function play(name: SoundName): void {
    if (!enabled()) return;
    const notes = SOUNDS[name];
    if (!notes) return;
    try {
      const opened = open();
      if (!opened) return;
      const { audio } = opened;
      if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
      const start = audio.currentTime + 0.02;
      for (const note of notes) {
        const from = start + note.at;
        const tone = audio.createOscillator();
        const level = audio.createGain();
        tone.type = 'sine';
        tone.frequency.setValueAtTime(note.hz, from);
        if (note.bend && note.bend !== 1) {
          tone.frequency.exponentialRampToValueAtTime(note.hz * note.bend, from + (note.glide ?? note.ring));
        }
        level.gain.setValueAtTime(0.0001, from);
        level.gain.exponentialRampToValueAtTime(Math.min(MAX_PEAK, note.peak), from + ATTACK_S);
        level.gain.exponentialRampToValueAtTime(0.0001, from + Math.max(note.ring, ATTACK_S * 2));
        tone.connect(level).connect(opened.out);
        tone.start(from);
        tone.stop(from + note.ring + 0.05);
        busyUntil = Math.max(busyUntil, from + note.ring + 0.05);
      }
      restLater(audio);
    } catch {
      // No audio device, or the page is not allowed to play: stay silent.
    }
  }

  return {
    play,
    chime: () => play('chime'),
    dispose() {
      if (rest !== null) timers.clear(rest);
      rest = null;
      try { void context?.close().catch(() => undefined); } catch { /* already closed */ }
      context = null;
      out = null;
    },
  };
}
