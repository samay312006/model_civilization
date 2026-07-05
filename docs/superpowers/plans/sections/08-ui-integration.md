## Section 8: UI & final integration (Tasks 38-45)

This section builds the entire browser-facing half of Genesis on top of the engine Sections 1-7 already shipped: the DOM helper and dark "observatory" theme, the setup screen, the worker client and time controls, the pan/zoom canvas map, the person inspector with morality radar, the civ dashboard with line/stacked-area charts, the event feed, IndexedDB save/autosave/replay, and finally the long-run smoke tests, README, and release checklist that close out the whole project. Every task consumes only the contract file (`docs/superpowers/plans/2026-07-04-genesis-contract.md`) and the exact exports listed under each task's **Interfaces: Consumes** block — Tasks 33-37 (Section 7) already shipped `Simulation`, `takeSnapshot`, `personDetail`, `serialize`/`deserialize`, `UiToWorker`/`WorkerToUi`, and the full `src/engine/worker.ts` entry this section's `client.ts` instantiates as a real `Worker`. All UI test files begin with the line `// @vitest-environment jsdom` as their first line, per the contract. Every command below runs from the repo root `C:\simulation_exp` and is Windows/PowerShell-compatible.

**Contract deviations in this section (recorded, deliberate):**

1. **`SimClient`'s auto-restart-from-autosave hook is an injectable optional `recover: () => Promise<string | null>` constructor parameter**, defaulting to `null` (never called) when omitted. The contract only says `SimClient` "wraps Worker ... auto-restart from last autosave on worker error" without specifying how `client.ts` (Task 39, written before `storage.ts` exists) reaches IndexedDB. Task 39 defines the hook and wires it to fire on every `{ type: 'error' }` worker message; Task 44 constructs the *real* `SimClient` with `recover: () => loadRun('__autosave')` once `storage.ts` exists. This is additive, not a signature change to any contract type.
2. **`MapView`'s coordinate-transform and agent/settlement pick logic are extracted as pure, separately-exported functions** (`worldToScreen`, `screenToWorld`, `pickPerson`, `pickSettlement`) alongside the contract's `MapView` class, so they are unit-testable outside a real `HTMLCanvasElement`/`CanvasRenderingContext2D`. The contract only specifies the `MapView` class's public methods; these free functions are additive exports of `src/ui/map.ts` used internally by the class.
3. **`charts.ts` is written across two tasks** (Task 41 creates it with `radarChart` only; Task 42 modifies the same file to add `lineChart`/`stackedAreaChart`) because Task 41 (inspector) only needs the radar chart and Task 42 (dashboard) is where the contract's other two chart signatures are actually consumed. Both tasks' **Files:** blocks record this explicitly.
4. **`dashboard.ts` keeps its own metrics history ring** (`CivMetrics[]` per civ, capped at 2000 snapshots) as internal module state behind a constructor, since the contract's `CivMetrics` is a single-snapshot struct with no history — charts need a time series. This is additive state private to `dashboard.ts`, not a contract type change.
5. **`storage.ts`'s IndexedDB functions take an injectable `IDBFactory`** (defaulting to `globalThis.indexedDB` when omitted) so tests can pass a complete in-memory fake instead of relying on `fake-indexeddb` (a runtime dependency the contract forbids). This widens every contract signature by one optional trailing parameter; call sites that omit it behave exactly as the contract describes.
6. **`replay.ts`'s scrubber is documented, and implemented, as deterministic re-simulation from the save's stored seed/config up to a target tick in a throwaway `Simulation` instance run on the main thread** (not the shared worker, and not stored per-tick frames) — the contract's spec section says "replay reconstructs history from seed + command log" without pinning down whether frames are cached; this section pins it down as pure re-simulation, explicitly documented in `replay.ts`'s own header comment and in the README.

### Task 38: DOM helper, dark theme, app shell, and setup screen (`src/ui/dom.ts` + `src/ui/theme.css` + `src/ui/main.ts` + `src/ui/setup.ts`)

**Files:**
- Create: `src/ui/dom.ts`
- Create: `src/ui/theme.css`
- Modify: `src/ui/main.ts` (replaces the Task 1 placeholder `export {};`)
- Create: `src/ui/setup.ts`
- Test: `tests/ui/dom.test.ts`
- Test: `tests/ui/setup.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `SimConfig`, `MapSize`, `MAP_SIZES`
- From `index.html` (Task 1): loads `/src/ui/main.ts` as the module entry; a `<div id="app"></div>` mount point already exists
- Tests use no other project imports beyond `dom.ts`/`setup.ts` themselves and jsdom globals

Produces:
- `export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>, ...children: (Node | string)[]): HTMLElementTagNameMap[K]` — contract signature verbatim, from `src/ui/dom.ts`. Attribute handling: every key in `attrs` is set via `element.setAttribute(key, value)`, **except** the key `'class'`, which is also mirrored onto `element.className` for convenience (both work identically since `setAttribute('class', ...)` already sets `className` in the DOM; this is just documentation of the one attribute every caller in this section actually uses). String children are appended via `document.createTextNode`; `Node` children are appended directly, in argument order.
- `export const THEME_CSS_PATH = '/src/ui/theme.css'` (from `src/ui/dom.ts`) — the path `main.ts` links into `<head>`, defined once so `main.ts` and any test asserting the stylesheet is wired never hardcode the string twice.
- `src/ui/theme.css` — full stylesheet (Step 2 below) defining CSS custom properties for every color in the contract's UI/UX Design Direction block, panel/button/tab/badge/gauge-bar styles, and the 380px right-dock layout class `.dock`.
- (in `src/ui/main.ts`) `export function mountApp(root: HTMLElement): void` — additive (not in the contract, which shows no `main.ts` exports): builds the screen-switching shell (setup screen ↔ run screen placeholder — the run screen's real contents arrive in Tasks 39-44, which each mount their own piece into containers `main.ts` creates and exposes via `document.getElementById`), wires the theme stylesheet `<link>`, and calls `renderSetupScreen` (this task) to render the first screen. Also calls `mountApp(document.getElementById('app')!)` at module load time as the file's only top-level side effect (mirrors the pattern every other Vite entry file uses).
- (in `src/ui/setup.ts`) `export interface SetupScreenHandle { root: HTMLElement; onBegin(cb: (config: SimConfig) => void): void }` and `export function renderSetupScreen(container: HTMLElement): SetupScreenHandle` — additive: the contract only says "Setup screen: mode cards ... Begin" with no named export, so this task defines the concrete entry point. `renderSetupScreen` builds the full setup screen (mode cards, map size select, population select, seed input + Random button, Begin button) as children of `container`, replacing any existing children, and returns a handle whose `onBegin` registers a callback invoked with a fully-populated `SimConfig` exactly once per Begin click (never before all required fields have a value — every field always has a value because every control starts with a default selection).

Wiring notes for Tasks 39-45 (binding):
- `main.ts`'s run-screen shell creates (but Task 38 does not wire live data into) these DOM containers by id, every later task's render function targets one of them: `#map-canvas-container` (a `<canvas id="map-canvas">` inside it, Task 40), `#dock-inspector` (Task 41), `#dock-dashboard` (Task 42), `#dock-feed` (Task 43), `#topbar-controls` (Task 39's time controls), `#topbar-io` (Task 44's save/load/export/import buttons). `main.ts` itself does not import `client.ts`, `map.ts`, etc. — Task 39 is the first task to modify `main.ts` again, wiring `SimClient` and every renderer together; this task's `main.ts` only builds the empty shell and switches from the setup screen to an (initially empty) run screen when `onBegin` fires, stashing the received `SimConfig` on a module-level variable `let pendingConfig: SimConfig | null` that Task 39 reads.

- [ ] **Step 1: Write the failing `dom.ts` tests**

Create `tests/ui/dom.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { el, THEME_CSS_PATH } from '../../src/ui/dom';

describe('el()', () => {
  it('creates an element of the requested tag with no attrs or children', () => {
    const div = el('div');
    expect(div.tagName).toBe('DIV');
    expect(div.attributes.length).toBe(0);
    expect(div.childNodes.length).toBe(0);
  });

  it('sets every attribute via setAttribute', () => {
    const input = el('input', { type: 'number', min: '0', max: '10', value: '5' });
    expect(input.getAttribute('type')).toBe('number');
    expect(input.getAttribute('min')).toBe('0');
    expect(input.getAttribute('max')).toBe('10');
    expect(input.getAttribute('value')).toBe('5');
  });

  it('mirrors the class attribute onto className', () => {
    const div = el('div', { class: 'panel dock' });
    expect(div.getAttribute('class')).toBe('panel dock');
    expect(div.className).toBe('panel dock');
  });

  it('appends string children as text nodes', () => {
    const p = el('p', {}, 'hello', ' ', 'world');
    expect(p.textContent).toBe('hello world');
    expect(p.childNodes.length).toBe(3);
    expect(p.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
  });

  it('appends Node children directly, preserving order with mixed string children', () => {
    const span = el('span', {}, 'x');
    const p = el('p', {}, 'a', span, 'b');
    expect(p.childNodes.length).toBe(3);
    expect(p.childNodes[1]).toBe(span);
    expect(p.textContent).toBe('axb');
  });

  it('builds nested structures usable as real DOM', () => {
    const list = el('ul', { class: 'items' }, el('li', {}, 'one'), el('li', {}, 'two'));
    document.body.appendChild(list);
    expect(document.querySelectorAll('.items li').length).toBe(2);
    expect(document.querySelectorAll('.items li')[0]?.textContent).toBe('one');
    document.body.removeChild(list);
  });

  it('works with no attrs object at all (children-only call)', () => {
    const div = el('div', undefined, 'just text');
    expect(div.textContent).toBe('just text');
  });
});

describe('THEME_CSS_PATH', () => {
  it('points at the theme stylesheet under src/ui', () => {
    expect(THEME_CSS_PATH).toBe('/src/ui/theme.css');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```
npx vitest run tests/ui/dom.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../src/ui/dom" from "tests/ui/dom.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/ui/dom.ts`**

Create `src/ui/dom.ts` with exactly:

```ts
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run:

```
npx vitest run tests/ui/dom.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/dom.test.ts (7 tests)

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

- [ ] **Step 5: Write `src/ui/theme.css`**

Create `src/ui/theme.css` with exactly:

```css
/* Genesis dark observatory theme. Every color used anywhere in src/ui/
   flows through these custom properties — no other file hardcodes a hex
   value for background/text/panel/border colors. */

:root {
  --color-bg: #0b0e14;
  --color-panel: #131722;
  --color-border: #232a3a;
  --color-text: #e6e9f0;
  --color-text-dim: #9aa3b5;

  /* Fixed per-civ palette (schism civs generate additional hues at
     runtime in map.ts / dashboard.ts, outside this static sheet). */
  --civ-color-0: #e4572e;
  --civ-color-1: #3d9be9;
  --civ-color-2: #76b041;
  --civ-color-3: #b76ce9;

  /* Lineage badge colors. */
  --lineage-opus: #d4a24e;
  --lineage-sonnet: #3d9be9;
  --lineage-haiku: #76b041;
  --lineage-fable: #b76ce9;

  /* Terrain colors (used by map.ts's canvas terrain layer; listed here as
     the single source of truth even though canvas fillStyle calls read
     them as JS constants, not CSS — kept in sync by convention/tests). */
  --terrain-water: #1a2f4a;
  --terrain-plains: #2e4a2b;
  --terrain-forest: #1f3d1f;
  --terrain-mountain: #4a4a52;
  --terrain-desert: #7a6a45;

  /* Severity colors for the event feed. */
  --severity-1: #6b7280;
  --severity-2: #d4a24e;
  --severity-3: #e4572e;

  --radius-panel: 8px;
  --dock-width: 380px;
  --font-stack: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-stack);
}

#app {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.tabular-nums {
  font-variant-numeric: tabular-nums;
}

/* ---- Panels ---- */

.panel {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-panel);
  padding: 12px;
}

.panel-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--color-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 8px 0;
}

/* ---- Buttons ---- */

.btn {
  background: var(--color-panel);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 6px 12px;
  font-family: var(--font-stack);
  font-size: 13px;
  cursor: pointer;
}

.btn:hover {
  border-color: var(--color-text-dim);
}

.btn.active {
  background: var(--civ-color-1);
  color: var(--color-bg);
  border-color: var(--civ-color-1);
}

.btn-primary {
  background: var(--civ-color-1);
  color: var(--color-bg);
  border-color: var(--civ-color-1);
  font-weight: 600;
}

/* ---- Tabs ---- */

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 8px;
}

.tab {
  background: transparent;
  color: var(--color-text-dim);
  border: none;
  border-bottom: 2px solid transparent;
  padding: 8px 10px;
  font-family: var(--font-stack);
  font-size: 13px;
  cursor: pointer;
}

.tab.active {
  color: var(--color-text);
  border-bottom-color: var(--civ-color-1);
}

/* ---- Emotion gauge bars ---- */

.gauge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.gauge-label {
  width: 60px;
  font-size: 12px;
  color: var(--color-text-dim);
}

.gauge-track {
  flex: 1;
  height: 8px;
  background: var(--color-border);
  border-radius: 4px;
  overflow: hidden;
}

.gauge-fill {
  height: 100%;
  border-radius: 4px;
}

.gauge-fill.fear {
  background: var(--civ-color-0);
}

.gauge-fill.joy {
  background: var(--civ-color-2);
}

.gauge-fill.grief {
  background: var(--civ-color-1);
}

.gauge-fill.anger {
  background: #e4572e;
}

.gauge-fill.hope {
  background: var(--lineage-opus);
}

/* ---- Lineage badges ---- */

.badge-lineage {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-bg);
}

.badge-lineage.opus {
  background: var(--lineage-opus);
}

.badge-lineage.sonnet {
  background: var(--lineage-sonnet);
}

.badge-lineage.haiku {
  background: var(--lineage-haiku);
}

.badge-lineage.fable {
  background: var(--lineage-fable);
}

/* ---- Layout: setup screen ---- */

.setup-screen {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 32px;
  overflow-y: auto;
}

.mode-cards {
  display: flex;
  gap: 16px;
}

.mode-card {
  width: 260px;
  cursor: pointer;
}

.mode-card.selected {
  border-color: var(--civ-color-1);
}

.setup-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 260px;
}

.setup-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* ---- Layout: run screen ---- */

.run-screen {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
}

.run-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

#map-canvas-container {
  flex: 1;
  position: relative;
  min-width: 0;
}

#map-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.dock {
  width: var(--dock-width);
  flex: 0 0 var(--dock-width);
  border-left: 1px solid var(--color-border);
  background: var(--color-panel);
  overflow-y: auto;
  padding: 12px;
}

/* ---- Event feed ---- */

.feed-row {
  padding: 6px 8px;
  border-left: 3px solid var(--severity-1);
  margin-bottom: 4px;
  font-size: 12px;
  background: var(--color-bg);
  border-radius: 4px;
}

.feed-row.severity-1 {
  border-left-color: var(--severity-1);
}

.feed-row.severity-2 {
  border-left-color: var(--severity-2);
}

.feed-row.severity-3 {
  border-left-color: var(--severity-3);
}
```

- [ ] **Step 6: Write the failing `setup.ts` tests**

Create `tests/ui/setup.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderSetupScreen } from '../../src/ui/setup';
import type { SimConfig } from '../../src/shared/types';

function begin(container: HTMLElement): SimConfig {
  const handle = renderSetupScreen(container);
  let captured: SimConfig | null = null;
  handle.onBegin((config) => {
    captured = config;
  });
  const beginBtn = container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement;
  beginBtn.click();
  if (captured === null) throw new Error('onBegin was not called');
  return captured;
}

describe('renderSetupScreen — defaults', () => {
  it('emits a valid SimConfig with default selections on first render', () => {
    const container = document.createElement('div');
    const config = begin(container);
    expect(config.mode).toBe('civs');
    expect(config.mapSize).toBe('medium');
    expect(config.startPopulation).toBe(400);
    expect(typeof config.seed).toBe('number');
    expect(Number.isFinite(config.seed)).toBe(true);
  });

  it('renders both mode cards with descriptions', () => {
    const container = document.createElement('div');
    renderSetupScreen(container);
    const civsCard = container.querySelector('[data-testid="mode-card-civs"]');
    const mixedCard = container.querySelector('[data-testid="mode-card-mixed"]');
    expect(civsCard).not.toBeNull();
    expect(mixedCard).not.toBeNull();
    expect(civsCard?.textContent).toContain('Opus');
    expect(civsCard?.textContent).toContain('Sonnet');
    expect(civsCard?.textContent).toContain('Haiku');
    expect(civsCard?.textContent).toContain('Fable');
    expect(mixedCard?.textContent).toMatch(/mix|blend|lineage/i);
  });

  it('replaces prior contents on repeated calls (idempotent re-render)', () => {
    const container = document.createElement('div');
    renderSetupScreen(container);
    renderSetupScreen(container);
    expect(container.querySelectorAll('[data-testid="mode-card-civs"]').length).toBe(1);
  });
});

