// Doozer's brain.
// Every mockup imports this file, so the pet behaves identically everywhere and
// only the presentation differs. No DOM access except localStorage for the save.

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** The four needs. `drain` is points per awake hour. */
export const NEEDS = {
  tummy:  { label: 'Tummy',  action: 'feed',  drain: 22, lowMood: 'hungry' },
  fun:    { label: 'Fun',    action: 'play',  drain: 26, lowMood: 'bored' },
  energy: { label: 'Energy', action: 'sleep', drain: 11, lowMood: 'sleepy' },
  clean:  { label: 'Clean',  action: 'wash',  drain: 8,  lowMood: 'dirty' },
};
export const NEED_KEYS = Object.keys(NEEDS);

/** First-guess numbers. Tune these in Phase 4, nowhere else. */
export const TUNING = {
  low: 30,              // below this Doozer starts asking
  urgent: 12,           // below this bond starts to drop
  sleepGain: 60,        // energy per hour asleep
  collapse: 4,          // falls asleep on its own at this energy
  messEveryHours: [1.5, 3],
  messAfterMealMinutes: [20, 45],
  maxMesses: 3,
  messDrain: 10,        // extra clean drain per hour, per mess
  bondGain: 2,          // per hour while well cared for
  bondLoss: 5,          // per hour while a need is urgent
  maxCatchUpHours: 12,
};

const SAVE_KEY = 'doozer:save:v1';
const SPEED_KEY = 'doozer:speed';

function ls(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable: the sim still runs, it just forgets */ }
  return null;
}

function freshState() {
  const now = Date.now();
  return {
    v: 1,
    name: 'Doozer',
    bornAt: now,
    lastSeen: now,
    age: 0, // sim seconds lived
    needs: { tummy: 72, fun: 64, energy: 80, clean: 88 },
    bond: 12,
    asleep: false,
    messes: 0,
    messIn: rand(...TUNING.messEveryHours) * 3600,
    treats: 3,
  };
}

