## Section 1: Foundations (Tasks 1-4)

This section stands up the toolchain and the three dependency-free modules everything else imports: the Vite + TypeScript-strict + Vitest scaffold, the seeded splittable RNG that makes every run reproducible, the frozen shared type vocabulary, and the seeded syllable name generator. After Task 4 the repo has a green `npm run typecheck`, a green 42-test vitest suite, and the exact export surface Sections 2+ build on. Prerequisites for all tasks: Node.js >= 20 and npm on PATH; every command runs from the repo root `C:\simulation_exp` and works in PowerShell and cmd.

### Task 1: Project scaffold (Vite + TypeScript strict + Vitest)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `.gitignore`
- Create: `src/ui/main.ts`
- Test: none — this task is verified by the commands in Steps 8-10 (the first test file arrives in Task 2)

**Interfaces:**
- Consumes: nothing — first task. Git state note: `C:\simulation_exp` is ALREADY an initialized git repository (branch `master`, prior commits contain `docs/`). Do NOT run `git init`. The untracked `docs/superpowers/plans/` directory belongs to the plan orchestrator — leave it unstaged; stage only the paths listed in Step 10.
- Produces (conventions every later task relies on):
  - npm scripts: `npm run dev` = `vite`; `npm run build` = `tsc --noEmit && vite build`; `npm run preview` = `vite preview`; `npm run test` = `vitest run`; `npm run typecheck` = `tsc --noEmit`
  - vitest (configured inline in `vite.config.ts`) discovers only `tests/**/*.test.ts` and defaults to the `node` environment; UI tests opt into jsdom per-file with a `// @vitest-environment jsdom` first line
  - `index.html` loads `/src/ui/main.ts` as the module entry
  - `src/ui/main.ts` is a side-effect-free placeholder module (`export {};`) — Task 38 replaces it with the real app shell
  - TypeScript: `strict: true`, target ES2022, `moduleResolution: "bundler"`, libs `ES2022 + DOM + DOM.Iterable + WebWorker`
  - devDependencies are exactly `vite`, `typescript`, `vitest`, `jsdom`; there is no `dependencies` field, ever (contract: zero runtime dependencies)

- [ ] **Step 1: Write `package.json`**

Create `package.json` at the repo root with exactly this content:

```json
{
  "name": "genesis",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "jsdom": "^26.1.0",
    "typescript": "^5.8.3",
    "vite": "^6.3.5",
    "vitest": "^3.1.4"
  }
}
```

The caret ranges may resolve to newer patch/minor versions at install time; that is fine — all four majors (vite 6, typescript 5, vitest 3, jsdom 26) are mutually compatible.

- [ ] **Step 2: Write `tsconfig.json`**

Create `tsconfig.json` at the repo root:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

Why `skipLibCheck: true`: the `DOM` and `WebWorker` lib declaration files overlap (both declare globals like `onmessage`), and skipLibCheck suppresses those lib-internal duplicate declarations. Our own code under `src/` and `tests/` remains fully strictly checked. The `tests` entry in `include` matches nothing until Task 2 — tsc only errors when the whole include set is empty, and `src/ui/main.ts` (Step 6) already matches.

- [ ] **Step 3: Write `vite.config.ts`**

Create `vite.config.ts` at the repo root (importing `defineConfig` from `vitest/config` gives the typed inline `test` block):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write `index.html`**

Create `index.html` at the repo root:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Genesis</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/ui/main.ts"></script>
  </body>
</html>
```

Task 38 owns the app shell that mounts into `#app`; this file stays this minimal until then.

- [ ] **Step 5: Write `.gitignore`**

Create `.gitignore` at the repo root:

```
node_modules
dist
```

- [ ] **Step 6: Write the placeholder `src/ui/main.ts`**

Create `src/ui/main.ts` (its parent directories are created automatically by writing the file):

```ts
// Genesis — UI entry point.
// Placeholder bootstrap: intentionally empty until Task 38 builds the real
// app shell (setup screen + run screen). Must stay console-free.
export {};
```

- [ ] **Step 7: Create the module folder tree**

Create the directory skeleton from the contract's layout so later tasks drop files into a visible structure. In PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path src/engine/world, src/engine/agents, src/engine/brains, src/engine/society, src/engine/sim, src/shared, tests/engine/world, tests/engine/agents, tests/engine/brains, tests/engine/society, tests/engine/sim, tests/shared, tests/ui, tests/helpers, tests/smoke | Out-Null
```

Expected: no output, exit code 0. Note: git does not track empty directories, so this tree exists only in the working copy; each directory enters version control as later tasks commit files into it. (If you create files with a tool that auto-creates parent directories, this step is belt-and-braces — run it anyway so the layout is inspectable now.)

- [ ] **Step 8: Install dependencies**

```
npm install
```

Expected: exit code 0; `node_modules/` and `package-lock.json` are created; npm prints a line like `added 123 packages in 12s` (the exact count varies with registry state). Deprecation warnings from transitive packages are harmless. There must be no `ERESOLVE` or peer-dependency errors.

- [ ] **Step 9: Verify typecheck passes**

```
npm run typecheck
```

Expected output (no errors, exit code 0):

```
> genesis@0.1.0 typecheck
> tsc --noEmit
```

- [ ] **Step 10: Verify vitest runs clean with no tests, then commit**

```
npx vitest run --passWithNoTests
```

Expected: exit code 0 and a message that no test files were found, e.g. `No test files found, exiting with code 0` (the `tests/**/*.test.ts` include pattern matches nothing yet).

Then commit exactly these files (note `package-lock.json` is included; `docs/` stays untouched):

```
git add package.json package-lock.json tsconfig.json vite.config.ts index.html .gitignore src/ui/main.ts
git commit -m "feat(scaffold): vite + typescript strict + vitest project setup" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Expected: `[master <hash>] feat(scaffold): vite + typescript strict + vitest project setup` reporting 7 files changed.

