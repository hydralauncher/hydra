import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Game } from "../../types/level.types.js";
import {
  applyGameInstallation,
  buildGameInstallation,
  getLegacyInstallationId,
} from "./game-installation-context.js";

const game = {
  title: "Horizon Zero Dawn",
  iconUrl: null,
  libraryHeroImageUrl: null,
  logoImageUrl: null,
  playTimeInMilliseconds: 0,
  lastTimePlayed: null,
  objectId: "epic-hzd",
  shop: "epic",
  canonicalGameId: "canonical-hzd",
  storeMappingId: "mapping-hzd",
  installationId: null,
  remoteId: "remote-hzd",
  isDeleted: false,
  executablePath: "/games/hzd/HorizonZeroDawn.exe",
  executablePathUpdatedAt: new Date("2026-09-12T00:00:00.000Z"),
  trackingExecutablePaths: ["/games/hzd/HorizonZeroDawn.exe"],
  trackingExecutablePathsUpdatedAt: new Date("2026-09-12T00:00:00.000Z"),
  winePrefixPath: "/games/hzd/prefix",
  protonPath: "proton-ge",
  launchOptions: "-novid",
  autoRunMangohud: false,
  autoRunGamemode: true,
  automaticCloudSync: true,
  installedSizeInBytes: 42,
} as Game;

describe("game installation context", () => {
  it("creates a stable legacy installation id per store and object", () => {
    assert.equal(getLegacyInstallationId("steam", "42"), "legacy:steam:42");
    assert.equal(getLegacyInstallationId("epic", "42"), "legacy:epic:42");
    assert.notEqual(
      getLegacyInstallationId("epic", "42"),
      getLegacyInstallationId("steam", "42")
    );
  });

  it("preserves existing local installation fields while adding canonical context", () => {
    const current = buildGameInstallation(game, "legacy:epic:epic-hzd");
    const updated = buildGameInstallation(
      {
        ...game,
        canonicalGameId: "canonical-hzd-v2",
        executablePath: null,
        launchOptions: null,
      },
      "legacy:epic:epic-hzd",
      current
    );

    assert.equal(updated.canonicalGameId, "canonical-hzd-v2");
    assert.equal(updated.storeMappingId, "mapping-hzd");
    assert.equal(updated.executablePath, current.executablePath);
    assert.equal(updated.launchOptions, current.launchOptions);
    assert.equal(updated.installedSizeInBytes, 42);
  });

  it("applies installation fields without changing the legacy game identity", () => {
    const installation = buildGameInstallation(game, "legacy:epic:epic-hzd");
    const applied = applyGameInstallation(
      { ...game, installationId: null, executablePath: null },
      installation
    );

    assert.equal(applied.shop, "epic");
    assert.equal(applied.objectId, "epic-hzd");
    assert.equal(applied.installationId, "legacy:epic:epic-hzd");
    assert.equal(applied.canonicalGameId, "canonical-hzd");
    assert.equal(applied.executablePath, game.executablePath);
    assert.equal(applied.installedSizeInBytes, 42);
  });
});