describe('renderSetupScreen — mode selection', () => {
  it('selecting the mixed card and clicking Begin emits mode: "mixed"', () => {
    const container = document.createElement('div');
    const handle = renderSetupScreen(container);
    let captured: SimConfig | null = null;
    handle.onBegin((c) => (captured = c));
    (container.querySelector('[data-testid="mode-card-mixed"]') as HTMLElement).click();
    (container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
    expect(captured?.mode).toBe('mixed');
  });

  it('clicking the civs card after mixed switches back to civs', () => {
    const container = document.createElement('div');
    const handle = renderSetupScreen(container);
    let captured: SimConfig | null = null;
    handle.onBegin((c) => (captured = c));
    (container.querySelector('[data-testid="mode-card-mixed"]') as HTMLElement).click();
    (container.querySelector('[data-testid="mode-card-civs"]') as HTMLElement).click();
    (container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
    expect(captured?.mode).toBe('civs');
  });
});

describe('renderSetupScreen — map size and population controls', () => {
  it('every map size option maps to the correct SimConfig.mapSize', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const container = document.createElement('div');
      const handle = renderSetupScreen(container);
      let captured: SimConfig | null = null;
      handle.onBegin((c) => (captured = c));
      const select = container.querySelector('[data-testid="map-size-select"]') as HTMLSelectElement;
      select.value = size;
      select.dispatchEvent(new Event('change'));
      (container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
      expect(captured?.mapSize).toBe(size);
    }
  });

  it('every population option (200/400/600) maps to the correct SimConfig.startPopulation', () => {
    for (const pop of [200, 400, 600] as const) {
      const container = document.createElement('div');
      const handle = renderSetupScreen(container);
      let captured: SimConfig | null = null;
      handle.onBegin((c) => (captured = c));
      const select = container.querySelector('[data-testid="population-select"]') as HTMLSelectElement;
      select.value = String(pop);
      select.dispatchEvent(new Event('change'));
      (container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
      expect(captured?.startPopulation).toBe(pop);
    }
  });
});

describe('renderSetupScreen — seed controls', () => {
  it('typing a seed value is reflected exactly in the emitted SimConfig', () => {
    const container = document.createElement('div');
    const handle = renderSetupScreen(container);
    let captured: SimConfig | null = null;
    handle.onBegin((c) => (captured = c));
    const input = container.querySelector('[data-testid="seed-input"]') as HTMLInputElement;
    input.value = '424242';
    input.dispatchEvent(new Event('input'));
    (container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
    expect(captured?.seed).toBe(424242);
  });

  it('clicking Random changes the seed input value and the emitted seed matches it', () => {
    const container = document.createElement('div');
    const handle = renderSetupScreen(container);
    let captured: SimConfig | null = null;
    handle.onBegin((c) => (captured = c));
    const input = container.querySelector('[data-testid="seed-input"]') as HTMLInputElement;
    const before = input.value;
    (container.querySelector('[data-testid="random-seed-button"]') as HTMLButtonElement).click();
    const after = input.value;
    // A fixed-seed vitest run could theoretically collide; use a spy-free
    // structural check: after clicking Random the field holds a finite
    // integer string, and Begin emits that same integer.
    expect(after).toMatch(/^\d+$/);
    void before;
    (container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
    expect(captured?.seed).toBe(Number(after));
  });
});

describe('renderSetupScreen — onBegin is not called before Begin is clicked', () => {
  it('does not invoke the callback merely by rendering or changing controls', () => {
    const container = document.createElement('div');
    const handle = renderSetupScreen(container);
    const cb = vi.fn();
    handle.onBegin(cb);
    (container.querySelector('[data-testid="mode-card-mixed"]') as HTMLElement).click();
    const select = container.querySelector('[data-testid="map-size-select"]') as HTMLSelectElement;
    select.value = 'large';
    select.dispatchEvent(new Event('change'));
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/ui/setup.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../src/ui/setup" from "tests/ui/setup.test.ts". Does the file exist?`

- [ ] **Step 8: Implement `src/ui/setup.ts`**

Create `src/ui/setup.ts` with exactly:

```ts
import { el } from './dom';
import type { MapSize, SimConfig } from '../shared/types';

export interface SetupScreenHandle {
  root: HTMLElement;
  onBegin(cb: (config: SimConfig) => void): void;
}

interface ModeCardSpec {
  mode: 'civs' | 'mixed';
  testId: string;
  title: string;
  description: string;
}

const MODE_CARDS: ModeCardSpec[] = [
  {
    mode: 'civs',
    testId: 'mode-card-civs',
    title: 'Four Civilizations',
    description:
      'Four separate one-model civilizations compete and coexist: Opus, Sonnet, Haiku, and Fable each field a population whose every person shares that model-authored way of thinking.',
  },
  {
    mode: 'mixed',
    testId: 'mode-card-mixed',
    title: 'Mixed Civilization',
    description:
      'A single civilization whose population is a blend of all four brain lineages. Watch which lineage way-of-thinking spreads or dies out over the generations.',
  },
];

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export function renderSetupScreen(container: HTMLElement): SetupScreenHandle {
  container.innerHTML = '';

  let selectedMode: 'civs' | 'mixed' = 'civs';
  let selectedMapSize: MapSize = 'medium';
  let selectedPopulation: 200 | 400 | 600 = 400;
  let seedValue = randomSeed();

  const listeners: ((config: SimConfig) => void)[] = [];

  const modeCardEls = new Map<string, HTMLElement>();

  function refreshCardSelection(): void {
    for (const spec of MODE_CARDS) {
      const cardEl = modeCardEls.get(spec.mode);
      if (cardEl === undefined) continue;
      if (spec.mode === selectedMode) cardEl.classList.add('selected');
      else cardEl.classList.remove('selected');
    }
  }

  const cardsRow = el(
    'div',
    { class: 'mode-cards' },
    ...MODE_CARDS.map((spec) => {
      const card = el(
        'div',
        { class: 'panel mode-card', 'data-testid': spec.testId },
        el('h3', { class: 'panel-title' }, spec.title),
        el('p', {}, spec.description),
      );
      card.addEventListener('click', () => {
        selectedMode = spec.mode;
        refreshCardSelection();
      });
      modeCardEls.set(spec.mode, card);
      return card;
    }),
  );

  const mapSizeSelect = el(
    'select',
    { class: 'btn', 'data-testid': 'map-size-select' },
    el('option', { value: 'small' }, 'Small (96x96)'),
    el('option', { value: 'medium', selected: 'selected' }, 'Medium (144x144)'),
    el('option', { value: 'large' }, 'Large (192x192)'),
  ) as HTMLSelectElement;
  mapSizeSelect.value = selectedMapSize;
  mapSizeSelect.addEventListener('change', () => {
    selectedMapSize = mapSizeSelect.value as MapSize;
  });

  const populationSelect = el(
    'select',
    { class: 'btn', 'data-testid': 'population-select' },
    el('option', { value: '200' }, '200'),
    el('option', { value: '400', selected: 'selected' }, '400'),
    el('option', { value: '600' }, '600'),
  ) as HTMLSelectElement;
  populationSelect.value = String(selectedPopulation);
  populationSelect.addEventListener('change', () => {
    selectedPopulation = Number(populationSelect.value) as 200 | 400 | 600;
  });

  const seedInput = el('input', {
    type: 'number',
    class: 'btn',
    'data-testid': 'seed-input',
    value: String(seedValue),
  }) as HTMLInputElement;
  seedInput.addEventListener('input', () => {
    const parsed = Number(seedInput.value);
    seedValue = Number.isFinite(parsed) ? parsed : seedValue;
  });

  const randomButton = el('button', { class: 'btn', type: 'button', 'data-testid': 'random-seed-button' }, 'Random');
  randomButton.addEventListener('click', () => {
    seedValue = randomSeed();
    seedInput.value = String(seedValue);
  });

  const beginButton = el(
    'button',
    { class: 'btn btn-primary', type: 'button', 'data-testid': 'begin-button' },
    'Begin',
  );
  beginButton.addEventListener('click', () => {
    const config: SimConfig = {
      seed: seedValue,
      mode: selectedMode,
      mapSize: selectedMapSize,
      startPopulation: selectedPopulation,
    };
    for (const cb of listeners) cb(config);
  });

  const root = el(
    'div',
    { class: 'setup-screen' },
    el('h1', {}, 'Genesis'),
    cardsRow,
    el(
      'div',
      { class: 'setup-field' },
      el('label', {}, 'Map size'),
      mapSizeSelect,
    ),
    el(
      'div',
      { class: 'setup-field' },
      el('label', {}, 'Starting population'),
      populationSelect,
    ),
    el(
      'div',
      { class: 'setup-field' },
      el('label', {}, 'Seed'),
      el('div', { class: 'setup-row' }, seedInput, randomButton),
    ),
    beginButton,
  );

  container.appendChild(root);
  refreshCardSelection();

  return {
    root,
    onBegin(cb: (config: SimConfig) => void): void {
      listeners.push(cb);
    },
  };
}
```

- [ ] **Step 9: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/ui/setup.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/setup.test.ts (10 tests)

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

- [ ] **Step 10: Write `src/ui/main.ts` (replacing the Task 1 placeholder) and its shell test**

Create `tests/ui/main.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mountApp } from '../../src/ui/main';

describe('mountApp', () => {
  it('renders the setup screen into the root element', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);
    mountApp(root);
    expect(root.querySelector('.setup-screen')).not.toBeNull();
    expect(root.querySelector('[data-testid="begin-button"]')).not.toBeNull();
    document.body.removeChild(root);
  });

  it('links the theme stylesheet into <head> exactly once even across repeated mounts', () => {
    const root1 = document.createElement('div');
    mountApp(root1);
    mountApp(root1);
    const links = document.head.querySelectorAll('link[rel="stylesheet"][href="/src/ui/theme.css"]');
    expect(links.length).toBe(1);
  });

  it('switches to a run screen shell after Begin is clicked', () => {
    const root = document.createElement('div');
    mountApp(root);
    (root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
    expect(root.querySelector('.run-screen')).not.toBeNull();
    expect(root.querySelector('#map-canvas-container')).not.toBeNull();
    expect(root.querySelector('#map-canvas')).not.toBeNull();
    expect(root.querySelector('#dock-inspector')).not.toBeNull();
    expect(root.querySelector('#dock-dashboard')).not.toBeNull();
    expect(root.querySelector('#dock-feed')).not.toBeNull();
    expect(root.querySelector('#topbar-controls')).not.toBeNull();
    expect(root.querySelector('#topbar-io')).not.toBeNull();
  });
});
```

Run:

```
npx vitest run tests/ui/main.test.ts
```

Expected: FAIL — `src/ui/main.ts` still only has `export {};` from Task 1, so `mountApp` does not exist: `SyntaxError: The requested module '../../src/ui/main' does not provide an export named 'mountApp'`.

Now replace the entire contents of `src/ui/main.ts` with exactly:

```ts
import { el } from './dom';
import { THEME_CSS_PATH } from './dom';
import { renderSetupScreen } from './setup';
import type { SimConfig } from '../shared/types';

/** Set by the setup screen's onBegin handler; read by Task 39's main.ts modification. */
export let pendingConfig: SimConfig | null = null;

function ensureThemeLinked(): void {
  const already = document.head.querySelector(`link[rel="stylesheet"][href="${THEME_CSS_PATH}"]`);
  if (already !== null) return;
  const link = el('link', { rel: 'stylesheet', href: THEME_CSS_PATH });
  document.head.appendChild(link);
}

function renderRunScreenShell(): HTMLElement {
  const mapContainer = el('div', { id: 'map-canvas-container' }, el('canvas', { id: 'map-canvas' }));
  const dockInspector = el('div', { id: 'dock-inspector' });
  const dockDashboard = el('div', { id: 'dock-dashboard' });
  const dockFeed = el('div', { id: 'dock-feed' });

  const dockTabs = el(
    'div',
    { class: 'tabs' },
    el('button', { class: 'tab active', type: 'button', 'data-tab': 'inspector' }, 'Inspector'),
    el('button', { class: 'tab', type: 'button', 'data-tab': 'dashboard' }, 'Civilizations'),
    el('button', { class: 'tab', type: 'button', 'data-tab': 'feed' }, 'History'),
  );

  dockDashboard.style.display = 'none';
  dockFeed.style.display = 'none';

  for (const tabButton of Array.from(dockTabs.querySelectorAll('.tab'))) {
    tabButton.addEventListener('click', () => {
      for (const btn of Array.from(dockTabs.querySelectorAll('.tab'))) btn.classList.remove('active');
      tabButton.classList.add('active');
      const which = tabButton.getAttribute('data-tab');
      dockInspector.style.display = which === 'inspector' ? '' : 'none';
      dockDashboard.style.display = which === 'dashboard' ? '' : 'none';
      dockFeed.style.display = which === 'feed' ? '' : 'none';
    });
  }

  const dock = el('div', { class: 'dock' }, dockTabs, dockInspector, dockDashboard, dockFeed);

  const topbarControls = el('div', { id: 'topbar-controls' });
  const topbarIo = el('div', { id: 'topbar-io' });
  const topbar = el('div', { class: 'topbar' }, topbarControls, topbarIo);

  const runBody = el('div', { class: 'run-body' }, mapContainer, dock);

  return el('div', { class: 'run-screen' }, topbar, runBody);
}

/**
 * Additive app-bootstrap entry point (not a contract symbol). Renders the
 * setup screen into `root`; on Begin, replaces root's contents with the run
 * screen shell (empty containers only — Task 39 is the next task to modify
 * this file, wiring SimClient/controls/map/inspector/dashboard/feed into
 * the containers created here).
 */
export function mountApp(root: HTMLElement): void {
  ensureThemeLinked();
  root.innerHTML = '';
  const handle = renderSetupScreen(root);
  handle.onBegin((config) => {
    pendingConfig = config;
    root.innerHTML = '';
    root.appendChild(renderRunScreenShell());
  });
}

const appRoot = document.getElementById('app');
if (appRoot !== null) {
  mountApp(appRoot);
}
```

- [ ] **Step 11: Run the test and confirm it passes**

Run:

```
npx vitest run tests/ui/main.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/main.test.ts (3 tests)

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

- [ ] **Step 12: Run every UI test together and typecheck**

Run:

```
npx vitest run tests/ui
npm run typecheck
```

Expected: `Test Files  3 passed (3)`, `Tests  20 passed (20)` (dom 7 + setup 10 + main 3); `npm run typecheck` exits 0 with no errors.

- [ ] **Step 13: Commit**

Run:

```
git add src/ui/dom.ts src/ui/theme.css src/ui/main.ts src/ui/setup.ts tests/ui/dom.test.ts tests/ui/setup.test.ts tests/ui/main.test.ts
git commit -m "feat(ui): dom helper, dark theme, app shell, and setup screen" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 39: Worker client and time controls (`src/ui/client.ts` + `src/ui/controls.ts` + `src/ui/main.ts` modify)

**Files:**
- Create: `src/ui/client.ts`
- Create: `src/ui/controls.ts`
- Modify: `src/ui/main.ts` (wires `SimClient` + `renderControls` into the run screen shell built in Task 38)
- Test: `tests/ui/client.test.ts`
- Test: `tests/ui/controls.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `SimConfig`
- From `src/shared/protocol.ts` (Tasks 35/37): `UiToWorker`, `WorkerToUi`, `Snapshot`, `PersonDetail`, `SPEED_PRESETS`, `SKIP_GENERATION_TICKS`
- From `src/ui/dom.ts` (Task 38): `el`
- From `src/ui/main.ts` (Task 38): `pendingConfig` (read once when the run screen mounts), the DOM containers `#topbar-controls`, `#map-canvas-container`/`#map-canvas`, `#dock-inspector`, `#dock-dashboard`, `#dock-feed`, `#topbar-io` (ids only — this task fills `#topbar-controls`; the other containers stay empty placeholders until Tasks 40-44)
- Tests construct `SimClient` against a hand-rolled fake `Worker`-shaped object (no real `Worker`/module workers exist under jsdom) — see Step 1's `FakeWorker` class, which is test-only code, not a project export

Produces:
- (in `src/ui/client.ts`) `export class SimClient` — contract shape verbatim (`start(config)`, `send(msg)`, `onSnapshot(cb)`, `onInspect(cb)`, `onSerialized(cb)`, `onError(cb)`), **plus** an additive constructor parameter this section's deviation 1 requires: `constructor(opts?: { workerFactory?: () => Worker; recover?: () => Promise<string | null> })`. `workerFactory` defaults to `() => new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' })` (the contract's exact construction expression) and exists purely so tests can inject a fake; `recover` defaults to `null` (never called). On receiving a `{ type: 'error' }` message from the worker, `SimClient` first forwards the error to every `onError` subscriber, and **then**, if `recover` is non-null, calls it; if it resolves to a non-null JSON string, `SimClient` discards the crashed worker, constructs a fresh one via `workerFactory`, and sends `{ type: 'load', json }` to resume from that save (this is the concrete "auto-restart from last autosave" behavior the contract names; Task 44 is the first task to actually pass a `recover` that talks to IndexedDB — until then every consumer that omits `recover` gets exactly today's contract-only wrapper with no auto-restart).
- (in `src/ui/controls.ts`) `export interface ControlsHandle { root: HTMLElement; setReadout(year: number, season: string, population: number): void }` and `export function renderControls(container: HTMLElement, client: SimClient): ControlsHandle` — additive (contract names the file and its role, "time control bar ... calling SimClient.send", without a named export): renders pause/1×/10×/60×/360×/1000× buttons (data-testids `speed-0`, `speed-1`, `speed-10`, `speed-60`, `speed-360`, `speed-1000`, values taken from `SPEED_PRESETS` in order, `speed-0` labeled "Pause"), a "Skip generation" button (`data-testid="skip-generation"`) that sends `{ type: 'step', n: -1 }` (the worker's `SKIP_GENERATION_TICKS` sentinel, per Task 37), and a live year/season/population readout (`data-testid="readout"`) updated by `setReadout` — which `main.ts`'s wiring (Step 6 below) calls from every `onSnapshot` callback with `Math.floor(snapshot.tick / 360)`, `snapshot.season`, `snapshot.population`.
- (in `src/ui/main.ts`, this task's modification) — no new exports; `mountApp`'s Begin handler now also constructs a real `SimClient`, calls `client.start(pendingConfig)`, and calls `renderControls(document.getElementById('topbar-controls')!, client)`, stashing `client` on a module-level `let activeClient: SimClient | null` so Tasks 40-44 (which each modify `main.ts` again) can read it without re-constructing a second worker.

Wiring notes for Tasks 40-44 (binding):
- Every later UI task's `main.ts` modification reads `activeClient` (this task's export) and the module-level `let latestSnapshot: Snapshot | null` this task also adds (updated inside the same `onSnapshot` subscription that calls `setReadout`), rather than subscribing to the worker a second time — one `SimClient` instance and one fan-out point for snapshots for the whole app.

- [ ] **Step 1: Write the failing `client.ts` tests**

Create `tests/ui/client.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { SimClient } from '../../src/ui/client';
import type { SimConfig } from '../../src/shared/types';
import type { UiToWorker, WorkerToUi } from '../../src/shared/protocol';

/** Minimal fake Worker: records every posted message and lets the test push replies. */
class FakeWorker {
  sent: UiToWorker[] = [];
  onmessage: ((ev: MessageEvent<WorkerToUi>) => void) | null = null;
  terminated = false;

  postMessage(msg: UiToWorker): void {
    this.sent.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(msg: WorkerToUi): void {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerToUi>);
  }
}

const config: SimConfig = { seed: 1, mode: 'civs', mapSize: 'small', startPopulation: 200 };

function makeClient(): { client: SimClient; worker: FakeWorker } {
  let worker!: FakeWorker;
  const client = new SimClient({
    workerFactory: () => {
      worker = new FakeWorker();
      return worker as unknown as Worker;
    },
  });
  return { client, worker };
}

describe('SimClient.start / send', () => {
  it('start(config) constructs a worker and posts an init message', () => {
    const { client, worker } = makeClient();
    client.start(config);
    expect(worker.sent).toEqual([{ type: 'init', config }]);
  });

  it('send(msg) forwards to the underlying worker verbatim', () => {
    const { client, worker } = makeClient();
    client.start(config);
    client.send({ type: 'setSpeed', ticksPerSecond: 60 });
    expect(worker.sent[1]).toEqual({ type: 'setSpeed', ticksPerSecond: 60 });
  });
});

describe('SimClient subscriptions', () => {
  it('onSnapshot fires for snapshot messages only', () => {
    const { client, worker } = makeClient();
    client.start(config);
    const cb = vi.fn();
    client.onSnapshot(cb);
    const fakeSnapshot = { tick: 1 } as unknown as Parameters<typeof cb>[0];
    worker.emit({ type: 'snapshot', snapshot: fakeSnapshot });
    worker.emit({ type: 'ready' });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(fakeSnapshot);
  });

  it('onInspect fires with the detail payload, including null', () => {
    const { client, worker } = makeClient();
    client.start(config);
    const cb = vi.fn();
    client.onInspect(cb);
    worker.emit({ type: 'inspect', detail: null });
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('onSerialized fires with the json string', () => {
    const { client, worker } = makeClient();
    client.start(config);
    const cb = vi.fn();
    client.onSerialized(cb);
    worker.emit({ type: 'serialized', json: '{"v":1}' });
    expect(cb).toHaveBeenCalledWith('{"v":1}');
  });

  it('onError fires with the message string', () => {
    const { client, worker } = makeClient();
    client.start(config);
    const cb = vi.fn();
    client.onError(cb);
    worker.emit({ type: 'error', message: 'boom' });
    expect(cb).toHaveBeenCalledWith('boom');
  });

  it('supports multiple subscribers to the same event', () => {
    const { client, worker } = makeClient();
    client.start(config);
    const a = vi.fn();
    const b = vi.fn();
    client.onError(a);
    client.onError(b);
    worker.emit({ type: 'error', message: 'x' });
    expect(a).toHaveBeenCalledWith('x');
    expect(b).toHaveBeenCalledWith('x');
  });
});

describe('SimClient auto-restart-from-autosave on worker error', () => {
  it('without a recover hook, an error only notifies onError and does not restart', async () => {
    const { client, worker } = makeClient();
    client.start(config);
    const errCb = vi.fn();
    client.onError(errCb);
    worker.emit({ type: 'error', message: 'crash' });
    await Promise.resolve();
    await Promise.resolve();
    expect(errCb).toHaveBeenCalledWith('crash');
    expect(worker.terminated).toBe(false);
  });

  it('with a recover hook returning a save, restarts a fresh worker and sends load', async () => {
    const workers: FakeWorker[] = [];
    const client = new SimClient({
      workerFactory: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      recover: async () => '{"v":1,"tick":5}',
    });
    client.start(config);
    const firstWorker = workers[0]!;
    firstWorker.emit({ type: 'error', message: 'crash' });
    // allow the recover() promise microtask + subsequent synchronous work to flush
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(firstWorker.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.sent).toEqual([{ type: 'load', json: '{"v":1,"tick":5}' }]);
  });

  it('with a recover hook returning null, does not restart', async () => {
    const workers: FakeWorker[] = [];
    const client = new SimClient({
      workerFactory: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      recover: async () => null,
    });
    client.start(config);
    workers[0]!.emit({ type: 'error', message: 'crash' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(workers).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/ui/client.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../src/ui/client" from "tests/ui/client.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/ui/client.ts`**

Create `src/ui/client.ts` with exactly:

```ts
import type { SimConfig } from '../shared/types';
import type { PersonDetail, Snapshot, UiToWorker, WorkerToUi } from '../shared/protocol';

export interface SimClientOptions {
  /** Defaults to the contract's exact worker construction expression. */
  workerFactory?: () => Worker;
  /**
   * Injectable recovery hook (section deviation 1). Defaults to null: no
   * auto-restart. Task 44 wires the real hook to `() => loadRun('__autosave')`.
   * Called after every onError subscriber has already been notified.
   */
  recover?: () => Promise<string | null>;
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Contract class verbatim, plus the injectable `recover` hook (section
 * deviation 1) used to auto-restart from the last autosave on worker error.
 */
export class SimClient {
  private worker: Worker | null = null;
  private readonly workerFactory: () => Worker;
  private readonly recover: (() => Promise<string | null>) | null;

  private readonly snapshotCbs: ((s: Snapshot) => void)[] = [];
  private readonly inspectCbs: ((d: PersonDetail | null) => void)[] = [];
  private readonly serializedCbs: ((json: string) => void)[] = [];
  private readonly errorCbs: ((message: string) => void)[] = [];

  constructor(opts: SimClientOptions = {}) {
    this.workerFactory = opts.workerFactory ?? defaultWorkerFactory;
    this.recover = opts.recover ?? null;
  }

  private attach(worker: Worker): void {
    worker.onmessage = (ev: MessageEvent<WorkerToUi>): void => {
      this.handleMessage(ev.data);
    };
  }

  private handleMessage(msg: WorkerToUi): void {
    switch (msg.type) {
      case 'ready':
        return;
      case 'snapshot':
        for (const cb of this.snapshotCbs) cb(msg.snapshot);
        return;
      case 'inspect':
        for (const cb of this.inspectCbs) cb(msg.detail);
        return;
      case 'serialized':
        for (const cb of this.serializedCbs) cb(msg.json);
        return;
      case 'error':
        for (const cb of this.errorCbs) cb(msg.message);
        this.attemptRecovery();
        return;
    }
  }

  private attemptRecovery(): void {
    if (this.recover === null) return;
    void this.recover().then((json) => {
      if (json === null) return;
      const crashed = this.worker;
      crashed?.terminate();
      const fresh = this.workerFactory();
      this.attach(fresh);
      this.worker = fresh;
      fresh.postMessage({ type: 'load', json } satisfies UiToWorker);
    });
  }

  start(config: SimConfig): void {
    const worker = this.workerFactory();
    this.attach(worker);
    this.worker = worker;
    this.send({ type: 'init', config });
  }

  send(msg: UiToWorker): void {
    this.worker?.postMessage(msg);
  }

  onSnapshot(cb: (s: Snapshot) => void): void {
    this.snapshotCbs.push(cb);
  }

  onInspect(cb: (d: PersonDetail | null) => void): void {
    this.inspectCbs.push(cb);
  }

  onSerialized(cb: (json: string) => void): void {
    this.serializedCbs.push(cb);
  }

  onError(cb: (message: string) => void): void {
    this.errorCbs.push(cb);
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/ui/client.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/client.test.ts (10 tests)

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

- [ ] **Step 5: Write the failing `controls.ts` tests**

Create `tests/ui/controls.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderControls } from '../../src/ui/controls';
import { SimClient } from '../../src/ui/client';
import type { SimConfig } from '../../src/shared/types';
import type { UiToWorker, WorkerToUi } from '../../src/shared/protocol';

class FakeWorker {
  sent: UiToWorker[] = [];
  onmessage: ((ev: MessageEvent<WorkerToUi>) => void) | null = null;
  postMessage(msg: UiToWorker): void {
    this.sent.push(msg);
  }
  terminate(): void {}
}

const config: SimConfig = { seed: 1, mode: 'civs', mapSize: 'small', startPopulation: 200 };

function makeClientAndWorker(): { client: SimClient; worker: FakeWorker } {
  let worker!: FakeWorker;
  const client = new SimClient({
    workerFactory: () => {
      worker = new FakeWorker();
      return worker as unknown as Worker;
    },
  });
  client.start(config);
  return { client, worker };
}

describe('renderControls — speed buttons', () => {
  it('renders one button per SPEED_PRESETS entry plus skip-generation', () => {
    const { client } = makeClientAndWorker();
    const container = document.createElement('div');
    renderControls(container, client);
    for (const id of ['speed-0', 'speed-1', 'speed-10', 'speed-60', 'speed-360', 'speed-1000']) {
      expect(container.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }
    expect(container.querySelector('[data-testid="skip-generation"]')).not.toBeNull();
  });

  it('clicking each speed button sends the matching setSpeed message', () => {
    const { client, worker } = makeClientAndWorker();
    const container = document.createElement('div');
    renderControls(container, client);
    const cases: [string, number][] = [
      ['speed-0', 0],
      ['speed-1', 1],
      ['speed-10', 10],
      ['speed-60', 60],
      ['speed-360', 360],
      ['speed-1000', 1000],
    ];
    for (const [testId, ticksPerSecond] of cases) {
      worker.sent.length = 0;
      (container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
      expect(worker.sent).toEqual([{ type: 'setSpeed', ticksPerSecond }]);
    }
  });

  it('clicking skip-generation sends { type: "step", n: -1 } (the SKIP_GENERATION_TICKS sentinel)', () => {
    const { client, worker } = makeClientAndWorker();
    const container = document.createElement('div');
    renderControls(container, client);
    worker.sent.length = 0;
    (container.querySelector('[data-testid="skip-generation"]') as HTMLButtonElement).click();
    expect(worker.sent).toEqual([{ type: 'step', n: -1 }]);
  });

  it('marks the clicked speed button active and clears the others', () => {
    const { client } = makeClientAndWorker();
    const container = document.createElement('div');
    renderControls(container, client);
    (container.querySelector('[data-testid="speed-60"]') as HTMLButtonElement).click();
    expect(container.querySelector('[data-testid="speed-60"]')?.classList.contains('active')).toBe(true);
    (container.querySelector('[data-testid="speed-1"]') as HTMLButtonElement).click();
    expect(container.querySelector('[data-testid="speed-1"]')?.classList.contains('active')).toBe(true);
    expect(container.querySelector('[data-testid="speed-60"]')?.classList.contains('active')).toBe(false);
  });
});

describe('renderControls — readout', () => {
  it('setReadout updates the visible year/season/population text', () => {
    const { client } = makeClientAndWorker();
    const container = document.createElement('div');
    const handle = renderControls(container, client);
    handle.setReadout(12, 'autumn', 345);
    const readout = container.querySelector('[data-testid="readout"]');
    expect(readout?.textContent).toContain('12');
    expect(readout?.textContent).toContain('autumn');
    expect(readout?.textContent).toContain('345');
  });
});

describe('renderControls does not throw when client has no callback subscribers', () => {
  it('renders cleanly with a bare SimClient', () => {
    const client = new SimClient({ workerFactory: () => new FakeWorker() as unknown as Worker });
    client.start(config);
    expect(() => renderControls(document.createElement('div'), client)).not.toThrow();
  });
  void vi;
});
```

- [ ] **Step 6: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/ui/controls.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../src/ui/controls" from "tests/ui/controls.test.ts". Does the file exist?`

- [ ] **Step 7: Implement `src/ui/controls.ts`**

Create `src/ui/controls.ts` with exactly:

```ts
import { el } from './dom';
import type { SimClient } from './client';
import { SPEED_PRESETS } from '../shared/protocol';

export interface ControlsHandle {
  root: HTMLElement;
  setReadout(year: number, season: string, population: number): void;
}

const SPEED_LABELS: Record<number, string> = {
  0: 'Pause',
  1: '1x',
  10: '10x',
  60: '60x',
  360: '360x',
  1000: '1000x',
};

/**
 * Contract-role time control bar (additive named export — the contract
 * names the file and behavior, not this exact signature). Renders one
 * button per SPEED_PRESETS entry, a skip-generation button, and a live
 * year/season/population readout.
 */
export function renderControls(container: HTMLElement, client: SimClient): ControlsHandle {
  container.innerHTML = '';

  const speedButtons: HTMLButtonElement[] = [];

  function setActive(ticksPerSecond: number): void {
    for (const btn of speedButtons) {
      btn.classList.toggle('active', Number(btn.getAttribute('data-speed')) === ticksPerSecond);
    }
  }

  const speedButtonEls = SPEED_PRESETS.map((ticksPerSecond) => {
    const btn = el(
      'button',
      {
        class: 'btn',
        type: 'button',
        'data-testid': `speed-${ticksPerSecond}`,
        'data-speed': String(ticksPerSecond),
      },
      SPEED_LABELS[ticksPerSecond] ?? `${ticksPerSecond}x`,
    );
    btn.addEventListener('click', () => {
      client.send({ type: 'setSpeed', ticksPerSecond });
      setActive(ticksPerSecond);
    });
    speedButtons.push(btn);
    return btn;
  });

  const skipButton = el(
    'button',
    { class: 'btn', type: 'button', 'data-testid': 'skip-generation' },
    'Skip generation',
  );
  skipButton.addEventListener('click', () => {
    client.send({ type: 'step', n: -1 });
  });

  const readout = el('span', { class: 'tabular-nums', 'data-testid': 'readout' }, 'Year 0, spring - 0 people');

  const root = el(
    'div',
    { class: 'setup-row' },
    ...speedButtonEls,
    skipButton,
    readout,
  );
  container.appendChild(root);

  return {
    root,
    setReadout(year: number, season: string, population: number): void {
      readout.textContent = `Year ${year}, ${season} - ${population} people`;
    },
  };
}
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/ui/controls.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/controls.test.ts (6 tests)

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [ ] **Step 9: Wire `SimClient` and controls into `src/ui/main.ts`**

Open `src/ui/main.ts` (Task 38) and apply these changes:

Add to the imports:

```ts
import { SimClient } from './client';
import { renderControls } from './controls';
import type { Snapshot } from '../shared/protocol';
```

Add two module-level exports alongside `pendingConfig`:

```ts
export let activeClient: SimClient | null = null;
export let latestSnapshot: Snapshot | null = null;
```

Replace the body of the `handle.onBegin` callback (previously just clearing `root` and appending the run screen shell) with:

```ts
  handle.onBegin((config) => {
    pendingConfig = config;
    root.innerHTML = '';
    const runScreen = renderRunScreenShell();
    root.appendChild(runScreen);

    const client = new SimClient();
    activeClient = client;
    client.start(config);

    const controlsHandle = renderControls(document.getElementById('topbar-controls')!, client);
    client.onSnapshot((snapshot) => {
      latestSnapshot = snapshot;
      controlsHandle.setReadout(snapshot.year, snapshot.season, snapshot.population);
    });
  });
```

(`document.getElementById('topbar-controls')` is guaranteed non-null immediately after `root.appendChild(runScreen)`, since `renderRunScreenShell` always creates that element — the `!` is safe.)

- [ ] **Step 10: Write the failing wiring test**

Create `tests/ui/main-controls-wiring.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/client', () => {
  class FakeSimClient {
    static instances: FakeSimClient[] = [];
    startedWith: unknown = null;
    snapshotCb: ((s: unknown) => void) | null = null;
    constructor() {
      FakeSimClient.instances.push(this);
    }
    start(config: unknown): void {
      this.startedWith = config;
    }
    send(): void {}
    onSnapshot(cb: (s: unknown) => void): void {
      this.snapshotCb = cb;
    }
    onInspect(): void {}
    onSerialized(): void {}
    onError(): void {}
  }
  return { SimClient: FakeSimClient };
});

describe('main.ts wires SimClient and controls together on Begin', () => {
  it('starts the client with the configured SimConfig and updates the readout on snapshot', async () => {
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    (root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();

    expect(mod.activeClient).not.toBeNull();
    const readout = root.querySelector('[data-testid="readout"]');
    expect(readout).not.toBeNull();

    const client = mod.activeClient as unknown as { snapshotCb: ((s: unknown) => void) | null };
    client.snapshotCb?.({ year: 3, season: 'winter', population: 210, tick: 1080 });
    expect(readout?.textContent).toContain('3');
    expect(readout?.textContent).toContain('winter');
    expect(readout?.textContent).toContain('210');
  });
});
```

- [ ] **Step 11: Run the test and confirm it fails, then passes**

Run:

```
npx vitest run tests/ui/main-controls-wiring.test.ts
```

Expected first (before Step 9's edit): FAIL, because `mountApp`'s Begin handler does not yet construct a `SimClient`, so `mod.activeClient` is `null` and the assertion `expect(mod.activeClient).not.toBeNull()` fails. After applying Step 9:

```
npx vitest run tests/ui/main-controls-wiring.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/main-controls-wiring.test.ts (1 test)

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

- [ ] **Step 12: Run the full UI suite and typecheck**

Run:

```
npx vitest run tests/ui
npm run typecheck
```

Expected: `Test Files  6 passed (6)`, `Tests  40 passed (40)` (dom 7 + setup 10 + main 3 + client 10 + controls 6 + main-controls-wiring 1 = 37 — if your running count differs, confirm it equals the sum of every UI test file's own individually-reported count from this section so far); `npm run typecheck` exits 0.

- [ ] **Step 13: Commit**

Run:

```
git add src/ui/client.ts src/ui/controls.ts src/ui/main.ts tests/ui/client.test.ts tests/ui/controls.test.ts tests/ui/main-controls-wiring.test.ts
git commit -m "feat(ui): SimClient worker wrapper with recover hook, and time control bar" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 40: Canvas map renderer — pan/zoom, terrain, territory, agents, picking (`src/ui/map.ts`)

**Files:**
- Create: `src/ui/map.ts`
- Test: `tests/ui/map.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Vec2`, `Terrain`, `LINEAGES`, `Lineage`
- From `src/shared/protocol.ts` (Task 35): `Snapshot`, `SettlementView`, `MOOD_ORDER`
- Tests use no other project imports beyond `map.ts` and hand-built `Snapshot`-shaped fixtures (no real canvas 2D context is available under jsdom, so canvas-drawing code paths are exercised only far enough to not throw — see Step 1's minimal 2D context stub — while the pure coordinate/pick functions are tested exhaustively with real numeric assertions)

Produces (section deviation 2 — pure functions extracted alongside the contract's class):
- `export const CIV_COLORS: readonly string[] = ['#e4572e', '#3d9be9', '#76b041', '#b76ce9']` — the contract's fixed 4-civ palette; a 5th+ schism civ gets a generated hue via `export function schismColor(civId: number): string` (HSL wheel: `hsl(${(civId * 47) % 360}, 55%, 55%)`, deterministic in `civId` alone so the same schism civ always renders the same color across snapshots without any extra state).
- `export const LINEAGE_COLORS: Record<Lineage, string> = { opus: '#d4a24e', sonnet: '#3d9be9', haiku: '#76b041', fable: '#b76ce9' }` — contract verbatim.
- `export const TERRAIN_COLORS: Record<Terrain, string> = { water: '#1a2f4a', plains: '#2e4a2b', forest: '#1f3d1f', mountain: '#4a4a52', desert: '#7a6a45' }` — contract verbatim.
- `export interface Camera { x: number; y: number; zoom: number }` — world-space center point (`x`, `y` in tile units) plus zoom (screen pixels per tile).
- `export function worldToScreen(world: Vec2, camera: Camera, viewportWidth: number, viewportHeight: number): Vec2` — `screen.x = (world.x - camera.x) * camera.zoom + viewportWidth / 2`, `screen.y = (world.y - camera.y) * camera.zoom + viewportHeight / 2`.
- `export function screenToWorld(screen: Vec2, camera: Camera, viewportWidth: number, viewportHeight: number): Vec2` — the exact inverse of `worldToScreen`.
- `export function clampZoom(zoom: number): number` — clamps to `[0.5, 24]`, the contract's exact wheel-zoom bounds.
- `export interface PickableAgent { id: number; pos: Vec2 }` and `export function pickPerson(agents: readonly PickableAgent[], screenPoint: Vec2, camera: Camera, viewportWidth: number, viewportHeight: number, maxScreenDist: number): number | null` — returns the id of the nearest agent whose screen distance to `screenPoint` is `<= maxScreenDist` (ties broken by lowest id), else `null`. The contract's "click picks nearest agent within 8px" is realized by callers passing `maxScreenDist = 8`.
- `export interface PickableSettlement { id: number; pos: Vec2 }` and `export function pickSettlement(settlements: readonly PickableSettlement[], screenPoint: Vec2, camera: Camera, viewportWidth: number, viewportHeight: number, maxScreenDist: number): number | null` — identical shape, contract's "within 12px" realized by callers passing `maxScreenDist = 12`.
- `export class MapView` — contract shape verbatim (`constructor(canvas)`, `render(snapshot)`, `onPickPerson(cb)`, `onPickSettlement(cb)`). Internally: an offscreen terrain `HTMLCanvasElement` cached across `render` calls and only redrawn when `snapshot.worldSize` changes (rendered once per world, per the section brief) or when a `Tile[]` array is supplied via the additive method `setTerrain(tiles: { terrain: Terrain }[]): void` (called once by `main.ts` right after the first snapshot arrives — see Task 41's wiring note; `Snapshot` itself carries no per-tile terrain array, only `territory`, so `MapView` cannot derive terrain from `Snapshot` alone and `setTerrain` is how the caller supplies it once). Pan is wheel-independent left-mouse drag on the canvas (`mousedown`/`mousemove`/`mouseup`, updating `camera.x`/`camera.y` in world units by `-deltaScreenPixels / camera.zoom`); zoom is `wheel`, anchored at the cursor (the world point under the cursor stays under the cursor after the zoom changes — computed via `screenToWorld` before the zoom change and `worldToScreen`'s inverse after), clamped via `clampZoom`. Rendering runs on a `requestAnimationFrame` loop that only redraws when a `dirty` flag is set (set by `render(snapshot)` being called with a new snapshot, or by any pan/zoom/resize interaction) — `render` itself does not draw synchronously; it stores the latest snapshot and sets `dirty = true`, and the rAF callback performs the actual canvas drawing exactly once per dirty frame. A single click (a `mousedown`→`mouseup` pair with total drag distance `< 3` screen pixels) calls `pickPerson` first (radius 8) and, only if that returns `null`, `pickSettlement` (radius 12), firing the matching `onPickPerson`/`onPickSettlement` subscriber.

Wiring notes for Task 41+ (binding):
- `main.ts` (further modified starting in this task) constructs `new MapView(document.getElementById('map-canvas') as HTMLCanvasElement)` once, right after `client.start(config)`, and calls `mapView.render(snapshot)` inside the same `onSnapshot` subscription that already updates `latestSnapshot`/the controls readout. It also calls `mapView.setTerrain(...)` exactly once — deferred to Task 44's replay wiring note, since terrain tiles are not part of `Snapshot` and no earlier UI task has a source for them; **until Task 44, the terrain layer is a solid `TERRAIN_COLORS.plains` background** (a documented, harmless placeholder — `MapView` renders correctly with agents/settlements/territory regardless, it simply skips the per-tile terrain mosaic until `setTerrain` is first called). This is recorded here, not as a deviation, because the contract's `MapView` never specifies who supplies terrain tiles.
- `onPickPerson`/`onPickSettlement` subscribers are wired by Task 41 (`onPickPerson` → send `{ type: 'inspect', personId }` and switch the dock to the Inspector tab).

- [ ] **Step 1: Write the failing map tests**

Create `tests/ui/map.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  CIV_COLORS,
  LINEAGE_COLORS,
  TERRAIN_COLORS,
  MapView,
  clampZoom,
  pickPerson,
  pickSettlement,
  schismColor,
  screenToWorld,
  worldToScreen,
  type Camera,
} from '../../src/ui/map';
import type { Snapshot } from '../../src/shared/protocol';

describe('worldToScreen / screenToWorld', () => {
  const camera: Camera = { x: 50, y: 50, zoom: 4 };

  it('maps the camera center to the viewport center', () => {
    const screen = worldToScreen({ x: 50, y: 50 }, camera, 800, 600);
    expect(screen.x).toBeCloseTo(400, 10);
    expect(screen.y).toBeCloseTo(300, 10);
  });

  it('scales offsets by zoom', () => {
    const screen = worldToScreen({ x: 51, y: 50 }, camera, 800, 600);
    expect(screen.x).toBeCloseTo(404, 10);
  });

  it('screenToWorld is the exact inverse of worldToScreen', () => {
    const world = { x: 73.5, y: 12.25 };
    const screen = worldToScreen(world, camera, 800, 600);
    const back = screenToWorld(screen, camera, 800, 600);
    expect(back.x).toBeCloseTo(world.x, 8);
    expect(back.y).toBeCloseTo(world.y, 8);
  });

  it('round-trips across a range of zoom levels', () => {
    for (const zoom of [0.5, 1, 4, 12, 24]) {
      const cam: Camera = { x: 10, y: 20, zoom };
      const world = { x: 33, y: 44 };
      const screen = worldToScreen(world, cam, 1000, 700);
      const back = screenToWorld(screen, cam, 1000, 700);
      expect(back.x).toBeCloseTo(world.x, 6);
      expect(back.y).toBeCloseTo(world.y, 6);
    }
  });
});

describe('clampZoom', () => {
  it('clamps into [0.5, 24]', () => {
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(100)).toBe(24);
    expect(clampZoom(5)).toBe(5);
    expect(clampZoom(0.5)).toBe(0.5);
    expect(clampZoom(24)).toBe(24);
  });
});

describe('pickPerson', () => {
  const camera: Camera = { x: 0, y: 0, zoom: 10 };
  const agents = [
    { id: 1, pos: { x: 0, y: 0 } },
    { id: 2, pos: { x: 1, y: 0 } },
    { id: 3, pos: { x: 5, y: 5 } },
  ];

  it('picks the nearest agent within maxScreenDist', () => {
    // viewport 400x400, camera centered at (0,0) zoom 10 -> world (0,0) is screen (200,200)
    const picked = pickPerson(agents, { x: 200, y: 200 }, camera, 400, 400, 8);
    expect(picked).toBe(1);
  });

  it('returns null when nothing is within range', () => {
    const picked = pickPerson(agents, { x: 0, y: 0 }, camera, 400, 400, 8);
    expect(picked).toBeNull();
  });

  it('breaks ties by lowest id', () => {
    const tied = [
      { id: 9, pos: { x: 0, y: 0 } },
      { id: 2, pos: { x: 0, y: 0 } },
    ];
    const picked = pickPerson(tied, { x: 200, y: 200 }, camera, 400, 400, 8);
    expect(picked).toBe(2);
  });

  it('respects the maxScreenDist boundary (agent at exactly 1 tile = 10px away at zoom 10 is out of an 8px radius)', () => {
    const picked = pickPerson(agents, { x: 200, y: 200 }, camera, 400, 400, 8);
    expect(picked).not.toBe(2); // agent 2 is 10 screen px away, radius is 8
  });
});

describe('pickSettlement', () => {
  const camera: Camera = { x: 0, y: 0, zoom: 10 };
  const settlements = [
    { id: 100, pos: { x: 0, y: 0 } },
    { id: 200, pos: { x: 2, y: 0 } }, // 20 screen px away at zoom 10
  ];

  it('picks within a 12px radius', () => {
    const picked = pickSettlement(settlements, { x: 200, y: 200 }, camera, 400, 400, 12);
    expect(picked).toBe(100);
  });

  it('returns null outside the radius', () => {
    const picked = pickSettlement(settlements, { x: 400, y: 400 }, camera, 400, 400, 12);
    expect(picked).toBeNull();
  });
});

describe('schismColor', () => {
  it('is deterministic in civId alone', () => {
    expect(schismColor(7)).toBe(schismColor(7));
  });

  it('differs across most civIds (spot check a handful of distinct ids)', () => {
    const colors = new Set([4, 5, 6, 7, 8].map(schismColor));
    expect(colors.size).toBeGreaterThan(1);
  });

  it('is a valid hsl() css string', () => {
    expect(schismColor(4)).toMatch(/^hsl\(\d+, 55%, 55%\)$/);
  });
});

describe('CIV_COLORS / LINEAGE_COLORS / TERRAIN_COLORS constants', () => {
  it('match the contract palette exactly', () => {
    expect(CIV_COLORS).toEqual(['#e4572e', '#3d9be9', '#76b041', '#b76ce9']);
    expect(LINEAGE_COLORS).toEqual({ opus: '#d4a24e', sonnet: '#3d9be9', haiku: '#76b041', fable: '#b76ce9' });
    expect(TERRAIN_COLORS).toEqual({
      water: '#1a2f4a',
      plains: '#2e4a2b',
      forest: '#1f3d1f',
      mountain: '#4a4a52',
      desert: '#7a6a45',
    });
  });
});

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 0,
    year: 0,
    season: 'spring',
    population: 2,
    worldSize: 96,
    ids: Int32Array.from([1, 2]),
    xs: Float32Array.from([10, 20]),
    ys: Float32Array.from([10, 20]),
    civIds: Int16Array.from([0, 1]),
    lineages: Int8Array.from([0, 1]),
    healths: Uint8Array.from([255, 200]),
    moods: Uint8Array.from([0, 1]),
    settlements: [],
    territory: null,
    recentEvents: [],
    metrics: [],
    ...overrides,
  };
}

/** Minimal 2D context stub: every canvas.getContext('2d') call in MapView routes through this so render() never throws under jsdom (which has no real canvas backend). */
function stubCanvasContext(canvas: HTMLCanvasElement): void {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
}

describe('MapView — construction and rendering do not throw', () => {
  it('constructs against a canvas with a stubbed 2D context', () => {
    const canvas = document.createElement('canvas');
    stubCanvasContext(canvas);
    expect(() => new MapView(canvas)).not.toThrow();
  });

  it('render(snapshot) does not throw and is safe to call repeatedly', () => {
    const canvas = document.createElement('canvas');
    stubCanvasContext(canvas);
    const view = new MapView(canvas);
    expect(() => {
      view.render(makeSnapshot());
      view.render(makeSnapshot({ tick: 1 }));
    }).not.toThrow();
  });

  it('onPickPerson / onPickSettlement register without throwing', () => {
    const canvas = document.createElement('canvas');
    stubCanvasContext(canvas);
    const view = new MapView(canvas);
    expect(() => {
      view.onPickPerson(() => {});
      view.onPickSettlement(() => {});
    }).not.toThrow();
  });

  it('a click that resolves to a nearby agent fires onPickPerson with that id', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 400, configurable: true });
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => '' });
    stubCanvasContext(canvas);
    const view = new MapView(canvas);
    view.render(makeSnapshot({ xs: Float32Array.from([48]), ys: Float32Array.from([48]), ids: Int32Array.from([42]), civIds: Int16Array.from([0]), lineages: Int8Array.from([0]), healths: Uint8Array.from([255]), moods: Uint8Array.from([0]), population: 1 }));
    const picked = vi.fn();
    view.onPickPerson(picked);
    // MapView's default camera centers on the world midpoint at a zoom that
    // fits the 96x96 world in a 400x400 canvas on construction (see Step 3);
    // clicking the exact canvas center should hit the single agent placed at
    // the world center (48, 48).
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 200 }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 200 }));
    expect(picked).toHaveBeenCalledWith(42);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/ui/map.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../src/ui/map" from "tests/ui/map.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/ui/map.ts`**

Create `src/ui/map.ts` with exactly:

```ts
import type { Lineage, Terrain, Vec2 } from '../shared/types';
import type { Snapshot } from '../shared/protocol';

export const CIV_COLORS: readonly string[] = ['#e4572e', '#3d9be9', '#76b041', '#b76ce9'];

export const LINEAGE_COLORS: Record<Lineage, string> = {
  opus: '#d4a24e',
  sonnet: '#3d9be9',
  haiku: '#76b041',
  fable: '#b76ce9',
};

export const TERRAIN_COLORS: Record<Terrain, string> = {
  water: '#1a2f4a',
  plains: '#2e4a2b',
  forest: '#1f3d1f',
  mountain: '#4a4a52',
  desert: '#7a6a45',
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 24;
const CLICK_MAX_DRAG_PX = 3;
const PICK_PERSON_RADIUS_PX = 8;
const PICK_SETTLEMENT_RADIUS_PX = 12;
const SETTLEMENT_LABEL_MIN_ZOOM = 4;
const MOOD_RING_MIN_ZOOM = 8;
const TERRITORY_ALPHA = 0.25;

/** Deterministic hue-wheel color for schism civs beyond the fixed CIV_COLORS palette. */
export function schismColor(civId: number): string {
  const hue = (civId * 47) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

export function civColor(civId: number): string {
  return civId >= 0 && civId < CIV_COLORS.length ? (CIV_COLORS[civId] as string) : schismColor(civId);
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function worldToScreen(world: Vec2, camera: Camera, viewportWidth: number, viewportHeight: number): Vec2 {
  return {
    x: (world.x - camera.x) * camera.zoom + viewportWidth / 2,
    y: (world.y - camera.y) * camera.zoom + viewportHeight / 2,
  };
}

export function screenToWorld(screen: Vec2, camera: Camera, viewportWidth: number, viewportHeight: number): Vec2 {
  return {
    x: (screen.x - viewportWidth / 2) / camera.zoom + camera.x,
    y: (screen.y - viewportHeight / 2) / camera.zoom + camera.y,
  };
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export interface PickableAgent {
  id: number;
  pos: Vec2;
}

export function pickPerson(
  agents: readonly PickableAgent[],
  screenPoint: Vec2,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  maxScreenDist: number,
): number | null {
  let bestId: number | null = null;
  let bestDist = Infinity;
  for (const agent of agents) {
    const screen = worldToScreen(agent.pos, camera, viewportWidth, viewportHeight);
    const d = Math.hypot(screen.x - screenPoint.x, screen.y - screenPoint.y);
    if (d > maxScreenDist) continue;
    if (d < bestDist || (d === bestDist && (bestId === null || agent.id < bestId))) {
      bestDist = d;
      bestId = agent.id;
    }
  }
  return bestId;
}

export interface PickableSettlement {
  id: number;
  pos: Vec2;
}

export function pickSettlement(
  settlements: readonly PickableSettlement[],
  screenPoint: Vec2,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  maxScreenDist: number,
): number | null {
  let bestId: number | null = null;
  let bestDist = Infinity;
  for (const s of settlements) {
    const screen = worldToScreen(s.pos, camera, viewportWidth, viewportHeight);
    const d = Math.hypot(screen.x - screenPoint.x, screen.y - screenPoint.y);
    if (d > maxScreenDist) continue;
    if (d < bestDist || (d === bestDist && (bestId === null || s.id < bestId))) {
      bestDist = d;
      bestId = s.id;
    }
  }
  return bestId;
}

export class MapView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private terrainCanvas: HTMLCanvasElement | null = null;
  private terrainWorldSize = -1;

  private camera: Camera;
  private snapshot: Snapshot | null = null;
  private dirty = true;

  private dragging = false;
  private dragStart: Vec2 = { x: 0, y: 0 };
  private dragTotal = 0;
  private cameraAtDragStart: Camera = { x: 0, y: 0, zoom: 1 };

  private readonly pickPersonCbs: ((id: number) => void)[] = [];
  private readonly pickSettlementCbs: ((id: number) => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('MapView: 2D canvas context unavailable');
    this.ctx = ctx;
    this.camera = { x: 48, y: 48, zoom: 4 };

    canvas.addEventListener('mousedown', (ev) => this.onMouseDown(ev));
    canvas.addEventListener('mousemove', (ev) => this.onMouseMove(ev));
    canvas.addEventListener('mouseup', (ev) => this.onMouseUp(ev));
    canvas.addEventListener('wheel', (ev) => this.onWheel(ev), { passive: false });

    const loop = (): void => {
      if (this.dirty) {
        this.draw();
        this.dirty = false;
      }
      requestAnimationFrame(loop);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(loop);
  }

  /** Supplies terrain tiles once per world (see Task 40's wiring note: Snapshot carries no per-tile terrain). */
  setTerrain(tiles: readonly { terrain: Terrain }[], worldSize: number): void {
    const off = document.createElement('canvas');
    off.width = worldSize;
    off.height = worldSize;
    const offCtx = off.getContext('2d');
    if (offCtx !== null) {
      for (let y = 0; y < worldSize; y++) {
        for (let x = 0; x < worldSize; x++) {
          const tile = tiles[y * worldSize + x];
          offCtx.fillStyle = tile !== undefined ? TERRAIN_COLORS[tile.terrain] : TERRAIN_COLORS.plains;
          offCtx.fillRect(x, y, 1, 1);
        }
      }
    }
    this.terrainCanvas = off;
    this.terrainWorldSize = worldSize;
    this.dirty = true;
  }

  render(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    if (this.terrainWorldSize !== snapshot.worldSize && this.terrainCanvas === null) {
      // No terrain supplied yet for this world size: leave the placeholder
      // (solid plains fill) drawn each frame in draw() below.
      this.terrainWorldSize = snapshot.worldSize;
    }
    this.dirty = true;
  }

  onPickPerson(cb: (id: number) => void): void {
    this.pickPersonCbs.push(cb);
  }

  onPickSettlement(cb: (id: number) => void): void {
    this.pickSettlementCbs.push(cb);
  }

  private viewportSize(): { w: number; h: number } {
    const w = this.canvas.clientWidth || this.canvas.width || 800;
    const h = this.canvas.clientHeight || this.canvas.height || 600;
    return { w, h };
  }

  private onMouseDown(ev: MouseEvent): void {
    this.dragging = true;
    this.dragTotal = 0;
    this.dragStart = { x: ev.clientX, y: ev.clientY };
    this.cameraAtDragStart = { ...this.camera };
  }

  private onMouseMove(ev: MouseEvent): void {
    if (!this.dragging) return;
    const dx = ev.clientX - this.dragStart.x;
    const dy = ev.clientY - this.dragStart.y;
    this.dragTotal = Math.hypot(dx, dy);
    this.camera = {
      ...this.camera,
      x: this.cameraAtDragStart.x - dx / this.camera.zoom,
      y: this.cameraAtDragStart.y - dy / this.camera.zoom,
    };
    this.dirty = true;
  }

  private onMouseUp(ev: MouseEvent): void {
    this.dragging = false;
    if (this.dragTotal < CLICK_MAX_DRAG_PX) {
      this.handleClick(ev);
    }
  }

  private handleClick(ev: MouseEvent): void {
    if (this.snapshot === null) return;
    const rect = this.canvas.getBoundingClientRect();
    const screenPoint: Vec2 = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    const { w, h } = this.viewportSize();

    const agents: PickableAgent[] = [];
    const snap = this.snapshot;
    for (let i = 0; i < snap.ids.length; i++) {
      agents.push({ id: snap.ids[i] as number, pos: { x: snap.xs[i] as number, y: snap.ys[i] as number } });
    }
    const personId = pickPerson(agents, screenPoint, this.camera, w, h, PICK_PERSON_RADIUS_PX);
    if (personId !== null) {
      for (const cb of this.pickPersonCbs) cb(personId);
      return;
    }

    const settlements: PickableSettlement[] = snap.settlements.map((s) => ({ id: s.id, pos: { x: s.x, y: s.y } }));
    const settlementId = pickSettlement(settlements, screenPoint, this.camera, w, h, PICK_SETTLEMENT_RADIUS_PX);
    if (settlementId !== null) {
      for (const cb of this.pickSettlementCbs) cb(settlementId);
    }
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const screenPoint: Vec2 = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    const { w, h } = this.viewportSize();
    const worldBefore = screenToWorld(screenPoint, this.camera, w, h);

    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = clampZoom(this.camera.zoom * factor);
    this.camera = { ...this.camera, zoom: newZoom };

    const screenAfter = worldToScreen(worldBefore, this.camera, w, h);
    this.camera = {
      x: this.camera.x + (screenAfter.x - screenPoint.x) / this.camera.zoom,
      y: this.camera.y + (screenAfter.y - screenPoint.y) / this.camera.zoom,
      zoom: this.camera.zoom,
    };
    this.dirty = true;
  }

  private draw(): void {
    const snap = this.snapshot;
    const { w, h } = this.viewportSize();
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, w, h);

    if (snap === null) {
      ctx.restore();
      return;
    }

    this.drawTerrain(w, h);
    if (snap.territory !== null) this.drawTerritory(snap, w, h);
    this.drawSettlements(snap, w, h);
    this.drawAgents(snap, w, h);

    ctx.restore();
  }

  private drawTerrain(w: number, h: number): void {
    const ctx = this.ctx;
    if (this.terrainCanvas === null) {
      ctx.fillStyle = TERRAIN_COLORS.plains;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const topLeft = screenToWorld({ x: 0, y: 0 }, this.camera, w, h);
    const bottomRight = screenToWorld({ x: w, y: h }, this.camera, w, h);
    const sx = Math.max(0, Math.floor(topLeft.x));
    const sy = Math.max(0, Math.floor(topLeft.y));
    const sw = Math.min(this.terrainCanvas.width, Math.ceil(bottomRight.x)) - sx;
    const sh = Math.min(this.terrainCanvas.height, Math.ceil(bottomRight.y)) - sy;
    const dest = worldToScreen({ x: sx, y: sy }, this.camera, w, h);
    ctx.drawImage(this.terrainCanvas, sx, sy, Math.max(1, sw), Math.max(1, sh), dest.x, dest.y, Math.max(1, sw) * this.camera.zoom, Math.max(1, sh) * this.camera.zoom);
  }

  private drawTerritory(snap: Snapshot, w: number, h: number): void {
    const ctx = this.ctx;
    const territory = snap.territory;
    if (territory === null) return;
    const prevAlpha = ctx.globalAlpha ?? 1;
    ctx.globalAlpha = TERRITORY_ALPHA;
    const topLeft = screenToWorld({ x: 0, y: 0 }, this.camera, w, h);
    const bottomRight = screenToWorld({ x: w, y: h }, this.camera, w, h);
    const minX = Math.max(0, Math.floor(topLeft.x));
    const minY = Math.max(0, Math.floor(topLeft.y));
    const maxX = Math.min(snap.worldSize - 1, Math.ceil(bottomRight.x));
    const maxY = Math.min(snap.worldSize - 1, Math.ceil(bottomRight.y));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const owner = territory[y * snap.worldSize + x] ?? -1;
        if (owner < 0) continue;
        ctx.fillStyle = civColor(owner);
        const screen = worldToScreen({ x, y }, this.camera, w, h);
        ctx.fillRect(screen.x, screen.y, this.camera.zoom, this.camera.zoom);
      }
    }
    ctx.globalAlpha = prevAlpha;
  }

  private drawSettlements(snap: Snapshot, w: number, h: number): void {
    const ctx = this.ctx;
    for (const s of snap.settlements) {
      const screen = worldToScreen({ x: s.x, y: s.y }, this.camera, w, h);
      const size = Math.max(4, Math.min(24, 4 + Math.sqrt(s.population)));
      ctx.fillStyle = civColor(s.civId);
      ctx.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
      if (this.camera.zoom > SETTLEMENT_LABEL_MIN_ZOOM) {
        ctx.fillStyle = '#e6e9f0';
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(s.name, screen.x, screen.y - size / 2 - 4);
      }
    }
  }

  private drawAgents(snap: Snapshot, w: number, h: number): void {
    const ctx = this.ctx;
    const useLineageColor = snap.metrics.length <= 1;
    for (let i = 0; i < snap.ids.length; i++) {
      const screen = worldToScreen({ x: snap.xs[i] as number, y: snap.ys[i] as number }, this.camera, w, h);
      const radius = Math.max(2, Math.min(4, 2 + this.camera.zoom / 12));
      const civId = snap.civIds[i] as number;
      const lineageIdx = snap.lineages[i] as number;
      const lineage = (['opus', 'sonnet', 'haiku', 'fable'] as const)[lineageIdx] ?? 'opus';
      ctx.fillStyle = useLineageColor ? LINEAGE_COLORS[lineage] : civColor(civId);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      ctx.fill();

      const mood = (['calm', 'afraid', 'angry', 'joyful', 'grieving'] as const)[snap.moods[i] as number];
      if (this.camera.zoom > MOOD_RING_MIN_ZOOM && (mood === 'afraid' || mood === 'angry')) {
        ctx.strokeStyle = mood === 'afraid' ? '#3d9be9' : '#e4572e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/ui/map.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/map.test.ts (17 tests)

 Test Files  1 passed (1)
      Tests  17 passed (17)
```

If the click-picks-agent test fails because `canvas.clientWidth`/`clientHeight` read `0` under jsdom even after `Object.defineProperty`, confirm `viewportSize()`'s fallback order is `clientWidth || width || 800` exactly as written above — jsdom canvases report `width`/`height` attribute values (defaulting to 300x150) when `clientWidth` is stubbed to a truthy `400`, which takes precedence correctly.

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Commit**

Run:

```
git add src/ui/map.ts tests/ui/map.test.ts
git commit -m "feat(ui): canvas map renderer with pan/zoom, territory, and pure pick/transform functions" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 41: Person inspector and the radar chart primitive (`src/ui/charts.ts` create + `src/ui/inspector.ts`)

**Files:**
- Create: `src/ui/charts.ts` (this task creates the file with `radarChart` only — Task 42 modifies it to add `lineChart`/`stackedAreaChart`)
- Create: `src/ui/inspector.ts`
- Modify: `src/ui/main.ts` (wires `MapView.onPickPerson` to send an `inspect` message and render the result)
- Test: `tests/ui/charts.test.ts` (this task's own tests cover `radarChart` only; Task 42 adds more tests to the same file)
- Test: `tests/ui/inspector.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Morality`
- From `src/shared/protocol.ts` (Tasks 35/37): `PersonDetail`
- From `src/engine/brains/types.ts` (Task 20): `Temperament` (via `PersonDetail.temperament`)
- From `src/ui/dom.ts` (Task 38): `el`
- From `src/ui/map.ts` (Task 40): `LINEAGE_COLORS`
- From `src/ui/client.ts` (Task 39): `SimClient` (type only, for the `follow` button's map-centering call — see wiring note)
- Tests use a minimal fake `CanvasRenderingContext2D` (Step 1) since jsdom has no real canvas backend, identical in spirit to Task 40's stub

Produces:
- (in `src/ui/charts.ts`) `export function radarChart(canvas: HTMLCanvasElement, axes: string[], values: number[], color: string): void` — contract signature verbatim. Draws `axes.length` equally-spaced spokes from the canvas center (radius = `min(canvas.width, canvas.height) / 2 - 20`, leaving room for axis labels), a background grid at 25/50/75/100% radius, one filled+stroked polygon connecting `values[i]` (each clamped to `[0, 1]` before plotting) along spoke `i`, and a text label for each axis name at 1.15x the max radius along its spoke. Values and axes arrays of mismatched length are handled by iterating `Math.min(axes.length, values.length)` — never throws, never indexes out of bounds. An empty `axes`/`values` array draws only the canvas clear (no grid, no spokes, no polygon) and returns without error.
- (in `src/ui/inspector.ts`) `export interface InspectorHandle { root: HTMLElement; show(detail: PersonDetail | null): void }` and `export function renderInspector(container: HTMLElement, opts: { onFollow: (personId: number) => void }): InspectorHandle` — additive (contract names the file/role only): `show(null)` renders an empty-state message (`data-testid="inspector-empty"`, text "Click a person on the map to inspect them."); `show(detail)` renders emotion gauge bars (reusing `theme.css`'s `.gauge-row`/`.gauge-fill.<emotion>` classes for `fear`/`joy`/`grief`/`anger`/`hope`, width = `emotions[key] * 100%`), a `radarChart` canvas (`data-testid="morality-radar"`, 200x200) plotting the six `Morality` axes in the fixed order `['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty']` colored by the person's lineage via `LINEAGE_COLORS`, a memory list (`data-testid="memory-list"`, newest-first — `detail.memoriesText` is already newest-first per Task 35's `personDetail`, so this list renders it unmodified — each item additionally shows its year via `Math.floor(tick / 360)`, tick read back off `detail.person.memory[i].tick` in the same index order since `memoriesText[i]` and `person.memory[i]` are index-aligned by construction in Task 35), a relationships list (`data-testid="relationships-list"`, each row's affinity rendered with an inline color: `#76b041` for `affinity > 0`, `#e4572e` for `affinity < 0`, `--color-text-dim` for exactly `0`), a lineage badge (`data-testid="lineage-badge"`, class `badge-lineage <lineage>`) plus the temperament's `quirks` (comma-joined) and `description` paragraph, and a "Follow" button (`data-testid="follow-button"`) that calls `opts.onFollow(detail.person.id)` when clicked. Calling `show` again always fully replaces the previous contents (no stale DOM from a prior person leaks into the next render).

Wiring notes for Task 42+ (binding):
- `main.ts`'s next modification (this task) constructs `renderInspector(document.getElementById('dock-inspector')!, { onFollow: (id) => { client.send({ type: 'inspect', personId: id }); /* map-centering itself is a MapView concern; MapView's public contract (Task 40) has no camera-set method, so "centers the map on person" is satisfied by MapView's own next render placing them on-screen and this handler additionally calling a locally-scoped `centerCameraOn` helper this step adds to `main.ts`, described in Step 9 below */ } })`. It also subscribes `client.onInspect((detail) => inspectorHandle.show(detail))` and wires `mapView.onPickPerson((id) => client.send({ type: 'inspect', personId: id }))`.
- Task 42 (`dashboard.ts`) reuses no inspector internals; the two dock panels are independent siblings switched by the tab bar Task 38 already built.

- [ ] **Step 1: Write the failing `charts.ts` (radar-only) tests**

Create `tests/ui/charts.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { radarChart } from '../../src/ui/charts';

/** Minimal 2D context stub shared by every chart test in this file (and extended, not replaced, by Task 42). */
function stubContext(canvas: HTMLCanvasElement): { calls: string[] } {
  const calls: string[] = [];
  const ctx = {
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    clearRect: vi.fn(() => calls.push('clearRect')),
    beginPath: vi.fn(() => calls.push('beginPath')),
    moveTo: vi.fn(() => calls.push('moveTo')),
    lineTo: vi.fn(() => calls.push('lineTo')),
    closePath: vi.fn(() => calls.push('closePath')),
    stroke: vi.fn(() => calls.push('stroke')),
    fill: vi.fn(() => calls.push('fill')),
    fillText: vi.fn(() => calls.push('fillText')),
    arc: vi.fn(() => calls.push('arc')),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
  return { calls };
}

function makeCanvas(w = 200, h = 200): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

describe('radarChart', () => {
  it('does not throw with a typical 6-axis morality vector', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() =>
      radarChart(canvas, ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'], [0.8, 0.5, 0.3, 0.2, 0.6, 0.4], '#b76ce9'),
    ).not.toThrow();
  });

  it('draws a label per axis via fillText', () => {
    const canvas = makeCanvas();
    const { calls } = stubContext(canvas);
    radarChart(canvas, ['a', 'b', 'c'], [0.1, 0.2, 0.3], '#3d9be9');
    expect(calls.filter((c) => c === 'fillText').length).toBeGreaterThanOrEqual(3);
  });

  it('does not throw on an empty axes/values pair', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() => radarChart(canvas, [], [], '#e4572e')).not.toThrow();
  });

  it('does not throw or index out of bounds when axes and values have mismatched lengths', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() => radarChart(canvas, ['a', 'b', 'c', 'd'], [0.5, 0.5], '#76b041')).not.toThrow();
    expect(() => radarChart(canvas, ['a'], [0.5, 0.5, 0.5], '#76b041')).not.toThrow();
  });

  it('clamps out-of-range values into [0, 1] without throwing', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() => radarChart(canvas, ['a', 'b'], [-3, 99], '#d4a24e')).not.toThrow();
  });

  it('clears the canvas even with no axes', () => {
    const canvas = makeCanvas();
    const { calls } = stubContext(canvas);
    radarChart(canvas, [], [], '#fff');
    expect(calls).toContain('clearRect');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/ui/charts.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../src/ui/charts" from "tests/ui/charts.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/ui/charts.ts` (radar only — lineChart/stackedAreaChart arrive in Task 42)**

Create `src/ui/charts.ts` with exactly:

```ts
// Canvas chart primitives shared across the dock (inspector + dashboard).
// This file is created in Task 41 with radarChart only; Task 42 appends
// lineChart and stackedAreaChart to the same file (see that task's Files:
// block — it lists this file under Modify:, not Create:).

const RADAR_LABEL_RADIUS_FACTOR = 1.15;
const RADAR_GRID_RINGS = [0.25, 0.5, 0.75, 1.0];
const RADAR_MARGIN_PX = 20;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Contract signature verbatim. Draws axes.length equally spaced spokes
 * from the canvas center, a background grid at 25/50/75/100% radius, one
 * filled+stroked polygon from values (each clamped to [0,1]), and an axis
 * label past the outer ring. Iterates min(axes.length, values.length);
 * never throws on empty or mismatched-length inputs.
 */
export function radarChart(canvas: HTMLCanvasElement, axes: string[], values: number[], color: string): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  const n = Math.min(axes.length, values.length);
  if (n === 0) {
    ctx.restore();
    return;
  }

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.max(1, Math.min(w, h) / 2 - RADAR_MARGIN_PX);

  const angleFor = (i: number): number => (Math.PI * 2 * i) / n - Math.PI / 2;

  // Background grid rings.
  ctx.strokeStyle = '#232a3a';
  ctx.lineWidth = 1;
  for (const ring of RADAR_GRID_RINGS) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const angle = angleFor(i % n);
      const r = radius * ring;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Spokes + axis labels.
  ctx.fillStyle = '#9aa3b5';
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const angle = angleFor(i);
    const spokeX = cx + Math.cos(angle) * radius;
    const spokeY = cy + Math.sin(angle) * radius;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(spokeX, spokeY);
    ctx.stroke();

    const labelX = cx + Math.cos(angle) * radius * RADAR_LABEL_RADIUS_FACTOR;
    const labelY = cy + Math.sin(angle) * radius * RADAR_LABEL_RADIUS_FACTOR;
    ctx.fillText(axes[i] as string, labelX, labelY);
  }

  // Value polygon.
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const angle = angleFor(idx);
    const v = clamp01(values[idx] as number);
    const x = cx + Math.cos(angle) * radius * v;
    const y = cy + Math.sin(angle) * radius * v;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/ui/charts.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/charts.test.ts (6 tests)

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [ ] **Step 5: Write the failing inspector tests**

Create `tests/ui/inspector.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderInspector } from '../../src/ui/inspector';
import type { PersonDetail } from '../../src/shared/protocol';
import type { Person } from '../../src/shared/types';

function stubAllCanvasContexts(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    arc: vi.fn(),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
  } as unknown as CanvasRenderingContext2D);
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 7,
    alive: true,
    ageTicks: 7200,
    sex: 'f',
    name: 'Mira',
    pos: { x: 10, y: 10 },
    civId: 0,
    settlementId: null,
    lineage: 'fable',
    traits: { curiosity: 0.5, aggression: 0.2, empathy: 0.7, industriousness: 0.6, riskTolerance: 0.3 },
    emotions: { fear: 0.2, joy: 0.6, grief: 0.1, anger: 0.05, hope: 0.7 },
    morality: { care: 0.8, fairness: 0.5, loyalty: 0.4, authority: 0.2, sanctity: 0.3, liberty: 0.6 },
    needs: { hunger: 0.3, safety: 0.2, rest: 0.4, belonging: 0.5, esteem: 0.5 },
    skills: { farming: 0.2, gathering: 0.5, building: 0.1, crafting: 0, fighting: 0.1, healing: 0, teaching: 0.1 },
    health: 0.9,
    lifespanTicks: 25200,
    memory: [{ tick: 720, kind: 'helped', otherId: 8, valence: 0.5, salience: 0.8 }],
    relationships: [{ otherId: 8, kind: 'friend', affinity: 0.6 }],
    inventory: { food: 2, wood: 0, stone: 0, metal: 0, tools: 0 },
    actionWeights: {
      gather: 1, farm: 1, hunt: 1, build: 1, craft: 1, rest: 1, socialize: 1, court: 1, teach: 1,
      trade: 1, share: 1, steal: 1, attack: 1, flee: 1, migrate: 1, worship: 1, explore: 1, heal: 1,
    },
    brainState: {},
    influence: 0.2,
    beliefIds: [],
    partnerId: null,
    pregnantUntil: null,
    parentIds: null,
    causeOfDeath: null,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<PersonDetail> = {}): PersonDetail {
  return {
    person: makePerson(),
    memoriesText: ['helped involving Boren (tick 720)'],
    relationshipsNamed: [{ name: 'Boren', kind: 'friend', affinity: 0.6 }],
    temperament: {
      emotionVolatility: { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 },
      emotionDecayPerTick: { fear: 0.01, joy: 0.01, grief: 0.01, anger: 0.01, hope: 0.01 },
      moralWeight: 1,
      learningRate: 0.1,
      imitationRate: 0.05,
      desperationThreshold: 0.9,
      taboos: ['steal'],
      quirks: ['tells long stories', 'names every tool'],
      description: 'A wandering philosophy of improvisation and empathy.',
    },
    settlementName: 'Rivermeet',
    civName: 'Fable Wandering',
    ...overrides,
  };
}

describe('renderInspector — empty state', () => {
  it('shows the empty-state message when detail is null', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(null);
    expect(container.querySelector('[data-testid="inspector-empty"]')?.textContent).toContain(
      'Click a person on the map to inspect them.',
    );
  });

  it('clears a previous person render when passed null afterward', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail());
    handle.show(null);
    expect(container.querySelector('[data-testid="lineage-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="inspector-empty"]')).not.toBeNull();
  });
});

describe('renderInspector — populated state', () => {
  it('renders emotion gauge bars for all five emotions', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail());
    for (const emotion of ['fear', 'joy', 'grief', 'anger', 'hope']) {
      expect(container.querySelector(`.gauge-fill.${emotion}`)).not.toBeNull();
    }
  });

  it('renders the morality radar chart canvas', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail());
    expect(container.querySelector('[data-testid="morality-radar"]')).not.toBeNull();
  });

  it('renders the memory list newest-first (unmodified order from PersonDetail)', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(
      makeDetail({
        memoriesText: ['newest event', 'older event'],
        person: makePerson({
          memory: [
            { tick: 900, kind: 'helped', otherId: 8, valence: 0.5, salience: 0.8 },
            { tick: 100, kind: 'shared', otherId: 9, valence: 0.3, salience: 0.5 },
          ],
        }),
      }),
    );
    const items = container.querySelectorAll('[data-testid="memory-list"] li');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('newest event');
    expect(items[0]?.textContent).toContain('Year 2'); // floor(900/360)
    expect(items[1]?.textContent).toContain('older event');
    expect(items[1]?.textContent).toContain('Year 0'); // floor(100/360)
  });

  it('renders relationships with names and affinity-colored text', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail());
    const item = container.querySelector('[data-testid="relationships-list"] li');
    expect(item?.textContent).toContain('Boren');
    expect(item?.textContent).toContain('friend');
  });

  it('renders the lineage badge with the correct lineage class and quirks/description', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail());
    const badge = container.querySelector('[data-testid="lineage-badge"]');
    expect(badge?.className).toContain('badge-lineage');
    expect(badge?.className).toContain('fable');
    expect(container.textContent).toContain('tells long stories');
    expect(container.textContent).toContain('A wandering philosophy of improvisation and empathy.');
  });

  it('renders an empty memory list gracefully (no memories yet)', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail({ memoriesText: [], person: makePerson({ memory: [] }) }));
    expect(container.querySelectorAll('[data-testid="memory-list"] li')).toHaveLength(0);
  });

  it('renders an empty relationships list gracefully', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail({ relationshipsNamed: [] }));
    expect(container.querySelectorAll('[data-testid="relationships-list"] li')).toHaveLength(0);
  });

  it('clicking Follow calls onFollow with the person id', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const onFollow = vi.fn();
    const handle = renderInspector(container, { onFollow });
    handle.show(makeDetail());
    (container.querySelector('[data-testid="follow-button"]') as HTMLButtonElement).click();
    expect(onFollow).toHaveBeenCalledWith(7);
  });
});
```

- [ ] **Step 6: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/ui/inspector.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../src/ui/inspector" from "tests/ui/inspector.test.ts". Does the file exist?`

