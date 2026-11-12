// Tiny synthesised sound effects - no audio files. Placeholder quality on purpose:
// Phase 8 replaces these with a real sound set.

const MUTE_KEY = 'doozer:muted';
let ctx = null;
let master = null;
let muted = false;
let disabled = false; // gallery thumbnails never make sound
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* ignore */ }

function audio() {
  if (disabled || muted) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    // Before the first click the browser keeps audio suspended; just stay silent.
    return ctx.state === 'running' ? ctx : null;
  } catch {
    return null;
  }
}

function tone({ f = 440, f2 = f, t = 0.12, type = 'sine', v = 0.5, delay = 0 }) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + t);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(v, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + t + 0.03);
}

function noise({ t = 0.06, v = 0.3, delay = 0, freq = 1800 }) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const len = Math.max(1, Math.floor(ac.sampleRate * t));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  const gain = ac.createGain();
  gain.gain.value = v;
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
}

export const sfx = {
  chirp() { tone({ f: 880, f2: 1320, t: 0.08, type: 'triangle' }); tone({ f: 1320, f2: 1760, t: 0.1, type: 'triangle', delay: 0.085 }); },
  coo() { tone({ f: 620, f2: 780, t: 0.16, type: 'sine', v: 0.4 }); },
  munch() { noise({ t: 0.07, freq: 1400 }); tone({ f: 260, f2: 180, t: 0.07, type: 'square', v: 0.18 }); },
  boing() { tone({ f: 210, f2: 520, t: 0.17, type: 'sine', v: 0.55 }); },
  pop() { tone({ f: 900, f2: 300, t: 0.06, type: 'sine', v: 0.5 }); },
  sparkle() { [1320, 1760, 2090, 2640].forEach((f, i) => tone({ f, t: 0.11, type: 'triangle', v: 0.3, delay: i * 0.06 })); },
  sad() { tone({ f: 520, f2: 310, t: 0.32, type: 'triangle', v: 0.35 }); },
  no() { tone({ f: 330, f2: 300, t: 0.09, type: 'triangle', v: 0.4 }); tone({ f: 270, f2: 240, t: 0.14, type: 'triangle', v: 0.4, delay: 0.11 }); },
  yawn() { tone({ f: 520, f2: 260, t: 0.5, type: 'sine', v: 0.3 }); },
  snore() { tone({ f: 120, f2: 90, t: 0.45, type: 'sawtooth', v: 0.08 }); },
  splash() { noise({ t: 0.22, freq: 2600, v: 0.2 }); },
  step() { noise({ t: 0.025, freq: 700, v: 0.08 }); },
  thud() { tone({ f: 140, f2: 60, t: 0.12, type: 'sine', v: 0.6 }); },
  /** Piezo-style beep for the LCD toy. */
  beep(f = 1568, t = 0.06, delay = 0) { tone({ f, f2: f, t, type: 'square', v: 0.16, delay }); },
  jingle() { [1047, 1319, 1568, 2093].forEach((f, i) => tone({ f, f2: f, t: 0.09, type: 'square', v: 0.14, delay: i * 0.09 })); },

  get muted() { return muted; },
  setMuted(value) {
    muted = !!value;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  },
  /** Permanently silence this page (gallery thumbnails). */
  disable() { disabled = true; },
};
