import { describe, expect, it } from 'vitest';
import { MAX_PEAK, MAX_SECONDS, SCALE, SOUNDS, SOUND_NAMES, createSound, soundSeconds, type SoundName } from '../../src/host/sound';

// ---- The set, as data ---------------------------------------------------------------

describe('the sound set', () => {
  it('has a sound for everything the host plays one for', () => {
    const wanted: SoundName[] = ['chime', 'sparkle', 'begin', 'munch', 'yum', 'kibble', 'boing', 'bubbles', 'chirp', 'lullaby', 'morning', 'hm', 'pop'];
    expect([...SOUND_NAMES].sort()).toEqual([...wanted].sort());
    for (const name of SOUND_NAMES) expect(SOUNDS[name].length, name).toBeGreaterThan(0);
  });

  it('is one instrument on one scale: every note starts on a note of the pentatonic scale', () => {
    for (const name of SOUND_NAMES) {
      for (const note of SOUNDS[name]) {
        const nearest = SCALE.reduce((best, hz) => (Math.abs(hz - note.hz) < Math.abs(best - note.hz) ? hz : best), SCALE[0] as number);
        expect(Math.abs(nearest - note.hz), `${name}: ${note.hz} Hz`).toBeLessThan(0.01);
      }
    }
  });

  it('is quiet and short: nothing above a tenth of full volume, nothing longer than a second and a half', () => {
    for (const name of SOUND_NAMES) {
      expect(soundSeconds(name), name).toBeLessThanOrEqual(MAX_SECONDS);
      expect(soundSeconds(name), name).toBeGreaterThan(0.04);
      for (const note of SOUNDS[name]) {
        expect(note.peak, name).toBeGreaterThan(0);
        expect(note.peak, name).toBeLessThanOrEqual(MAX_PEAK);
        expect(note.ring, name).toBeGreaterThan(0);
        expect(note.at, name).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('stays in the soft middle of hearing, bends included: nothing shrill and nothing rumbling', () => {
    for (const name of SOUND_NAMES) {
      for (const note of SOUNDS[name]) {
        const to = note.hz * (note.bend ?? 1);
        for (const hz of [note.hz, to]) {
          expect(hz, name).toBeGreaterThanOrEqual(200);
          expect(hz, name).toBeLessThanOrEqual(2200);
        }
        if (note.glide !== undefined) expect(note.glide, name).toBeLessThanOrEqual(note.ring + 0.1);
      }
    }
  });

  it('the things that happen all the time are the shortest and the quietest', () => {
    // A pet, a bubble, a pop and the kibble can come many times a minute.
    for (const name of ['chirp', 'pop', 'kibble', 'bubbles'] as const) {
      expect(soundSeconds(name), name).toBeLessThan(0.5);
      for (const note of SOUNDS[name]) expect(note.peak, name).toBeLessThanOrEqual(0.05);
    }
    // The chime is the one that is meant to be noticed, and still the longest.
    for (const name of SOUND_NAMES) expect(soundSeconds('chime'), name).toBeGreaterThanOrEqual(soundSeconds(name) - 0.01);
  });

  it('no two sounds are the same', () => {
    const shapes = SOUND_NAMES.map((name) => JSON.stringify(SOUNDS[name]));
    expect(new Set(shapes).size).toBe(SOUND_NAMES.length);
  });
});

// ---- Playing it -------------------------------------------------------------------------

function pretendAudio() {
  const log: string[] = [];
  const tones: Array<{ type: string; hz: number[]; start: number; stop: number; peaks: number[] }> = [];
  let now = 10;
  let state: 'running' | 'suspended' | 'closed' = 'running';
  const param = (sink: number[]) => ({
    value: 0,
    setValueAtTime(value: number) { sink.push(value); },
    exponentialRampToValueAtTime(value: number) { sink.push(value); },
  });
  const node = () => ({ connect<T>(next: T): T { return next; } });
  const context = {
    get currentTime() { return now; },
    get state() { return state; },
    destination: node(),
    createBiquadFilter: () => ({ ...node(), type: '', frequency: { value: 0 } }),
    createGain() {
      const peaks: number[] = [];
      const tone = tones[tones.length - 1];
      if (tone) tone.peaks = peaks;
      return { ...node(), gain: param(peaks) };
    },
    createOscillator() {
      const tone = { type: '', hz: [] as number[], start: 0, stop: 0, peaks: [] as number[] };
      tones.push(tone);
      return {
        ...node(),
        set type(value: string) { tone.type = value; },
        frequency: param(tone.hz),
        start(at: number) { tone.start = at; },
        stop(at: number) { tone.stop = at; },
      };
    },
    resume() { log.push('resume'); state = 'running'; return Promise.resolve(); },
    suspend() { log.push('suspend'); state = 'suspended'; return Promise.resolve(); },
    close() { log.push('close'); state = 'closed'; return Promise.resolve(); },
  };
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextTimer = 1;
  let created = 0;
  return {
    log, tones,
    created: () => created,
    createContext: () => { created++; return context as unknown as AudioContext; },
    timers: {
      set: (fn: () => void, ms: number) => { const id = nextTimer++; timers.set(id, { at: now + ms / 1000, fn }); return id; },
      clear: (handle: unknown) => { timers.delete(handle as number); },
    },
    /** Let time pass on the audio clock; timers fire when due. */
    pass(seconds: number): void {
      const end = now + seconds;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

describe('playing the set', () => {
  it('with sound off nothing is played and nothing is even created', () => {
    const audio = pretendAudio();
    const sound = createSound(() => false, audio);
    for (const name of SOUND_NAMES) sound.play(name);
    sound.chime();
    expect(audio.created()).toBe(0);
    expect(audio.tones).toHaveLength(0);
    expect(audio.pending()).toBe(0);
  });

  it('plays every note of a sound as a soft sine, at its pitch, no louder than it is written', () => {
    for (const name of SOUND_NAMES) {
      const audio = pretendAudio();
      const sound = createSound(() => true, audio);
      sound.play(name);
      expect(audio.tones, name).toHaveLength(SOUNDS[name].length);
      SOUNDS[name].forEach((note, i) => {
        const tone = audio.tones[i];
        expect(tone?.type, name).toBe('sine');
        expect(tone?.hz[0], name).toBe(note.hz);
        expect(Math.max(...(tone?.peaks ?? [1])), name).toBeLessThanOrEqual(MAX_PEAK);
        expect(Math.max(...(tone?.peaks ?? [0])), name).toBeCloseTo(note.peak, 6);
        // It starts from silence and ends in silence: no click at either end.
        expect(tone?.peaks[0], name).toBeLessThan(0.001);
        expect(tone?.peaks.at(-1), name).toBeLessThan(0.001);
        expect((tone?.stop ?? 0) - (tone?.start ?? 0), name).toBeGreaterThanOrEqual(note.ring);
      });
    }
  });

  it('the chime is the chime', () => {
    const audio = pretendAudio();
    const sound = createSound(() => true, audio);
    sound.chime();
    expect(audio.tones.map((tone) => tone.hz[0])).toEqual(SOUNDS.chime.map((note) => note.hz));
  });

  it('lets the audio device go once the last note has died away, and takes it up again for the next sound', () => {
    const audio = pretendAudio();
    const sound = createSound(() => true, audio);
    sound.play('chime');
    audio.pass(0.5);
    expect(audio.log).toEqual([]);
    // A second sound before the first is over: the device is kept until both are done.
    sound.play('sparkle');
    audio.pass(1.0);
    expect(audio.log).toEqual([]);
    audio.pass(1.5);
    expect(audio.log).toEqual(['suspend']);
    expect(audio.pending()).toBe(0);
    sound.play('pop');
    expect(audio.log).toEqual(['suspend', 'resume']);
    expect(audio.created()).toBe(1);
    audio.pass(3);
    expect(audio.log).toEqual(['suspend', 'resume', 'suspend']);
  });

  it('switched off in the middle, it plays nothing more; disposed, it leaves no timer', () => {
    const audio = pretendAudio();
    let on = true;
    const sound = createSound(() => on, audio);
    sound.play('munch');
    const played = audio.tones.length;
    on = false;
    sound.play('yum');
    expect(audio.tones).toHaveLength(played);
    sound.dispose();
    expect(audio.pending()).toBe(0);
    expect(audio.log).toContain('close');
  });

  it('never throws: no audio at all, or audio that refuses', () => {
    const none = createSound(() => true, { createContext: () => { throw new Error('no audio device'); } });
    expect(() => none.play('chime')).not.toThrow();
    expect(() => none.dispose()).not.toThrow();
    // No Web Audio in this environment at all (a test without a browser).
    const bare = createSound(() => true);
    expect(() => bare.play('pop')).not.toThrow();
  });
});