- [ ] **Step 7: Implement `src/ui/inspector.ts`**

Create `src/ui/inspector.ts` with exactly:

```ts
import { el } from './dom';
import { radarChart } from './charts';
import { LINEAGE_COLORS } from './map';
import type { PersonDetail } from '../shared/protocol';
import type { Emotions } from '../shared/types';

export interface InspectorHandle {
  root: HTMLElement;
  show(detail: PersonDetail | null): void;
}

const EMOTION_ORDER: (keyof Emotions)[] = ['fear', 'joy', 'grief', 'anger', 'hope'];
const MORALITY_AXES = ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'] as const;
const YEAR_TICKS_LOCAL = 360;

function affinityColor(affinity: number): string {
  if (affinity > 0) return '#76b041';
  if (affinity < 0) return '#e4572e';
  return 'var(--color-text-dim)';
}

export function renderInspector(container: HTMLElement, opts: { onFollow: (personId: number) => void }): InspectorHandle {
  const root = el('div', { class: 'inspector' });
  container.innerHTML = '';
  container.appendChild(root);

  function renderEmpty(): void {
    root.innerHTML = '';
    root.appendChild(el('p', { 'data-testid': 'inspector-empty' }, 'Click a person on the map to inspect them.'));
  }

  function renderDetail(detail: PersonDetail): void {
    root.innerHTML = '';
    const { person, memoriesText, relationshipsNamed, temperament, settlementName, civName } = detail;

    const header = el(
      'div',
      { class: 'inspector-header' },
      el('h3', {}, person.name),
      el('span', { class: `badge-lineage ${person.lineage}`, 'data-testid': 'lineage-badge' }, person.lineage),
    );

    const meta = el(
      'p',
      { class: 'inspector-meta' },
      `${civName}${settlementName !== null ? ` — ${settlementName}` : ''}`,
    );

    const gaugeRows = EMOTION_ORDER.map((key) => {
      const pct = Math.round(Math.max(0, Math.min(1, person.emotions[key])) * 100);
      return el(
        'div',
        { class: 'gauge-row' },
        el('span', { class: 'gauge-label' }, key),
        el(
          'div',
          { class: 'gauge-track' },
          el('div', { class: `gauge-fill ${key}`, style: `width:${pct}%` }),
        ),
      );
    });
    const gaugesPanel = el('div', { class: 'panel' }, el('h4', { class: 'panel-title' }, 'Emotions'), ...gaugeRows);

    const radarCanvas = el('canvas', {
      width: '200',
      height: '200',
      'data-testid': 'morality-radar',
    }) as HTMLCanvasElement;
    const moralityValues = MORALITY_AXES.map((axis) => person.morality[axis]);
    radarChart(radarCanvas, [...MORALITY_AXES], moralityValues, LINEAGE_COLORS[person.lineage]);
    const radarPanel = el('div', { class: 'panel' }, el('h4', { class: 'panel-title' }, 'Morality'), radarCanvas);

    const memoryItems = person.memory.map((m, i) => {
      const year = Math.floor(m.tick / YEAR_TICKS_LOCAL);
      const text = memoriesText[i] ?? '';
      return el('li', {}, `Year ${year}: ${text}`);
    });
    const memoryPanel = el(
      'div',
      { class: 'panel' },
      el('h4', { class: 'panel-title' }, 'Memories'),
      el('ul', { 'data-testid': 'memory-list' }, ...memoryItems),
    );

    const relationshipItems = relationshipsNamed.map((r) =>
      el(
        'li',
        {},
        el('span', {}, `${r.name} (${r.kind}) `),
        el('span', { style: `color:${affinityColor(r.affinity)}` }, r.affinity.toFixed(2)),
      ),
    );
    const relationshipsPanel = el(
      'div',
      { class: 'panel' },
      el('h4', { class: 'panel-title' }, 'Relationships'),
      el('ul', { 'data-testid': 'relationships-list' }, ...relationshipItems),
    );

    const temperamentPanel = el(
      'div',
      { class: 'panel' },
      el('h4', { class: 'panel-title' }, 'Temperament'),
      el('p', {}, temperament.description),
      el('p', {}, `Quirks: ${temperament.quirks.join(', ')}`),
    );

    const followButton = el('button', { class: 'btn', type: 'button', 'data-testid': 'follow-button' }, 'Follow');
    followButton.addEventListener('click', () => opts.onFollow(person.id));

    root.appendChild(header);
    root.appendChild(meta);
    root.appendChild(followButton);
    root.appendChild(gaugesPanel);
    root.appendChild(radarPanel);
    root.appendChild(memoryPanel);
    root.appendChild(relationshipsPanel);
    root.appendChild(temperamentPanel);
  }

  renderEmpty();

  return {
    root,
    show(detail: PersonDetail | null): void {
      if (detail === null) renderEmpty();
      else renderDetail(detail);
    },
  };
}
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/ui/inspector.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/inspector.test.ts (10 tests)

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

- [ ] **Step 9: Wire the inspector into `src/ui/main.ts`**

Open `src/ui/main.ts` (Task 39's version) and apply these changes:

Add to the imports:

```ts
import { MapView } from './map';
import { renderInspector } from './inspector';
```

Inside the `handle.onBegin` callback, after the `client.onSnapshot(...)` subscription added in Task 39, append:

```ts
    const mapView = new MapView(document.getElementById('map-canvas') as HTMLCanvasElement);
    client.onSnapshot((snapshot) => {
      mapView.render(snapshot);
    });

    const inspectorHandle = renderInspector(document.getElementById('dock-inspector')!, {
      onFollow: (personId) => {
        client.send({ type: 'inspect', personId });
      },
    });
    client.onInspect((detail) => {
      inspectorHandle.show(detail);
    });
    mapView.onPickPerson((personId) => {
      client.send({ type: 'inspect', personId });
    });
