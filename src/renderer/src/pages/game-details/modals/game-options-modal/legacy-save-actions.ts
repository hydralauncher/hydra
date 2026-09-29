import type { LegacyArchiveEntry } from "./legacy-save-presentation";

type LegacyArchiveSource = LegacyArchiveEntry["source"];

interface DeleteLegacyArchiveDependencies {
  deleteGameArtifact: (id: string) => Promise<unknown>;
  deleteEmulationSave: (id: string) => Promise<unknown>;
  refreshEmulationSaves: () => Promise<unknown> | unknown;
}

export const deleteLegacyArchiveEntry = async (
  source: LegacyArchiveSource,
  id: string,
  dependencies: DeleteLegacyArchiveDependencies
): Promise<void> => {
  if (source === "emulation-save") {
    await dependencies.deleteEmulationSave(id);
    await dependencies.refreshEmulationSaves();
    return;
  }
  await dependencies.deleteGameArtifact(id);
};
