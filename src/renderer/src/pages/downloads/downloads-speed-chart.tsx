import { useMemo } from "react";
import "./downloads-speed-chart.scss";

interface DownloadsSpeedChartProps {
  networkHistory: number[];
  diskHistory: number[];
  maxSpeed: number;
}

export function DownloadsSpeedChart({
  networkHistory,
  diskHistory,
  maxSpeed,
}: Readonly<DownloadsSpeedChartProps>) {
  const effectiveMax = Math.max(
    maxSpeed,
    1024 * 1024,
    ...networkHistory,
    ...diskHistory
  );

  const barData = useMemo(() => {
    return networkHistory.map((val, i) => {
      const heightPercent = Math.min(
        100,
        Math.max(4, (val / effectiveMax) * 100)
      );
      return {
        key: `net-${i}`,
        height: heightPercent,
      };
    });
  }, [networkHistory, effectiveMax]);

  const linePath = useMemo(() => {
    if (diskHistory.length < 2) return "";
    const w = 100 / (diskHistory.length - 1);
    return diskHistory.reduce((acc, val, i) => {
      const x = i * w;
      const y = 100 - Math.min(96, Math.max(4, (val / effectiveMax) * 100));
      return i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
    }, "");
  }, [diskHistory, effectiveMax]);

  return (
    <div className="downloads-speed-chart" aria-hidden="true">
      <div className="downloads-speed-chart__bars">
        {barData.map((bar) => (
          <div
            key={bar.key}
            className="downloads-speed-chart__bar"
            style={{ height: `${bar.height}%` }}
          />
        ))}
      </div>
      <svg
        className="downloads-speed-chart__line-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#4ade80"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  );
}
