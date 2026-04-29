import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { previewChartResult } from "../api/client";
import Button from "./ui/Button";
import Alert from "./ui/Alert";

type Point = { x: number; y: number };

type Series = {
  id: string;
  name: string;
  points: Point[];
  curvePoints: Point[];
};

type Panel = {
  id?: string;
  series: Series[];
};

type EditorResultJson = {
  panels?: any[];
  artifacts?: any;
  [k: string]: any;
};

type OverlayPlotArea = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type OverlayAxisSample = {
  value: number;
  screen: number;
};

type EditorOverlayCalibration = {
  artifactKey: string;
  plotArea: OverlayPlotArea;
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number[];
  yTicks: number[];
  xAxisSamples: OverlayAxisSample[];
  yAxisSamples: OverlayAxisSample[];
};

type View = {
  domainX: [number, number];
  domainY: [number, number];
};

type AxisWarp = {
  dataKnots: number[];
  screenKnots: number[]; // 0..1
};

type ResizeAxis = "x" | "y" | "both";

type DeletePointEntry = {
  seriesId: string;
  index: number;
  point: Point;
};

type DeleteSelectionBox = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

type AutoSplinePointDrag = {
  panelIndex: number;
  seriesId: string;
  index: number;
  before: Point;
  pointerId: number;
};

type Patch =
  | { type: "move-point"; seriesId: string; index: number; before: Point; after: Point }
  | { type: "add-point"; seriesId: string; index: number; point: Point }
  | { type: "delete-point"; seriesId: string; index: number; point: Point }
  | { type: "delete-many-points"; points: DeletePointEntry[] }
  | { type: "add-series"; index: number; series: Series }
  | { type: "delete-series"; index: number; series: Series }
  | { type: "rename-series"; seriesId: string; before: string; after: string }
  | { type: "set-domain"; before: View; after: View }
  | { type: "set-warp"; axis: "x" | "y"; before: AxisWarp | null; after: AxisWarp | null };

type Props = {
  chartId: number;
  backdropImageUrl?: string;
  showBackdrop?: boolean;
  resultJson: unknown;
  highlightResultJson?: unknown;
  showOnlyHighlightPoints?: boolean;
  onResultJsonChange?: (next: any) => void;
  uiMode?: "full" | "compact";
};

const MAX_SERIES_NAME = 60;
const MAX_SERIES_LABEL = 26;

const MIN_SPAN = 1e-9;
const DEFAULT_EDITOR_BOX = { w: 900, h: 420 };
const EDITOR_MARGIN = { l: 56, r: 18, t: 16, b: 44 } as const;
const DEFAULT_EDITOR_PLOT_SIZE = {
  w: DEFAULT_EDITOR_BOX.w - EDITOR_MARGIN.l - EDITOR_MARGIN.r,
  h: DEFAULT_EDITOR_BOX.h - EDITOR_MARGIN.t - EDITOR_MARGIN.b,
} as const;
const DEFAULT_EDITOR_PLOT_HEIGHT = DEFAULT_EDITOR_PLOT_SIZE.h;
const MIN_EDITOR_WINDOW_SCALE = 0.1;
const MIN_EDITOR_WINDOW_WIDTH = 240;
const MIN_EDITOR_WINDOW_HEIGHT = 220;
const RESIZE_HANDLE_SIZE = 16;
const COLOR_OPTIONS = [
  {
    id: "black",
    label: "Черный",
    path: "stroke-black dark:stroke-slate-100",
    dot: "bg-black dark:bg-slate-100",
    pointFill: "fill-black dark:fill-slate-100",
  },
  {
    id: "blue",
    label: "Синий",
    path: "stroke-blue-600 dark:stroke-blue-400",
    dot: "bg-blue-600",
    pointFill: "fill-blue-600",
  },
  {
    id: "green",
    label: "Зеленый",
    path: "stroke-green-600 dark:stroke-green-400",
    dot: "bg-green-600",
    pointFill: "fill-green-600",
  },
  {
    id: "red",
    label: "Красный",
    path: "stroke-red-600 dark:stroke-red-400",
    dot: "bg-red-600",
    pointFill: "fill-red-600",
  },
  {
    id: "orange",
    label: "Оранжевый",
    path: "stroke-orange-600 dark:stroke-orange-400",
    dot: "bg-orange-600",
    pointFill: "fill-orange-600",
  },
  {
    id: "purple",
    label: "Фиолетовый",
    path: "stroke-purple-600 dark:stroke-purple-400",
    dot: "bg-purple-600",
    pointFill: "fill-purple-600",
  },
] as const;


function ellipsis(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "...";
}

function uid(prefix = "s") {
  const r = Math.random().toString(16).slice(2);
  return `${prefix}_${Date.now().toString(16)}_${r}`;
}

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function normalizeSelectionBox(box: DeleteSelectionBox) {
  return {
    x: Math.min(box.startX, box.endX),
    y: Math.min(box.startY, box.endY),
    w: Math.abs(box.endX - box.startX),
    h: Math.abs(box.endY - box.startY),
  };
}

function toFiniteNumber(value: unknown): number | null {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function parseOverlayAxisSamples(value: unknown): OverlayAxisSample[] {
  if (!Array.isArray(value)) return [];

  const parsed = value
    .map((item) => {
      if (!isObj(item)) return null;
      const rawValue = toFiniteNumber((item as Record<string, unknown>).value);
      const rawScreen = toFiniteNumber((item as Record<string, unknown>).screen);
      if (rawValue === null || rawScreen === null) return null;
      return { value: rawValue, screen: clamp(rawScreen, 0, 1) };
    })
    .filter(Boolean) as OverlayAxisSample[];

  parsed.sort((a, b) => a.value - b.value || a.screen - b.screen);

  const normalized: OverlayAxisSample[] = [];
  for (const sample of parsed) {
    const prev = normalized[normalized.length - 1];
    if (prev && Math.abs(prev.value - sample.value) <= 1e-9) {
      normalized[normalized.length - 1] = sample;
      continue;
    }
    if (prev && sample.screen <= prev.screen + 1e-4) continue;
    normalized.push(sample);
  }

  return normalized;
}

function extrapolateDomainFromAxisSamples(
  fallbackDomain: [number, number],
  samples: OverlayAxisSample[]
): [number, number] {
  if (samples.length < 2) return fallbackDomain;

  const byScreen = samples
    .slice()
    .sort((a, b) => a.screen - b.screen || a.value - b.value);
  const first = byScreen[0];
  const second = byScreen[1];
  const beforeLast = byScreen[byScreen.length - 2];
  const last = byScreen[byScreen.length - 1];

  const startDenom = second.screen - first.screen;
  const endDenom = last.screen - beforeLast.screen;
  if (Math.abs(startDenom) <= MIN_SPAN || Math.abs(endDenom) <= MIN_SPAN) {
    return fallbackDomain;
  }

  const startSlope = (second.value - first.value) / startDenom;
  const endSlope = (last.value - beforeLast.value) / endDenom;
  const start = first.value - first.screen * startSlope;
  const end = last.value + (1 - last.screen) * endSlope;
  if (!Number.isFinite(start) || !Number.isFinite(end) || Math.abs(end - start) <= MIN_SPAN) {
    return fallbackDomain;
  }

  return [Math.min(start, end), Math.max(start, end)];
}

function niceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = Math.abs(max - min);
  const rawStep = span / Math.max(1, count);
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const frac = rawStep / pow;
  const step = frac <= 1 ? 1 * pow : frac <= 2 ? 2 * pow : frac <= 5 ? 5 * pow : 10 * pow;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;

  const out: number[] = [];
  for (let v = start; v <= end + step * 0.5; v += step) out.push(v);

  const eps = step * 1e-6;
  return out.filter((t) => t >= min - eps && t <= max + eps);
}

// Подписи осей и tooltip показываем с точностью до сотых.
function formatTick(v: number) {
  if (!Number.isFinite(v)) return "-";
  const r = Math.round(v * 100) / 100;
  return r.toFixed(2).replace(/\.?0+$/, "");
}

