type CloudSaveOperationKind = "sync" | "delete";

interface ActiveCloudSaveOperation {
  kind: CloudSaveOperationKind;
  operationKey: string;
  promise: Promise<unknown>;
}

export class CloudSaveOperationGate {
  private readonly active = new Map<string, ActiveCloudSaveOperation>();
  private readonly activeLaunches = new Map<string, number>();

  public isDeletionActive(scopeKey: string) {
    return this.active.get(scopeKey)?.kind === "delete";
  }

  public runSync<T>(
    scopeKey: string,
    operationKey: string,
    operation: () => Promise<T>,
    assertCanStart?: () => Promise<void>
  ): Promise<T> {
    if (this.active.has(scopeKey)) {
      return Promise.reject(new Error("cloud_save_operation_active"));
    }

    return this.run(scopeKey, "sync", operationKey, async () => {
      await assertCanStart?.();
      return operation();
    });
  }

  public runDeletion<T>(
    scopeKey: string,
    operationKey: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if ((this.activeLaunches.get(scopeKey) ?? 0) > 0) {
      return Promise.reject(new Error("cloud_save_operation_active"));
    }

    const activeOperation = this.active.get(scopeKey);
    if (activeOperation) {
      if (
        activeOperation.kind === "delete" &&
        activeOperation.operationKey === operationKey
      ) {
        return activeOperation.promise as Promise<T>;
      }

      return Promise.reject(new Error("cloud_save_operation_active"));
    }

    return this.run(scopeKey, "delete", operationKey, operation);
  }

  public runLaunch<T>(
    scopeKey: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (this.isDeletionActive(scopeKey)) {
      return Promise.reject(new Error("cloud_save_delete_active"));
    }

    this.activeLaunches.set(
      scopeKey,
      (this.activeLaunches.get(scopeKey) ?? 0) + 1
    );
    return Promise.resolve()
      .then(operation)
      .finally(() => {
        const remaining = (this.activeLaunches.get(scopeKey) ?? 1) - 1;
        if (remaining === 0) this.activeLaunches.delete(scopeKey);
        else this.activeLaunches.set(scopeKey, remaining);
      });
  }

  private run<T>(
    scopeKey: string,
    kind: CloudSaveOperationKind,
    operationKey: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (this.active.get(scopeKey)?.promise === promise) {
          this.active.delete(scopeKey);
        }
      });

    this.active.set(scopeKey, { kind, operationKey, promise });
    return promise;
  }
}

export const cloudSaveOperationGate = new CloudSaveOperationGate();

export const cloudSaveOperationScopeKey = (objectId: string, shop: string) =>
  JSON.stringify([shop, objectId]);

export const isCloudSaveDeletionActive = (objectId: string, shop: string) =>
  cloudSaveOperationGate.isDeletionActive(
    cloudSaveOperationScopeKey(objectId, shop)
  );

export const assertCloudSaveDeletionInactive = (
  objectId: string,
  shop: string
) => {
  if (isCloudSaveDeletionActive(objectId, shop)) {
    throw new Error("cloud_save_delete_active");
  }
};

export const runWithCloudSaveLaunchGate = <T>(
  objectId: string,
  shop: string,
  operation: () => Promise<T>
) =>
  cloudSaveOperationGate.runLaunch(
    cloudSaveOperationScopeKey(objectId, shop),
    operation
  );
