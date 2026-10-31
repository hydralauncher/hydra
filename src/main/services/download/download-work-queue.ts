/** Start the next job only when this worker's current request has settled. */
export function runDownloadQueue(
  nextJob: () => Promise<void> | undefined,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startNext = () => {
      try {
        signal.throwIfAborted();
        const job = nextJob();
        if (job === undefined) {
          resolve();
          return;
        }
        // Retain one promise per worker, regardless of the number of files.
        job.then(startNext, reject);
      } catch (error) {
        reject(error);
      }
    };
    startNext();
  });
}
