type PointTuple = [number, number];

type ExportSeries = {
  name: string;
  points: Array<{ x: number; y: number }>;
};

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getPanels(source: unknown): Record<string, unknown>[] {
  if (!isObj(source)) {
    return [];
  }

  const panels = source.panels;
  return Array.isArray(panels)
    ? panels.filter((panel): panel is Record<string, unknown> => isObj(panel))
    : [];
}

function getSeries(source: Record<string, unknown>): Record<string, unknown>[] {
  const series = source.series;
  return Array.isArray(series)
    ? series.filter((item): item is Record<string, unknown> => isObj(item))
    : [];
}

function getPoints(source: unknown): PointTuple[] {
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .filter((point): point is unknown[] => Array.isArray(point) && point.length >= 2)
    .map((point) => [Number(point[0]), Number(point[1])] as PointTuple)
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  if (/[",\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function buildSeries(source: unknown, useSupportPointMeta: boolean): ExportSeries[] {
  return getPanels(source).flatMap((panel, panelIndex) =>
    getSeries(panel).flatMap((series, seriesIndex) => {
      const fallbackSeriesName = stringValue(series.name) ?? `Кривая ${panelIndex + 1}.${seriesIndex + 1}`;
      const seriesName = useSupportPointMeta
        ? stringValue(series.source_name) ?? fallbackSeriesName
        : fallbackSeriesName;

      const points = getPoints(series.points).map((point) => ({ x: point[0], y: point[1] }));
      if (points.length === 0) {
        return [];
      }

      return [{ name: seriesName, points }];
    }),
  );
}

function downloadBlob(fileName: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function extractAutoSplinePayload(source: unknown): unknown {
  if (!isObj(source)) {
    return null;
  }

  const payload = source.auto_spline;
  return isObj(payload) ? payload : null;
}

export function hasExportableSeries(source: unknown, useSupportPointMeta = false): boolean {
  return buildSeries(source, useSupportPointMeta).length > 0;
}

export function downloadSeriesCsv(source: unknown, fileName: string, useSupportPointMeta = false): boolean {
  const seriesList = buildSeries(source, useSupportPointMeta);
  if (seriesList.length === 0) {
    return false;
  }

  const lines = [
    ['curve_name', 'x', 'y'].join(','),
    ...seriesList.flatMap((series) =>
      series.points.map((point) => [
        escapeCsv(series.name),
        escapeCsv(point.x),
        escapeCsv(point.y),
      ].join(',')),
    ),
  ];

  downloadBlob(fileName, lines.join('\n'), 'text/csv;charset=utf-8');
  return true;
}

export function downloadSeriesJson(source: unknown, fileName: string, useSupportPointMeta = false): boolean {
  const seriesList = buildSeries(source, useSupportPointMeta);
  if (seriesList.length === 0) {
    return false;
  }

  downloadBlob(fileName, JSON.stringify(seriesList, null, 2), 'application/json;charset=utf-8');
  return true;
}
