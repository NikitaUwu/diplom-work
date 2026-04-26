import { resolve } from 'aurelia';
import { IRouter, type IRouteableComponent } from '@aurelia/router-direct';
import template from './chart-page.html?raw';
import {
  chartFileUrl,
  getChart,
  previewChartRandomSplinePoints,
  saveChartResult,
  type ChartCreateResponse,
} from '../../api/client';
import { downloadSeriesCsv, downloadSeriesJson, hasExportableSeries } from '../shared/chart-export';
import { buildArtifactsCarousel, chartStatusBadgeClass, chartStatusLabel, hasRenderableEditorResult } from '../shared/chart-utils';
import { sessionState } from '../state/session-state';

const AUTO_SPLINE_MIN_POINT_COUNT = 3;

export class ChartPage implements IRouteableComponent {
  public static readonly $au = { type: 'custom-element', name: 'chart-page', template };

  private readonly router = resolve(IRouter);

  public chartId = 0;
  public chart: ChartCreateResponse | null = null;
  public error = '';
  public pollError = '';
  public editedResultJson: unknown = null;
  public autoSplineHighlightResultJson: unknown = null;
  public autoSplineError = '';
  public autoSplineLoading = false;
  public autoSplinePointCount = 0;
  public showOnlyAutoSplinePoints = false;
  public showAutoSplineHighlight = true;
  public showAutoSplineInfo = false;
  public saveError = '';
  public saving = false;
  public showOriginalBackdrop = false;

  private pollTimer: number | null = null;
  private pollInFlight = false;
  private pollEpoch = 0;

  public readonly onEditorResultJsonChange = (next: unknown) => {
    const hadAutoSpline = this.autoSplineSelectedPointCount > 0;
    this.setDraftResultJson(next);
    this.autoSplineHighlightResultJson = this.extractStoredAutoSplineResultJson(next);
    this.autoSplineError = '';
    this.autoSplinePointCount = this.deriveStoredAutoSplinePointCount(this.autoSplineHighlightResultJson);
    if (!this.autoSplineHighlightResultJson) {
      this.showOnlyAutoSplinePoints = false;
      this.showAutoSplineHighlight = true;
      this.showAutoSplineInfo = false;
    } else if (!hadAutoSpline) {
      this.showAutoSplineInfo = true;
    }
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
    this.autoSplineHighlightResultJson = null;
    this.autoSplineError = '';
    this.autoSplineLoading = false;
    this.autoSplinePointCount = 0;
    this.showOnlyAutoSplinePoints = false;
    this.showAutoSplineHighlight = true;
    this.showAutoSplineInfo = false;
    this.saveError = '';
    this.error = '';
    this.pollError = '';
    this.showOriginalBackdrop = false;

    if (!Number.isFinite(this.chartId) || this.chartId <= 0) {
      this.error = 'Некорректный id графика';
      return;
    }

    await this.loadOnce();
    this.showAutoSplineInfo = this.hasAutoSplineResult;
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

  public get autoSplineResultJson(): unknown {
    return this.autoSplineHighlightResultJson ?? this.extractStoredAutoSplineResultJson(this.editorResultJson);
  }

  public get visibleAutoSplineResultJson(): unknown {
    if (!this.showAutoSplineHighlight) {
      return null;
    }

    return this.autoSplineResultJson;
  }

  public get autoSplineSelectedPointCount(): number {
    if (this.autoSplinePointCount > 0) {
      return this.autoSplinePointCount;
    }

    return this.deriveStoredAutoSplinePointCount(this.autoSplineResultJson);
  }

  public get hasAutoSplineResult(): boolean {
    return this.autoSplineSelectedPointCount > 0;
  }

  public get dirty(): boolean {
    return this.editedResultJson !== null;
  }

  public get canSave(): boolean {
    return this.chart?.status === 'done' && this.dirty && this.hasRenderableEditorDraft && !this.saving;
  }

  public get canBuildAutoSpline(): boolean {
    return this.chart?.status === 'done' && this.hasRenderableEditorDraft && !this.autoSplineLoading;
  }

  public get hasExportableResult(): boolean {
    return this.hasRenderableServerResult;
  }

  public get canExportAllPoints(): boolean {
    return hasExportableSeries(this.editorResultJson);
  }

  public get canExportAutoSplinePoints(): boolean {
    return hasExportableSeries(this.autoSplineResultJson, true);
  }

  public toggleBackdrop(): void {
    this.showOriginalBackdrop = !this.showOriginalBackdrop;
  }

  public dismissAutoSplineInfo(): void {
    this.showAutoSplineInfo = false;
  }

  public toggleOnlyAutoSplinePoints(): void {
    if (!this.hasAutoSplineResult) {
      this.showOnlyAutoSplinePoints = false;
      return;
    }

    this.showOnlyAutoSplinePoints = !this.showOnlyAutoSplinePoints;
    if (this.showOnlyAutoSplinePoints) {
      this.showAutoSplineHighlight = true;
    }
  }

  public toggleAutoSplineHighlight(): void {
    if (!this.hasAutoSplineResult) {
      this.showAutoSplineHighlight = true;
      return;
    }

    this.showAutoSplineHighlight = !this.showAutoSplineHighlight;
    if (!this.showAutoSplineHighlight) {
      this.showOnlyAutoSplinePoints = false;
    }
  }

  public get backdropImageUrl(): string | undefined {
    return this.chart ? chartFileUrl(this.chart.id, 'original') : undefined;
  }

  public async buildAutoSpline(): Promise<void> {
    if (!this.chart || !this.canBuildAutoSpline) {
      return;
    }

    this.autoSplineLoading = true;
    this.autoSplineError = '';
    this.autoSplinePointCount = AUTO_SPLINE_MIN_POINT_COUNT;
    this.showAutoSplineHighlight = true;

    try {
      const preview = await previewChartRandomSplinePoints(this.chart.id, this.autoSplinePointCount, this.editorResultJson);
      const nextDraft = this.withStoredAutoSpline(this.editorResultJson, preview.resultJson ?? null, this.autoSplinePointCount);
      this.autoSplineHighlightResultJson = this.extractStoredAutoSplineResultJson(nextDraft);
      this.autoSplinePointCount = this.deriveStoredAutoSplinePointCount(this.autoSplineHighlightResultJson);
      this.showAutoSplineInfo = this.autoSplinePointCount > 0;
      this.setDraftResultJson(nextDraft);
    } catch (error) {
      this.autoSplineHighlightResultJson = null;
      this.showAutoSplineInfo = false;
      this.autoSplineError = error instanceof Error ? error.message : 'Ошибка построения автосплайна';
    } finally {
      this.autoSplineLoading = false;
    }
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
      this.autoSplineHighlightResultJson = this.extractStoredAutoSplineResultJson(fresh.resultJson ?? null);
      this.autoSplineError = '';
      this.autoSplinePointCount = this.deriveStoredAutoSplinePointCount(this.autoSplineHighlightResultJson);
      this.showAutoSplineInfo = this.autoSplinePointCount > 0;
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : 'Ошибка сохранения';
    } finally {
      this.saving = false;
    }
  }

