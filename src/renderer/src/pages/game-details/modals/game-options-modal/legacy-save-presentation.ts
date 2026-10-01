import type { GameArtifact } from "@types";

export const sortLegacySavesByNewest = (
  artifacts: readonly GameArtifact[]
): GameArtifact[] =>
  [...artifacts].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