### Task 2: Seeded splittable RNG — `src/engine/rng.ts`

**Files:**
- Create: `src/engine/rng.ts`
- Test: `tests/engine/rng.test.ts`

**Interfaces:**
- Consumes: only Task 1 conventions (`npx vitest run tests/<path>`, `npm run typecheck`). No code imports.
- Produces (contract-exact, from `src/engine/rng.ts`):
  - `export interface Rng { next(): number; int(maxExclusive: number): number; range(min: number, max: number): number; pick<T>(arr: readonly T[]): T; chance(p: number): boolean; gaussian(mean: number, sd: number): number; split(label: string): Rng }`
  - `export function createRng(seed: number): Rng`
  - Behavioral guarantees later tasks may rely on: `next()` is uniform in `[0, 1)`; `int(maxExclusive)` returns an integer in `[0, maxExclusive)` and returns `0` when `maxExclusive <= 0`; `range(min, max)` is uniform in `[min, max)`; `pick` throws an `Error` on an empty array; `chance(p)` is `false` for `p <= 0` and `true` for `p >= 1`; `gaussian` uses Box-Muller and consumes exactly two uniform draws per call; seeds are wrapped to uint32 via `>>> 0` (negative and fractional seeds are legal and deterministic).
  - `split(label)` semantics (contract: "same seed + same labels = same streams"): the child seed is a pure function of the parent's CREATION seed and the label — `fnv1a("<creationSeed>:<label>")`. Therefore the same label always yields the identical stream, draws taken from the parent never affect child streams, and code that wants a fresh stream per use must vary the label (e.g. include a tick number in it).

- [ ] **Step 1: Write the failing test `tests/engine/rng.test.ts`**

Create `tests/engine/rng.test.ts` with exactly this content:

```ts
import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/engine/rng';
import type { Rng } from '../../src/engine/rng';

function draws(rng: Rng, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.next());
  return out;
}

function mean(xs: number[]): number {
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function stdDev(xs: number[]): number {
  const m = mean(xs);
  let sum = 0;
  for (const x of xs) sum += (x - m) * (x - m);
  return Math.sqrt(sum / xs.length);
}

describe('determinism', () => {
  it('same seed produces an identical 1000-draw sequence', () => {
    expect(draws(createRng(123), 1000)).toEqual(draws(createRng(123), 1000));
  });

  it('different seeds produce different sequences', () => {
    expect(draws(createRng(1), 50)).not.toEqual(draws(createRng(2), 50));
  });

  it('seed 0, negative, and fractional seeds are deterministic', () => {
    expect(draws(createRng(0), 10)).toEqual(draws(createRng(0), 10));
    expect(draws(createRng(-42), 10)).toEqual(draws(createRng(-42), 10));
    expect(draws(createRng(7.9), 10)).toEqual(draws(createRng(7.9), 10));
  });
});

describe('split', () => {
  it('different labels give independent streams', () => {
    const rng = createRng(777);
    expect(draws(rng.split('alpha'), 100)).not.toEqual(draws(rng.split('beta'), 100));
  });

  it('same seed + same label = same stream, across instances', () => {
    expect(draws(createRng(9).split('world'), 100)).toEqual(draws(createRng(9).split('world'), 100));
  });

  it('child streams are unaffected by draws taken from the parent', () => {
    const drained = createRng(7);
    const fresh = createRng(7);
    draws(drained, 250);
    expect(draws(drained.split('agents'), 100)).toEqual(draws(fresh.split('agents'), 100));
  });

  it('nested splits are deterministic and order-sensitive', () => {
    expect(draws(createRng(3).split('a').split('b'), 50)).toEqual(draws(createRng(3).split('a').split('b'), 50));
    expect(draws(createRng(3).split('a').split('b'), 50)).not.toEqual(draws(createRng(3).split('b').split('a'), 50));
  });

  it('split streams differ from the parent stream', () => {
    expect(draws(createRng(555).split('x'), 100)).not.toEqual(draws(createRng(555), 100));
  });
});

describe('distribution sanity', () => {
  it('next() stays in [0, 1)', () => {
    const xs = draws(createRng(2024), 10000);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });

  it('mean of 10000 draws is near 0.5', () => {
    const m = mean(draws(createRng(2025), 10000));
    expect(m).toBeGreaterThan(0.45);
    expect(m).toBeLessThan(0.55);
  });

  it('all ten deciles are roughly evenly filled', () => {
    const counts = new Array<number>(10).fill(0);
    const rng = createRng(2026);
    for (let i = 0; i < 10000; i++) counts[Math.floor(rng.next() * 10)]++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(700);
      expect(c).toBeLessThan(1300);
    }
  });
});

describe('gaussian', () => {
  it('gaussian(0, 1): sample mean ~0 and sd ~1', () => {
    const rng = createRng(31337);
    const xs: number[] = [];
    for (let i = 0; i < 10000; i++) xs.push(rng.gaussian(0, 1));
    expect(Math.abs(mean(xs))).toBeLessThan(0.05);
    expect(stdDev(xs)).toBeGreaterThan(0.95);
    expect(stdDev(xs)).toBeLessThan(1.05);
  });

  it('gaussian(10, 3): sample mean ~10 and sd ~3', () => {
    const rng = createRng(90210);
    const xs: number[] = [];
    for (let i = 0; i < 10000; i++) xs.push(rng.gaussian(10, 3));
    expect(mean(xs)).toBeGreaterThan(9.85);
    expect(mean(xs)).toBeLessThan(10.15);
    expect(stdDev(xs)).toBeGreaterThan(2.85);
    expect(stdDev(xs)).toBeLessThan(3.15);
  });

  it('gaussian output is always finite', () => {
    const rng = createRng(1);
    for (let i = 0; i < 10000; i++) expect(Number.isFinite(rng.gaussian(5, 2))).toBe(true);
  });
});

describe('bounds of int / range / pick / chance', () => {
  it('int(n) returns integers in [0, n)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
    expect(createRng(5).int(1)).toBe(0);
  });

  it('int of zero or negative bounds returns 0', () => {
    const rng = createRng(42);
    expect(rng.int(0)).toBe(0);
    expect(rng.int(-3)).toBe(0);
  });

  it('range(min, max) stays within [min, max)', () => {
    const rng = createRng(77);
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(-3, 7);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(7);
    }
  });

  it('pick returns only elements of the array and covers all of them', () => {
    const rng = createRng(99);
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const v = rng.pick(items);
      expect(items).toContain(v);
      seen.add(v);
    }
    expect(seen.size).toBe(3);
  });

  it('pick throws on an empty array', () => {
    expect(() => createRng(1).pick([])).toThrow();
  });

  it('chance(0) is never true, chance(1) is always true, chance(0.5) is balanced', () => {
    const rng = createRng(64);
    for (let i = 0; i < 200; i++) expect(rng.chance(0)).toBe(false);
    for (let i = 0; i < 200; i++) expect(rng.chance(1)).toBe(true);
    let hits = 0;
    for (let i = 0; i < 1000; i++) if (rng.chance(0.5)) hits++;
    expect(hits).toBeGreaterThan(400);
    expect(hits).toBeLessThan(600);
  });
});
```

