// The Island's 3D engine, in a page of its own (app/island-frame.html).
//
// Why a frame: a script the page has loaded stays loaded for as long as the page lives.
// Disposing of the scene gives back what three.js drew and held, but not three.js. A
// frame is a small page inside the page, with a script world of its own; when the
// Island view is left it removes the frame, and the engine goes with it.
//
// The Island view (index.ts) opens this page in a hidden frame on mount and takes two
// things from it: the stage module, and the function that loads the model. Everything
// made with them lives in this frame's world; the canvas is handed to the app's own page
// to be shown. Nothing here is loaded until the frame is.

import type { loadDoozerModel } from '../../character/doozer3d';

export interface IslandEngine {
  stage: typeof import('./stage3d');
  loadDoozerModel: typeof loadDoozerModel;
}

// The only place three.js is imported for the app: here, when the frame has been opened.
const engine: Promise<IslandEngine> = Promise.all([import('./stage3d'), import('../../character/doozer3d')])
  .then(([stage, rig]) => ({ stage, loadDoozerModel: rig.loadDoozerModel }));

(window as unknown as { doozerIsland?: Promise<IslandEngine> }).doozerIsland = engine;
