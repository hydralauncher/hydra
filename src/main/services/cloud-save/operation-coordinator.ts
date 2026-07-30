interface ActiveOperation<T> {
  operationKey: string;
  promise: Promise<T>;
}

export class CloudSaveOperationCoordinator<T> {
  private readonly active = new Map<string, ActiveOperation<T>>();

  public run(
    scopeKey: string,
    operationKey: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const activeOperation = this.active.get(scopeKey);
    if (activeOperation) {
      if (activeOperation.operationKey === operationKey) {
        return activeOperation.promise;
      }

      return activeOperation.promise.then(
        () => this.run(scopeKey, operationKey, operation),
        () => this.run(scopeKey, operationKey, operation)
      );
    }

    const promise = operation().finally(() => {
      if (this.active.get(scopeKey)?.promise === promise) {
        this.active.delete(scopeKey);
      }
    });
    this.active.set(scopeKey, { operationKey, promise });
    return promise;
  }
}
