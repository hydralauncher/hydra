export const MAX_CONCURRENT_RESTORE_OPERATIONS = 4;

export const mapWithConcurrency = async <Item, Result>(
  items: readonly Item[],
  concurrency: number,
  mapper: (item: Item, index: number) => Promise<Result>,
  onCompleted?: (result: Result, item: Item, index: number) => void
): Promise<Result[]> => {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("Concurrency must be a positive integer");
  }

  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  let hasFailed = false;
  let firstError: unknown;

  const runWorker = async () => {
    while (!hasFailed) {
      const index = nextIndex;
      if (index >= items.length) return;
      nextIndex += 1;

      try {
        const result = await mapper(items[index], index);
        if (hasFailed) return;
        results[index] = result;
        onCompleted?.(result, items[index], index);
      } catch (error) {
        if (!hasFailed) {
          hasFailed = true;
          firstError = error;
        }
        return;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runWorker)
  );

  if (hasFailed) throw firstError;
  return results;
};