All bounds are safe by wide margins for the mulberry32 implementation in Step 3 (verified numerically: seed-2025 mean = 0.4918; decile counts 934..1052; gaussian(0,1) mean 0.0151, sd 0.9888; gaussian(10,3) mean 9.9751, sd 2.9876; chance(0.5) hits = 491). Because seeds are fixed, every assertion is fully deterministic.

- [ ] **Step 2: Run the test — expect FAIL (module missing)**

```
npx vitest run tests/engine/rng.test.ts
```

Expected: FAIL with a module-resolution error, ending in a failed summary:

```
Error: Failed to resolve import "../../src/engine/rng" from "tests/engine/rng.test.ts". Does the file exist?
```

followed by a stack trace and the summary line `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the implementation `src/engine/rng.ts`**

Create `src/engine/rng.ts` with exactly this content:

```ts
// Seeded, splittable random number generator.
// mulberry32 core; split() derives independent child streams by FNV-1a
// hashing the creation seed together with a string label.
//
// Contract (docs/superpowers/plans/2026-07-04-genesis-contract.md):
// all engine randomness flows through this module; same seed + same
// labels = same streams. Math.random is forbidden in src/engine and
// src/shared.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). Returns 0 if maxExclusive <= 0. */
  int(maxExclusive: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform element of arr. Throws if arr is empty. */
  pick<T>(arr: readonly T[]): T;
  /** True with probability p (p <= 0: never; p >= 1: always). */
  chance(p: number): boolean;
  /** Normal sample via Box-Muller; consumes exactly two uniform draws. */
  gaussian(mean: number, sd: number): number;
  /**
   * Independent deterministic stream derived from (creation seed, label).
   * Pure in the creation seed: the same label always returns the identical
   * stream, and draws taken from this rng never affect child streams.
   * Vary the label (e.g. include a tick number) when a fresh stream is
   * needed per use.
   */
  split(label: string): Rng;
}

/** FNV-1a 32-bit hash over UTF-16 code units (labels are ASCII in practice). */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  const baseSeed = seed >>> 0; // wrap to uint32; fractional part discarded
  let state = baseSeed;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return Math.floor(next() * maxExclusive);
  }

  function range(min: number, max: number): number {
    return min + next() * (max - min);
  }

  function pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick called with an empty array');
    return arr[int(arr.length)];
  }

  function chance(p: number): boolean {
    return next() < p;
  }

  function gaussian(mean: number, sd: number): number {
    const u1 = 1 - next(); // in (0, 1] so Math.log never sees 0
    const u2 = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function split(label: string): Rng {
    return createRng(fnv1a(`${baseSeed}:${label}`));
  }

  return { next, int, range, pick, chance, gaussian, split };
}
```

- [ ] **Step 4: Run the test — expect PASS**

```
npx vitest run tests/engine/rng.test.ts
```

Expected:

```
 ✓ tests/engine/rng.test.ts (20 tests)

 Test Files  1 passed (1)
      Tests  20 passed (20)
