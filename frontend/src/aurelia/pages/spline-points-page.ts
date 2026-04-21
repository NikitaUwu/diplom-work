import { resolve } from 'aurelia';
import { IRouter, type IRouteableComponent } from '@aurelia/router-direct';
import template from './spline-points-page.html?raw';
import { getChart, previewChartSplinePoints, type ChartCreateResponse } from '../../api/client';
import { chartStatusBadgeClass, chartStatusLabel } from '../shared/chart-utils';
import { sessionState } from '../state/session-state';

export class SplinePointsPage implements IRouteableComponent {
  public static readonly $au = { type: 'custom-element', name: 'spline-points-page', template };

  private readonly router = resolve(IRouter);

  public chartId = 0;
  public chart: ChartCreateResponse | null = null;
  public error = '';
  public buildError = '';
  public building = false;
  public pointCount = 3;
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
    this.pointCount = 3;
    this.previewResultJson = null;

    if (!Number.isFinite(this.chartId) || this.chartId <= 0) {
      this.error = 'Некорректный id графика';
      return;
    }

    await this.loadOnce();
    this.startPollingIfNeeded();
  }

  public detaching(): void {
    this.stopPolling();
  }

  public get chartStatusText(): string {
    return this.chart ? chartStatusLabel(this.chart.status) : '';
  }

  public get chartStatusClass(): string {
    return this.chart ? chartStatusBadgeClass(this.chart.status) : '';
  }

  public get canBuild(): boolean {
    return this.chart?.status === 'done' && this.pointCount >= 2 && !this.building;
  }

  public get editorResultJson(): unknown {
    return this.previewResultJson ?? this.chart?.resultJson ?? null;
  }

  public onPointCountInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const nextValue = Number(input?.value ?? 3);
    if (!Number.isFinite(nextValue)) {
      return;
    }

    this.pointCount = Math.max(2, Math.round(nextValue));
  }

  public async build(): Promise<void> {
    if (!this.chart || this.chart.status !== 'done') {
      return;
    }

    this.building = true;
    this.buildError = '';

    try {
      const preview = await previewChartSplinePoints(this.chart.id, this.pointCount);
      this.previewResultJson = preview.resultJson ?? null;
    } catch (error) {
      this.buildError = error instanceof Error ? error.message : 'Ошибка построения предпросмотра сплайна';
    } finally {
      this.building = false;
    }
  }

  private async loadOnce(): Promise<void> {
    try {
      const fresh = await getChart(this.chartId);
      this.chart = fresh;

      if (fresh.status !== 'processing' && fresh.status !== 'uploaded') {
        this.stopPolling();
      }
    } catch (error) {
      this.stopPolling();
      this.error = error instanceof Error ? error.message : 'Ошибка загрузки графика';
    }
  }

  private startPollingIfNeeded(): void {
    if (!this.chart || (this.chart.status !== 'processing' && this.chart.status !== 'uploaded')) {
      return;
    }

    this.stopPolling();
    this.pollTimer = window.setInterval(() => {
      void this.loadOnce();
    }, 1500);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
