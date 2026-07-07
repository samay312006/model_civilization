import { el } from './dom';
import type { SimClient } from './client';
import { SPEED_PRESETS } from '../shared/protocol';

export interface ControlsHandle {
  root: HTMLElement;
  setReadout(year: number, season: string, population: number): void;
}

const SPEED_LABELS: Record<number, string> = {
  0: 'Pause',
  1: '1x',
  10: '10x',
  60: '60x',
  360: '360x',
  1000: '1000x',
};

/**
 * Contract-role time control bar (additive named export — the contract
 * names the file and behavior, not this exact signature). Renders one
 * button per SPEED_PRESETS entry, a skip-generation button, and a live
 * year/season/population readout.
 */
export function renderControls(container: HTMLElement, client: SimClient): ControlsHandle {
  container.innerHTML = '';

  const speedButtons: HTMLButtonElement[] = [];

  function setActive(ticksPerSecond: number): void {
    for (const btn of speedButtons) {
      btn.classList.toggle('active', Number(btn.getAttribute('data-speed')) === ticksPerSecond);
    }
  }

  const speedButtonEls = SPEED_PRESETS.map((ticksPerSecond) => {
    const btn = el(
      'button',
      {
        class: 'btn',
        type: 'button',
        'data-testid': `speed-${ticksPerSecond}`,
        'data-speed': String(ticksPerSecond),
      },
      SPEED_LABELS[ticksPerSecond] ?? `${ticksPerSecond}x`,
    );
    btn.addEventListener('click', () => {
      client.send({ type: 'setSpeed', ticksPerSecond });
      setActive(ticksPerSecond);
    });
    speedButtons.push(btn);
    return btn;
  });

  const skipButton = el(
    'button',
    { class: 'btn', type: 'button', 'data-testid': 'skip-generation' },
    'Skip generation',
  );
  skipButton.addEventListener('click', () => {
    client.send({ type: 'step', n: -1 });
  });

  const readout = el('span', { class: 'tabular-nums', 'data-testid': 'readout' }, 'Year 0, spring - 0 people');

  const root = el(
    'div',
    { class: 'setup-row' },
    ...speedButtonEls,
    skipButton,
    readout,
  );
  container.appendChild(root);

  return {
    root,
    setReadout(year: number, season: string, population: number): void {
      readout.textContent = `Year ${year}, ${season} - ${population} people`;
    },
  };
}
