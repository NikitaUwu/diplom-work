import { resolve } from 'aurelia';
import { IRouter, type IRouteableComponent } from '@aurelia/router-direct';
import template from './results-page.html?raw';
import {
  chartExportUrl,
  deleteChart,
  listCharts,
  type ChartCreateResponse,
  type ChartExportFormat,
  type ChartStatus,
} from '../../api/client';
import { buildArtifactsCarousel, chartStatusBadgeClass, chartStatusLabel } from '../shared/chart-utils';
import { sessionState } from '../state/session-state';

export class ResultsPage implements IRouteableComponent {
  public static readonly $au = { type: 'custom-element', name: 'results-page', template };

  private readonly router = resolve(IRouter);

  public items: ChartCreateResponse[] = [];
  public isLoading = true;
  public error = '';
  public deletingId: number | null = null;

  public async loading(): Promise<void> {
    const ok = await sessionState.ensureAuthenticated(this.router);
    if (!ok) {
      return;
    }

    await this.load();
  }

  public async load(): Promise<void> {
    this.isLoading = true;
    this.error = '';

    try {
      this.items = await listCharts();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Ошибка загрузки списка результатов';
    } finally {
      this.isLoading = false;
    }
  }

  public async deleteItem(id: number): Promise<void> {
    const confirmed = window.confirm(`Удалить задачу #${id}?`);
    if (!confirmed) {
      return;
    }

    this.deletingId = id;
    this.error = '';

    try {
      await deleteChart(id);
      this.items = this.items.filter((item) => item.id !== id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Ошибка удаления';
    } finally {
      this.deletingId = null;
    }
  }

  public statusText(status: ChartStatus): string {
    return chartStatusLabel(status);
  }

  public statusClass(status: ChartStatus): string {
    return chartStatusBadgeClass(status);
  }

  public buildCarouselItems(chart: ChartCreateResponse) {
    return buildArtifactsCarousel(chart);
  }

  public exportUrl(chartId: number, format: ChartExportFormat): string {
    return chartExportUrl(chartId, format);
  }

  public formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }
}
