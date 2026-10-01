import type {
  CloudSaveUnresolvedCustomPathReason,
  CloudSaveUnresolvedCustomPathState,
} from "@types";

export interface StoredCloudSaveCustomPath {
  rawPath: string;
  syncState?: "pending" | "confirmed";
  storeUserId?: string;
  localPath?: string;
}

export interface CloudSaveCustomPathLocalPathMigration {
  rawPath: string;
  localPath: string;
  storeUserId?: string;
}

interface LegacyStoredCloudSaveCustomPath
  extends Omit<StoredCloudSaveCustomPath, "syncState"> {
  tracking?: "tracked" | "ignored";
  syncState?: StoredCloudSaveCustomPath["syncState"];
}

const isStoredCloudSaveCustomPath = (
  value: unknown
): value is LegacyStoredCloudSaveCustomPath => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.rawPath === "string" &&
    record.rawPath.startsWith("<custom>") &&
    (record.syncState === undefined ||
      record.syncState === "pending" ||
      record.syncState === "confirmed") &&
    (record.tracking === undefined ||
      record.tracking === "tracked" ||
      record.tracking === "ignored") &&
    (record.storeUserId === undefined ||
      typeof record.storeUserId === "string") &&
    (record.localPath === undefined || typeof record.localPath === "string") &&
    Object.keys(record).every(
      (key) =>
        key === "rawPath" ||
        key === "syncState" ||
        key === "tracking" ||
        key === "storeUserId" ||
        key === "localPath"
    )
  );
};

export const normalizeStoredCloudSaveCustomPathEntries = (
  value: unknown
): StoredCloudSaveCustomPath[] => {
  if (!Array.isArray(value)) return [];
  const entries = value.filter(isStoredCloudSaveCustomPath);
  const ignoredRawPaths = new Set(
    entries
      .filter(({ tracking }) => tracking === "ignored")
      .map(({ rawPath }) => rawPath)
  );
  const byRawPath = new Map<string, StoredCloudSaveCustomPath>();
  for (const entry of entries) {
    if (ignoredRawPaths.has(entry.rawPath)) continue;
    const existing = byRawPath.get(entry.rawPath);
    byRawPath.set(entry.rawPath, {
      rawPath: entry.rawPath,
      syncState:
        entry.tracking === "tracked"
          ? "confirmed"
          : (entry.syncState ?? existing?.syncState ?? "confirmed"),
      storeUserId: entry.storeUserId ?? existing?.storeUserId,
      localPath: entry.localPath ?? existing?.localPath,
    });
  }
  return [...byRawPath.values()].sort((left, right) =>
    left.rawPath.localeCompare(right.rawPath)
  );
};

export const trackStoredCloudSaveCustomPaths = (
  entries: StoredCloudSaveCustomPath[],
  trackedPaths: Pick<
    StoredCloudSaveCustomPath,
    "rawPath" | "storeUserId" | "localPath"
  >[],
  syncState: StoredCloudSaveCustomPath["syncState"] = "confirmed"
) => {
  const byRawPath = new Map(entries.map((entry) => [entry.rawPath, entry]));
  for (const tracked of trackedPaths) {
    const existing = byRawPath.get(tracked.rawPath);
    byRawPath.set(tracked.rawPath, {
      rawPath: tracked.rawPath,
      syncState,
      storeUserId: tracked.storeUserId ?? existing?.storeUserId,
      localPath: tracked.localPath ?? existing?.localPath,
    });
  }
  return [...byRawPath.values()];
};

export const removeStoredCloudSaveCustomPath = (
  entries: StoredCloudSaveCustomPath[],
  rawPath: string
) => entries.filter((entry) => entry.rawPath !== rawPath);

export const reconcileStoredCloudSaveCustomPaths = (
  entries: StoredCloudSaveCustomPath[],
  remoteRawPaths: ReadonlySet<string>
) =>
  entries.flatMap((entry) => {
    if (remoteRawPaths.has(entry.rawPath)) {
      return [{ ...entry, syncState: "confirmed" as const }];
    }
    return entry.syncState === "pending" ? [entry] : [];
  });

export const confirmStoredCloudSaveCustomPaths = (
  entries: StoredCloudSaveCustomPath[],
  remoteRawPaths: ReadonlySet<string>
) =>
  entries.map((entry) =>
    remoteRawPaths.has(entry.rawPath)
      ? { ...entry, syncState: "confirmed" as const }
      : entry
  );

export const classifyCloudSaveCustomPathResolutionError = (
  error: unknown
): {
  state: CloudSaveUnresolvedCustomPathState;
  reason: CloudSaveUnresolvedCustomPathReason;
} => {
  const code = error instanceof Error ? error.message : "";

  if (code === "cloud_save_custom_path_wine_prefix_unavailable") {
    return {
      state: "recoverable",
      reason: "wine-prefix-unavailable",
    };
  }

  if (code === "cloud_save_custom_path_wine_profile_unavailable") {
    return {
      state: "recoverable",
      reason: "wine-profile-unavailable",
    };
  }

  if (code === "cloud_save_custom_path_token_unavailable") {
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