```

- [ ] **Step 5: Typecheck**

```
npm run typecheck
```

Expected: no output after the script banner, exit code 0.

- [ ] **Step 6: Commit**

```
git add src/engine/rng.ts tests/engine/rng.test.ts
git commit -m "feat(engine): seeded splittable rng (mulberry32 + fnv-1a split)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Expected: `[master <hash>]` reporting 2 files changed.

### Task 3: Core shared types — `src/shared/types.ts`

**Files:**
- Create: `src/shared/types.ts`
- Test: `tests/shared/types.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this module is dependency-free by design); Task 1 test tooling only.
- Produces (contract-exact — this file IS the contract's Core Types block, reproduced verbatim with the three helpers implemented):
  - constants: `YEAR_TICKS = 360`, `SEASON_TICKS = 90`, `MAP_SIZES = { small: 96, medium: 144, large: 192 }`, `PERCEPTION_RADIUS = 4`, `MEMORY_CAP = 48`, `RELATIONSHIP_CAP = 24`, `ADULT_AGE_TICKS = 5760`, `GESTATION_TICKS = 270`, `SOFTMAX_TEMP = 0.35`, `ACTION_WEIGHT_MIN = 0.2`, `ACTION_WEIGHT_MAX = 3.0`, `LINEAGES`, `SKILL_NAMES`, `ACTION_KINDS`, `TECH_IDS`, `TECH_THRESHOLDS`
  - types: `Season`, `Tick`, `MapSize`, `Vec2`, `Terrain`, `Tile`, `Lineage`, `Traits`, `Emotions`, `Morality`, `Needs`, `SkillName`, `Skills`, `ActionKind`, `StructureKind`, `Action`, `ScoredAction`, `MemoryKind`, `MemoryEventRec`, `RelationKind`, `Relationship`, `Inventory`, `TechId`, `Person`, `Civ`, `Settlement`, `Religion`, `SimConfig`
  - implemented functions: `clamp(v: number, lo: number, hi: number): number` (NaN input propagates as NaN — the dev-build invariant checks of Task 33 are the NaN tripwire), `clamp01(v: number): number`, `dist(a: Vec2, b: Vec2): number` (euclidean)

- [ ] **Step 1: Write the failing test `tests/shared/types.test.ts`**

Create `tests/shared/types.test.ts` with exactly this content:

```ts
import { describe, it, expect } from 'vitest';
import {
  YEAR_TICKS, SEASON_TICKS, MAP_SIZES, PERCEPTION_RADIUS, MEMORY_CAP, RELATIONSHIP_CAP,
  ADULT_AGE_TICKS, GESTATION_TICKS, SOFTMAX_TEMP, ACTION_WEIGHT_MIN, ACTION_WEIGHT_MAX,
  LINEAGES, SKILL_NAMES, ACTION_KINDS, TECH_IDS, TECH_THRESHOLDS,
  clamp, clamp01, dist,
} from '../../src/shared/types';
import type {
  ActionKind, Civ, MemoryEventRec, Person, Relationship, Religion, ScoredAction,
  Settlement, SimConfig, Skills, Tile, Vec2,
} from '../../src/shared/types';

describe('clamp', () => {
  it('returns the value when inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('clamps values below the range to lo', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(-1000, -5, 5)).toBe(-5);
  });

  it('clamps values above the range to hi', () => {
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(0.75, 0.2, 0.5)).toBe(0.5);
  });
});

describe('clamp01', () => {
  it('clamps into [0, 1]', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.7)).toBe(1);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
  });
});

