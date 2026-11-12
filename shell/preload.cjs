// Bridge between a mockup page and the desktop shell window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('doozerShell', {
  /** true = clicks fall through this window to whatever is underneath. */
  setClickThrough: (on) => ipcRenderer.send('doozer:click-through', !!on),
  /** Native right-click menu: switch version, open the gallery, quit. */
  showMenu: () => ipcRenderer.send('doozer:menu'),
});