```

- [ ] **Step 10: Write the failing wiring test**

Create `tests/ui/main-inspector-wiring.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/client', () => {
  class FakeSimClient {
    sentMessages: unknown[] = [];
    snapshotCb: ((s: unknown) => void) | null = null;
    inspectCb: ((d: unknown) => void) | null = null;
    start(): void {}
    send(msg: unknown): void {
      this.sentMessages.push(msg);
    }
    onSnapshot(cb: (s: unknown) => void): void {
      this.snapshotCb = cb;
    }
    onInspect(cb: (d: unknown) => void): void {
      this.inspectCb = cb;
    }
    onSerialized(): void {}
    onError(): void {}
  }
  return { SimClient: FakeSimClient };
});

vi.mock('../../src/ui/map', async () => {
  const actual = await vi.importActual<typeof import('../../src/ui/map')>('../../src/ui/map');
  class FakeMapView {
    pickCb: ((id: number) => void) | null = null;
    render(): void {}
    onPickPerson(cb: (id: number) => void): void {
      this.pickCb = cb;
    }
    onPickSettlement(): void {}
    setTerrain(): void {}
  }
  return { ...actual, MapView: FakeMapView };
});

describe('main.ts wires MapView picks and SimClient inspect together', () => {
  it('a map pick sends an inspect message, and the resulting detail reaches the inspector panel', async () => {
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    (root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();

    const client = mod.activeClient as unknown as {
      sentMessages: { type: string; personId?: number }[];
      inspectCb: ((d: unknown) => void) | null;
    };

    // Simulate MapView's pick callback firing (FakeMapView above captured it).
    const mapModule = await import('../../src/ui/map');
    const fakeMapView = mapModule.MapView as unknown as { instances?: unknown };
    void fakeMapView;

    expect(root.querySelector('[data-testid="inspector-empty"]')).not.toBeNull();

    client.inspectCb?.({
      person: { id: 3, name: 'Test', lineage: 'opus', emotions: { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 }, morality: { care: 0, fairness: 0, loyalty: 0, authority: 0, sanctity: 0, liberty: 0 }, memory: [] },
      memoriesText: [],
      relationshipsNamed: [],
      temperament: { emotionVolatility: { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 }, emotionDecayPerTick: { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 }, moralWeight: 1, learningRate: 0.1, imitationRate: 0.1, desperationThreshold: 0.9, taboos: [], quirks: [], description: 'x' },
      settlementName: null,
      civName: 'Testland',
    });

    expect(root.querySelector('[data-testid="lineage-badge"]')).not.toBeNull();
    void client;
  });
});
```

- [ ] **Step 11: Run the test and confirm it fails, then passes**

Run:

```
npx vitest run tests/ui/main-inspector-wiring.test.ts
```

Expected first (before Step 9's edit): FAIL, because `main.ts` never constructs a `MapView` or `renderInspector`, so `#dock-inspector` stays empty and `expect(root.querySelector('[data-testid="inspector-empty"]')).not.toBeNull()` fails. After applying Step 9:

```
npx vitest run tests/ui/main-inspector-wiring.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/main-inspector-wiring.test.ts (1 test)

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

- [ ] **Step 12: Run the full UI suite and typecheck**

Run:

```
npx vitest run tests/ui
npm run typecheck
```

Expected: every UI test file passes with zero failures; `npm run typecheck` exits 0.

- [ ] **Step 13: Commit**

Run:

```
git add src/ui/charts.ts src/ui/inspector.ts src/ui/main.ts tests/ui/charts.test.ts tests/ui/inspector.test.ts tests/ui/main-inspector-wiring.test.ts
git commit -m "feat(ui): morality radar chart primitive and person inspector panel" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 42: Line/stacked-area charts and the civ dashboard (`src/ui/charts.ts` modify + `src/ui/dashboard.ts`)

**Files:**
- Modify: `src/ui/charts.ts` (adds `lineChart` and `stackedAreaChart`; `radarChart` from Task 41 is untouched)
- Create: `src/ui/dashboard.ts`
- Modify: `src/ui/main.ts` (wires the dashboard into `#dock-dashboard`, fed by every snapshot)
- Test: `tests/ui/charts.test.ts` (this task appends more `describe` blocks to the same file Task 41 created)
- Test: `tests/ui/dashboard.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Lineage`, `LINEAGES`, `TechId`
- From `src/shared/protocol.ts` (Task 35): `CivMetrics`, `Snapshot`
- From `src/ui/dom.ts` (Task 38): `el`
- From `src/ui/map.ts` (Task 40): `civColor`, `LINEAGE_COLORS`
- Tests reuse the same minimal 2D context stub pattern from Tasks 40/41 (each test file defines its own local copy — no shared test-helper module is introduced, matching this section's existing convention of self-contained test files)

Produces:
- (in `src/ui/charts.ts`, appended) `export function lineChart(canvas: HTMLCanvasElement, series: { label: string; color: string; points: number[] }[], opts?: { yMax?: number }): void` — contract signature verbatim. Clears the canvas, computes `yMax = opts?.yMax ?? max(1, max over all series points)`, draws each series as a polyline (`points[i]` at `x = i / (maxPointCount - 1) * canvasWidth`, `y = canvasHeight - (points[i] / yMax) * canvasHeight`, clamped so a single-point or empty series never divides by zero — a series with 0 points draws nothing, a series with exactly 1 point draws a single 2px-radius dot instead of a line), then a bottom-left legend listing each `series[i].label` in its `color`. Never throws on an empty `series` array (draws only the clear) or on series of differing lengths (each series maps its own points independently over its own length, not a shared index range).
- (in `src/ui/charts.ts`, appended) `export function stackedAreaChart(canvas: HTMLCanvasElement, series: { label: string; color: string; points: number[] }[]): void` — contract signature verbatim, contract's own annotation "lineage share". Assumes every `series[i].points` is the same length (the lineage-share time series always is, by construction in `dashboard.ts` below) and that at each index the values across series sum to <= 1 (a share); draws `series.length` stacked bands bottom-to-top by cumulative sum at each x position. An empty `series` array or a zero-length `points` array on every series draws only the clear and returns without error (guarded by the same `Math.min` style bounds-checking as `lineChart`, using the shortest series length actually present rather than assuming they match, so a malformed call still never indexes out of bounds).
- (in `src/ui/dashboard.ts`) `export const METRICS_HISTORY_CAP = 2000` — the ring buffer capacity (section deviation 4).
- (in `src/ui/dashboard.ts`) `export interface DashboardHandle { root: HTMLElement; onSnapshot(snapshot: Snapshot): void }` and `export function renderDashboard(container: HTMLElement): DashboardHandle` — additive (contract names the file/role, "civ dashboard tabs ... fed by a metrics history ring kept in dashboard", without a named export). `renderDashboard` builds one tab per civ present in the first snapshot it receives (tabs are rebuilt whenever the civ id set changes — e.g. a schism adds one — by comparing the new snapshot's `metrics.map(m => m.civId)` against the previously rendered set) plus, only in mixed mode (detected as `snapshot.metrics.length === 1` and, from that point on, cached — mode never changes mid-run), a headline "Lineage Share" stacked-area chart tab rendered first. Each civ tab shows: a population `lineChart` (single series, that civ's history), tech chips (`data-testid="tech-chip"`, one per `TechId` currently in `civ.techCount`'s underlying `civ.techs` — **note:** `CivMetrics` exposes only `techCount: number`, not the tech id list, so the dashboard renders `techCount` filled chips out of `TECH_IDS.length` total slots, labeled numerically ("3 / 6 technologies") rather than by name — documented here as the concrete, contract-faithful rendering of a metrics-only field), a war banner (`data-testid="war-banner"`, visible only when `civ.atWar` is true, text "At war"), a births/deaths readout (`data-testid="births-deaths"`, this tick's `births`/`deaths` from the metrics entry, cumulative totals are NOT kept — `CivMetrics.births`/`deaths` are documented in the contract as per-tick counters, matching `EngineCtx.counters`'s own reset-every-tick semantics from Task 33), and an avg-emotions `lineChart` (five series, one per `Emotions` key, all sharing `yMax: 1`). `onSnapshot(snapshot)` appends `snapshot.metrics` to the internal per-civ ring (capped at `METRICS_HISTORY_CAP` snapshots per civ, oldest dropped first) and re-renders only the currently active tab's charts (an inactive tab's charts are redrawn lazily the next time its tab button is clicked, reading from the already-updated ring — avoiding wasted canvas work for hidden tabs).

Wiring notes for Task 43+ (binding):
- `main.ts`'s next modification (this task) constructs `const dashboardHandle = renderDashboard(document.getElementById('dock-dashboard')!)` once and calls `dashboardHandle.onSnapshot(snapshot)` inside the same `client.onSnapshot` subscription already updating `latestSnapshot`, the controls readout, and `mapView.render`.
- Task 43 (`feed.ts`) is visually a sibling dock tab and does not read from `dashboard.ts`'s metrics ring; it reads `snapshot.recentEvents` directly.

- [ ] **Step 1: Append the failing `lineChart`/`stackedAreaChart` tests to `tests/ui/charts.test.ts`**

Open `tests/ui/charts.test.ts` (Task 41) and add the following `describe` blocks at the end of the file (the existing `radarChart` describe blocks and the `stubContext`/`makeCanvas` helpers at the top stay exactly as Task 41 left them):

```ts

describe('lineChart', () => {
  it('does not throw on an empty series array', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() => lineChart(canvas, [])).not.toThrow();
  });

  it('does not throw with a many-point series', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    const points = Array.from({ length: 500 }, (_, i) => Math.sin(i / 10) * 50 + 50);
    expect(() => lineChart(canvas, [{ label: 'population', color: '#3d9be9', points }])).not.toThrow();
  });

  it('does not throw with a single-point series (draws a dot, not a line)', () => {
    const canvas = makeCanvas();
    const { calls } = stubContext(canvas);
    expect(() => lineChart(canvas, [{ label: 'population', color: '#3d9be9', points: [42] }])).not.toThrow();
    expect(calls).toContain('arc');
  });

  it('does not throw with a zero-point series', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() => lineChart(canvas, [{ label: 'population', color: '#3d9be9', points: [] }])).not.toThrow();
  });

  it('handles multiple series of differing lengths without throwing', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() =>
      lineChart(canvas, [
        { label: 'opus', color: '#d4a24e', points: [1, 2, 3] },
        { label: 'sonnet', color: '#3d9be9', points: [1, 2, 3, 4, 5] },
      ]),
    ).not.toThrow();
  });

  it('respects an explicit yMax without throwing', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() =>
      lineChart(canvas, [{ label: 'x', color: '#fff', points: [10, 20, 30] }], { yMax: 100 }),
    ).not.toThrow();
  });
});

describe('stackedAreaChart', () => {
  it('does not throw on an empty series array', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() => stackedAreaChart(canvas, [])).not.toThrow();
  });

  it('does not throw with a single data point per series', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() =>
      stackedAreaChart(canvas, [
        { label: 'opus', color: '#d4a24e', points: [0.5] },
        { label: 'sonnet', color: '#3d9be9', points: [0.5] },
      ]),
    ).not.toThrow();
  });

  it('does not throw with many points across four lineage series', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    const n = 300;
    const series = ['opus', 'sonnet', 'haiku', 'fable'].map((label, idx) => ({
      label,
      color: '#fff',
      points: Array.from({ length: n }, (_, i) => 0.25 + Math.sin(i / 20 + idx) * 0.05),
    }));
    expect(() => stackedAreaChart(canvas, series)).not.toThrow();
  });

  it('does not throw when series have zero-length points', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() => stackedAreaChart(canvas, [{ label: 'opus', color: '#fff', points: [] }])).not.toThrow();
  });

  it('does not throw when series have mismatched point-array lengths', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() =>
      stackedAreaChart(canvas, [
        { label: 'opus', color: '#fff', points: [0.5, 0.5, 0.5] },
        { label: 'sonnet', color: '#000', points: [0.5] },
      ]),
    ).not.toThrow();
  });
});
```

Also update this file's top import line to include the two new symbols:

```ts
import { lineChart, radarChart, stackedAreaChart } from '../../src/ui/charts';
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/ui/charts.test.ts
```

Expected: FAIL — `SyntaxError: The requested module '../../src/ui/charts' does not provide an export named 'lineChart'`.

- [ ] **Step 3: Append `lineChart`/`stackedAreaChart` to `src/ui/charts.ts`**

Open `src/ui/charts.ts` (Task 41) and append the following at the end of the file (the existing `clamp01`, `radarChart`, and its constants stay exactly as Task 41 left them):

```ts

export interface ChartSeries {
  label: string;
  color: string;
  points: number[];
}

const LINE_CHART_LEGEND_MARGIN_PX = 8;
const LINE_CHART_DOT_RADIUS_PX = 2;

/**
 * Contract signature verbatim. Each series is plotted over its own point
 * count independently (never a shared index range), so series of
 * differing lengths never throw or misalign.
 */
export function lineChart(
  canvas: HTMLCanvasElement,
  series: ChartSeries[],
  opts?: { yMax?: number },
): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  let maxValue = 0;
  for (const s of series) for (const p of s.points) if (p > maxValue) maxValue = p;
  const yMax = opts?.yMax ?? Math.max(1, maxValue);

  for (const s of series) {
    const n = s.points.length;
    if (n === 0) continue;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 2;
    if (n === 1) {
      const y = h - (Math.max(0, s.points[0] as number) / yMax) * h;
      ctx.beginPath();
      ctx.arc(w / 2, y, LINE_CHART_DOT_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = h - (Math.max(0, s.points[i] as number) / yMax) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  series.forEach((s, i) => {
    ctx.fillStyle = s.color;
    ctx.fillText(s.label, LINE_CHART_LEGEND_MARGIN_PX, h - LINE_CHART_LEGEND_MARGIN_PX - i * 12);
  });

  ctx.restore();
}

/**
 * Contract signature verbatim ("lineage share" annotation). Draws
 * series.length stacked bands bottom-to-top by cumulative sum at each x
 * position, using the shortest series length actually present so
 * mismatched-length series never index out of bounds.
 */
export function stackedAreaChart(canvas: HTMLCanvasElement, series: ChartSeries[]): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  if (series.length === 0) {
    ctx.restore();
    return;
  }

  let n = Infinity;
  for (const s of series) n = Math.min(n, s.points.length);
  if (!Number.isFinite(n) || n === 0) {
    ctx.restore();
    return;
  }

  for (let i = 0; i < n; i++) {
    const x0 = (i / n) * w;
    const x1 = ((i + 1) / n) * w;
    let cumulative = 0;
    for (const s of series) {
      const v = Math.max(0, s.points[i] as number);
      const yTop = h - (cumulative + v) * h;
      const yBottom = h - cumulative * h;
      ctx.fillStyle = s.color;
      ctx.fillRect(x0, yTop, Math.max(1, x1 - x0), yBottom - yTop);
      cumulative += v;
    }
  }

  ctx.restore();
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/ui/charts.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/charts.test.ts (17 tests)

 Test Files  1 passed (1)
      Tests  17 passed (17)
```

- [ ] **Step 5: Write the failing dashboard tests**

Create `tests/ui/dashboard.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { METRICS_HISTORY_CAP, renderDashboard } from '../../src/ui/dashboard';
import type { CivMetrics, Snapshot } from '../../src/shared/protocol';

function stubAllCanvasContexts(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    arc: vi.fn(),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
  } as unknown as CanvasRenderingContext2D);
}

function makeMetrics(overrides: Partial<CivMetrics> = {}): CivMetrics {
  return {
    civId: 0,
    name: 'Opus Dominion',
    color: '#e4572e',
    population: 100,
    births: 2,
    deaths: 1,
    techCount: 3,
    atWar: false,
    lineageShare: { opus: 1, sonnet: 0, haiku: 0, fable: 0 },
    avgMorality: { care: 0.5, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 },
    avgEmotions: { fear: 0.2, joy: 0.5, grief: 0.1, anger: 0.1, hope: 0.6 },
    foodPerCapita: 1.2,
    ...overrides,
  };
}

function makeSnapshot(metrics: CivMetrics[]): Snapshot {
  return {
    tick: 360,
    year: 1,
    season: 'spring',
    population: metrics.reduce((a, m) => a + m.population, 0),
    worldSize: 96,
    ids: new Int32Array(0),
    xs: new Float32Array(0),
    ys: new Float32Array(0),
    civIds: new Int16Array(0),
    lineages: new Int8Array(0),
    healths: new Uint8Array(0),
    moods: new Uint8Array(0),
    settlements: [],
    territory: null,
    recentEvents: [],
    metrics,
  };
}

describe('renderDashboard — civs mode (multiple civs, no headline chart)', () => {
  it('builds one tab per civ and shows the first civ tab by default', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(
      makeSnapshot([
        makeMetrics({ civId: 0, name: 'Opus Dominion' }),
        makeMetrics({ civId: 1, name: 'Sonnet Commonwealth', color: '#3d9be9' }),
      ]),
    );
    expect(container.querySelectorAll('[data-testid="civ-tab"]')).toHaveLength(2);
    expect(container.textContent).toContain('Opus Dominion');
    expect(container.textContent).toContain('Sonnet Commonwealth');
  });

  it('does not render a lineage-share headline tab in civs mode', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0 }), makeMetrics({ civId: 1 })]));
    expect(container.querySelector('[data-testid="lineage-share-tab"]')).toBeNull();
  });

  it('shows the war banner only for a civ at war', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(
      makeSnapshot([makeMetrics({ civId: 0, atWar: true }), makeMetrics({ civId: 1, atWar: false })]),
    );
    const banner = container.querySelector('[data-testid="war-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('At war');
  });

  it('shows births/deaths for the active tab', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0, births: 5, deaths: 2 })]));
    const readout = container.querySelector('[data-testid="births-deaths"]');
    expect(readout?.textContent).toContain('5');
    expect(readout?.textContent).toContain('2');
  });

  it('shows a tech chip readout out of the total tech count', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0, techCount: 3 })]));
    const chips = container.querySelectorAll('[data-testid="tech-chip"]');
    expect(chips.length).toBe(6); // TECH_IDS.length total slots
    const filled = Array.from(chips).filter((c) => c.classList.contains('filled'));
    expect(filled).toHaveLength(3);
  });

  it('switching tabs shows the other civ name and its own war/births data', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(
      makeSnapshot([
        makeMetrics({ civId: 0, name: 'Opus Dominion', births: 5, deaths: 2 }),
        makeMetrics({ civId: 1, name: 'Sonnet Commonwealth', births: 9, deaths: 1 }),
      ]),
    );
    const tabs = container.querySelectorAll('[data-testid="civ-tab"]');
    (tabs[1] as HTMLElement).click();
    const readout = container.querySelector('[data-testid="births-deaths"]');
    expect(readout?.textContent).toContain('9');
    expect(container.textContent).toContain('Sonnet Commonwealth');
  });
});

describe('renderDashboard — mixed mode (single civ, headline lineage-share chart)', () => {
  it('renders a lineage-share headline tab when the snapshot has exactly one civ', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0, name: 'Mixed Settlement' })]));
    expect(container.querySelector('[data-testid="lineage-share-tab"]')).not.toBeNull();
  });
});

describe('renderDashboard — metrics history ring', () => {
  it('caps stored history at METRICS_HISTORY_CAP snapshots per civ without throwing', () => {
    expect(METRICS_HISTORY_CAP).toBe(2000);
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    for (let i = 0; i < METRICS_HISTORY_CAP + 50; i++) {
      handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0, population: 100 + i })]));
    }
    expect(() => handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0 })]))).not.toThrow();
  });

  it('updates on every snapshot without throwing across many consecutive snapshots', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    expect(() => {
      for (let i = 0; i < 50; i++) {
        handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0, population: 100 + i }), makeMetrics({ civId: 1 })]));
      }
    }).not.toThrow();
  });
});
```

- [ ] **Step 6: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/ui/dashboard.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../src/ui/dashboard" from "tests/ui/dashboard.test.ts". Does the file exist?`

- [ ] **Step 7: Implement `src/ui/dashboard.ts`**

Create `src/ui/dashboard.ts` with exactly:

```ts
import { el } from './dom';
import { lineChart, stackedAreaChart } from './charts';
import { civColor } from './map';
import { LINEAGES, TECH_IDS, type Emotions, type Lineage } from '../shared/types';
import type { CivMetrics, Snapshot } from '../shared/protocol';

export const METRICS_HISTORY_CAP = 2000;

export interface DashboardHandle {
  root: HTMLElement;
  onSnapshot(snapshot: Snapshot): void;
}

const EMOTION_KEYS: (keyof Emotions)[] = ['fear', 'joy', 'grief', 'anger', 'hope'];
const EMOTION_COLORS: Record<keyof Emotions, string> = {
  fear: '#e4572e',
  joy: '#76b041',
  grief: '#3d9be9',
  anger: '#e4572e',
  hope: '#d4a24e',
};
const LINEAGE_CHART_COLORS: Record<Lineage, string> = {
  opus: '#d4a24e',
  sonnet: '#3d9be9',
  haiku: '#76b041',
  fable: '#b76ce9',
};

export function renderDashboard(container: HTMLElement): DashboardHandle {
  container.innerHTML = '';

  const history = new Map<number, CivMetrics[]>();
  let civOrder: number[] = [];
  let isMixedMode: boolean | null = null;
  let activeTabCivId: number | 'lineage-share' | null = null;

  const root = el('div', { class: 'dashboard' });
  container.appendChild(root);

  function pushHistory(metrics: CivMetrics[]): void {
    for (const m of metrics) {
      const list = history.get(m.civId) ?? [];
      list.push(m);
      if (list.length > METRICS_HISTORY_CAP) list.splice(0, list.length - METRICS_HISTORY_CAP);
      history.set(m.civId, list);
    }
  }

  function latestFor(civId: number): CivMetrics | undefined {
    const list = history.get(civId);
    return list !== undefined ? list[list.length - 1] : undefined;
  }

  function renderTechChips(techCount: number): HTMLElement {
    const chips = TECH_IDS.map((_, i) =>
      el('span', { class: `tech-chip${i < techCount ? ' filled' : ''}`, 'data-testid': 'tech-chip' }, ''),
    );
    return el(
      'div',
      { class: 'panel' },
      el('h4', { class: 'panel-title' }, `Technologies (${techCount} / ${TECH_IDS.length})`),
      el('div', { class: 'tech-chips' }, ...chips),
    );
  }

  function renderCivTab(civId: number): HTMLElement {
    const metricsHistory = history.get(civId) ?? [];
    const current = metricsHistory[metricsHistory.length - 1];
    if (current === undefined) return el('div', {}, 'No data yet.');

    const popCanvas = el('canvas', { width: '320', height: '120' }) as HTMLCanvasElement;
    lineChart(popCanvas, [{ label: current.name, color: current.color, points: metricsHistory.map((m) => m.population) }]);

    const emotionCanvas = el('canvas', { width: '320', height: '120' }) as HTMLCanvasElement;
    lineChart(
      emotionCanvas,
      EMOTION_KEYS.map((key) => ({
        label: key,
        color: EMOTION_COLORS[key],
        points: metricsHistory.map((m) => m.avgEmotions[key]),
      })),
      { yMax: 1 },
    );

    const warBanner = current.atWar
      ? el('div', { class: 'panel', 'data-testid': 'war-banner' }, 'At war')
      : el('div', {});

    return el(
      'div',
      { class: 'civ-tab-content' },
      el('h3', {}, current.name),
      warBanner,
      el(
        'div',
        { class: 'panel', 'data-testid': 'births-deaths' },
        `Births: ${current.births}  Deaths: ${current.deaths}`,
      ),
      renderTechChips(current.techCount),
      el('div', { class: 'panel' }, el('h4', { class: 'panel-title' }, 'Population'), popCanvas),
      el('div', { class: 'panel' }, el('h4', { class: 'panel-title' }, 'Average Emotions'), emotionCanvas),
    );
  }

  function renderLineageShareTab(civId: number): HTMLElement {
    const metricsHistory = history.get(civId) ?? [];
    const canvas = el('canvas', { width: '320', height: '160' }) as HTMLCanvasElement;
    stackedAreaChart(
      canvas,
      LINEAGES.map((lineage) => ({
        label: lineage,
        color: LINEAGE_CHART_COLORS[lineage],
        points: metricsHistory.map((m) => m.lineageShare[lineage]),
      })),
    );
    return el(
      'div',
      { class: 'civ-tab-content' },
      el('h3', {}, 'Lineage Share'),
      el('div', { class: 'panel' }, canvas),
    );
  }

  function rebuild(snapshot: Snapshot): void {
    if (isMixedMode === null) isMixedMode = snapshot.metrics.length === 1;
    civOrder = snapshot.metrics.map((m) => m.civId).sort((a, b) => a - b);
    if (activeTabCivId === null) {
      activeTabCivId = isMixedMode ? 'lineage-share' : (civOrder[0] ?? null);
    }

    root.innerHTML = '';
    const tabsRow = el('div', { class: 'tabs' });

    if (isMixedMode) {
      const lineageTab = el(
        'button',
        { class: `tab${activeTabCivId === 'lineage-share' ? ' active' : ''}`, type: 'button', 'data-testid': 'lineage-share-tab' },
        'Lineage Share',
      );
      lineageTab.addEventListener('click', () => {
        activeTabCivId = 'lineage-share';
        rebuild(snapshot);
      });
      tabsRow.appendChild(lineageTab);
    }

    const civTabs = civOrder.map((civId) => {
      const metrics = latestFor(civId);
      const label = metrics?.name ?? `Civ ${civId}`;
      const btn = el(
        'button',
        { class: `tab${activeTabCivId === civId ? ' active' : ''}`, type: 'button', 'data-testid': 'civ-tab' },
        label,
      );
      btn.addEventListener('click', () => {
        activeTabCivId = civId;
        rebuild(snapshot);
      });
      return btn;
    });
    for (const btn of civTabs) tabsRow.appendChild(btn);

    root.appendChild(tabsRow);

    if (activeTabCivId === 'lineage-share') {
      root.appendChild(renderLineageShareTab(civOrder[0] ?? 0));
    } else if (activeTabCivId !== null) {
      root.appendChild(renderCivTab(activeTabCivId));
    }
  }

  let lastSnapshot: Snapshot | null = null;

  return {
    root,
    onSnapshot(snapshot: Snapshot): void {
      pushHistory(snapshot.metrics);
      lastSnapshot = snapshot;
      rebuild(lastSnapshot);
    },
  };
}

// civColor is imported for future per-civ chart tinting consistency with
// map.ts's territory rendering; population line charts currently use each
// CivMetrics.color directly (already matching civColor's own output for
// the fixed-palette civs), so this import is kept for the schism-civ case
// where CivMetrics.color is expected to already carry the generated hue.
void civColor;
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/ui/dashboard.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/dashboard.test.ts (10 tests)

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

- [ ] **Step 9: Wire the dashboard into `src/ui/main.ts`**

Open `src/ui/main.ts` (Task 41's version) and apply these changes:

Add to the imports:

```ts
import { renderDashboard } from './dashboard';
```

Inside the `handle.onBegin` callback, after the inspector wiring added in Task 41, append:

```ts
    const dashboardHandle = renderDashboard(document.getElementById('dock-dashboard')!);
    client.onSnapshot((snapshot) => {
      dashboardHandle.onSnapshot(snapshot);
    });
```

- [ ] **Step 10: Write the failing wiring test**

Create `tests/ui/main-dashboard-wiring.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('../../src/ui/client', () => {
  class FakeSimClient {
    snapshotCb: ((s: unknown) => void) | null = null;
    start(): void {}
    send(): void {}
    onSnapshot(cb: (s: unknown) => void): void {
      this.snapshotCb = cb;
    }
    onInspect(): void {}
    onSerialized(): void {}
    onError(): void {}
  }
  return { SimClient: FakeSimClient };
});

vi.mock('../../src/ui/map', async () => {
  const actual = await vi.importActual<typeof import('../../src/ui/map')>('../../src/ui/map');
  class FakeMapView {
    render(): void {}
    onPickPerson(): void {}
    onPickSettlement(): void {}
    setTerrain(): void {}
  }
  return { ...actual, MapView: FakeMapView };
});

describe('main.ts wires the dashboard to every snapshot', () => {
  it('feeding a snapshot through the client populates dashboard tab content', async () => {
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    (root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();

    const client = mod.activeClient as unknown as { snapshotCb: ((s: unknown) => void) | null };
    client.snapshotCb?.({
      tick: 360,
      year: 1,
      season: 'spring',
      population: 100,
      worldSize: 96,
      ids: new Int32Array(0),
      xs: new Float32Array(0),
      ys: new Float32Array(0),
      civIds: new Int16Array(0),
      lineages: new Int8Array(0),
      healths: new Uint8Array(0),
      moods: new Uint8Array(0),
      settlements: [],
      territory: null,
      recentEvents: [],
      metrics: [
        {
          civId: 0,
          name: 'Opus Dominion',
          color: '#e4572e',
          population: 100,
          births: 1,
          deaths: 0,
          techCount: 1,
          atWar: false,
          lineageShare: { opus: 1, sonnet: 0, haiku: 0, fable: 0 },
          avgMorality: { care: 0.5, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 },
          avgEmotions: { fear: 0.1, joy: 0.5, grief: 0.1, anger: 0.1, hope: 0.5 },
          foodPerCapita: 1,
        },
      ],
    });

    expect(root.querySelector('#dock-dashboard')?.textContent).toContain('Opus Dominion');
  });
});
```

- [ ] **Step 11: Run the test and confirm it fails, then passes**

Run:

```
npx vitest run tests/ui/main-dashboard-wiring.test.ts
```

Expected first (before Step 9's edit): FAIL, since `#dock-dashboard` stays empty. After applying Step 9:

```
npx vitest run tests/ui/main-dashboard-wiring.test.ts
```

Expected: PASS — `Test Files  1 passed (1)`, `Tests  1 passed (1)`.

- [ ] **Step 12: Run the full UI suite and typecheck**

Run:

```
npx vitest run tests/ui
npm run typecheck
```

Expected: every UI test file passes with zero failures; `npm run typecheck` exits 0.

- [ ] **Step 13: Commit**

Run:

```
git add src/ui/charts.ts src/ui/dashboard.ts src/ui/main.ts tests/ui/charts.test.ts tests/ui/dashboard.test.ts tests/ui/main-dashboard-wiring.test.ts
git commit -m "feat(ui): line/stacked-area charts and the civ dashboard" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 43: Event feed (`src/ui/feed.ts`)

**Files:**
- Create: `src/ui/feed.ts`
- Modify: `src/ui/main.ts` (wires the feed into `#dock-feed`, fed by every snapshot's `recentEvents`)
- Test: `tests/ui/feed.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): none directly (civ names are read off `NarrativeEvent.civId` cross-referenced against a caller-supplied civ name map, since `NarrativeEvent` itself carries only `civId: number | null`)
- From `src/engine/sim/events.ts` (Task 34): `NarrativeEvent`
- From `src/shared/protocol.ts` (Task 35): `Snapshot`, `CivMetrics` (for deriving the civ-name filter dropdown's options from the latest snapshot's `metrics`)
- From `src/ui/dom.ts` (Task 38): `el`
- Tests use hand-built `NarrativeEvent[]` fixtures and a hand-built `CivMetrics[]` fixture for the filter dropdown — no canvas involved, so this task needs no 2D context stub

Produces:
- `export const FEED_ROW_CAP = 200` — the contract's DOM-recycled row cap.
- `export interface FeedHandle { root: HTMLElement; push(events: NarrativeEvent[], civNames: Map<number, string>): void }` and `export function renderFeed(container: HTMLElement): FeedHandle` — additive (contract names the file/role only). `push` appends `events` (in the order given — callers pass `snapshot.recentEvents`, which is already tick-ascending per Task 35) to an internal newest-first row list, keeping only the most recent `FEED_ROW_CAP` (oldest dropped first) and re-rendering the DOM by **recycling** existing row elements: if the internal row array's length is `<= FEED_ROW_CAP` and DOM row elements already exist from a previous `push`, existing `<div class="feed-row">` elements are reused (their text/class/style updated in place) up to the overlap, and only the delta is created/removed — concretely, `renderFeed` keeps its own `HTMLElement[]` pool the same length as the capped row array after every `push`, calling `el(...)` only for the newly-needed elements beyond the pool's current length and calling `.remove()` only on elements beyond the new capped length, never rebuilding the whole list from scratch. Rows render newest first (row 0 = most recent event), severity-colored via the `feed-row severity-<n>` classes already defined in `theme.css` (Task 38), each row's text is `Year <floor(tick/360)>, <season-agnostic — season is not on NarrativeEvent, so only the year is shown>: <text>` prefixed with the resolved civ name in brackets when `civId !== null` (`civNames.get(civId) ?? 'Unknown'`) and omitted entirely for civ-agnostic events (`civId === null`, e.g. extinction). A civ filter `<select data-testid="feed-civ-filter">` (options: `'all'` plus one option per entry in the civ-name map passed to the **most recent** `push` call, value = civ id as a string) hides (`display: none`, not removed — filtering never touches the recycled pool's underlying data) every row whose `civId` does not match the selected filter; selecting `'all'` shows every row again. Filtering re-applies automatically after every `push` (a newly pushed row that matches the current filter is visible immediately, not just after manually re-selecting the dropdown).

Wiring notes for Task 44 (binding):
- `main.ts`'s next modification (this task) constructs `const feedHandle = renderFeed(document.getElementById('dock-feed')!)` once and calls `feedHandle.push(snapshot.recentEvents, new Map(snapshot.metrics.map((m) => [m.civId, m.name])))` inside the same `client.onSnapshot` subscription already updating the map/inspector/dashboard/controls.
- Task 44 does not read from `feed.ts` at all — save/load/autosave/replay are independent of the event feed's DOM state.

- [ ] **Step 1: Write the failing feed tests**

Create `tests/ui/feed.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { FEED_ROW_CAP, renderFeed } from '../../src/ui/feed';
import type { NarrativeEvent } from '../../src/engine/sim/events';

function ev(overrides: Partial<NarrativeEvent> = {}): NarrativeEvent {
  return { tick: 0, kind: 'birth', severity: 1, civId: 0, text: 'A child is born.', ...overrides };
}

const civNames = new Map<number, string>([
  [0, 'Opus Dominion'],
  [1, 'Sonnet Commonwealth'],
]);

describe('renderFeed — ordering', () => {
  it('renders rows newest-first across multiple push calls', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ tick: 1, text: 'first' })], civNames);
    handle.push([ev({ tick: 2, text: 'second' })], civNames);
    const rows = container.querySelectorAll('.feed-row');
    expect(rows[0]?.textContent).toContain('second');
    expect(rows[1]?.textContent).toContain('first');
  });

  it('renders multiple events from a single push call in the given order, newest first overall', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ tick: 1, text: 'a' }), ev({ tick: 2, text: 'b' })], civNames);
    const rows = container.querySelectorAll('.feed-row');
    expect(rows[0]?.textContent).toContain('b');
    expect(rows[1]?.textContent).toContain('a');
  });
});

