// Ask a running copy of the app a question: evaluates an expression in its page over the
// browser's debugging port and prints the answer. For looking into a cloaked test run.
//
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9230'   (before starting the app)
//   node app/scripts/ask-page.mjs --port 9230 --eval "window.doozer.host.current()"
//   node app/scripts/ask-page.mjs --port 9230 --file question.js
//
// The expression may be a promise; what it resolves to is printed as JSON.

import { readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, i, all) => {
  if (word.startsWith('--')) pairs.push([word.slice(2), all[i + 1] ?? 'true']);
  return pairs;
}, []));
const port = Number(args.port ?? 9230);
const expression = args.file ? readFileSync(args.file, 'utf8') : String(args.eval ?? 'document.title');

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page' && !/island-frame/.test(t.url)) ?? targets[0];
if (!page) throw new Error('no page to ask');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
const answer = await new Promise((resolve) => {
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id === 1) resolve(message.result);
  });
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});
socket.close();
if (answer.exceptionDetails) {
  console.error('threw:', answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text);
  process.exit(1);
}
console.log(typeof answer.result.value === 'string' ? answer.result.value : JSON.stringify(answer.result.value, null, 2));