export class PetSim extends EventTarget {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.persist] save to localStorage (off for gallery thumbnails)
   * @param {number} [opts.speed] sim seconds per real second
   */
  constructor({ persist = true, speed } = {}) {
    super();
    this.persist = persist;
    this.speed = speed ?? (Number(ls(SPEED_KEY)) || 60);
    this.state = (persist && this.#load()) || freshState();
    /** Set when Doozer was left alone for a while: { seconds } */
    this.away = null;
    this.#catchUp();
    this._mood = this.mood;
    this._levels = Object.fromEntries(NEED_KEYS.map((k) => [k, this.#level(k)]));
  }

  // ----- reading state ------------------------------------------------------

  get needs() { return this.state.needs; }
  get asleep() { return this.state.asleep; }
  get messes() { return this.state.messes; }
  get treats() { return this.state.treats; }
  get bond() { return this.state.bond; }
  /** 1..5 hearts */
  get bondLevel() { return Math.min(5, 1 + Math.floor(this.state.bond / 20)); }
  get wellbeing() {
    const n = this.state.needs;
    return NEED_KEYS.reduce((sum, k) => sum + n[k], 0) / NEED_KEYS.length;
  }
  get lowest() {
    const n = this.state.needs;
    const key = NEED_KEYS.reduce((a, b) => (n[a] <= n[b] ? a : b));
    return { key, value: n[key] };
  }
  /** asleep | hungry | bored | sleepy | dirty | joyful | content | meh */
  get mood() {
    if (this.state.asleep) return 'asleep';
    const low = this.lowest;
    if (low.value < TUNING.low) return NEEDS[low.key].lowMood;
    const avg = this.wellbeing;
    if (avg > 78) return 'joyful';
    if (avg > 50) return 'content';
    return 'meh';
  }
  get ageDays() { return this.state.age / 86400; }

  // ----- events -------------------------------------------------------------

  /** Subscribe; returns an unsubscribe function. Events: tick, change, mood, need, mess, action, refuse */
  on(type, fn) {
    const handler = (e) => fn(e.detail, e);
    this.addEventListener(type, handler);
    return () => this.removeEventListener(type, handler);
  }
  #emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ----- time ---------------------------------------------------------------

  start() {
    if (this._iv) return this;
    let last = performance.now();
    let sinceSave = 0;
    this._iv = setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 300);
      last = now;
      this.tick(dt);
      sinceSave += dt;
      if (sinceSave > 4) { sinceSave = 0; this.save(); }
    }, 200);
    addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    return this;
  }

  stop() { clearInterval(this._iv); this._iv = null; }

  setSpeed(speed) {
    this.speed = speed;
    if (this.persist) ls(SPEED_KEY, String(speed));
    this.#emit('change', {});
  }

  /** Advance by `realSeconds` of wall-clock time (scaled by the speed multiplier). */
  tick(realSeconds) {
    let remaining = realSeconds * this.speed;
    while (remaining > 0) {
      const step = Math.min(remaining, 300);
      this.#step(step, false);
      remaining -= step;
    }
    this.#notify();
    this.#emit('tick', {});
  }

  #step(dt, silent) {
    const s = this.state;
    const n = s.needs;
    const h = dt / 3600;
    s.age += dt;

    if (s.asleep) {
      n.energy = clamp(n.energy + TUNING.sleepGain * h);
      n.tummy = clamp(n.tummy - NEEDS.tummy.drain * 0.5 * h);
      n.fun = clamp(n.fun - NEEDS.fun.drain * 0.15 * h);
      n.clean = clamp(n.clean - NEEDS.clean.drain * 0.5 * h);
      if (n.energy >= 100) this.#setAsleep(false, 'rested', silent);
    } else {
      n.tummy = clamp(n.tummy - NEEDS.tummy.drain * h);
      n.fun = clamp(n.fun - NEEDS.fun.drain * h);
      n.energy = clamp(n.energy - NEEDS.energy.drain * h);
      n.clean = clamp(n.clean - (NEEDS.clean.drain + s.messes * TUNING.messDrain) * h);
      s.messIn -= dt;
      if (s.messIn <= 0) {
        s.messIn = rand(...TUNING.messEveryHours) * 3600;
        if (s.messes < TUNING.maxMesses) {
          s.messes++;
          if (!silent) this.#emit('mess', { count: s.messes });
        }
      }
      if (n.energy <= TUNING.collapse) this.#setAsleep(true, 'exhausted', silent);
    }

    const worst = Math.min(...NEED_KEYS.map((k) => n[k]));
    if (worst < TUNING.urgent) s.bond = clamp(s.bond - TUNING.bondLoss * h);
    else if (this.wellbeing > 60) s.bond = clamp(s.bond + TUNING.bondGain * h);
  }

  #catchUp() {
    const s = this.state;
    const elapsed = (Date.now() - s.lastSeen) / 1000;
    if (elapsed > 90) {
      // Away time always passes at real speed, whatever the review time-warp is set to.
      let remaining = Math.min(elapsed, TUNING.maxCatchUpHours * 3600);
      while (remaining > 0) {
        const step = Math.min(remaining, 300);
        this.#step(step, true);
        remaining -= step;
      }
      this.away = { seconds: elapsed };
    }
    s.lastSeen = Date.now();
  }

  #level(key) {
    const v = this.state.needs[key];
    return v < TUNING.urgent ? 'urgent' : v < TUNING.low ? 'low' : 'ok';
  }

  /** Fire mood / need events when something crossed a threshold. */
  #notify() {
    for (const key of NEED_KEYS) {
      const level = this.#level(key);
      if (level !== this._levels[key]) {
        const worse = level === 'urgent' || (level === 'low' && this._levels[key] === 'ok');
        this._levels[key] = level;
        if (worse && !this.state.asleep) this.#emit('need', { need: key, level });
      }
    }
    const mood = this.mood;
    if (mood !== this._mood) {
      const from = this._mood;
      this._mood = mood;
      this.#emit('mood', { mood, from });
    }
  }

  // ----- actions ------------------------------------------------------------

  #bump(delta) {
    const n = this.state.needs;
    for (const [k, v] of Object.entries(delta)) n[k] = clamp(n[k] + v);
  }
  #bond(v) { this.state.bond = clamp(this.state.bond + v); }
  #did(type, extra = {}) {
    this.#notify();
    this.#emit('action', { type, ...extra });
    this.#emit('change', {});
    return { ok: true };
  }
  #refuse(type, reason) {
    this.#emit('refuse', { type, reason });
    return { ok: false, reason };
  }
  #setAsleep(asleep, why, silent) {
    if (this.state.asleep === asleep) return;
    this.state.asleep = asleep;
    if (!silent) this.#emit('action', { type: asleep ? 'sleep' : 'wake', why });
  }

  /** @param {'meal'|'treat'} kind */
  feed(kind = 'meal') {
    const s = this.state;
    if (s.asleep) return this.#refuse('feed', 'asleep');
    if (kind === 'treat') {
      if (s.treats <= 0) return this.#refuse('feed', 'no-treats');
      s.treats--;
      this.#bump({ tummy: 10, fun: 16 });
      this.#bond(2);
    } else {
      if (s.needs.tummy > 94) return this.#refuse('feed', 'full');
      this.#bump({ tummy: 32 });
      this.#bond(1);
    }
    s.messIn = Math.min(s.messIn, rand(...TUNING.messAfterMealMinutes) * 60);
    return this.#did('feed', { kind });
  }

  play() {
    const s = this.state;
    if (s.asleep) return this.#refuse('play', 'asleep');
    if (s.needs.energy < 10) return this.#refuse('play', 'tired');
    this.#bump({ fun: 28, energy: -7, tummy: -4 });
    this.#bond(1.5);
    return this.#did('play');
  }

  wash() {
    const s = this.state;
    if (s.asleep) return this.#refuse('wash', 'asleep');
    s.needs.clean = 100;
    const cleared = s.messes;
    s.messes = 0;
    this.#bond(0.5);
    return this.#did('wash', { cleared });
  }

  /** Clean up one mess. */
  tidy() {
    const s = this.state;
    if (s.messes <= 0) return { ok: false, reason: 'nothing' };
    s.messes--;
    this.#bump({ clean: 8 });
    return this.#did('tidy', { left: s.messes });
  }

  /** A stroke or a poke. Works while asleep too (Doozer smiles in its sleep). */
  pet() {
    this.#bump({ fun: 3 });
    this.#bond(0.4);
    return this.#did('pet');
  }

  sleep() {
    if (this.state.asleep) return { ok: true };
    if (this.state.needs.energy > 92) return this.#refuse('sleep', 'not-sleepy');
    this.#setAsleep(true, 'tucked-in', false);
    this.#notify();
    this.#emit('change', {});
    return { ok: true };
  }

  wake() {
    if (!this.state.asleep) return { ok: true };
    this.#setAsleep(false, 'woken', false);
    this.#notify();
    this.#emit('change', {});
    return { ok: true };
  }

  toggleSleep() { return this.state.asleep ? this.wake() : this.sleep(); }

  /** Earned by focus sessions in the Pill mockup. */
  addTreats(n = 1) {
    this.state.treats += n;
    this.#emit('change', {});
  }

  // ----- persistence --------------------------------------------------------

  save() {
    if (!this.persist) return;
    this.state.lastSeen = Date.now();
    ls(SAVE_KEY, JSON.stringify(this.state));
  }

  #load() {
    try {
      const raw = ls(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data?.v !== 1 || !data.needs) return null;
      return { ...freshState(), ...data, needs: { ...freshState().needs, ...data.needs } };
    } catch {
      return null;
    }
  }

  // ----- review helpers (used by the mockup review panel only) --------------

  debugSetNeeds(values) {
    Object.assign(this.state.needs, values);
    this.#notify();
    this.#emit('change', {});
  }
  debugAddMess() {
    if (this.state.messes < TUNING.maxMesses) {
      this.state.messes++;
      this.#emit('mess', { count: this.state.messes });
      this.#emit('change', {});
    }
  }
  reset() {
    this.state = freshState();
    this.save();
    this.#notify();
    this.#emit('change', {});
  }
}

