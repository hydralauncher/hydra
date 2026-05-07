import {
  ChartLineUpIcon,
  DownloadSimpleIcon,
  GaugeIcon,
  PolygonIcon,
} from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  type TooltipContentProps as RechartsTooltipContentProps,
} from "recharts";
import { Typography } from "../../../common";

import "./network-stats.scss";

const NETWORK_STATS_BAR_TRACK_FILL =
  "color-mix(in srgb, var(--secondary) 70%, white 30%)";

interface DownloadsNetworkChartBarPayload {
  id: number;
  value: number;
  chartSlotValue: number;
  fillRatio: number;
  label: string;
  muted: boolean;
}

interface DownloadsNetworkBarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: DownloadsNetworkChartBarPayload;
}

function DownloadsNetworkBarShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  fill = "var(--primary)",
  payload,
}: Readonly<DownloadsNetworkBarShapeProps>) {
  const fillRatio = payload?.fillRatio ?? 0;
  const fillHeight = Math.max(0, Math.min(height, height * fillRatio));
  const fillY = y + (height - fillHeight);
  const radius = Math.min(width / 2, 999);

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={radius}
        ry={radius}
        fill={NETWORK_STATS_BAR_TRACK_FILL}
      />
      {fillHeight > 0 ? (
        <rect
          x={x}
          y={fillY}
          width={width}
          height={fillHeight}
          rx={radius}
          ry={radius}
          fill={fill}
        />
      ) : null}
    </g>
  );
}

interface DownloadsNetworkStatsProps {
  speedLabel: string;
  peakSpeedLabel: string;
  speedHistory: number[];
  speedHistoryLabels: string[];
  downloaderLabel?: string | null;
  seeds: number | null;
  peers: number | null;
  showSeedsAndPeers: boolean;
  accentColor?: string;
}

function NetworkStatsTooltip({
  active,
  payload,
}: Readonly<RechartsTooltipContentProps>) {
  if (!active || !payload?.length) return null;

  const entry = payload[0]?.payload as { label?: string } | undefined;
  if (!entry?.label) return null;

  return (
    <div className="downloads-network-stats__tooltip" role="tooltip">
      {entry.label}
    </div>
  );
}

export function DownloadsNetworkStats({
  speedLabel,
  peakSpeedLabel,
  speedHistory,
  speedHistoryLabels,
  downloaderLabel,
  seeds,
  peers,
  showSeedsAndPeers,
  accentColor,
}: Readonly<DownloadsNetworkStatsProps>) {
  const chartMax = Math.max(...speedHistory, 0, 1);
  const chartData = speedHistory.map((value, index) => ({
    id: index,
    value,
    chartSlotValue: chartMax,
    fillRatio: Math.max(0, Math.min(1, value / chartMax)),
    label: speedHistoryLabels[index] ?? "0 B/s",
    muted: value <= 0,
  }));

  const iconStyle = {
    color: accentColor ?? "var(--primary)",
  } satisfies CSSProperties;

  return (
    <section
      className="downloads-network-stats"
      aria-label="Downloads network stats"
    >
      <div className="downloads-network-stats__meta">
        <div className="downloads-network-stats__metric">
          <GaugeIcon size={18} style={iconStyle} weight="duotone" />
          <Typography className="downloads-network-stats__metric-text">
            <span className="downloads-network-stats__metric-label">
              Network:
            </span>
            <strong>{speedLabel}</strong>
          </Typography>
        </div>

        <div className="downloads-network-stats__metric">
          <ChartLineUpIcon size={18} style={iconStyle} weight="duotone" />
          <Typography className="downloads-network-stats__metric-text">
            <span className="downloads-network-stats__metric-label">
              Highest:
            </span>
            <strong>{peakSpeedLabel}</strong>
          </Typography>
        </div>

        {downloaderLabel ? (
          <div className="downloads-network-stats__metric">
            <DownloadSimpleIcon size={18} style={iconStyle} weight="duotone" />
            <Typography className="downloads-network-stats__metric-text">
              <span className="downloads-network-stats__metric-label">
                Downloader:
              </span>
              <strong>{downloaderLabel}</strong>
            </Typography>
          </div>
        ) : null}

        {showSeedsAndPeers ? (
          <div className="downloads-network-stats__metric">
            <PolygonIcon size={18} style={iconStyle} weight="duotone" />
            <Typography className="downloads-network-stats__metric-text">
              <span className="downloads-network-stats__metric-label">
                Seeds:
              </span>
              <strong>{seeds ?? 0}</strong>
              <span className="downloads-network-stats__metric-label">
                Peers:
              </span>
              <strong>{peers ?? 0}</strong>
            </Typography>
          </div>
        ) : null}
      </div>

      <div className="downloads-network-stats__chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barGap={0} barCategoryGap="0%">
            <RechartsTooltip
              content={(props) => <NetworkStatsTooltip {...props} />}
              cursor={false}
              isAnimationActive={false}
              offset={6}
              wrapperStyle={{ zIndex: 4 }}
            />
            <Bar
              dataKey="chartSlotValue"
              isAnimationActive={false}
              maxBarSize={5}
              shape={(props) => <DownloadsNetworkBarShape {...props} />}
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.id}
                  fill={
                    entry.muted
                      ? "color-mix(in srgb, var(--text) 14%, transparent)"
                      : (accentColor ?? "var(--primary)")
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
