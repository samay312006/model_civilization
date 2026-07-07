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
