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
  // Hydra recorded starting an in-place extraction of this archive before.
  resume: boolean;
  // Records that an in-place extraction of this archive may start. Runs
  // before hatchzip touches the archive, so a retry knows to resume it.
  recordInPlaceStart: () => Promise<void>;
}

// In place, hatchzip cuts the archive back as files come out, so the disk
// never holds the archive and the game in full at once. An archive it refuses
// (a solid RAR, files already in the way, too little space) is untouched and
// goes to 7-Zip. One it has started is never handed to 7-Zip, since part of it
// is gone: hatchzip finishes it, whatever the feature flag says now. Only a
// new run asks the API for the flag, and with the flag off 7-Zip extracts all.
export const extractArchive = async (
  extractors: ArchiveExtractors,
  {
    filePath,
    outputPath,
    inPlace,
    resume,
    recordInPlaceStart,
  }: ArchiveExtractionRequest,
  onProgress: (progress: ExtractionProgress) => void
): Promise<{ success: boolean }> => {
  const extractWithSevenZip = () =>
    extractors.sevenZip(
      { filePath, outputPath, passwords: ARCHIVE_PASSWORDS },
      onProgress
    );

  const allowFresh = inPlace && !resume && (await extractors.inPlaceEnabled());

  if (!resume && !allowFresh) {
    return extractWithSevenZip();
  }

  if (allowFresh) {
    await recordInPlaceStart();
  }

  let result: InPlaceExtractionResult;
  try {
    result = await extractors.inPlace(
      {
        archivePath: filePath,
        outputPath,
        passwords: ARCHIVE_PASSWORDS,
        allowFresh,
        resume,
      },
      (fraction) =>
        onProgress({ percent: fraction * 100, fileCount: 0, file: "" })
    );
  } catch (error) {
    // The addon did not run, so it touched nothing now. What an earlier run
    // left of the archive still can't go to 7-Zip.
    if (resume) throw error;

    extractors.log(
      `Extracting ${filePath} with 7-Zip, in-place extraction could not run: ${error}`
    );
    return extractWithSevenZip();
  }

  if (result.status === "finished") {
    extractors.log(`Extracted ${filePath} in place`);
    return { success: true };
  }

  if (result.status === "failed") {
    throw new Error(
      `In-place extraction of ${filePath} stopped: ${result.message}`
    );
  }

  extractors.log(
    `Extracting ${filePath} with 7-Zip, not in place: ${result.message}`
  );

  return extractWithSevenZip();
};
