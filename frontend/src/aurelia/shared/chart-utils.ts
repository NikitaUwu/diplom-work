import { chartFileUrl, type ChartCreateResponse, type ChartStatus } from '../../api/client';
import { parsePanels } from '../../editor/model';
import type { CarouselItem } from '../components/image-carousel';

export function chartStatusLabel(status: ChartStatus): string {
  switch (status) {
    case 'uploaded':
      return 'Файл принят';
    case 'processing':
      return 'Обработка';
    case 'done':
      return 'Готово';
    case 'error':
      return 'Ошибка';
    default:
      return status;
  }
}

export function chartStatusBadgeClass(status: ChartStatus): string {
  switch (status) {
    case 'done':
      return 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20';
    case 'processing':
      return 'bg-sky-100 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20';
    case 'error':
      return 'bg-rose-100 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20';
    default:
      return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-500/20';
  }
}

export function buildArtifactsCarousel(chart: ChartCreateResponse): CarouselItem[] {
  const resultJson = (chart.resultJson && typeof chart.resultJson === 'object'
    ? chart.resultJson
    : {}) as { artifacts?: Record<string, string> };
  const artifacts = resultJson.artifacts ?? {};

  return [
    { label: 'Оригинал', src: chartFileUrl(chart.id, 'original') },
    artifacts.lineformer_prediction
      ? { label: 'LineFormer', src: chartFileUrl(chart.id, 'lineformer_prediction') }
      : null,
    artifacts.chartdete_predictions
      ? { label: 'ChartDete', src: chartFileUrl(chart.id, 'chartdete_predictions') }
      : null,
    artifacts.converted_plot
      ? { label: 'Plot', src: chartFileUrl(chart.id, 'converted_plot') }
      : null,
  ].filter(Boolean) as CarouselItem[];
}

export function hasRenderableEditorResult(resultJson: unknown): boolean {
  return parsePanels(resultJson).some((panel) =>
    panel.series.some((series) => series.points.length > 0 || series.curvePoints.length > 0),
  );
}
