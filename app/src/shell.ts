// Bridge to the native side: window mode, hit regions, save, tray.
// Everything a view needs from the operating system goes through this file, so
// views and the UI kit also run in a plain browser tab (where `native` is false).
//
// Stub: the real bridge is built in Phase 3 (shell spike).

export const shell = {
  /** True inside the Tauri window, false in a plain browser tab or under Vitest. */
  native: typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
};

export type Shell = typeof shell;
