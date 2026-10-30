import assert from "node:assert/strict";
import { it } from "node:test";
import path from "node:path";
import { build } from "esbuild";

it("keeps grade-based trophy scores separate from rarity and set completion", async () => {
  const result = await build({
    entryPoints: [
      path.resolve(
        "src/main/services/achievements/achievement-unlock-notifications.ts"
      ),
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    plugins: [
      {
        name: "notification-dependencies",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /window-manager|notifications$|logger|achievement-notification-presenter-electron/,
            },
            (args) => ({ path: args.path, namespace: "stub" })
          );
          builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents:
              "export const WindowManager={}; export const publishNewAchievementNotification=()=>{}; export const achievementsLogger={}; export const achievementNotificationPresenter={};",
          }));
        },
      },
    ],
  });
  const { buildAchievementNotificationInfo } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
  const info = buildAchievementNotificationInfo(
    [
      { displayName: "Native platinum", points: 7500, trophyGrade: "platinum" },
      { displayName: "Native bronze", points: 375, trophyGrade: "bronze" },
      { displayName: "Native gold", points: 2250, trophyGrade: "gold" },
    ],
    true
  );
  assert.deepEqual(
    info.map((row: { isRare: boolean }) => row.isRare),
    [false, false, false]
  );
  assert.deepEqual(
    info.map((row: { isPlatinum: boolean }) => row.isPlatinum),
    [true, false, false]
  );
  const steam = buildAchievementNotificationInfo(
    [{ displayName: "Rare Steam unlock", points: 2490 }],
    true
  );
  assert.equal(steam[0].isRare, true);
  assert.equal(steam[0].isPlatinum, true);
});
