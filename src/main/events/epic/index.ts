import {
  getEpicConnection,
  getGameLinuxCompatibility,
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
  parseEpicInstallOptionsRequestId,
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

const installOptionsRequests = new WeakMap<
  Electron.WebContents,
  { controllers: Map<string, AbortController>; stop: () => void }
>();

registerEvent(
  "getEpicGameInstallOptions",
  (event, objectId: unknown, requestId: unknown) => {
    assertTrustedSender(event, true);
    const id = parseEpicManagedObjectId(objectId);
    // Older renderers have no cancellation request ID.
    if (requestId === undefined) return getEpicGameInstallOptions(id);
    const key = parseEpicInstallOptionsRequestId(requestId);
    const sender = event.sender;
    let requests = installOptionsRequests.get(sender);
    if (!requests) {
      const controllers = new Map<string, AbortController>();
      const stop = () => {
        for (const controller of controllers.values()) controller.abort();
        controllers.clear();
        installOptionsRequests.delete(sender);
      };
      requests = { controllers, stop };
      installOptionsRequests.set(sender, requests);
      sender.once("destroyed", stop);
    }
    requests.controllers.get(key)?.abort();
    const controller = new AbortController();
    requests.controllers.set(key, controller);
    const active = requests;
    return Promise.resolve()
      .then(() => getEpicGameInstallOptions(id, controller.signal))
      .finally(() => {
        if (active.controllers.get(key) !== controller) return;
        active.controllers.delete(key);
        if (!active.controllers.size) {
          sender.removeListener("destroyed", active.stop);
          installOptionsRequests.delete(sender);
        }
      });
  }
);

registerEvent("cancelEpicGameInstallOptions", (event, requestId: unknown) => {
  assertTrustedSender(event, true);
  const key = parseEpicInstallOptionsRequestId(requestId);
  installOptionsRequests.get(event.sender)?.controllers.get(key)?.abort();
});
registerEvent(
  "getGameLinuxCompatibility",
  (event, shop: unknown, objectId: unknown) => {
    assertTrustedSender(event, true);
    if (shop !== "epic") return null;
    return getGameLinuxCompatibility(shop, parseEpicManagedObjectId(objectId));
  }
);
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
