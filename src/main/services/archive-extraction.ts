import type { ExtractionProgress } from "./7zip";
import type {
  InPlaceExtractionOptions,
  InPlaceExtractionResult,
} from "./native-addon";

export const ARCHIVE_PASSWORDS = ["online-fix.me", "steamrip.com"];

export interface ArchiveExtractors {
  inPlaceEnabled: () => Promise<boolean>;
  inPlace: (
    options: InPlaceExtractionOptions,
    onProgress: (fraction: number) => void
  ) => Promise<InPlaceExtractionResult>;
  sevenZip: (
    options: { filePath: string; outputPath: string; passwords: string[] },
    onProgress: (progress: ExtractionProgress) => void
  ) => Promise<{ success: boolean }>;
  log: (message: string) => void;
}

export interface ArchiveExtractionRequest {
  filePath: string;
  outputPath: string;
  // The archive is deleted afterwards anyway, so it may be consumed while
  // extracting.
  inPlace: boolean;
}

// In place, hatchzip cuts the archive back as files come out, so the disk
// never holds the archive and the game in full at once. An archive it refuses
// (a solid RAR, files already in the way, too little space) is untouched and
// goes to 7-Zip. One it has started is never handed to 7-Zip, since part of it
// is gone: hatchzip is asked first even when not in place, so it resumes.
// With the feature flag off, hatchzip is never called and 7-Zip extracts all.
export const extractArchive = async (
  extractors: ArchiveExtractors,
  { filePath, outputPath, inPlace }: ArchiveExtractionRequest,
  onProgress: (progress: ExtractionProgress) => void
): Promise<{ success: boolean }> => {
  const extractWithSevenZip = () =>
    extractors.sevenZip(
      { filePath, outputPath, passwords: ARCHIVE_PASSWORDS },
      onProgress
    );

  if (!(await extractors.inPlaceEnabled())) {
    return extractWithSevenZip();
  }

  const result = await extractors.inPlace(
    {
      archivePath: filePath,
      outputPath,
      passwords: ARCHIVE_PASSWORDS,
      allowFresh: inPlace,
    },
    (fraction) =>
      onProgress({ percent: fraction * 100, fileCount: 0, file: "" })
  );

  if (result.status === "finished") {
    extractors.log(`Extracted ${filePath} in place`);
    return { success: true };
  }

  if (result.status === "failed") {
    throw new Error(
      `In-place extraction of ${filePath} stopped: ${result.message}`
    );
  }

  if (inPlace) {
    extractors.log(
      `Extracting ${filePath} with 7-Zip, not in place: ${result.message}`
    );
  }

  return extractWithSevenZip();
};
