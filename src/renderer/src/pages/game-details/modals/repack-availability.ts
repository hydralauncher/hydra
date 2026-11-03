import type { GameRepack } from "@types";

export type RepackAvailability = "online" | "partial" | "offline";

export const getRepackAvailabilityStatus = (
  repack: GameRepack
): RepackAvailability => {
  const uris = Array.isArray(repack.uris) ? repack.uris : [];
  const unavailableSet = new Set(repack.unavailableUris ?? []);
  const availableCount = uris.filter((uri) => !unavailableSet.has(uri)).length;
  const unavailableCount = uris.length - availableCount;

  if (uris.length === 0) return "offline";
  if (unavailableCount === 0) return "online";
  if (availableCount === 0) return "offline";
  return "partial";
};
