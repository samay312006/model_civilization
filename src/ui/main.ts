import { el } from './dom';
import { THEME_CSS_PATH } from './dom';
import { renderSetupScreen } from './setup';
import { SimClient } from './client';
import { renderControls } from './controls';
import { MapView } from './map';
import { renderInspector } from './inspector';
import type { SimConfig } from '../shared/types';
import type { Snapshot } from '../shared/protocol';

/** Set by the setup screen's onBegin handler; read by Task 39's main.ts modification. */
export let pendingConfig: SimConfig | null = null;
/** The single SimClient instance for the app; Tasks 40-44 read this rather than constructing another worker. */
export let activeClient: SimClient | null = null;
/** Updated inside the onSnapshot subscription that also drives the controls readout. */
export let latestSnapshot: Snapshot | null = null;

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
    const runScreen = renderRunScreenShell();
    root.appendChild(runScreen);

    const client = new SimClient();
    activeClient = client;
    client.start(config);

    // Deviation from the brief's literal `document.getElementById(...)`: that
    // only resolves elements attached to the live `document`, but `root` (and
    // therefore the run screen shell just appended to it) is not guaranteed
    // to be document-attached — tests/ui/main.test.ts and
    // tests/ui/main-controls-wiring.test.ts both mount into a detached
    // `document.createElement('div')`. `root.querySelector` matches the
    // pattern main.test.ts already uses for these same containers and works
    // regardless of attachment, while still being non-null immediately after
    // `root.appendChild(runScreen)` since renderRunScreenShell always creates
    // the element.
    const controlsHandle = renderControls(root.querySelector('#topbar-controls')!, client);
    client.onSnapshot((snapshot) => {
      latestSnapshot = snapshot;
      controlsHandle.setReadout(snapshot.year, snapshot.season, snapshot.population);
    });

    const mapView = new MapView(root.querySelector('#map-canvas') as HTMLCanvasElement);
    client.onSnapshot((snapshot) => {
      mapView.render(snapshot);
    });
    client.onTerrain((tiles, worldSize) => {
      mapView.setTerrain(tiles, worldSize);
    });

    const inspectorHandle = renderInspector(root.querySelector('#dock-inspector')!, {
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
  });
}

const appRoot = document.getElementById('app');
if (appRoot !== null) {
  mountApp(appRoot);
}
