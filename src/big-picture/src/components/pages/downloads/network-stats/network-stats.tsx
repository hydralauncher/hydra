import { ChartLineUpIcon, GaugeIcon } from "@phosphor-icons/react";
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

interface DownloadsNetworkStatsProps {
  speedLabel: string;
  peakSpeedLabel: string;
  speedHistory: number[];
  speedHistoryLabels: string[];
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
  seeds,
  peers,
  showSeedsAndPeers,
  accentColor,
}: Readonly<DownloadsNetworkStatsProps>) {
  const chartData = speedHistory.map((value, index) => ({
    id: index,
    value,
    label: speedHistoryLabels[index] ?? "0 B/s",
    muted: value <= 0,
  }));

  const iconStyle = {
    color: accentColor ?? "var(--primary)",
  } satisfies CSSProperties;

  return (
    <section className="downloads-network-stats" aria-label="Downloads network stats">
      <div className="downloads-network-stats__meta">
        <div className="downloads-network-stats__metric">
          <GaugeIcon size={18} style={iconStyle} weight="duotone" />
          <Typography className="downloads-network-stats__metric-text">
            <span className="downloads-network-stats__metric-label">Network:</span>
            <strong>{speedLabel}</strong>
          </Typography>
        </div>

        <div className="downloads-network-stats__metric">
          <ChartLineUpIcon size={18} style={iconStyle} weight="duotone" />
          <Typography className="downloads-network-stats__metric-text">
            <span className="downloads-network-stats__metric-label">Highest:</span>
            <strong>{peakSpeedLabel}</strong>
          </Typography>
        </div>

        {showSeedsAndPeers ? (
          <Typography className="downloads-network-stats__torrent-meta">
            Seeds: <strong>{seeds ?? 0}</strong> Peers: <strong>{peers ?? 0}</strong>
          </Typography>
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
              dataKey="value"
              radius={[999, 999, 0, 0]}
              isAnimationActive={false}
              maxBarSize={5}
              background={{
                fill: "color-mix(in srgb, var(--secondary) 70%, white 30%)",
                radius: 999,
              }}
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
