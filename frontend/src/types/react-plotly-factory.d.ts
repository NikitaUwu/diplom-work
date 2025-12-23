declare module "react-plotly.js/factory" {
  import * as React from "react";

  type PlotlyComponentProps = {
    data?: any;
    layout?: any;
    config?: any;
    frames?: any;
    revision?: number;
    style?: React.CSSProperties;
    className?: string;
    onInitialized?: (...args: any[]) => void;
    onUpdate?: (...args: any[]) => void;
    onPurge?: (...args: any[]) => void;
    onError?: (...args: any[]) => void;
    useResizeHandler?: boolean;
    debug?: boolean;
    divId?: string;
  };

  export default function createPlotlyComponent(Plotly: any): React.ComponentType<PlotlyComponentProps>;
}
