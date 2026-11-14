// Sound. Off by default (DESIGN_SPEC.md section 9), and Phase 6 has exactly one: the
// soft chime when a focus session ends (spec 4.5). It is synthesised here; the real
// sound set is Phase 10's.
//
// Nothing is created until the first chime, so a silent Doozer costs nothing.

export interface Sound {
  /** One soft chime, if sound is on. Never throws. */
  chime(): void;
  dispose(): void;
}

/** Two gentle notes, a fifth apart, about a second in all. */
const NOTES: readonly { hz: number; at: number }[] = [
  { hz: 659.25, at: 0 },
  { hz: 987.77, at: 0.16 },
];
const PEAK = 0.07;
const DECAY_S = 0.9;

export function createSound(enabled: () => boolean): Sound {
  let context: AudioContext | null = null;

  return {
    chime() {
      if (!enabled()) return;
      try {
        if (typeof AudioContext !== 'function') return;
        context ??= new AudioContext();
        const audio = context;
        if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
        const start = audio.currentTime + 0.02;
        for (const note of NOTES) {
          const tone = audio.createOscillator();
          const level = audio.createGain();
          tone.type = 'sine';
          tone.frequency.value = note.hz;
          level.gain.setValueAtTime(0.0001, start + note.at);
          level.gain.exponentialRampToValueAtTime(PEAK, start + note.at + 0.02);
          level.gain.exponentialRampToValueAtTime(0.0001, start + note.at + DECAY_S);
          tone.connect(level).connect(audio.destination);
          tone.start(start + note.at);
          tone.stop(start + note.at + DECAY_S + 0.05);
        }
      } catch {
        // No audio device, or the page is not allowed to play: stay silent.
      }
    },
    dispose() {
      void context?.close().catch(() => undefined);
      context = null;
    },
  };
}