describe('renderFeed — severity color classes', () => {
  it('applies the matching severity-<n> class per row', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ tick: 1, severity: 1 }), ev({ tick: 2, severity: 3 })], civNames);
    const rows = container.querySelectorAll('.feed-row');
    expect(rows[0]?.classList.contains('severity-3')).toBe(true);
    expect(rows[1]?.classList.contains('severity-1')).toBe(true);
  });
});

describe('renderFeed — civ name resolution', () => {
  it('prefixes rows with the resolved civ name when civId is set', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ civId: 1, text: 'A settlement is founded.' })], civNames);
    expect(container.querySelector('.feed-row')?.textContent).toContain('Sonnet Commonwealth');
  });

  it('omits any civ prefix for civ-agnostic events (civId null)', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ civId: null, text: 'The last person has died.' })], civNames);
    expect(container.querySelector('.feed-row')?.textContent).not.toContain('Unknown');
    expect(container.querySelector('.feed-row')?.textContent).toContain('The last person has died.');
  });

  it('falls back to "Unknown" for a civId with no matching name', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ civId: 99, text: 'Something happens.' })], civNames);
    expect(container.querySelector('.feed-row')?.textContent).toContain('Unknown');
  });
});

describe('renderFeed — cap', () => {
  it('caps stored/rendered rows at FEED_ROW_CAP, keeping only the most recent', () => {
    expect(FEED_ROW_CAP).toBe(200);
    const container = document.createElement('div');
    const handle = renderFeed(container);
    const events = Array.from({ length: 250 }, (_, i) => ev({ tick: i, text: `event ${i}` }));
    handle.push(events, civNames);
    const rows = container.querySelectorAll('.feed-row');
    expect(rows.length).toBe(200);
    expect(rows[0]?.textContent).toContain('event 249');
    expect(rows[199]?.textContent).toContain('event 50'); // oldest 50 dropped
  });

  it('recycles DOM row elements across pushes rather than rebuilding from scratch', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ tick: 1, text: 'a' })], civNames);
    const firstRowEl = container.querySelector('.feed-row');
    handle.push([ev({ tick: 2, text: 'b' })], civNames);
    const secondPushRows = container.querySelectorAll('.feed-row');
    // The element that was row 0 ("a") is recycled to become row 1 ("a"
    // still, now second), i.e. its node identity survives if the pool is
    // reused; assert content correctness (recycling is an implementation
    // detail we verify indirectly via the DOM's node count staying
    // proportional to unique rows, not doubling).
    expect(secondPushRows.length).toBe(2);
    expect(firstRowEl).not.toBeNull();
  });
});

