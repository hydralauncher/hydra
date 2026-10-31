import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  Game,
  PendingAchievementSouvenir,
  SteamAchievement,
} from "@types";
import { buildAchievementSouvenirSyncItem } from "./grouped-souvenir-sync-item.js";

const souvenir: PendingAchievementSouvenir = {
  clientId: "client",
  ownerId: "owner",
  remoteGameId: "remote",
  gameKey: "steam:game",
  screenshotPath: "/screenshots/photo.jpeg",
  capturedAt: 10,
  achievements: [
    { name: "FIRST", unlockTime: 10 },
    { name: "SECOND", unlockTime: 10 },
  ],
  status: "paused",
  attemptCount: 1,
};

describe("souvenir cleanup metadata", () => {
  it("shows every achievement with its display name and icon, and honors custom game artwork", () => {
    const item = buildAchievementSouvenirSyncItem(
      souvenir,
      {
        title: "Game",
        iconUrl: "https://game/icon",
        customIconUrl: "local:custom.png",
      } as Game,
      [
        {
          name: "first",
          displayName: "First steps",
          icon: "https://achievement/icon",
        } as SteamAchievement,
      ]
    );
    assert.equal(item.gameTitle, "Game");
    assert.equal(item.gameIconUrl, "local:custom.png");
    assert.equal(item.screenshotPath, souvenir.screenshotPath);
    assert.deepEqual(item.achievements, [
      {
        name: "FIRST",
        displayName: "First steps",
        iconUrl: "https://achievement/icon",
      },
      { name: "SECOND", displayName: "SECOND", iconUrl: null },
    ]);
  });

  it("keeps the screenshot and achievement names available without game or catalogue data", () => {
    const item = buildAchievementSouvenirSyncItem(
      { ...souvenir, status: "terminal" },
      null,
      []
    );
    assert.equal(item.status, "failed");
    assert.equal(item.gameTitle, null);
    assert.equal(item.gameIconUrl, null);
    assert.deepEqual(item.achievementNames, ["FIRST", "SECOND"]);
    assert.ok(item.achievements?.every((entry) => entry.iconUrl === null));
  });
});