  public exportAllPointsCsv(): void {
    const ok = downloadSeriesCsv(this.editorResultJson, `chart-${this.chartId}-all-points.csv`);
    if (!ok) {
      this.saveError = 'Не удалось экспортировать все точки: данные отсутствуют.';
    }
  }

  public exportAllPointsJson(): void {
    const ok = downloadSeriesJson(this.editorResultJson, `chart-${this.chartId}-all-points.json`);
    if (!ok) {
      this.saveError = 'Не удалось экспортировать все точки: данные отсутствуют.';
    }
  }

  public exportAutoSplinePointsCsv(): void {
    const ok = downloadSeriesCsv(this.autoSplineResultJson, `chart-${this.chartId}-support-points.csv`, true);
    if (!ok) {
      this.saveError = 'Не удалось экспортировать опорные точки: автосплайн ещё не построен.';
    }
  }

  public exportAutoSplinePointsJson(): void {
    const ok = downloadSeriesJson(this.autoSplineResultJson, `chart-${this.chartId}-support-points.json`, true);
    if (!ok) {
      this.saveError = 'Не удалось экспортировать опорные точки: автосплайн ещё не построен.';
    }
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

  private withStoredAutoSpline(baseResultJson: unknown, previewResultJson: unknown, selectedPointCount: number): unknown {
    const next = this.cloneJsonObject(baseResultJson);
    const autoSpline = this.buildAutoSplinePayload(baseResultJson, previewResultJson, selectedPointCount);

    if (autoSpline) {
      next.auto_spline = autoSpline;
    } else {
      delete next.auto_spline;
    }

    return next;
  }

  private buildAutoSplinePayload(baseResultJson: unknown, previewResultJson: unknown, selectedPointCount: number): Record<string, unknown> | null {
    const previewPanels = this.getPanels(previewResultJson);
    if (previewPanels.length === 0) {
      return null;
    }

    const basePanels = this.getPanels(baseResultJson);
    const panels: Record<string, unknown>[] = previewPanels
      .map((previewPanel, panelIndex) => {
        const previewSeries = this.getSeries(previewPanel);
        const baseSeries = this.getSeries(basePanels[panelIndex]);
        const nextSeries: Record<string, unknown>[] = previewSeries
          .map((previewSeriesItem, seriesIndex) => {
            const baseSeriesItem = baseSeries[seriesIndex];
            const sourceSeriesId = this.stringValue(baseSeriesItem?.id) ?? this.stringValue(previewSeriesItem?.id) ?? `series_${panelIndex + 1}_${seriesIndex + 1}`;
            const sourceName = this.stringValue(baseSeriesItem?.name) ?? this.stringValue(previewSeriesItem?.name) ?? `Кривая ${seriesIndex + 1}`;
            const points = this.clonePointList(previewSeriesItem?.points);
            const curvePoints = this.clonePointList(previewSeriesItem?.curve_points);

            if (points.length === 0 && curvePoints.length === 0) {
              return null;
            }

            return {
              id: `${sourceSeriesId}_spline`,
              source_series_id: sourceSeriesId,
              name: `${sourceName}_spline`,
              source_name: sourceName,
              points,
              curve_points: curvePoints,
            };
          })
          .filter((series) => series !== null) as Record<string, unknown>[];

        if (nextSeries.length === 0) {
          return null;
        }

        return {
          id: this.stringValue(previewPanel?.id) ?? this.stringValue(basePanels[panelIndex]?.id) ?? `panel_${panelIndex + 1}`,
          series: nextSeries,
        };
      })
      .filter((panel) => panel !== null) as Record<string, unknown>[];

    if (panels.length === 0) {
      return null;
    }

    const actualSelectedPointCount = this.deriveStoredAutoSplinePointCount({ panels });

    return {
      selected_point_count: actualSelectedPointCount > 0 ? actualSelectedPointCount : selectedPointCount,
      panels,
    };
  }

  private extractStoredAutoSplineResultJson(source: unknown): unknown {
    if (!source || typeof source !== 'object') {
      return null;
    }

    const raw = (source as Record<string, unknown>).auto_spline;
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const panels = (raw as Record<string, unknown>).panels;
    if (!Array.isArray(panels)) {
      return null;
    }

    const selectedPointCount = Number((raw as Record<string, unknown>).selected_point_count ?? 0);
    return {
      selected_point_count: Number.isFinite(selectedPointCount) && selectedPointCount > 0 ? Math.round(selectedPointCount) : undefined,
      panels: this.cloneJsonValue(panels),
    };
  }

  private deriveStoredAutoSplinePointCount(source: unknown): number {
    if (!source || typeof source !== 'object') {
      return 0;
    }

    const explicitCount = Number((source as Record<string, unknown>).selected_point_count ?? 0);
    if (Number.isFinite(explicitCount) && explicitCount > 0) {
      return Math.round(explicitCount);
    }

    const panels = this.getPanels(source);
    const firstSeries = panels.flatMap(panel => this.getSeries(panel))[0];
    return this.clonePointList(firstSeries?.points).length;
  }

  private getPanels(source: unknown): Record<string, unknown>[] {
    if (!source || typeof source !== 'object') {
      return [];
    }

    const panels = (source as Record<string, unknown>).panels;
    return Array.isArray(panels)
      ? panels.filter((panel): panel is Record<string, unknown> => !!panel && typeof panel === 'object')
      : [];
  }

  private getSeries(source: Record<string, unknown> | undefined): Record<string, unknown>[] {
    if (!source) {
      return [];
    }

    const series = source.series;
    return Array.isArray(series)
      ? series.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      : [];
  }

  private clonePointList(source: unknown): number[][] {
    if (!Array.isArray(source)) {
      return [];
    }

    return source
      .filter((point): point is unknown[] => Array.isArray(point) && point.length >= 2)
      .map((point) => [Number(point[0]), Number(point[1])])
      .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private cloneJsonObject(source: unknown): Record<string, unknown> {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return {};
    }

    return this.cloneJsonValue(source) as Record<string, unknown>;
  }

  private cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
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
