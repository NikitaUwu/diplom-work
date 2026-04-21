export type Point = { x: number; y: number };

export type Series = {
  id: string;
  name: string;
  points: Point[];
  curvePoints: Point[];
};

export type Panel = {
  id?: string;
  series: Series[];
};

export type EditorResultJson = {
  panels?: any[];
  artifacts?: any;
  [k: string]: any;
};

export type OverlayPlotArea = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type OverlayAxisSample = {
  value: number;
  screen: number;
};

export type EditorOverlayCalibration = {
  artifactKey: string;
  plotArea: OverlayPlotArea;
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number[];
  yTicks: number[];
  xAxisSamples: OverlayAxisSample[];
  yAxisSamples: OverlayAxisSample[];
};

export type View = {
  domainX: [number, number];
  domainY: [number, number];
};

export type AxisWarp = {
  dataKnots: number[];
  screenKnots: number[];
};

export type BackdropOffset = {
  x: number;
  y: number;
};

export type ResizeAxis = "x" | "y" | "both";

export type DeletePointEntry = {
  seriesId: string;
  index: number;
  point: Point;
};

export type DeleteSelectionBox = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

export type Patch =
  | { type: "move-point"; seriesId: string; index: number; before: Point; after: Point }
  | { type: "add-point"; seriesId: string; index: number; point: Point }
  | { type: "delete-point"; seriesId: string; index: number; point: Point }
  | { type: "delete-many-points"; points: DeletePointEntry[] }
  | { type: "add-series"; index: number; series: Series }
  | { type: "delete-series"; index: number; series: Series }
  | { type: "rename-series"; seriesId: string; before: string; after: string }
  | { type: "set-domain"; before: View; after: View }
  | { type: "set-warp"; axis: "x" | "y"; before: AxisWarp | null; after: AxisWarp | null };