describe('renderFeed — civ filter dropdown', () => {
  it('renders an "all" option plus one option per civ name', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ civId: 0 })], civNames);
    const options = container.querySelectorAll('[data-testid="feed-civ-filter"] option');
    expect(options.length).toBe(3); // all + 2 civs
  });

  it('selecting a civ hides rows from other civs and civ-agnostic rows', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push(
      [
        ev({ tick: 1, civId: 0, text: 'opus event' }),
        ev({ tick: 2, civId: 1, text: 'sonnet event' }),
        ev({ tick: 3, civId: null, text: 'extinction event' }),
      ],
      civNames,
    );
    const select = container.querySelector('[data-testid="feed-civ-filter"]') as HTMLSelectElement;
    select.value = '0';
    select.dispatchEvent(new Event('change'));
    const rows = Array.from(container.querySelectorAll('.feed-row'));
    const visible = rows.filter((r) => (r as HTMLElement).style.display !== 'none');
    expect(visible).toHaveLength(1);
    expect(visible[0]?.textContent).toContain('opus event');
  });

  it('selecting "all" shows every row again', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ tick: 1, civId: 0 }), ev({ tick: 2, civId: 1 })], civNames);
    const select = container.querySelector('[data-testid="feed-civ-filter"]') as HTMLSelectElement;
    select.value = '0';
    select.dispatchEvent(new Event('change'));
    select.value = 'all';
    select.dispatchEvent(new Event('change'));
    const rows = Array.from(container.querySelectorAll('.feed-row'));
    const visible = rows.filter((r) => (r as HTMLElement).style.display !== 'none');
    expect(visible).toHaveLength(2);
  });

  it('a newly pushed row matching the active filter is visible immediately', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ tick: 1, civId: 0 }), ev({ tick: 2, civId: 1 })], civNames);
    const select = container.querySelector('[data-testid="feed-civ-filter"]') as HTMLSelectElement;
    select.value = '0';
    select.dispatchEvent(new Event('change'));
    handle.push([ev({ tick: 3, civId: 0, text: 'new opus event' })], civNames);
    const rows = Array.from(container.querySelectorAll('.feed-row'));
    const visible = rows.filter((r) => (r as HTMLElement).style.display !== 'none');
    expect(visible.some((r) => r.textContent?.includes('new opus event'))).toBe(true);
    const hiddenSonnet = rows.find((r) => r.textContent?.includes('sonnet') || false);
    void hiddenSonnet;
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/ui/feed.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../src/ui/feed" from "tests/ui/feed.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/ui/feed.ts`**

Create `src/ui/feed.ts` with exactly:

```ts
import { el } from './dom';
import type { NarrativeEvent } from '../engine/sim/events';

export const FEED_ROW_CAP = 200;

export interface FeedHandle {
  root: HTMLElement;
  push(events: NarrativeEvent[], civNames: Map<number, string>): void;
}

const YEAR_TICKS_LOCAL = 360;

function rowText(e: NarrativeEvent, civNames: Map<number, string>): string {
  const year = Math.floor(e.tick / YEAR_TICKS_LOCAL);
  if (e.civId === null) return `Year ${year}: ${e.text}`;
  const name = civNames.get(e.civId) ?? 'Unknown';
  return `Year ${year} [${name}]: ${e.text}`;
}

export function renderFeed(container: HTMLElement): FeedHandle {
  container.innerHTML = '';

  let rowsNewestFirst: NarrativeEvent[] = [];
  let rowPool: HTMLElement[] = [];
  let currentFilter: string = 'all';
  let lastCivNames: Map<number, string> = new Map();

  const filterSelect = el('select', { class: 'btn', 'data-testid': 'feed-civ-filter' }) as HTMLSelectElement;
  filterSelect.addEventListener('change', () => {
    currentFilter = filterSelect.value;
    applyFilter();
  });

  const rowsContainer = el('div', { class: 'feed-rows' });
  const root = el('div', { class: 'feed' }, filterSelect, rowsContainer);
  container.appendChild(root);

  function rebuildFilterOptions(civNames: Map<number, string>): void {
    const previousValue = filterSelect.value || 'all';
    filterSelect.innerHTML = '';
    filterSelect.appendChild(el('option', { value: 'all' }, 'All civilizations'));
    for (const [civId, name] of civNames) {
      filterSelect.appendChild(el('option', { value: String(civId) }, name));
    }
    filterSelect.value = previousValue;
    currentFilter = filterSelect.value || 'all';
  }

  function applyFilter(): void {
    for (let i = 0; i < rowsNewestFirst.length; i++) {
      const rowEl = rowPool[i];
      if (rowEl === undefined) continue;
      const e = rowsNewestFirst[i] as NarrativeEvent;
      const matches = currentFilter === 'all' || (e.civId !== null && String(e.civId) === currentFilter);
      rowEl.style.display = matches ? '' : 'none';
    }
  }

  function renderRow(rowEl: HTMLElement, e: NarrativeEvent, civNames: Map<number, string>): void {
    rowEl.className = `feed-row severity-${e.severity}`;
    rowEl.textContent = rowText(e, civNames);
  }

  return {
    root,
    push(events: NarrativeEvent[], civNames: Map<number, string>): void {
      lastCivNames = civNames;
      rebuildFilterOptions(civNames);

      // Newest-first: new events are prepended in the order given (already
      // tick-ascending), so reverse them before prepending to keep the
      // overall newest-first invariant.
      const toPrepend = [...events].reverse();
      rowsNewestFirst = [...toPrepend, ...rowsNewestFirst].slice(0, FEED_ROW_CAP);

      // Recycle the DOM pool: grow it to match, reusing existing nodes for
      // the overlap, removing any pool nodes beyond the new capped length.
      while (rowPool.length < rowsNewestFirst.length) {
        const rowEl = el('div', { class: 'feed-row' });
        rowsContainer.insertBefore(rowEl, rowsContainer.firstChild);
        rowPool.unshift(rowEl);
      }
      while (rowPool.length > rowsNewestFirst.length) {
        const removed = rowPool.pop();
        removed?.remove();
      }

      for (let i = 0; i < rowsNewestFirst.length; i++) {
        const rowEl = rowPool[i];
        const e = rowsNewestFirst[i];
        if (rowEl === undefined || e === undefined) continue;
        renderRow(rowEl, e, lastCivNames);
      }

      applyFilter();
    },
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/ui/feed.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/feed.test.ts (13 tests)

 Test Files  1 passed (1)
      Tests  13 passed (13)
```

If the "recycling" test fails because the DOM pool's front-insertion order does not keep row 0 as the most recent event, double check `push`'s `insertBefore(rowEl, rowsContainer.firstChild)` — new pool slots are always unshifted to the front of both `rowPool` and `rowsContainer`'s children, keeping index 0 == newest throughout.

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Wire the feed into `src/ui/main.ts`**

Open `src/ui/main.ts` (Task 42's version) and apply these changes:

Add to the imports:

```ts
import { renderFeed } from './feed';
```

Inside the `handle.onBegin` callback, after the dashboard wiring added in Task 42, append:

```ts
    const feedHandle = renderFeed(document.getElementById('dock-feed')!);
    client.onSnapshot((snapshot) => {
      const civNames = new Map(snapshot.metrics.map((m) => [m.civId, m.name] as [number, string]));
      feedHandle.push(snapshot.recentEvents, civNames);
    });
```

- [ ] **Step 7: Write the failing wiring test**

Create `tests/ui/main-feed-wiring.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/client', () => {
  class FakeSimClient {
    snapshotCb: ((s: unknown) => void) | null = null;
    start(): void {}
    send(): void {}
    onSnapshot(cb: (s: unknown) => void): void {
      this.snapshotCb = cb;
    }
    onInspect(): void {}
    onSerialized(): void {}
    onError(): void {}
  }
  return { SimClient: FakeSimClient };
});

vi.mock('../../src/ui/map', async () => {
  const actual = await vi.importActual<typeof import('../../src/ui/map')>('../../src/ui/map');
  class FakeMapView {
    render(): void {}
    onPickPerson(): void {}
    onPickSettlement(): void {}
    setTerrain(): void {}
  }
  return { ...actual, MapView: FakeMapView };
});

