import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER,
  getEffectiveAchievementNotificationSoundVolume,
  getAchievementNotificationCssVariables,
  getAchievementNotificationSound,
  getAchievementNotificationPosition,
  getAchievementNotificationWindowPosition,
  getAchievementNotificationVariation,
  getAchievementNotificationWindowSize,
  getThemeAchievementNotificationCustomizer,
  isAchievementNotificationCustomizerEnabled,
} from "./achievement-notification-customizer.ts";

test("resolves achievement variation from existing payload fields", () => {
  assert.equal(
    getAchievementNotificationVariation({
      isHidden: false,
      isRare: false,
      isPlatinum: false,
    }),
    "main"
  );
  assert.equal(
    getAchievementNotificationVariation({
      isHidden: false,
      isRare: true,
      isPlatinum: false,
    }),
    "rare"
  );
  assert.equal(
    getAchievementNotificationVariation({
      isHidden: false,
      isRare: false,
      isPlatinum: true,
    }),
    "platinum"
  );
});

test("hidden achievements do not affect variation selection", () => {
  assert.equal(
    getAchievementNotificationVariation({
      isHidden: true,
      isRare: false,
      isPlatinum: false,
    }),
    "main"
  );
  assert.equal(
    getAchievementNotificationVariation({
      isHidden: true,
      isRare: true,
      isPlatinum: false,
    }),
    "rare"
  );
});

test("missing theme customizer preserves default output", () => {
  assert.deepEqual(
    getThemeAchievementNotificationCustomizer(null),
    DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER
  );
});

test("legacy themes merge with structured defaults", () => {
  const customizer = getThemeAchievementNotificationCustomizer({
    achievementNotificationCustomizer: {
      version: 1,
      variations: {
        main: {
          ...DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations.main,
          background: "#123456",
        },
        rare: DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations.rare,
        platinum:
          DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations.platinum,
      },
    },
  });

  assert.equal(customizer.variations.main.background, "#123456");
  assert.equal(
    customizer.variations.rare.accentColor,
    DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations.rare.accentColor
  );
});

test("sound falls back to default when variation sound is not set", () => {
  const customizer = getThemeAchievementNotificationCustomizer(null);
  assert.deepEqual(getAchievementNotificationSound(customizer, "rare"), {
    mode: "default",
    volume: 1,
  });
});

test("sound volume is stored per variation sound", () => {
  const customizer = getThemeAchievementNotificationCustomizer({
    achievementNotificationCustomizer: {
      version: 1,
      variations: DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations,
      sounds: {
        main: { mode: "default", volume: 0.42 },
        rare: { mode: "muted", volume: 0.08 },
      },
    },
  });

  assert.deepEqual(getAchievementNotificationSound(customizer, "main"), {
    mode: "default",
    volume: 0.42,
  });
  assert.deepEqual(getAchievementNotificationSound(customizer, "rare"), {
    mode: "muted",
    volume: 0.08,
  });
});

test("main achievement sound volume caps custom notification volume", () => {
  assert.equal(getEffectiveAchievementNotificationSoundVolume(1, 0.2), 0.2);
  assert.equal(getEffectiveAchievementNotificationSoundVolume(0.2, 1), 0.2);
  assert.equal(getEffectiveAchievementNotificationSoundVolume(0.5, 0.8), 0.5);
  assert.equal(getEffectiveAchievementNotificationSoundVolume(0.8, 0.5), 0.5);
});

test("position resolves per variation with fallback", () => {
  const customizer = getThemeAchievementNotificationCustomizer({
    achievementNotificationCustomizer: {
      version: 1,
      variations: {
        main: {
          ...DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations.main,
          position: "bottom-right",
        },
        rare: DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations.rare,
        platinum:
          DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations.platinum,
      },
    },
  });

  assert.equal(
    getAchievementNotificationPosition(customizer, "main"),
    "bottom-right"
  );
  assert.equal(
    getAchievementNotificationPosition(customizer, "rare", "top-center"),
    "top-left"
  );
});

test("shadow color is independent from accent color", () => {
  const cssVariables = getAchievementNotificationCssVariables({
    ...DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations.main,
    accentColor: "#ff0000",
    shadowColor: "#00ff00",
    shadowIntensity: 50,
  });

  assert.match(cssVariables["--achievement-notification-shadow"], /#00ff00/);
  assert.doesNotMatch(
    cssVariables["--achievement-notification-shadow"],
    /#ff0000/
  );
});

test("customizer is ignored when achievement or custom notifications are disabled", () => {
  assert.equal(isAchievementNotificationCustomizerEnabled({}), true);
  assert.equal(
    isAchievementNotificationCustomizerEnabled({
      achievementNotificationsEnabled: false,
    }),
    false
  );
  assert.equal(
    isAchievementNotificationCustomizerEnabled({
      achievementCustomNotificationsEnabled: false,
    }),
    false
  );
});

test("window bounds account for scale", () => {
  assert.deepEqual(
    getAchievementNotificationWindowSize({
      achievementNotificationCustomizer: {
        version: 1,
        variations: {
          main: {
            ...DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations.main,
            scale: 1.5,
          },
          rare: DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations.rare,
          platinum:
            DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations.platinum,
        },
      },
    }),
    { width: 540, height: 210 }
  );
});

test("window position matches selected screen anchor", () => {
  const display = { x: 100, y: 50, width: 1920, height: 1080 };
  const size = { width: 400, height: 160 };

  assert.deepEqual(
    getAchievementNotificationWindowPosition("top-left", display, size),
    { x: 100, y: 50 }
  );
  assert.deepEqual(
    getAchievementNotificationWindowPosition("top-center", display, size),
    { x: 860, y: 50 }
  );
  assert.deepEqual(
    getAchievementNotificationWindowPosition("top-right", display, size),
    { x: 1620, y: 50 }
  );
  assert.deepEqual(
    getAchievementNotificationWindowPosition("bottom-left", display, size),
    { x: 100, y: 970 }
  );
  assert.deepEqual(
    getAchievementNotificationWindowPosition("bottom-center", display, size),
    { x: 860, y: 970 }
  );
  assert.deepEqual(
    getAchievementNotificationWindowPosition("bottom-right", display, size),
    { x: 1620, y: 970 }
  );
});
