import { BindingMode } from 'aurelia';
import template from './compact-graph-editor.html?raw';
import { previewChartResult } from '../../api/client';
import {
  COLOR_OPTIONS,
  DEFAULT_EDITOR_BOX,
  EDITOR_MARGIN,
  MAX_SERIES_LABEL,
  MAX_SERIES_NAME,
} from '../../editor/constants';
import { axisScreenToValue, axisValueToScreen, buildWarpFromOverlaySamples } from '../../editor/geometry';
import {
  buildNextResultJson,
  defaultViewFromPanels,
  hasCurvePreview,
  mergeCurvePreview,
  parseEditorOverlayCalibration,
  parsePanels,
  stripCurvePreview,
} from '../../editor/model';
import type {
  AxisWarp,
  DeleteSelectionBox,
  EditorOverlayCalibration,
  Panel,
  Point,
  Series,
  View,
} from '../../editor/types';
import { clamp, ellipsis, formatTick, niceTicks, normalizeSelectionBox, uid } from '../../editor/utils';

type LayoutBox = {
  l: number;
  t: number;
  pw: number;
  ph: number;
};

type HoverPoint = {
  cx: number;
  cy: number;
  x: number;
  y: number;
  seriesName: string;
};

type RenderPath = {
  id: string;
  d: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
};

type RenderPoint = {
  key: string;
  seriesId: string;
  seriesName: string;
  index: number;
  point: Point;
  cx: number;
  cy: number;
  hitRadius: number;
  handleRadius: number;
  fill: string;
  opacity: number;
  showHandle: boolean;
};

type ResizeAxis = 'x' | 'y' | 'both';

type ResizeDragState = {
  pointerId: number;
  axis: ResizeAxis;
  startClientX: number;
  startClientY: number;
  startWidth: number;
  startHeight: number;
};

type PointDragState = {
  pointerId: number;
  seriesId: string;
  index: number;
};

type DeleteDragState = {
  pointerId: number;
};

type EditorSnapshot = {
  panels: Panel[];
  view: View;
  warpX: AxisWarp | null;
  warpY: AxisWarp | null;
  activeSeriesId: string | null;
  colorById: Record<string, number>;
  visibleIds: string[];
  pointRadius: number;
  editorWidth: number;
  editorHeight: number;
};

export class CompactGraphEditor {
  public static readonly $au = {
    type: 'custom-element',
    name: 'compact-graph-editor',
    template,
    bindables: {
      chartId: { mode: BindingMode.toView },
      resultJson: { mode: BindingMode.toView },
      onResultJsonChange: { mode: BindingMode.toView },
      mode: { mode: BindingMode.toView },
      backdropImageUrl: { mode: BindingMode.toView },
      showBackdrop: { mode: BindingMode.toView },
    },
  };

  public chartId = 0;
  public resultJson: unknown = null;
  public onResultJsonChange?: (next: unknown) => void;
  public mode: 'compact' | 'full' = 'compact';
  public backdropImageUrl?: string;
  public showBackdrop = false;

  public panels: Panel[] = [{ series: [] }];
  public activeSeriesId: string | null = null;
  public pointRadius = 3;
  public error = '';
  public colorById: Record<string, number> = {};
  public hover: HoverPoint | null = null;
  public visOpen = false;
  public imageSize: { w: number; h: number } | null = null;
  public modeState: 'select' | 'delete-point' = 'select';
  public selection: { seriesId: string; index: number } | null = null;
  public deleteSelectionBox: DeleteSelectionBox | null = null;
  public editorWidth = DEFAULT_EDITOR_BOX.w;
  public editorHeight = DEFAULT_EDITOR_BOX.h;

  public svgElement?: SVGSVGElement;
  public visElement?: HTMLDivElement;

  private calibration: EditorOverlayCalibration | null = null;
  private view: View = { domainX: [0, 1], domainY: [0, 1] };
  private warpX: AxisWarp | null = null;
  private warpY: AxisWarp | null = null;
  private previewTimer: number | null = null;
  private previewRequestId = 0;
  private visibleIds = new Set<string>();
  private undoStack: EditorSnapshot[] = [];
  private pointDragState: PointDragState | null = null;
  private deleteDragState: DeleteDragState | null = null;
  private resizeDragState: ResizeDragState | null = null;
  private lastCanvasAddKey = '';
  private lastCanvasAddAt = 0;
  private clipId = uid('plotClip');

  public binding(): void {
    this.syncFromResultJson(true);
    this.ensureBackdropMetrics();
  }

  public attached(): void {
    window.addEventListener('pointermove', this.onWindowPointerMove);
    window.addEventListener('pointerup', this.onWindowPointerUp);
    window.addEventListener('mousedown', this.onWindowMouseDown);
    window.addEventListener('keydown', this.onWindowKeyDown);

    queueMicrotask(() => {
      if (this.resultJson) {
        this.syncFromResultJson(true);
      }
    });
  }

