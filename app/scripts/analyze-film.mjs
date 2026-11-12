// Reads a report from a filmed `cycle` run (see docs/shell-spike.md) and answers
// one question: during the mode switches, did anything ever reach the screen
// that should not have?
//
//   node app/scripts/analyze-film.mjs <report.json> [--json]
//
// How the film works. Flat magenta patches sit behind the places the window
// goes. A thread grabs those patches from the composed desktop as fast as it can
// and, for each grab, records the bounding box of everything that is not
// magenta, plus how many pixels are near-black or near-white. So each patch is
// always in exactly one "state": empty, or showing something with a given
// outline.
//
// What counts as clean. Each view, once settled, shows one outline in each
// patch. The only legitimate states are therefore "empty" and those settled
// outlines. Anything else that appears, even for a single grab, is a
// transitional picture: a half-drawn view, a view at the wrong size or in the
// wrong place, a black or white rectangle. This script lists every one.

import fs from 'node:fs';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('usage: node analyze-film.mjs <report.json> [--json]');
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const run = report.scenarios?.cycle;
const film = run?.capture;
if (!film) {
  console.error('this report has no filmed cycle run in it');
  process.exit(2);
}

const names = run.filmed.names;
const marks = film.marks;
const frames = film.frames;
const EMPTY = 'empty';
const keyOf = (rect) => (rect.bbox ? rect.bbox.join(',') : EMPTY);

// ---- One timeline of states per patch ---------------------------------------------

const timelines = names.map(() => []);
for (const frame of frames) {
  frame.rects.forEach((rect, i) => {
    const line = timelines[i];
    const key = keyOf(rect);
    const last = line[line.length - 1];
    if (last && last.key === key) {
      last.black = Math.max(last.black, rect.black);
      last.white = Math.max(last.white, rect.white);
      return;
    }
    if (last) last.end = frame.t;
    line.push({ key, start: frame.t, end: null, black: rect.black, white: rect.white, other: rect.other });
  });
}
const filmEnd = (frames[frames.length - 1]?.t ?? 0) + 1;
for (const line of timelines) if (line.length) line[line.length - 1].end ??= filmEnd;

const stateAt = (i, t) => {
  const line = timelines[i];
  let found = null;
  for (const segment of line) {
    if (segment.start <= t) found = segment;
    else break;
  }
  return found;
};

// ---- The switches, from the marks ---------------------------------------------------

const switches = [];
let current = null;
for (const mark of marks) {
  const [label, view] = mark.label.split(':');
  if (label === 'switch-begin') current = { view, begin: mark.t };
  else if (!current) continue;
  else if (label === 'blank-begin') current.blankBegin = mark.t;
  else if (label === 'native-bounds-begin') current.boundsBegin = mark.t;
  else if (label === 'native-bounds-end') current.boundsEnd = mark.t;
  else if (label === 'blank-end') current.blankEnd = mark.t;
  else if (label === 'switch-end') {
    current.end = mark.t;
    switches.push(current);
    current = null;
  }
}
switches.forEach((s, i) => (s.from = i > 0 ? switches[i - 1].view : null));

// ---- Settled outlines: what each view looks like once it has stopped changing -------

// A view counts as settled 200 ms after its switch ended (the run dwells 350 ms).
const settled = names.map(() => new Map()); // key -> Set of views
// How much near-black and near-white a settled outline normally contains. (Light
// colours can read as white: on an HDR desktop the capture brightens them.)
const usual = names.map(() => new Map()); // key -> { black, white }
for (const s of switches) {
  names.forEach((_, i) => {
    const state = stateAt(i, s.end + 200);
    if (!state) return;
    if (!settled[i].has(state.key)) settled[i].set(state.key, new Set());
    settled[i].get(state.key).add(s.view);
    const u = usual[i].get(state.key) ?? { black: 0, white: 0 };
    usual[i].set(state.key, { black: Math.max(u.black, state.black), white: Math.max(u.white, state.white) });
  });
}
// A view must settle to the same outline every time; if it does not, that is a finding too.
const outlinesPerView = {};
for (const s of switches) {
  names.forEach((_, i) => {
    const state = stateAt(i, s.end + 200);
    const slot = (outlinesPerView[`${s.view} / ${names[i]}`] ??= new Set());
    slot.add(state?.key ?? '?');
  });
}
const unstableViews = Object.entries(outlinesPerView).filter(([, set]) => set.size > 1).map(([name, set]) => ({ name, outlines: [...set] }));

