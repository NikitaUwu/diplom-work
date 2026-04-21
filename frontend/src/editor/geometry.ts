import { MIN_SPAN } from "./constants";
import type { AxisWarp, OverlayAxisSample } from "./types";
import { clamp } from "./utils";

function findSegment(knots: number[], value: number) {
  let index = knots.length - 2;
  for (let i = 0; i < knots.length - 1; i++) {
    if (value <= knots[i + 1]) return i;
  }
  return index;
}

export function normalizeWarp(warp: AxisWarp): AxisWarp {
  const dataKnots = warp.dataKnots.slice();
  const screenKnots = warp.screenKnots.slice();

  if (dataKnots.length < 2) return { dataKnots, screenKnots: [0, 1] };

  while (screenKnots.length < dataKnots.length) screenKnots.push(1);
  while (screenKnots.length > dataKnots.length) screenKnots.pop();

  screenKnots[0] = 0;
  screenKnots[screenKnots.length - 1] = 1;
  for (let i = 1; i < screenKnots.length - 1; i++) {
    screenKnots[i] = clamp(screenKnots[i], screenKnots[i - 1] + 0.01, screenKnots[i + 1] - 0.01);
  }
  screenKnots[screenKnots.length - 1] = 1;

  for (let i = 1; i < dataKnots.length; i++) dataKnots[i] = Math.max(dataKnots[i], dataKnots[i - 1] + 1e-9);

  return { dataKnots, screenKnots };
}

export function axisValueToScreen(value: number, domain: [number, number], warp: AxisWarp | null) {
  const [d0, d1] = domain;
  if (!Number.isFinite(value) || d0 === d1) return 0.5;

  if (!warp || warp.dataKnots.length < 2 || warp.screenKnots.length !== warp.dataKnots.length) {
    return (value - d0) / (d1 - d0);
  }

  const dk = warp.dataKnots;
  const sk = warp.screenKnots;
  const n = dk.length;

  if (value <= dk[0]) {
    const a = dk[0];
    const b = dk[1];
    const sa = sk[0];
    const sb = sk[1];
    const t = (value - a) / (b - a || 1);
    return sa + t * (sb - sa);
  }

  if (value >= dk[n - 1]) {
    const a = dk[n - 2];
    const b = dk[n - 1];
    const sa = sk[n - 2];
    const sb = sk[n - 1];
    const t = (value - a) / (b - a || 1);
    return sa + t * (sb - sa);
  }

  const i = findSegment(dk, value);
  const a = dk[i];
  const b = dk[i + 1];
  const sa = sk[i];
  const sb = sk[i + 1];
  const t = (value - a) / (b - a || 1);
  return sa + t * (sb - sa);
}

export function axisScreenToValue(screen: number, domain: [number, number], warp: AxisWarp | null) {
  const [d0, d1] = domain;
  if (!Number.isFinite(screen) || d0 === d1) return d0;

  if (!warp || warp.dataKnots.length < 2 || warp.screenKnots.length !== warp.dataKnots.length) {
    return d0 + clamp(screen, 0, 1) * (d1 - d0);
  }

  const dk = warp.dataKnots;
  const sk = warp.screenKnots;
  const s = clamp(screen, sk[0], sk[sk.length - 1]);
  const i = findSegment(sk, s);

  const sa = sk[i];
  const sb = sk[i + 1];
  const a = dk[i];
  const b = dk[i + 1];
  const t = (s - sa) / (sb - sa || 1);
  return a + t * (b - a);
}

export function buildWarpFromOverlaySamples(domain: [number, number], samples: OverlayAxisSample[]): AxisWarp | null {
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

export function remapDataKnots(oldKnots: number[], oldDomain: [number, number], newDomain: [number, number]) {
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
