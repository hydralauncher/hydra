import type { InstallProgressLike } from "@renderer/components/setup-modal/install-progress-bar";

export const getExtractionPercent = (progress?: InstallProgressLike | null) =>
  progress?.phase === "extracting" &&
  progress.total &&
  progress.loaded !== undefined
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : null;

export const toExtractionBar = (
  progress?: InstallProgressLike | null
): InstallProgressLike => {
  const percent = getExtractionPercent(progress);
  return percent === null
    ? { phase: "extracting" }
    : { phase: "downloading", loaded: percent, total: 100 };
};

export const formatExtracting = (
  label: string,
  progress?: InstallProgressLike | null
) => {
  const percent = getExtractionPercent(progress);
  return percent === null ? label : `${label} · ${percent}%`;
};

export const isIdentifyingVersion = (progress?: InstallProgressLike | null) =>
  progress?.phase === "identifying";
