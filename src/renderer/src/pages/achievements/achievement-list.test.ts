import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as shared from "../../../../shared/achievement-list.js";

const requireModule = createRequire(import.meta.url);

it("shows RPCS3 grades without points or a points upsell, while retaining Steam points", () => {
  let subscribed = false;
  const empty = () => null;
  const stubs: Record<string, unknown> = {
    "@renderer/hooks": {
      useAppSelector: () => false,
      useUserDetails: () => ({ hasActiveSubscription: subscribed }),
    },
    "@renderer/hooks/use-subscription": {
      useSubscription: () => ({ showHydraCloudModal: empty }),
    },
    "react-i18next": {
      useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: "en" },
      }),
    },
    "./achievements.scss": {},
    "@primer/octicons-react": new Proxy({}, { get: () => empty }),
    "@renderer/assets/icons/hydra.svg?react": {
      __esModule: true,
      default: () => React.createElement("svg"),
    },
    "@renderer/components": { FullscreenMediaModal: empty, TextField: empty },
    "@renderer/components/retro-achievements-connect-banner/retro-achievements-connect-banner":
      { RetroAchievementsConnectBanner: empty },
    "@shared": shared,
    "./achievement-select": { AchievementSelect: empty },
    "./achievement-set-header": { AchievementSetHeader: empty },
    "./achievement-icon": {
      AchievementIcon: empty,
      AchievementIconPreload: empty,
    },
    "../../../../shared/use-achievement-list-state": {
      useCollapsedAchievementSets: () => ({
        collapsedSetKeys: new Set(),
        toggleSet: empty,
      }),
      useRevealedAchievements: () => ({
        revealedNames: new Set(),
        lastRevealedName: null,
        revealAchievement: empty,
      }),
    },
    "./use-virtual-achievement-list": {
      useVirtualAchievementList: ({ count }: { count: number }) => ({
        listRef: null,
        getRowProps: () => ({}),
        virtualizer: {
          getTotalSize: () => count,
          getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
              index,
              key: index,
              start: index,
            })),
        },
      }),
    },
  };
  const file = new URL("./achievement-list.tsx", import.meta.url);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: file.pathname,
  });
  const exports: Record<
    string,
    React.ComponentType<Record<string, unknown>>
  > = {};
  new Function("exports", "require", outputText)(
    exports,
    (name: string) => stubs[name] ?? requireModule(name)
  );
  const fixture = {
    name: "NPWR12345_00:0",
    displayName: "Fixture trophy",
    hidden: false,
    unlocked: true,
    unlockTime: null,
    source: "rpcs3",
    trophyGrade: "bronze",
    // Old cached scores must not bring back a points icon or points upsell.
    points: 375,
  };
  const render = (achievement: Record<string, unknown>) =>
    renderToStaticMarkup(
      React.createElement(exports.AchievementList, {
        achievements: [achievement],
        scrollElement: null,
        pointsSummary: { earned: 375, total: 7500 },
      })
    );
  for (const subscription of [false, true]) {
    subscribed = subscription;
    const html = render(fixture);
    assert.match(html, /trophy_grade_bronze/);
    assert.match(html, /Fixture trophy/);
    assert.doesNotMatch(
      html,
      /achievements__item-points|achievements__toolbar-points/
    );
  }
  const steam = render({ ...fixture, source: "steam", trophyGrade: undefined });
  assert.match(steam, /achievements__item-points/);
  assert.match(steam, /achievements__toolbar-points/);
});
