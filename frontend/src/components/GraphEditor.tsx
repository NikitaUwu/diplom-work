import { useEffect, useMemo, useRef, useState } from "react";
import Button from "./ui/Button";
import Alert from "./ui/Alert";
import Card from "./ui/Card";

type Point = { x: number; y: number };

type Series = {
  id: string;
  name: string;
  interp: "linear" | "poly" | "lsq";
  points: Point[];
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

type View = {
  domainX: [number, number];
  domainY: [number, number];
};

type AxisWarp = {
  dataKnots: number[];
  screenKnots: number[]; // 0..1
};

type Patch =
  | { type: "move-point"; seriesId: string; index: number; before: Point; after: Point }
  | { type: "add-point"; seriesId: string; index: number; point: Point }
  | { type: "delete-point"; seriesId: string; index: number; point: Point }
  | { type: "add-series"; index: number; series: Series }
  | { type: "delete-series"; index: number; series: Series }
  | { type: "set-interp"; seriesId: string; before: Series["interp"]; after: Series["interp"] }
  | { type: "rename-series"; seriesId: string; before: string; after: string }
  | { type: "set-domain"; before: View; after: View }
  | { type: "set-warp"; axis: "x" | "y"; before: AxisWarp | null; after: AxisWarp | null };

type Props = {
  resultJson: unknown;
  onResultJsonChange?: (next: any) => void;
};

const MAX_SERIES_NAME = 60;
const MAX_SERIES_LABEL = 26;

const ZOOM_STEP = 1.1;
const MIN_SPAN = 1e-9;

const LSQ_MAX_DEG = 5;

const COLOR_OPTIONS = [
  {
    id: "black",
    label: "Чёрный",
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
    label: "Зелёный",
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
  return s.slice(0, Math.max(0, max - 1)) + "…";
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

// подписи осей/tooltip — до сотых
function formatTick(v: number) {
  if (!Number.isFinite(v)) return "—";
  const r = Math.round(v * 100) / 100;
  return r.toFixed(2).replace(/\.?0+$/, "");
}

// коэффициенты формулы — до 6 знаков
function formatCoef(v: number) {
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 1e6) / 1e6;
  return r.toFixed(6).replace(/\.?0+$/, "");
}

function parsePanels(resultJson: unknown): Panel[] {
  if (!isObj(resultJson)) return [{ series: [] }];

  const panelsRaw = (resultJson as any).panels;
  if (!Array.isArray(panelsRaw) || panelsRaw.length === 0) return [{ series: [] }];

  return panelsRaw.map((p: any, pi: number) => {
    const seriesRaw = Array.isArray(p?.series) ? p.series : [];
    const series: Series[] = seriesRaw.map((s: any, si: number) => {
      const ptsRaw = Array.isArray(s?.points) ? s.points : [];
      const pts: Point[] = ptsRaw
        .filter((t: any) => Array.isArray(t) && t.length >= 2)
        .map((t: any) => ({ x: Number(t[0]), y: Number(t[1]) }))
        .filter((pt: Point) => Number.isFinite(pt.x) && Number.isFinite(pt.y));

      const interp: Series["interp"] =
        s?.interp === "poly" ? "poly" : s?.interp === "lsq" || s?.interp === "lagrange" ? "lsq" : "linear";

      return {
        id: String(s?.id ?? uid(`s${pi}_${si}`)),
        name: String(s?.name ?? `Кривая ${si + 1}`),
        interp,
        points: pts,
      };
    });

    return { id: p?.id != null ? String(p.id) : undefined, series };
  });
}

function buildNextResultJson(base: unknown, panels: Panel[]): any {
  const out: EditorResultJson = isObj(base) ? { ...(base as any) } : {};
  out.panels = panels.map((p) => ({
    ...(p.id != null ? { id: p.id } : {}),
    series: p.series.map((s) => ({
      id: s.id,
      name: s.name,
      interp: s.interp,
      points: s.points.map((pt) => [pt.x, pt.y]),
    })),
  }));
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

function buildWarpFromTicks(domain: [number, number], count = 6): AxisWarp {
  const [d0, d1] = domain;
  const inner = niceTicks(d0, d1, count).filter((t) => t > d0 && t < d1);
  const uniq = Array.from(new Set(inner.map((x) => Number(x)))).filter(Number.isFinite);
  uniq.sort((a, b) => a - b);

  const dataKnots = [d0, ...uniq.filter((t) => t !== d0 && t !== d1), d1];
  const den = d1 - d0 || 1;
  const screenKnots = dataKnots.map((v) => (v - d0) / den);

  return normalizeWarp({ dataKnots, screenKnots });
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

// ===== Cubic spline =====
function splineCoefficients(points: Point[]) {
  if (points.length < 3) return null;

  const pts = points.slice().sort((a, b) => a.x - b.x);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);

  for (let i = 1; i < xs.length; i++) if (xs[i] === xs[i - 1]) return null;

  const n = xs.length;
  const h: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) h[i] = xs[i + 1] - xs[i];
  for (let i = 0; i < n - 1; i++) if (h[i] === 0) return null;

  const a: number[] = new Array(n).fill(0);
  const b: number[] = new Array(n).fill(0);
  const c: number[] = new Array(n).fill(0);
  const d: number[] = new Array(n).fill(0);

  b[0] = 1;
  b[n - 1] = 1;

  for (let i = 1; i < n - 1; i++) {
    a[i] = h[i - 1];
    b[i] = 2 * (h[i - 1] + h[i]);
    c[i] = h[i];
    d[i] = 3 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1]);
  }

  for (let i = 1; i < n; i++) {
    const w = a[i] / b[i - 1];
    b[i] = b[i] - w * c[i - 1];
    d[i] = d[i] - w * d[i - 1];
  }

  const cc: number[] = new Array(n).fill(0);
  cc[n - 1] = d[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) cc[i] = (d[i] - c[i] * cc[i + 1]) / b[i];

  const bb: number[] = new Array(n - 1);
  const dd: number[] = new Array(n - 1);
  const aa: number[] = ys.slice(0, n - 1);

  for (let i = 0; i < n - 1; i++) {
    bb[i] = (ys[i + 1] - ys[i]) / h[i] - (h[i] * (2 * cc[i] + cc[i + 1])) / 3;
    dd[i] = (cc[i + 1] - cc[i]) / (3 * h[i]);
  }

  const segs = [];
  for (let i = 0; i < n - 1; i++) {
    segs.push({ x0: xs[i], x1: xs[i + 1], a: aa[i], b: bb[i], c: cc[i], d: dd[i] });
  }
  return { pts, segs };
}

