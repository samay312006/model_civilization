// DOM construction helper used by every UI module. Kept dependency-free
// (no imports) so it can be used from the very first render call in
// main.ts without any wiring.

export const THEME_CSS_PATH = '/src/ui/theme.css';

/**
 * Contract signature verbatim. Builds an element of tag `tag`, sets every
 * key in `attrs` via setAttribute (mirroring 'class' onto className, which
 * setAttribute already does natively — documented here as the one attribute
 * every caller relies on), and appends `children` in order: strings become
 * text nodes, Nodes are appended directly.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (attrs !== undefined) {
    for (const [key, value] of Object.entries(attrs)) {
      element.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      element.appendChild(document.createTextNode(child));
    } else {
      element.appendChild(child);
    }
  }
  return element;
}
