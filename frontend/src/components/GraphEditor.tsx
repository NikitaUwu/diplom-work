// src/components/GraphEditor.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import Button from "./ui/Button";
import Alert from "./ui/Alert";

type Point = { x: number; y: number };

type Series = {
  id: string;
  name: string;
  interp: "linear" | "poly";
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

function formatTick(v: number) {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1000 || (a > 0 && a < 0.01)) return v.toExponential(2);
  return v.toFixed(6).replace(/\.?0+$/, "");
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

      return {
        id: String(s?.id ?? uid(`s${pi}_${si}`)),
        name: String(s?.name ?? `Кривая ${si + 1}`),
        interp: (s?.interp === "poly" ? "poly" : "linear") as Series["interp"],
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

  const v = clamp(value, dk[0], dk[dk.length - 1]);
  const i = _findSeg(dk, v);

  const a = dk[i],
    b = dk[i + 1];
  const sa = sk[i],
    sb = sk[i + 1];
  const t = (v - a) / (b - a || 1);
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

// screenKnots = линейные позиции, чтобы при включении режима сетка не "прыгала"
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

// ===== Cubic spline y(x), natural =====
function splineSample(points: Point[], samples = 250): Point[] {
  if (points.length < 3) return points;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  for (let i = 1; i < xs.length; i++) {
    if (xs[i] === xs[i - 1]) return points;
  }

  const n = xs.length;
  const h: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) h[i] = xs[i + 1] - xs[i];
  for (let i = 0; i < n - 1; i++) if (h[i] === 0) return points;

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

  const xMin = xs[0];
  const xMax = xs[n - 1];
  const out: Point[] = [];
  const N = Math.max(50, samples);

  for (let k = 0; k <= N; k++) {
    const x = xMin + ((xMax - xMin) * k) / N;

    let i = n - 2;
    for (let j = 0; j < n - 1; j++) {
      if (x <= xs[j + 1]) {
        i = j;
        break;
      }
    }

    const dx = x - xs[i];
    const y = aa[i] + bb[i] * dx + cc[i] * dx * dx + dd[i] * dx * dx * dx;
    out.push({ x, y });
  }

  return out;
}

export default function GraphEditor({ resultJson, onResultJsonChange }: Props) {
  const initialPanels = useMemo(() => parsePanels(resultJson), [resultJson]);

  const [panels, setPanels] = useState<Panel[]>(() => initialPanels);
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(() => {
    const p0 = initialPanels[0];
    return p0?.series?.[0]?.id ?? null;
  });

  const [mode, setMode] = useState<"select" | "add-point">("select");
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

  const nameBeforeRef = useRef<string | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [bbox, setBbox] = useState<{ w: number; h: number }>({ w: 900, h: 420 });

  const prevDomainXRef = useRef<[number, number]>(view.domainX);
  const prevDomainYRef = useRef<[number, number]>(view.domainY);

  const tickDragRef = useRef<null | { axis: "x" | "y"; index: number; before: AxisWarp; pointerId: number }>(null);

  const pointDragRef = useRef<null | { seriesId: string; index: number; before: Point; pointerId: number }>(null);

  // Pan (variant A): frozen inversion on startView/startWarp
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

  // ===== Zoom refs/txn =====
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const zoomTxnRef = useRef<{ before: View; timer: number | null } | null>(null);

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

  const panel0 = panels[0] ?? { series: [] };
  const seriesList = panel0.series;

  useEffect(() => {
    if (activeSeriesId && seriesList.some((s) => s.id === activeSeriesId)) return;
    setActiveSeriesId(seriesList[0]?.id ?? null);
  }, [activeSeriesId, seriesList]);

  const activeSeries = useMemo(() => seriesList.find((s) => s.id === activeSeriesId) ?? null, [seriesList, activeSeriesId]);

  const layout = useMemo(() => {
    const m = { l: 56, r: 18, t: 16, b: 44 };
    const pw = Math.max(50, bbox.w - m.l - m.r);
    const ph = Math.max(50, bbox.h - m.t - m.b);
    return { ...m, pw, ph };
  }, [bbox]);

  // keep warps consistent with domain changes (outside drag computations)
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

    const mapX = (x: number) => layout.l + clamp(sx(x), 0, 1) * layout.pw;
    const mapY = (y: number) => layout.t + layout.ph - clamp(sy(y), 0, 1) * layout.ph;

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

  const ticksX = useMemo(() => (warpX ? warpX.dataKnots : niceTicks(view.domainX[0], view.domainX[1], 6)), [warpX, view.domainX]);
  const ticksY = useMemo(() => (warpY ? warpY.dataKnots : niceTicks(view.domainY[0], view.domainY[1], 6)), [warpY, view.domainY]);

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

  const deleteSelectedPoint = () => {
    if (!selection) return;
    const { seriesId, index } = selection;

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

    setSelection(null);
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
    const s: Series = { id: uid("series"), name: `Кривая ${seriesList.length + 1}`, interp: "linear", points: [] };

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
  };

  const toggleInterp = () => {
    if (!activeSeries) return;
    const before = activeSeries.interp;
    const after: Series["interp"] = before === "linear" ? "poly" : "linear";

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
        const s = (layout.t + layout.ph - clamp(py, layout.t, layout.t + layout.ph)) / (layout.ph || 1);
        applyTickDrag("y", t.index, clamp(s, 0, 1));
      }
      return;
    }

    // pan (variant A): compute dx/dy using startView/startWarp only
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

    // point drag
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

      const moved = Math.abs(after.x - d.before.x) > 1e-12 || Math.abs(after.y - d.before.y) > 1e-12;
      if (moved) {
        pushUndo({ type: "move-point", seriesId: d.seriesId, index: d.index, before: d.before, after: { ...after } });
      }
    }
  };

  const paths = useMemo(() => {
    const mkPath = (pts: Point[]) => {
      if (!pts.length) return "";
      return `M ${pts.map((p) => `${scale.mapX(p.x)} ${scale.mapY(p.y)}`).join(" L ")}`;
    };

    return seriesList.map((s) => {
      const pts = s.points.slice().sort((a, b) => a.x - b.x);
      const polyPts = s.interp === "poly" ? splineSample(pts, 300) : pts;
      return { id: s.id, d: mkPath(polyPts) };
    });
  }, [seriesList, scale]);

  const domainInputs = (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="text-xs text-slate-500 dark:text-slate-400">X min / max</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <input
            className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-slate-400 dark:bg-slate-950 dark:ring-slate-800"
            value={String(view.domainX[0])}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              const before = view;
              const after: View = { ...view, domainX: [v, view.domainX[1]] };
              setView(after);
              pushUndo({ type: "set-domain", before, after });
            }}
          />
          <input
            className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-slate-400 dark:bg-slate-950 dark:ring-slate-800"
            value={String(view.domainX[1])}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              const before = view;
              const after: View = { ...view, domainX: [view.domainX[0], v] };
              setView(after);
              pushUndo({ type: "set-domain", before, after });
            }}
          />
        </div>
      </div>

      <div>
        <div className="text-xs text-slate-500 dark:text-slate-400">Y min / max</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <input
            className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-slate-400 dark:bg-slate-950 dark:ring-slate-800"
            value={String(view.domainY[0])}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              const before = view;
              const after: View = { ...view, domainY: [v, view.domainY[1]] };
              setView(after);
              pushUndo({ type: "set-domain", before, after });
            }}
          />
          <input
            className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-slate-400 dark:bg-slate-950 dark:ring-slate-800"
            value={String(view.domainY[1])}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              const before = view;
              const after: View = { ...view, domainY: [view.domainY[0], v] };
              setView(after);
              pushUndo({ type: "set-domain", before, after });
            }}
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
      : mode === "add-point"
      ? "Режим: добавление точки (клик по полю)"
      : "";

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
            setPanMode(false);
            setGridDragAxis(null);
            setMode((m) => (m === "add-point" ? "select" : "add-point"));
          }}
          disabled={gridDragAxis !== null || panMode}
          title="Добавить точку по клику"
        >
          + точка
        </Button>

        <Button
          variant="secondary"
          type="button"
          onClick={deleteSelectedPoint}
          disabled={!selection || panMode}
          title={!selection ? "Выберите точку" : "Удалить выбранную точку"}
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
          onClick={toggleInterp}
          disabled={!activeSeries}
          title="Переключить интерполяцию для активной кривой"
        >
          {activeSeries?.interp === "poly" ? "Полином" : "Линии"}
        </Button>

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
          style={{ cursor: panMode ? "grab" : "default" }}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerCancel={onSvgPointerUp}
        >
          <rect x={layout.l} y={layout.t} width={layout.pw} height={layout.ph} className="fill-slate-50 dark:fill-slate-950" />

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
                  className={editable ? "stroke-blue-400/70 dark:stroke-blue-400/70" : "stroke-slate-200 dark:stroke-slate-800"}
                  strokeWidth={editable ? 2 : 1}
                />
                <text x={x} y={layout.t + layout.ph + 18} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400" fontSize={11}>
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
                  className={editable ? "stroke-blue-400/70 dark:stroke-blue-400/70" : "stroke-slate-200 dark:stroke-slate-800"}
                  strokeWidth={editable ? 2 : 1}
                />
                <text x={layout.l - 10} y={y + 4} textAnchor="end" className="fill-slate-500 dark:fill-slate-400" fontSize={11}>
                  {formatTick(t)}
                </text>
              </g>
            );
          })}

          <rect x={layout.l} y={layout.t} width={layout.pw} height={layout.ph} className="fill-transparent stroke-slate-300 dark:stroke-slate-700" strokeWidth={1} />

          {paths.map((p) => (
            <path
              key={p.id}
              d={p.d}
              fill="none"
              strokeWidth={2}
              className={p.id === activeSeriesId ? "stroke-slate-900 dark:stroke-slate-100" : "stroke-slate-400 dark:stroke-slate-600"}
            />
          ))}

          {seriesList.map((s) =>
            s.points.map((pt, i) => {
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
                  className={
                    active
                      ? "fill-white stroke-slate-900 dark:fill-blue-500/15 dark:stroke-blue-400"
                      : "fill-white stroke-slate-400 dark:fill-blue-500/10 dark:stroke-blue-500/60"
                  }
                  strokeWidth={2}
                  onPointerDown={(e) => onHandlePointerDown(e, s.id, i)}
                  onPointerEnter={() => setHover({ cx, cy, x: pt.x, y: pt.y, seriesName: s.name })}
                  onPointerLeave={() => setHover(null)}
                />
              );
            })
          )}

          {hint && (
            <text x={layout.l + 10} y={layout.t + 18} className="fill-slate-500 dark:fill-slate-400" fontSize={12}>
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