// ----- Doozer's voice ---------------------------------------------------------

export const LINES = {
  hungry: ['tummy rumbles…', 'snack? snack?', 'is it nom o’clock?', 'so… hungry…'],
  bored: ['play with me?', 'sooo bored…', 'wanna see me bounce?'],
  sleepy: ['*yaaawn*', 'eyes… heavy…', 'five more minutes…'],
  dirty: ['I’m a bit stinky…', 'bath time? maybe?', 'ew, me.'],
  joyful: ['best day ever!', 'I love it here ♥', 'wheee!', '♪ la la la ♪'],
  content: ['nice and cozy.', '♪ hmm hm ♪', 'this is nice.'],
  meh: ['hmm.', '…', 'could be better.'],
  asleep: ['zzz…', 'mmf… snacks…', 'zz… zzz…'],
  feed: ['nom nom nom!', 'yum!!', 'delicious ♥'],
  treat: ['a TREAT!!', 'ooh ooh ooh!', 'best. snack. ever.'],
  play: ['wheee!', 'again! again!', 'boing!'],
  wash: ['squeaky clean!', 'bubbles!!', 'so fresh ✨'],
  pet: ['hehe ♥', 'purrr…', 'that tickles!', '♥'],
  tidy: ['oops… thanks!', 'all tidy!'],
  mess: ['oops.', 'uh oh…', 'that wasn’t me.'],
  wake: ['good morning!', '*streeetch*', 'I’m up! I’m up!'],
  sleep: ['night night…', 'sleepy time…'],
  full: ['I’m stuffed!', 'no more, thanks!'],
  tired: ['too sleepy to play…'],
  'no-treats': ['all out of treats…'],
  'not-sleepy': ['not sleepy yet!'],
  'asleep-refuse': ['shhh… sleeping…', 'zzz… later…'],
  hello: ['hi hi!', 'oh! hello!', 'there you are!'],
  away: ['I missed you!', 'you’re back!!', 'where did you go?'],
  held: ['wheee?!', 'put me down! …or don’t.', 'I can see my house!'],
  land: ['oof!', 'ta-da!'],
};

/** A random line for a mood, action or refusal reason. */
export function say(kind) {
  return pick(LINES[kind] ?? LINES.content);
}

/** The line for a refused action. */
export function refusalLine(reason) {
  return say(reason === 'asleep' ? 'asleep-refuse' : reason);
}

export const MOOD_TEXT = {
  asleep: 'fast asleep',
  hungry: 'hungry',
  bored: 'bored',
  sleepy: 'sleepy',
  dirty: 'a bit grubby',
  joyful: 'overjoyed',
  content: 'content',
  meh: 'so-so',
};
