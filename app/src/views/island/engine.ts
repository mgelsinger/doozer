// Fetching the Island's 3D engine, and giving it back.
//
// The engine (three.js, the stage and the model's loader) is loaded into a hidden frame
// of its own, app/island-frame.html (frame.ts says why): a script the page has loaded
// stays loaded for as long as the page lives, and removing the frame is the one way to
// give the engine's own code and memory back when the Island is left.
//
// Never stuck: the frame is given a time limit, and whatever goes wrong the frame is
// removed and the loading fails, so the view can load the engine into the page instead.
// No DOM beyond the document it is handed, no three.js: the tests run it on a made-up one.

import type { DoozerModel } from '../../character/doozer3d';
import type { IslandEngine } from './frame';

/** The 3D engine and the model, and how to give the engine back when the view is left. */
export interface Loaded {
  stage: IslandEngine['stage'];
  model: DoozerModel;
  /** Gives back the engine itself. Called once, after everything made with it is disposed of. */
  release?(): void;
}

/** The frame is given this long to load and hand over its engine. */
export const FRAME_LIMIT_MS = 4000;

export interface FrameOptions {
  document: Document;
  /** The frame's page, and the model, as full addresses. */
  frameUrl: string;
  modelUrl: string;
  limitMs?: number;
  /** For the tests. */
  setTimeout?: (run: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

/** What the frame's page leaves on its window (frame.ts). */
interface FrameWindow { doozerIsland?: Promise<IslandEngine> }

export async function loadEngineInFrame(options: FrameOptions): Promise<Loaded> {
  const doc = options.document;
  const later = options.setTimeout ?? ((run, ms) => setTimeout(run, ms));
  const cancel = options.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const frame = doc.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none';

  let over = false;
  let giveUp: (error: Error) => void = () => undefined;
  const limit = new Promise<never>((_, reject) => { giveUp = reject; });
  const timer = later(() => giveUp(new Error('the frame took too long')), options.limitMs ?? FRAME_LIMIT_MS);
  const opened = new Promise<void>((resolve, reject) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    frame.addEventListener('error', () => reject(new Error('the frame did not load')), { once: true });
  });

  const fetching = (async (): Promise<Loaded> => {
    await opened;
    const engine = await (frame.contentWindow as unknown as FrameWindow | null)?.doozerIsland;
    if (!engine) throw new Error('the frame has no engine in it');
    const model = await engine.loadDoozerModel(options.modelUrl);
    // Too late: the frame is already gone, and this model goes after it.
    if (over) { model.dispose(); throw new Error('the frame took too long'); }
    return { stage: engine.stage, model, release: () => frame.remove() };
  })();
  // If the limit wins, nobody is left to hear how the fetching ends.
  fetching.catch(() => undefined);

  frame.src = options.frameUrl;
  doc.body.append(frame);
  try {
    return await Promise.race([fetching, limit]);
  } catch (error) {
    over = true;
    frame.remove();
    // An error from the frame is from another page's world: make it one of this page's.
    throw error instanceof Error ? error : new Error(String((error as { message?: unknown } | null)?.message ?? error));
  } finally {
    cancel(timer);
  }
}
