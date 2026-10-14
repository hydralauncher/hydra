import {
  getEpicConnection,
  startEpicAuth,
  cancelEpicAuth,
  disconnectEpic,
  startEpicSync,
  getEpicSyncState,
  cancelEpicSync,
  syncEpicGameOnGamePage,
  getEpicGameInstallOptions,
  startEpicGameDownload,
  getEpicCloudSaveState,
  setEpicCloudSaveSettings,
  syncEpicCloudSaves,
  resolveEpicCloudSaveConflict,
} from "../../services/epic";
import { registerEvent } from "../register-event";
import { assertTrustedEpicSender as assertTrustedSender } from "./assert-trusted-sender";
import {
  parseEpicManagedObjectId,
  parseEpicDownloadPayload,
  parseEpicCloudSaveSettings,
  parseEpicCloudSaveConflict,
} from "./managed-ipc-contract";

registerEvent("getEpicConnection", (event) => {
  assertTrustedSender(event, true);
  return getEpicConnection();
});
registerEvent("startEpicAuth", (event) => {
  assertTrustedSender(event);
  return startEpicAuth();
});
registerEvent("cancelEpicAuth", (event, operationId: string) => {
  assertTrustedSender(event);
  return cancelEpicAuth(operationId);
});
registerEvent("disconnectEpic", (event, connectionId: string) => {
  assertTrustedSender(event);
  return disconnectEpic(connectionId);
});

registerEvent("startEpicSync", (event, connectionId: string) => {
  assertTrustedSender(event, true);
  return startEpicSync(connectionId);
});
registerEvent("getEpicSyncState", (event) => {
  assertTrustedSender(event, true);
  return getEpicSyncState();
});
registerEvent("cancelEpicSync", (event, connectionId: string) => {
  assertTrustedSender(event, true);
  return cancelEpicSync(connectionId);
});
registerEvent("syncEpicGameOnGamePage", (event, objectId: string) => {
  assertTrustedSender(event, true);
  return syncEpicGameOnGamePage(objectId);
});

registerEvent("getEpicGameInstallOptions", (event, objectId: unknown) => {
  assertTrustedSender(event, true);
  return getEpicGameInstallOptions(parseEpicManagedObjectId(objectId));
});
registerEvent("startEpicGameDownload", (event, payload: unknown) => {
  assertTrustedSender(event, true);
  return startEpicGameDownload(parseEpicDownloadPayload(payload));
});
registerEvent("getEpicCloudSaveState", (event, objectId: unknown) => {
  assertTrustedSender(event, true);
  return getEpicCloudSaveState(parseEpicManagedObjectId(objectId));
});
registerEvent(
  "setEpicCloudSaveSettings",
  (event, objectId: unknown, settings: unknown) => {
    assertTrustedSender(event, true);
    return setEpicCloudSaveSettings(
      parseEpicManagedObjectId(objectId),
      parseEpicCloudSaveSettings(settings)
    );
  }
);
registerEvent("syncEpicCloudSaves", (event, objectId: unknown) => {
  assertTrustedSender(event, true);
  return syncEpicCloudSaves(parseEpicManagedObjectId(objectId));
});
registerEvent("resolveEpicCloudSaveConflict", (event, payload: unknown) => {
  assertTrustedSender(event, true);
  return resolveEpicCloudSaveConflict(parseEpicCloudSaveConflict(payload));
});
