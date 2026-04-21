import { COLOR_OPTIONS } from "./constants";
import type { DeleteSelectionBox, OverlayAxisSample, Point } from "./types";

export function ellipsis(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "...";
}

export function uid(prefix = "s") {
  const r = Math.random().toString(16).slice(2);
  return `${prefix}_${Date.now().toString(16)}_${r}`;
}

export function isObj(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function normalizeSelectionBox(box: DeleteSelectionBox) {
  return {
    x: Math.min(box.startX, box.endX),
    y: Math.min(box.startY, box.endY),
    w: Math.abs(box.endX - box.startX),
    h: Math.abs(box.endY - box.startY),
  };
}

export function toFiniteNumber(value: unknown): number | null {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

export function parseOverlayAxisSamples(value: unknown): OverlayAxisSample[] {
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

export function niceTicks(min: number, max: number, count = 6): number[] {
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

export function formatTick(v: number) {
  if (!Number.isFinite(v)) return "-";
  const r = Math.round(v * 100) / 100;
  return r.toFixed(2).replace(/\.?0+$/, "");
}

export function parsePointList(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item: any) => Array.isArray(item) && item.length >= 2)
    .map((item: any) => ({ x: Number(item[0]), y: Number(item[1]) }))
    .filter((point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

export function defaultColorIndex(prefer: number, used: Set<number>) {
  if (!used.has(prefer)) return prefer;
  for (let i = 0; i < COLOR_OPTIONS.length; i++) {
    if (!used.has(i)) return i;
  }
  return prefer;
}
