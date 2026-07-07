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
