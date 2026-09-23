interface JsBatchProgressInput {
  currentIndex: number;
  activeIndex: number;
  completedBytes: number;
  totalBytes: number;
  entryCount: number;
  fileBytes: number;
  fileProgress: number;
}

export function getJsBatchProgress(input: JsBatchProgressInput) {
  const currentBytes =
    input.activeIndex === input.currentIndex ? input.fileBytes : 0;
  const currentProgress =
    input.activeIndex === input.currentIndex ? input.fileProgress : 0;
  const progress =
    input.totalBytes > 0
      ? (input.completedBytes + currentBytes) / input.totalBytes
      : (input.currentIndex + currentProgress) / Math.max(input.entryCount, 1);

  // The final 100% is set only after the last file has been banked.
  return {
    currentBytes,
    progress: Math.min(Math.max(progress, 0), 0.9999),
  };
}

export interface JsBatchSpeedSample {
  lastSpeedUpdate: number;
  bytesAtLastSpeedUpdate: number | null;
  batchSpeed: number;
}

export function sampleJsBatchSpeed(
  previous: JsBatchSpeedSample,
  bytesDownloaded: number,
  fileSpeed: number,
  now: number
): JsBatchSpeedSample {
  if (
    previous.bytesAtLastSpeedUpdate === null ||
    bytesDownloaded < previous.bytesAtLastSpeedUpdate
  ) {
    return {
      lastSpeedUpdate: now,
      bytesAtLastSpeedUpdate: bytesDownloaded,
      batchSpeed: Math.max(0, fileSpeed),
    };
  }

  const elapsed = (now - previous.lastSpeedUpdate) / 1000;
  if (elapsed < 1) return previous;

  return {
    lastSpeedUpdate: now,
    bytesAtLastSpeedUpdate: bytesDownloaded,
    batchSpeed: Math.max(
      0,
      (bytesDownloaded - previous.bytesAtLastSpeedUpdate) / elapsed
    ),
  };
}
