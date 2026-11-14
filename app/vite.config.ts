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
  },
});
