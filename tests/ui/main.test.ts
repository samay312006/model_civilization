// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mountApp } from '../../src/ui/main';

// mountApp's Task 44 resume-on-startup check (listRuns() against the real,
// unmocked storage.ts) is asynchronous — jsdom has no real indexedDB, so the
// real listRuns() call rejects a few microtask hops later and mountApp's
// .catch() is what renders the setup screen. Flushing with a macrotask
// (setTimeout) after mountApp() reliably waits past that, regardless of the
// exact number of microtask hops in the storage rejection chain.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('mountApp', () => {
  it('renders the setup screen into the root element', async () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);
    mountApp(root);
    await flushMicrotasks();
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

  it('switches to a run screen shell after Begin is clicked', async () => {
    const root = document.createElement('div');
    mountApp(root);
    await flushMicrotasks();
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
