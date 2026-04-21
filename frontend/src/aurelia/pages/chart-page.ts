import { resolve } from 'aurelia';
import { IRouter, type IRouteableComponent } from '@aurelia/router-direct';
import template from './chart-page.html?raw';
import {
  chartExportUrl,
  chartFileUrl,
  getChart,
  saveChartResult,
  type ChartCreateResponse,
  type ChartExportFormat,
} from '../../api/client';
import { buildArtifactsCarousel, chartStatusBadgeClass, chartStatusLabel, hasRenderableEditorResult } from '../shared/chart-utils';
import { sessionState } from '../state/session-state';

export class ChartPage implements IRouteableComponent {
  public static readonly $au = { type: 'custom-element', name: 'chart-page', template };

  private readonly router = resolve(IRouter);

  public chartId = 0;
  public chart: ChartCreateResponse | null = null;
  public error = '';
  public pollError = '';
  public editedResultJson: unknown = null;
  public saveError = '';
  public saving = false;
  public showOriginalBackdrop = false;

  private pollTimer: number | null = null;
  private pollInFlight = false;
  private pollEpoch = 0;

  public readonly onEditorResultJsonChange = (next: unknown) => {
    this.setDraftResultJson(next);
  };

  public async loading(parameters: Record<string, string>): Promise<void> {
    const ok = await sessionState.ensureAuthenticated(this.router);
    if (!ok) {
      return;
    }

    this.stopPolling();

    this.chartId = Number(parameters.id ?? 0);
    this.chart = null;
    this.editedResultJson = null;
    this.saveError = '';
    this.error = '';
    this.pollError = '';
    this.showOriginalBackdrop = false;

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

  public get artifactsItems() {
    return this.chart ? buildArtifactsCarousel(this.chart) : [];
  }

  public get hasRenderableServerResult(): boolean {
    return this.chart?.status === 'done' && hasRenderableEditorResult(this.serverResultJson);
  }

  public get hasRenderableEditorDraft(): boolean {
    return this.chart?.status === 'done' && hasRenderableEditorResult(this.editorResultJson);
  }

  public get showEditor(): boolean {
    return this.hasRenderableEditorDraft;
  }

  public get isAwaitingEditorData(): boolean {
    return this.chart?.status === 'done' && !this.hasRenderableServerResult;
  }

  public get serverResultJson(): unknown {
    return this.chart?.resultJson ?? null;
  }

  public get editorResultJson(): unknown {
    return this.editedResultJson ?? this.serverResultJson;
  }

  public get dirty(): boolean {
    return this.editedResultJson !== null;
  }

  public get canSave(): boolean {
    return this.chart?.status === 'done' && this.dirty && this.hasRenderableEditorDraft && !this.saving;
  }

  public get hasExportableResult(): boolean {
    return this.hasRenderableServerResult;
  }

  public get canExport(): boolean {
    return this.hasExportableResult && !this.dirty;
  }

  public toggleBackdrop(): void {
    this.showOriginalBackdrop = !this.showOriginalBackdrop;
  }

  public get backdropImageUrl(): string | undefined {
    return this.chart ? chartFileUrl(this.chart.id, 'original') : undefined;
  }

  public async save(): Promise<void> {
    if (!this.chart || !this.canSave || this.editedResultJson === null) {
      return;
    }

    this.saving = true;
    this.saveError = '';

    try {
      const fresh = await saveChartResult(this.chart.id, this.editedResultJson);
      this.chart = fresh;
      this.editedResultJson = null;
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : 'Ошибка сохранения';
    } finally {
      this.saving = false;
    }
  }

  public exportUrl(format: ChartExportFormat): string {
    return chartExportUrl(this.chartId, format);
  }

  private setDraftResultJson(next: unknown): void {
    if (this.areResultJsonEqual(next, this.serverResultJson)) {
      this.editedResultJson = null;
      return;
    }

    this.editedResultJson = next;
  }

  private areResultJsonEqual(left: unknown, right: unknown): boolean {
    return this.stableSerialize(left) === this.stableSerialize(right);
  }

  private stableSerialize(value: unknown): string {
    return JSON.stringify(this.normalizeForCompare(value));
  }

  private normalizeForCompare(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.normalizeForCompare(item));
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, this.normalizeForCompare(nestedValue)]);

      return Object.fromEntries(entries);
    }

    return value;
  }

  private async loadOnce(options: { softOnError?: boolean } = {}): Promise<boolean> {
    try {
      const fresh = await getChart(this.chartId);
      this.chart = fresh;
      this.error = '';
      this.pollError = '';

      if (fresh.status === 'done' && this.editedResultJson !== null && this.areResultJsonEqual(this.editedResultJson, fresh.resultJson)) {
        this.editedResultJson = null;
      }

      return this.shouldKeepPolling(fresh);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка при получении результата';

      if (options.softOnError && this.chart) {
        this.pollError = `Не удалось обновить статус графика: ${message}. Повторим автоматически.`;
        return true;
      }

      this.error = message;
      return false;
    }
  }

  private startPollingIfNeeded(): void {
    if (!this.shouldKeepPolling()) {
      return;
    }

    this.stopPolling();
    const epoch = this.pollEpoch;

    const scheduleNext = (): void => {
      if (this.pollEpoch !== epoch) {
        return;
      }

      this.pollTimer = window.setTimeout(() => {
        void tick();
      }, 1500);
    };

    const tick = async (): Promise<void> => {
      if (this.pollEpoch !== epoch || this.pollInFlight) {
        return;
      }

      this.pollTimer = null;
      this.pollInFlight = true;

      try {
        const shouldContinue = await this.loadOnce({ softOnError: true });
        if (this.pollEpoch !== epoch) {
          return;
        }

        if (shouldContinue && this.shouldKeepPolling()) {
          scheduleNext();
          return;
        }

        this.stopPolling();
      } finally {
        this.pollInFlight = false;
      }
    };

    scheduleNext();
  }

  private stopPolling(): void {
    this.pollEpoch += 1;
    this.pollInFlight = false;

    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private shouldKeepPolling(chart: ChartCreateResponse | null = this.chart): boolean {
    return !!chart && (
      chart.status === 'processing'
      || chart.status === 'uploaded'
      || (chart.status === 'done' && !hasRenderableEditorResult(chart.resultJson))
    );
  }
}
