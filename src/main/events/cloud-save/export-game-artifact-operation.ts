import type { LegacySaveExportResult } from "@types";
import path from "node:path";

export interface ExportGameArtifactDependencies {
  signal?: AbortSignal;
  createTemporaryDirectory: () => Promise<string>;
  downloadTar: (destinationPath: string) => Promise<void>;
  extractTar: (tarPath: string, destinationPath: string) => Promise<void>;
  createZip: (sourcePath: string, destinationPath: string) => Promise<void>;
  selectDestination: () => Promise<string | null>;
  copyZip: (sourcePath: string, destinationPath: string) => Promise<void>;
  cleanupTemporaryDirectory: (temporaryDirectory: string) => Promise<void>;
}

export const sanitizeLegacySaveArchiveName = (value: string): string => {
  const withoutControlCharacters = [...value]
    .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
    .join("");
  const sanitized = withoutControlCharacters
    .trim()
    .replaceAll(/[<>:"/\\|?*]/g, "_")
    .replace(/\.zip$/i, "")
    .replace(/[. ]+$/g, "");

  const safeName = sanitized || "legacy-save";
  const isWindowsReservedName =
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(safeName);

  return isWindowsReservedName ? `_${safeName}` : safeName;
};

export const exportGameArtifactArchive = async (
  dependencies: ExportGameArtifactDependencies
): Promise<LegacySaveExportResult> => {
  dependencies.signal?.throwIfAborted();
  const temporaryDirectory = await dependencies.createTemporaryDirectory();
  const tarPath = path.join(temporaryDirectory, "artifact.tar");
  const extractedPath = path.join(temporaryDirectory, "extracted");
  const zipPath = path.join(temporaryDirectory, "artifact.zip");

  try {
    dependencies.signal?.throwIfAborted();
    await dependencies.downloadTar(tarPath);
    dependencies.signal?.throwIfAborted();
    await dependencies.extractTar(tarPath, extractedPath);
    dependencies.signal?.throwIfAborted();
    await dependencies.createZip(extractedPath, zipPath);
    dependencies.signal?.throwIfAborted();

    const destinationPath = await dependencies.selectDestination();
    if (!destinationPath) return { status: "cancelled" };

    dependencies.signal?.throwIfAborted();
    await dependencies.copyZip(zipPath, destinationPath);
    return { status: "saved", filePath: destinationPath };
  } finally {
    await dependencies.cleanupTemporaryDirectory(temporaryDirectory);
  }
};