// ---- Everything that is not empty and not a settled outline ---------------------------

const phaseOf = (t) => {
  const s = switches.find((sw) => t >= sw.begin - 1 && t <= sw.end + 120);
  if (!s) return { during: 'between switches' };
  const index = switches.indexOf(s);
  let step = 'after the new view was shown';
  if (s.boundsBegin !== undefined && t < s.boundsBegin) step = 'before the window changed';
  else if (s.boundsEnd !== undefined && s.blankEnd !== undefined && t < s.blankEnd) step = 'window changed, new view not yet shown';
  return { during: `switch ${index + 1} (${s.from ?? 'start'} to ${s.view})`, step, msAfterWindowChange: Math.round(t - (s.boundsEnd ?? s.begin)) };
};

const transitional = [];
const flashes = [];
timelines.forEach((line, i) => {
  for (const segment of line) {
    const duration = segment.end - segment.start;
    // A flash is a block of black or white well beyond what that view normally shows.
    const normal = usual[i].get(segment.key) ?? { black: 0, white: 0 };
    if (segment.black > normal.black * 1.05 + 400 || segment.white > normal.white * 1.05 + 400) {
      flashes.push({ patch: names[i], at: Math.round(segment.start), ms: +duration.toFixed(1), black: segment.black, white: segment.white, outline: segment.key, ...phaseOf(segment.start) });
    }
    if (segment.key === EMPTY || settled[i].has(segment.key)) continue;
    transitional.push({ patch: names[i], at: Math.round(segment.start), ms: +duration.toFixed(1), outline: segment.key, pixels: segment.other, ...phaseOf(segment.start) });
  }
});

// ---- Per switch: how long was nothing on screen, and was the old view gone in time? ---

const perSwitch = switches.map((s, index) => {
  // Was anything still showing at the instant the window was changed?
  const showingAtChange = names.map((_, i) => stateAt(i, s.boundsBegin ?? s.begin)?.key ?? EMPTY).some((k) => k !== EMPTY);
  // First grab after the change in which the new view's settled outline is on screen.
  let appeared = null;
  timelines.forEach((line, i) => {
    for (const segment of line) {
      if (segment.start < (s.boundsEnd ?? s.begin)) continue;
      if (segment.start > s.end + 400) break;
      if (settled[i].get(segment.key)?.has(s.view)) {
        appeared = appeared === null ? segment.start : Math.min(appeared, segment.start);
        break;
      }
    }
  });
  // Last grab before the change in which the old view was on screen.
  let vanished = null;
  if (s.from) {
    timelines.forEach((line, i) => {
      for (const segment of line) {
        if (segment.start > (s.blankEnd ?? s.end)) break;
        if (segment.key !== EMPTY && segment.end >= s.begin && segment.start <= (s.boundsBegin ?? s.end)) vanished = Math.max(vanished ?? 0, segment.end);
      }
    });
  }
  return {
    index: index + 1,
    from: s.from,
    to: s.view,
    oldViewGoneBeforeWindowChangedMs: vanished === null || s.boundsBegin === undefined ? null : +(s.boundsBegin - vanished).toFixed(1),
    oldViewStillOnScreenWhenWindowChanged: showingAtChange,
    requestToOnScreenMs: appeared === null ? null : +(appeared - s.begin).toFixed(1),
    nothingOnScreenMs: appeared === null || vanished === null ? null : +(appeared - vanished).toFixed(1),
  };
});

// Frames Windows composed but that were folded into a later grab. One that fell
// inside a switch is a frame of the switch nobody looked at.
const unseenDuringSwitches = frames
  .filter((f) => (f.unseen ?? 0) > 0 && switches.some((s) => f.t >= s.begin && f.t <= s.end + 60))
  .reduce((n, f) => n + f.unseen, 0);

