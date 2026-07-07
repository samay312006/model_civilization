// Canvas chart primitives shared across the dock (inspector + dashboard).
// This file is created in Task 41 with radarChart only; Task 42 appends
// lineChart and stackedAreaChart to the same file (see that task's Files:
// block — it lists this file under Modify:, not Create:).

const RADAR_LABEL_RADIUS_FACTOR = 1.15;
const RADAR_GRID_RINGS = [0.25, 0.5, 0.75, 1.0];
const RADAR_MARGIN_PX = 20;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Contract signature verbatim. Draws axes.length equally spaced spokes
 * from the canvas center, a background grid at 25/50/75/100% radius, one
 * filled+stroked polygon from values (each clamped to [0,1]), and an axis
 * label past the outer ring. Iterates min(axes.length, values.length);
 * never throws on empty or mismatched-length inputs.
 */
export function radarChart(canvas: HTMLCanvasElement, axes: string[], values: number[], color: string): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  const n = Math.min(axes.length, values.length);
  if (n === 0) {
    ctx.restore();
    return;
  }

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.max(1, Math.min(w, h) / 2 - RADAR_MARGIN_PX);

  const angleFor = (i: number): number => (Math.PI * 2 * i) / n - Math.PI / 2;

  // Background grid rings.
  ctx.strokeStyle = '#232a3a';
  ctx.lineWidth = 1;
  for (const ring of RADAR_GRID_RINGS) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const angle = angleFor(i % n);
      const r = radius * ring;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Spokes + axis labels.
  ctx.fillStyle = '#9aa3b5';
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const angle = angleFor(i);
    const spokeX = cx + Math.cos(angle) * radius;
    const spokeY = cy + Math.sin(angle) * radius;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(spokeX, spokeY);
    ctx.stroke();

    const labelX = cx + Math.cos(angle) * radius * RADAR_LABEL_RADIUS_FACTOR;
    const labelY = cy + Math.sin(angle) * radius * RADAR_LABEL_RADIUS_FACTOR;
    ctx.fillText(axes[i] as string, labelX, labelY);
  }

  // Value polygon.
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const angle = angleFor(idx);
    const v = clamp01(values[idx] as number);
    const x = cx + Math.cos(angle) * radius * v;
    const y = cy + Math.sin(angle) * radius * v;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}