// Нормализуем список точек из формата [[x, y], ...].
function parsePointList(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item: any) => Array.isArray(item) && item.length >= 2)
    .map((item: any) => ({ x: Number(item[0]), y: Number(item[1]) }))
    .filter((point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function parsePanels(resultJson: unknown): Panel[] {
  if (!isObj(resultJson)) return [{ series: [] }];

  const panelsRaw = (resultJson as any).panels;
  if (!Array.isArray(panelsRaw) || panelsRaw.length === 0) return [{ series: [] }];

  return panelsRaw.map((panelRaw: any, panelIndex: number) => {
    const seriesRaw = Array.isArray(panelRaw?.series) ? panelRaw.series : [];
    const series: Series[] = seriesRaw.map((seriesItem: any, seriesIndex: number) => ({
      id: String(seriesItem?.id ?? uid(`s${panelIndex}_${seriesIndex}`)),
      name: String(seriesItem?.name ?? `Кривая ${seriesIndex + 1}`),
      points: parsePointList(seriesItem?.points),
      curvePoints: parsePointList(seriesItem?.curve_points),
    }));

    return { id: panelRaw?.id != null ? String(panelRaw.id) : undefined, series };
  });
}

function parseEditorOverlayCalibration(resultJson: unknown): EditorOverlayCalibration | null {
  if (!isObj(resultJson)) return null;

  const rawMeta = isObj((resultJson as any).ml_meta) ? ((resultJson as any).ml_meta as Record<string, any>) : null;
  const rawOverlay = rawMeta && isObj(rawMeta.editor_overlay) ? (rawMeta.editor_overlay as Record<string, any>) : null;
  if (!rawOverlay) return null;

  const rawPlotArea = isObj(rawOverlay.plot_area) ? (rawOverlay.plot_area as Record<string, any>) : null;
  if (!rawPlotArea) return null;

  const left = toFiniteNumber(rawPlotArea.left);
  const top = toFiniteNumber(rawPlotArea.top);
  const right = toFiniteNumber(rawPlotArea.right);
  const bottom = toFiniteNumber(rawPlotArea.bottom);
  if (left === null || top === null || right === null || bottom === null || right <= left || bottom <= top) {
    return null;
  }

  const xDomainRaw = Array.isArray(rawOverlay.x_domain) ? rawOverlay.x_domain : null;
  const yDomainRaw = Array.isArray(rawOverlay.y_domain) ? rawOverlay.y_domain : null;
  if (!xDomainRaw || xDomainRaw.length < 2 || !yDomainRaw || yDomainRaw.length < 2) {
    return null;
  }

  const x0 = toFiniteNumber(xDomainRaw[0]);
  const x1 = toFiniteNumber(xDomainRaw[1]);
  const y0 = toFiniteNumber(yDomainRaw[0]);
  const y1 = toFiniteNumber(yDomainRaw[1]);
  if (x0 === null || x1 === null || y0 === null || y1 === null || x0 === x1 || y0 === y1) {
    return null;
  }

  const xTicks = Array.isArray(rawOverlay.x_ticks)
    ? Array.from(new Set(rawOverlay.x_ticks.map((item) => Number(item)).filter(Number.isFinite)))
    : [];
  const yTicks = Array.isArray(rawOverlay.y_ticks)
    ? Array.from(new Set(rawOverlay.y_ticks.map((item) => Number(item)).filter(Number.isFinite)))
    : [];
  const xAxisSamples = parseOverlayAxisSamples(rawOverlay.x_axis_samples);
  const yAxisSamples = parseOverlayAxisSamples(rawOverlay.y_axis_samples);
  const xDomain = extrapolateDomainFromAxisSamples([x0, x1], xAxisSamples);
  const yDomain = extrapolateDomainFromAxisSamples([Math.min(y0, y1), Math.max(y0, y1)], yAxisSamples);

  return {
    artifactKey: typeof rawOverlay.artifact_key === "string" && rawOverlay.artifact_key.trim() ? rawOverlay.artifact_key : "original",
    plotArea: { left, top, right, bottom },
    xDomain,
    yDomain,
    xTicks: xAxisSamples.length ? xAxisSamples.map((sample) => sample.value) : xTicks,
    yTicks: yAxisSamples.length ? yAxisSamples.map((sample) => sample.value) : yTicks,
    xAxisSamples,
    yAxisSamples,
  };
}

function defaultViewFromPanels(panels: Panel[], calibration: EditorOverlayCalibration | null): View {
  if (calibration) {
    return {
      domainX: [...calibration.xDomain] as [number, number],
      domainY: [...calibration.yDomain] as [number, number],
    };
  }

  const all = panels.flatMap((panel) => panel.series.flatMap((series) => series.points));
  const xs = all.map((point) => point.x);
  const ys = all.map((point) => point.y);
  const x0 = xs.length ? Math.min(...xs) : 0;
  const x1 = xs.length ? Math.max(...xs) : 1;
  const y0 = ys.length ? Math.min(...ys) : 0;
  const y1 = ys.length ? Math.max(...ys) : 1;
  const padX = (x1 - x0 || 1) * 0.05;
  const padY = (y1 - y0 || 1) * 0.05;
  return { domainX: [x0 - padX, x1 + padX], domainY: [y0 - padY, y1 + padY] };
}

function stripCurvePreview(panels: Panel[]): Panel[] {
  return panels.map((panel) => ({
    ...panel,
    series: panel.series.map((series) => ({
      ...series,
      curvePoints: [],
    })),
  }));
}

function hasCurvePreview(panels: Panel[]): boolean {
  return panels.every((panel) =>
    panel.series.every((series) => series.points.length === 0 || series.curvePoints.length > 0)
  );
}

function mergeCurvePreview(current: Panel[], preview: Panel[]): Panel[] {
  return current.map((panel, panelIndex) => {
    const previewPanel = preview[panelIndex];
    const previewSeries = new Map((previewPanel?.series ?? []).map((series) => [series.id, series]));

    return {
      ...panel,
      series: panel.series.map((series) => ({
        ...series,
        curvePoints: previewSeries.get(series.id)?.curvePoints ?? series.curvePoints,
      })),
    };
  });
}

function sampleCubicSpline(points: Point[], samples = 300): Point[] {
  const pts = points
    .map((point) => ({ x: point.x, y: point.y }))
    .sort((a, b) => a.x - b.x);

  if (pts.length < 3) return pts;

  const xs = pts.map((point) => point.x);
  const ys = pts.map((point) => point.y);
  for (let index = 1; index < xs.length; index += 1) {
    if (Math.abs(xs[index] - xs[index - 1]) <= Number.EPSILON) return pts;
  }

  const n = xs.length;
  const h = Array.from({ length: n - 1 }, (_, index) => xs[index + 1] - xs[index]);
  const a = new Array<number>(n).fill(0);
  const b = new Array<number>(n).fill(0);
  const c = new Array<number>(n).fill(0);
  const d = new Array<number>(n).fill(0);
  b[0] = 1;
  b[n - 1] = 1;

  for (let index = 1; index < n - 1; index += 1) {
    a[index] = h[index - 1];
    b[index] = 2 * (h[index - 1] + h[index]);
    c[index] = h[index];
    d[index] = 3 * ((ys[index + 1] - ys[index]) / h[index] - (ys[index] - ys[index - 1]) / h[index - 1]);
  }

  for (let index = 1; index < n; index += 1) {
    const weight = a[index] / b[index - 1];
    b[index] -= weight * c[index - 1];
    d[index] -= weight * d[index - 1];
  }

  const cc = new Array<number>(n).fill(0);
  cc[n - 1] = d[n - 1] / b[n - 1];
  for (let index = n - 2; index >= 0; index -= 1) {
    cc[index] = (d[index] - c[index] * cc[index + 1]) / b[index];
  }

  const bb = new Array<number>(n - 1).fill(0);
  const dd = new Array<number>(n - 1).fill(0);
  for (let index = 0; index < n - 1; index += 1) {
    bb[index] = (ys[index + 1] - ys[index]) / h[index] - (h[index] * (2 * cc[index] + cc[index + 1])) / 3;
    dd[index] = (cc[index + 1] - cc[index]) / (3 * h[index]);
  }

  const result: Point[] = [];
  const totalSamples = Math.max(samples, n);
  for (let sample = 0; sample < totalSamples; sample += 1) {
    const t = totalSamples === 1 ? 0 : sample / (totalSamples - 1);
    const x = xs[0] + (xs[n - 1] - xs[0]) * t;
    let segment = n - 2;
    for (let index = 0; index < n - 1; index += 1) {
      if (x <= xs[index + 1]) {
        segment = index;
        break;
      }
    }

    const dx = x - xs[segment];
    const y = ys[segment] + bb[segment] * dx + cc[segment] * dx * dx + dd[segment] * dx * dx * dx;
    result.push({ x, y });
  }

  return result;
}

function buildNextResultJson(base: unknown, panels: Panel[]): any {
  const out: EditorResultJson = isObj(base) ? { ...(base as any) } : {};
  out.panels = panels.map((panel) => ({
    ...(panel.id != null ? { id: panel.id } : {}),
    series: panel.series.map((series) => ({
      id: series.id,
      name: series.name,
      points: series.points.map((point) => [point.x, point.y]),
    })),
  }));
  delete out.auto_spline;
  return out;
}

function buildNextAutoSplineResultJson(base: unknown, highlightBase: unknown, panels: Panel[]): any {
  const out: EditorResultJson = isObj(base) ? structuredClone(base as any) : {};
  const currentAutoSpline = isObj(out.auto_spline) ? { ...(out.auto_spline as Record<string, any>) } : {};
  const rawHighlight = isObj(highlightBase) ? highlightBase as Record<string, any> : {};
  const sourcePanels = Array.isArray(currentAutoSpline.panels)
    ? currentAutoSpline.panels
    : Array.isArray(rawHighlight.panels)
      ? rawHighlight.panels
      : [];

  currentAutoSpline.panels = panels.map((panel, panelIndex) => {
    const rawPanel = isObj(sourcePanels[panelIndex]) ? { ...sourcePanels[panelIndex] } : {};
    const rawSeries = Array.isArray(rawPanel.series) ? rawPanel.series : [];

    rawPanel.id = panel.id ?? rawPanel.id;
    rawPanel.series = panel.series.map((series, seriesIndex) => {
      const rawSeriesItem = isObj(rawSeries[seriesIndex]) ? { ...rawSeries[seriesIndex] } : {};
      return {
        ...rawSeriesItem,
        id: series.id,
        name: series.name,
        points: series.points.map((point) => [point.x, point.y]),
        curve_points: series.curvePoints.map((point) => [point.x, point.y]),
      };
    });

    return rawPanel;
  });

  out.auto_spline = currentAutoSpline;
  return out;
}

// ===== Warp helpers =====
function _findSeg(knots: number[], v: number) {
  let i = knots.length - 2;
  for (let j = 0; j < knots.length - 1; j++) {
    if (v <= knots[j + 1]) return j;
  }
  return i;
}

function normalizeWarp(w: AxisWarp): AxisWarp {
  const dk = w.dataKnots.slice();
  const sk = w.screenKnots.slice();

  if (dk.length < 2) return { dataKnots: dk, screenKnots: [0, 1] };

  while (sk.length < dk.length) sk.push(1);
  while (sk.length > dk.length) sk.pop();

  sk[0] = 0;
  sk[sk.length - 1] = 1;
  for (let i = 1; i < sk.length - 1; i++) {
    sk[i] = clamp(sk[i], sk[i - 1] + 0.01, sk[i + 1] - 0.01);
  }
  sk[sk.length - 1] = 1;

  for (let i = 1; i < dk.length; i++) dk[i] = Math.max(dk[i], dk[i - 1] + 1e-9);

  return { dataKnots: dk, screenKnots: sk };
}

function axisValueToScreen(value: number, domain: [number, number], warp: AxisWarp | null) {
  const [d0, d1] = domain;
  if (!Number.isFinite(value) || d0 === d1) return 0.5;

  if (!warp || warp.dataKnots.length < 2 || warp.screenKnots.length !== warp.dataKnots.length) {
    return (value - d0) / (d1 - d0);
  }

  const dk = warp.dataKnots;
  const sk = warp.screenKnots;
  const n = dk.length;

  if (value <= dk[0]) {
    const a = dk[0],
      b = dk[1];
    const sa = sk[0],
      sb = sk[1];
    const t = (value - a) / (b - a || 1);
    return sa + t * (sb - sa);
  }

  if (value >= dk[n - 1]) {
    const a = dk[n - 2],
      b = dk[n - 1];
    const sa = sk[n - 2],
      sb = sk[n - 1];
    const t = (value - a) / (b - a || 1);
    return sa + t * (sb - sa);
  }

  const i = _findSeg(dk, value);
  const a = dk[i],
    b = dk[i + 1];
  const sa = sk[i],
    sb = sk[i + 1];
  const t = (value - a) / (b - a || 1);
  return sa + t * (sb - sa);
}

function axisScreenToValue(screen: number, domain: [number, number], warp: AxisWarp | null) {
  const [d0, d1] = domain;
  if (!Number.isFinite(screen) || d0 === d1) return d0;

  if (!warp || warp.dataKnots.length < 2 || warp.screenKnots.length !== warp.dataKnots.length) {
    return d0 + clamp(screen, 0, 1) * (d1 - d0);
  }

  const dk = warp.dataKnots;
  const sk = warp.screenKnots;

  const s = clamp(screen, sk[0], sk[sk.length - 1]);
  const i = _findSeg(sk, s);

  const sa = sk[i],
    sb = sk[i + 1];
  const a = dk[i],
    b = dk[i + 1];
  const t = (s - sa) / (sb - sa || 1);
  return a + t * (b - a);
}

function buildWarpFromOverlaySamples(domain: [number, number], samples: OverlayAxisSample[]): AxisWarp | null {
  if (samples.length < 2) return null;

  const [d0, d1] = domain;
  if (!Number.isFinite(d0) || !Number.isFinite(d1) || Math.abs(d1 - d0) <= MIN_SPAN) return null;

  const dataKnots = [d0];
  const screenKnots = [0];

  for (const sample of samples) {
    if (sample.value <= d0 + MIN_SPAN || sample.value >= d1 - MIN_SPAN) continue;
    const prevScreen = screenKnots[screenKnots.length - 1];
    if (sample.screen <= prevScreen + 1e-4 || sample.screen >= 1 - 1e-4) continue;
    dataKnots.push(sample.value);
    screenKnots.push(sample.screen);
  }

  dataKnots.push(d1);
  screenKnots.push(1);

  return dataKnots.length >= 2 ? normalizeWarp({ dataKnots, screenKnots }) : null;
}

function remapDataKnots(oldKnots: number[], oldDomain: [number, number], newDomain: [number, number]) {
  const [a0, a1] = oldDomain;
  const [b0, b1] = newDomain;
  const da = a1 - a0 || 1;
  const db = b1 - b0 || 1;

  return oldKnots.map((v, i) => {
    if (i === 0) return b0;
    if (i === oldKnots.length - 1) return b1;
    const t = (v - a0) / da;
    return b0 + t * db;
  });
}

function defaultColorIndex(prefer: number, used: Set<number>) {
  if (!used.has(prefer)) return prefer;
  for (let i = 0; i < COLOR_OPTIONS.length; i++) {
    if (!used.has(i)) return i;
  }
  return prefer;
}

export default function GraphEditor({
  chartId,
  backdropImageUrl,
  showBackdrop = false,
  resultJson,
  highlightResultJson,
  showOnlyHighlightPoints = false,
  onResultJsonChange,
  uiMode = "full",
}: Props) {
  const calibration = useMemo(() => parseEditorOverlayCalibration(resultJson), [resultJson]);
  const overlayLocked = calibration !== null;
  const initialPanels = useMemo(() => parsePanels(resultJson), [resultJson]);
  const highlightPanels = useMemo(() => parsePanels(highlightResultJson), [highlightResultJson]);
  const compactMode = uiMode === "compact";

  const [panels, setPanels] = useState<Panel[]>(() => initialPanels);
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(() => {
    const p0 = initialPanels[0];
    return p0?.series?.[0]?.id ?? null;
  });

  const [mode, setMode] = useState<"select" | "delete-point">("select");
  const [gridDragAxis, setGridDragAxis] = useState<null | "x" | "y">(null);
  const [panMode, setPanMode] = useState(false);

  const [selection, setSelection] = useState<{ seriesId: string; index: number } | null>(null);

  const [view, setView] = useState<View>(() => defaultViewFromPanels(initialPanels, calibration));

  const [warpX, setWarpX] = useState<AxisWarp | null>(null);
  const [warpY, setWarpY] = useState<AxisWarp | null>(null);

  const [undo, setUndo] = useState<Patch[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [pointRadius, setPointRadius] = useState(5);
  const [showSidebar, setShowSidebar] = useState(true);
  const [hover, setHover] = useState<null | { cx: number; cy: number; x: number; y: number; seriesName: string }>(
    null
  );
  const [deleteSelectionBox, setDeleteSelectionBox] = useState<DeleteSelectionBox | null>(null);

  // show/hide curves
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set());
  const [visOpen, setVisOpen] = useState(false);
  const visRef = useRef<HTMLDivElement | null>(null);

  // per-series color (index into COLOR_OPTIONS)
  const [colorById, setColorById] = useState<Record<string, number>>({});

  const nameBeforeRef = useRef<string | null>(null);
  const [customNames, setCustomNames] = useState<string[]>([]);
  const [pendingAssignName, setPendingAssignName] = useState<string | null>(null);
  const [newNameInput, setNewNameInput] = useState("");

  const svgRef = useRef<SVGSVGElement | null>(null);
  const editorViewportRef = useRef<HTMLDivElement | null>(null);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [editorWidthScale, setEditorWidthScale] = useState(1);
  const [editorHeightScale, setEditorHeightScale] = useState(1);
  const prevDomainXRef = useRef<[number, number]>(view.domainX);
  const prevDomainYRef = useRef<[number, number]>(view.domainY);

  const tickDragRef = useRef<null | { axis: "x" | "y"; index: number; before: AxisWarp; pointerId: number }>(null);
  const pointDragRef = useRef<null | { seriesId: string; index: number; before: Point; pointerId: number }>(null);
  const autoSplinePointDragRef = useRef<AutoSplinePointDrag | null>(null);

  const panRef = useRef<
    null | {
      pointerId: number;
      startView: View;
      startWarpX: AxisWarp | null;
      startWarpY: AxisWarp | null;
      startX: number;
      startY: number;
    }
  >(null);
  const resizeDragRef = useRef<
    null | {
      pointerId: number;
      axis: ResizeAxis;
      startClientX: number;
      startClientY: number;
      startWidth: number;
      startHeight: number;
    }
  >(null);
  const deleteSelectionDragRef = useRef<
    null | {
      pointerId: number;
      startX: number;
      startY: number;
    }
  >(null);

  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    if (!backdropImageUrl) {
      setImageSize(null);
      return;
    }

    let cancelled = false;
    const image = new window.Image();

    image.onload = () => {
      if (cancelled || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
      setImageSize({ w: image.naturalWidth, h: image.naturalHeight });
    };

    image.onerror = () => {
      if (cancelled) return;
      setImageSize(null);
    };

    image.src = backdropImageUrl;

    return () => {
      cancelled = true;
    };
  }, [backdropImageUrl]);


  useEffect(() => {
    setEditorWidthScale(1);
    setEditorHeightScale(1);
  }, [chartId, backdropImageUrl]);

  useEffect(() => {
    setCustomNames([]);
    setPendingAssignName(null);
    setNewNameInput("");
  }, [chartId]);

  const previewTimerRef = useRef<number | null>(null);
  const previewRequestRef = useRef(0);
  const [maxEditorWidth, setMaxEditorWidth] = useState<number | null>(null);

  const panel0 = panels[0] ?? { series: [] };
  const seriesList = panel0.series;
  const [editableHighlightPanels, setEditableHighlightPanels] = useState<Panel[]>(() => highlightPanels);
  const highlightSeriesList = useMemo(() => {
    const panel = editableHighlightPanels[0] ?? { series: [] };
    return panel.series;
  }, [editableHighlightPanels]);

  useEffect(() => {
    setEditableHighlightPanels(highlightPanels);
  }, [highlightPanels]);

  useEffect(() => {
    if (compactMode) {
      setShowSidebar(false);
      return;
    }

    setShowSidebar(true);
  }, [compactMode]);

  useEffect(() => {
    const element = editorViewportRef.current;
    if (!element) return;

    const update = () => {
      setMaxEditorWidth(Math.max(MIN_EDITOR_WINDOW_WIDTH, Math.floor(element.clientWidth)));
    };

    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (activeSeriesId && seriesList.some((s) => s.id === activeSeriesId)) return;
    setActiveSeriesId(seriesList[0]?.id ?? null);
  }, [activeSeriesId, seriesList]);

  const activeSeries = useMemo(
    () => seriesList.find((s) => s.id === activeSeriesId) ?? null,
    [seriesList, activeSeriesId]
  );
  const detectedNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const series of seriesList) {
      const name = series.name.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }

    return out;
  }, [seriesList]);
  const availableNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const rawName of [...detectedNames, ...customNames]) {
      const name = rawName.trim().slice(0, MAX_SERIES_NAME);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }

    return out;
  }, [customNames, detectedNames]);
  const customNameSet = useMemo(() => new Set(customNames), [customNames]);

  useEffect(() => {
    if (!overlayLocked || !calibration) return;

    setView({
      domainX: [...calibration.xDomain] as [number, number],
      domainY: [...calibration.yDomain] as [number, number],
    });
    setWarpX(buildWarpFromOverlaySamples(calibration.xDomain, calibration.xAxisSamples));
    setWarpY(buildWarpFromOverlaySamples(calibration.yDomain, calibration.yAxisSamples));
    setGridDragAxis(null);
    setPanMode(false);
  }, [
    calibration,
    overlayLocked,
  ]);

  const requestServerPreview = (nextPanels: Panel[], delayMs = 120) => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
    }

    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;

    previewTimerRef.current = window.setTimeout(async () => {
      try {
        const preview = await previewChartResult(chartId, buildNextResultJson(resultJson, nextPanels));
        if (previewRequestRef.current !== requestId) return;

        const previewPanels = parsePanels(preview.resultJson);
        setPanels((current) => mergeCurvePreview(current, previewPanels));
        setErr(null);
      } catch (e: any) {
        if (previewRequestRef.current !== requestId) return;
        setErr(e?.message ?? "Ошибка обновления сплайна");
      }
    }, delayMs);
  };

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
      }
      previewRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!seriesList.length || hasCurvePreview(panels)) return;
    requestServerPreview(stripCurvePreview(panels), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Fix BUG #1: do NOT re-add hidden series on any edit =====
  const prevIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const currIds = seriesList.map((s) => s.id);
    const prevIds = prevIdsRef.current;

    const prevSet = new Set(prevIds);
    const currSet = new Set(currIds);

    const added = currIds.filter((id) => !prevSet.has(id));
    const removed = prevIds.filter((id) => !currSet.has(id));

    setVisibleIds((prevVis) => {
      const next = new Set(prevVis);

      // init on first mount
      if (prevIds.length === 0 && next.size === 0) {
        currIds.forEach((id) => next.add(id));
        return next;
      }

      // remove deleted series from visibility
      for (const id of removed) next.delete(id);

      // add ONLY newly added series (do not restore manually hidden)
      for (const id of added) next.add(id);

      // keep at least one visible
      if (currIds.length && next.size === 0) next.add(currIds[0]);

      return next;
    });

    prevIdsRef.current = currIds;
  }, [seriesList]);

  // keep active visible
  useEffect(() => {
    if (!activeSeriesId) return;
    setVisibleIds((prev) => {
      if (prev.has(activeSeriesId)) return prev;
      const next = new Set(prev);
      next.add(activeSeriesId);
      return next;
    });
  }, [activeSeriesId]);

  // if selection becomes hidden -> clear
  useEffect(() => {
    if (selection && !visibleIds.has(selection.seriesId)) setSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds]);

  // sync colors with series list (add new, remove missing)
  useEffect(() => {
    const ids = seriesList.map((s) => s.id);
    setColorById((prev) => {
      const next: Record<string, number> = {};
      const used = new Set<number>();

      // keep existing where possible
      for (const id of ids) {
        const idx = prev[id];
        if (typeof idx === "number") {
          next[id] = clamp(idx, 0, COLOR_OPTIONS.length - 1);
          used.add(next[id]);
        }
      }

      // assign for new
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (next[id] != null) continue;
        const prefer = i % COLOR_OPTIONS.length;
        const idx = defaultColorIndex(prefer, used);
        next[id] = idx;
        used.add(idx);
      }

      return next;
    });
  }, [seriesList]);

  // close visibility dropdown on outside click
  useEffect(() => {
    if (!visOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = visRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setVisOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [visOpen]);

  const calibrationPlotSize = useMemo(() => {
    if (!calibration) return null;
    return {
      w: Math.max(1, calibration.plotArea.right - calibration.plotArea.left),
      h: Math.max(1, calibration.plotArea.bottom - calibration.plotArea.top),
    };
  }, [calibration]);

  const calibrationImageScale = useMemo(() => {
    if (!calibrationPlotSize) return null;
    return DEFAULT_EDITOR_PLOT_HEIGHT / Math.max(calibrationPlotSize.h, 1);
  }, [calibrationPlotSize]);

  const fittedImageBox = useMemo(() => {
    if (!imageSize) return null;

    const availableWidth = Math.max(
      MIN_EDITOR_WINDOW_WIDTH,
      Math.floor(maxEditorWidth ?? DEFAULT_EDITOR_BOX.w)
    );
    const naturalWidth = Math.max(imageSize.w, 1);
    const naturalHeight = Math.max(imageSize.h, 1);
    const fitScale = availableWidth / naturalWidth;

    return {
      w: Math.max(MIN_EDITOR_WINDOW_WIDTH, Math.round(naturalWidth * fitScale)),
      h: Math.max(1, Math.round(naturalHeight * fitScale)),
    };
  }, [imageSize, maxEditorWidth]);

  const basePlotSize = useMemo(() => {
    if (calibrationPlotSize) {
      return {
        w: Math.max(50, Math.round(calibrationPlotSize.w * Math.max(calibrationImageScale ?? 1, 1e-6))),
        h: Math.max(50, Math.round(calibrationPlotSize.h * Math.max(calibrationImageScale ?? 1, 1e-6))),
      };
    }

    if (!imageSize) return DEFAULT_EDITOR_PLOT_SIZE;
    const fitScale = DEFAULT_EDITOR_PLOT_HEIGHT / Math.max(imageSize.h, 1);
    return {
      w: Math.max(50, Math.round(imageSize.w * fitScale)),
      h: Math.max(50, Math.round(imageSize.h * fitScale)),
    };
  }, [calibrationImageScale, calibrationPlotSize, imageSize]);

  const baseEditorBox = useMemo(() => {
    if (fittedImageBox) {
      return { w: fittedImageBox.w, h: fittedImageBox.h };
    }

    return {
      w: basePlotSize.w + EDITOR_MARGIN.l + EDITOR_MARGIN.r,
      h: basePlotSize.h + EDITOR_MARGIN.t + EDITOR_MARGIN.b,
    };
  }, [basePlotSize.h, basePlotSize.w, fittedImageBox]);

  const contentBox = useMemo(() => {
    const width = Math.max(
      MIN_EDITOR_WINDOW_WIDTH,
      Math.round(baseEditorBox.w * Math.max(MIN_EDITOR_WINDOW_SCALE, editorWidthScale))
    );
    const height = Math.round(baseEditorBox.h * Math.max(MIN_EDITOR_WINDOW_SCALE, editorHeightScale));

    return {
      w: width,
      h: fittedImageBox ? Math.max(1, height) : Math.max(MIN_EDITOR_WINDOW_HEIGHT, height),
    };
  }, [baseEditorBox.h, baseEditorBox.w, editorHeightScale, editorWidthScale, fittedImageBox]);

  const windowBox = contentBox;
  const visibleWindowWidth = Math.max(
    MIN_EDITOR_WINDOW_WIDTH,
    Math.min(windowBox.w, maxEditorWidth ?? windowBox.w)
  );

  const applyEditorWindowSize = (nextWidth: number, nextHeight: number) => {
    const boundedWidth = Math.max(
      MIN_EDITOR_WINDOW_WIDTH,
      Math.min(nextWidth, maxEditorWidth ?? nextWidth)
    );

    setEditorWidthScale(Math.max(MIN_EDITOR_WINDOW_SCALE, boundedWidth / Math.max(baseEditorBox.w, 1)));
    setEditorHeightScale(Math.max(MIN_EDITOR_WINDOW_SCALE, nextHeight / Math.max(baseEditorBox.h, 1)));
  };

  const startResizeDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    axis: ResizeAxis
  ) => {
    event.preventDefault();
    event.stopPropagation();

    resizeDragRef.current = {
      pointerId: event.pointerId,
      axis,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: windowBox.w,
      startHeight: windowBox.h,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateResizeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;

    const nextWidth =
      drag.axis === "y" ? drag.startWidth : Math.max(MIN_EDITOR_WINDOW_WIDTH, Math.round(drag.startWidth + deltaX));
    const nextHeight =
      drag.axis === "x" ? drag.startHeight : Math.max(MIN_EDITOR_WINDOW_HEIGHT, Math.round(drag.startHeight + deltaY));

    applyEditorWindowSize(nextWidth, nextHeight);
  };

  const finishResizeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    resizeDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const layout = useMemo(() => {
    if (calibration && imageSize && fittedImageBox) {
      const scaleX = contentBox.w / Math.max(imageSize.w, 1);
      const scaleY = contentBox.h / Math.max(imageSize.h, 1);
      const left = calibration.plotArea.left * scaleX;
      const top = calibration.plotArea.top * scaleY;
      const right = calibration.plotArea.right * scaleX;
      const bottom = calibration.plotArea.bottom * scaleY;

      return {
        l: left,
        t: top,
        pw: Math.max(50, right - left),
        ph: Math.max(50, bottom - top),
      };
    }

    const pw = Math.max(50, contentBox.w - EDITOR_MARGIN.l - EDITOR_MARGIN.r);
    const ph = Math.max(50, contentBox.h - EDITOR_MARGIN.t - EDITOR_MARGIN.b);
    return { ...EDITOR_MARGIN, pw, ph };
  }, [calibration, contentBox, fittedImageBox, imageSize]);

  const backdropFrame = useMemo(() => {
    if (!imageSize) return null;

    if (fittedImageBox) {
      return {
        width: Math.max(1, contentBox.w),
        height: Math.max(1, contentBox.h),
        x: 0,
        y: 0,
      };
    }

    if (overlayLocked && calibration && calibrationPlotSize) {
      const autoScaleX = layout.pw / Math.max(calibrationPlotSize.w, 1);
      const autoScaleY = layout.ph / Math.max(calibrationPlotSize.h, 1);
      const imagePlotCenterX = calibration.plotArea.left + calibrationPlotSize.w / 2;
      const imagePlotCenterY = calibration.plotArea.top + calibrationPlotSize.h / 2;
      return {
        width: Math.max(1, imageSize.w * autoScaleX),
        height: Math.max(1, imageSize.h * autoScaleY),
        x: layout.l + layout.pw / 2 - imagePlotCenterX * autoScaleX,
        y: layout.t + layout.ph / 2 - imagePlotCenterY * autoScaleY,
      };
    }

    const width = Math.max(1, basePlotSize.w);
    const height = Math.max(1, basePlotSize.h);
    return {
      width,
      height,
      x: layout.l - (width - layout.pw) / 2,
      y: layout.t - (height - layout.ph) / 2,
    };
  }, [
    basePlotSize.h,
    basePlotSize.w,
    calibration,
    calibrationPlotSize,
    contentBox.h,
    contentBox.w,
    fittedImageBox,
    imageSize,
    layout.l,
    layout.ph,
    layout.pw,
    layout.t,
    overlayLocked,
  ]);
  const pushUndo = (p: Patch) => setUndo((u) => [p, ...u].slice(0, 50));

  // keep warps consistent with domain changes
  useEffect(() => {
    const oldD = prevDomainXRef.current;
    const newD = view.domainX;
    prevDomainXRef.current = newD;

    if (!warpX) return;
    setWarpX((w) => {
      if (!w) return w;
      const dk = remapDataKnots(w.dataKnots, oldD, newD);
      return normalizeWarp({ ...w, dataKnots: dk });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.domainX[0], view.domainX[1]]);

  useEffect(() => {
    const oldD = prevDomainYRef.current;
    const newD = view.domainY;
    prevDomainYRef.current = newD;

    if (!warpY) return;
    setWarpY((w) => {
      if (!w) return w;
      const dk = remapDataKnots(w.dataKnots, oldD, newD);
      return normalizeWarp({ ...w, dataKnots: dk });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.domainY[0], view.domainY[1]]);

  const scale = useMemo(() => {
    const sx = (x: number) => axisValueToScreen(x, view.domainX, warpX);
    const sy = (y: number) => axisValueToScreen(y, view.domainY, warpY);

    const mapX = (x: number) => layout.l + sx(x) * layout.pw;
    const mapY = (y: number) => layout.t + layout.ph - sy(y) * layout.ph;

    const invX = (px: number) => {
      const s = (clamp(px, layout.l, layout.l + layout.pw) - layout.l) / (layout.pw || 1);
      return axisScreenToValue(s, view.domainX, warpX);
    };

    const invY = (py: number) => {
      const s = (layout.t + layout.ph - clamp(py, layout.t, layout.t + layout.ph)) / (layout.ph || 1);
      return axisScreenToValue(s, view.domainY, warpY);
    };

    return { mapX, mapY, invX, invY };
  }, [view, layout, warpX, warpY]);

  const ticksX = useMemo(
    () =>
      overlayLocked && calibration?.xAxisSamples.length
        ? calibration.xAxisSamples.map((sample) => sample.value)
        : warpX
          ? warpX.dataKnots
          : calibration?.xAxisSamples.length
          ? calibration.xAxisSamples.map((sample) => sample.value)
          : calibration?.xTicks.length
          ? calibration.xTicks
          : niceTicks(view.domainX[0], view.domainX[1], 6),
    [calibration, overlayLocked, warpX, view.domainX]
  );
  const ticksY = useMemo(
    () =>
      overlayLocked && calibration?.yAxisSamples.length
        ? calibration.yAxisSamples.map((sample) => sample.value)
        : warpY
          ? warpY.dataKnots
          : calibration?.yAxisSamples.length
          ? calibration.yAxisSamples.map((sample) => sample.value)
          : calibration?.yTicks.length
          ? calibration.yTicks
          : niceTicks(view.domainY[0], view.domainY[1], 6),
    [calibration, overlayLocked, warpY, view.domainY]
  );

  const commitResultJson = (nextResultJson: any) => {
    if (!onResultJsonChange) return;
    onResultJsonChange(nextResultJson);
  };

  const setPanelsAndEmit = (updater: (prev: Panel[]) => Panel[]) => {
    setPanels((prev) => {
      const updated = updater(prev);
      if (updated === prev) return prev;

      const next = stripCurvePreview(updated);
      const nextResultJson = buildNextResultJson(resultJson, next);
      commitResultJson(nextResultJson);
      requestServerPreview(next);
      return next;
    });
  };

  const setEditableHighlightPanelsAndEmit = (updater: (prev: Panel[]) => Panel[]) => {
    setEditableHighlightPanels((prev) => {
      const updated = updater(prev);
      if (updated === prev) return prev;

      const nextResultJson = buildNextAutoSplineResultJson(resultJson, highlightResultJson, updated);
      commitResultJson(nextResultJson);
      return updated;
    });
  };

  const selectNameToAssign = (name: string) => {
    const nextName = name.trim().slice(0, MAX_SERIES_NAME);
    if (!nextName) return;

    setErr(null);
    setPendingAssignName(nextName);
    setMode("select");
    setPanMode(false);
    setGridDragAxis(null);
    setHover(null);
    setSelection(null);
    deleteSelectionDragRef.current = null;
    setDeleteSelectionBox(null);
  };

  const cancelAssignMode = () => {
    setPendingAssignName(null);
  };

  const addCustomName = () => {
    const nextName = newNameInput.trim().slice(0, MAX_SERIES_NAME);
    setNewNameInput("");
    if (!nextName) return;

    setCustomNames((prev) => (prev.includes(nextName) ? prev : [...prev, nextName]));
  };

  const removeCustomName = (name: string) => {
    setCustomNames((prev) => prev.filter((item) => item !== name));
    if (pendingAssignName === name) {
      setPendingAssignName(null);
    }
  };

  const applyPendingNameToSeries = (seriesId: string) => {
    const nextName = pendingAssignName?.trim().slice(0, MAX_SERIES_NAME) ?? "";
    if (!nextName) return false;

    const target = seriesList.find((series) => series.id === seriesId);
    if (!target) return false;

    setErr(null);
    setPendingAssignName(null);
    setActiveSeriesId(seriesId);
    setVisibleIds((prev) => {
      if (prev.has(seriesId)) return prev;
      const next = new Set(prev);
      next.add(seriesId);
      return next;
    });

    if (target.name === nextName) {
      return true;
    }

    setPanelsAndEmit((prev) => {
      const next = structuredClone(prev) as Panel[];
      const p0 = next[0] ?? { series: [] };
      next[0] = p0;
      const series = p0.series.find((item) => item.id === seriesId);
      if (!series) return prev;
      const before = series.name;
      if (before === nextName) return prev;
      series.name = nextName;
      pushUndo({ type: "rename-series", seriesId, before, after: nextName });
      return next;
    });

    return true;
  };

  const onAuto = () => {
    if (calibration) {
      const before = view;
      const after: View = {
        domainX: [...calibration.xDomain] as [number, number],
        domainY: [...calibration.yDomain] as [number, number],
      };
      setView(after);
      pushUndo({ type: "set-domain", before, after });
      return;
    }

    const all = seriesList.flatMap((s) => s.points);
    if (!all.length) return;

    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const padX = (x1 - x0 || 1) * 0.05;
    const padY = (y1 - y0 || 1) * 0.05;

    const before = view;
    const after: View = { domainX: [x0 - padX, x1 + padX], domainY: [y0 - padY, y1 + padY] };
    setView(after);
    pushUndo({ type: "set-domain", before, after });
  };

  const deletePointAt = (seriesId: string, index: number) => {
    setPanelsAndEmit((prev) => {
      const next = structuredClone(prev) as Panel[];
      const p0 = next[0] ?? { series: [] };
      next[0] = p0;

      const s = p0.series.find((x) => x.id === seriesId);
      if (!s || !s.points[index]) return prev;

      const removed = s.points.splice(index, 1)[0];
      pushUndo({ type: "delete-point", seriesId, index, point: structuredClone(removed) });
      return next;
    });

    setSelection((sel) => {
      if (!sel) return sel;
      if (sel.seriesId !== seriesId) return sel;
      if (sel.index === index) return null;
      if (sel.index > index) return { seriesId, index: sel.index - 1 };
      return sel;
    });

    setHover(null);
  };

  const deleteSelectedPoint = () => {
    if (!selection) return;
    deletePointAt(selection.seriesId, selection.index);
  };

  const deleteManyPoints = (entries: DeletePointEntry[]) => {
    if (!entries.length) return;

    const normalizedEntries = entries
      .map((entry) => ({
        seriesId: entry.seriesId,
        index: entry.index,
        point: { ...entry.point },
      }))
      .sort((a, b) =>
        a.seriesId === b.seriesId ? a.index - b.index : a.seriesId.localeCompare(b.seriesId)
      );

    setPanelsAndEmit((prev) => {
      const next = structuredClone(prev) as Panel[];
      const p0 = next[0] ?? { series: [] };
      next[0] = p0;

      const bySeries = new Map<string, DeletePointEntry[]>();
      for (const entry of normalizedEntries) {
        const bucket = bySeries.get(entry.seriesId);
        if (bucket) bucket.push(entry);
        else bySeries.set(entry.seriesId, [entry]);
      }

      let changed = false;
      for (const [seriesId, bucket] of bySeries.entries()) {
        const series = p0.series.find((item) => item.id === seriesId);
        if (!series) continue;

        const descending = bucket.slice().sort((a, b) => b.index - a.index);
        for (const entry of descending) {
          if (!series.points[entry.index]) continue;
          series.points.splice(entry.index, 1);
          changed = true;
        }
      }

      if (!changed) return prev;
      pushUndo({ type: "delete-many-points", points: normalizedEntries.map((entry) => ({ ...entry, point: { ...entry.point } })) });
      return next;
    });

    setSelection(null);
    setHover(null);
  };

  const insertPointAtPixels = (px: number, py: number) => {
    if (!activeSeries) {
      setErr("Сначала выберите или создайте кривую");
      return;
    }

    const xPx = clamp(px, layout.l, layout.l + layout.pw);
    const yPx = clamp(py, layout.t, layout.t + layout.ph);
    const point: Point = { x: scale.invX(xPx), y: scale.invY(yPx) };
    let insertedIndex = 0;

    setPanelsAndEmit((prev) => {
      const next = structuredClone(prev) as Panel[];
      const p0 = next[0] ?? { series: [] };
      next[0] = p0;

      const s = p0.series.find((series) => series.id === activeSeries.id);
      if (!s) return prev;

      let idx = s.points.length;
      for (let i = 0; i < s.points.length; i++) {
        if (point.x < s.points[i].x) {
          idx = i;
          break;
        }
      }

      insertedIndex = idx;
      s.points.splice(idx, 0, point);
      pushUndo({ type: "add-point", seriesId: s.id, index: idx, point: structuredClone(point) });
      return next;
    });

    setSelection({ seriesId: activeSeries.id, index: insertedIndex });
    setErr(null);
  };

  const onUndo = () => {
    const p = undo[0];
    if (!p) return;

    setErr(null);
    setUndo((u) => u.slice(1));

    setPanelsAndEmit((prev) => {
      const next = structuredClone(prev) as Panel[];
      const p0 = next[0] ?? { series: [] };
      next[0] = p0;

      const findSeries = (sid: string) => p0.series.find((s) => s.id === sid);

      switch (p.type) {
        case "move-point": {
          const s = findSeries(p.seriesId);
          if (!s || !s.points[p.index]) return prev;
          s.points[p.index] = { ...p.before };
          return next;
        }
        case "add-point": {
          const s = findSeries(p.seriesId);
          if (!s) return prev;
          s.points.splice(p.index, 1);
          return next;
        }
        case "delete-point": {
          const s = findSeries(p.seriesId);
          if (!s) return prev;
          s.points.splice(p.index, 0, { ...p.point });
          return next;
        }
        case "delete-many-points": {
          const grouped = new Map<string, DeletePointEntry[]>();
          for (const entry of p.points) {
            const bucket = grouped.get(entry.seriesId);
            if (bucket) bucket.push(entry);
            else grouped.set(entry.seriesId, [entry]);
          }

          for (const [seriesId, bucket] of grouped.entries()) {
            const s = findSeries(seriesId);
            if (!s) continue;
            const ascending = bucket.slice().sort((a, b) => a.index - b.index);
            for (const entry of ascending) {
              s.points.splice(entry.index, 0, { ...entry.point });
            }
          }
          return next;
        }
        case "add-series": {
          p0.series.splice(p.index, 1);
          return next;
        }
        case "delete-series": {
          p0.series.splice(p.index, 0, structuredClone(p.series));
          return next;
        }
        case "rename-series": {
          const s = findSeries(p.seriesId);
          if (!s) return prev;
          s.name = p.before;
          return next;
        }
        case "set-domain": {
          setView(p.before);
          return prev;
        }
        case "set-warp": {
          if (p.axis === "x") setWarpX(p.before ? structuredClone(p.before) : null);
          else setWarpY(p.before ? structuredClone(p.before) : null);
          return prev;
        }
        default:
          return prev;
      }
    });
  };

  // hotkeys
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();

      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        onUndo();
        return;
      }

      if (e.key === "Escape") {
        setMode("select");
        setGridDragAxis(null);
        setPanMode(false);
        setPendingAssignName(null);
        deleteSelectionDragRef.current = null;
        setDeleteSelectionBox(null);
        setHover(null);
        setVisOpen(false);
        return;
      }

      if (!compactMode && (e.key === "Delete" || e.key === "Backspace")) {
        if (!selection) return;
        e.preventDefault();
        deleteSelectedPoint();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactMode, selection, undo.length]);

  const addSeries = () => {
    const s: Series = {
      id: uid("series"),
      name: `Кривая ${seriesList.length + 1}`,
      points: [],
      curvePoints: [],
    };

    setPanelsAndEmit((prev) => {
      const next = structuredClone(prev) as Panel[];
      const p0 = next[0] ?? { series: [] };
      next[0] = p0;
      const idx = p0.series.length;
      p0.series.push(s);
      pushUndo({ type: "add-series", index: idx, series: structuredClone(s) });
      return next;
    });

  setActiveSeriesId(s.id);
  setSelection(null);
  };

  const deleteSeriesById = (seriesId: string) => {
    const series = seriesList.find((item) => item.id === seriesId);
    if (!series) return;
    if (!window.confirm(`Удалить кривую "${series.name}"?`)) return;

    const removedId = series.id;

    setPanelsAndEmit((prev) => {
      const next = structuredClone(prev) as Panel[];
      const p0 = next[0] ?? { series: [] };
      next[0] = p0;

      const idx = p0.series.findIndex((item) => item.id === removedId);
      if (idx < 0) return prev;

      const removed = p0.series.splice(idx, 1)[0];
      pushUndo({ type: "delete-series", index: idx, series: structuredClone(removed) });
      return next;
    });

    setSelection((current) => (current?.seriesId === removedId ? null : current));
    setActiveSeriesId((current) => (current === removedId ? null : current));
    setHover(null);
  };

  const deleteActiveSeries = () => {
    if (!activeSeries) return;
    if (!window.confirm(`Удалить кривую "${activeSeries.name}"?`)) return;

    const removedId = activeSeries.id;

    setPanelsAndEmit((prev) => {
      const next = structuredClone(prev) as Panel[];
      const p0 = next[0] ?? { series: [] };
      next[0] = p0;

      const idx = p0.series.findIndex((s) => s.id === removedId);
      if (idx < 0) return prev;

      const removed = p0.series.splice(idx, 1)[0];
      pushUndo({ type: "delete-series", index: idx, series: structuredClone(removed) });
      return next;
    });

    setSelection(null);
    setActiveSeriesId(null);
    setHover(null);
  };

  const invXFrom = (v: View, w: AxisWarp | null, px: number) => {
    const s = (clamp(px, layout.l, layout.l + layout.pw) - layout.l) / (layout.pw || 1);
    return axisScreenToValue(s, v.domainX, w);
  };

  const invYFrom = (v: View, w: AxisWarp | null, py: number) => {
    const s = (layout.t + layout.ph - clamp(py, layout.t, layout.t + layout.ph)) / (layout.ph || 1);
    return axisScreenToValue(s, v.domainY, w);
  };

  const collectPointsInSelectionBox = (box: DeleteSelectionBox) => {
    const rect = normalizeSelectionBox(box);
    const entries: DeletePointEntry[] = [];

    for (const series of seriesList) {
      if (!visibleIds.has(series.id)) continue;
      for (let index = 0; index < series.points.length; index += 1) {
        const point = series.points[index];
        const cx = scale.mapX(point.x);
        const cy = scale.mapY(point.y);
        if (cx < rect.x || cx > rect.x + rect.w || cy < rect.y || cy > rect.y + rect.h) continue;
        entries.push({ seriesId: series.id, index, point: { ...point } });
      }
    }

    return entries;
  };

  const startPanFromEvent = (e: React.PointerEvent) => {
    const el = svgRef.current;
    if (!el) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const startView = viewRef.current;
    const startWarpX = warpX ? structuredClone(warpX) : null;
    const startWarpY = warpY ? structuredClone(warpY) : null;

    panRef.current = {
      pointerId: e.pointerId,
      startView,
      startWarpX,
      startWarpY,
      startX: invXFrom(startView, startWarpX, px),
      startY: invYFrom(startView, startWarpY, py),
    };

    el.setPointerCapture?.(e.pointerId);
  };

  const onTickPointerDown = (e: React.PointerEvent, axis: "x" | "y", index: number) => {
    if (gridDragAxis !== axis) return;

    const warp = axis === "x" ? warpX : warpY;
    if (!warp) return;
    if (index <= 0 || index >= warp.screenKnots.length - 1) return;

    e.preventDefault();
    e.stopPropagation();

    tickDragRef.current = { axis, index, before: structuredClone(warp), pointerId: e.pointerId };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const applyTickDrag = (axis: "x" | "y", index: number, s: number) => {
    if (axis === "x") {
      setWarpX((w) => {
        if (!w) return w;
        const sk = w.screenKnots.slice();
        const gap = Math.max(0.01, 10 / (layout.pw || 1));
        const lo = sk[index - 1] + gap;
        const hi = sk[index + 1] - gap;
        sk[index] = clamp(s, lo, hi);
        return normalizeWarp({ dataKnots: w.dataKnots, screenKnots: sk });
      });
    } else {
      setWarpY((w) => {
        if (!w) return w;
        const sk = w.screenKnots.slice();
        const gap = Math.max(0.01, 10 / (layout.ph || 1));
        const lo = sk[index - 1] + gap;
        const hi = sk[index + 1] - gap;
        sk[index] = clamp(s, lo, hi);
        return normalizeWarp({ dataKnots: w.dataKnots, screenKnots: sk });
      });
    }
  };

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pendingAssignName) return;

    if (gridDragAxis) return;

    if (panMode) {
      startPanFromEvent(e);
      return;
    }

    if (mode !== "delete-point" || e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    const startRect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX - startRect.left;
    const startY = e.clientY - startRect.top;

    deleteSelectionDragRef.current = {
      pointerId: e.pointerId,
      startX,
      startY,
    };
    setDeleteSelectionBox({ startX, startY, endX: startX, endY: startY });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    return;

    if (!activeSeries) {
      setErr("Сначала выберите или создайте кривую");
      return;
    }

    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const xPx = clamp(px, layout.l, layout.l + layout.pw);
    const yPx = clamp(py, layout.t, layout.t + layout.ph);

    const x = scale.invX(xPx);
    const y = scale.invY(yPx);

    const point: Point = { x, y };
    let insertedIndex = 0;

    setPanelsAndEmit((prev) => {
      const next = structuredClone(prev) as Panel[];
      const p0 = next[0] ?? { series: [] };
      next[0] = p0;

      const s = p0.series.find((x) => x.id === activeSeries!.id);
      if (!s) return prev;

      let idx = s.points.length;
      for (let i = 0; i < s.points.length; i++) {
        if (point.x < s.points[i].x) {
          idx = i;
          break;
        }
      }

      insertedIndex = idx;
      s.points.splice(idx, 0, point);
      pushUndo({ type: "add-point", seriesId: s.id, index: idx, point: structuredClone(point) });
      return next;
    });

    setSelection({ seriesId: activeSeries!.id, index: insertedIndex });
  };

  const onSvgDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (mode === "delete-point" || gridDragAxis || panMode || pendingAssignName) return;
    if (e.target instanceof SVGCircleElement) return;

    const rect = e.currentTarget.getBoundingClientRect();
    insertPointAtPixels(e.clientX - rect.left, e.clientY - rect.top);
  };

  const onPointDoubleClick = (
    e: React.MouseEvent<SVGCircleElement>,
    seriesId: string,
    index: number
  ) => {
    if (mode !== "delete-point") return;
    e.preventDefault();
    e.stopPropagation();
    setErr(null);
    deletePointAt(seriesId, index);
  };

  const onHandlePointerDown = (e: React.PointerEvent, seriesId: string, index: number) => {
    if (applyPendingNameToSeries(seriesId)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (gridDragAxis) return;

    if (panMode) {
      startPanFromEvent(e);
      return;
    }

    if (mode === "delete-point") {
      e.preventDefault();
      e.stopPropagation();
      setErr(null);
      setSelection({ seriesId, index });
      setActiveSeriesId(seriesId);
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    setErr(null);
    setMode("select");
    setSelection({ seriesId, index });
    setActiveSeriesId(seriesId);

    const s = seriesList.find((x) => x.id === seriesId);
    const pt = s?.points?.[index];
    if (!pt) return;

    pointDragRef.current = { seriesId, index, before: { ...pt }, pointerId: e.pointerId };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onAutoSplinePointPointerDown = (
    e: React.PointerEvent,
    panelIndex: number,
    seriesId: string,
    index: number
  ) => {
    if (!showOnlyHighlightPoints || pendingAssignName || gridDragAxis || panMode || mode === "delete-point") return;

    const panel = editableHighlightPanels[panelIndex];
    const series = panel?.series.find((item) => item.id === seriesId);
    const point = series?.points[index];
    if (!point) return;

    e.preventDefault();
    e.stopPropagation();
    setErr(null);
    autoSplinePointDragRef.current = { panelIndex, seriesId, index, before: { ...point }, pointerId: e.pointerId };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onPathPointerDown = (e: React.PointerEvent<SVGPathElement>, seriesId: string) => {
    if (!applyPendingNameToSeries(seriesId)) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (deleteSelectionDragRef.current) {
      const drag = deleteSelectionDragRef.current;
      if (e.pointerId !== drag.pointerId) return;

      const rect = e.currentTarget.getBoundingClientRect();
      setDeleteSelectionBox({
        startX: drag.startX,
        startY: drag.startY,
        endX: e.clientX - rect.left,
        endY: e.clientY - rect.top,
      });
      return;
    }

    // tick drag
    if (tickDragRef.current) {
      const t = tickDragRef.current;
      if (e.pointerId !== t.pointerId) return;

      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      if (t.axis === "x") {
        const s = (clamp(px, layout.l, layout.l + layout.pw) - layout.l) / (layout.pw || 1);
        applyTickDrag("x", t.index, clamp(s, 0, 1));
      } else {
        const s =
          (layout.t + layout.ph - clamp(py, layout.t, layout.t + layout.ph)) / (layout.ph || 1);
        applyTickDrag("y", t.index, clamp(s, 0, 1));
      }
      return;
    }

    // pan
    if (panRef.current) {
      const p = panRef.current;
      if (e.pointerId !== p.pointerId) return;

      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const curX = invXFrom(p.startView, p.startWarpX, px);
      const curY = invYFrom(p.startView, p.startWarpY, py);

      const dx = p.startX - curX;
      const dy = p.startY - curY;

      setView({
        domainX: [p.startView.domainX[0] + dx, p.startView.domainX[1] + dx],
        domainY: [p.startView.domainY[0] + dy, p.startView.domainY[1] + dy],
      });

      return;
    }

    if (autoSplinePointDragRef.current) {
      const d = autoSplinePointDragRef.current;
      if (e.pointerId !== d.pointerId) return;

      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const x = scale.invX(clamp(px, layout.l, layout.l + layout.pw));
      const y = scale.invY(clamp(py, layout.t, layout.t + layout.ph));

      setEditableHighlightPanelsAndEmit((prev) => {
        const next = structuredClone(prev) as Panel[];
        const panel = next[d.panelIndex];
        const series = panel?.series.find((item) => item.id === d.seriesId);
        if (!series || !series.points[d.index]) return prev;

        series.points[d.index] = { x, y };
        series.curvePoints = sampleCubicSpline(series.points);
        return next;
      });

      const seriesName = editableHighlightPanels[d.panelIndex]?.series.find((item) => item.id === d.seriesId)?.name ?? "Сплайн";
      setHover({ cx: scale.mapX(x), cy: scale.mapY(y), x, y, seriesName });
      return;
    }

    // point drag + tooltip
    if (pointDragRef.current) {
      const d = pointDragRef.current;
      if (e.pointerId !== d.pointerId) return;

      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const xPx = clamp(px, layout.l, layout.l + layout.pw);
      const yPx = clamp(py, layout.t, layout.t + layout.ph);

      const x = scale.invX(xPx);
      const y = scale.invY(yPx);

      setPanelsAndEmit((prev) => {
        const next = structuredClone(prev) as Panel[];
        const p0 = next[0] ?? { series: [] };
        next[0] = p0;

        const s = p0.series.find((x) => x.id === d.seriesId);
        if (!s || !s.points[d.index]) return prev;

        s.points[d.index] = { x, y };
        return next;
      });

      const seriesName = seriesList.find((s) => s.id === d.seriesId)?.name ?? "Кривая";
      setHover({ cx: scale.mapX(x), cy: scale.mapY(y), x, y, seriesName });
      return;
    }
  };

  const onSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (deleteSelectionDragRef.current) {
      const drag = deleteSelectionDragRef.current;
      if (e.pointerId !== drag.pointerId) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const nextBox: DeleteSelectionBox = {
        startX: drag.startX,
        startY: drag.startY,
        endX: e.clientX - rect.left,
        endY: e.clientY - rect.top,
      };

      deleteSelectionDragRef.current = null;
      setDeleteSelectionBox(null);

      const normalized = normalizeSelectionBox(nextBox);
      if (normalized.w >= 4 || normalized.h >= 4) {
        deleteManyPoints(collectPointsInSelectionBox(nextBox));
      }

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    // finish tick drag
    if (tickDragRef.current) {
      const t = tickDragRef.current;
      if (e.pointerId !== t.pointerId) return;

      tickDragRef.current = null;

      const after = t.axis === "x" ? warpX : warpY;
      if (!after) return;

      const before = t.before;
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        pushUndo({ type: "set-warp", axis: t.axis, before, after: structuredClone(after) });
      }
      return;
    }

    // finish pan
    if (panRef.current) {
      const p = panRef.current;
      if (e.pointerId !== p.pointerId) return;

      panRef.current = null;

      const before = p.startView;
      const after = viewRef.current;
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        pushUndo({ type: "set-domain", before, after });
      }
      return;
    }

    // finish point drag
    if (autoSplinePointDragRef.current) {
      const d = autoSplinePointDragRef.current;
      if (e.pointerId !== d.pointerId) return;

      autoSplinePointDragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setHover(null);
      return;
    }

    if (pointDragRef.current) {
      const d = pointDragRef.current;
      if (e.pointerId !== d.pointerId) return;

      pointDragRef.current = null;

      const s = seriesList.find((x) => x.id === d.seriesId);
      const after = s?.points?.[d.index];
      if (!after) return;

      const moved =
        Math.abs(after.x - d.before.x) > 1e-12 || Math.abs(after.y - d.before.y) > 1e-12;
      if (moved) {
        pushUndo({
          type: "move-point",
          seriesId: d.seriesId,
          index: d.index,
          before: d.before,
          after: { ...after },
        });
      }

      setHover(null);
    }
  };

  const paths = useMemo(() => {
    const mkPath = (pts: Point[]) => {
      if (!pts.length) return "";
      return `M ${pts.map((p) => `${scale.mapX(p.x)} ${scale.mapY(p.y)}`).join(" L ")}`;
    };

    return seriesList
      .map((s) => {
        if (!visibleIds.has(s.id)) return null;

        const pts = s.points.slice().sort((a, b) => a.x - b.x);

        const drawPts = s.curvePoints.length ? s.curvePoints : pts;
        return { id: s.id, d: mkPath(drawPts) };
      })
      .filter(Boolean) as { id: string; d: string }[];
  }, [seriesList, scale, visibleIds]);

  const highlightPaths = useMemo(() => {
    const mkPath = (pts: Point[]) => {
      if (!pts.length) return "";
      return `M ${pts.map((p) => `${scale.mapX(p.x)} ${scale.mapY(p.y)}`).join(" L ")}`;
    };

    return highlightSeriesList
      .map((series) => {
        const drawPts = series.curvePoints.length ? series.curvePoints : sampleCubicSpline(series.points);
        const d = mkPath(drawPts);
        return d ? { id: series.id, d } : null;
      })
      .filter(Boolean) as { id: string; d: string }[];
  }, [highlightSeriesList, scale]);

  const highlightPoints = useMemo(() => {
    return editableHighlightPanels.flatMap((panel, panelIndex) => panel.series.flatMap((series) => {
      const rawId = series.id.replace(/_spline$/i, "");
      const rawName = series.name.replace(/_spline$/i, "");
      const baseSeries = seriesList.find((item) => item.id === series.id || item.name === series.name || item.id === rawId || item.name === rawName);
      const seriesName = series.name || baseSeries?.name || rawName || series.id;

      return series.points.map((point, index) => ({
        key: `${series.id}_${index}_${point.x}_${point.y}`,
        panelIndex,
        seriesId: series.id,
        index,
        cx: scale.mapX(point.x),
        cy: scale.mapY(point.y),
        x: point.x,
        y: point.y,
        seriesName,
      }));
    }));
  }, [editableHighlightPanels, scale, seriesList]);

  const hint = compactMode
    ? ""
    : pendingAssignName
      ? `Режим: выбрано имя \"${pendingAssignName}\". Кликни по линии или точке, чтобы назначить его.`
    : mode === "delete-point"
      ? "Режим: двойной клик по точке или выделение рамкой для удаления"
      : "Двойной клик: добавить точку";

  const clipId = useMemo(() => uid("plotClip"), []);

  const toggleVisible = (id: string) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (seriesList.length && next.size === 0) next.add(id);
      return next;
    });
  };

  const showAll = () => setVisibleIds(new Set(seriesList.map((s) => s.id)));
  const showOnlyActive = () => {
    if (!activeSeriesId) return;
    setVisibleIds(new Set([activeSeriesId]));
  };

  const setSeriesColor = (id: string, idx: number) => {
    setColorById((prev) => ({ ...prev, [id]: clamp(idx, 0, COLOR_OPTIONS.length - 1) }));
  };

  const cycleSeriesColor = (id: string) => {
    setColorById((prev) => {
      const cur = prev[id] ?? 0;
      const nextIdx = (cur + 1) % COLOR_OPTIONS.length;
      return { ...prev, [id]: nextIdx };
    });
  };

  return (
    <div className="space-y-4">
      {err && (
        <Alert variant="danger" title="Ошибка">
          {err}
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!compactMode && (
          <Button variant="secondary" type="button" onClick={onAuto} disabled={gridDragAxis !== null || panMode}>
            Авто
          </Button>
        )}

        <Button
          variant="secondary"
          type="button"
          onClick={onUndo}
          disabled={undo.length === 0}
          title={undo.length === 0 ? "Нет действий для отмены" : ""}
        >
          Отменить
        </Button>

        {!compactMode && (
          <Button
            variant="secondary"
            type="button"
            disabled={Math.abs(editorWidthScale - 1) < 1e-6 && Math.abs(editorHeightScale - 1) < 1e-6}
            onClick={() => {
              setEditorWidthScale(1);
              setEditorHeightScale(1);
            }}
          >
            Сбросить размер редактора
          </Button>
        )}

        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            setErr(null);
            setPanMode(false);
            setGridDragAxis(null);
            setHover(null);
            setSelection(null);
            setPendingAssignName(null);
            deleteSelectionDragRef.current = null;
            setDeleteSelectionBox(null);
            setMode((m) => (m === "delete-point" ? "select" : "delete-point"));
          }}
          disabled={gridDragAxis !== null || panMode}
          title="Режим удаления: двойной клик по точке или выделение рамкой удаляет точки"
          className={
            mode === "delete-point"
              ? "border-blue-400 bg-blue-100 text-blue-900 hover:bg-blue-200 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-200 dark:hover:bg-blue-900/70"
              : undefined
          }
        >
          Удалить точки
        </Button>

        <Button variant="secondary" type="button" onClick={addSeries}>
          Добавить кривую
        </Button>

        <div className="rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 via-white to-indigo-50 px-4 py-2.5 text-sm font-semibold text-sky-900 shadow-sm ring-1 ring-sky-100 dark:border-sky-900/50 dark:from-sky-950/40 dark:via-slate-950 dark:to-indigo-950/30 dark:text-sky-100 dark:ring-sky-900/30">
          Кубический сплайн
        </div>

        {!compactMode && (
          <Button variant="secondary" type="button" onClick={() => setShowSidebar((value) => !value)}>
            {showSidebar ? "Скрыть меню" : "Показать меню"}
          </Button>
        )}

        {/* dropdown: show/hide curves */}
        <div className="relative" ref={visRef}>
          <Button
            variant="secondary"
            type="button"
            onClick={() => setVisOpen((v) => !v)}
            disabled={seriesList.length === 0}
          >
            Кривые ({visibleIds.size}/{seriesList.length})
          </Button>

          {visOpen && (
            <div className="absolute left-0 z-30 mt-2 w-80 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Быстрый выбор
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                    onClick={showAll}
                  >
                    Все
                  </button>
                  <button
                    type="button"
                    className="rounded-lg ring-1 ring-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100
                               dark:bg-slate-800/60 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800"
                    onClick={showOnlyActive}
                    disabled={!activeSeriesId}
                  >
                    Только активную
                  </button>
                </div>
              </div>

              <div className="max-h-72 overflow-auto py-1">
                {seriesList.map((s) => {
                  const checked = visibleIds.has(s.id);
                  const cIdx = colorById[s.id] ?? 0;
                  const col = COLOR_OPTIONS[cIdx];
                  const active = s.id === activeSeriesId;

                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 ${
                        active
                          ? "bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-800/80 dark:ring-slate-700"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={checked}
                        onChange={() => toggleVisible(s.id)}
                      />

                      <button
                        type="button"
                        className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                        title="Клик: сменить цвет"
                        onClick={() => cycleSeriesColor(s.id)}
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                        <span className="text-xs text-slate-500 dark:text-slate-400">цвет</span>
                      </button>

                      <div className="min-w-0 flex-1 text-sm text-slate-800 dark:text-slate-200">
                        {ellipsis(s.name, 34)}
                      </div>

                      {active && (
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          активна
                        </span>
                      )}

                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold text-red-500 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                        title={`Удалить кривую "${s.name}"`}
                        onClick={() =>
                          active ? deleteActiveSeries() : deleteSeriesById(s.id)
                        }
                      >
                        x
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className={`${compactMode ? "" : "ml-auto "}flex flex-wrap items-center gap-2`}>
          <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800">
            <div className="text-xs text-slate-600 dark:text-slate-300">Точки</div>
            <input
              type="range"
              min={3}
              max={10}
              step={1}
              value={pointRadius}
              onChange={(e) => setPointRadius(Number(e.target.value))}
              className="w-28"
            />
            <div className="text-xs text-slate-500 dark:text-slate-400">{pointRadius}px</div>
          </div>

          {/* Color select for active series */}
          {activeSeries && (
            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800">
              <span className="text-xs text-slate-600 dark:text-slate-300">Цвет</span>
              <span
                className={`h-2.5 w-2.5 rounded-full ${COLOR_OPTIONS[colorById[activeSeries.id] ?? 0].dot}`}
              />
              <select
                className="h-8 rounded-lg bg-white px-2 text-sm ring-1 ring-slate-200 outline-none dark:bg-slate-950 dark:ring-slate-800"
                value={colorById[activeSeries.id] ?? 0}
                onChange={(e) => setSeriesColor(activeSeries.id, Number(e.target.value))}
              >
                {COLOR_OPTIONS.map((c, i) => (
                  <option key={c.id} value={i}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <input
            className="h-10 w-56 rounded-xl bg-white px-3 text-sm ring-1 ring-slate-200 outline-none transition
                       focus:ring-2 focus:ring-slate-400 disabled:opacity-50
                       dark:bg-slate-950 dark:ring-slate-800"
            placeholder="Название кривой"
            value={activeSeries?.name ?? ""}
            maxLength={MAX_SERIES_NAME}
            disabled={!activeSeries}
            onFocus={() => {
              nameBeforeRef.current = activeSeries?.name ?? "";
            }}
            onBlur={() => {
              if (!activeSeries) return;
              const before = nameBeforeRef.current ?? "";
              const after = activeSeries.name;
              nameBeforeRef.current = null;
              if (before !== after) {
                pushUndo({ type: "rename-series", seriesId: activeSeries.id, before, after });
              }
            }}
            onChange={(e) => {
              const name = e.target.value.slice(0, MAX_SERIES_NAME);
              if (!activeSeries) return;

              setPanelsAndEmit((prev) => {
                const next = structuredClone(prev) as Panel[];
                const p0 = next[0] ?? { series: [] };
                next[0] = p0;
                const s = p0.series.find((x) => x.id === activeSeries.id);
                if (!s) return prev;
                s.name = name;
                return next;
              });
            }}
          />

          <select
            className="h-10 rounded-xl bg-white px-3 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-slate-400
                       dark:bg-slate-950 dark:ring-slate-800"
            value={activeSeriesId ?? ""}
            onChange={(e) => {
              setActiveSeriesId(e.target.value || null);
              setSelection(null);
              setHover(null);
            }}
          >
            {seriesList.length === 0 ? (
              <option value="">Нет кривых</option>
            ) : (
              seriesList.map((s) => (
                <option key={s.id} value={s.id} title={s.name}>
                  {ellipsis(s.name, MAX_SERIES_LABEL)}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      <div className={compactMode ? "w-full overflow-auto" : "flex flex-col gap-4 md:flex-row md:items-start"}>
        {!compactMode && showSidebar && (
          <aside className="w-full shrink-0 rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 md:w-72">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Имена кривых</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Выбери имя, затем кликни по линии или точке
                </div>
              </div>
              {pendingAssignName && (
                <button
                  type="button"
                  onClick={cancelAssignMode}
                  className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Отмена
                </button>
              )}
            </div>

            {pendingAssignName && (
              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-300">
                Активно имя: <span className="font-semibold">{pendingAssignName}</span>
              </div>
            )}

            <div className="mt-4 space-y-2">
              {availableNames.map((name) => (
                <div key={name} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => selectNameToAssign(name)}
                    className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-left text-sm transition ${
                      pendingAssignName === name
                        ? "border-sky-500 bg-sky-50 font-medium text-sky-700 dark:border-sky-500 dark:bg-sky-950/30 dark:text-sky-300"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="block truncate">{name}</span>
                  </button>

                  {customNameSet.has(name) && (
                    <button
                      type="button"
                      onClick={() => removeCustomName(name)}
                      title={`Убрать имя \"${name}\" из списка`}
                      className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold text-rose-500 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}

              {availableNames.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Имена пока не найдены. Добавь своё ниже.
                </div>
              )}
            </div>

            <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Добавить имя
              </div>
              <input
                className="h-10 w-full rounded-xl bg-white px-3 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-slate-400 dark:bg-slate-950 dark:ring-slate-800"
                placeholder="Новое имя"
                value={newNameInput}
                maxLength={MAX_SERIES_NAME}
                onChange={(e) => setNewNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomName();
                  }
                }}
              />
              <button
                type="button"
                onClick={addCustomName}
                className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                Добавить в список
              </button>
            </div>
          </aside>
        )}

        <div ref={editorViewportRef} className="w-full overflow-auto">
          <div
            className="relative mx-auto overflow-auto rounded-2xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
            style={{ width: visibleWindowWidth, height: windowBox.h }}
          >
            <div className="relative isolate" style={{ width: contentBox.w, height: contentBox.h }}>
            {showBackdrop && backdropImageUrl && backdropFrame ? (
              <div
                className="pointer-events-none absolute overflow-hidden"
                style={
                  fittedImageBox || overlayLocked
                    ? {
                        left: 0,
                        top: 0,
                        width: contentBox.w,
                        height: contentBox.h,
                        opacity: 0.14,
                        zIndex: 0,
                      }
                    : {
                        left: layout.l,
                        top: layout.t,
                        width: layout.pw,
                        height: layout.ph,
                        opacity: 0.1,
                        zIndex: 0,
                      }
                }
              >
                <img
                  src={backdropImageUrl}
                  alt=""
                  draggable={false}
                  className="absolute select-none"
                  style={
                    fittedImageBox || overlayLocked
                      ? {
                          left: backdropFrame.x,
                          top: backdropFrame.y,
                          width: backdropFrame.width,
                          height: backdropFrame.height,
                        }
                      : {
                          left: backdropFrame.x - layout.l,
                          top: backdropFrame.y - layout.t,
                          width: backdropFrame.width,
                          height: backdropFrame.height,
                        }
                  }
                />
              </div>
            ) : null}

            {hover && (
              <div
                className="pointer-events-none absolute z-20 rounded-xl bg-slate-900 px-3 py-2 text-xs text-white shadow-sm"
                style={{ left: hover.cx + 12, top: hover.cy - 8 }}
              >
                <div className="font-semibold opacity-90">{hover.seriesName}</div>
                <div className="mt-1 opacity-90">
                  x: {formatTick(hover.x)} &nbsp; y: {formatTick(hover.y)}
                </div>
              </div>
            )}

            <svg
              ref={svgRef}
              className="block touch-none"
              width={contentBox.w}
              height={contentBox.h}
              preserveAspectRatio="none"
              style={{ cursor: panMode ? "grab" : pendingAssignName ? "crosshair" : mode === "delete-point" ? "crosshair" : "default" }}
              onPointerDown={onSvgPointerDown}
              onDoubleClick={onSvgDoubleClick}
              onPointerMove={onSvgPointerMove}
              onPointerUp={onSvgPointerUp}
              onPointerCancel={onSvgPointerUp}
            >
              <defs>
              <clipPath id={clipId}>
                <rect x={layout.l} y={layout.t} width={layout.pw} height={layout.ph} />
              </clipPath>
            </defs>

            <rect
              x={layout.l}
              y={layout.t}
              width={layout.pw}
              height={layout.ph}
              className={showBackdrop ? "fill-transparent" : "fill-slate-50 dark:fill-slate-950"}
            />

          {ticksX.map((t, i) => {
            const x = scale.mapX(t);
            const isEdge = i === 0 || i === ticksX.length - 1;
            const editable = gridDragAxis === "x" && !!warpX && !isEdge;

            return (
              <g key={`gx_${i}`}>
                <line
                  x1={x}
                  y1={layout.t}
                  x2={x}
                  y2={layout.t + layout.ph}
                  className={
                    editable
                      ? "stroke-blue-400/70 dark:stroke-blue-400/70"
                      : "stroke-slate-200 dark:stroke-slate-800"
                  }
                  strokeWidth={editable ? 2 : 1}
                />
                <text
                  x={x}
                  y={layout.t + layout.ph + 18}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400"
                  fontSize={11}
                >
                  {formatTick(t)}
                </text>
              </g>
            );
          })}

          {ticksY.map((t, i) => {
            const y = scale.mapY(t);
            const isEdge = i === 0 || i === ticksY.length - 1;
            const editable = gridDragAxis === "y" && !!warpY && !isEdge;

            return (
              <g key={`gy_${i}`}>
                <line
                  x1={layout.l}
                  y1={y}
                  x2={layout.l + layout.pw}
                  y2={y}
                  className={
                    editable
                      ? "stroke-blue-400/70 dark:stroke-blue-400/70"
                      : "stroke-slate-200 dark:stroke-slate-800"
                  }
                  strokeWidth={editable ? 2 : 1}
                />
                <text
                  x={layout.l - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-500 dark:fill-slate-400"
                  fontSize={11}
                >
                  {formatTick(t)}
                </text>
              </g>
            );
          })}

          <rect
            x={layout.l}
            y={layout.t}
            width={layout.pw}
            height={layout.ph}
            className="fill-transparent stroke-slate-300 dark:stroke-slate-700"
            strokeWidth={1}
          />

          {/* curves + points */}
          <g clipPath={`url(#${clipId})`}>
            {[...paths.filter((p) => p.id !== activeSeriesId), ...paths.filter((p) => p.id === activeSeriesId)].map((p) => {
              const cIdx = colorById[p.id] ?? 0;
              const col = COLOR_OPTIONS[cIdx];
              const active = p.id === activeSeriesId;
              return (
                <g key={p.id}>
                  <path
                    d={p.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="stroke"
                    style={{ cursor: pendingAssignName ? "pointer" : undefined }}
                    onPointerDown={(e) => onPathPointerDown(e, p.id)}
                  />
                  <path
                    d={p.d}
                    fill="none"
                    strokeWidth={active ? 3.25 : 2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`${col.path} ${active ? "opacity-100" : "opacity-28"}`}
                  />
                </g>
              );
            })}

            {!showOnlyHighlightPoints && seriesList.map((s) => {
              if (!visibleIds.has(s.id)) return null;
              const cIdx = colorById[s.id] ?? 0;
              const col = COLOR_OPTIONS[cIdx];

              return s.points.map((pt, i) => {
                const cx = scale.mapX(pt.x);
                const cy = scale.mapY(pt.y);

                const selected = selection?.seriesId === s.id && selection.index === i;
                const active = s.id === activeSeriesId;

                const r = selected ? pointRadius + 1 : active ? pointRadius : Math.max(2, pointRadius - 1);

                return (
                  <circle
                    key={`${s.id}_${i}`}
                    cx={cx}
                    cy={cy}
                    r={r}
                    className={`${col.pointFill} ${active ? "opacity-100" : "opacity-45"}`}
                    strokeWidth={0}
                    style={{ cursor: pendingAssignName || mode === "delete-point" ? "pointer" : undefined }}
                    onPointerDown={(e) => onHandlePointerDown(e, s.id, i)}
                    onDoubleClick={(e) => onPointDoubleClick(e, s.id, i)}
                    onPointerEnter={() =>
                      setHover({ cx, cy, x: pt.x, y: pt.y, seriesName: s.name })
                    }
                    onPointerLeave={() => setHover(null)}
                  />
                );
              });
            })}

            {highlightPaths.map((path) => (
              <path
                key={`highlight_path_${path.id}`}
                d={path.d}
                fill="none"
                className="stroke-amber-500 dark:stroke-sky-400"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="5 4"
                pointerEvents="none"
              />
            ))}

            {highlightPoints.map((point) => (
              <g
                key={point.key}
                style={{ cursor: showOnlyHighlightPoints ? "grab" : "default" }}
                onPointerDown={(event) => onAutoSplinePointPointerDown(event, point.panelIndex, point.seriesId, point.index)}
                onPointerEnter={() =>
                  setHover({ cx: point.cx, cy: point.cy, x: point.x, y: point.y, seriesName: point.seriesName })
                }
                onPointerLeave={() => setHover(null)}
              >
                <circle
                  cx={point.cx}
                  cy={point.cy}
                  r={pointRadius + 5}
                  className="fill-amber-400/25 dark:fill-sky-400/20"
                  stroke="none"
                />
                <circle
                  cx={point.cx}
                  cy={point.cy}
                  r={pointRadius + 2.5}
                  className="fill-none stroke-amber-500 dark:stroke-sky-400"
                  strokeWidth={2.5}
                  strokeDasharray="3 2"
                />
                <circle
                  cx={point.cx}
                  cy={point.cy}
                  r={pointRadius + 0.5}
                  className="fill-orange-500 dark:fill-sky-400"
                  stroke="#111827"
                  strokeWidth={2}
                />
              </g>
            ))}
          </g>

          {deleteSelectionBox && (() => {
            const rect = normalizeSelectionBox(deleteSelectionBox);
            return (
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.w}
                height={rect.h}
                fill="rgba(59, 130, 246, 0.12)"
                stroke="rgba(59, 130, 246, 0.9)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                pointerEvents="none"
              />
            );
          })()}

          {hint && (
            <text
              x={layout.l + 10}
              y={layout.t + 18}
              className="fill-slate-500 dark:fill-slate-400"
              fontSize={12}
            >
              {hint}
            </text>
          )}

          {/* HITBOX overlays */}
          {gridDragAxis === "x" && warpX && (
            <g>
              {ticksX.map((t, i) => {
                const x = scale.mapX(t);
                const isEdge = i === 0 || i === ticksX.length - 1;
                const editable = !isEdge;
                return (
                  <rect
                    key={`hx_${i}`}
                    x={x - 7}
                    y={layout.t}
                    width={14}
                    height={layout.ph}
                    fill="transparent"
                    pointerEvents={editable ? "all" : "none"}
                    style={{ cursor: editable ? "ew-resize" : "default" }}
                    onPointerDown={(e) => onTickPointerDown(e, "x", i)}
                  />
                );
              })}
            </g>
          )}

          {gridDragAxis === "y" && warpY && (
            <g>
              {ticksY.map((t, i) => {
                const y = scale.mapY(t);
                const isEdge = i === 0 || i === ticksY.length - 1;
                const editable = !isEdge;
                return (
                  <rect
                    key={`hy_${i}`}
                    x={layout.l}
                    y={y - 7}
                    width={layout.pw}
                    height={14}
                    fill="transparent"
                    pointerEvents={editable ? "all" : "none"}
                    style={{ cursor: editable ? "ns-resize" : "default" }}
                    onPointerDown={(e) => onTickPointerDown(e, "y", i)}
                  />
                );
              })}
            </g>
          )}
          </svg>

        </div>

        <div
          className="absolute right-0 top-6 z-30 hidden w-2 -translate-x-0.5 cursor-ew-resize touch-none rounded-full bg-slate-300/70 dark:bg-slate-600/70 sm:block"
          style={{ height: Math.max(80, windowBox.h - 32) }}
          title="Потяните, чтобы изменить ширину редактора"
          onPointerDown={(event) => startResizeDrag(event, "x")}
          onPointerMove={updateResizeDrag}
          onPointerUp={finishResizeDrag}
          onPointerCancel={finishResizeDrag}
        />

        <div
          className="absolute bottom-0 left-6 z-30 hidden h-2 -translate-y-0.5 cursor-ns-resize touch-none rounded-full bg-slate-300/70 dark:bg-slate-600/70 sm:block"
          style={{ width: Math.max(80, windowBox.w - 32) }}
          title="Потяните, чтобы изменить высоту редактора"
          onPointerDown={(event) => startResizeDrag(event, "y")}
          onPointerMove={updateResizeDrag}
          onPointerUp={finishResizeDrag}
          onPointerCancel={finishResizeDrag}
        />

        <div
          className="absolute bottom-0 right-0 z-40 flex cursor-nwse-resize touch-none items-center justify-center rounded-tl-xl bg-slate-300/85 text-slate-600 shadow-sm dark:bg-slate-700/85 dark:text-slate-200"
          style={{ width: RESIZE_HANDLE_SIZE, height: RESIZE_HANDLE_SIZE }}
          title="Потяните за угол, чтобы изменить размер редактора"
          onPointerDown={(event) => startResizeDrag(event, "both")}
          onPointerMove={updateResizeDrag}
          onPointerUp={finishResizeDrag}
          onPointerCancel={finishResizeDrag}
        >
          <span className="pointer-events-none text-[10px] leading-none">⋰</span>
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}

