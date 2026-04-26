import { resolve } from 'aurelia';
import { IRouter, type IRouteableComponent } from '@aurelia/router-direct';
import template from './auto-spline-page.html?raw';
import { chartFileUrl, getChart, previewChartRandomSplinePoints, type ChartCreateResponse } from '../../api/client';
import { chartStatusBadgeClass, chartStatusLabel } from '../shared/chart-utils';
import { sessionState } from '../state/session-state';

const AUTO_SPLINE_MIN_POINT_COUNT = 3;

export class AutoSplinePage implements IRouteableComponent {
  public static readonly $au = { type: 'custom-element', name: 'auto-spline-page', template };

  private readonly router = resolve(IRouter);

  public chartId = 0;
  public chart: ChartCreateResponse | null = null;
  public error = '';
  public buildError = '';
  public building = false;
  public selectedPointCount = 0;
  public previewResultJson: unknown = null;

  private pollTimer: number | null = null;

  public readonly onEditorResultJsonChange = (next: unknown) => {
    this.previewResultJson = next;
  };

  public async loading(parameters: Record<string, string>): Promise<void> {
    const ok = await sessionState.ensureAuthenticated(this.router);
    if (!ok) {
      return;
    }

    this.chartId = Number(parameters.id ?? 0);
    this.chart = null;
    this.error = '';
    this.buildError = '';
    this.building = false;
    this.selectedPointCount = 0;
    this.previewResultJson = null;

    if (!Number.isFinite(this.chartId) || this.chartId <= 0) {
      this.error = 'Некорректный id графика';
      return;
    }

    await this.loadOnce();
    this.startPollingIfNeeded();

    const currentChart = this.chart;
    if (this.chartStatusOf(currentChart) === 'done' && this.previewResultJson === null && !this.building) {
      await this.build();
    }
  }

  public detaching(): void {
    this.stopPolling();
  }

  public get chartStatusText(): string {
    const status = this.chartStatusOf(this.chart);
    return status ? chartStatusLabel(status) : '';
  }

  public get chartStatusClass(): string {
    const status = this.chartStatusOf(this.chart);
    return status ? chartStatusBadgeClass(status) : '';
  }

  public get canBuild(): boolean {
    return this.chartStatusOf(this.chart) === 'done' && !this.building;
  }

  public get editorResultJson(): unknown {
    return this.previewResultJson ?? this.chart?.resultJson ?? null;
  }

  public get backdropImageUrl(): string | undefined {
    return this.chart ? chartFileUrl(this.chart.id, 'original') : undefined;
  }

  public async build(): Promise<void> {
    if (!this.chart || this.chart.status !== 'done') {
      return;
    }

    this.building = true;
    this.buildError = '';
    this.selectedPointCount = AUTO_SPLINE_MIN_POINT_COUNT;

    try {
      const preview = await previewChartRandomSplinePoints(this.chart.id, this.selectedPointCount, this.editorResultJson);
      this.previewResultJson = preview.resultJson ?? null;
      this.selectedPointCount = this.deriveSelectedPointCount(this.previewResultJson);
    } catch (error) {
      this.buildError = error instanceof Error ? error.message : 'Ошибка построения автосплайна';
    } finally {
      this.building = false;
    }
  }

  private async loadOnce(): Promise<void> {
    try {
      const fresh = await getChart(this.chartId);
      this.chart = fresh;

      if (this.chartStatusOf(fresh) !== 'processing' && this.chartStatusOf(fresh) !== 'uploaded') {
        this.stopPolling();
      }
    } catch (error) {
      this.stopPolling();
      this.error = error instanceof Error ? error.message : 'Ошибка загрузки графика';
    }
  }

  private startPollingIfNeeded(): void {
    const status = this.chartStatusOf(this.chart);
    if (!this.chart || (status !== 'processing' && status !== 'uploaded')) {
      return;
    }

    this.stopPolling();
    this.pollTimer = window.setInterval(() => {
      void this.loadOnce().then(async () => {
        const currentChart = this.chart;
        if (this.chartStatusOf(currentChart) === 'done' && this.previewResultJson === null && !this.building) {
          await this.build();
        }
      });
    }, 1500);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private deriveSelectedPointCount(source: unknown): number {
    if (!source || typeof source !== 'object') {
      return 0;
    }

    const panels = (source as Record<string, unknown>).panels;
    if (!Array.isArray(panels)) {
      return 0;
    }

    const firstPanel = panels.find((panel): panel is Record<string, unknown> => !!panel && typeof panel === 'object');
    const series = Array.isArray(firstPanel?.series) ? firstPanel.series : [];
    const firstSeries = series.find((item): item is Record<string, unknown> => !!item && typeof item === 'object');
    const points = Array.isArray(firstSeries?.points) ? firstSeries.points : [];
    return points.length;
  }

  private chartStatusOf(chart: ChartCreateResponse | null): ChartCreateResponse['status'] | null {
    return chart ? chart.status : null;
  }
}
