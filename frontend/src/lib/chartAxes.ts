import type { ChartTheme } from "@/lib/chartTheme";
import { axisLabel, axisTick, axisTickSpacing } from "@/lib/chartTheme";

type XAxisExtra = {
  dataKey?: string;
  type?: "number" | "category";
  domain?: [number, number] | [string, string];
  tickFormatter?: (v: number) => string;
  interval?: number;
  angle?: number;
  textAnchor?: "start" | "middle" | "end";
  height?: number;
};

type YAxisExtra = {
  yAxisId?: string;
  orientation?: "left" | "right";
  type?: "number" | "category";
  dataKey?: string;
  domain?: Array<number | string>;
  tickCount?: number;
  allowDecimals?: boolean;
  tickFormatter?: (v: number) => string;
  width?: number;
};

/** Shared X-axis props: tick spacing + optional title below the plot. */
export function chartXAxis(
  theme: ChartTheme,
  title: string | undefined,
  extra: XAxisExtra = {},
) {
  return {
    dataKey: extra.dataKey,
    type: extra.type,
    domain: extra.domain,
    tick: { ...axisTick(theme), dy: axisTickSpacing.x.dy },
    tickMargin: axisTickSpacing.x.tickMargin,
    tickFormatter: extra.tickFormatter,
    interval: extra.interval,
    angle: extra.angle,
    textAnchor: extra.textAnchor,
    height: extra.height,
    stroke: theme.axisLine,
    ...(title ? { label: axisLabel(theme, title, "insideBottom") } : {}),
  };
}

/** Shared Y-axis props: tick spacing + optional title on the left. */
export function chartYAxis(
  theme: ChartTheme,
  title: string | undefined,
  extra: YAxisExtra = {},
) {
  return {
    yAxisId: extra.yAxisId,
    orientation: extra.orientation ?? "left",
    type: extra.type,
    dataKey: extra.dataKey,
    domain: extra.domain,
    tickCount: extra.tickCount,
    allowDecimals: extra.allowDecimals,
    tick: axisTick(theme),
    tickMargin: axisTickSpacing.y.tickMargin,
    tickFormatter: extra.tickFormatter,
    width: extra.width ?? axisTickSpacing.y.width,
    stroke: theme.axisLine,
    ...(title
      ? {
          label: axisLabel(
            theme,
            title,
            extra.orientation === "right" ? "insideRight" : "left",
            {
              angle: extra.orientation === "right" ? 90 : -90,
              offset: extra.orientation === "right" ? 8 : 10,
            },
          ),
        }
      : {}),
  };
}
