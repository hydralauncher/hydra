import type { RetroArchLocalBatteryCandidate } from "@types";

export const dedupeRetroArchBatteryCandidates = (
  candidates: RetroArchLocalBatteryCandidate[]
) => {
  const seenFileSets = new Set<string>();
  return candidates.filter((candidate) => {
    const key = JSON.stringify(candidate.files.map((file) => file.path).sort());
    if (seenFileSets.has(key)) return false;
    seenFileSets.add(key);
    return true;
  });
};
