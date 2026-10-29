import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  EpicConnectionState,
  EpicGameInstallOption,
  LibraryGame,
} from "@types";
import {
  getEpicGameUpdate,
  getEpicInstallChoice,
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
    const update = {
      fromVersion: "build-1",
      toVersion: "build-2",
      filesChanged: true,
    };
    assert.equal(
      isEpicUpdateInterrupted({
        status: "error",
        epic: { update: { ...update, filesChanged: false } },
      }),
      false
    );
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

describe("Epic install choice", () => {
  const option: EpicGameInstallOption = {
    artifactId: "Artifact",
    platform: "Windows",
    downloadSizeInBytes: 100,
    diskSizeInBytes: 200,
    supportsCloudSaves: false,
    installed: false,
    components: [
      { id: "a", name: "A", downloadSizeInBytes: 30, diskSizeInBytes: 60 },
      { id: "b", name: "B", downloadSizeInBytes: 20, diskSizeInBytes: 40 },
    ],
    requiredDownloadSizeInBytes: 50,
    requiredDiskSizeInBytes: 100,
    dlcs: [
      {
        artifactId: "D1",
        name: "D1",
        downloadSizeInBytes: 5,
        diskSizeInBytes: 10,
        installed: false,
      },
      {
        artifactId: "D2",
        name: "D2",
        downloadSizeInBytes: 7,
        diskSizeInBytes: 14,
        installed: true,
      },
    ],
  };
  const none = new Set<string>();

  it("uses the complete game when every component is kept", () => {
    assert.deepEqual(getEpicInstallChoice(option, none, none), {
      components: ["a", "b"],
      dlcs: ["D1"],
      downloadSizeInBytes: 105,
      diskSizeInBytes: 210,
    });
  });

  it("sizes a partial selection from the required files", () => {
    assert.deepEqual(
      getEpicInstallChoice(option, new Set(["a", "b"]), new Set(["D1"])),
      {
        components: [],
        dlcs: [],
        downloadSizeInBytes: 50,
        diskSizeInBytes: 100,
      }
    );
  });

  it("keeps unknown sizes unknown and omits components a build lacks", () => {
    assert.deepEqual(getEpicInstallChoice(null, none, none), {
      dlcs: [],
      downloadSizeInBytes: null,
      diskSizeInBytes: null,
    });
    assert.deepEqual(
      getEpicInstallChoice(
        {
          ...option,
          components: undefined,
          dlcs: undefined,
          downloadSizeInBytes: null,
        },
        none,
        none
      ),
      { dlcs: [], downloadSizeInBytes: null, diskSizeInBytes: 200 }
    );
  });
});
