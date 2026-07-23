import type {
  HydraOverlayPerformance,
  HydraOverlayPerformanceRows,
} from "@types";
import { useEffect, useState } from "react";
import "./overlay.scss";
import { OverlayPerformance } from "./overlay-performance";

const emptyMetrics: HydraOverlayPerformance = {
  fps: null,
  averageFps: null,
  onePercentLow: null,
  frameTimeMs: null,
  updatedAt: 0,
};

export default function OverlayFps() {
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [rows, setRows] = useState<HydraOverlayPerformanceRows>({
    fps: true,
    averageFps: true,
    frameTime: true,
    onePercentLow: true,
  });

  useEffect(() => {
    const refresh = () =>
      globalThis.electron.getOverlayContext().then((context) => {
        setMetrics(context?.performance ?? emptyMetrics);
        if (context) setRows(context.settings.performanceRows);
      });
    void refresh();
    const unsubscribePerformance =
      globalThis.electron.onOverlayPerformance(setMetrics);
    const unsubscribeSettings = globalThis.electron.onOverlayShown(refresh);
    return () => {
      unsubscribePerformance();
      unsubscribeSettings();
    };
  }, []);

  return <OverlayPerformance metrics={metrics} rows={rows} compact />;
}
