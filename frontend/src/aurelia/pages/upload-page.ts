import template from './upload-page.html?raw';
import { getChart, uploadChart, type ChartCreateResponse } from '../../api/client';
import { clearActiveProcessingTimer, finishProcessingTimer, startProcessingTimer } from '../debug/upload-processing-timer';
import { navigateTo } from '../navigation';
import { chartStatusBadgeClass, chartStatusLabel } from '../shared/chart-utils';
import { sessionState } from '../state/session-state';

export class UploadPage {
  public static readonly $au = { type: 'custom-element', name: 'upload-page', template };

  public file: File | null = null;
  public previewUrl = '';
  public isUploading = false;
  public chart: ChartCreateResponse | null = null;
  public error = '';
  public lineformerUsePreprocessing = true;

  private pollTimer: number | null = null;

  public async binding(): Promise<void> {
    const ok = await sessionState.ensureAuthenticated();
    if (!ok) {
      return;
    }
  }

  public detaching(): void {
    this.stopPolling();
    this.revokePreview();
  }

  public get chartStatusText(): string {
    return this.chart ? chartStatusLabel(this.chart.status) : '';
  }

  public get chartStatusClass(): string {
    return this.chart ? chartStatusBadgeClass(this.chart.status) : '';
  }

  public get previewDescription(): string {
    if (!this.file) {
      return 'Файл не выбран';
    }

    return `${this.file.name} • ${(this.file.size / 1024).toFixed(0)} KB`;
  }

  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const nextFile = input?.files?.[0] ?? null;

    this.file = nextFile;
    this.chart = null;
    this.error = '';
    this.revokePreview();

    if (!nextFile) {
      return;
    }

    this.previewUrl = URL.createObjectURL(nextFile);
  }

  public async upload(): Promise<void> {
    if (!this.file) {
      return;
    }

    this.stopPolling();
    this.chart = null;
    this.error = '';
    this.isUploading = true;
    startProcessingTimer(this.file);

    try {
      const response = await uploadChart(this.file, this.lineformerUsePreprocessing);
      this.chart = response;
      this.startPolling(response.id);
    } catch (error) {
      clearActiveProcessingTimer();
      this.error = error instanceof Error ? error.message : 'Ошибка загрузки';
    } finally {
      this.isUploading = false;
    }
  }

  public reset(): void {
    this.stopPolling();
    this.chart = null;
    this.error = '';
    this.file = null;
    clearActiveProcessingTimer();
    this.revokePreview();
  }

  private startPolling(chartId: number): void {
    this.stopPolling();

    this.pollTimer = window.setInterval(async () => {
      try {
        const fresh = await getChart(chartId);
        this.chart = fresh;

        if (fresh.status === 'error') {
          this.stopPolling();
          finishProcessingTimer(chartId);
          navigateTo(`/charts/${chartId}`);
          return;
        }

        if (fresh.status === 'done') {
          this.stopPolling();
          finishProcessingTimer(chartId);
          navigateTo(`/charts/${chartId}`);
        }
      } catch (error) {
        this.stopPolling();
        this.error = error instanceof Error ? error.message : 'Ошибка при получении статуса обработки';
      }
    }, 1500);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private revokePreview(): void {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = '';
    }
  }
}
