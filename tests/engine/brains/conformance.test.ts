/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allBrains } from '../../../src/engine/brains/registry';
import type { Brain } from '../../../src/engine/brains/types';
import { createRng } from '../../../src/engine/rng';
import { ACTION_KINDS, LINEAGES } from '../../../src/shared/types';
import { makePerceptionFixture } from '../../helpers/perceptionFixture';

const BRAIN_FILES: Record<string, string> = {
  opus: 'src/engine/brains/opus.ts',
  sonnet: 'src/engine/brains/sonnet.ts',
  haiku: 'src/engine/brains/haiku.ts',
  fable: 'src/engine/brains/fable.ts',
};

const ALLOWED_IMPORT_PREFIXES = [
  '../../shared/types',
  '../rng',
  './types',
  '../agents/perception',
];

function actionKey(kind: string, targetPersonId?: number, tile?: { x: number; y: number }, structure?: string): string {
  const target = targetPersonId ?? 'none';
  const t = tile ? `${tile.x},${tile.y}` : 'none';
  const s = structure ?? 'none';
  return `${kind}|${target}|${t}|${s}`;
}

describe.each(allBrains().map((b) => [b.lineage, b] as const))('brain conformance: %s', (lineageName, brain: Brain) => {
  it('has a lineage field matching the registry key', () => {
    expect(brain.lineage).toBe(lineageName);
  });

  it('temperament fields are within documented ranges and constant across calls', () => {
    const t1 = brain.temperament();
    const t2 = brain.temperament();
    expect(t1).toEqual(t2);

    for (const key of ['fear', 'joy', 'grief', 'anger', 'hope'] as const) {
      expect(t1.emotionVolatility[key]).toBeGreaterThanOrEqual(0.25);
      expect(t1.emotionVolatility[key]).toBeLessThanOrEqual(4);
      expect(Number.isFinite(t1.emotionVolatility[key])).toBe(true);
      expect(t1.emotionDecayPerTick[key]).toBeGreaterThanOrEqual(0);
      expect(t1.emotionDecayPerTick[key]).toBeLessThanOrEqual(0.2);
      expect(Number.isFinite(t1.emotionDecayPerTick[key])).toBe(true);
    }
    expect(t1.moralWeight).toBeGreaterThanOrEqual(0);
    expect(t1.moralWeight).toBeLessThanOrEqual(2);
    expect(t1.learningRate).toBeGreaterThanOrEqual(0);
    expect(t1.learningRate).toBeLessThanOrEqual(1);
    expect(t1.imitationRate).toBeGreaterThanOrEqual(0);
    expect(t1.imitationRate).toBeLessThanOrEqual(1);
    expect(t1.desperationThreshold).toBeGreaterThanOrEqual(0);
    expect(t1.desperationThreshold).toBeLessThanOrEqual(1);
    for (const taboo of t1.taboos) {
      expect(ACTION_KINDS).toContain(taboo);
    }
    expect(Array.isArray(t1.quirks)).toBe(true);
    expect(typeof t1.description).toBe('string');
    expect(t1.description.length).toBeGreaterThan(0);
  });

  it('init returns a JSON-round-trippable plain object', () => {
    const rng = createRng(1);
    const { person } = makePerceptionFixture(rng, { lineage: lineageName });
    const state = brain.init(person, rng);
    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(roundTripped).toEqual(state);
  });

  it('decide returns only candidate actions with finite scores >= 0, across 200 randomized perceptions', () => {
    const rng = createRng(42);
    for (let i = 0; i < 200; i++) {
      const { person, perception } = makePerceptionFixture(rng, { lineage: lineageName });
      const brainState = brain.init(person, rng.split(`init-${i}`));
      const scored = brain.decide(perception, brainState, rng.split(`decide-${i}`));

      expect(Array.isArray(scored)).toBe(true);
      const candidateKeys = new Set(
        perception.candidates.map((a) => actionKey(a.kind, a.targetPersonId, a.tile, a.structure)),
      );
      for (const s of scored) {
        expect(s.action).toBeDefined();
        const key = actionKey(s.action.kind, s.action.targetPersonId, s.action.tile, s.action.structure);
        expect(candidateKeys.has(key)).toBe(true);
        expect(Number.isFinite(s.score)).toBe(true);
        expect(s.score).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('determinism: same seed produces identical decisions', () => {
    const runOnce = (): string[] => {
      const rng = createRng(777);
      const results: string[] = [];
      for (let i = 0; i < 50; i++) {
        const { person, perception } = makePerceptionFixture(rng, { lineage: lineageName });
        const brainState = brain.init(person, rng.split(`init-${i}`));
        const scored = brain.decide(perception, brainState, rng.split(`decide-${i}`));
        results.push(JSON.stringify(scored));
      }
      return results;
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it('performance: 1000 decide calls complete in under 1000ms total', () => {
    const rng = createRng(9001);
    const fixtures = Array.from({ length: 1000 }, (_, i) => {
      const { person, perception } = makePerceptionFixture(rng, { lineage: lineageName });
      const brainState = brain.init(person, rng.split(`perf-init-${i}`));
      return { perception, brainState };
    });
    const decideRng = createRng(1);
    const start = performance.now();
    for (const f of fixtures) {
      brain.decide(f.perception, f.brainState, decideRng);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });

  it('onOutcome never throws and leaves state JSON-serializable', () => {
    const rng = createRng(55);
    const { person, perception } = makePerceptionFixture(rng, { lineage: lineageName });
    const brainState = brain.init(person, rng);
    const outcomeKinds: Array<{ success: boolean; reward: number }> = [
      { success: true, reward: 1 },
      { success: false, reward: -1 },
      { success: true, reward: 0 },
    ];
    for (const { success, reward } of outcomeKinds) {
      const action = perception.candidates[0] ?? { kind: 'rest' as const };
      expect(() => {
        brain.onOutcome({ action, success, reward, tick: perception.tick }, brainState, rng);
      }).not.toThrow();
      const roundTripped = JSON.parse(JSON.stringify(brainState));
      expect(roundTripped).toEqual(brainState);
    }
  });

  it('module source contains no forbidden imports', () => {
    const filePath = path.join(process.cwd(), BRAIN_FILES[lineageName] as string);
    const source = readFileSync(filePath, 'utf-8');
    const importLines = source
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.startsWith('import '));

    expect(importLines.length).toBeGreaterThan(0);

    for (const line of importLines) {
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      expect(match).not.toBeNull();
      const importPath = (match as RegExpMatchArray)[1] as string;
      const isAllowed = ALLOWED_IMPORT_PREFIXES.some((prefix) => importPath === prefix || importPath.startsWith(prefix));
      expect(isAllowed, `disallowed import "${importPath}" in ${BRAIN_FILES[lineageName]}`).toBe(true);
    }

    expect(source).not.toMatch(/\bdocument\./);
    expect(source).not.toMatch(/\bwindow\./);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new Date\(/);
  });
});

describe('allBrains and getBrain', () => {
  it('allBrains returns exactly the four lineages in LINEAGES order', () => {
    const brains = allBrains();
    expect(brains.map((b) => b.lineage)).toEqual([...LINEAGES]);
  });
});
