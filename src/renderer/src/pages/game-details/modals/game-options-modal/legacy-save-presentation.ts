import type { EmulationCloudSave, GameArtifact } from "@types";

export const sortLegacySavesByNewest = (
  artifacts: readonly GameArtifact[]
): GameArtifact[] =>
  [...artifacts].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );

export const archivedEmulationSaveToArtifact = (
  save: EmulationCloudSave
): GameArtifact => ({
  id: save.id,
  artifactLengthInBytes: save.artifactLengthInBytes,
  downloadOptionTitle: save.fileName,
  createdAt: save.createdAt,
  updatedAt: save.updatedAt,
  hostname: save.hostname ?? "",
  downloadCount: 0,
  label: save.label ?? save.fileName,
  isFrozen: false,
});

export interface LegacyArchiveEntry {
  source: "game-artifact" | "emulation-save";
  artifact: GameArtifact;
}

export const sortLegacyArchiveEntriesByNewest = (
  entries: readonly LegacyArchiveEntry[]
): LegacyArchiveEntry[] =>
  [...entries].sort(
    (left, right) =>
      new Date(right.artifact.createdAt).getTime() -
      new Date(left.artifact.createdAt).getTime()
  );
