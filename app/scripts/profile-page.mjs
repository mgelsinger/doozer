// Where does the page's own time go? Watches a running copy of the app for a while over the
// browser's debugging port and prints, for that stretch: how long the page's main thread was
// busy and on what (script, style, layout), how often, and which functions the script time
// was spent in. For finding what a state costs when nothing is drawn (docs/polish-checks.md).
//
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9231'   (before starting the app)
//   node app/scripts/profile-page.mjs --port 9231 --seconds 30 [--out result.json]
//
// It measures the page's main thread only: not the browser's own process, the graphics
// process or the shell, which measure-idle.ps1 counts.

import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, i, all) => {
  if (word.startsWith('--')) pairs.push([word.slice(2), all[i + 1] ?? 'true']);
  return pairs;
}, []));
const port = Number(args.port ?? 9231);
const seconds = Number(args.seconds ?? 30);

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page' && !/island-frame/.test(t.url)) ?? targets[0];
if (!page) throw new Error('no page to watch');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
let nextId = 1;
const waiting = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const resolve = waiting.get(message.id);
  if (resolve) { waiting.delete(message.id); resolve(message.result ?? message.error); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++;
  waiting.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

await send('Performance.enable');
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 200 });
const before = await metrics();
await send('Profiler.start');
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const { profile } = await send('Profiler.stop');
const after = await metrics();
socket.close();

const span = after.Timestamp - before.Timestamp;
const share = (name) => Number((((after[name] - before[name]) / span) * 100).toFixed(3));
const count = (name) => Math.round(after[name] - before[name]);

// Self time of each function, from the samples.
const self = new Map();
const byId = new Map(profile.nodes.map((node) => [node.id, node]));
const deltas = profile.timeDeltas ?? [];
profile.samples.forEach((id, i) => {
  const node = byId.get(id);
  if (!node) return;
  const frame = node.callFrame;
  const file = frame.url ? frame.url.replace(/^.*\//, '') : '';
  const key = `${frame.functionName || '(anonymous)'} ${file}${frame.lineNumber >= 0 && file ? `:${frame.lineNumber + 1}` : ''}`.trim();
  self.set(key, (self.get(key) ?? 0) + (deltas[i] ?? 0));
});
const total = (profile.endTime - profile.startTime) / 1000;
const functions = [...self.entries()]
  .filter(([name]) => !/^\((idle|program)\)/.test(name))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 25)
  .map(([name, micros]) => ({ name, ms: Number((micros / 1000).toFixed(1)), percentOfTime: Number(((micros / 1000 / total) * 100).toFixed(3)) }));
const idle = [...self.entries()].filter(([name]) => /^\(idle\)/.test(name)).reduce((sum, entry) => sum + entry[1], 0) / 1000;

const result = {
  seconds: Number(span.toFixed(1)),
  mainThreadPercent: { busy: share('TaskDuration'), script: share('ScriptDuration'), style: share('RecalcStyleDuration'), layout: share('LayoutDuration') },
  counts: { styleRecalcs: count('RecalcStyleCount'), layouts: count('LayoutCount') },
  perSecond: { styleRecalcs: Number((count('RecalcStyleCount') / span).toFixed(1)), layouts: Number((count('LayoutCount') / span).toFixed(1)) },
  profileIdlePercent: Number(((idle / total) * 100).toFixed(2)),
  functions,
};
if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
