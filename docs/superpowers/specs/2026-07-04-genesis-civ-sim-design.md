# Genesis — Model-Authored Civilization Simulator: Design Spec

**Date:** 2026-07-04
**Status:** Approved by user
**Workspace:** `C:\simulation_exp`

## 1. Purpose

Simulate civilizations whose people's decision-making code ("brains") is authored by different Claude models, then observe — with zero LLM usage at runtime — how those civilizations plan, build, grow, learn, and collapse. Every run produces a different history.

Two experiment modes:

1. **One-model civilizations** — each civilization's entire population uses brains authored by a single model. Four civilizations compete/coexist: Opus-brained, Sonnet-brained, Haiku-brained, Fable-brained.
2. **Mixed civilization** — a single civilization whose population mixes all four brain lineages. Observed variable: which lineage's way-of-thinking spreads or dies out over generations.

### Non-negotiable constraints

- **No API keys, no local LLMs, no network calls at runtime.** All model intelligence is captured at build time as authored code.
- **No scripted outcomes.** Wars, famines, religions, collapse must emerge from agent interactions; nothing is hard-coded to happen.
- **Non-deterministic across runs** (random seed per run) but **deterministic per seed** (same seed reproduces the same history, for debugging and replays).
- Built once, runs standalone indefinitely. Future scope expansion happens by returning to Claude Code, not by the code modifying itself.

## 2. Architecture

Single-page browser application. No backend.

- **Language/tooling:** TypeScript, Vite, vanilla DOM + Canvas 2D for rendering (WebGL optimization only if profiling demands it).
- **Threading:** simulation engine runs in a **Web Worker**; UI/renderer on the main thread. Worker posts compact state snapshots/diffs; main thread posts commands (pause, speed, inspect).
- **Persistence:** IndexedDB for autosave and saved runs; JSON export/import for sharing runs.
- **Distribution:** static build — `npm run dev` for development, `npm run build` produces a folder openable via any static file server (and a convenience launcher).

### Module layout

```
src/
  engine/          # pure simulation, no DOM — runs in worker
    world/         # map generation, terrain, resources, seasons, climate
    agents/        # person: traits, needs, emotions, morality, memory,
                   # relationships, skills, lifecycle, learning
    brains/        # Brain interface + four model-authored implementations
      types.ts     # the Brain contract (shared, hand-written first)
      opus.ts      # authored by Claude Opus subagent
      sonnet.ts    # authored by Claude Sonnet subagent
      haiku.ts     # authored by Claude Haiku subagent
      fable.ts     # authored by Claude Fable subagent
    society/       # settlements, influence/leadership, culture, religion,
                   # technology, trade, diplomacy, conflict
    sim/           # tick loop, scheduler, RNG (seeded), event log, snapshots
  ui/              # setup screen, map renderer, inspectors, dashboards,
                   # event feed, time controls, replay, save/load
  shared/          # types, message protocol between worker and UI
tests/             # unit, property/invariant, brain conformance, smoke
```

## 3. The world

- Procedurally generated tile map from the run seed. Terrain: water, plains, forest, mountain, desert. Per-tile resources: food fertility, wood, stone, metal.
- Seasons affect food yield and travel; occasional natural events (drought, harsh winter, disease outbreaks) arise from world-state, not scripts.
- Map sizes selectable at setup (small/medium/large).

## 4. People (agents)

Each person has:

| System | Content |
|---|---|
| **Traits** | curiosity, aggression, empathy, industriousness, risk tolerance — inherited from parents (blend + mutation) |
| **Emotions** | fear, joy, grief, anger, hope — continuous values updated by events and decay; directly modulate decision weights |
| **Morality** | moral-foundations vector (care, fairness, loyalty, authority, sanctity, liberty) — acts as permit/veto and utility shaping on candidate actions |
| **Needs** | hunger, safety, rest, belonging, esteem — drive action urgency |
| **Memory** | bounded episodic store of salient events (grudges, gratitude, known locations, witnessed deaths); influences emotions and decisions; fades |
| **Relationships** | family, friendship, rivalry, romance; affects cooperation, sharing, grief |
| **Skills** | farming, gathering, building, crafting, fighting, healing, teaching — improve with use |
| **Learning** | (a) reinforcement: action-outcome updates to decision weights; (b) imitation of locally successful people; (c) parent→child teaching transfers skill and values |
| **Lifecycle** | birth, childhood (protected, learning-heavy), adulthood, aging; death by starvation, violence, disease, or old age; reproduction requires pair-bond + resources |

Population target: **1,000–3,000 agents** at comfortable speed; engine data layout (struct-of-arrays / typed arrays for hot paths) chosen to keep this feasible in a worker.

## 5. Brains

A **Brain** is a decision policy behind a single shared interface (hand-written first, before any authoring):

