export class DownloadSourceOperationGate {
  private active = false;

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active) {
      throw new Error("download_source_operation_in_progress");
    }

    this.active = true;
    try {
      return await operation();
    } finally {
      this.active = false;
    }
  }
}

export const downloadSourceOperationGate = new DownloadSourceOperationGate();
