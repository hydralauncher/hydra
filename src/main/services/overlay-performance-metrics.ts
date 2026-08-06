import type { HydraOverlayPerformance } from "@types";

export type PresentMonFrameTimeColumns = {
  displayChange: number;
  presents: number;
  processId: number;
};

export const resolvePresentMonFrameTimeColumns = (header: string[]) => {
  const normalized = header.map((column) => column.trim().toLowerCase());
  return {
    displayChange: normalized.indexOf("msbetweendisplaychange"),
    presents: normalized.indexOf("msbetweenpresents"),
    processId: normalized.indexOf("processid"),
  } satisfies PresentMonFrameTimeColumns;
};

export const parsePresentMonFrameTime = (
  columns: string[],
  indexes: PresentMonFrameTimeColumns
) => {
  for (const index of [indexes.displayChange, indexes.presents]) {
    if (index < 0) continue;
    const value = Number(columns[index]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
};

export const calculateOverlayPerformance = (
  samples: number[],
  updatedAt = Date.now()
): HydraOverlayPerformance | null => {
  if (!samples.length) return null;

  const recent = samples.slice(-30);
  const recentFrameTime =
    recent.reduce((sum, sample) => sum + sample, 0) / recent.length;
  const averageFrameTime =
    samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  const slowest = [...samples]
    .sort((left, right) => right - left)
    .slice(0, Math.max(1, Math.ceil(samples.length * 0.01)));
  const slowFrameTime =
    slowest.reduce((sum, sample) => sum + sample, 0) / slowest.length;

  return {
    fps: Math.round(1000 / recentFrameTime),
    averageFps: Math.round(1000 / averageFrameTime),
    onePercentLow: Math.round(1000 / slowFrameTime),
    frameTimeMs: Number(recentFrameTime.toFixed(1)),
    updatedAt,
  };
};
