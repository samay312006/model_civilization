import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Task 33's Simulation suite runs full-society ticks (200 people, all
    // Section 6 modules) for up to 2000 ticks in a single test; the vitest
    // default (5000ms) is far too short for that at this population/tick
    // count. Raised globally rather than per-test so every current and
    // future long-horizon simulation test is covered.
    testTimeout: 120000,
  },
});
