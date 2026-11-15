// What is each process of a running copy of the app holding, by allocator? Asks the browser
// for one of its own memory dumps over the debugging port and prints the totals: the
// script heap, the page's own allocators, graphics memory, caches. For questions like
// "what does the page keep after the Island has been visited" (docs/polish-checks.md).
//
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9230'   (before starting the app)
//   node app/scripts/memory-dump.mjs --port 9230 [--label before] [--out dump.json] [--detail light|detailed]
//
// Sizes are megabytes as the allocators themselves account for them (what they have
// committed, and of that what is in use), not the working set Task Manager shows.

import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, i, all) => {
  if (word.startsWith('--')) pairs.push([word.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return pairs;
}, []));
const port = Number(args.port ?? 9230);

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
let next = 1;
const waiting = new Map();
const events = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && waiting.has(message.id)) {
    const { done, fail } = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.error) fail(new Error(message.error.message)); else done(message.result);
  } else if (message.method && events.has(message.method)) {
    events.get(message.method)(message.params);
    events.delete(message.method);
  }
});
const send = (method, params = {}) => new Promise((done, fail) => { const id = next++; waiting.set(id, { done, fail }); socket.send(JSON.stringify({ id, method, params })); });
const once = (method) => new Promise((done) => events.set(method, done));

await send('Tracing.start', {
  transferMode: 'ReturnAsStream',
  traceConfig: {
    includedCategories: ['disabled-by-default-memory-infra'],
    excludedCategories: ['*'],
    memoryDumpConfig: { triggers: [] },
  },
});
const dump = await send('Tracing.requestMemoryDump', { deterministic: args.gc === 'true', levelOfDetail: args.detail === 'light' ? 'light' : 'detailed' });
const complete = once('Tracing.tracingComplete');
await send('Tracing.end');
const { stream } = await complete;
let text = '';
for (;;) {
  const chunk = await send('IO.read', { handle: stream, size: 1 << 20 });
  text += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data;
  if (chunk.eof) break;
}
await send('IO.close', { handle: stream });
socket.close();

const parsed = JSON.parse(text);
const all = Array.isArray(parsed) ? parsed : parsed.traceEvents;
const names = new Map();
for (const e of all) if (e.ph === 'M' && e.name === 'process_name') names.set(e.pid, e.args?.name ?? '?');
const labels = new Map();
for (const e of all) if (e.ph === 'M' && e.name === 'process_labels') labels.set(e.pid, e.args?.labels ?? '');

const MB = 1024 * 1024;
const hex = (v) => (typeof v === 'string' ? Number.parseInt(v, 16) : Number(v ?? 0));
const processes = [];
for (const e of all) {
  if (e.ph !== 'v' || !e.args?.dumps) continue;
  const allocators = e.args.dumps.allocators ?? {};
  // Top-level allocators only ("malloc", "v8", "partition_alloc"...), each with what it holds.
  const roots = {};
  for (const [name, entry] of Object.entries(allocators)) {
    const attrs = entry.attrs ?? {};
    const size = attrs.size ? hex(attrs.size.value) : 0;
    const effective = attrs.effective_size ? hex(attrs.effective_size.value) : size;
    const root = name.split('/')[0];
    const depth = name.split('/').length;
    const r = (roots[root] ??= { size: 0, top: 0, parts: {} });
    if (depth === 1) { r.top = size; r.effective = effective; }
    if (depth === 2) r.parts[name.split('/')[1]] = size;
  }
  const totals = e.args.dumps.process_totals ?? {};
  const os = e.args.dumps.process_mmaps ? undefined : undefined;
  processes.push({
    pid: e.pid,
    name: names.get(e.pid) ?? `pid ${e.pid}`,
    label: labels.get(e.pid) ?? '',
    privateFootprintMB: totals.private_footprint_bytes ? +(hex(totals.private_footprint_bytes) / MB).toFixed(1) : undefined,
    residentMB: totals.resident_set_bytes ? +(hex(totals.resident_set_bytes) / MB).toFixed(1) : undefined,
    allocators: Object.fromEntries(Object.entries(roots)
      .map(([name, r]) => [name, { MB: +((r.top || Object.values(r.parts).reduce((a, b) => a + b, 0)) / MB).toFixed(2), parts: Object.fromEntries(Object.entries(r.parts).filter(([, v]) => v > 0.05 * MB).map(([k, v]) => [k, +(v / MB).toFixed(2)])) }])
      .filter(([, r]) => r.MB >= 0.05)
      .sort((a, b) => b[1].MB - a[1].MB)),
    os,
  });
}

const result = { label: args.label ?? '', at: new Date().toISOString(), dumpGuid: dump?.dumpGuid, processes };
if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 2));
for (const p of processes) {
  console.log(`\n${p.name}${p.label ? ` (${p.label})` : ''}  pid ${p.pid}  private ${p.privateFootprintMB ?? '?'} MB`);
  for (const [name, r] of Object.entries(p.allocators).slice(0, Number(args.rows ?? 12))) {
    const parts = Object.entries(r.parts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`  ${name.padEnd(22)} ${String(r.MB).padStart(8)} MB${parts ? `   (${parts})` : ''}`);
  }
}
