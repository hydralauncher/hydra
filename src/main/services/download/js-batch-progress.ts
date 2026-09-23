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
