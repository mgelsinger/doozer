// Small DOM helpers for the kit. Nothing clever: the kit is a handful of static templates
// whose changing bits are painted through `memo`, so an unchanged value never touches the DOM.

export type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Create an element. `class`, `html` and `text` are special; `true` sets an empty attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, children: readonly (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'html') node.innerHTML = String(value);
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

/** Find a required descendant; a missing one is a programming error in the template. */
export function need<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`ui kit: missing ${selector}`);
  return found;
}

/**
 * Returns `paint(key, value, apply)`: runs `apply` only when `value` differs from the
 * last one painted under `key`. Keeps a four-times-a-second brain from touching the DOM
 * when what is on screen would not change.
 */
export function createMemo(): (key: string, value: unknown, apply: () => void) => void {
  const last = new Map<string, unknown>();
  return (key, value, apply) => {
    if (last.has(key) && last.get(key) === value) return;
    last.set(key, value);
    apply();
  };
}

/** A short "that didn't work" wiggle on a control. Finite, and skipped with motion reduced. */
export function nudge(node: Element, reduceMotion: boolean): void {
  if (reduceMotion || typeof node.animate !== 'function') return;
  node.animate(
    [{ translate: '0 0' }, { translate: '-3px 0' }, { translate: '3px 0' }, { translate: '-2px 0' }, { translate: '0 0' }],
    { duration: 260, easing: 'ease-in-out' },
  );
}

/** A quick "something landed here" pulse. Finite, and skipped with motion reduced. */
export function pulse(node: Element, reduceMotion: boolean): void {
  if (reduceMotion || typeof node.animate !== 'function') return;
  node.animate([{ scale: '1' }, { scale: '1.22' }, { scale: '.96' }, { scale: '1' }], { duration: 420, easing: 'ease-out' });
}