describe('dist', () => {
  it('computes euclidean distance (3-4-5 triangle)', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 10);
  });

  it('is zero for identical points', () => {
    expect(dist({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });

  it('handles negative coordinates and is symmetric', () => {
    const a: Vec2 = { x: -1, y: -1 };
    const b: Vec2 = { x: 2, y: 3 };
    expect(dist(a, b)).toBeCloseTo(5, 10);
    expect(dist(b, a)).toBeCloseTo(dist(a, b), 10);
  });
});

describe('contract constants', () => {
  it('time and tuning constants match the contract', () => {
    expect(YEAR_TICKS).toBe(360);
    expect(SEASON_TICKS).toBe(90);
    expect(PERCEPTION_RADIUS).toBe(4);
    expect(MEMORY_CAP).toBe(48);
    expect(RELATIONSHIP_CAP).toBe(24);
    expect(ADULT_AGE_TICKS).toBe(16 * 360);
    expect(GESTATION_TICKS).toBe(270);
    expect(SOFTMAX_TEMP).toBe(0.35);
    expect(ACTION_WEIGHT_MIN).toBe(0.2);
    expect(ACTION_WEIGHT_MAX).toBe(3.0);
  });

  it('map sizes and catalogs match the contract', () => {
    expect(MAP_SIZES).toEqual({ small: 96, medium: 144, large: 192 });
    expect(LINEAGES).toEqual(['opus', 'sonnet', 'haiku', 'fable']);
    expect(SKILL_NAMES).toEqual(['farming', 'gathering', 'building', 'crafting', 'fighting', 'healing', 'teaching']);
    expect(ACTION_KINDS).toEqual(['gather', 'farm', 'hunt', 'build', 'craft', 'rest', 'socialize', 'court', 'teach', 'trade', 'share', 'steal', 'attack', 'flee', 'migrate', 'worship', 'explore', 'heal']);
    expect(TECH_IDS).toEqual(['fire', 'agriculture', 'construction', 'metallurgy', 'writing', 'medicine']);
  });

  it('tech thresholds match the contract', () => {
    expect(TECH_THRESHOLDS).toEqual({ fire: 50, agriculture: 200, construction: 400, metallurgy: 800, writing: 1200, medicine: 1600 });
  });
});

describe('compile-usage of core interfaces', () => {
  const allOneWeights: Record<ActionKind, number> = {
    gather: 1, farm: 1, hunt: 1, build: 1, craft: 1, rest: 1, socialize: 1, court: 1, teach: 1,
    trade: 1, share: 1, steal: 1, attack: 1, flee: 1, migrate: 1, worship: 1, explore: 1, heal: 1,
  };
  const skills: Skills = { farming: 0.2, gathering: 0.5, building: 0.1, crafting: 0, fighting: 0.3, healing: 0, teaching: 0.05 };

  it('a fully-populated Person literal type-checks and holds its values', () => {
    const memoryRec: MemoryEventRec = { tick: 100, kind: 'helped', otherId: 2, valence: 0.5, salience: 0.8 };
    const friendship: Relationship = { otherId: 2, kind: 'friend', affinity: 0.6 };
    const person: Person = {
      id: 1, alive: true, ageTicks: 20 * YEAR_TICKS, sex: 'f', name: 'Mira',
      pos: { x: 10, y: 12 }, civId: 0, settlementId: null, lineage: 'fable',
      traits: { curiosity: 0.7, aggression: 0.2, empathy: 0.8, industriousness: 0.6, riskTolerance: 0.4 },
      emotions: { fear: 0.1, joy: 0.5, grief: 0, anger: 0.05, hope: 0.6 },
      morality: { care: 0.8, fairness: 0.7, loyalty: 0.5, authority: 0.3, sanctity: 0.2, liberty: 0.6 },
      needs: { hunger: 0.3, safety: 0.1, rest: 0.2, belonging: 0.4, esteem: 0.5 },
      skills,
      health: 0.95,
      lifespanTicks: 70 * YEAR_TICKS,
      memory: [memoryRec],
      relationships: [friendship],
      inventory: { food: 3, wood: 0, stone: 0, metal: 0, tools: 1 },
      actionWeights: allOneWeights,
      brainState: {},
      influence: 0.1,
      beliefIds: [],
      partnerId: null,
      pregnantUntil: null,
      parentIds: null,
      causeOfDeath: null,
    };
    expect(person.alive).toBe(true);
    expect(person.lineage).toBe('fable');
    expect(person.memory[0].valence).toBeCloseTo(0.5, 10);
    expect(person.relationships[0].kind).toBe('friend');
  });

  it('actionWeights keys are exactly ACTION_KINDS', () => {
    expect(Object.keys(allOneWeights).sort()).toEqual([...ACTION_KINDS].sort());
  });

  it('Civ, Settlement, and Religion literals type-check and hold their values', () => {
    const civ: Civ = {
      id: 0, name: 'Fablemark', color: '#b76ce9',
      knowledge: { fire: 10, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
      techs: ['fire'], atWarWith: [], warWeariness: 0,
    };
    const settlement: Settlement = {
      id: 0, civId: 0, name: 'Kavale', center: { x: 10, y: 12 }, memberIds: [1],
      stock: { food: 20, wood: 5, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 2, granary: 0, wall: 0, shrine: 1 },
    };
    const religion: Religion = { id: 0, name: 'Soleon', founderId: 1, civId: 0, moralityBias: { sanctity: 0.2, loyalty: 0.1 }, zeal: 0.5 };
    expect(civ.techs).toContain('fire');
    expect(settlement.structures.shrine).toBe(1);
    expect(religion.moralityBias.sanctity).toBeCloseTo(0.2, 10);
  });

  it('SimConfig, Tile, and ScoredAction literals type-check and hold their values', () => {
    const config: SimConfig = { seed: 42, mode: 'mixed', mapSize: 'small', startPopulation: 200 };
    const tile: Tile = { terrain: 'plains', fertility: 0.8, food: 4, wood: 0, stone: 1, metal: 0 };
    const restAct: ScoredAction = { action: { kind: 'rest' }, score: 1 };
    const buildAct: ScoredAction = { action: { kind: 'build', tile: { x: 1, y: 2 }, structure: 'granary' }, score: 0.4 };
    const attackAct: ScoredAction = { action: { kind: 'attack', targetPersonId: 9 }, score: 0.2 };
    expect(MAP_SIZES[config.mapSize]).toBe(96);
    expect(tile.terrain).toBe('plains');
    expect(restAct.score).toBe(1);
    expect(buildAct.action.structure).toBe('granary');
    expect(attackAct.action.targetPersonId).toBe(9);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (module missing)**

```
npx vitest run tests/shared/types.test.ts
```

Expected: FAIL with `Error: Failed to resolve import "../../src/shared/types" from "tests/shared/types.test.ts". Does the file exist?` and `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the implementation `src/shared/types.ts`**

Create `src/shared/types.ts`. This is the contract's Core Types block VERBATIM — do not rename, reorder, drop, or reformat any exported symbol — with the three trailing function declarations turned into implementations and a file-header comment added:

```ts
// Core shared types & constants for Genesis.
// This file is the frozen contract's Core Types block, reproduced verbatim
// (docs/superpowers/plans/2026-07-04-genesis-contract.md), plus implemented
// clamp / clamp01 / dist. Every other module builds on these names; nothing
// here may be changed without changing the contract itself. DOM-free and
// dependency-free: safe to import from the engine, the worker, tests, and
// the UI alike.

export const YEAR_TICKS = 360;           // 1 tick = 1 day
export const SEASON_TICKS = 90;
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Tick = number;

export const MAP_SIZES = { small: 96, medium: 144, large: 192 } as const;
export type MapSize = keyof typeof MAP_SIZES;

export const PERCEPTION_RADIUS = 4;
export const MEMORY_CAP = 48;
export const RELATIONSHIP_CAP = 24;
export const ADULT_AGE_TICKS = 16 * YEAR_TICKS;
export const GESTATION_TICKS = 270;
export const SOFTMAX_TEMP = 0.35;
export const ACTION_WEIGHT_MIN = 0.2;
export const ACTION_WEIGHT_MAX = 3.0;

export interface Vec2 { x: number; y: number }

export type Terrain = 'water' | 'plains' | 'forest' | 'mountain' | 'desert';

export interface Tile {
  terrain: Terrain;
  fertility: number;  // 0..1 regrowth quality
  food: number;       // >= 0 forageable units
  wood: number;       // >= 0
  stone: number;      // >= 0
  metal: number;      // >= 0
}

export type Lineage = 'opus' | 'sonnet' | 'haiku' | 'fable';
export const LINEAGES: readonly Lineage[] = ['opus', 'sonnet', 'haiku', 'fable'];
// int encoding for snapshots: opus=0 sonnet=1 haiku=2 fable=3 (index in LINEAGES)

export interface Traits { curiosity: number; aggression: number; empathy: number; industriousness: number; riskTolerance: number }        // all 0..1
export interface Emotions { fear: number; joy: number; grief: number; anger: number; hope: number }                                       // all 0..1
export interface Morality { care: number; fairness: number; loyalty: number; authority: number; sanctity: number; liberty: number }       // all 0..1
export interface Needs { hunger: number; safety: number; rest: number; belonging: number; esteem: number }                                 // all 0..1, 1 = desperate

export const SKILL_NAMES = ['farming', 'gathering', 'building', 'crafting', 'fighting', 'healing', 'teaching'] as const;
export type SkillName = typeof SKILL_NAMES[number];
export type Skills = Record<SkillName, number>;   // 0..1

export const ACTION_KINDS = ['gather', 'farm', 'hunt', 'build', 'craft', 'rest', 'socialize', 'court', 'teach', 'trade', 'share', 'steal', 'attack', 'flee', 'migrate', 'worship', 'explore', 'heal'] as const;
export type ActionKind = typeof ACTION_KINDS[number];

export type StructureKind = 'shelter' | 'granary' | 'wall' | 'shrine';

export interface Action { kind: ActionKind; targetPersonId?: number; tile?: Vec2; structure?: StructureKind }
export interface ScoredAction { action: Action; score: number }   // score finite, >= 0

export type MemoryKind = 'helped' | 'harmed' | 'shared' | 'stolen' | 'death-witnessed' | 'kin-died' | 'disaster' | 'victory' | 'defeat' | 'birth' | 'taught' | 'wonder';
export interface MemoryEventRec { tick: Tick; kind: MemoryKind; otherId: number; valence: number; salience: number }  // valence -1..1, salience 0..1

export type RelationKind = 'kin' | 'friend' | 'rival' | 'partner';
export interface Relationship { otherId: number; kind: RelationKind; affinity: number }  // affinity -1..1

export interface Inventory { food: number; wood: number; stone: number; metal: number; tools: number }

export type TechId = 'fire' | 'agriculture' | 'construction' | 'metallurgy' | 'writing' | 'medicine';
export const TECH_IDS: readonly TechId[] = ['fire', 'agriculture', 'construction', 'metallurgy', 'writing', 'medicine'];
export const TECH_THRESHOLDS: Record<TechId, number> = { fire: 50, agriculture: 200, construction: 400, metallurgy: 800, writing: 1200, medicine: 1600 };

export interface Person {
  id: number;
  alive: boolean;
  ageTicks: number;
  sex: 'm' | 'f';
  name: string;
  pos: Vec2;                       // integer tile coords
  civId: number;
  settlementId: number | null;
  lineage: Lineage;
  traits: Traits;
  emotions: Emotions;
  morality: Morality;
  needs: Needs;
  skills: Skills;
  health: number;                  // 0..1, 0 = dead
  lifespanTicks: number;           // sampled at birth
  memory: MemoryEventRec[];        // newest first, length <= MEMORY_CAP
  relationships: Relationship[];   // length <= RELATIONSHIP_CAP
  inventory: Inventory;
  actionWeights: Record<ActionKind, number>;  // init 1.0, clamped to [ACTION_WEIGHT_MIN, ACTION_WEIGHT_MAX]
  brainState: unknown;             // JSON-serializable plain object owned by the brain
  influence: number;               // 0..1
  beliefIds: number[];
  partnerId: number | null;
  pregnantUntil: Tick | null;
  parentIds: [number, number] | null;
  causeOfDeath: string | null;
}

export interface Civ {
  id: number;
  name: string;
  color: string;                   // css hex
  knowledge: Record<TechId, number>;
  techs: TechId[];                 // currently ACTIVE techs
  atWarWith: number[];
  warWeariness: number;            // 0..1
}

export interface Settlement {
  id: number;
  civId: number;
  name: string;
  center: Vec2;
  memberIds: number[];
  stock: Inventory;                // communal stores
  structures: Record<StructureKind, number>;  // counts
}

export interface Religion {
  id: number;
  name: string;
  founderId: number;
  civId: number;
  moralityBias: Partial<Morality>;
  zeal: number;                    // 0..1
}

export interface SimConfig {
  seed: number;
  mode: 'civs' | 'mixed';          // 'civs' = 4 one-lineage civilizations; 'mixed' = 1 civ, lineages mixed
  mapSize: MapSize;
  startPopulation: number;         // 200 | 400 | 600
}

/**
 * Clamp v into [lo, hi]. A NaN input propagates as NaN by design — the
 * dev-build invariant checks (Task 33) are the tripwire for NaN, so clamp
 * must not mask one.
 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp v into [0, 1]. */
export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Euclidean distance between two points. */
export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
```

- [ ] **Step 4: Run the test — expect PASS**

```
npx vitest run tests/shared/types.test.ts
```

Expected:

```
 ✓ tests/shared/types.test.ts (14 tests)

 Test Files  1 passed (1)
      Tests  14 passed (14)
```

- [ ] **Step 5: Run the whole suite and typecheck**

```
npx vitest run
npm run typecheck
```

Expected: vitest reports `Test Files  2 passed (2)` and `Tests  34 passed (34)` (rng + types); typecheck exits 0 with no errors.

- [ ] **Step 6: Commit**

```
git add src/shared/types.ts tests/shared/types.test.ts
git commit -m "feat(shared): core types, constants, and clamp/clamp01/dist" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Expected: `[master <hash>]` reporting 2 files changed.

### Task 4: Seeded name generator — `src/engine/names.ts`

**Files:**
- Create: `src/engine/names.ts`
- Test: `tests/engine/names.test.ts`

**Interfaces:**
- Consumes (from Task 2, `src/engine/rng.ts`):
  - `interface Rng` — specifically `split(label: string): Rng`, `pick<T>(arr: readonly T[]): T`, `chance(p: number): boolean`
  - `createRng(seed: number): Rng` (tests only)
- Produces (from `src/engine/names.ts`):
  - contract-exact: `export interface NameGen { person(sex: 'm' | 'f'): string; place(): string; civ(): string; religion(): string }` and `export function makeNameGenerator(rng: Rng): NameGen`
  - beyond the contract (fully defined here; used by tests and available to the UI for flavor): `export const MALE_ENDINGS: readonly string[]` and `export const FEMALE_ENDINGS: readonly string[]` — disjoint sex-distinct syllable ending pools
  - Behavioral guarantees: every generated name (all four kinds) is a single capitalized word matching `/^[A-Z][a-z]+$/` and 3-12 characters long; generation is deterministic per rng seed; `makeNameGenerator` internally calls `rng.split('names')`, so drawing names NEVER consumes draws from the rng instance passed in (Task 33 can hand it the master rng without perturbing the simulation stream)

- [ ] **Step 1: Write the failing test `tests/engine/names.test.ts`**

Create `tests/engine/names.test.ts` with exactly this content:

```ts
import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/engine/rng';
import { makeNameGenerator, MALE_ENDINGS, FEMALE_ENDINGS } from '../../src/engine/names';
import type { NameGen } from '../../src/engine/names';

function sample(gen: NameGen, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(gen.person('m'), gen.person('f'), gen.place(), gen.civ(), gen.religion());
  }
  return out;
}

describe('makeNameGenerator', () => {
  it('is deterministic per seed across all name kinds', () => {
    const a = makeNameGenerator(createRng(2026));
    const b = makeNameGenerator(createRng(2026));
    expect(sample(a, 40)).toEqual(sample(b, 40));
  });

  it('different seeds give different name sequences', () => {
    const a = makeNameGenerator(createRng(1));
    const b = makeNameGenerator(createRng(2));
    expect(sample(a, 20)).not.toEqual(sample(b, 20));
  });

  it('every name is a non-empty capitalized word', () => {
    const gen = makeNameGenerator(createRng(7));
    for (const name of sample(gen, 40)) {
      expect(name.length).toBeGreaterThan(0);
      expect(name).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it('every name is between 3 and 12 characters', () => {
    const gen = makeNameGenerator(createRng(8));
    for (const name of sample(gen, 40)) {
      expect(name.length).toBeGreaterThanOrEqual(3);
      expect(name.length).toBeLessThanOrEqual(12);
    }
  });

  it('female names use only female endings', () => {
    const gen = makeNameGenerator(createRng(9));
    for (let i = 0; i < 200; i++) {
      const name = gen.person('f').toLowerCase();
      expect(FEMALE_ENDINGS.some((e) => name.endsWith(e))).toBe(true);
      expect(MALE_ENDINGS.some((e) => name.endsWith(e))).toBe(false);
    }
  });

  it('male names use only male endings', () => {
    const gen = makeNameGenerator(createRng(10));
    for (let i = 0; i < 200; i++) {
      const name = gen.person('m').toLowerCase();
      expect(MALE_ENDINGS.some((e) => name.endsWith(e))).toBe(true);
      expect(FEMALE_ENDINGS.some((e) => name.endsWith(e))).toBe(false);
    }
  });

  it('male and female ending pools are disjoint', () => {
    for (const e of MALE_ENDINGS) expect(FEMALE_ENDINGS).not.toContain(e);
  });

  it('produces varied names, not one repeated name', () => {
    const gen = makeNameGenerator(createRng(11));
    const males = new Set<string>();
    for (let i = 0; i < 100; i++) males.add(gen.person('m'));
    expect(males.size).toBeGreaterThanOrEqual(10);
  });
});
```

(The variety bound is generous: with the Step 3 pools, seed 11 actually yields 92 distinct names out of 100 — verified numerically.)

- [ ] **Step 2: Run the test — expect FAIL (module missing)**

```
npx vitest run tests/engine/names.test.ts
```

Expected: FAIL with `Error: Failed to resolve import "../../src/engine/names" from "tests/engine/names.test.ts". Does the file exist?` and `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the implementation `src/engine/names.ts`**

Create `src/engine/names.ts` with exactly this content. The ending pools were chosen so that no male name can ever end with a female ending string or vice versa (the male endings end in `n/r/m/s/k/h`, the female endings end in `a/e/n`, and the single `n`-final female ending `wen` collides with no male tail):

```ts
// Seeded syllable name generator. All draws go through the provided Rng —
// internally re-split with the label 'names' — so generating names never
// consumes draws from (and never perturbs) the caller's stream.

import type { Rng } from './rng';

export interface NameGen { person(sex: 'm' | 'f'): string; place(): string; civ(): string; religion(): string }

// Syllable pools. Every entry is lowercase a-z. The length budget guarantees
// each generated name is 3..12 characters:
//   person   = start(2-3) [+ mid(2)] + ending(1-4)  -> 3..9 chars
//   place    = start(2-3) [+ mid(2)] + ending(4)    -> 6..9 chars
//   civ      = start(2-3) [+ mid(2)] + ending(2-4)  -> 4..9 chars
//   religion = start(2-3) [+ mid(2)] + ending(3)    -> 5..8 chars
const STARTS = ['ka', 'mi', 'ta', 'so', 'ren', 'da', 'lu', 'bel', 'ha', 'jor', 'ni', 'va', 'or', 'el', 'shi', 'gan', 'tes', 'ru', 'mar', 'fen'] as const;
const MIDS = ['ri', 'la', 'to', 'ne', 'mo', 'sa', 'vi', 'du'] as const;

// Sex-distinct ending pools. The two arrays are disjoint, and by construction
// no generated male name ends with any female ending string or vice versa
// (tested in tests/engine/names.test.ts).
export const MALE_ENDINGS: readonly string[] = ['on', 'ar', 'im', 'us', 'ek', 'or', 'an', 'eth'];
export const FEMALE_ENDINGS: readonly string[] = ['a', 'ia', 'ra', 'she', 'wen', 'lea', 'issa', 'yne'];

const PLACE_ENDINGS = ['ford', 'holm', 'vale', 'wick', 'dale', 'moor', 'crag', 'mere'] as const;
const CIV_ENDINGS = ['ia', 'land', 'mark', 'heim', 'aria', 'oth'] as const;
const RELIGION_ENDINGS = ['ism', 'ara', 'eon', 'yth', 'ael'] as const;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function makeNameGenerator(rng: Rng): NameGen {
  const r = rng.split('names');

  // start syllable, plus a middle syllable with probability midChance
  function stem(midChance: number): string {
    const start = r.pick(STARTS);
    return r.chance(midChance) ? start + r.pick(MIDS) : start;
  }

  return {
    person(sex: 'm' | 'f'): string {
      const base = stem(0.4);
      const ending = sex === 'f' ? r.pick(FEMALE_ENDINGS) : r.pick(MALE_ENDINGS);
      return capitalize(base + ending);
    },
    place(): string {
      return capitalize(stem(0.35) + r.pick(PLACE_ENDINGS));
    },
    civ(): string {
      return capitalize(stem(0.3) + r.pick(CIV_ENDINGS));
    },
    religion(): string {
      return capitalize(stem(0.3) + r.pick(RELIGION_ENDINGS));
    },
  };
}
```

Sample output for seed 2026 (illustrative only — the tests assert properties, not specific strings): people `Elan`, `Ellea`, `Miar`, `Fenwen`; places `Marmoor`, `Vadale`; civs `Kaheim`, `Tesia`; religions `Kayth`, `Ganviael`.

- [ ] **Step 4: Run the test — expect PASS**

```
npx vitest run tests/engine/names.test.ts
```

Expected:

```
 ✓ tests/engine/names.test.ts (8 tests)

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

- [ ] **Step 5: Run the whole suite and typecheck**

```
npx vitest run
npm run typecheck
```

Expected: vitest reports `Test Files  3 passed (3)` and `Tests  42 passed (42)` (rng 20 + types 14 + names 8); typecheck exits 0 with no errors.

- [ ] **Step 6: Commit**

```
git add src/engine/names.ts tests/engine/names.test.ts
git commit -m "feat(engine): seeded syllable name generator" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Expected: `[master <hash>]` reporting 2 files changed.
