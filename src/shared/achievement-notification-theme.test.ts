import assert from "node:assert/strict";
import test from "node:test";

import {
  ACHIEVEMENT_CUSTOMIZER_END,
  ACHIEVEMENT_CUSTOMIZER_START,
  getAchievementNotificationVariation,
  getAchievementNotificationPreviewFlags,
  getEffectiveAchievementNotificationCss,
  getEffectiveAchievementNotificationSoundVolume,
  getAchievementNotificationWindowPosition,
  parseAchievementNotificationManagedCss,
  updateAchievementNotificationManagedCss,
} from "./achievement-notification-theme.ts";

test("creates a sparse managed block without changing manual CSS", () => {
  const manualCss = ".library { color: red; }\n";
  const nextCss = updateAchievementNotificationManagedCss(
    manualCss,
    "rare",
    "background",
    "#123456"
  );

  assert.ok(nextCss.startsWith(manualCss));
  assert.match(nextCss, /\.achievement-notification--rare/);
  assert.doesNotMatch(nextCss, /achievement-notification--platinum/);
  assert.equal(
    parseAchievementNotificationManagedCss(nextCss).variations.rare.background,
    "#123456"
  );
});

test("reset removes only the selected variation declaration", () => {
  let css = updateAchievementNotificationManagedCss(
    "",
    "default",
    "radius",
    "12"
  );
  css = updateAchievementNotificationManagedCss(css, "hidden", "radius", "24");
  css = updateAchievementNotificationManagedCss(css, "hidden", "radius");

  const parsed = parseAchievementNotificationManagedCss(css);
  assert.equal(parsed.variations.default.radius, "12");
  assert.equal(parsed.variations.hidden.radius, undefined);
  assert.equal(
    getEffectiveAchievementNotificationCss(parsed.variations, "hidden").radius,
    "12"
  );
});

test("default declarations override built-in variation presentation", () => {
  const parsed = parseAchievementNotificationManagedCss(
    updateAchievementNotificationManagedCss(
      "",
      "default",
      "accentColor",
      "#123456"
    )
  );

  assert.equal(
    getEffectiveAchievementNotificationCss(parsed.variations, "rare")
      .accentColor,
    "#123456"
  );
});

test("updating a managed block preserves CSS before and after it", () => {
  const prefix = "/* manual before */\n.library { color: red; }\n\n";
  const suffix = "\n\n/* manual after */\n.sidebar { color: blue; }\n";
  const initial = updateAchievementNotificationManagedCss(
    prefix,
    "rare",
    "scale",
    "1.2"
  ).trimEnd();
  const css = `${initial}${suffix}`;
  const updated = updateAchievementNotificationManagedCss(
    css,
    "platinum",
    "scale",
    "1.5"
  );

  assert.ok(updated.startsWith(prefix));
  assert.ok(updated.endsWith(suffix));
});

test("rejects duplicated or malformed markers", () => {
  const duplicated = `${ACHIEVEMENT_CUSTOMIZER_START}\n${ACHIEVEMENT_CUSTOMIZER_START}\n${ACHIEVEMENT_CUSTOMIZER_END}`;
  assert.equal(
    parseAchievementNotificationManagedCss(duplicated).status,
    "invalid"
  );
  assert.throws(() =>
    updateAchievementNotificationManagedCss(
      duplicated,
      "default",
      "scale",
      "1.2"
    )
  );
});

test("ignores commented-out managed CSS declarations", () => {
  const css = [
    ACHIEVEMENT_CUSTOMIZER_START,
    ".achievement-notification--rare {",
    "  /* --achievement-notification-scale: 1.5; */",
    "}",
    ACHIEVEMENT_CUSTOMIZER_END,
  ].join("\n");

  assert.equal(
    parseAchievementNotificationManagedCss(css).variations.rare.scale,
    undefined
  );
});

test("ignores declarations after an unterminated CSS comment", () => {
  const css = [
    ACHIEVEMENT_CUSTOMIZER_START,
    ".achievement-notification--rare {",
    "  /* --achievement-notification-scale: 1.5;",
    "}",
    ACHIEVEMENT_CUSTOMIZER_END,
  ].join("\n");

  assert.equal(
    parseAchievementNotificationManagedCss(css).variations.rare.scale,
    undefined
  );
});

test("variation resolution follows CSS cascade priority", () => {
  assert.equal(
    getAchievementNotificationVariation({
      isRare: false,
      isHidden: false,
      isPlatinum: false,
    }),
    "default"
  );
  assert.equal(
    getAchievementNotificationVariation({
      isRare: true,
      isHidden: true,
      isPlatinum: false,
    }),
    "hidden"
  );
  assert.equal(
    getAchievementNotificationVariation({
      isRare: true,
      isHidden: true,
      isPlatinum: true,
    }),
    "platinum"
  );
});

test("preview flags isolate every selected variation", () => {
  assert.deepEqual(getAchievementNotificationPreviewFlags("default"), {
    isRare: false,
    isHidden: false,
    isPlatinum: false,
  });
  assert.deepEqual(getAchievementNotificationPreviewFlags("rare"), {
    isRare: true,
    isHidden: false,
    isPlatinum: false,
  });
  assert.deepEqual(getAchievementNotificationPreviewFlags("hidden"), {
    isRare: false,
    isHidden: true,
    isPlatinum: false,
  });
  assert.deepEqual(getAchievementNotificationPreviewFlags("platinum"), {
    isRare: false,
    isHidden: false,
    isPlatinum: true,
  });
});

test("window positioning accounts for work-area offsets", () => {
  assert.deepEqual(
    getAchievementNotificationWindowPosition(
      "bottom-right",
      { x: 100, y: 50, width: 1920, height: 1080 },
      { width: 360, height: 140 }
    ),
    { x: 1660, y: 990 }
  );
});

test("variation sound volume scales the master volume", () => {
  assert.equal(getEffectiveAchievementNotificationSoundVolume(0.5, 0.8), 0.4);
  assert.equal(getEffectiveAchievementNotificationSoundVolume(0.8, 0.25), 0.2);
  assert.equal(getEffectiveAchievementNotificationSoundVolume(0.8), 0.8);
});
