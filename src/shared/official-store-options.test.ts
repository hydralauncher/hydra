import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  EpicConnectionState,
  EpicGameInstallOption,
  LibraryGame,
} from "@types";
import {
  getEpicGameUpdate,
  getEpicLaunchOptions,
  getOfficialStoreMembers,
  getInstalledStoreMembers,
  isEpicMemberInCurrentScope,
  isEpicUpdateInterrupted,
} from "./official-store-options.js";

const makeGame = (
  shop: "steam" | "epic",
  overrides: Partial<LibraryGame> = {}
) =>
  ({
    id: `${shop}:real-id`,
    shop,
    objectId: "real-id",
    title: "Steam presentation",
    availableShops: ["steam", "epic"],
    catalogueGame: { shop: "steam", objectId: "catalogue-id" },
    hasActiveSteamImport: shop === "steam",
    hasActiveEpicImport: shop === "epic",
    epicImportScope: {
      environment: "test",
      userId: "user",
      connectionId: "connection",
    },
    ...overrides,
  }) as LibraryGame;

describe("official store source and launch choices", () => {
  it("offers the real Epic copy on a Steam-presented game without inventing Steam ownership", () => {
    const epic = makeGame("epic");
    const sources = getOfficialStoreMembers([epic]);
    assert.equal(sources.epic, epic);
    assert.equal(sources.steam, null);
    assert.equal(
      getOfficialStoreMembers([
        makeGame("steam", { hasActiveSteamImport: false }),
      ]).steam,
      null
    );
  });
  it("resolves both real imported copies independent of operational and download selections", () => {
    const steam = makeGame("steam", { executablePath: "steam.exe" });
    const epic = makeGame("epic");
    assert.deepEqual(getOfficialStoreMembers([epic, steam]), { steam, epic });
    assert.equal(
      getOfficialStoreMembers([makeGame("epic", { isDeleted: true })]).epic,
      null
    );
  });
  it("requires a confirmed connection belonging to the imported member and lets main renew expired sessions", () => {
    const connection = {
      hydraLoggedIn: true,
      hydraUserId: "user",
      verification: "confirmed",
      sessionState: "ready",
      availability: { available: true },
      connection: { connected: true, connectionId: "connection" },
      operation: null,
    } as EpicConnectionState;
    assert.equal(
      isEpicMemberInCurrentScope(makeGame("epic"), connection),
      true
    );
    assert.equal(
      isEpicMemberInCurrentScope(makeGame("epic"), {
        ...connection,
        hydraUserId: "other",
      }),
      false
    );
    assert.equal(
      isEpicMemberInCurrentScope(makeGame("epic"), {
        ...connection,
        sessionState: "expired",
      }),
      true
    );
    assert.equal(
      isEpicMemberInCurrentScope(makeGame("epic"), {
        ...connection,
        verification: "unconfirmed",
      }),
      false
    );
    assert.equal(
      isEpicMemberInCurrentScope(
        makeGame("epic", { epicImportScope: undefined }),
        connection
      ),
      false
    );
  });
  it("offers installed Steam before managed Epic and never launches the catalogue identity", () => {
    const steam = makeGame("steam", { executablePath: "steam.exe" });
    const epic = makeGame("epic", {
      executablePath: "epic.exe",
      epicInstallation: {
        owner: {
          environment: "test",
          userId: "user",
          epicAccountId: "account",
        },
        artifactId: "artifact",
        platform: "Windows",
      },
    });
    assert.deepEqual(getInstalledStoreMembers([epic, steam, epic]), [
      steam,
      epic,
    ]);
    assert.equal(
      getInstalledStoreMembers([
        makeGame("epic", { executablePath: "unmanaged.exe" }),
      ]).length,
      0
    );
    assert.equal(getInstalledStoreMembers([makeGame("epic")]).length, 0);
  });
});

describe("Epic game updates", () => {
  const option = (
    overrides: Partial<EpicGameInstallOption> = {}
  ): EpicGameInstallOption => ({
    artifactId: "Artifact",
    platform: "Windows",
    downloadSizeInBytes: 10,
    diskSizeInBytes: 20,
    supportsCloudSaves: false,
    installed: true,
    publishedVersion: "build-2",
    installedVersion: "build-1",
    ...overrides,
  });
  const installation = { artifactId: "Artifact", platform: "Windows" } as const;

  it("reports only the installed artifact when Epic published another build", () => {
    const update = option();
    assert.equal(getEpicGameUpdate([update], installation), update);
    assert.equal(getEpicGameUpdate([update], null), null);
    for (const overrides of [
      { installedVersion: "build-2" },
      { installed: false },
      { publishedVersion: null },
      { installedVersion: null },
      { artifactId: "OtherArtifact" },
      { platform: "Mac" as const },
    ])
      assert.equal(getEpicGameUpdate([option(overrides)], installation), null);
  });

  it("treats only a stopped update as interrupted", () => {
    const update = { fromVersion: "build-1", toVersion: "build-2" };
    assert.equal(isEpicUpdateInterrupted(null), false);
    assert.equal(isEpicUpdateInterrupted({ status: "paused" }), false);
    for (const status of ["paused", "error", "removed"])
      assert.equal(isEpicUpdateInterrupted({ status, epic: { update } }), true);
    for (const status of ["active", "extracting", "complete"])
      assert.equal(
        isEpicUpdateInterrupted({ status, epic: { update } }),
        false
      );
    assert.equal(
      isEpicUpdateInterrupted({
        status: "paused",
        queued: true,
        epic: { update },
      }),
      false
    );
    assert.equal(
      isEpicUpdateInterrupted({
        status: "paused",
        extracting: true,
        epic: { update },
      }),
      false
    );
  });

  it("builds launch options without mixing offline and version-skip launches", () => {
    assert.equal(getEpicLaunchOptions(false, false), undefined);
    assert.deepEqual(getEpicLaunchOptions(false, true, true), {
      epicOffline: true,
    });
    assert.deepEqual(getEpicLaunchOptions(true, false), {
      epicSavePolicy: "local-once",
    });
    assert.deepEqual(getEpicLaunchOptions(false, false, true), {
      epicSkipUpdateCheck: true,
    });
    assert.deepEqual(getEpicLaunchOptions(true, false, true), {
      epicSavePolicy: "local-once",
      epicSkipUpdateCheck: true,
    });
  });
});
