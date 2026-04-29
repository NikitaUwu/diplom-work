import type { OverlayAxisSample } from "./types";

export type AxisScale = "auto" | "linear" | "log";
export type AxisResolved = "linear" | "log";

function linearFitResidual(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return Number.POSITIVE_INFINITY;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
  }

  if (sxx <= 1e-12) return Number.POSITIVE_INFINITY;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let residual = 0;
  for (let i = 0; i < n; i += 1) {
    const predicted = slope * xs[i] + intercept;
    const diff = ys[i] - predicted;
    residual += diff * diff;
  }

  return residual / n;
}

export function detectLogFromSamples(samples: OverlayAxisSample[] | null | undefined): boolean {
  if (!samples || samples.length < 3) return false;
  if (samples.some((sample) => !Number.isFinite(sample.value) || sample.value <= 0)) {
    return false;
  }

  // Сравниваем два варианта и выбираем такой, где подписи ложатся ровнее.
  const values = samples.map((sample) => sample.value);
  const screens = samples.map((sample) => sample.screen);
  const logs = values.map((value) => Math.log10(value));

  const residualLinear = linearFitResidual(values, screens);
  const residualLog = linearFitResidual(logs, screens);

  if (!Number.isFinite(residualLinear) || !Number.isFinite(residualLog)) return false;

  return residualLog < Math.max(1e-9, residualLinear * 0.5);
}

function dedupeSorted(values: number[]): number[] {
  if (values.length === 0) return values;

  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = out[out.length - 1];
    const next = sorted[i];
    if (Math.abs(next - prev) > Math.max(1e-12, Math.abs(next) * 1e-9)) {
      out.push(next);
    }
  }
  return out;
}

export function niceLogTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > min)) return [];

  // Для больших промежутков оставляем меньше подписей, чтобы сетка не стала слишком плотной.
  const startDec = Math.floor(Math.log10(min));
  const endDec = Math.ceil(Math.log10(max));
  const decades = Math.max(0, endDec - startDec);

  const mantissas = decades <= 1
    ? [1, 2, 3, 4, 5, 6, 7, 8, 9]
    : decades <= 3
      ? [1, 2, 3, 5, 7]
      : [1, 2, 5];

  const out: number[] = [];
  const eps = 1e-9;
  for (let dec = startDec; dec <= endDec; dec += 1) {
    const base = Math.pow(10, dec);
    for (const mantissa of mantissas) {
      const v = mantissa * base;
      if (v >= min * (1 - eps) && v <= max * (1 + eps)) {
        out.push(v);
      }
    }
  }

  return dedupeSorted(out);
}

export function computeMinorTicksLinear(majors: number[], subdivisions = 5): number[] {
  if (majors.length < 2 || subdivisions < 2) return [];

  const out: number[] = [];
  for (let i = 0; i < majors.length - 1; i += 1) {
    const start = majors[i];
    const end = majors[i + 1];
    const step = (end - start) / subdivisions;
    if (!(Math.abs(step) > 0)) continue;
    for (let k = 1; k < subdivisions; k += 1) {
      out.push(start + step * k);
    }
  }
  return out;
}

export function computeMinorTicksLog(min: number, max: number): number[] {
  if (!(min > 0) || !(max > min)) return [];

  const startDec = Math.floor(Math.log10(min));
  const endDec = Math.ceil(Math.log10(max));
  const out: number[] = [];
  const eps = 1e-9;

  for (let dec = startDec; dec <= endDec; dec += 1) {
    const base = Math.pow(10, dec);
    for (let k = 2; k <= 9; k += 1) {
      const v = k * base;
      if (v >= min * (1 - eps) && v <= max * (1 + eps)) {
        out.push(v);
      }
    }
  }

  return dedupeSorted(out);
}

export function logFraction(value: number, domain: [number, number]): number {
  const [d0, d1] = domain;
  if (!(value > 0) || !(d0 > 0) || !(d1 > 0) || d0 === d1) return 0;
  return (Math.log10(value) - Math.log10(d0)) / (Math.log10(d1) - Math.log10(d0));
}

export function fractionToLogValue(fraction: number, domain: [number, number]): number {
  const [d0, d1] = domain;
  if (!(d0 > 0) || !(d1 > 0)) return d0;
  return Math.pow(10, Math.log10(d0) + fraction * (Math.log10(d1) - Math.log10(d0)));
}