```
decide(perception, self) -> scored candidate actions
onOutcome(action, outcome, self) -> learning update
temperament() -> lineage-specific tuning: emotion dynamics, moral
                 weighting, memory salience, learning rates, quirks/taboos
```

- Four implementations, each authored at build time by a subagent running the corresponding Claude model: **Opus, Sonnet, Haiku, Fable**. Each model receives the same interface, the same documentation, and the same instructions: "design how your people think." Differences in decision philosophy, emotional volatility, moral emphasis, and quirks are the experimental signal.
- **Heritability:** a child's brain lineage comes from its parents (mixed-lineage parents: child takes one lineage, probabilistically). Lineage is visible in the UI.
- **Conformance suite:** all four brains must pass identical interface/sanity tests (returns valid actions, no NaN, bounded runtime per decision, deterministic given seed). Style is free; contract is not.
- Brains may not access the network, the DOM, or global mutable state — pure functions over their inputs plus per-agent brain state.

## 6. Civilization dynamics (all emergent)

- **Settlements** form where people cluster near resources; grow into villages/towns visually and functionally (granaries, walls — built by agent labor).
- **Leadership** emerges from influence (esteem, relationships, success); no appointed rulers. Leaders bias group decisions (migration, war, projects) but individuals can dissent.
- **Culture** = drifting aggregate of member values/traits; divergence can split groups.
- **Technology**: accumulated practice and discoveries unlock capabilities (fire → agriculture → metallurgy → writing → …). Knowledge lives in people and can be *lost* when they die untaught.
- **Religion**: belief-memes that arise (e.g., from coincidences after disasters), spread socially, and shape morality weights of believers.
- **Economy**: gathering, production, storage, sharing, barter/trade within and between groups.
- **Conflict & diplomacy**: raids, wars, alliances, migrations driven by scarcity, fear, grudges, leader temperament.
- **Collapse**: famine, war, disease, culture death, knowledge loss — civilizations can genuinely die out; runs may end in extinction.

## 7. UI/UX

Polished, modern, interactive (design-intelligence tooling to be used during implementation — dark theme, readable data-viz, smooth interactions).

- **Setup screen:** mode (one-model civs / mixed civ), map size, starting population, seed (random or entered), speed presets.
- **Map view:** pan/zoom from whole-world to individual people; civ territories colored; settlements render growth; agents as sprites/dots with subtle state cues.
- **Person inspector:** click a person → live emotion gauges, morality radar chart, memory timeline, relationship web, skills, brain lineage badge.
- **Civ dashboard:** population curve, births/deaths, tech progress, culture-drift visualization, war/peace status, brain-lineage share over time (the headline chart for Mode 2).
- **Event feed:** human-readable narrated history ("Year 62: famine in the river valley — Mira's family flees east"), filterable by civ/severity.
- **Time controls:** pause, 1×–1000×, skip-a-generation; timeline scrubber on saved/replayed runs.
- **Save/load/replay:** autosave, named saves, JSON export/import; replay reconstructs history from seed + command log.

## 8. Quality, testing, error handling

- **Determinism:** single seeded RNG stream (split per subsystem); same seed + same build = same history. CI-style test replays a fixed seed and asserts a checksum.
- **Invariants (checked in dev builds):** population accounting balances (births − deaths = Δ); no NaN/∞ in emotions, needs, resources; no negative stockpiles; every agent has a valid brain.
- **Unit tests** per engine system (needs decay, inheritance, combat resolution, tech unlock, memory fading).
- **Brain conformance suite** (identical for all four lineages).
- **Smoke tests:** 5,000+ ticks headless without crash, with plausibility bounds (population neither explodes past memory limits nor is extinction treated as an error).
- **Runtime resilience:** worker crash → auto-restart from last autosave; autosave interval configurable.

## 9. Build process (how the models participate)

1. Engine skeleton, Brain interface, and conformance tests are written first.
2. Four brain-authoring subagents are dispatched — one per model (Opus, Sonnet, Haiku, Fable) — each authoring its lineage's brain against the frozen interface.
3. Brains are validated by the conformance suite; failures go back to the authoring model to fix.
4. Engine, UI, and integration are implemented and tested.
5. Balance pass: long smoke runs; if a lineage insta-dies for mechanical (not behavioral) reasons, fix the mechanics, never the brains' character.

## 10. Out of scope for v1

- 3D graphics, sound/music
- Populations beyond ~3,000
- Live-LLM mode (feasible later behind a toggle if API keys become available)
- Multiplayer / networked features
- Self-modifying code of any kind

## 11. Future expansion ideas (non-binding)

- More lineages (other models via one-time authoring sessions)
- Scriptable scenarios (drop a plague, meteor, golden age)
- Deeper economy (currency, specialization markets)
- Inter-run evolution: seed a new run with survivors of a previous one