const numbers = (pick) => perSwitch.map(pick).filter((v) => v !== null).sort((a, b) => a - b);
const summarise = (values) =>
  values.length
    ? { n: values.length, min: values[0], median: values[Math.floor(values.length / 2)], p95: values[Math.min(values.length - 1, Math.floor(values.length * 0.95))], max: values[values.length - 1] }
    : null;

const result = {
  film: {
    method: film.method ?? 'GDI screen copy',
    backdropAsFilmed: film.backdropAsFilmed ?? null,
    note: film.note ?? null,
    seconds: +(film.durationMs / 1000).toFixed(1),
    grabs: film.frameCount,
    composedFramesNotSeenOnTheirOwn: film.unseenFrames ?? null,
    ofWhichDuringASwitch: film.unseenFrames === undefined ? null : unseenDuringSwitches,
    grabsPerSecond: Math.round(film.framesPerSecond),
    longestGapBetweenGrabsMs: +film.longestGapMs.toFixed(1),
    gapsLongerThanOne120HzFrame: film.gapsOver8ms,
    distinctPicturesLogged: frames.length,
    imagesKept: film.saved.length,
  },
  switches: switches.length,
  settledOutlines: names.map((name, i) => ({ patch: name, outlines: [...settled[i]].map(([key, views]) => ({ outline: key, views: [...views] })) })),
  viewsThatDidNotSettleTheSameWayEveryTime: unstableViews,
  blackOrWhiteFlashes: flashes,
  transitionalPictures: transitional,
  oldViewStillOnScreenWhenWindowChanged: perSwitch.filter((s) => s.oldViewStillOnScreenWhenWindowChanged).length,
  oldViewGoneBeforeWindowChangedMs: summarise(numbers((s) => s.oldViewGoneBeforeWindowChangedMs)),
  requestToOnScreenMs: summarise(numbers((s) => s.requestToOnScreenMs)),
  nothingOnScreenMs: summarise(numbers((s) => s.nothingOnScreenMs)),
  perSwitch,
};

if (flags.includes('--json')) {
  console.log(JSON.stringify(result, null, 1));
} else {
  const f = result.film;
  console.log(`film: ${f.method}${f.note ? ` (${f.note})` : ''}; ${f.seconds} s, ${f.grabs} grabs (${f.grabsPerSecond}/s); backdrop as filmed ${JSON.stringify(f.backdropAsFilmed)}`);
  console.log(`      composed frames not seen on their own: ${f.composedFramesNotSeenOnTheirOwn ?? 'unknown (GDI cannot tell)'}, of which during a switch: ${f.ofWhichDuringASwitch ?? 'unknown'}`);
  console.log(`switches filmed: ${result.switches}`);
  for (const patch of result.settledOutlines) {
    console.log(`settled outlines in "${patch.patch}":`);
    for (const o of patch.outlines) console.log(`   ${o.outline.padEnd(22)} ${o.views.join(', ')}`);
  }
  console.log(`views that settled differently between visits: ${unstableViews.length}`);
  for (const u of unstableViews) console.log(`   ${u.name}: ${u.outlines.join(' | ')}`);
  console.log(`black or white flashes: ${flashes.length}`);
  for (const x of flashes.slice(0, 20)) console.log('  ', JSON.stringify(x));
  console.log(`transitional pictures: ${transitional.length}`);
  for (const x of transitional.slice(0, 40)) console.log('  ', JSON.stringify(x));
  console.log(`switches where the old view was still on screen when the window changed: ${result.oldViewStillOnScreenWhenWindowChanged}`);
  console.log('old view off screen this long before the window changed (ms, negative = after):', JSON.stringify(result.oldViewGoneBeforeWindowChangedMs));
  console.log('request to new view on screen (ms):', JSON.stringify(result.requestToOnScreenMs));
  console.log('nothing on screen during a switch (ms):', JSON.stringify(result.nothingOnScreenMs));
}
process.exit(flashes.length || transitional.length || unstableViews.length ? 1 : 0);
