export const MAX_SERIES_NAME = 60;
export const MAX_SERIES_LABEL = 26;

export const MIN_SPAN = 1e-9;
export const DEFAULT_EDITOR_BOX = { w: 900, h: 420 };
export const EDITOR_MARGIN = { l: 56, r: 18, t: 16, b: 44 } as const;
export const DEFAULT_EDITOR_PLOT_SIZE = {
  w: DEFAULT_EDITOR_BOX.w - EDITOR_MARGIN.l - EDITOR_MARGIN.r,
  h: DEFAULT_EDITOR_BOX.h - EDITOR_MARGIN.t - EDITOR_MARGIN.b,
} as const;
export const DEFAULT_EDITOR_PLOT_HEIGHT = DEFAULT_EDITOR_PLOT_SIZE.h;
export const MIN_EDITOR_WINDOW_SCALE = 0.1;
export const MIN_EDITOR_WINDOW_WIDTH = 240;
export const MIN_EDITOR_WINDOW_HEIGHT = 220;
export const RESIZE_HANDLE_SIZE = 16;

export const COLOR_OPTIONS = [
  {
    id: "black",
    label: "Черный",
    strokeColor: "#111827",
    path: "stroke-black dark:stroke-slate-100",
    dot: "bg-black dark:bg-slate-100",
    pointFill: "fill-black dark:fill-slate-100",
  },
  {
    id: "blue",
    label: "Синий",
    strokeColor: "#2563eb",
    path: "stroke-blue-600 dark:stroke-blue-400",
    dot: "bg-blue-600",
    pointFill: "fill-blue-600",
  },
  {
    id: "green",
    label: "Зеленый",
    strokeColor: "#16a34a",
    path: "stroke-green-600 dark:stroke-green-400",
    dot: "bg-green-600",
    pointFill: "fill-green-600",
  },
  {
    id: "red",
    label: "Красный",
    strokeColor: "#dc2626",
    path: "stroke-red-600 dark:stroke-red-400",
    dot: "bg-red-600",
    pointFill: "fill-red-600",
  },
  {
    id: "orange",
    label: "Оранжевый",
    strokeColor: "#ea580c",
    path: "stroke-orange-600 dark:stroke-orange-400",
    dot: "bg-orange-600",
    pointFill: "fill-orange-600",
  },
  {
    id: "purple",
    label: "Фиолетовый",
    strokeColor: "#9333ea",
    path: "stroke-purple-600 dark:stroke-purple-400",
    dot: "bg-purple-600",
    pointFill: "fill-purple-600",
  },
] as const;
