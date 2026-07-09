import { el } from './dom';
import { THEME_CSS_PATH } from './dom';
import { renderSetupScreen } from './setup';
import { SimClient } from './client';
import { renderControls } from './controls';
import { MapView } from './map';
import { renderInspector } from './inspector';
import { renderDashboard } from './dashboard';
import { renderFeed } from './feed';
import { AUTOSAVE_NAME, listRuns, loadRun, saveRun, startAutosave } from './storage';
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
 * Additive app-bootstrap entry point (not a contract symbol). This task
 * (44) replaces every earlier task's incrementally-patched `mountApp` body
 * wholesale: the resume-on-startup path (loading `__autosave`) needs to
 * reach the exact same map/inspector/dashboard/feed wiring as the normal
 * Begin path, so both are factored into one shared `beginRun` function
 * instead of leaving the four separate incremental patch sites Tasks
 * 39/41/42/43 each appended to `handle.onBegin`.
 *
 * Deviation from the brief's literal `document.getElementById(...)` calls
 * throughout Step 9: that only resolves elements attached to the live
 * `document`, but `root` (and therefore the run screen shell appended to
 * it) is not guaranteed to be document-attached — every UI wiring test in
 * this suite (including this task's own main-storage-wiring.test.ts) mounts
 * into a detached `document.createElement('div')`. `root.querySelector`
 * matches the pattern this file has used since Task 39 for these same
 * containers and works regardless of attachment.
 */
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

  function beginRun(
    config: SimConfig,
    initialMessage: { type: 'init'; config: SimConfig } | { type: 'load'; json: string },
  ): void {
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

    const controlsHandle = renderControls(root.querySelector('#topbar-controls')!, client);
    const mapView = new MapView(root.querySelector('#map-canvas') as HTMLCanvasElement);
    const inspectorHandle = renderInspector(root.querySelector('#dock-inspector')!, {
      onFollow: (detail) => {
        client.send({ type: 'inspect', personId: detail.person.id });
        mapView.centerOn(detail.person.pos.x, detail.person.pos.y);
      },
    });
    const dashboardHandle = renderDashboard(root.querySelector('#dock-dashboard')!);
    const feedHandle = renderFeed(root.querySelector('#dock-feed')!);

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
    client.onTerrain((tiles, worldSize) => {
      mapView.setTerrain(tiles, worldSize);
    });
    mapView.onPickPerson((personId) => {
      client.send({ type: 'inspect', personId });
    });

    startAutosave(client);
    wireIoButtons(client);
  }

  function wireIoButtons(client: SimClient): void {
    const ioContainer = root.querySelector('#topbar-io')!;
    const saveNameInput = el('input', {
      type: 'text',
      class: 'btn',
      'data-testid': 'save-name-input',
      value: 'my-run',
    }) as HTMLInputElement;

    // SimClient's onSerialized is append-only/never-unsubscribed (see
    // storage.ts's startAutosave doc comment). To avoid leaving a fresh
    // listener alive on every click — which would fire on every future
    // serialize response from ANY source (autosave, the other button, or a
    // later click) and silently save/export under a stale name — this
    // function registers exactly ONE persistent onSerialized listener, once,
    // here at setup time. It dispatches based on a `pendingAction` flag set
    // immediately before each `client.send({ type: 'serialize' })` call and
    // cleared right after handling, so exactly one action fires per
    // serialize response no matter how many times Save/Export are clicked.
    type PendingAction = { kind: 'save'; name: string } | { kind: 'export'; name: string } | null;
    let pendingAction: PendingAction = null;
    client.onSerialized((json) => {
      const action = pendingAction;
      pendingAction = null;
      if (action === null) return; // e.g. autosave's own periodic serialize
      if (action.kind === 'save') {
        void saveRun(action.name, json);
        return;
      }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = el('a', { href: url, download: `${action.name}.json` }) as HTMLAnchorElement;
      link.click();
      URL.revokeObjectURL(url);
    });

    const saveButton = el('button', { class: 'btn', type: 'button', 'data-testid': 'save-button' }, 'Save');
    saveButton.addEventListener('click', () => {
      pendingAction = { kind: 'save', name: saveNameInput.value };
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
      pendingAction = { kind: 'export', name: saveNameInput.value };
      client.send({ type: 'serialize' });
    });

    const importInput = el('input', {
      type: 'file',
      accept: 'application/json',
      'data-testid': 'import-file-input',
      style: 'display:none',
    }) as HTMLInputElement;
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

  void listRuns()
    .then((runs) => {
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
    })
    .catch(() => {
      startNormally();
    });
}

const appRoot = document.getElementById('app');
if (appRoot !== null) {
  mountApp(appRoot);
}