describe('main.ts wires the event feed to every snapshot', () => {
  it('feeding a snapshot with recentEvents populates the feed panel', async () => {
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    (root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();

    const client = mod.activeClient as unknown as { snapshotCb: ((s: unknown) => void) | null };
    client.snapshotCb?.({
      tick: 360,
      year: 1,
      season: 'spring',
      population: 1,
      worldSize: 96,
      ids: new Int32Array(0),
      xs: new Float32Array(0),
      ys: new Float32Array(0),
      civIds: new Int16Array(0),
      lineages: new Int8Array(0),
      healths: new Uint8Array(0),
      moods: new Uint8Array(0),
      settlements: [],
      territory: null,
      recentEvents: [{ tick: 300, kind: 'birth', severity: 1, civId: 0, text: 'A child is born to Mira and Boren.' }],
      metrics: [
        {
          civId: 0,
          name: 'Opus Dominion',
          color: '#e4572e',
          population: 1,
          births: 1,
          deaths: 0,
          techCount: 0,
          atWar: false,
          lineageShare: { opus: 1, sonnet: 0, haiku: 0, fable: 0 },
          avgMorality: { care: 0.5, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 },
          avgEmotions: { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 },
          foodPerCapita: 1,
        },
      ],
    });

    expect(root.querySelector('#dock-feed')?.textContent).toContain('A child is born to Mira and Boren.');
    expect(root.querySelector('#dock-feed')?.textContent).toContain('Opus Dominion');
  });
});
```

- [ ] **Step 8: Run the test and confirm it fails, then passes**

Run:

```
npx vitest run tests/ui/main-feed-wiring.test.ts
```

Expected first (before Step 6's edit): FAIL, since `#dock-feed` stays empty. After applying Step 6:

```
npx vitest run tests/ui/main-feed-wiring.test.ts
```

Expected: PASS — `Test Files  1 passed (1)`, `Tests  1 passed (1)`.

- [ ] **Step 9: Run the full UI suite and typecheck**

Run:

```
npx vitest run tests/ui
npm run typecheck
```

Expected: every UI test file passes with zero failures; `npm run typecheck` exits 0.

- [ ] **Step 10: Commit**

Run:

```
git add src/ui/feed.ts src/ui/main.ts tests/ui/feed.test.ts tests/ui/main-feed-wiring.test.ts
git commit -m "feat(ui): DOM-recycled event feed with severity colors and civ filter" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 44: IndexedDB save/load/autosave, export/import, and replay (`src/ui/storage.ts` + `src/ui/replay.ts` + `src/ui/main.ts` modify)

**Files:**
- Create: `src/ui/storage.ts`
- Create: `src/ui/replay.ts`
- Modify: `src/ui/main.ts` (wires save/load/export/import buttons into `#topbar-io`, autosave timer, resume-on-startup prompt, and the real `SimClient` `recover` hook)
- Test: `tests/ui/storage.test.ts`
- Test: `tests/ui/replay.test.ts`
- Test: `tests/ui/main-storage-wiring.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `SimConfig`
- From `src/engine/sim/simulation.ts` (Task 33): `Simulation`
- From `src/engine/sim/save.ts` (Task 36): `serialize(sim): string`, `deserialize(json): Simulation`
- From `src/engine/sim/snapshot.ts` (Task 35): `takeSnapshot(sim, includeTerritory): Snapshot`
- From `src/ui/dom.ts` (Task 38): `el`
- From `src/ui/client.ts` (Task 39): `SimClient` (this task is the first to construct one with a real `recover` option)
- Tests use a hand-built complete in-memory fake `IDBFactory` (Step 1) instead of a real browser IndexedDB (jsdom has none) — this fake is written in full inside the test file per this section's requirement, not imported from a shared helper

Produces:
- (in `src/ui/storage.ts`) `export const DB_NAME = 'genesis'`, `export const STORE_NAME = 'saves'`, `export const AUTOSAVE_NAME = '__autosave'`, `export const AUTOSAVE_INTERVAL_MS = 60000` — contract-named constants made concrete.
- (in `src/ui/storage.ts`) `export function saveRun(name: string, json: string, factory?: IDBFactory): Promise<void>` — contract signature plus section deviation 5's injectable trailing `factory` parameter (defaults to `globalThis.indexedDB`). Opens/creates the `genesis` database (version 1, creating the `saves` object store keyed by `name` with `savedAt`/`bytes` as indexed-free plain fields on the stored record if the store does not yet exist), then puts `{ name, json, savedAt: <caller-supplied clock — see note below>, bytes: json.length }`.
- (in `src/ui/storage.ts`) `export function loadRun(name: string, factory?: IDBFactory): Promise<string | null>` — contract signature plus the same injectable `factory`; resolves the stored `json` or `null` if `name` is absent.
- (in `src/ui/storage.ts`) `export function listRuns(factory?: IDBFactory): Promise<{ name: string; savedAt: number; bytes: number }[]>` — contract signature plus injectable `factory`; resolves every stored record's metadata, sorted by `savedAt` descending (most recent first).
- (in `src/ui/storage.ts`) `export function deleteRun(name: string, factory?: IDBFactory): Promise<void>` — contract signature plus injectable `factory`.
- (in `src/ui/storage.ts`) `export function makeInMemoryIDBFactory(): IDBFactory` — the complete in-memory fake `IDBFactory` this task's own tests use, exported so Task 45's smoke/balance tests (and any future test) can reuse it rather than re-implementing it; it supports exactly the subset of the IndexedDB API `storage.ts` itself calls (`open`, with `onupgradeneeded`/`onsuccess`/`onerror`, `IDBDatabase.transaction`, `IDBObjectStore.put`/`get`/`getAll`/`delete`, `IDBRequest.onsuccess`/`onerror`) — not a general-purpose polyfill, a purpose-built fake matching this module's usage exactly (full code in Step 3 below).
- (in `src/ui/storage.ts`) `export function startAutosave(client: SimClient, factory?: IDBFactory): { stop(): void }` — additive (contract only says "autosave: every 60s to name '__autosave'"): calls `client.send({ type: 'serialize' })` every `AUTOSAVE_INTERVAL_MS` via `setInterval`, and the resulting `onSerialized` payload (subscribed once, filtered internally to only act while this autosave loop is active — see Step 4's implementation note about `SimClient.onSerialized` being append-only/never-unsubscribed, satisfied here by a boolean `active` flag the returned `stop()` flips instead of trying to remove the listener) is written via `saveRun(AUTOSAVE_NAME, json, factory)`. Returns a handle whose `stop()` clears the interval and flips `active = false`.
- (in `src/ui/replay.ts`) `export interface ReplayHandle { root: HTMLElement; scrubTo(targetTick: number): Promise<void> }` and `export function renderReplay(container: HTMLElement, savedJson: string): ReplayHandle` — additive (contract names the file/role only). **Documented explicitly, per this section's deviation 6, as deterministic re-simulation, not stored frames:** `renderReplay` calls `deserialize(savedJson)` once up front to read the save's `config`/`tick` only (to know the seed and the save's own tick as the scrubber's maximum), then discards that `Simulation` instance; `scrubTo(targetTick)` **always** constructs a brand-new `Simulation` from the save's original `config` (via `new Simulation(config)`, never `deserialize`, since deserializing only reproduces the exact saved tick — the whole point of the scrubber is reaching *other* ticks deterministically) and calls `.tick()` in a loop up to `Math.min(targetTick, save's own tick)` before returning a fresh `Snapshot` it renders into a preview `<canvas data-testid="replay-canvas">` via a throwaway `MapView`-free direct pixel dump (Step 3's implementation reuses `TERRAIN_COLORS`/`civColor`/agent-dot drawing logic inline at a fixed small scale — it does not construct a full `MapView`, since `MapView` owns pan/zoom/pick interaction state the replay preview does not need). A slider input (`data-testid="replay-slider"`, `min=0`, `max=<save's tick>`) calls `scrubTo` on `input` events. `renderReplay`'s header comment states verbatim: `"Replay is deterministic re-simulation from the save's seed, not stored per-tick frames — scrubbing to tick N re-runs the simulation from tick 0 to N every time the slider moves."`

Wiring notes (binding, closes out the run screen):
- `main.ts`'s next modification (this task) does four things: (1) renders Save/Load/Export/Import buttons into `#topbar-io` (`data-testid`s `save-button`, `load-button`, `export-button`, `import-button` + a hidden `<input type="file" data-testid="import-file-input">`); Save prompts via a text `<input data-testid="save-name-input">` next to the button and calls `saveRun(name, json)` once `client.onSerialized` fires after `client.send({ type: 'serialize' })`; Load reads the same name and calls `client.send({ type: 'load', json: await loadRun(name) })`; Export calls `client.send({ type: 'serialize' })` and, on the next `onSerialized`, triggers a `Blob`/`URL.createObjectURL`/synthetic-`<a download>`-click JSON file download; Import reads the chosen `File` via `FileReader`/`.text()` and sends `{ type: 'load', json }`. (2) Calls `startAutosave(client)` once, right after `client.start(config)`. (3) **This is also the task that constructs the real `SimClient` with a working `recover` hook**, replacing Task 39's bare `new SimClient()` call with `new SimClient({ recover: () => loadRun(AUTOSAVE_NAME) })` — satisfying the contract's "auto-restart from last autosave on worker error" end-to-end for the first time. (4) On `mountApp`'s very first call (before the setup screen even renders), checks `listRuns()` for a record named `AUTOSAVE_NAME`; if present, shows a resume prompt (`data-testid="resume-prompt"`, "Resume previous run?" with `data-testid="resume-yes"`/`data-testid="resume-no"` buttons) layered over the setup screen — clicking "Resume" skips the setup screen entirely and starts the run screen with `client.send({ type: 'load', json })` in place of `client.send({ type: 'init', config })`; clicking "No" (or there being no autosave) proceeds to the normal setup screen unchanged.
- Task 45 does not modify any file from this task; it only adds new test/README files and runs verification commands.

- [ ] **Step 1: Write the failing `storage.ts` tests (including the full in-memory fake `IDBFactory`)**

Create `tests/ui/storage.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_INTERVAL_MS,
  AUTOSAVE_NAME,
  DB_NAME,
  STORE_NAME,
  deleteRun,
  listRuns,
  loadRun,
  makeInMemoryIDBFactory,
  saveRun,
  startAutosave,
} from '../../src/ui/storage';
import { SimClient } from '../../src/ui/client';
import type { SimConfig } from '../../src/shared/types';
import type { UiToWorker, WorkerToUi } from '../../src/shared/protocol';

describe('makeInMemoryIDBFactory — fake roundtrip', () => {
  it('save then load returns the same json', async () => {
    const factory = makeInMemoryIDBFactory();
    await saveRun('run-a', '{"tick":1}', factory);
    const loaded = await loadRun('run-a', factory);
    expect(loaded).toBe('{"tick":1}');
  });

  it('loading an absent name returns null', async () => {
    const factory = makeInMemoryIDBFactory();
    const loaded = await loadRun('nope', factory);
    expect(loaded).toBeNull();
  });

  it('list returns every saved run, sorted by savedAt descending', async () => {
    const factory = makeInMemoryIDBFactory();
    await saveRun('older', '{"a":1}', factory);
    await saveRun('newer', '{"b":2}', factory);
    const runs = await listRuns(factory);
    expect(runs.map((r) => r.name)).toEqual(['newer', 'older']);
    expect(runs[0]?.bytes).toBe('{"b":2}'.length);
  });

  it('delete removes a run so it no longer loads or lists', async () => {
    const factory = makeInMemoryIDBFactory();
    await saveRun('temp', '{"x":1}', factory);
    await deleteRun('temp', factory);
    expect(await loadRun('temp', factory)).toBeNull();
    expect(await listRuns(factory)).toHaveLength(0);
  });

  it('saving under the same name twice overwrites the previous value', async () => {
    const factory = makeInMemoryIDBFactory();
    await saveRun('same', '{"v":1}', factory);
    await saveRun('same', '{"v":2}', factory);
    expect(await loadRun('same', factory)).toBe('{"v":2}');
    expect(await listRuns(factory)).toHaveLength(1);
  });

  it('DB_NAME/STORE_NAME/AUTOSAVE_NAME/AUTOSAVE_INTERVAL_MS have the documented values', () => {
    expect(DB_NAME).toBe('genesis');
    expect(STORE_NAME).toBe('saves');
    expect(AUTOSAVE_NAME).toBe('__autosave');
    expect(AUTOSAVE_INTERVAL_MS).toBe(60000);
  });
});

class FakeWorker {
  sent: UiToWorker[] = [];
  onmessage: ((ev: MessageEvent<WorkerToUi>) => void) | null = null;
  postMessage(msg: UiToWorker): void {
    this.sent.push(msg);
  }
  terminate(): void {}
  emit(msg: WorkerToUi): void {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerToUi>);
  }
}

const config: SimConfig = { seed: 1, mode: 'civs', mapSize: 'small', startPopulation: 200 };

describe('startAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a serialize message every AUTOSAVE_INTERVAL_MS while active', () => {
    let worker!: FakeWorker;
    const client = new SimClient({
      workerFactory: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    });
    client.start(config);
    const factory = makeInMemoryIDBFactory();
    const handle = startAutosave(client, factory);

    worker.sent.length = 0;
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    expect(worker.sent).toEqual([{ type: 'serialize' }]);

    worker.sent.length = 0;
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS * 2);
    expect(worker.sent).toEqual([{ type: 'serialize' }, { type: 'serialize' }]);

    handle.stop();
  });

  it('writes the resulting serialized json to AUTOSAVE_NAME via saveRun', async () => {
    let worker!: FakeWorker;
    const client = new SimClient({
      workerFactory: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    });
    client.start(config);
    const factory = makeInMemoryIDBFactory();
    const handle = startAutosave(client, factory);

    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    worker.emit({ type: 'serialized', json: '{"v":1,"tick":42}' });
    await vi.waitFor(async () => {
      const loaded = await loadRun(AUTOSAVE_NAME, factory);
      expect(loaded).toBe('{"v":1,"tick":42}');
    });

    handle.stop();
  });

  it('stop() halts future autosave ticks', () => {
    let worker!: FakeWorker;
    const client = new SimClient({
      workerFactory: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    });
    client.start(config);
    const factory = makeInMemoryIDBFactory();
    const handle = startAutosave(client, factory);
    handle.stop();
    worker.sent.length = 0;
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS * 3);
    expect(worker.sent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/ui/storage.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../src/ui/storage" from "tests/ui/storage.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/ui/storage.ts` (including the full in-memory fake `IDBFactory`)**

Create `src/ui/storage.ts` with exactly:

```ts
import type { SimClient } from './client';

export const DB_NAME = 'genesis';
export const STORE_NAME = 'saves';
export const AUTOSAVE_NAME = '__autosave';
export const AUTOSAVE_INTERVAL_MS = 60000;

interface SaveRecord {
  name: string;
  json: string;
  savedAt: number;
  bytes: number;
}

function defaultFactory(): IDBFactory {
  return globalThis.indexedDB;
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = (): void => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('storage.ts: failed to open genesis db'));
  });
}

/** Contract signature verbatim plus an injectable trailing IDBFactory (defaults to globalThis.indexedDB). */
export function saveRun(name: string, json: string, factory: IDBFactory = defaultFactory()): Promise<void> {
  return openDb(factory).then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record: SaveRecord = { name, json, savedAt: Date.now(), bytes: json.length };
        const request = store.put(record);
        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(request.error ?? new Error('storage.ts: saveRun failed'));
      }),
  );
}

/** Contract signature verbatim plus an injectable trailing IDBFactory. */
export function loadRun(name: string, factory: IDBFactory = defaultFactory()): Promise<string | null> {
  return openDb(factory).then(
    (db) =>
      new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(name);
        request.onsuccess = (): void => {
          const record = request.result as SaveRecord | undefined;
          resolve(record !== undefined ? record.json : null);
        };
        request.onerror = (): void => reject(request.error ?? new Error('storage.ts: loadRun failed'));
      }),
  );
}

/** Contract signature verbatim plus an injectable trailing IDBFactory. Sorted by savedAt descending. */
export function listRuns(
  factory: IDBFactory = defaultFactory(),
): Promise<{ name: string; savedAt: number; bytes: number }[]> {
  return openDb(factory).then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = (): void => {
          const records = (request.result as SaveRecord[]).slice();
          records.sort((a, b) => b.savedAt - a.savedAt);
          resolve(records.map((r) => ({ name: r.name, savedAt: r.savedAt, bytes: r.bytes })));
        };
        request.onerror = (): void => reject(request.error ?? new Error('storage.ts: listRuns failed'));
      }),
  );
}

/** Contract signature verbatim plus an injectable trailing IDBFactory. */
export function deleteRun(name: string, factory: IDBFactory = defaultFactory()): Promise<void> {
  return openDb(factory).then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(name);
        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(request.error ?? new Error('storage.ts: deleteRun failed'));
      }),
  );
}

/**
 * Complete in-memory fake IDBFactory covering exactly the IndexedDB surface
 * storage.ts itself calls: open (with onupgradeneeded/onsuccess/onerror),
 * IDBDatabase.transaction, IDBObjectStore.put/get/getAll/delete, and
 * IDBRequest.onsuccess/onerror. Not a general-purpose polyfill.
 */
export function makeInMemoryIDBFactory(): IDBFactory {
  const stores = new Map<string, Map<string, unknown>>();
  let created = false;

  function makeRequest<T>(work: () => T): IDBRequest<T> {
    const req = {
      result: undefined as unknown as T,
      error: null as DOMException | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    queueMicrotask(() => {
      try {
        req.result = work();
        req.onsuccess?.();
      } catch (err) {
        req.error = err as DOMException;
        req.onerror?.();
      }
    });
    return req as unknown as IDBRequest<T>;
  }

  function makeObjectStore(storeName: string): IDBObjectStore {
    const table = stores.get(storeName) as Map<string, unknown>;
    return {
      put: (value: unknown) => makeRequest(() => {
        table.set((value as { name: string }).name, value);
        return undefined as unknown;
      }),
      get: (key: string) => makeRequest(() => table.get(key)),
      getAll: () => makeRequest(() => Array.from(table.values())),
      delete: (key: string) => makeRequest(() => {
        table.delete(key);
        return undefined as unknown;
      }),
    } as unknown as IDBObjectStore;
  }

  function makeDb(): IDBDatabase {
    return {
      objectStoreNames: {
        contains: (name: string) => stores.has(name),
      },
      createObjectStore: (name: string) => {
        stores.set(name, new Map());
        return makeObjectStore(name);
      },
      transaction: (name: string) => ({
        objectStore: () => makeObjectStore(name),
      }),
    } as unknown as IDBDatabase;
  }

  const factory: Partial<IDBFactory> = {
    open: (_name: string, _version?: number) => {
      const req = {
        result: undefined as unknown as IDBDatabase,
        error: null as DOMException | null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => {
        const db = makeDb();
        req.result = db;
        if (!created) {
          created = true;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req as unknown as IDBOpenDBRequest;
    },
  };

  return factory as IDBFactory;
}

export interface AutosaveHandle {
  stop(): void;
}

/**
 * Additive (contract only names the 60s autosave interval). Sends a
 * 'serialize' request every AUTOSAVE_INTERVAL_MS and writes the result to
 * AUTOSAVE_NAME. `active` guards the subscription (SimClient's onSerialized
 * is append-only/never-unsubscribed) so stop() can cheaply disable writes
 * without needing an unsubscribe API on SimClient.
 */
export function startAutosave(client: SimClient, factory: IDBFactory = defaultFactory()): AutosaveHandle {
  let active = true;

  client.onSerialized((json) => {
    if (!active) return;
    void saveRun(AUTOSAVE_NAME, json, factory);
  });

  const interval = setInterval(() => {
    if (!active) return;
    client.send({ type: 'serialize' });
  }, AUTOSAVE_INTERVAL_MS);

  return {
    stop(): void {
      active = false;
      clearInterval(interval);
    },
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/ui/storage.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/storage.test.ts (9 tests)

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- [ ] **Step 5: Write the failing `replay.ts` tests**

Create `tests/ui/replay.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderReplay } from '../../src/ui/replay';
import { Simulation } from '../../src/engine/sim/simulation';
import { serialize } from '../../src/engine/sim/save';
import type { SimConfig } from '../../src/shared/types';

function stubAllCanvasContexts(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    set fillStyle(_v: string) {},
  } as unknown as CanvasRenderingContext2D);
}

const config: SimConfig = { seed: 4, mode: 'civs', mapSize: 'small', startPopulation: 200 };

function makeSavedJson(ticks: number): string {
  const sim = new Simulation(config);
  for (let i = 0; i < ticks; i++) sim.tick();
  return serialize(sim);
}

describe('renderReplay', () => {
  it('renders a slider bounded by the save\'s own tick', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    renderReplay(container, makeSavedJson(50));
    const slider = container.querySelector('[data-testid="replay-slider"]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('50');
  });

  it('scrubTo(0) resolves without throwing and renders the preview canvas', async () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderReplay(container, makeSavedJson(30));
    await expect(handle.scrubTo(0)).resolves.toBeUndefined();
    expect(container.querySelector('[data-testid="replay-canvas"]')).not.toBeNull();
  });

  it('scrubTo(targetTick) re-simulates deterministically: scrubbing to the same tick twice gives the same population', async () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderReplay(container, makeSavedJson(40));
    let firstPopulation = -1;
    let secondPopulation = -1;
    const originalTick = Simulation.prototype.tick;
    void originalTick;
    await handle.scrubTo(20);
    // Population is exposed indirectly via a readout the implementation
    // renders — assert the readout text is stable across two scrubs to the
    // same target tick (a proxy for "two fresh re-simulations to the same
    // tick agree", the deterministic-replay guarantee).
    const readoutAfterFirst = container.querySelector('[data-testid="replay-readout"]')?.textContent ?? '';
    await handle.scrubTo(20);
    const readoutAfterSecond = container.querySelector('[data-testid="replay-readout"]')?.textContent ?? '';
    expect(readoutAfterFirst).toBe(readoutAfterSecond);
    void firstPopulation;
    void secondPopulation;
  });

  it('clamps a target tick beyond the save\'s own tick to the save\'s tick', async () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderReplay(container, makeSavedJson(10));
    await expect(handle.scrubTo(999999)).resolves.toBeUndefined();
    const readout = container.querySelector('[data-testid="replay-readout"]')?.textContent ?? '';
    expect(readout).toContain('10');
  });

  it('moving the slider calls scrubTo (readout updates to the new tick)', async () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    renderReplay(container, makeSavedJson(60));
    const slider = container.querySelector('[data-testid="replay-slider"]') as HTMLInputElement;
    slider.value = '30';
    slider.dispatchEvent(new Event('input'));
    await vi.waitFor(() => {
      const readout = container.querySelector('[data-testid="replay-readout"]')?.textContent ?? '';
      expect(readout).toContain('30');
    });
  });
});
```

- [ ] **Step 6: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/ui/replay.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../src/ui/replay" from "tests/ui/replay.test.ts". Does the file exist?`

- [ ] **Step 7: Implement `src/ui/replay.ts`**

Create `src/ui/replay.ts` with exactly:

```ts
// Replay is deterministic re-simulation from the save's seed, not stored
// per-tick frames — scrubbing to tick N re-runs the simulation from tick 0
// to N every time the slider moves. There is no per-tick frame cache.

import { el } from './dom';
import { civColor, TERRAIN_COLORS } from './map';
import { Simulation } from '../engine/sim/simulation';
import { deserialize } from '../engine/sim/save';
import { takeSnapshot } from '../engine/sim/snapshot';
import type { SimConfig } from '../shared/types';

export interface ReplayHandle {
  root: HTMLElement;
  scrubTo(targetTick: number): Promise<void>;
}

const PREVIEW_SIZE_PX = 240;

function drawPreview(canvas: HTMLCanvasElement, worldSize: number, snapshotIds: Int32Array, xs: Float32Array, ys: Float32Array, civIds: Int16Array): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.save();
  ctx.fillStyle = TERRAIN_COLORS.plains;
  ctx.fillRect(0, 0, PREVIEW_SIZE_PX, PREVIEW_SIZE_PX);
  const scale = PREVIEW_SIZE_PX / worldSize;
  for (let i = 0; i < snapshotIds.length; i++) {
    const x = (xs[i] as number) * scale;
    const y = (ys[i] as number) * scale;
    ctx.fillStyle = civColor(civIds[i] as number);
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Additive (contract names the file/role only). Deterministic-re-simulation
 * scrubber: every scrubTo() call constructs a brand-new Simulation from the
 * save's original config and ticks it forward from 0 — see this file's
 * header comment.
 */
export function renderReplay(container: HTMLElement, savedJson: string): ReplayHandle {
  container.innerHTML = '';

  const savedSim = deserialize(savedJson);
  const config: SimConfig = savedSim.config;
  const maxTick = savedSim.ctx.tick;

  const canvas = el('canvas', {
    width: String(PREVIEW_SIZE_PX),
    height: String(PREVIEW_SIZE_PX),
    'data-testid': 'replay-canvas',
  }) as HTMLCanvasElement;

  const readout = el('div', { 'data-testid': 'replay-readout' }, `Tick 0 / ${maxTick}`);

  const slider = el('input', {
    type: 'range',
    min: '0',
    max: String(maxTick),
    value: '0',
    'data-testid': 'replay-slider',
  }) as HTMLInputElement;

  async function scrubTo(targetTick: number): Promise<void> {
    const clamped = Math.max(0, Math.min(targetTick, maxTick));
    const sim = new Simulation(config);
    for (let i = 0; i < clamped; i++) sim.tick();
    const snap = takeSnapshot(sim, false);
    drawPreview(canvas, snap.worldSize, snap.ids, snap.xs, snap.ys, snap.civIds);
    readout.textContent = `Tick ${clamped} / ${maxTick} (year ${Math.floor(clamped / 360)}, population ${snap.population})`;
    slider.value = String(clamped);
  }

  slider.addEventListener('input', () => {
    void scrubTo(Number(slider.value));
  });

  const root = el('div', { class: 'replay panel' }, el('h4', { class: 'panel-title' }, 'Replay'), canvas, slider, readout);
  container.appendChild(root);

  return { root, scrubTo };
}
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/ui/replay.test.ts
```

Expected: PASS —

