export const canMigrateLegacyCloudSaveAnchor = (
  _anchor: unknown,
  _localSnapshotHash: string,
  _localSnapshotFileCount: number
) => false;

export const hasCloudSaveV4AnchorSchema = (
  value: unknown
): value is { schemaVersion: 4 } =>
  Boolean(
    value &&
      typeof value === "object" &&
      "schemaVersion" in value &&
      value.schemaVersion === 4
  );
