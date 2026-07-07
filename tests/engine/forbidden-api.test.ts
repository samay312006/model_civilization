import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = [join(process.cwd(), 'src', 'engine'), join(process.cwd(), 'src', 'shared')];
const FORBIDDEN: { pattern: RegExp; label: string }[] = [
  { pattern: /Math\.random/, label: 'Math.random' },
  { pattern: /Date\.now/, label: 'Date.now' },
  { pattern: /new Date\(/, label: 'new Date(' },
];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('forbidden API usage', () => {
  it('src/engine and src/shared never call Math.random, Date.now, or new Date(', () => {
    const violations: string[] = [];
    for (const root of ROOTS) {
      for (const file of collectTsFiles(root)) {
        const content = readFileSync(file, 'utf-8');
        for (const { pattern, label } of FORBIDDEN) {
          if (pattern.test(content)) {
            violations.push(`${file}: contains ${label}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