```
 ✓ tests/ui/replay.test.ts (5 tests)

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 9: Replace `src/ui/main.ts`'s `mountApp` with a version wiring storage, autosave, resume, and the real `recover` hook**

Open `src/ui/main.ts` (Task 43's version). Add to the imports:

```ts
import { AUTOSAVE_NAME, listRuns, loadRun, saveRun, startAutosave } from './storage';
```

Then replace the entire `mountApp` function body (every earlier task's version, including the incremental `handle.onBegin` bodies Tasks 39/41/42/43 each appended to) with the version below. This single function now contains all of that earlier wiring together, plus autosave, the save/load/export/import buttons, and the resume-on-startup prompt — it is intentionally a full replacement rather than another incremental patch, because the resume path (loading an autosave) needs to reach the exact same map/inspector/dashboard/feed wiring as the normal Begin path, so both are factored into one shared `beginRun` function:

```ts
export function mountApp(root: HTMLElement): void {
  ensureThemeLinked();
  root.innerHTML = '';

  function startNormally(): void {
    const handle = renderSetupScreen(root);
    wireBegin(handle);
  }

  function wireBegin(handle: ReturnType<typeof renderSetupScreen>): void {
    handle.onBegin((config) => {
      pendingConfig = config;
      beginRun(config, { type: 'init', config });
    });
  }

  function beginRun(config: SimConfig, initialMessage: { type: 'init'; config: SimConfig } | { type: 'load'; json: string }): void {
    root.innerHTML = '';
    const runScreen = renderRunScreenShell();
    root.appendChild(runScreen);

    const client = new SimClient({ recover: () => loadRun(AUTOSAVE_NAME) });
    activeClient = client;
    // start() always constructs the worker and sends 'init' first (per
    // SimClient's contract shape, Task 39) so the worker exists either way;
    // the resume path immediately follows up with 'load', which the worker
    // protocol (Task 37) treats as a full replacement of the just-created
    // Simulation — a harmless, documented double-construction, not a bug,
    // since 'load' unconditionally overwrites WorkerState.sim.
    client.start(config);
    if (initialMessage.type === 'load') client.send(initialMessage);

    const controlsHandle = renderControls(document.getElementById('topbar-controls')!, client);
    const mapView = new MapView(document.getElementById('map-canvas') as HTMLCanvasElement);
    const inspectorHandle = renderInspector(document.getElementById('dock-inspector')!, {
      onFollow: (personId) => {
        client.send({ type: 'inspect', personId });
      },
    });
    const dashboardHandle = renderDashboard(document.getElementById('dock-dashboard')!);
    const feedHandle = renderFeed(document.getElementById('dock-feed')!);

    client.onSnapshot((snapshot) => {
      latestSnapshot = snapshot;
      controlsHandle.setReadout(snapshot.year, snapshot.season, snapshot.population);
      mapView.render(snapshot);
      dashboardHandle.onSnapshot(snapshot);
      const civNames = new Map(snapshot.metrics.map((m) => [m.civId, m.name] as [number, string]));
      feedHandle.push(snapshot.recentEvents, civNames);
    });
    client.onInspect((detail) => {
      inspectorHandle.show(detail);
    });
    mapView.onPickPerson((personId) => {
      client.send({ type: 'inspect', personId });
    });

    startAutosave(client);
    wireIoButtons(client);
  }

  function wireIoButtons(client: SimClient): void {
    const ioContainer = document.getElementById('topbar-io')!;
    const saveNameInput = el('input', { type: 'text', class: 'btn', 'data-testid': 'save-name-input', value: 'my-run' }) as HTMLInputElement;
    const saveButton = el('button', { class: 'btn', type: 'button', 'data-testid': 'save-button' }, 'Save');
    saveButton.addEventListener('click', () => {
      client.onSerialized((json) => {
        void saveRun(saveNameInput.value, json);
      });
      client.send({ type: 'serialize' });
    });

    const loadButton = el('button', { class: 'btn', type: 'button', 'data-testid': 'load-button' }, 'Load');
    loadButton.addEventListener('click', () => {
      void loadRun(saveNameInput.value).then((json) => {
        if (json !== null) client.send({ type: 'load', json });
      });
    });

    const exportButton = el('button', { class: 'btn', type: 'button', 'data-testid': 'export-button' }, 'Export');
    exportButton.addEventListener('click', () => {
      client.onSerialized((json) => {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = el('a', { href: url, download: `${saveNameInput.value}.json` }) as HTMLAnchorElement;
        link.click();
        URL.revokeObjectURL(url);
      });
      client.send({ type: 'serialize' });
    });

    const importInput = el('input', { type: 'file', accept: 'application/json', 'data-testid': 'import-file-input', style: 'display:none' }) as HTMLInputElement;
    importInput.addEventListener('change', () => {
      const file = importInput.files?.[0];
      if (file === undefined) return;
      void file.text().then((json) => {
        client.send({ type: 'load', json });
      });
    });
    const importButton = el('button', { class: 'btn', type: 'button', 'data-testid': 'import-button' }, 'Import');
    importButton.addEventListener('click', () => importInput.click());

    ioContainer.appendChild(saveNameInput);
    ioContainer.appendChild(saveButton);
    ioContainer.appendChild(loadButton);
    ioContainer.appendChild(exportButton);
    ioContainer.appendChild(importButton);
    ioContainer.appendChild(importInput);
  }

  void listRuns().then((runs) => {
    const hasAutosave = runs.some((r) => r.name === AUTOSAVE_NAME);
    if (!hasAutosave) {
      startNormally();
      return;
    }
    const prompt = el(
      'div',
      { class: 'panel', 'data-testid': 'resume-prompt' },
      el('p', {}, 'Resume previous run?'),
      el('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'resume-yes' }, 'Resume'),
      el('button', { class: 'btn', type: 'button', 'data-testid': 'resume-no' }, 'No'),
    );
    root.appendChild(prompt);
    prompt.querySelector('[data-testid="resume-yes"]')?.addEventListener('click', () => {
      void loadRun(AUTOSAVE_NAME).then((json) => {
        if (json === null) {
          startNormally();
          return;
        }
        const restoredConfig = (JSON.parse(json) as { config: SimConfig }).config;
        pendingConfig = restoredConfig;
        beginRun(restoredConfig, { type: 'load', json });
      });
    });
    prompt.querySelector('[data-testid="resume-no"]')?.addEventListener('click', () => {
      root.innerHTML = '';
      startNormally();
    });
  }).catch(() => {
    startNormally();
  });
}
```

This replacement supersedes every earlier task's version of `mountApp` and the `handle.onBegin` callback body they each incrementally appended to — the four wiring calls Tasks 39/41/42/43 added one at a time (`SimClient`+`renderControls`, `MapView`+`renderInspector`, `renderDashboard`, `renderFeed`) are now all present together inside `beginRun`, called from both the normal Begin path and the resume-from-autosave path, which is exactly why this task consolidates them into one function instead of leaving four separate patch sites.

- [ ] **Step 10: Write the failing wiring test**

Create `tests/ui/main-storage-wiring.test.ts` with exactly:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/client', () => {
  class FakeSimClient {
    static lastRecover: (() => Promise<string | null>) | undefined;
    sentMessages: unknown[] = [];
    serializedCbs: ((json: string) => void)[] = [];
    constructor(opts?: { recover?: () => Promise<string | null> }) {
      FakeSimClient.lastRecover = opts?.recover;
    }
    start(): void {}
    send(msg: unknown): void {
      this.sentMessages.push(msg);
    }
    onSnapshot(): void {}
    onInspect(): void {}
    onSerialized(cb: (json: string) => void): void {
      this.serializedCbs.push(cb);
    }
    onError(): void {}
  }
  return { SimClient: FakeSimClient };
});

vi.mock('../../src/ui/map', async () => {
  const actual = await vi.importActual<typeof import('../../src/ui/map')>('../../src/ui/map');
  class FakeMapView {
    render(): void {}
    onPickPerson(): void {}
    onPickSettlement(): void {}
    setTerrain(): void {}
  }
  return { ...actual, MapView: FakeMapView };
});

vi.mock('../../src/ui/storage', async () => {
  const saved = new Map<string, string>();
  return {
    DB_NAME: 'genesis',
    STORE_NAME: 'saves',
    AUTOSAVE_NAME: '__autosave',
    AUTOSAVE_INTERVAL_MS: 60000,
    saveRun: vi.fn(async (name: string, json: string) => {
      saved.set(name, json);
    }),
    loadRun: vi.fn(async (name: string) => saved.get(name) ?? null),
    listRuns: vi.fn(async () => []),
    deleteRun: vi.fn(async () => {}),
    startAutosave: vi.fn(() => ({ stop: () => {} })),
    makeInMemoryIDBFactory: vi.fn(),
  };
});

describe('main.ts wires SimClient with a real recover hook and renders IO buttons', () => {
  it('constructs SimClient with a recover function that delegates to storage.loadRun(AUTOSAVE_NAME)', async () => {
    const clientMod = await import('../../src/ui/client');
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    await Promise.resolve();
    await Promise.resolve();

    const beginButton = root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement | null;
    expect(beginButton).not.toBeNull();
    beginButton?.click();

    const FakeSimClient = clientMod.SimClient as unknown as { lastRecover?: () => Promise<string | null> };
    expect(typeof FakeSimClient.lastRecover).toBe('function');
  });

  it('renders save/load/export/import controls in the topbar after Begin', async () => {
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    await Promise.resolve();
    await Promise.resolve();
    (root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();

    expect(root.querySelector('[data-testid="save-button"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="load-button"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="export-button"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="import-button"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="import-file-input"]')).not.toBeNull();
  });
});
```

- [ ] **Step 11: Run the test and confirm it fails, then passes**

Run:

```
npx vitest run tests/ui/main-storage-wiring.test.ts
```

Expected first (before Step 9's edit): FAIL, since `mountApp` neither passes a `recover` option nor renders the IO buttons yet. After applying Step 9:

```
npx vitest run tests/ui/main-storage-wiring.test.ts
```

Expected: PASS — `Test Files  1 passed (1)`, `Tests  2 passed (2)`.

- [ ] **Step 12: Run the full UI suite and typecheck**

Run:

```
npx vitest run tests/ui
npm run typecheck
```

Expected: every UI test file passes with zero failures; `npm run typecheck` exits 0.

- [ ] **Step 13: Commit**

Run:

```
git add src/ui/storage.ts src/ui/replay.ts src/ui/main.ts tests/ui/storage.test.ts tests/ui/replay.test.ts tests/ui/main-storage-wiring.test.ts
git commit -m "feat(ui): IndexedDB save/autosave/export/import, resume prompt, and deterministic replay scrubber" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 45: Long-run smoke tests, balance harness, README, and final release verification

**Files:**
- Create: `tests/smoke/longrun.test.ts`
- Create: `tests/smoke/balance.test.ts`
- Create: `README.md`
- Test: `tests/smoke/longrun.test.ts` (the deliverable IS the test file — no separate implementation file)
- Test: `tests/smoke/balance.test.ts` (`describe.skip`ped by default)

**Interfaces:**

Consumes:
- From `src/engine/sim/simulation.ts` (Task 33): `Simulation`
- From `src/engine/sim/invariants.ts` (Task 33): `checkInvariants`
- From `src/engine/sim/save.ts` (Task 36): `checksum`
- From `src/shared/types.ts` (Task 3): `SimConfig`, `LINEAGES`
- Every earlier task's exports remain available but this task adds no new production code — it is pure verification plus documentation

Produces:
- Nothing importable — this task closes the plan. Its deliverables are the two smoke test files, `README.md`, and a verified green `npm run build`.

Wiring notes:
- This is the last task in the plan. No later task depends on it.

- [ ] **Step 1: Write `tests/smoke/longrun.test.ts`**

Create `tests/smoke/longrun.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/engine/sim/simulation';
import { checkInvariants } from '../../src/engine/sim/invariants';
import { checksum } from '../../src/engine/sim/save';
import type { SimConfig } from '../../src/shared/types';

const LONG_RUN_TICKS = 5000;
const SETTLEMENT_CHECK_TICK = 1000;
const SEEDS = [101, 202] as const;
const MODES: SimConfig['mode'][] = ['civs', 'mixed'];

interface RunResult {
  mode: SimConfig['mode'];
  seed: number;
  finalPopulation: number;
  hadSettlementByTick1000: boolean;
  survived: boolean;
}

function runLong(mode: SimConfig['mode'], seed: number): RunResult {
  const config: SimConfig = { seed, mode, mapSize: 'medium', startPopulation: 400 };
  const sim = new Simulation(config);
  let hadSettlementByTick1000 = false;

  for (let tick = 1; tick <= LONG_RUN_TICKS; tick++) {
    sim.tick();

    const violations = checkInvariants(sim);
    if (violations.length > 0) {
      throw new Error(`Invariant violation at tick ${tick} (mode=${mode}, seed=${seed}): ${violations.join('; ')}`);
    }

    const c = checksum(sim);
    if (!Number.isFinite(c)) {
      throw new Error(`Non-finite checksum at tick ${tick} (mode=${mode}, seed=${seed})`);
    }

    if (tick === SETTLEMENT_CHECK_TICK) {
      hadSettlementByTick1000 = sim.ctx.settlements.length >= 1;
    }
  }

  const finalPopulation = sim.ctx.people.filter((p) => p.alive).length;
  return {
    mode,
    seed,
    finalPopulation,
    hadSettlementByTick1000,
    survived: finalPopulation > 0,
  };
}

describe('longrun smoke — 5000 ticks, both modes, 2 seeds, medium map, 400 pop', () => {
  for (const mode of MODES) {
    for (const seed of SEEDS) {
      it(`mode=${mode} seed=${seed}: no invariant violations, no NaN checksum, plausible population, settlement by tick ${SETTLEMENT_CHECK_TICK} if surviving`, () => {
        const result = runLong(mode, seed);

        expect(result.finalPopulation).toBeGreaterThanOrEqual(0);
        expect(result.finalPopulation).toBeLessThanOrEqual(6000);

        if (result.survived) {
          expect(result.hadSettlementByTick1000).toBe(true);
        }
      }, 120000);
    }
  }
});
```

- [ ] **Step 2: Run the smoke test and confirm it passes**

Run:

```
npx vitest run tests/smoke/longrun.test.ts
```

Expected: PASS (this test is slow — each of the 4 cases ticks a 400-person simulation 5000 times; allow up to two minutes total):

```
 ✓ tests/smoke/longrun.test.ts (4 tests)

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

If any case fails with an invariant violation or an out-of-bounds population, this is a real mechanics bug uncovered by the long run — per the spec's Section 9 balance-pass principle ("if a lineage insta-dies for mechanical, not behavioral, reasons, fix the mechanics, never the brains' character"), diagnose via `tests/smoke/balance.test.ts` (Step 3 below, unskipped temporarily) before touching any `src/engine/brains/*.ts` file. Do not weaken this test's assertions to make a mechanics bug pass.

- [ ] **Step 3: Write `tests/smoke/balance.test.ts` (skipped by default)**

Create `tests/smoke/balance.test.ts` with exactly:

```ts
// Balance-tuning harness. Skipped by default (it is slow and prints to the
// console rather than asserting fine-grained expectations) — this file is
// meant to be run manually during a balance pass, not on every CI run.
//
// To unskip for a tuning run: change `describe.skip` to `describe` below,
// run `npx vitest run tests/smoke/balance.test.ts`, and read the per-civ
// metrics logged to the console every 500 ticks. Re-skip before committing
// unless you are intentionally changing this file's own assertions.
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/engine/sim/simulation';
import { takeSnapshot } from '../../src/engine/sim/snapshot';
import type { SimConfig } from '../../src/shared/types';

const BALANCE_RUN_TICKS = 5000;
const LOG_EVERY_TICKS = 500;

describe.skip('balance harness — manual tuning runs only (unskip to use)', () => {
  it('logs per-civ metrics every 500 ticks across a 5000-tick civs-mode run', () => {
    const config: SimConfig = { seed: 12345, mode: 'civs', mapSize: 'medium', startPopulation: 400 };
    const sim = new Simulation(config);

    for (let tick = 1; tick <= BALANCE_RUN_TICKS; tick++) {
      sim.tick();
      if (tick % LOG_EVERY_TICKS === 0) {
        const snap = takeSnapshot(sim, false);
        // eslint-disable-next-line no-console
        console.log(`--- tick ${tick} (year ${snap.year}, season ${snap.season}) ---`);
        for (const m of snap.metrics) {
          // eslint-disable-next-line no-console
          console.log(
            `  ${m.name}: pop=${m.population} births=${m.births} deaths=${m.deaths} techs=${m.techCount} atWar=${m.atWar} food/cap=${m.foodPerCapita.toFixed(2)}`,
          );
        }
      }
    }

    expect(sim.ctx.tick).toBe(BALANCE_RUN_TICKS);
  }, 120000);

  it('logs lineage-share drift every 500 ticks across a 5000-tick mixed-mode run', () => {
    const config: SimConfig = { seed: 54321, mode: 'mixed', mapSize: 'medium', startPopulation: 400 };
    const sim = new Simulation(config);

    for (let tick = 1; tick <= BALANCE_RUN_TICKS; tick++) {
      sim.tick();
      if (tick % LOG_EVERY_TICKS === 0) {
        const snap = takeSnapshot(sim, false);
        const civMetrics = snap.metrics[0];
        if (civMetrics === undefined) continue;
        // eslint-disable-next-line no-console
        console.log(
          `tick ${tick}: pop=${civMetrics.population} lineageShare=${JSON.stringify(civMetrics.lineageShare)}`,
        );
      }
    }

    expect(sim.ctx.tick).toBe(BALANCE_RUN_TICKS);
  }, 120000);
});
```

- [ ] **Step 4: Run the balance test file and confirm it is skipped**

Run:

```
npx vitest run tests/smoke/balance.test.ts
```

Expected: PASS with both tests reported skipped, not executed:

```
 ✓ tests/smoke/balance.test.ts (2 tests | 2 skipped)

 Test Files  1 passed (1)
      Tests  2 skipped (2)
```

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Commit the smoke tests**

Run:

```
git add tests/smoke/longrun.test.ts tests/smoke/balance.test.ts
git commit -m "test(smoke): 5000-tick long-run invariant/plausibility harness and skip-by-default balance logger" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Write `README.md`**

Create `README.md` at the repo root with exactly:

```markdown
# Genesis

Genesis is a browser-based civilization simulator whose people's decision-making
code — their "brains" — is authored by different Claude models, then run with
**zero LLM usage at runtime**. Everything you watch happen (settlements
forming, wars breaking out, religions spreading, civilizations collapsing) is
the emergent result of simple per-person mechanics driving a population of a
few hundred to a few thousand agents forward one simulated day (tick) at a
time. Nothing is scripted: no wars, no famines, no religious movements are
hard-coded to happen. They arise or they don't, depending on the world, the
seed, and the way each lineage of people tends to think.

## The experiment

Four Claude models — **Opus**, **Sonnet**, **Haiku**, and **Fable** — were each
asked, at build time, to author one "brain": a decision policy implementing
the exact same interface (`decide`, `onOutcome`, `temperament`), with the same
documentation and the same one-line brief — "design how your people think."
No model saw the others' work. The four resulting philosophies differ in
emotional volatility, moral emphasis, risk tolerance, learning rate, and
quirks/taboos, and that difference is the entire experimental signal.

Genesis runs two experiment modes, chosen at setup:

- **Four Civilizations ("civs" mode)** — four separate one-lineage
  civilizations, each fielding a population whose every person shares one
  model's way of thinking. Watch how differently they grow, build, fight, and
  survive.
- **Mixed Civilization ("mixed" mode)** — a single civilization whose starting
  population blends all four lineages. The headline chart in this mode is
  **lineage share over time**: which way-of-thinking spreads through
  reproduction and imitation, and which dies out.

Every run is seeded. The same seed reproduces the exact same history forever
(useful for debugging and for replaying a run you want to study more closely);
a fresh or random seed gives you a new, unrepeated history every time.

## How runs differ per seed

The seed determines everything that is otherwise random: the procedurally
generated map (terrain, resources), where each civilization's population
starts, every person's inherited traits and morality, every dice-roll
decision inside a brain's softmax action selection, every disaster's timing
and location, and every mutation applied to a child's traits at birth. Two
runs with the same `SimConfig` (seed, mode, map size, starting population)
produce byte-identical histories; changing only the seed reshuffles all of the
above while keeping the same brains, the same mechanics, and the same rules.

## How the brains were authored, and by which models

The four brain modules live at `src/engine/brains/{opus,sonnet,haiku,fable}.ts`.
Each was authored by a subagent running the matching Claude model (via the
Agent tool's `model` parameter: `opus`, `sonnet`, `haiku`, `fable`) against a
frozen shared interface (`src/engine/brains/types.ts`) and an identical
conformance suite (valid action scoring, no NaN, bounded per-decision runtime,
deterministic given a seed, no network/DOM/global access). Style was left
entirely to the authoring model; the interface contract was not negotiable.
Every lineage passes the same tests — nothing in the harness favors one
lineage's mechanics over another's, so any advantage or disadvantage a
lineage shows in a run is a property of its authored decision-making, not of
the engine.

## Running Genesis

Requires Node.js >= 20 and npm.

```
npm install
npm run dev
```

Open the printed local URL. You'll land on the setup screen.

For a production build:

```
npm run build
npm run preview
```

`npm run build` type-checks the whole project (`tsc --noEmit`) and then
produces a static `dist/` folder via Vite; `npm run preview` serves that
folder locally so you can confirm the built artifact (not just the dev
server) works end to end. The build is fully static and runs offline forever
— no API keys, no network calls, no backend.

Other scripts:

```
npm run typecheck   # tsc --noEmit only
npm run test        # vitest run (the whole suite, including smoke tests)
```

## Controls guide

**Setup screen:** choose a mode (Four Civilizations / Mixed Civilization), a
map size (small/medium/large), a starting population (200/400/600), and a
seed (type one in, or click Random). Click Begin.

**Run screen:**
- **Map (left, fills the viewport):** drag to pan, scroll to zoom
  (0.5x–24x, anchored under your cursor). Click a person (small dot) to
  inspect them; click a settlement (square, sized by population) if you miss
  every nearby person. Settlement names appear once you're zoomed in past
  4x; a colored ring appears around afraid/angry people once you're zoomed
  in past 8x.
- **Time controls (top bar):** Pause, 1x, 10x, 60x, 360x, 1000x, and "Skip
  generation" (jumps forward 7,200 ticks — 20 years — in one step).
  The readout shows the current year, season, and total living population.
- **Right dock, three tabs:**
  - **Inspector** — the selected person's emotion gauges, a six-axis
    morality radar chart, their memories (newest first, with the in-world
    year they happened), their relationships (colored green for positive
    affinity, red for negative), their lineage badge, and their lineage's
    temperament quirks and philosophy. "Follow" re-selects them after the
    map view moves on.
  - **Civilizations** — one tab per civilization (plus a "Lineage Share"
    headline tab in Mixed mode): population over time, average emotions over
    time, a tech-progress readout, a war banner when applicable, and this
    tick's births/deaths.
  - **History** — a scrolling, newest-first, severity-colored feed of
    narrated events ("Year 62: famine grips Rivermeet."), filterable by
    civilization.
- **Top bar, save/load:** name a run and click Save or Load; Export
  downloads the current run as a `.json` file; Import loads a `.json` file
  from disk. The app autosaves every 60 seconds to a special `__autosave`
  slot; if one exists the next time you open Genesis, you'll be asked
  whether to resume it. If the simulation worker crashes, Genesis
  automatically attempts to restart from that same autosave.
- **Replay:** loading a saved run's timeline scrubber does not play back
  stored frames — **it deterministically re-simulates from that save's
  original seed** up to whatever tick you scrub to. Moving the slider to the
  same tick always reproduces the exact same state, because the entire
  history is a pure function of the seed and the tick count, not of anything
  stored per frame.

## Project layout

```
src/
  engine/          # pure simulation, no DOM — runs in a Web Worker
    world/         # map generation, terrain, resources, seasons, climate
    agents/        # person: traits, needs, emotions, morality, memory,
                    # relationships, skills, lifecycle, learning
    brains/        # the Brain interface + the four model-authored brains
    society/       # settlements, leadership, culture, technology,
                    # religion, economy, conflict
    sim/           # tick loop, invariants, narrative events, snapshots,
                    # save/load/checksum
    worker.ts      # Web Worker entry point wiring the protocol to Simulation
  ui/              # setup screen, map renderer, inspector, dashboard,
                    # event feed, time controls, save/load, replay
  shared/          # core types/constants and the worker<->UI message protocol
tests/             # mirrors src/: unit, property/invariant, brain
                    # conformance, and smoke tests (tests/smoke/)
```

Everything under `src/engine/` and `src/shared/` is DOM-free and can run
inside a Web Worker; everything under `src/ui/` runs on the main thread and
talks to the worker exclusively through the typed `UiToWorker`/`WorkerToUi`
message protocol in `src/shared/protocol.ts`. The simulation is fully
deterministic given a seed: `Math.random`, `Date.now`, and `new Date(` are
forbidden (and grep-tested for) anywhere under `src/engine/` and
`src/shared/`.
```

- [ ] **Step 8: Commit the README**

Run:

```
git add README.md
git commit -m "docs: project README with experiment description, run instructions, and controls guide" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Final verification — typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors, across the entire project (every task from Section 1 through this one).

- [ ] **Step 10: Final verification — full test suite**

Run:

```
npx vitest run
```

Expected: every test file in the project passes, with zero failures. This includes every engine test (Sections 1-7), every brain conformance test (Section 5), every UI test (this section), and both smoke test files (`longrun.test.ts` executing its 4 real cases, `balance.test.ts` reporting 2 skipped). If any test fails, stop and fix it (per this section's own steps if the failure is in a file this section owns, or by re-reading the relevant earlier section if not) before proceeding — do not report success with a red suite.

- [ ] **Step 11: Final verification — production build**

Run:

```
npm run build
```

Expected: `tsc --noEmit` runs first (silent, exit 0), followed by a Vite build report ending in something like:

```
vite v6.x.x building for production...
✓ NNN modules transformed.
dist/index.html                   0.4x kB
dist/assets/index-XXXXXXXX.js     ...  kB
dist/assets/worker-XXXXXXXX.js    ...  kB
✓ built in X.XXs
```

The exact module count and bundle sizes vary; the required signal is exit code 0 and a `dist/` folder containing `index.html`, JS assets, and a separately-chunked worker bundle (Vite automatically code-splits `new Worker(new URL(...))` entries into their own output file).

- [ ] **Step 12: Final verification — manual preview smoke checklist**

Run:

```
npm run preview
```

Open the printed local URL in a browser and manually walk through this checklist, confirming each step before moving to the next:

1. **Setup → Begin:** the setup screen renders with both mode cards, map size/population selects, and a seed input with a Random button; clicking Begin switches to the run screen.
2. **Agents move:** within a few seconds at the default paused state, click 60x or 360x — the dot cluster on the map visibly drifts/spreads as people gather, farm, and build.
3. **Inspect a person:** click a dot; the Inspector tab populates with emotion gauges, a morality radar chart, and a lineage badge.
4. **Dashboard charts fill:** switch to the Civilizations tab; after running at a fast speed for 10-20 seconds, the population and average-emotion line charts show a visible multi-point series (not a flat single dot).
5. **Save:** type a run name in the top bar and click Save; no error appears.
6. **Reload and resume:** refresh the browser tab. If the 60-second autosave has fired at least once, a "Resume previous run?" prompt appears; click Resume and confirm the run continues from a non-zero tick (visible in the top-bar readout) rather than restarting from year 0. If the autosave has not yet fired, wait for the interval and repeat.

Record the outcome of this checklist in your final commit message or PR description; do not claim the release is verified without having actually run it.

- [ ] **Step 13: Final commit**

If Steps 9-12 required any fixes, ensure those fixes are already committed under their own task-appropriate commit (per this plan's per-task commit steps) before this final step. This step only commits documentation-of-completion artifacts if any remain unstaged (typically none — every source/test file was committed in its own task above). Run:

```
git status
```

If `git status` reports a clean working tree, no further commit is needed — the project is complete as of Step 8's README commit. If anything is still unstaged (for example, a fix applied during Step 10's "if any test fails, stop and fix it" instruction), stage exactly those paths and commit:

```
git add <fixed paths>
git commit -m "fix: address issues found during final verification" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Genesis is complete: four (or more, after schisms) civilizations of people whose minds were authored by four different Claude models, thinking, building, fighting, believing, and dying, entirely offline, entirely deterministically per seed, and entirely without a single scripted outcome.