  public detaching(): void {
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    window.removeEventListener('pointerup', this.onWindowPointerUp);
    window.removeEventListener('mousedown', this.onWindowMouseDown);
    window.removeEventListener('keydown', this.onWindowKeyDown);

    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
  }

  public resultJsonChanged(): void {
    this.syncFromResultJson(false);
  }

  public backdropImageUrlChanged(): void {
    this.imageSize = null;
    this.ensureBackdropMetrics();
  }

  public showBackdropChanged(): void {
    this.ensureBackdropMetrics();
  }

  public get fullMode(): boolean {
    return this.mode === 'full';
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get visibleSeriesCount(): number {
    return this.seriesList.filter((series) => this.isSeriesVisible(series.id)).length;
  }

  public get seriesList(): Series[] {
    return this.panels[0]?.series ?? [];
  }

  public get activeSeries(): Series | null {
    return this.seriesList.find((series) => series.id === this.activeSeriesId) ?? null;
  }

  public get chartHint(): string {
    return this.modeState === 'delete-point'
      ? 'Режим: двойной клик по точке или выделение рамкой для удаления'
      : 'Двойной клик: добавить точку';
  }

  public get chartHintVisible(): boolean {
    return this.fullMode;
  }

  public get svgCursor(): string {
    return this.modeState === 'delete-point' ? 'crosshair' : 'default';
  }

  public get clipPathRef(): string {
    return `url(#${this.clipId})`;
  }

  public get baseBox(): { w: number; h: number } {
    if (this.imageSize) {
      return {
        w: Math.max(1, Math.round(this.imageSize.w)),
        h: Math.max(1, Math.round(this.imageSize.h)),
      };
    }

    return DEFAULT_EDITOR_BOX;
  }

  public get contentBox(): { w: number; h: number } {
    return this.baseBox;
  }

  public get windowBox(): { w: number; h: number } {
    return { w: this.editorWidth, h: this.editorHeight };
  }

  public get editorShellStyle(): string {
    return `width:${this.windowBox.w}px;height:${this.windowBox.h}px;`;
  }

  public get contentTransformStyle(): string {
    const box = this.contentBox;
    const scaleX = this.editorWidth / Math.max(box.w, 1);
    const scaleY = this.editorHeight / Math.max(box.h, 1);

    return [
      `width:${box.w}px`,
      `height:${box.h}px`,
      `transform:scale(${scaleX}, ${scaleY})`,
      'transform-origin:0 0',
    ].join(';');
  }

  public get layout(): LayoutBox {
    if (this.calibration && this.imageSize) {
      const plotWidth = Math.max(1, this.calibration.plotArea.right - this.calibration.plotArea.left);
      const plotHeight = Math.max(1, this.calibration.plotArea.bottom - this.calibration.plotArea.top);

      return {
        l: this.calibration.plotArea.left,
        t: this.calibration.plotArea.top,
        pw: plotWidth,
        ph: plotHeight,
      };
    }

    const box = this.contentBox;
    return {
      l: EDITOR_MARGIN.l,
      t: EDITOR_MARGIN.t,
      pw: box.w - EDITOR_MARGIN.l - EDITOR_MARGIN.r,
      ph: box.h - EDITOR_MARGIN.t - EDITOR_MARGIN.b,
    };
  }

  public get ticksX(): number[] {
    if (this.calibration?.xAxisSamples.length) {
      return this.calibration.xAxisSamples.map((sample) => sample.value);
    }
    if (this.calibration?.xTicks.length) {
      return this.calibration.xTicks;
    }
    return niceTicks(this.view.domainX[0], this.view.domainX[1], 6);
  }

  public get ticksY(): number[] {
    if (this.calibration?.yAxisSamples.length) {
      return this.calibration.yAxisSamples.map((sample) => sample.value);
    }
    if (this.calibration?.yTicks.length) {
      return this.calibration.yTicks;
    }
    return niceTicks(this.view.domainY[0], this.view.domainY[1], 6);
  }

  public get backdropFrame():
    | {
        x: number;
        y: number;
        width: number;
        height: number;
        opacity: number;
        clipPath: string | null;
      }
    | null {
    if (!this.showBackdrop || !this.backdropImageUrl) {
      return null;
    }

    if (this.imageSize) {
      const box = this.contentBox;
      return {
        x: 0,
        y: 0,
        width: box.w,
        height: box.h,
        opacity: 1,
        clipPath: null,
      };
    }

    const layout = this.layout;
    return {
      x: layout.l,
      y: layout.t,
      width: layout.pw,
      height: layout.ph,
      opacity: 0.35,
      clipPath: this.clipPathRef,
    };
  }

  public get backdropImageStyle(): string {
    const frame = this.backdropFrame;
    if (!frame) {
      return '';
    }

    return [
      `left:${frame.x}px`,
      `top:${frame.y}px`,
      `width:${frame.width}px`,
      `height:${frame.height}px`,
      `opacity:${frame.opacity}`,
      'object-fit:fill',
    ].join(';');
  }

  public get plotFill(): string {
    return this.backdropFrame ? 'rgba(248, 250, 252, 0.12)' : '#f8fafc';
  }

  public get hoverStyle(): string {
    if (!this.hover) {
      return '';
    }
    return `left:${this.hover.cx + 12}px;top:${this.hover.cy - 8}px;`;
  }

  public get pointRadiusText(): string {
    return `${this.pointRadius}px`;
  }

  public get currentColorIndex(): number {
    const activeSeries = this.activeSeries;
    return activeSeries ? clamp(this.colorById[activeSeries.id] ?? 0, 0, COLOR_OPTIONS.length - 1) : 0;
  }

  public get currentColorDotStyle(): string {
    const color = COLOR_OPTIONS[this.currentColorIndex];
    return `background-color:${color.strokeColor};`;
  }

  public get colorOptions() {
    return COLOR_OPTIONS;
  }

  public get paths() {
    return this.seriesList
      .filter((series) => this.isSeriesVisible(series.id))
      .map((series) => ({
        id: series.id,
        d: this.pathForSeries(series),
      }))
      .filter((entry) => entry.d);
  }

  public get orderedPaths() {
    const inactive = this.paths.filter((path) => path.id !== this.activeSeriesId);
    const active = this.paths.filter((path) => path.id === this.activeSeriesId);
    return [...inactive, ...active];
  }

  public get renderPaths(): RenderPath[] {
    return this.orderedPaths.map((path) => {
      const active = path.id === this.activeSeriesId;
      return {
        id: path.id,
        d: path.d,
        stroke: this.seriesColor(path.id),
        strokeWidth: active ? 3.25 : 2,
        opacity: active ? 1 : 0.28,
      };
    });
  }

  public get renderPoints(): RenderPoint[] {
    const points: RenderPoint[] = [];

    for (const series of this.seriesList) {
      if (!this.isSeriesVisible(series.id)) {
        continue;
      }

      const color = this.seriesColor(series.id);
      const active = series.id === this.activeSeriesId;

      series.points.forEach((point, index) => {
        const selected = this.selection?.seriesId === series.id && this.selection.index === index;
        const handleRadius = selected
          ? this.pointRadius + 1
          : active
            ? this.pointRadius
            : Math.max(2, this.pointRadius - 1);

        points.push({
          key: `${series.id}:${index}`,
          seriesId: series.id,
          seriesName: series.name,
          index,
          point,
          cx: this.mapX(point.x),
          cy: this.mapY(point.y),
          hitRadius: Math.max(8, this.pointRadius + 5),
          handleRadius,
          fill: color,
          opacity: selected ? 1 : active ? 0.8 : 0.28,
          showHandle: true,
        });
      });
    }

    return points;
  }

  public pointRadiusFor(seriesId: string, index: number): number {
    const selected = this.selection?.seriesId === seriesId && this.selection.index === index;
    const active = seriesId === this.activeSeriesId;
    return selected ? this.pointRadius + 1 : active ? this.pointRadius : Math.max(2, this.pointRadius - 1);
  }

  public formatTickLabel(value: number): string {
    return formatTick(value);
  }

  public tickXPosition(value: number): number {
    return this.mapX(value);
  }

  public tickYPosition(value: number): number {
    return this.mapY(value);
  }

  public selectionRect(box: DeleteSelectionBox) {
    return normalizeSelectionBox(box);
  }

  public isSeriesVisible(seriesId: string): boolean {
    return this.visibleIds.has(seriesId);
  }

  public seriesColor(seriesId: string): string {
    const colorIndex = clamp(this.colorById[seriesId] ?? 0, 0, COLOR_OPTIONS.length - 1);
    return COLOR_OPTIONS[colorIndex].strokeColor;
  }

  public selectSeries(seriesId: string): void {
    this.activeSeriesId = seriesId;
    this.visibleIds.add(seriesId);
    this.selection = null;
    this.hover = null;
  }

  public onActiveSeriesChange(event: Event): void {
    const value = (event.target as HTMLSelectElement | null)?.value ?? '';
    if (!value) {
      return;
    }
    this.selectSeries(value);
  }

  public toggleVisOpen(): void {
    this.visOpen = !this.visOpen;
  }

  public toggleVisible(seriesId: string): void {
    if (this.visibleIds.has(seriesId)) {
      this.visibleIds.delete(seriesId);
    } else {
      this.visibleIds.add(seriesId);
    }

    if (this.visibleIds.size === 0 && this.seriesList.length) {
      this.visibleIds.add(this.seriesList[0].id);
    }
  }

  public showAll(): void {
    this.visibleIds = new Set(this.seriesList.map((series) => series.id));
  }

  public showOnlyActive(): void {
    if (!this.activeSeriesId) {
      return;
    }
    this.visibleIds = new Set([this.activeSeriesId]);
  }

  public toggleDeleteMode(): void {
    this.error = '';
    this.hover = null;
    this.selection = null;
    this.deleteSelectionBox = null;
    this.deleteDragState = null;
    this.modeState = this.modeState === 'delete-point' ? 'select' : 'delete-point';
  }

  public autoFit(): void {
    this.captureUndoSnapshot();
    this.view = defaultViewFromPanels(this.panels, this.calibration);
    this.syncAxisWarps();
  }

  public resetEditorSize(): void {
    this.captureUndoSnapshot();
    this.syncEditorSize(true);
  }

  public setPointRadius(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const next = Number(input?.value ?? this.pointRadius);
    if (!Number.isFinite(next)) {
      return;
    }
    this.pointRadius = clamp(Math.round(next), 3, 10);
  }

  public selectColor(colorIndex: number): void {
    const activeSeries = this.activeSeries;
    if (!activeSeries) {
      return;
    }
    this.colorById = {
      ...this.colorById,
      [activeSeries.id]: clamp(colorIndex, 0, COLOR_OPTIONS.length - 1),
    };
  }

  public onColorChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement | null)?.value ?? this.currentColorIndex);
    if (!Number.isFinite(value)) {
      return;
    }

    this.selectColor(value);
  }

  public cycleSeriesColor(seriesId: string): void {
    const current = this.colorById[seriesId] ?? 0;
    this.colorById = {
      ...this.colorById,
      [seriesId]: (current + 1) % COLOR_OPTIONS.length,
    };
  }

  public onSeriesNameInput(event: Event): void {
    const value = ((event.target as HTMLInputElement | null)?.value ?? '').slice(0, MAX_SERIES_NAME);
    const activeSeries = this.activeSeries;
    if (!activeSeries || value === activeSeries.name) {
      return;
    }

    this.captureUndoSnapshot();
    const nextPanels = this.clonePanels(this.panels);
    const series = nextPanels[0]?.series.find((item) => item.id === activeSeries.id);
    if (!series) {
      return;
    }

    series.name = value || activeSeries.name;
    this.commitLocalPanels(nextPanels, false);
  }

  public undo(): void {
    const snapshot = this.undoStack.shift();
    if (!snapshot) {
      return;
    }

    this.panels = this.clonePanels(snapshot.panels);
    this.view = this.cloneView(snapshot.view);
    this.warpX = this.cloneWarp(snapshot.warpX);
    this.warpY = this.cloneWarp(snapshot.warpY);
    this.activeSeriesId = snapshot.activeSeriesId;
    this.colorById = { ...snapshot.colorById };
    this.visibleIds = new Set(snapshot.visibleIds);
    this.pointRadius = snapshot.pointRadius;
    this.editorWidth = snapshot.editorWidth;
    this.editorHeight = snapshot.editorHeight;
    this.selection = null;
    this.hover = null;
    this.error = '';
    this.emitResultJson(this.panels);
    this.requestServerPreview(stripCurvePreview(this.panels), 0);
  }

  public addSeries(): void {
    if (!this.fullMode) {
      return;
    }

    this.captureUndoSnapshot();
    const nextPanels = this.clonePanels(this.panels);
    const panel = nextPanels[0] ?? { series: [] };
    nextPanels[0] = panel;
    const series: Series = {
      id: uid('series'),
      name: `Кривая ${panel.series.length + 1}`,
      points: [],
      curvePoints: [],
    };

    panel.series.push(series);
    this.activeSeriesId = series.id;
    this.visibleIds.add(series.id);
    this.selection = null;
    this.commitLocalPanels(nextPanels, false);
  }

  public deleteSeries(seriesId: string): void {
    const series = this.seriesList.find((item) => item.id === seriesId);
    if (!series) {
      return;
    }
    if (!window.confirm(`Удалить кривую "${series.name}"?`)) {
      return;
    }

    this.captureUndoSnapshot();
    const nextPanels = this.clonePanels(this.panels);
    const panel = nextPanels[0] ?? { series: [] };
    nextPanels[0] = panel;
    panel.series = panel.series.filter((item) => item.id !== seriesId);
    this.visibleIds.delete(seriesId);

    if (this.activeSeriesId === seriesId) {
      this.activeSeriesId = panel.series[0]?.id ?? null;
    }

    this.selection = null;
    this.hover = null;
    this.commitLocalPanels(nextPanels, false);
  }

  public startResize(event: PointerEvent, axis: ResizeAxis): void {
    if (!this.fullMode || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.captureUndoSnapshot();
    this.resizeDragState = {
      pointerId: event.pointerId,
      axis,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: this.editorWidth,
      startHeight: this.editorHeight,
    };
  }

  public onCanvasPointerDown(event: PointerEvent): void {
    if (!this.activeSeriesId && this.seriesList.length) {
      this.activeSeriesId = this.seriesList[0].id;
    }

    if (!this.fullMode || this.modeState !== 'delete-point' || event.button !== 0) {
      return;
    }

    event.preventDefault();
    const point = this.svgPointerToLocal(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    this.deleteSelectionBox = { startX: point.x, startY: point.y, endX: point.x, endY: point.y };
    this.deleteDragState = { pointerId: event.pointerId };
  }

  public onCanvasDoubleClick(event: MouseEvent): void {
    const dedupeKey = `${Math.round(event.clientX)}:${Math.round(event.clientY)}`;
    const now = window.performance.now();
    if (this.lastCanvasAddKey === dedupeKey && now - this.lastCanvasAddAt < 350) {
      return;
    }

    this.lastCanvasAddKey = dedupeKey;
    this.lastCanvasAddAt = now;

    if (!this.fullMode || this.modeState === 'delete-point') {
      return;
    }

    const activeSeries = this.activeSeries;
    if (!activeSeries) {
      this.error = 'Сначала выберите или создайте кривую';
      return;
    }

    const point = this.pointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    this.captureUndoSnapshot();
    const nextPanels = this.clonePanels(this.panels);
    const series = nextPanels[0]?.series.find((item) => item.id === activeSeries.id);
    if (!series) {
      return;
    }

    let insertIndex = series.points.length;
    for (let index = 0; index < series.points.length; index += 1) {
      if (point.x < series.points[index].x) {
        insertIndex = index;
        break;
      }
    }

    series.points.splice(insertIndex, 0, point);
    this.selection = { seriesId: activeSeries.id, index: insertIndex };
    this.commitLocalPanels(nextPanels, true);
  }

  public onCanvasClick(event: MouseEvent): void {
    if (event.detail === 2) {
      this.onCanvasDoubleClick(event);
    }
  }

  public onPointDoubleClick(event: MouseEvent, seriesId: string, index: number): void {
    if (!this.fullMode || this.modeState !== 'delete-point') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.deletePointAt(seriesId, index);
  }

  public onPointPointerDown(event: PointerEvent, seriesId: string): void {
    this.activeSeriesId = seriesId;
    this.visibleIds.add(seriesId);
    if (this.modeState === 'delete-point') {
      event.stopPropagation();
    }
  }

  public handlePointPointerDown(event: PointerEvent, seriesId: string, index: number): void {
    this.activeSeriesId = seriesId;
    this.visibleIds.add(seriesId);
    this.selection = { seriesId, index };

    if (this.modeState === 'delete-point' || event.button !== 0) {
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.captureUndoSnapshot();
    this.pointDragState = { pointerId: event.pointerId, seriesId, index };
  }

  public handlePathPointerDown(event: PointerEvent, seriesId: string): void {
    this.activeSeriesId = seriesId;
    this.visibleIds.add(seriesId);

    if (this.modeState === 'delete-point' || event.button !== 0) {
      return;
    }

    const series = this.seriesList.find((item) => item.id === seriesId);
    const local = this.svgPointerToLocal(event.clientX, event.clientY);
    if (!series || !local || series.points.length === 0) {
      return;
    }

    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < series.points.length; index += 1) {
      const point = series.points[index];
      const dx = this.mapX(point.x) - local.x;
      const dy = this.mapY(point.y) - local.y;
      const distance = Math.hypot(dx, dy);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }

    if (nearestIndex < 0 || nearestDistance > 22) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.captureUndoSnapshot();
    this.selection = { seriesId, index: nearestIndex };
    this.pointDragState = { pointerId: event.pointerId, seriesId, index: nearestIndex };
  }

  public onBackdropLoad(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (!image) {
      return;
    }

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width <= 0 || height <= 0) {
      return;
    }

    const previous = this.imageSize;
    this.imageSize = { w: width, h: height };
    if (!previous || previous.w !== width || previous.h !== height) {
      this.syncEditorSize(true);
    }
  }

  public onPointEnter(point: Point, seriesName: string): void {
    this.hover = {
      cx: this.mapX(point.x),
      cy: this.mapY(point.y),
      x: point.x,
      y: point.y,
      seriesName,
    };
  }

  public clearHover(): void {
    this.hover = null;
  }

  public pathForSeries(series: Series): string {
    const source = series.curvePoints.length ? series.curvePoints : series.points;
    if (!source.length) {
      return '';
    }

    return source
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${this.mapX(point.x).toFixed(2)} ${this.mapY(point.y).toFixed(2)}`)
      .join(' ');
  }

  public seriesOptionLabel(series: Series): string {
    return ellipsis(series.name, MAX_SERIES_LABEL);
  }

  public visSeriesLabel(series: Series): string {
    return ellipsis(series.name, 34);
  }

  private readonly onWindowPointerMove = (event: PointerEvent) => {
    if (this.resizeDragState && this.resizeDragState.pointerId === event.pointerId) {
      const deltaX = event.clientX - this.resizeDragState.startClientX;
      const deltaY = event.clientY - this.resizeDragState.startClientY;

      if (this.resizeDragState.axis === 'x' || this.resizeDragState.axis === 'both') {
        this.editorWidth = Math.max(240, Math.round(this.resizeDragState.startWidth + deltaX));
      }
      if (this.resizeDragState.axis === 'y' || this.resizeDragState.axis === 'both') {
        this.editorHeight = Math.max(220, Math.round(this.resizeDragState.startHeight + deltaY));
      }
      return;
    }

    if (this.pointDragState && this.pointDragState.pointerId === event.pointerId) {
      const nextPoint = this.pointFromClient(event.clientX, event.clientY);
      if (!nextPoint) {
        return;
      }

      const nextPanels = this.clonePanels(this.panels);
      const series = nextPanels[0]?.series.find((item) => item.id === this.pointDragState?.seriesId);
      if (!series || !series.points[this.pointDragState.index]) {
        return;
      }

      series.points[this.pointDragState.index] = nextPoint;
      this.commitLocalPanels(nextPanels, true);
      return;
    }

    if (this.deleteDragState && this.deleteDragState.pointerId === event.pointerId && this.deleteSelectionBox) {
      const point = this.svgPointerToLocal(event.clientX, event.clientY);
      if (!point) {
        return;
      }

      this.deleteSelectionBox = {
        ...this.deleteSelectionBox,
        endX: point.x,
        endY: point.y,
      };
    }
  };

  private readonly onWindowPointerUp = (event: PointerEvent) => {
    if (this.resizeDragState && this.resizeDragState.pointerId === event.pointerId) {
      this.resizeDragState = null;
      return;
    }

    if (this.pointDragState && this.pointDragState.pointerId === event.pointerId) {
      this.pointDragState = null;
      return;
    }

    if (this.deleteDragState && this.deleteDragState.pointerId === event.pointerId) {
      const selection = this.deleteSelectionBox;
      this.deleteDragState = null;
      this.deleteSelectionBox = null;

      if (!selection) {
        return;
      }

      const entries = this.collectPointsInSelection(selection);
      if (!entries.length) {
        return;
      }

      this.captureUndoSnapshot();
      const nextPanels = this.clonePanels(this.panels);
      const bySeries = new Map<string, number[]>();

      for (const entry of entries) {
        const bucket = bySeries.get(entry.seriesId) ?? [];
        bucket.push(entry.index);
        bySeries.set(entry.seriesId, bucket);
      }

      for (const [seriesId, indexes] of bySeries.entries()) {
        const series = nextPanels[0]?.series.find((item) => item.id === seriesId);
        if (!series) {
          continue;
        }

        indexes.sort((a, b) => b - a);
        for (const index of indexes) {
          if (series.points[index]) {
            series.points.splice(index, 1);
          }
        }
      }

      this.selection = null;
      this.hover = null;
      this.commitLocalPanels(nextPanels, true);
    }
  };

  private readonly onWindowMouseDown = (event: MouseEvent) => {
    if (!this.visOpen || !this.visElement) {
      return;
    }

    if (event.target instanceof Node && !this.visElement.contains(event.target)) {
      this.visOpen = false;
    }
  };

  private readonly onWindowKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.undo();
      return;
    }

    if (event.key === 'Escape') {
      this.modeState = 'select';
      this.hover = null;
      this.selection = null;
      this.deleteSelectionBox = null;
      this.deleteDragState = null;
      this.visOpen = false;
      return;
    }

    if (this.fullMode && this.selection && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      this.deletePointAt(this.selection.seriesId, this.selection.index);
    }
  };

  private deletePointAt(seriesId: string, index: number): void {
    this.captureUndoSnapshot();
    const nextPanels = this.clonePanels(this.panels);
    const series = nextPanels[0]?.series.find((item) => item.id === seriesId);
    if (!series || !series.points[index]) {
      return;
    }

    series.points.splice(index, 1);
    this.selection = null;
    this.hover = null;
    this.commitLocalPanels(nextPanels, true);
  }

  private syncFromResultJson(resetView: boolean): void {
    const hadRenderablePoints = this.seriesList.some((series) => series.points.length > 0 || series.curvePoints.length > 0);
    const nextPanels = parsePanels(this.resultJson);
    this.calibration = parseEditorOverlayCalibration(this.resultJson);
    this.panels = nextPanels;
    const hasRenderablePoints = this.seriesList.some((series) => series.points.length > 0 || series.curvePoints.length > 0);

    if (!this.activeSeriesId || !nextPanels[0]?.series.some((series) => series.id === this.activeSeriesId)) {
      this.activeSeriesId = nextPanels[0]?.series[0]?.id ?? null;
    }

    if (resetView || (!hadRenderablePoints && hasRenderablePoints)) {
      this.view = defaultViewFromPanels(nextPanels, this.calibration);
    }

    if (resetView) {
      this.undoStack = [];
      this.modeState = 'select';
      this.selection = null;
      this.hover = null;
      this.deleteSelectionBox = null;
      this.syncEditorSize(true);
    }

    this.syncAxisWarps();

    if (hasRenderablePoints && !this.hasVisibleDataInCurrentView()) {
      this.view = defaultViewFromPanels(nextPanels, this.calibration);
    }

    this.syncColors();
    this.syncVisibleSeries();

    if (!hasCurvePreview(nextPanels)) {
      this.requestServerPreview(stripCurvePreview(nextPanels), 0);
    }

    this.ensureBackdropMetrics();
  }

  private hasVisibleDataInCurrentView(): boolean {
    const [x0, x1] = this.view.domainX[0] <= this.view.domainX[1]
      ? this.view.domainX
      : [this.view.domainX[1], this.view.domainX[0]];
    const [y0, y1] = this.view.domainY[0] <= this.view.domainY[1]
      ? this.view.domainY
      : [this.view.domainY[1], this.view.domainY[0]];

    return this.seriesList.some((series) =>
      [...series.points, ...series.curvePoints].some((point) =>
        point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1,
      ),
    );
  }

  private clonePoint(point: Point): Point {
    return {
      x: Number(point.x),
      y: Number(point.y),
    };
  }

  private clonePanels(panels: Panel[]): Panel[] {
    return panels.map((panel) => ({
      ...(panel.id != null ? { id: String(panel.id) } : {}),
      series: (panel.series ?? []).map((series) => ({
        id: String(series.id),
        name: String(series.name),
        points: (series.points ?? []).map((point) => this.clonePoint(point)),
        curvePoints: (series.curvePoints ?? []).map((point) => this.clonePoint(point)),
      })),
    }));
  }

  private cloneView(view: View): View {
    return {
      domainX: [Number(view.domainX[0]), Number(view.domainX[1])],
      domainY: [Number(view.domainY[0]), Number(view.domainY[1])],
    };
  }

  private cloneWarp(warp: AxisWarp | null): AxisWarp | null {
    if (!warp) {
      return null;
    }

    return {
      dataKnots: (warp.dataKnots ?? []).map(Number),
      screenKnots: (warp.screenKnots ?? []).map(Number),
    };
  }

  private captureUndoSnapshot(): void {
    this.undoStack.unshift({
      panels: this.clonePanels(this.panels),
      view: this.cloneView(this.view),
      warpX: this.cloneWarp(this.warpX),
      warpY: this.cloneWarp(this.warpY),
      activeSeriesId: this.activeSeriesId,
      colorById: { ...this.colorById },
      visibleIds: [...this.visibleIds],
      pointRadius: this.pointRadius,
      editorWidth: this.editorWidth,
      editorHeight: this.editorHeight,
    });

    if (this.undoStack.length > 50) {
      this.undoStack = this.undoStack.slice(0, 50);
    }
  }

  private commitLocalPanels(nextPanels: Panel[], requestPreview: boolean): void {
    const stripped = stripCurvePreview(nextPanels);
    this.panels = stripped;
    this.syncColors();
    this.syncVisibleSeries();
    this.emitResultJson(stripped);

    if (requestPreview) {
      this.requestServerPreview(stripped);
    }
  }

  private emitResultJson(panels: Panel[]): void {
    this.onResultJsonChange?.(buildNextResultJson(this.resultJson, panels));
  }

  private requestServerPreview(nextPanels: Panel[], delayMs = 120): void {
    if (!this.chartId) {
      return;
    }

    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
    }

    const requestId = this.previewRequestId + 1;
    this.previewRequestId = requestId;

    this.previewTimer = window.setTimeout(async () => {
      try {
        const preview = await previewChartResult(this.chartId, buildNextResultJson(this.resultJson, nextPanels));
        if (this.previewRequestId !== requestId) {
          return;
        }

        const previewPanels = parsePanels(preview.resultJson);
        this.panels = mergeCurvePreview(this.panels, previewPanels);
        this.syncColors();
        this.syncVisibleSeries();
        this.error = '';
      } catch (error) {
        if (this.previewRequestId !== requestId) {
          return;
        }

        this.error = error instanceof Error ? error.message : 'Ошибка обновления сплайна';
      }
    }, delayMs);
  }

  private syncColors(): void {
    const next: Record<string, number> = {};
    for (const [index, series] of this.seriesList.entries()) {
      const existing = this.colorById[series.id];
      next[series.id] = typeof existing === 'number'
        ? clamp(existing, 0, COLOR_OPTIONS.length - 1)
        : index % COLOR_OPTIONS.length;
    }
    this.colorById = next;
  }

  private syncVisibleSeries(): void {
    const ids = this.seriesList.map((series) => series.id);
    const next = new Set<string>();

    for (const id of ids) {
      if (this.visibleIds.has(id)) {
        next.add(id);
      }
    }

    if (next.size === 0) {
      ids.forEach((id) => next.add(id));
    }

    if (this.activeSeriesId) {
      next.add(this.activeSeriesId);
    }

    this.visibleIds = next;
  }

  private syncEditorSize(force: boolean): void {
    if (this.imageSize) {
      const width = Math.round(this.imageSize.w);
      const height = Math.round(this.imageSize.h);

      if (force || (this.editorWidth === DEFAULT_EDITOR_BOX.w && this.editorHeight === DEFAULT_EDITOR_BOX.h)) {
        this.editorWidth = width;
        this.editorHeight = height;
      }
      return;
    }

    if (force) {
      this.editorWidth = DEFAULT_EDITOR_BOX.w;
      this.editorHeight = DEFAULT_EDITOR_BOX.h;
    }
  }

  private syncAxisWarps(): void {
    this.warpX = this.calibration
      ? buildWarpFromOverlaySamples(this.calibration.xDomain, this.calibration.xAxisSamples)
      : null;
    this.warpY = this.calibration
      ? buildWarpFromOverlaySamples(this.calibration.yDomain, this.calibration.yAxisSamples)
      : null;
  }

  private mapX(value: number): number {
    const layout = this.layout;
    return layout.l + axisValueToScreen(value, this.view.domainX, this.warpX) * layout.pw;
  }

  private mapY(value: number): number {
    const layout = this.layout;
    return layout.t + layout.ph - axisValueToScreen(value, this.view.domainY, this.warpY) * layout.ph;
  }

  private pointFromClient(clientX: number, clientY: number): Point | null {
    const point = this.svgPointerToLocal(clientX, clientY);
    if (!point) {
      return null;
    }

    const layout = this.layout;
    return {
      x: axisScreenToValue((point.x - layout.l) / layout.pw, this.view.domainX, this.warpX),
      y: axisScreenToValue((layout.t + layout.ph - point.y) / layout.ph, this.view.domainY, this.warpY),
    };
  }

  private svgPointerToLocal(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!this.svgElement) {
      return null;
    }

    const layout = this.layout;
    const rect = this.svgElement.getBoundingClientRect();
    const box = this.contentBox;
    const scaleX = rect.width > 0 ? rect.width / Math.max(box.w, 1) : 1;
    const scaleY = rect.height > 0 ? rect.height / Math.max(box.h, 1) : 1;
    const x = (clientX - rect.left) / Math.max(scaleX, 0.0001);
    const y = (clientY - rect.top) / Math.max(scaleY, 0.0001);

    return {
      x: clamp(x, layout.l, layout.l + layout.pw),
      y: clamp(y, layout.t, layout.t + layout.ph),
    };
  }

  private collectPointsInSelection(box: DeleteSelectionBox) {
    const rect = normalizeSelectionBox(box);
    const entries: Array<{ seriesId: string; index: number }> = [];

    for (const series of this.seriesList) {
      if (!this.isSeriesVisible(series.id)) {
        continue;
      }

      for (let index = 0; index < series.points.length; index += 1) {
        const point = series.points[index];
        const cx = this.mapX(point.x);
        const cy = this.mapY(point.y);
        if (cx < rect.x || cx > rect.x + rect.w || cy < rect.y || cy > rect.y + rect.h) {
          continue;
        }
        entries.push({ seriesId: series.id, index });
      }
    }

    return entries;
  }

  private ensureBackdropMetrics(): void {
    if (!this.backdropImageUrl) {
      this.imageSize = null;
      this.syncEditorSize(false);
      return;
    }
  }
}
