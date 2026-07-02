import test from "node:test";
import assert from "node:assert/strict";

import type { AchievementNotificationVariation } from "@types";
import {
  getVariationSoundAssetName,
  isSupportedAchievementNotificationVariation,
} from "./achievement-notification-sounds.ts";

test("valid achievement notification variations are accepted", () => {
  assert.equal(isSupportedAchievementNotificationVariation("main"), true);
  assert.equal(isSupportedAchievementNotificationVariation("rare"), true);
  assert.equal(isSupportedAchievementNotificationVariation("platinum"), true);
});

test("invalid achievement notification variations are rejected at runtime", () => {
  assert.equal(
    isSupportedAchievementNotificationVariation("../../etc/rc.local"),
    false
  );
  assert.equal(isSupportedAchievementNotificationVariation("hidden"), false);
  assert.equal(isSupportedAchievementNotificationVariation(null), false);
});

test("variation sound asset names cannot be built from invalid variations", () => {
  assert.equal(
    getVariationSoundAssetName("main", ".mp3"),
    "achievement-main.mp3"
  );
  assert.equal(
    getVariationSoundAssetName("rare", ".MP3"),
    "achievement-rare.mp3"
  );
  assert.throws(
    () =>
      getVariationSoundAssetName(
        "../../etc/rc.local" as AchievementNotificationVariation,
        ".mp3"
      ),
    /Unsupported achievement notification variation/
  );
  assert.throws(
    () => getVariationSoundAssetName("platinum", "../achievement.mp3"),
    /Unsupported achievement sound file/
  );
});