function splineSample(points: Point[], samples = 250): Point[] {
  const coeff = splineCoefficients(points);
  if (!coeff) return points;

  const pts = coeff.pts;
  const segs = coeff.segs;

  const xMin = pts[0].x;
  const xMax = pts[pts.length - 1].x;
  const out: Point[] = [];
  const N = Math.max(50, samples);

  for (let k = 0; k <= N; k++) {
    const x = xMin + ((xMax - xMin) * k) / N;

    let si = segs.length - 1;
    for (let j = 0; j < segs.length; j++) {
      if (x <= segs[j].x1) {
        si = j;
        break;
      }
    }

    const s = segs[si];
    const dx = x - s.x0;
    const y = s.a + s.b * dx + s.c * dx * dx + s.d * dx * dx * dx;
    out.push({ x, y });
  }
  return out;
}

// ===== LSQ fit =====
type PolyFitResult = { degree: number; xMin: number; xMax: number; aX: number[] };

function solveLinearSystem(A: number[][], b: number[]) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null;

    if (piv !== col) {
      const tmp = M[col];
      M[col] = M[piv];
      M[piv] = tmp;
    }

    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (Math.abs(f) < 1e-12) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }

  return M.map((row) => row[n]);
}

function polyMul(a: number[], b: number[]) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}
function polyScale(a: number[], k: number) {
  return a.map((v) => v * k);
}
function polyAdd(a: number[], b: number[]) {
  const n = Math.max(a.length, b.length);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

function lsqFit(points: Point[], degreeWanted: number): PolyFitResult | null {
  const pts = points.slice().filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return null;

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const span = xMax - xMin;
  if (!Number.isFinite(span) || span === 0) return null;

  const deg = clamp(degreeWanted, 1, Math.min(LSQ_MAX_DEG, pts.length - 1));
  const m = deg + 1;

  const alpha = 2 / span;
  const beta = -(xMin + xMax) / span; // t = alpha*x + beta

  const ATA: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const ATy: number[] = new Array(m).fill(0);

  for (let i = 0; i < pts.length; i++) {
    const t = alpha * xs[i] + beta;
    const pows = new Array(m).fill(1);
    for (let k = 1; k < m; k++) pows[k] = pows[k - 1] * t;

    for (let r = 0; r < m; r++) {
      ATy[r] += pows[r] * ys[i];
      for (let c = 0; c < m; c++) ATA[r][c] += pows[r] * pows[c];
    }
  }

  const cT = solveLinearSystem(ATA, ATy);
  if (!cT) return null;

  const tPoly = [beta, alpha];
  let powPoly: number[] = [1];
  let aX: number[] = [0];

  for (let k = 0; k < cT.length; k++) {
    if (k === 0) powPoly = [1];
    else powPoly = polyMul(powPoly, tPoly);
    aX = polyAdd(aX, polyScale(powPoly, cT[k]));
  }

  return { degree: deg, xMin, xMax, aX };
}

function evalPolyCoeffs(a: number[], x: number) {
  let y = 0;
  for (let i = a.length - 1; i >= 0; i--) y = y * x + a[i];
  return y;
}

function polyFormula(a: number[]) {
  const eps = 1e-10;
  const terms: string[] = [];
  for (let k = a.length - 1; k >= 0; k--) {
    const c = a[k] ?? 0;
    if (Math.abs(c) < eps) continue;

    const sign = c < 0 ? "−" : terms.length ? "+" : "";
    const abs = Math.abs(c);

    let coefStr = formatCoef(abs);
    if (k > 0 && Math.abs(abs - 1) < 1e-10) coefStr = "";

    const xPart = k === 0 ? "" : k === 1 ? "x" : `x^${k}`;

    if (k === 0) terms.push(`${sign}${coefStr}`);
    else if (!coefStr) terms.push(`${sign}${xPart}`);
    else terms.push(`${sign}${coefStr}·${xPart}`);
  }

  if (!terms.length) return "y = 0";
  return `y = ${terms.join(" ")}`.replace(/^y = \+ /, "y = ");
}

function interpLabel(i: Series["interp"]) {
  if (i === "linear") return "Линии";
  if (i === "poly") return "Сплайн";
  return "МНК";
}

function defaultColorIndex(prefer: number, used: Set<number>) {
  if (!used.has(prefer)) return prefer;
  for (let i = 0; i < COLOR_OPTIONS.length; i++) {
    if (!used.has(i)) return i;
  }
  return prefer;
}

export default function GraphEditor({ resultJson, onResultJsonChange }: Props) {
  const initialPanels = useMemo(() => parsePanels(resultJson), [resultJson]);

  const [panels, setPanels] = useState<Panel[]>(() => initialPanels);
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(() => {
    const p0 = initialPanels[0];
    return p0?.series?.[0]?.id ?? null;
  });

  const [mode, setMode] = useState<"select" | "add-point" | "delete-point">("select");
  const [gridDragAxis, setGridDragAxis] = useState<null | "x" | "y">(null);
  const [panMode, setPanMode] = useState(false);

  const [selection, setSelection] = useState<{ seriesId: string; index: number } | null>(null);

  const [view, setView] = useState<View>(() => {
    const all = initialPanels.flatMap((p) => p.series.flatMap((s) => s.points));
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const x0 = xs.length ? Math.min(...xs) : 0;
    const x1 = xs.length ? Math.max(...xs) : 1;
    const y0 = ys.length ? Math.min(...ys) : 0;
    const y1 = ys.length ? Math.max(...ys) : 1;
    const padX = (x1 - x0 || 1) * 0.05;
    const padY = (y1 - y0 || 1) * 0.05;
    return { domainX: [x0 - padX, x1 + padX], domainY: [y0 - padY, y1 + padY] };
  });

  const [warpX, setWarpX] = useState<AxisWarp | null>(null);
  const [warpY, setWarpY] = useState<AxisWarp | null>(null);

  const [undo, setUndo] = useState<Patch[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [pointRadius, setPointRadius] = useState(5);
  const [hover, setHover] = useState<null | { cx: number; cy: number; x: number; y: number; seriesName: string }>(
    null
  );

  const [showPoly, setShowPoly] = useState(true);

  // show/hide curves
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set());
  const [visOpen, setVisOpen] = useState(false);
  const visRef = useRef<HTMLDivElement | null>(null);

  // per-series color (index into COLOR_OPTIONS)
  const [colorById, setColorById] = useState<Record<string, number>>({});

  const nameBeforeRef = useRef<string | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [bbox, setBbox] = useState<{ w: number; h: number }>({ w: 900, h: 420 });

  const prevDomainXRef = useRef<[number, number]>(view.domainX);
  const prevDomainYRef = useRef<[number, number]>(view.domainY);

  const tickDragRef = useRef<null | { axis: "x" | "y"; index: number; before: AxisWarp; pointerId: number }>(null);
  const pointDragRef = useRef<null | { seriesId: string; index: number; before: Point; pointerId: number }>(null);

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

  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const zoomTxnRef = useRef<{ before: View; timer: number | null } | null>(null);

  const panel0 = panels[0] ?? { series: [] };
  const seriesList = panel0.series;

  useEffect(() => {
    if (activeSeriesId && seriesList.some((s) => s.id === activeSeriesId)) return;
    setActiveSeriesId(seriesList[0]?.id ?? null);
  }, [activeSeriesId, seriesList]);

  const activeSeries = useMemo(
    () => seriesList.find((s) => s.id === activeSeriesId) ?? null,
    [seriesList, activeSeriesId]
  );

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

  // polynomial card for LSQ
  const polyInfo = useMemo(() => {
    if (!activeSeries || activeSeries.interp !== "lsq") return null;
    const pts = activeSeries.points.slice().sort((a, b) => a.x - b.x);
    const degWanted = Math.min(LSQ_MAX_DEG, Math.max(1, pts.length - 1));
    const fit = lsqFit(pts, degWanted);
    if (!fit) return { err: "Невозможно выполнить МНК (нужны хотя бы 2 разные точки по X)." as const };
    return { degree: fit.degree, formula: polyFormula(fit.aX) };
  }, [activeSeries]);

  const layout = useMemo(() => {
    const m = { l: 56, r: 18, t: 16, b: 44 };
    const pw = Math.max(50, bbox.w - m.l - m.r);
    const ph = Math.max(50, bbox.h - m.t - m.b);
    return { ...m, pw, ph };
  }, [bbox]);

  const pushUndo = (p: Patch) => setUndo((u) => [p, ...u].slice(0, 50));

  function beginZoomTxn() {
    if (!zoomTxnRef.current) zoomTxnRef.current = { before: viewRef.current, timer: null };
    if (zoomTxnRef.current.timer) window.clearTimeout(zoomTxnRef.current.timer);
    zoomTxnRef.current.timer = window.setTimeout(() => {
      const tx = zoomTxnRef.current;
      zoomTxnRef.current = null;
      if (!tx) return;
      const after = viewRef.current;
      if (JSON.stringify(tx.before) !== JSON.stringify(after)) {
        pushUndo({ type: "set-domain", before: tx.before, after });
      }
    }, 220);
  }

  function zoomAtData(fx: number, fy: number, factor: number, axis: "both" | "x" | "y" = "both") {
    const {
      domainX: [x0, x1],
      domainY: [y0, y1],
    } = viewRef.current;

    const nx0 = fx - (fx - x0) * factor;
    const nx1 = fx + (x1 - fx) * factor;
    const ny0 = fy - (fy - y0) * factor;
    const ny1 = fy + (y1 - fy) * factor;

    const next: View = {
      domainX:
        axis === "y"
          ? [x0, x1]
          : [Math.min(nx0, nx1 - MIN_SPAN), Math.max(nx1, nx0 + MIN_SPAN)],
      domainY:
        axis === "x"
          ? [y0, y1]
          : [Math.min(ny0, ny1 - MIN_SPAN), Math.max(ny1, ny0 + MIN_SPAN)],
    };

    setView(next);
  }

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setBbox({ w: r.width, h: r.height });
    });

    ro.observe(el);
    const r0 = el.getBoundingClientRect();
    if (r0.width > 0 && r0.height > 0) setBbox({ w: r0.width, h: r0.height });

    return () => ro.disconnect();
  }, []);

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

  // wheel zoom
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;

    const onWheel = (ev: WheelEvent) => {
      if (gridDragAxis) return;
      if (tickDragRef.current || pointDragRef.current || panRef.current) return;

      ev.preventDefault();

      const rect = el.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;

      const fx = scale.invX(px);
      const fy = scale.invY(py);

      const dir = ev.deltaY > 0 ? 1 : -1;
      const factor = dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;

      const axis: "both" | "x" | "y" = ev.shiftKey ? "x" : ev.altKey ? "y" : "both";

      beginZoomTxn();
      zoomAtData(fx, fy, factor, axis);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scale, gridDragAxis]);

  const ticksX = useMemo(
    () => (warpX ? warpX.dataKnots : niceTicks(view.domainX[0], view.domainX[1], 6)),
    [warpX, view.domainX]
  );
  const ticksY = useMemo(
    () => (warpY ? warpY.dataKnots : niceTicks(view.domainY[0], view.domainY[1], 6)),
    [warpY, view.domainY]
  );

  const commitResultJson = (nextPanels: Panel[]) => {
    if (!onResultJsonChange) return;
    onResultJsonChange(buildNextResultJson(resultJson, nextPanels));
  };

  const setPanelsAndEmit = (updater: (prev: Panel[]) => Panel[]) => {
    setPanels((prev) => {
      const next = updater(prev);
      commitResultJson(next);
      return next;
    });
  };

  const onAuto = () => {
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
        case "add-series": {
          p0.series.splice(p.index, 1);
          return next;
        }
        case "delete-series": {
          p0.series.splice(p.index, 0, structuredClone(p.series));
          return next;
        }
        case "set-interp": {
          const s = findSeries(p.seriesId);
          if (!s) return prev;
          s.interp = p.before;
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
        setHover(null);
        setVisOpen(false);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selection) return;
        e.preventDefault();
        deleteSelectedPoint();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, undo.length]);

  const addSeries = () => {
    const s: Series = {
      id: uid("series"),
      name: `Кривая ${seriesList.length + 1}`,
      interp: "linear",
      points: [],
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

  const cycleInterp = () => {
    if (!activeSeries) return;
    const before = activeSeries.interp;
    const after: Series["interp"] = before === "linear" ? "poly" : before === "poly" ? "lsq" : "linear";

    setPanelsAndEmit((prev) => {
      const next = structuredClone(prev) as Panel[];
      const p0 = next[0] ?? { series: [] };
      next[0] = p0;
      const s = p0.series.find((x) => x.id === activeSeries.id);
      if (!s) return prev;
      s.interp = after;
      pushUndo({ type: "set-interp", seriesId: s.id, before, after });
      return next;
    });
  };

  const toggleGridDrag = (axis: "x" | "y") => {
    if (panMode) return;

    setMode("select");
    setErr(null);
    setSelection(null);
    setHover(null);

    if (axis === "x") {
      setWarpX((w) => w ?? buildWarpFromTicks(view.domainX, 6));
      setGridDragAxis((cur) => (cur === "x" ? null : "x"));
    } else {
      setWarpY((w) => w ?? buildWarpFromTicks(view.domainY, 6));
      setGridDragAxis((cur) => (cur === "y" ? null : "y"));
    }
  };

  const invXFrom = (v: View, w: AxisWarp | null, px: number) => {
    const s = (clamp(px, layout.l, layout.l + layout.pw) - layout.l) / (layout.pw || 1);
    return axisScreenToValue(s, v.domainX, w);
  };

  const invYFrom = (v: View, w: AxisWarp | null, py: number) => {
    const s = (layout.t + layout.ph - clamp(py, layout.t, layout.t + layout.ph)) / (layout.ph || 1);
    return axisScreenToValue(s, v.domainY, w);
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
    if (gridDragAxis) return;

    if (panMode) {
      startPanFromEvent(e);
      return;
    }

    if (mode !== "add-point") return;

    if (!activeSeries) {
      setErr("Сначала выберите/создайте кривую");
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

      const s = p0.series.find((x) => x.id === activeSeries.id);
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
  };

  const onHandlePointerDown = (e: React.PointerEvent, seriesId: string, index: number) => {
    if (gridDragAxis) return;

    if (panMode) {
      startPanFromEvent(e);
      return;
    }

    if (mode === "delete-point") {
      e.preventDefault();
      e.stopPropagation();
      setErr(null);
      deletePointAt(seriesId, index);
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

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
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

        let drawPts = pts;

        if (s.interp === "poly") {
          drawPts = splineSample(pts, 300);
        } else if (s.interp === "lsq") {
          const degWanted = Math.min(LSQ_MAX_DEG, Math.max(1, pts.length - 1));
          const fit = lsqFit(pts, degWanted);
          if (fit) {
            const N = 300;
            const out: Point[] = [];
            for (let k = 0; k <= N; k++) {
              const x = fit.xMin + ((fit.xMax - fit.xMin) * k) / N;
              out.push({ x, y: evalPolyCoeffs(fit.aX, x) });
            }
            drawPts = out;
          }
        }

        return { id: s.id, d: mkPath(drawPts) };
      })
      .filter(Boolean) as { id: string; d: string }[];
  }, [seriesList, scale, visibleIds]);

  const domainInputs = (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="text-xs text-slate-500 dark:text-slate-400">X min / max</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <input
            readOnly
            className="w-full cursor-default rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 outline-none dark:bg-slate-950 dark:ring-slate-800"
            value={formatTick(view.domainX[0])}
          />
          <input
            readOnly
            className="w-full cursor-default rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 outline-none dark:bg-slate-950 dark:ring-slate-800"
            value={formatTick(view.domainX[1])}
          />
        </div>
      </div>

      <div>
        <div className="text-xs text-slate-500 dark:text-slate-400">Y min / max</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <input
            readOnly
            className="w-full cursor-default rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 outline-none dark:bg-slate-950 dark:ring-slate-800"
            value={formatTick(view.domainY[0])}
          />
          <input
            readOnly
            className="w-full cursor-default rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 outline-none dark:bg-slate-950 dark:ring-slate-800"
            value={formatTick(view.domainY[1])}
          />
        </div>
      </div>
    </div>
  );

  const hint =
    gridDragAxis === "x"
      ? "Режим: перетаскивание тиков по X"
      : gridDragAxis === "y"
      ? "Режим: перетаскивание тиков по Y"
      : panMode
      ? "Режим: перемещение (Pan)"
      : mode === "delete-point"
      ? "Режим: удаление точек (клик по точке)"
      : mode === "add-point"
      ? "Режим: добавление точки (клик по полю)"
      : "";

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
        <Button variant="secondary" type="button" onClick={onAuto} disabled={gridDragAxis !== null || panMode}>
          Auto
        </Button>

        <Button
          variant="secondary"
          type="button"
          onClick={onUndo}
          disabled={undo.length === 0}
          title={undo.length === 0 ? "Нет действий для отмены" : ""}
        >
          Undo
        </Button>

        <Button
          variant="secondary"
          type="button"
          disabled={gridDragAxis !== null}
          onClick={() => {
            const [x0, x1] = view.domainX;
            const [y0, y1] = view.domainY;
            beginZoomTxn();
            zoomAtData((x0 + x1) / 2, (y0 + y1) / 2, 1 / ZOOM_STEP, "both");
          }}
        >
          Zoom +
        </Button>

        <Button
          variant="secondary"
          type="button"
          disabled={gridDragAxis !== null}
          onClick={() => {
            const [x0, x1] = view.domainX;
            const [y0, y1] = view.domainY;
            beginZoomTxn();
            zoomAtData((x0 + x1) / 2, (y0 + y1) / 2, ZOOM_STEP, "both");
          }}
        >
          Zoom −
        </Button>

        <Button
          variant={panMode ? "primary" : "secondary"}
          type="button"
          disabled={gridDragAxis !== null}
          onClick={() => {
            setPanMode((v) => {
              const next = !v;
              if (next) {
                setMode("select");
                setSelection(null);
                setGridDragAxis(null);
                setHover(null);
              }
              return next;
            });
          }}
        >
          Pan
        </Button>

        <Button
          variant={mode === "add-point" ? "primary" : "secondary"}
          type="button"
          onClick={() => {
            setErr(null);
            setPanMode(false);
            setGridDragAxis(null);
            setHover(null);
            setSelection(null);
            setMode((m) => (m === "add-point" ? "select" : "add-point"));
          }}
          disabled={gridDragAxis !== null || panMode}
          title="Добавить точку по клику"
        >
          + точка
        </Button>

        <Button
          variant={mode === "delete-point" ? "primary" : "secondary"}
          type="button"
          onClick={() => {
            setErr(null);
            setPanMode(false);
            setGridDragAxis(null);
            setHover(null);
            setSelection(null);
            setMode((m) => (m === "delete-point" ? "select" : "delete-point"));
          }}
          disabled={gridDragAxis !== null || panMode}
          title="Режим удаления: клик по точке удаляет её"
        >
          − точка
        </Button>

        <Button variant="secondary" type="button" onClick={addSeries}>
          + кривая
        </Button>

        <Button variant="secondary" type="button" onClick={deleteActiveSeries} disabled={!activeSeries}>
          − кривая
        </Button>

        <Button
          variant="secondary"
          type="button"
          onClick={cycleInterp}
          disabled={!activeSeries}
          title="Переключить интерполяцию для активной кривой"
        >
          {activeSeries ? interpLabel(activeSeries.interp) : "Интерп."}
        </Button>

        {activeSeries?.interp === "lsq" && (
          <Button variant="secondary" type="button" onClick={() => setShowPoly((v) => !v)}>
            {showPoly ? "Скрыть полином" : "Показать полином"}
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

                  return (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60"
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

                      {s.id === activeSeriesId && (
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          active
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <Button
          variant={gridDragAxis === "x" ? "primary" : "secondary"}
          type="button"
          disabled={panMode}
          onClick={() => toggleGridDrag("x")}
          title="Включить/выключить режим перетаскивания тиков по X"
        >
          Drag grid X
        </Button>

        <Button
          variant={gridDragAxis === "y" ? "primary" : "secondary"}
          type="button"
          disabled={panMode}
          onClick={() => toggleGridDrag("y")}
          title="Включить/выключить режим перетаскивания тиков по Y"
        >
          Drag grid Y
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
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

      {activeSeries?.interp === "lsq" && showPoly && (
        <Card
          title="Многочлен МНК"
          description={
            polyInfo && "err" in polyInfo ? "—" : polyInfo ? `Степень: ${polyInfo.degree}` : "—"
          }
        >
          {polyInfo && "err" in polyInfo ? (
            <Alert variant="danger" title="Ошибка">
              {polyInfo.err}
            </Alert>
          ) : (
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-900 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-100 dark:ring-slate-800">
              <div className="font-mono">{polyInfo?.formula ?? "—"}</div>
            </div>
          )}
        </Card>
      )}

      {domainInputs}

      <div className="relative rounded-2xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
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
          className="block h-[420px] w-full touch-none"
          style={{ cursor: panMode ? "grab" : mode === "delete-point" ? "crosshair" : "default" }}
          onPointerDown={onSvgPointerDown}
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
            className="fill-slate-50 dark:fill-slate-950"
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
            {paths.map((p) => {
              const cIdx = colorById[p.id] ?? 0;
              const col = COLOR_OPTIONS[cIdx];
              const active = p.id === activeSeriesId;
              return (
                <path
                  key={p.id}
                  d={p.d}
                  fill="none"
                  strokeWidth={active ? 3 : 2}
                  className={`${col.path} ${active ? "opacity-100" : "opacity-70"}`}
                />
              );
            })}

            {seriesList.map((s) => {
              if (!visibleIds.has(s.id)) return null;
              const cIdx = colorById[s.id] ?? 0;
              const col = COLOR_OPTIONS[cIdx];

              return s.points.map((pt, i) => {
                const cx = scale.mapX(pt.x);
                const cy = scale.mapY(pt.y);

                const selected = selection?.seriesId === s.id && selection.index === i;
                const active = s.id === activeSeriesId;

                const r = selected ? pointRadius + 1 : pointRadius;

                return (
                  <circle
                    key={`${s.id}_${i}`}
                    cx={cx}
                    cy={cy}
                    r={r}
                    className={`${col.pointFill} ${active ? "opacity-100" : "opacity-85"}`}
                    strokeWidth={0} // без обводки
                    style={{ cursor: mode === "delete-point" ? "pointer" : undefined }}
                    onPointerDown={(e) => onHandlePointerDown(e, s.id, i)}
                    onPointerEnter={() =>
                      setHover({ cx, cy, x: pt.x, y: pt.y, seriesName: s.name })
                    }
                    onPointerLeave={() => setHover(null)}
                  />
                );
              });
            })}
          </g>

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
    </div>
  );
}