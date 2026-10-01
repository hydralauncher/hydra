import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "sass-embedded";
import ts from "typescript";

const requireModule = createRequire(import.meta.url);
const rendererPath = path.resolve(process.cwd(), "src/renderer/src");
const profileContext = React.createContext({ userProfile: null, isMe: true });

const visibilityBadge = (props: Record<string, unknown>) =>
  props.isHiddenFromOthers || props.isConcealed
    ? React.createElement("span", { className: "game-visibility-badge" })
    : null;

const layouts = [
  {
    file: "pages/library/library-game-card",
    component: "LibraryGameCard",
    prefix: "library-game-card",
  },
  {
    file: "pages/profile/profile-content/user-library-game-card",
    component: "UserLibraryGameCard",
    prefix: "user-library-game",
  },
] as const;

function renderCard(
  layout: (typeof layouts)[number],
  gameOverrides: Record<string, unknown> = {},
  preferences: Record<string, boolean> = {}
) {
  const filename = path.join(rendererPath, `${layout.file}.tsx`);
  const source = fs.readFileSync(filename, "utf8");
  const stubs: Record<string, unknown> = {
    "@renderer/hooks": {
      useGameCard: () => ({
        formatPlayTime: () => "0 minutes",
        handleCardClick: () => {},
        handleContextMenuClick: () => {},
      }),
      useAppSelector: () => preferences,
      useCoverPoster: () => undefined,
      isAnimatedCoverCandidate: () => false,
      useAnimatedSourceWarmup: () => {},
      useFormat: () => ({ numberFormatter: new Intl.NumberFormat("en") }),
    },
    "@shared": { getDisplayedPlayTimeInMilliseconds: () => 0 },
    "@renderer/helpers": {
      CLASSICS_PS_PLATFORM_LABELS: {},
      isGameReadyToPlay: (game: Record<string, unknown>) => game.isInstalled,
      shouldShowSteamLibraryBadge: (game: Record<string, unknown>) =>
        game.hasActiveSteamImport && !preferences.hideSteamLibraryBadges,
      resolveClassicsBadge: (_shop: string, platform?: string) => ({
        label: platform,
      }),
      isGameCompleted: () => false,
    },
    "@renderer/components": {
      SteamLibraryBadge: () => React.createElement("span", null, "Steam"),
      VerticalCoverCard: ({ children }: { children: React.ReactNode }) =>
        React.createElement("div", null, children),
    },
    "@renderer/components/game-visibility-badge/game-visibility-badge": {
      GameVisibilityBadge: visibilityBadge,
    },
    "@renderer/context": { userProfileContext: profileContext },
    "@renderer/constants": { MAX_MINUTES_TO_SHOW_IN_PLAYTIME: 120 },
    "@renderer/assets/icons/hydra.svg?react": { default: () => null },
    "@renderer/pages/settings/emulation/emulator-icons": {
      EMULATOR_ICONS: {},
    },
    "@renderer/logger": { logger: { warn: () => {} } },
    "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
    "react-router-dom": { useNavigate: () => () => {} },
  };
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const exports: Record<string, React.ElementType> = {};
  new Function("exports", "require", outputText)(exports, (name: string) => {
    if (name.endsWith(".scss")) return {};
    return stubs[name] ?? requireModule(name);
  });

  const html = renderToStaticMarkup(
    React.createElement(exports[layout.component], {
      game: {
        id: "test",
        objectId: "test",
        title: "Test game",
        ...gameOverrides,
      },
      onContextMenu: () => {},
      statIndex: 0,
    })
  );
  const css = compile(path.join(rendererPath, `${layout.file}.scss`)).css;
  // Only the base row rules are needed; responsive behavior is checked visually.
  const rowRules = ["top-section", "top-left", "top-right"].map((suffix) => {
    const selector = `.${layout.prefix}__${suffix}`;
    return css.match(new RegExp(`\\${selector}\\s*\\{[^{}]*\\}`))?.[0] ?? "";
  });
  return new JSDOM(`<style>${rowRules.join("\n")}</style>${html}`);
}

describe("visibility and playtime badge layout", () => {
  for (const layout of layouts) {
    it(`${layout.component} keeps playtime visible when no visibility badge is needed`, () => {
      const dom = renderCard(layout);
      const { document } = dom.window;
      assert.equal(document.querySelector(".game-visibility-badge"), null);
      const playtime = document.querySelector(`.${layout.prefix}__playtime`);
      assert.ok(playtime);
      assert.equal(
        dom.window.getComputedStyle(playtime.parentElement!).justifyContent,
        "flex-start"
      );
      dom.window.close();
    });

    for (const field of ["isHiddenFromOthers", "isConcealed"]) {
      it(`${layout.component} keeps ${field} next to playtime without optional badges`, () => {
        const dom = renderCard(layout, { [field]: true });
        const { document } = dom.window;
        const badge = document.querySelector(".game-visibility-badge");
        const playtime = document.querySelector(`.${layout.prefix}__playtime`);
        assert.ok(badge);
        assert.ok(playtime);
        assert.equal(badge.parentElement, playtime.parentElement);
        const style = dom.window.getComputedStyle(badge.parentElement!);
        assert.equal(style.display, "flex");
        assert.equal(style.justifyContent, "flex-start");
        assert.equal(style.gap, "4px");
        dom.window.close();
      });
    }
  }

  it("keeps optional library badges outside the visibility/playtime group", () => {
    const dom = renderCard(layouts[0], {
      isHiddenFromOthers: true,
      hasActiveSteamImport: true,
      platform: "SNES",
      isInstalled: true,
    });
    const { document } = dom.window;
    const badge = document.querySelector(".game-visibility-badge")!;
    const right = document.querySelector(".library-game-card__top-right");
    assert.ok(right);
    assert.equal(right.parentElement, badge.parentElement!.parentElement);
    assert.equal(right.contains(badge), false);
    assert.equal(dom.window.getComputedStyle(right).marginLeft, "auto");
    assert.match(right.textContent!, /Steam/);
    assert.match(right.textContent!, /SNES/);
    assert.match(right.textContent!, /installed/);
    dom.window.close();
  });

  it("preserves visibility badges when playtime and optional badges are disabled", () => {
    const dom = renderCard(
      layouts[0],
      { isConcealed: true, hasActiveSteamImport: true, isInstalled: true },
      {
        hideLibraryGameBadges: true,
        hideSteamLibraryBadges: true,
        hideLibraryReadySizeBadges: true,
      }
    );
    assert.ok(dom.window.document.querySelector(".game-visibility-badge"));
    assert.equal(
      dom.window.document.querySelector(".library-game-card__playtime"),
      null
    );
    assert.equal(
      dom.window.document.querySelector(".library-game-card__top-right"),
      null
    );
    dom.window.close();
  });
});
