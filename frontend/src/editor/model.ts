import type { EditorOverlayCalibration, EditorResultJson, Panel, View } from "./types";
import { isObj, parseOverlayAxisSamples, parsePointList, toFiniteNumber, uid } from "./utils";

export function parsePanels(resultJson: unknown): Panel[] {
  if (!isObj(resultJson)) return [{ series: [] }];

  const panelsRaw = (resultJson as any).panels;
  if (!Array.isArray(panelsRaw) || panelsRaw.length === 0) return [{ series: [] }];

  return panelsRaw.map((panelRaw: any, panelIndex: number) => {
    const seriesRaw = Array.isArray(panelRaw?.series) ? panelRaw.series : [];
    const series = seriesRaw.map((seriesItem: any, seriesIndex: number) => ({
      id: String(seriesItem?.id ?? uid(`s${panelIndex}_${seriesIndex}`)),
      name: String(seriesItem?.name ?? `Кривая ${seriesIndex + 1}`),
      points: parsePointList(seriesItem?.points),
      curvePoints: parsePointList(seriesItem?.curve_points),
    }));

    return { id: panelRaw?.id != null ? String(panelRaw.id) : undefined, series };
  });
}

export function parseEditorOverlayCalibration(resultJson: unknown): EditorOverlayCalibration | null {
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

  return {
    artifactKey: typeof rawOverlay.artifact_key === "string" && rawOverlay.artifact_key.trim() ? rawOverlay.artifact_key : "original",
    plotArea: { left, top, right, bottom },
    xDomain: [x0, x1],
    yDomain: [Math.min(y0, y1), Math.max(y0, y1)],
    xTicks: xAxisSamples.length ? xAxisSamples.map((sample) => sample.value) : xTicks,
    yTicks: yAxisSamples.length ? yAxisSamples.map((sample) => sample.value) : yTicks,
    xAxisSamples,
    yAxisSamples,
  };
}

export function defaultViewFromPanels(panels: Panel[], calibration: EditorOverlayCalibration | null): View {
  if (calibration) {
    return {
      domainX: [...calibration.xDomain] as [number, number],
      domainY: [...calibration.yDomain] as [number, number],
    };
  }

  const all = panels.flatMap((panel) =>
    panel.series.flatMap((series) => (series.points.length ? series.points : series.curvePoints))
  );
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

export function stripCurvePreview(panels: Panel[]): Panel[] {
  return panels.map((panel) => ({
    ...panel,
    series: panel.series.map((series) => ({
      ...series,
      curvePoints: [],
    })),
  }));
}

export function hasCurvePreview(panels: Panel[]): boolean {
  return panels.every((panel) =>
    panel.series.every((series) => series.points.length === 0 || series.curvePoints.length > 0)
  );
}

export function mergeCurvePreview(current: Panel[], preview: Panel[]): Panel[] {
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

export function buildNextResultJson(base: unknown, panels: Panel[]): any {
  const out: EditorResultJson = isObj(base) ? { ...(base as any) } : {};
  out.panels = panels.map((panel) => ({
    ...(panel.id != null ? { id: panel.id } : {}),
    series: panel.series.map((series) => ({
      id: series.id,
      name: series.name,
      points: series.points.map((point) => [point.x, point.y]),
    })),
  }));
  return out;
}
