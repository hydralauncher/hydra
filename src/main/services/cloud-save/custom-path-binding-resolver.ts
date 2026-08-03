import type { CloudSaveCustomPathBindings } from "@types";

import {
  bindCloudSaveCustomPathToLocalPath,
  type CloudSaveCustomPathContext,
  decodeCloudSaveCustomPath,
  getLegacyCloudSaveCustomPathPathHint,
} from "./custom-path.js";
import {
  classifyCloudSaveCustomPathResolutionError,
  type CloudSaveCustomPathLocalPathMigration,
  type StoredCloudSaveCustomPath,
} from "./custom-path-binding-state.js";

const resolveStoredPath = (
  stored: StoredCloudSaveCustomPath,
  context: CloudSaveCustomPathContext
) => {
  if (
    !stored.localPath &&
    stored.rawPath.includes("<storeUserId>") &&
    !stored.storeUserId &&
    (context.storeUserIds?.length ?? 0) !== 1
  ) {
    throw new Error("cloud_save_custom_path_store_user_ambiguous");
  }
  const bindingContext = {
    ...context,
    preferredStoreUserId:
      stored.storeUserId ??
      (stored.rawPath.includes("<storeUserId>")
        ? context.storeUserIds?.[0]
        : undefined),
  };
  return stored.localPath
    ? bindCloudSaveCustomPathToLocalPath(
        stored.rawPath,
        stored.localPath,
        bindingContext
      )
    : decodeCloudSaveCustomPath(stored.rawPath, bindingContext);
};

export const resolveStoredCloudSaveCustomPathBindings = (
  entries: StoredCloudSaveCustomPath[],
  context: CloudSaveCustomPathContext
): {
  bindings: CloudSaveCustomPathBindings;
  migrations: CloudSaveCustomPathLocalPathMigration[];
} => {
  const ready: CloudSaveCustomPathBindings["ready"] = [];
  const unresolved: CloudSaveCustomPathBindings["unresolved"] = [];
  const migrations: CloudSaveCustomPathLocalPathMigration[] = [];

  for (const stored of entries) {
    try {
      const customPath = {
        ...resolveStoredPath(stored, context),
        ...(stored.storeUserId ? { storeUserId: stored.storeUserId } : {}),
      };
      ready.push(customPath);
      if (!stored.localPath) {
        migrations.push({
          rawPath: stored.rawPath,
          localPath: customPath.path,
          storeUserId: customPath.storeUserId,
        });
      }
    } catch (error) {
      unresolved.push({
        rawPath: stored.rawPath,
        pathHint:
          stored.localPath ??
          getLegacyCloudSaveCustomPathPathHint(stored.rawPath),
        ...classifyCloudSaveCustomPathResolutionError(error),
        registered: true,
      });
    }
  }

  return { bindings: { ready, unresolved }, migrations };
};
