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

export interface ChartSeries {
  label: string;
  color: string;
  points: number[];
}

const LINE_CHART_LEGEND_MARGIN_PX = 8;
const LINE_CHART_DOT_RADIUS_PX = 2;

/**
 * Contract signature verbatim. Each series is plotted over its own point
 * count independently (never a shared index range), so series of
 * differing lengths never throw or misalign.
 */
export function lineChart(
  canvas: HTMLCanvasElement,
  series: ChartSeries[],
  opts?: { yMax?: number },
): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  let maxValue = 0;
  for (const s of series) for (const p of s.points) if (p > maxValue) maxValue = p;
  const yMax = opts?.yMax ?? Math.max(1, maxValue);

  for (const s of series) {
    const n = s.points.length;
    if (n === 0) continue;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 2;
    if (n === 1) {
      const y = h - (Math.max(0, s.points[0] as number) / yMax) * h;
      ctx.beginPath();
      ctx.arc(w / 2, y, LINE_CHART_DOT_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = h - (Math.max(0, s.points[i] as number) / yMax) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  series.forEach((s, i) => {
    ctx.fillStyle = s.color;
    ctx.fillText(s.label, LINE_CHART_LEGEND_MARGIN_PX, h - LINE_CHART_LEGEND_MARGIN_PX - i * 12);
  });

  ctx.restore();
}

/**
 * Contract signature verbatim ("lineage share" annotation). Draws
 * series.length stacked bands bottom-to-top by cumulative sum at each x
 * position, using the shortest series length actually present so
 * mismatched-length series never index out of bounds.
 */
export function stackedAreaChart(canvas: HTMLCanvasElement, series: ChartSeries[]): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  if (series.length === 0) {
    ctx.restore();
    return;
  }

  let n = Infinity;
  for (const s of series) n = Math.min(n, s.points.length);
  if (!Number.isFinite(n) || n === 0) {
    ctx.restore();
    return;
  }

  for (let i = 0; i < n; i++) {
    const x0 = (i / n) * w;
    const x1 = ((i + 1) / n) * w;
    let cumulative = 0;
    for (const s of series) {
      const v = Math.max(0, s.points[i] as number);
      const yTop = h - (cumulative + v) * h;
      const yBottom = h - cumulative * h;
      ctx.fillStyle = s.color;
      ctx.fillRect(x0, yTop, Math.max(1, x1 - x0), yBottom - yTop);
      cumulative += v;
    }
  }

  ctx.restore();
}
