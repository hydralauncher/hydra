import assert from "node:assert/strict";
import os from "node:os";
import { describe, it } from "node:test";
import {
  parseEpicCloudSaveConflict,
  parseEpicCloudSaveSettings,
  parseEpicDownloadPayload,
  parseEpicLaunchOptions,
  parseEpicManagedObjectId,
  parseEpicInstallOptionsRequestId,
} from "./managed-ipc-contract.js";

const payload = {
  epicObjectId: "namespace:item",
  connectionId: "abcdefgh",
  artifactId: "Artifact1",
  platform: "Windows",
  downloadPath: os.tmpdir(),
};

describe("managed Epic IPC contracts", () => {
  it("bounds cancellation IDs without accepting arbitrary IPC payloads", () => {
    assert.equal(parseEpicInstallOptionsRequestId("preview-1"), "preview-1");
    for (const value of [undefined, null, {}, "", "a".repeat(129), "../id"])
      assert.throws(() => parseEpicInstallOptionsRequestId(value));
  });
  it("accepts only store identities and captured install inputs", () => {
    assert.equal(parseEpicManagedObjectId("namespace:item"), "namespace:item");
    assert.deepEqual(parseEpicDownloadPayload(payload), payload);
    const prepared = {
      ...payload,
      preparationId: "ecb21ce2-bd02-4672-a2fb-ce13f481b00a",
    };
    assert.deepEqual(parseEpicDownloadPayload(prepared), prepared);
    for (const overrides of [
      { epicObjectId: "steam:123:extra" },
      { connectionId: "../account" },
      { artifactId: "--override-exe" },
      { artifactId: "app\0command" },
      { platform: "Linux" },
      { downloadPath: "relative/path" },
      { addToQueueOnly: "true" },
      { command: "install" },
      { accessToken: "credential" },
      { preparationId: "../../private/manifest" },
      { preparationId: {} },
    ]) {
      assert.throws(() =>
        parseEpicDownloadPayload({ ...payload, ...overrides })
      );
    }
  });

  it("separates save settings from a single-session launch choice", () => {
    assert.deepEqual(
      parseEpicCloudSaveSettings({ automaticSync: true, savePath: null }),
      { automaticSync: true, savePath: null }
    );
    assert.deepEqual(parseEpicLaunchOptions(undefined), {});
    assert.deepEqual(
      parseEpicLaunchOptions({
        epicSavePolicy: "local-once",
        epicOffline: false,
      }),
      { epicSavePolicy: "local-once", epicOffline: false }
    );
    assert.throws(() => parseEpicCloudSaveSettings({ automaticSync: "yes" }));
    assert.throws(() =>
      parseEpicCloudSaveSettings({ automaticSync: true, savePath: "relative" })
    );
    assert.throws(() =>
      parseEpicLaunchOptions({ epicSavePolicy: "force-upload" })
    );
    assert.throws(() =>
      parseEpicLaunchOptions({ extraArguments: "--offline" })
    );
  });

  it("requires a bounded remote version for resolving a save conflict", () => {
    const conflict = {
      epicObjectId: "namespace:item",
      expectedRemoteManifest: "2026.10.14-12.00.00.manifest",
      expectedRemoteModifiedAt: "2026-10-15T12:00:00.000Z",
      choice: "remote",
    };
    assert.deepEqual(parseEpicCloudSaveConflict(conflict), conflict);
    assert.equal(
      parseEpicCloudSaveConflict({ ...conflict, expectedRemoteManifest: null })
        .expectedRemoteManifest,
      null
    );
    assert.throws(() =>
      parseEpicCloudSaveConflict({
        ...conflict,
        expectedRemoteManifest: "../save",
      })
    );
    assert.throws(() =>
      parseEpicCloudSaveConflict({ ...conflict, choice: "both" })
    );
    for (const expectedRemoteModifiedAt of [
      undefined,
      "invalid",
      "2026-02-31T12:00:00Z",
      1,
    ])
      assert.throws(() =>
        parseEpicCloudSaveConflict({ ...conflict, expectedRemoteModifiedAt })
      );
    assert.throws(() =>
      parseEpicCloudSaveConflict({ ...conflict, force: true })
    );
  });
});
