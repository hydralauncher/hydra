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
// @ts-ignore The Node ESM test runner requires the source extension.
import * as libraryCategory from "./library-category.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import * as libraryCatalogue from "../../../../shared/library-catalogue.ts";

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
    "./library-category": libraryCategory,
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
      SteamLibraryBadge: (props: {
        source?: string;
        availableShops?: string[];
      }) =>
        React.createElement(
          "span",
          {
            "data-store": props.source ?? "steam",
            "data-available-shops": props.availableShops?.join(","),
          },
          props.source === "epic" ? "Epic" : "Steam"
        ),
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

function renderCatalogueBadge(
  source: "steam" | "epic",
  availableShops: string[],
  imports: {
    hasActiveSteamImport?: boolean;
    hasActiveEpicImport?: boolean;
  } = {}
) {
  const filename = path.join(
    rendererPath,
    "components/steam-library-badge/steam-library-badge.tsx"
  );
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const exports: Record<string, React.ElementType> = {};
  const stubs: Record<string, unknown> = {
    "react-dom": { createPortal: (child: React.ReactNode) => child },
    "react-tooltip": { Tooltip: () => null },
    "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
  };
  new Function("exports", "require", "document", outputText)(
    exports,
    (name: string) => {
      if (name.endsWith(".scss")) return {};
      if (name.endsWith(".svg?react"))
        return function SvgFixture() {
          return React.createElement("svg", {
            "data-store": name.includes("epic-integration-logo")
              ? "epic"
              : "steam",
          });
        };
      return stubs[name] ?? requireModule(name);
    },
    { body: null }
  );
  return new JSDOM(
    renderToStaticMarkup(
      React.createElement(exports.SteamLibraryBadge, {
        source,
        availableShops,
        ...imports,
        variant: "sidebar",
      })
    )
  );
}

