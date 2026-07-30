import type {
  CloudSaveUnresolvedCustomPathReason,
  CloudSaveUnresolvedCustomPathState,
} from "@types";

export interface StoredCloudSaveCustomPath {
  rawPath: string;
  storeUserId?: string;
  localPath?: string;
}

export interface CloudSaveCustomPathLocalPathMigration {
  rawPath: string;
  localPath: string;
  storeUserId?: string;
}

export const classifyCloudSaveCustomPathResolutionError = (
  error: unknown
): {
  state: CloudSaveUnresolvedCustomPathState;
  reason: CloudSaveUnresolvedCustomPathReason;
} => {
  const code = error instanceof Error ? error.message : "";

  if (
    code === "cloud_save_custom_path_wine_prefix_unavailable" ||
    code === "cloud_save_custom_path_wine_profile_unavailable" ||
    code === "cloud_save_custom_path_token_unavailable"
  ) {
    return {
      state: "recoverable",
      reason: "environment-unavailable",
    };
  }

  if (
    code === "cloud_save_custom_path_store_user_unavailable" ||
    code === "cloud_save_custom_path_store_user_ambiguous"
  ) {
    return {
      state: "recoverable",
      reason: "account-selection-required",
    };
  }

  if (code === "cloud_save_custom_path_legacy") {
    return { state: "needs-confirmation", reason: "legacy" };
  }

  if (
    code === "cloud_save_custom_path_foreign_platform" ||
    code === "cloud_save_custom_path_non_portable"
  ) {
    return {
      state: "needs-confirmation",
      reason: "foreign-platform",
    };
  }

  return { state: "invalid", reason: "invalid" };
};

export const applyCloudSaveCustomPathLocalPathMigrations = (
  entries: StoredCloudSaveCustomPath[],
  migrations: CloudSaveCustomPathLocalPathMigration[]
) => {
  const migrationByRawPath = new Map(
    migrations.map((migration) => [migration.rawPath, migration])
  );

  return entries.map((entry) => {
    const migration = migrationByRawPath.get(entry.rawPath);
    if (!migration || entry.localPath) return entry;

    return {
      ...entry,
      localPath: migration.localPath,
      storeUserId: entry.storeUserId ?? migration.storeUserId,
    };
  });
};
