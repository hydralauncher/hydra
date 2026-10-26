export class DownloadSourceOperationGate {
  private pending: Promise<void> = Promise.resolve();

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    // A failed operation must not prevent the next queued operation from running.
    this.pending = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

export const downloadSourceOperationGate = new DownloadSourceOperationGate();
