import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { LibraryGame } from "@types";
import {
  getGameCatalogueIdentity,
  getLibraryOperationalGame,
  groupLibraryGames,
} from "../../../../shared/library-catalogue.js";
import { getLibraryPresentationBadgeSource } from "../../pages/library/library-category.js";

const requireModule = createRequire(import.meta.url);
const filename = "src/renderer/src/components/sidebar/sidebar-game-item.tsx";
const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
  fileName: filename,
});
const stubs: Record<string, unknown> = {
  "@shared": { getGameCatalogueIdentity, getLibraryOperationalGame },
  "@renderer/hooks": {
    useAppSelector: () => ({}),
    useToast: () => ({ showWarningToast: () => {} }),
  },
  "@renderer/context": {
    useCollectionContextMenu: () => ({ openCollectionContextMenu: () => {} }),
  },
  "@renderer/pages/library/library-category": {
    getLibraryPresentationBadgeSource,
  },
  "react-router-dom": {
    useLocation: () => ({ pathname: "/game/steam/123" }),
  },
  "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
  "..": {
    ConfirmationModal: () => null,
    GameContextMenu: () => null,
    SteamLibraryBadge: () => null,
    useGameActions: () => ({ canPlay: true, rpcs3ConfirmPending: null }),
  },
};
const exports: Record<string, React.ElementType> = {};
new Function("exports", "require", outputText)(exports, (name: string) => {
  if (name.endsWith(".svg?react")) {
    return function StoreLogo(props: Record<string, unknown>) {
      return React.createElement("svg", {
        ...props,
        "data-store-logo": name.includes("epic") ? "epic" : "steam",
      });
    };
  }
  return stubs[name] ?? requireModule(name);
});

const epic: LibraryGame = {
  id: "epic:namespace:game",
  shop: "epic",
  objectId: "namespace:game",
  title: "Game",
  iconUrl: null,
  logoImageUrl: null,
  libraryHeroImageUrl: null,
  remoteId: null,
  download: null,
  isDeleted: false,
  playTimeInMilliseconds: 0,
  lastTimePlayed: null,
  canonicalId: "canonical-game",
  catalogueGame: { shop: "steam", objectId: "123" },
  availableShops: ["steam", "epic"],
};

it("keeps the Epic sidebar fallback while navigating to its Steam catalogue", () => {
  const [game] = groupLibraryGames([epic]);
  const dom = new JSDOM(
    renderToStaticMarkup(
      React.createElement(exports.SidebarGameItem, {
        game,
        handleSidebarGameClick: () => {},
        getGameTitle: (item: LibraryGame) => item.title,
      })
    )
  );
  try {
    assert.ok(dom.window.document.querySelector('[data-store-logo="epic"]'));
    assert.equal(
      dom.window.document.querySelector('[data-store-logo="steam"]'),
      null
    );
    assert.ok(dom.window.document.querySelector(".sidebar__menu-item--active"));
  } finally {
    dom.window.close();
  }
});
