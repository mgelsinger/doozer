// The view contract: what the host asks of a view, and what a view may ask of the host.
// (WORK_PLAN.md section 3, "The view contract"; DESIGN_SPEC.md section 10.)
//
// A view draws Doozer and forwards clicks. It never decides a rule (that is the brain),
// never changes the window itself and never talks to the save file (that is the host).

import type { Brain, Settings, ViewId } from '../core/contract';
import type { Region, Shell, WindowInfo, WindowMode } from '../shell';

/** What the host knows when it asks a view which window it wants. */
export interface WindowRequest {
  readonly settings: Readonly<Settings>;
  /**
   * Where the user last left this view's window, for a view that floats. Physical
   * screen pixels handed out by the shell: pass them back, do not calculate with them.
   */
  readonly position: { readonly x: number; readonly y: number } | null;
}

/** What a view may ask of the host. */
export interface HostServices {
  /** The views that exist in this build. The rest are "coming soon". */
  readonly availableViews: readonly ViewId[];
  /** The view on screen. */
  currentView(): ViewId;
  /** Move Doozer to another view. A view that is not built yet is ignored. */
  switchView(view: ViewId): void;
  /** The view's layout changed: the host reads `hitRegions()` again. Cheap; call it freely. */
  regionsChanged(): void;
  /** The answer to `window()` changed for a reason the host cannot see. */
  windowChanged(): void;
  /**
   * Let a click give the window keyboard focus (true), or never (false, the default).
   * Only while something really needs the keyboard: Doozer must not take focus from
   * the app the user is working in.
   */
  setFocusable(focusable: boolean): void;
  /** The native menu (the four views, Settings, Quit), at the pointer. */
  showMenu(): void;
  /** Save, then quit. */
  quit(): void;
  /** One soft chime, if sound is on. */
  chime(): void;
  /** True until this pet has been welcomed (it has just hatched). */
  needsWelcome(): boolean;
  /** The hatching has been shown. It will not be asked for again for this pet. */
  welcomed(): void;
}

export interface ViewContext {
  readonly brain: Brain;
  /**
   * The native bridge, for its events (`pointer-released` above all) and for dragging
   * a floating window. A view never calls `setWindowMode` or `setHitRegions`: it
   * answers `window()` and `hitRegions()` and the host does the rest.
   */
  readonly shell: Shell;
  readonly host: HostServices;
  /** The window as it is now. */
  readonly info: WindowInfo;
}

export interface View {
  readonly id: ViewId;
  /**
   * The settings that change this view's window (its dock, its size). When one of
   * them changes the host asks `window()` again and re-places the window.
   */
  readonly windowSettings?: readonly (keyof Settings)[];
  /** The window this view wants. Pure: asked before `mount` and again whenever it may have changed. */
  window(request: WindowRequest): WindowMode;
  /** Build the view inside `root`. The window already has the shape `window()` asked for. */
  mount(root: HTMLElement, context: ViewContext): void | Promise<void>;
  /** Release everything: timers, listeners, elements, GPU memory. */
  unmount(): void;
  /** Where the mouse should be caught, in CSS pixels. Everything else is click-through. */
  hitRegions(): Region[];
  /**
   * Doozer hops and pops out, before the window changes. The promise must settle;
   * the host stops waiting after a time limit either way.
   */
  leave?(): Promise<unknown>;
  /** Doozer pops in, after the view is on screen. The host does not wait for it. */
  enter?(): Promise<unknown>;
  /**
   * False: the window has been tucked away (a fullscreen app is in front). Stop every
   * timer and animation: a hidden window still runs them (docs/shell-spike.md 4.8).
   * True: it is back. Views start awake.
   */
  setAwake?(awake: boolean): void;
  /** The window was re-placed without a remount (dock, size or display changed). */
  windowChanged?(info: WindowInfo): void;
  /** The tray or the right-click menu asked for the settings. */
  openSettings?(): void;
}
