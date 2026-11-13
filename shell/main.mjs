// Desktop shell for the mockups: floats any version over the real desktop in a
// transparent, frameless, always-on-top window whose empty areas let clicks through.
//
//   npm run pet              start with the Blob
//   npm run pet -- buddy     pocket | blob | buddy | room | pill
//
// This is a harness for trying the feel of each mockup. It is not the product shell
// (no tray, no autostart, no saved position) - see WORK_PLAN.md, Phase 3.

import { app, BrowserWindow, Menu, ipcMain, screen, shell as desktop } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { startServer, DEFAULT_PORT } from '../tools/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// `probe` is something solid in each page, used only by --selftest.
const VERSIONS = {
  pocket: { label: 'V1 · Pocket Doozer', dir: 'v1-pocket', w: 330, h: 450, probe: '#screen' },
  blob:   { label: 'V2 · Blob Doozer',   dir: 'v2-blob',   w: 420, h: 500, probe: '#c' },
  buddy:  { label: 'V3 · Desk Buddy',    dir: 'v3-buddy',  overlay: true,  probe: '#pet .hit' },
  room:   { label: 'V4 · Cozy Room',     dir: 'v4-room',   w: 430, h: 520, probe: '#scene' },
  pill:   { label: 'V5 · Pill Doozer',   dir: 'v5-pill',   w: 380, h: 610, dock: 'top', probe: '#pill' },
};

// Developer flags:
//   --capture=<file.png>  render for a few seconds, save a screenshot, quit
//   --selftest            check the page-to-shell click-through bridge, print JSON, quit
//   --dragtest            (buddy) pick Doozer up with injected mouse input, throw it, and
//                         check it is never left stuck; print JSON, quit
const args = process.argv.slice(1);
const capturePath = args.find((a) => a.startsWith('--capture='))?.slice('--capture='.length);
const selfTest = args.includes('--selftest');
const dragTest = args.includes('--dragtest');
const throughLog = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Developer runs get their own profile, so they never collide with (or touch the save of)
// a Doozer that is already running on the desktop.
if (capturePath || selfTest || dragTest) app.setPath('userData', path.join(app.getPath('temp'), 'doozer-shell-dev'));

// Test runs drive the page with injected input only. Their window stays fully pass-through
// to the real mouse: the person at the keyboard cannot disturb the test, and the test
// cannot swallow their clicks. The page's click-through requests are recorded, not applied.
const injectedInputOnly = selfTest || dragTest;
let current = args.find((a) => VERSIONS[a]) ?? 'blob';
let baseUrl = '';
let win = null;

function boundsFor(v) {
  const area = screen.getPrimaryDisplay().workArea;
  if (v.overlay) return { ...area };              // the whole work area: its bottom edge is the top of the taskbar
  if (v.dock === 'top') return { width: v.w, height: v.h, x: Math.round(area.x + (area.width - v.w) / 2), y: area.y };
  return { width: v.w, height: v.h, x: area.x + area.width - v.w - 28, y: area.y + area.height - v.h - 18 };
}

