import path from "node:path";
import type {
  EpicCloudSaveSettings,
  EpicLaunchOptions,
  ResolveEpicCloudSaveConflictPayload,
  StartEpicGameDownloadPayload,
} from "../../../types/epic-managed.types";
import {
  EpicIntegrationError,
  EPIC_CONNECTION_ID_PATTERN,
  isRecord,
} from "../../services/epic/auth-protocol.js";
import { isEpicObjectId } from "../../services/epic/library-normalizer.js";
import { isSafeEpicArtifact } from "../../services/epic/installation.js";
import { isEpicRemoteSaveTimestamp } from "../../services/epic/cloud-save-protocol.js";

const MAX_EPIC_LOCAL_PATH_LENGTH = 32_768;
const EPIC_SAVE_MANIFEST_PATTERN =
  /^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}\.manifest$/;

const invalid = (): never => {
  throw new EpicIntegrationError("invalid-operation");
};

const hasOnlyFields = (value: Record<string, unknown>, names: string[]) =>
  Object.keys(value).every((key) => names.includes(key));

const isLocalPath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_EPIC_LOCAL_PATH_LENGTH &&
  !value.includes("\0") &&
  path.isAbsolute(value);

export const parseEpicManagedObjectId = (value: unknown): string => {
  if (!isEpicObjectId(value)) return invalid();
  return value;
};

export const parseEpicInstallOptionsRequestId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    return invalid();
  return value;
};

export function parseEpicDownloadPayload(
  value: unknown
): StartEpicGameDownloadPayload {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, [
      "epicObjectId",
      "connectionId",
      "artifactId",
      "platform",
      "downloadPath",
      "addToQueueOnly",
      "preparationId",
    ]) ||
    !isEpicObjectId(value.epicObjectId) ||
    typeof value.connectionId !== "string" ||
    !EPIC_CONNECTION_ID_PATTERN.test(value.connectionId) ||
    !isSafeEpicArtifact(value.artifactId) ||
    (value.platform !== "Windows" && value.platform !== "Mac") ||
    !isLocalPath(value.downloadPath) ||
    (value.preparationId !== undefined &&
      (typeof value.preparationId !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          value.preparationId
        ))) ||
    (value.addToQueueOnly !== undefined &&
      typeof value.addToQueueOnly !== "boolean")
  ) {
    return invalid();
  }
  return {
    epicObjectId: value.epicObjectId,
    connectionId: value.connectionId,
    artifactId: value.artifactId,
    platform: value.platform,
    downloadPath: value.downloadPath,
    ...(value.preparationId !== undefined
      ? { preparationId: value.preparationId }
      : {}),
    ...(value.addToQueueOnly !== undefined
      ? { addToQueueOnly: value.addToQueueOnly }
      : {}),
  };
}

export function parseEpicCloudSaveSettings(
  value: unknown
): EpicCloudSaveSettings {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, ["automaticSync", "savePath"]) ||
    typeof value.automaticSync !== "boolean" ||
    (value.savePath !== undefined &&
      value.savePath !== null &&
      !isLocalPath(value.savePath))
  ) {
    return invalid();
  }
  return {
    automaticSync: value.automaticSync,
    ...(value.savePath !== undefined ? { savePath: value.savePath } : {}),
  };
}

export function parseEpicCloudSaveConflict(
  value: unknown
): ResolveEpicCloudSaveConflictPayload {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, [
      "epicObjectId",
      "expectedRemoteManifest",
      "expectedRemoteModifiedAt",
      "choice",
    ]) ||
    !isEpicObjectId(value.epicObjectId) ||
    (value.expectedRemoteManifest !== null &&
      (typeof value.expectedRemoteManifest !== "string" ||
        !EPIC_SAVE_MANIFEST_PATTERN.test(value.expectedRemoteManifest))) ||
    (value.expectedRemoteModifiedAt !== null &&
      !isEpicRemoteSaveTimestamp(value.expectedRemoteModifiedAt)) ||
    (value.choice !== "local" && value.choice !== "remote")
  ) {
    return invalid();
  }
  return {
    epicObjectId: value.epicObjectId,
    expectedRemoteManifest: value.expectedRemoteManifest,
    expectedRemoteModifiedAt: value.expectedRemoteModifiedAt,
    choice: value.choice,
  };
}

export function parseEpicLaunchOptions(value: unknown): EpicLaunchOptions {
  if (value === undefined) return {};
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, ["epicSavePolicy", "epicOffline"]) ||
    (value.epicSavePolicy !== undefined &&
      value.epicSavePolicy !== "local-once") ||
    (value.epicOffline !== undefined && typeof value.epicOffline !== "boolean")
  ) {
    return invalid();
  }
  return {
    ...(value.epicSavePolicy ? { epicSavePolicy: value.epicSavePolicy } : {}),
    ...(value.epicOffline !== undefined
      ? { epicOffline: value.epicOffline }
      : {}),
  };
}
