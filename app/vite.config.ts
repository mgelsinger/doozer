import { defineConfig } from 'vitest/config';

// `tauri dev` sets TAURI_ENV_PLATFORM for the dev command it launches. Only then
// is port 1420 mandatory (tauri.conf.json points at it). A plain `npm run dev`
// from another terminal simply takes the next free port.
const underTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: underTauri,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // Two pages: the app, and the frame the Island view loads its 3D engine into
    // (src/views/island/frame.ts).
    rollupOptions: { input: { index: 'index.html', 'island-frame': 'island-frame.html' } },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // Some tests play hours of pet time on a fake clock (the never-stuck matrices, the
    // soaks, every scene cut at every moment). They take a second or two on a quiet machine
    // and five or more on a busy one, which is what this machine usually is. What they
    // prove is in what they assert, not in how long the machine took over it: the limit is
    // only there to stop a test that hangs, and a hang is still a hang after thirty seconds.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