function openVersion(key) {
  current = key;
  const v = VERSIONS[key];
  const previous = win;
  const next = new BrowserWindow({
    ...boundsFor(v),
    title: 'Doozer',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), backgroundThrottling: false },
  });
  win = next;
  next.setAlwaysOnTop(true, 'floating');
  // Start fully click-through; the page switches this off while the cursor is over Doozer.
  next.setIgnoreMouseEvents(true, { forward: !injectedInputOnly });
  next.loadURL(`${baseUrl}mockups/${v.dir}/?bare`);
  next.once('ready-to-show', () => {
    next.showInactive();                           // never steal keyboard focus
    previous?.destroy();
  });
  next.on('closed', () => { if (win === next) win = null; });

  if (capturePath) {
    next.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await next.webContents.capturePage();
        await writeFile(capturePath, image.toPNG());
        app.quit();
      }, 4000);
    });
  }

  if (selfTest) {
    next.webContents.once('did-finish-load', async () => {
      await delay(2500);
      const wc = next.webContents;
      const at = await wc.executeJavaScript(`(() => {
        const r = document.querySelector(${JSON.stringify(v.probe)}).getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), bridge: typeof window.doozerShell, bare: document.documentElement.classList.contains('bare') };
      })()`);
      wc.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
      await delay(400);
      const overDoozer = throughLog.at(-1);
      wc.sendInputEvent({ type: 'mouseMove', x: 3, y: 3 });
      await delay(400);
      const overEmpty = throughLog.at(-1);
      // Expected: bridge "object", clickThroughOverDoozer false, clickThroughOverEmpty true.
      console.log(JSON.stringify({ version: key, bridge: at.bridge, bare: at.bare, clickThroughOverDoozer: overDoozer, clickThroughOverEmpty: overEmpty }));
      app.quit();
    });
  }

  if (dragTest) {
    next.webContents.once('did-finish-load', async () => {
      await delay(3000);
      const wc = next.webContents;
      const read = () => wc.executeJavaScript(`(() => {
        const p = document.getElementById('pet');
        const r = p.querySelector('.hit').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
          air: p.classList.contains('air'), held: p.classList.contains('is-held'), pose: p.querySelector('.dz').dataset.pose };
      })()`);
      // A fast, far drag: the case where the sprite lags a frame behind the cursor.
      const run = async (loseMouseUp) => {
        const a = await read();
        wc.sendInputEvent({ type: 'mouseMove', x: a.x, y: a.y });
        await delay(250);
        wc.sendInputEvent({ type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 });
        const mark = throughLog.length;
        for (let i = 1; i <= 12; i++) {
          wc.sendInputEvent({ type: 'mouseMove', x: a.x + i * 45, y: a.y - i * 35, button: 'left', modifiers: ['leftButtonDown'] });
          await delay(16);
        }
        const carried = await read();
        const wentPassThroughWhileCarried = throughLog.slice(mark).includes(true);
        const end = { x: a.x + 12 * 45, y: a.y - 12 * 35 };
        if (loseMouseUp) wc.sendInputEvent({ type: 'mouseMove', x: end.x + 6, y: end.y });   // button is up, but no mouse-up ever arrives
        else wc.sendInputEvent({ type: 'mouseUp', x: end.x, y: end.y, button: 'left', clickCount: 1 });
        await delay(4500);
        const after = await read();
        return { mouseUpLost: loseMouseUp, pickedUp: carried.held, wentPassThroughWhileCarried,
          backOnTheGround: !after.air && !after.held && after.pose !== 'held', poseAfter: after.pose };
      };
      const results = [await run(false), await run(true)];
      // Expected for both: pickedUp true, wentPassThroughWhileCarried false, backOnTheGround true.
      console.log(JSON.stringify({ version: key, dragTest: results }));
      app.quit();
    });
  }
}

function showMenu(target) {
  Menu.buildFromTemplate([
    ...Object.entries(VERSIONS).map(([key, v]) => ({
      label: v.label,
      type: 'radio',
      checked: key === current,
      click: () => { if (key !== current) openVersion(key); },
    })),
    { type: 'separator' },
    { label: 'Open the gallery in my browser', click: () => desktop.openExternal(`${baseUrl}mockups/`) },
    { type: 'separator' },
    { label: 'Quit Doozer', click: () => app.quit() },
  ]).popup({ window: target ?? undefined });
}

ipcMain.on('doozer:click-through', (event, on) => {
  throughLog.push(!!on);
  if (injectedInputOnly) return;
  BrowserWindow.fromWebContents(event.sender)?.setIgnoreMouseEvents(!!on, { forward: true });
});
ipcMain.on('doozer:menu', (event) => showMenu(BrowserWindow.fromWebContents(event.sender)));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win?.showInactive());
  app.whenReady().then(async () => {
    // The shell serves the mockups itself, on its own port, so it works whether or
    // not `npm run mockups` (or another copy of the shell) is also running.
    for (let port = DEFAULT_PORT + 1; !baseUrl && port < DEFAULT_PORT + 12; port++) {
      try {
        baseUrl = (await startServer(port)).url;
      } catch (err) {
        if (err.code !== 'EADDRINUSE') throw err;
      }
    }
    if (!baseUrl) { console.error('No free port for the mockup server.'); app.quit(); return; }
    openVersion(current);
  });
  app.on('window-all-closed', () => app.quit());
}
