import type {
  HydraOverlayPerformance,
  HydraOverlayPerformanceRows,
} from "@types";
import { Pin } from "lucide-react";

interface OverlayPerformanceProps {
  metrics: HydraOverlayPerformance;
  compact?: boolean;
  pinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
  rows: HydraOverlayPerformanceRows;
}

const display = (value: number | null, suffix = "") =>
  value === null ? "--" : `${value}${suffix}`;

export function OverlayPerformance({
  metrics,
  compact = false,
  pinned = false,
  onPinnedChange,
  rows,
}: OverlayPerformanceProps) {
  return (
    <section
      className={`overlay-performance${compact ? " overlay-performance--compact" : ""}`}
    >
      {!compact && (
        <header>
          <strong>Performance</strong>
          <button
            data-overlay-focusable
            className={pinned ? "is-pinned" : ""}
            onClick={() => onPinnedChange?.(!pinned)}
            title={pinned ? "Unpin performance HUD" : "Pin performance HUD"}
            aria-label={
              pinned ? "Unpin performance HUD" : "Pin performance HUD"
            }
          >
            <Pin size={14} fill={pinned ? "currentColor" : "none"} />
          </button>
        </header>
      )}
      <dl>
        {rows.fps && (
          <div>
            <dt>FPS</dt>
            <dd>{display(metrics.fps)}</dd>
          </div>
        )}
        {rows.averageFps && (
          <div>
            <dt>AVG FPS</dt>
            <dd>{display(metrics.averageFps)}</dd>
          </div>
        )}
        {rows.frameTime && (
          <div>
            <dt>FRAME</dt>
            <dd>{display(metrics.frameTimeMs, " ms")}</dd>
          </div>
        )}
        {rows.onePercentLow && (
          <div>
            <dt>1% LOW</dt>
            <dd>{display(metrics.onePercentLow)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
