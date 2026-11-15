// Where does the time go when Doozer moves? Records a few seconds of the browser's own
// trace from a running copy of the app and adds it up per process, per thread and, for
// the page's main thread, per kind of work. See docs/polish-checks.md section 2.
//
// The app has to be started with the browser's debugging port open:
//
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9230'
//   ...start a test build, e.g. with DOOZER_SPIKE=app-polish-hold...
//   node app/scripts/trace-frames.mjs --port 9230 --seconds 10 [--out trace-summary.json] [--raw trace.json]
//
// Tracing costs time itself, so the absolute figures here read higher than the app's real
// cost (measure-idle.ps1 gives that). What this is for is the split: which thread, doing what.

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, i, all) => {
  if (word.startsWith('--')) pairs.push([word.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return pairs;
}, []));
const port = Number(args.port ?? 9230);
const seconds = Number(args.seconds ?? 10);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function browserSocket() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`no browser answering on port ${port}`);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let next = 1;
    const waiting = new Map();
    const listeners = new Map();
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const id = next++;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((done, fail) => waiting.set(id, { done, fail }));
      },
      once(method) { return new Promise((done) => listeners.set(method, done)); },
      close() { socket.close(); },
    }));
    socket.addEventListener('error', (event) => reject(new Error(`socket: ${event.message ?? 'error'}`)));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && waiting.has(message.id)) {
        const { done, fail } = waiting.get(message.id);
        waiting.delete(message.id);
        if (message.error) fail(new Error(message.error.message)); else done(message.result);
      } else if (message.method && listeners.has(message.method)) {
        const done = listeners.get(message.method);
        listeners.delete(message.method);
        done(message.params);
      }
    });
  });
}

const CATEGORIES = [
  'toplevel', 'cc', 'viz', 'gpu', 'blink', 'benchmark', 'devtools.timeline', 'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame', 'disabled-by-default-devtools.timeline.stack', 'ipc', 'mojom', 'v8',
].join(',');

const cdp = await connect(await browserSocket());
await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: CATEGORIES.split(','), recordMode: 'recordUntilFull' } });
await sleep(seconds * 1000);
const complete = cdp.once('Tracing.tracingComplete');
await cdp.send('Tracing.end');
const { stream } = await complete;
let text = '';
for (;;) {
  const chunk = await cdp.send('IO.read', { handle: stream, size: 1 << 20 });
  text += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data;
  if (chunk.eof) break;
}
await cdp.send('IO.close', { handle: stream });
cdp.close();

if (args.raw) (await import('node:fs')).writeFileSync(args.raw, text);
const parsed = JSON.parse(text);
const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;

// ---- adding it up -------------------------------------------------------------------

const processName = new Map();
const threadName = new Map();
for (const e of events) {
  if (e.ph !== 'M') continue;
  if (e.name === 'process_name') processName.set(e.pid, e.args?.name ?? '?');
  if (e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, e.args?.name ?? '?');
}

const complete_ = events.filter((e) => e.ph === 'X' && typeof e.dur === 'number');
let first = Infinity;
let last = -Infinity;
for (const e of complete_) {
  if (e.ts < first) first = e.ts;
  if (e.ts + e.dur > last) last = e.ts + e.dur;
}
const spanSeconds = (last - first) / 1e6;

// Per thread: the time of the outermost slices only (a task and what runs inside it are
// counted once), and per name everywhere, the slice's own total.
const byThread = new Map();
for (const e of complete_) {
  const key = `${e.pid}:${e.tid}`;
  if (!byThread.has(key)) byThread.set(key, []);
  byThread.get(key).push(e);
}

const threads = [];
const named = new Map();
for (const [key, list] of byThread) {
  list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  let top = 0;
  let topCpu = 0;
  let openUntil = -Infinity;
  for (const e of list) {
    const outer = e.ts >= openUntil;
    if (outer) {
      top += e.dur;
      topCpu += typeof e.tdur === 'number' ? e.tdur : e.dur;
      openUntil = e.ts + e.dur;
    }
    const nameKey = `${key}|${e.name}`;
    const entry = named.get(nameKey) ?? { key, name: e.name, count: 0, wall: 0, cpu: 0 };
    entry.count++;
    entry.wall += e.dur;
    entry.cpu += typeof e.tdur === 'number' ? e.tdur : e.dur;
    named.set(nameKey, entry);
  }
  const [pid] = key.split(':');
  threads.push({
    process: processName.get(Number(pid)) ?? `pid ${pid}`,
    thread: threadName.get(key) ?? key,
    key,
    cpuMsPerSecond: topCpu / 1000 / spanSeconds,
    wallMsPerSecond: top / 1000 / spanSeconds,
  });
}
threads.sort((a, b) => b.cpuMsPerSecond - a.cpuMsPerSecond);

const counts = new Map();
for (const e of events) {
  if (e.ph === 'X' || e.ph === 'I' || e.ph === 'i' || e.ph === 'R' || e.ph === 'B' || e.ph === 'b') counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
}
const count = (name) => counts.get(name) ?? 0;
const frames = {
  // What the page's main thread produced, what the compositor drew, and what was put on the screen.
  beginMainFrame: count('BeginMainThreadFrame') || count('ThreadProxy::BeginMainFrame') || count('ProxyMain::BeginMainFrame'),
  drawFrame: count('DrawFrame'),
  displayDraw: count('Display::DrawAndSwap'),
  swap: count('SwapBuffers') || count('Swap') || count('BufferPresented'),
  animationFrameFired: count('FireAnimationFrame'),
};

const busiest = threads.filter((t) => t.cpuMsPerSecond >= 0.2).slice(0, 14);
const detail = {};
for (const t of busiest) {
  detail[`${t.process} / ${t.thread}`] = [...named.values()]
    .filter((n) => n.key === t.key)
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 22)
    .map((n) => ({ name: n.name, perSecond: +(n.count / spanSeconds).toFixed(1), cpuMsPerSecond: +(n.cpu / 1000 / spanSeconds).toFixed(2), usEach: Math.round(n.cpu / n.count) }));
}

const summary = {
  seconds: +spanSeconds.toFixed(2),
  events: events.length,
  framesPerSecond: Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, +(v / spanSeconds).toFixed(1)])),
  totalCpuMsPerSecond: +threads.reduce((sum, t) => sum + t.cpuMsPerSecond, 0).toFixed(1),
  threads: busiest.map((t) => ({ process: t.process, thread: t.thread, cpuMsPerSecond: +t.cpuMsPerSecond.toFixed(2) })),
  detail,
};

if (args.out) (await import('node:fs')).writeFileSync(args.out, JSON.stringify(summary, null, 2));
console.log(`traced ${summary.seconds} s, ${summary.events} events`);
console.log('frames per second:', JSON.stringify(summary.framesPerSecond));
console.log(`all threads together: ${summary.totalCpuMsPerSecond} ms of processor time per second (10 ms = 1 % of one core)`);
console.table(summary.threads);
for (const [thread, rows] of Object.entries(detail).slice(0, Number(args.threads ?? 6))) {
  console.log(`\n${thread}`);
  console.table(rows.slice(0, Number(args.rows ?? 14)));
}
