const ACTIVE_TIMER_KEY = 'debug.processingTimer.active';
const RESULT_KEY_PREFIX = 'debug.processingTimer.result.';

type ActiveProcessingTimer = {
  startedAt: number;
  filename: string;
};

export type ProcessingTimerResult = ActiveProcessingTimer & {
  chartId: number;
  finishedAt: number;
  elapsedMs: number;
};

function readJson<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Этот таймер нужен только для отладки, поэтому не мешаем загрузке при ошибке хранилища.
  }
}

export function startProcessingTimer(file: File): void {
  writeJson(ACTIVE_TIMER_KEY, {
    startedAt: Date.now(),
    filename: file.name,
  } satisfies ActiveProcessingTimer);
}

export function clearActiveProcessingTimer(): void {
  try {
    window.sessionStorage.removeItem(ACTIVE_TIMER_KEY);
  } catch {
    // Ошибка очистки отладочного таймера не должна ломать страницу.
  }
}

export function finishProcessingTimer(chartId: number): void {
  const active = readJson<ActiveProcessingTimer>(ACTIVE_TIMER_KEY);
  if (!active || !Number.isFinite(active.startedAt)) {
    return;
  }

  const finishedAt = Date.now();
  writeJson(`${RESULT_KEY_PREFIX}${chartId}`, {
    ...active,
    chartId,
    finishedAt,
    elapsedMs: Math.max(0, finishedAt - active.startedAt),
  } satisfies ProcessingTimerResult);
  clearActiveProcessingTimer();
}

export function readProcessingTimerResult(chartId: number): ProcessingTimerResult | null {
  return readJson<ProcessingTimerResult>(`${RESULT_KEY_PREFIX}${chartId}`);
}

export function formatElapsedMs(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs)) {
    return '';
  }

  if (elapsedMs < 1000) {
    return `${Math.round(elapsedMs)} ms`;
  }

  return `${(elapsedMs / 1000).toFixed(2)} s`;
}