describe("visibility and playtime badge layout", () => {
  it("keeps Big Picture operations on raw members and group preferences on the group", () => {
    const filename = path.resolve(
      process.cwd(),
      "src/big-picture/src/components/pages/library/game-context-menu-items.tsx"
    );
    const { outputText } = ts.transpileModule(
      fs.readFileSync(filename, "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
        fileName: filename,
      }
    );
    const exports: Record<string, (...args: unknown[]) => unknown> = {};
    new Function("exports", "require", outputText)(exports, (name: string) => {
      if (name === "@shared") return libraryCatalogue;
      if (name === "@phosphor-icons/react")
        return new Proxy(
          {},
          {
            get: () =>
              function IconFixture() {
                return null;
              },
          }
        );
      if (name === "./library-data")
        return {
          isLibraryGamePlayable: (game: { executablePath?: string }) =>
            Boolean(game.executablePath),
        };
      return requireModule(name);
    });
    const member = {
      id: "epic",
      objectId: "epic-id",
      shop: "epic",
      title: "Game",
      executablePath: "/game.exe",
      playTimeInMilliseconds: 5,
      download: { downloadPath: "/download" },
    };
    const presentation = {
      ...member,
      playTimeInMilliseconds: 18,
      operationalGame: member,
      members: [member],
    };
    const calls: Record<string, unknown> = {};
    const handlers = Object.fromEntries(
      [
        ["onLaunchOrDownload", "launch"],
        ["onOptions", "options"],
        ["onUninstall", "uninstall"],
        ["onToggleFavorite", "favorite"],
        ["onRemoveFromLibrary", "remove"],
      ].map(([name, key]) => [
        name,
        (game: unknown) => {
          calls[key] = game;
        },
      ])
    );
    const items = exports.buildLibraryGameContextMenuItems(
      presentation,
      handlers,
      false
    ) as { onSelect: () => void }[];
    items.forEach((item) => item.onSelect());
    assert.equal(calls.launch, member);
    assert.equal(calls.options, member);
    assert.equal(calls.uninstall, member);
    assert.equal(calls.favorite, presentation);
    assert.equal(calls.remove, presentation);
    assert.equal(member.playTimeInMilliseconds, 5);
  });
  it("preserves an explicit legacy source without claiming both catalogue stores were imported", () => {
    const dom = renderCatalogueBadge("steam", ["steam", "epic"]);
    const badge = dom.window.document.querySelector(".steam-library-badge")!;
    assert.equal(badge.querySelector(".steam-library-badge__additional"), null);
    assert.equal(
      badge.getAttribute("data-tooltip-content"),
      "imported_from_steam"
    );
    assert.equal(badge.getAttribute("aria-label"), "imported_from_steam");
    dom.window.close();
  });

  it("preserves an explicit Epic source for callers with old undefined flags", () => {
    const dom = renderCatalogueBadge("epic", ["epic"]);
    assert.equal(
      dom.window.document.querySelector(".steam-library-badge__additional"),
      null
    );
    assert.equal(
      dom.window.document
        .querySelector(".steam-library-badge")
        ?.getAttribute("data-tooltip-content"),
      "imported_from_epic"
    );
    dom.window.close();
  });
  it("describes imports from both libraries when both are active", () => {
    const dom = renderCatalogueBadge("epic", [], {
      hasActiveSteamImport: true,
      hasActiveEpicImport: true,
    });
    const badge = dom.window.document.querySelector(".steam-library-badge")!;
    assert.equal(
      badge.getAttribute("data-tooltip-content"),
      "imported_from_steam_and_epic"
    );
    assert.equal(
      badge.getAttribute("aria-label"),
      "imported_from_steam_and_epic"
    );
    assert.equal(
      badge.querySelector(".steam-library-badge__additional")?.textContent,
      "+"
    );
    assert.equal(
      badge.querySelector("svg")?.getAttribute("data-store"),
      "steam"
    );
    dom.window.close();
  });

  it("describes only the imported library even when both stores are available", () => {
    for (const source of ["steam", "epic"] as const) {
      const dom = renderCatalogueBadge("steam", ["steam", "epic"], {
        hasActiveSteamImport: source === "steam",
        hasActiveEpicImport: source === "epic",
      });
      const badge = dom.window.document.querySelector(".steam-library-badge")!;
      assert.equal(
        badge.getAttribute("data-tooltip-content"),
        `imported_from_${source}`
      );
      assert.equal(
        badge.querySelector(".steam-library-badge__additional"),
        null
      );
      assert.equal(
        badge.querySelector("svg")?.getAttribute("data-store"),
        source
      );
      dom.window.close();
    }
  });
  it("shows an Epic import badge while preserving Steam catalogue presentation", () => {
    const dom = renderCard(layouts[0], {
      shop: "epic",
      canonicalId: "same-game",
      catalogueGame: { shop: "steam", objectId: "123" },
      availableShops: ["steam", "epic"],
      hasActiveEpicImport: true,
      hasActiveSteamImport: false,
    });
    assert.equal(
      dom.window.document.querySelectorAll('[data-store="epic"]').length,
      1
    );
    assert.equal(
      dom.window.document.querySelector('[data-store="steam"]'),
      null
    );
    assert.equal(
      dom.window.document
        .querySelector('[data-store="epic"]')
        ?.getAttribute("data-available-shops"),
      "steam,epic"
    );
    dom.window.close();
  });

  it("does not add an import badge from catalogue metadata when imports are absent", () => {
    for (const imports of [
      {},
      { hasActiveSteamImport: false, hasActiveEpicImport: false },
    ]) {
      const dom = renderCard(layouts[0], {
        shop: "epic",
        canonicalId: "same-game",
        catalogueGame: { shop: "steam", objectId: "123" },
        availableShops: ["steam", "epic"],
        ...imports,
      });
      assert.equal(
        dom.window.document.querySelector('[data-store="steam"]'),
        null
      );
      assert.equal(
        dom.window.document.querySelector('[data-store="epic"]'),
        null
      );
      dom.window.close();
    }
  });

  it("drops the plus and uses the surviving Epic import after Steam is disconnected", () => {
    const dom = renderCatalogueBadge("steam", ["steam", "epic"], {
      hasActiveSteamImport: false,
      hasActiveEpicImport: true,
    });
    const badge = dom.window.document.querySelector(".steam-library-badge")!;
    assert.equal(badge.querySelector(".steam-library-badge__additional"), null);
    assert.equal(
      badge.querySelector("svg")?.getAttribute("data-store"),
      "epic"
    );
    assert.equal(badge.getAttribute("aria-label"), "imported_from_epic");
    dom.window.close();
  });

  it("keeps an Epic-only catalogue game as Epic", () => {
    const dom = renderCard(layouts[0], {
      shop: "epic",
      canonicalId: "epic-only",
      catalogueGame: { shop: "epic", objectId: "epic-game" },
      availableShops: ["epic"],
      hasActiveEpicImport: true,
    });
    assert.ok(dom.window.document.querySelector('[data-store="epic"]'));
    assert.equal(
      dom.window.document.querySelector('[data-store="steam"]'),
      null
    );
    dom.window.close();
  });
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
