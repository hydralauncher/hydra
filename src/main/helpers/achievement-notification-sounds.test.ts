import test from "node:test";
import assert from "node:assert/strict";

import type { AchievementNotificationVariation } from "@types";
import {
  getEffectiveThemeAchievementSound,
  getVariationSoundAssetName,
  isSupportedAchievementNotificationVariation,
} from "./achievement-notification-sounds.ts";

test("variation sounds inherit the default theme sound", () => {
  const theme = {
    hasCustomSound: true,
    originalSoundPath: "C:/sounds/default.wav",
    achievementSounds: {
      default: { mode: "file" as const, volume: 0.6 },
      rare: { mode: "inherit" as const },
      hidden: { mode: "muted" as const },
    },
  };

  assert.deepEqual(getEffectiveThemeAchievementSound(theme, "rare"), {
    mode: "file",
    volume: 0.6,
  });
  assert.deepEqual(getEffectiveThemeAchievementSound(theme, "hidden"), {
    mode: "muted",
  });
});

test("valid achievement notification variations are accepted", () => {
  assert.equal(isSupportedAchievementNotificationVariation("default"), true);
  assert.equal(isSupportedAchievementNotificationVariation("rare"), true);
  assert.equal(isSupportedAchievementNotificationVariation("hidden"), true);
  assert.equal(isSupportedAchievementNotificationVariation("platinum"), true);
});

test("invalid achievement notification variations are rejected at runtime", () => {
  assert.equal(
    isSupportedAchievementNotificationVariation("../../etc/rc.local"),
    false
  );
  assert.equal(isSupportedAchievementNotificationVariation("main"), false);
  assert.equal(isSupportedAchievementNotificationVariation(null), false);
});

test("variation sound asset names cannot be built from invalid variations", () => {
  assert.equal(
    getVariationSoundAssetName("default", ".mp3"),
    "achievement.mp3"
  );
  assert.equal(
    getVariationSoundAssetName("rare", ".MP3"),
    "achievement-rare.mp3"
  );
  assert.equal(
    getVariationSoundAssetName("hidden", ".ogg"),
    "achievement-hidden.ogg"
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
