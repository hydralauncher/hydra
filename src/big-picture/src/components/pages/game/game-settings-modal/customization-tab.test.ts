import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import type {
  GameArtworkOptions,
  GameArtworkSelection,
  LibraryGame,
  ShopAssets,
} from "@types";
import { composeAssetsWithArtwork } from "../../../../../../shared/artwork-resolver.js";
import { getGameCatalogueIdentity } from "../../../../../../shared/library-catalogue.js";

const requireModule = createRequire(import.meta.url);
const directory =
  "src/big-picture/src/components/pages/game/game-settings-modal";

function loadModule(filename: string, stubs: Record<string, unknown>) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", outputText)(
    exports,
    (name: string) => stubs[name] ?? requireModule(name)
  );
  return exports;
}

const imageHelpers = loadModule("src/big-picture/src/helpers/image.ts", {});
const preferredAssetsHelpers = loadModule(
  "src/big-picture/src/helpers/preferred-assets.ts",
  { "./image": imageHelpers }
);
const epic = {
  id: "epic:namespace:executable",
  shop: "epic",
  objectId: "namespace:executable",
  title: "Game",
  catalogueGame: { shop: "steam", objectId: "123" },
} as LibraryGame;
const catalogueAssets: ShopAssets = {
  objectId: "123",
  shop: "steam",
  title: "Steam title",
  iconUrl: "https://steam.test/icon.png",
  logoImageUrl: null,
  libraryHeroImageUrl: null,
  libraryImageUrl: null,
  coverImageUrl: null,
  logoPosition: null,
  downloadSources: [],
};
const selectionFor = (
  game: LibraryGame,
  url: string
): GameArtworkSelection => ({
  shop: game.shop,
  objectId: game.objectId,
  selected: { icon: { url, artworkId: 1 } },
  updatedAt: 1,
});

async function fixture(
  t: TestContext,
  initialGame: LibraryGame,
  initialSelections: GameArtworkSelection[],
  deferAssetsFor?: string
) {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
    HTMLVideoElement: dom.window.HTMLVideoElement,
    HTMLMediaElement: dom.window.HTMLMediaElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  const calls: [string, ...unknown[]][] = [];
  const selections = new Map(
    initialSelections.map((selection) => [
      selection.shop + ":" + selection.objectId,
      selection,
    ])
  );
  let game = initialGame;
  let deferredOnce = false;
  let resolveDeferred: (() => void) | null = null;
  const bridge = {
    getGameAssets: async (
      objectId: string,
      shop: string,
      options?: GameArtworkOptions
    ) => {
      calls.push(["assets", shop, objectId, options]);
      const identity = options?.artworkIdentity ?? { shop, objectId };
      const key = identity.shop + ":" + identity.objectId;
      const result = composeAssetsWithArtwork(
        catalogueAssets,
        selections.get(key)
      );
      if (!deferredOnce && key === deferAssetsFor) {
        deferredOnce = true;
        return new Promise<ShopAssets>((resolve) => {
          resolveDeferred = () => resolve(result);
        });
      }
      return result;
    },
    getGameArtworkSelection: async (shop: string, objectId: string) => {
      calls.push(["selection", shop, objectId]);
      return selections.get(shop + ":" + objectId) ?? null;
    },
  };
  Object.assign(dom.window, { electron: bridge });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  let pickerProps: { game: LibraryGame; onChanged: () => Promise<void> };
  const exports = loadModule(directory + "/customization-tab.tsx", {
    "@shared": { getGameCatalogueIdentity },
    "@renderer/hooks": { isVideoArtworkUrl: () => false },
    "@primer/octicons-react": { PencilIcon: () => null },
    "lucide-react": { Loader2: () => null, Trash: () => null },
    "react-i18next": {
      useTranslation: () => ({ t: (key: string) => key }),
    },
    "../../../common": {
      BumperBadge: () => null,
      FileExplorerModal: () => null,
      FocusItem: wrapper,
      Input: () => null,
      Tabs: () => null,
      VerticalFocusGroup: wrapper,
    },
    "../../../../helpers": { ...imageHelpers, ...preferredAssetsHelpers },
    "../../../../services": { NavigationService: {} },
    "../../../../pages/settings/settings-section": { SettingsSection: wrapper },
    "./artwork-picker": {
      GameArtworkPicker: (props: typeof pickerProps) => {
        pickerProps = props;
        return null;
      },
    },
    "./customization-tab.scss": {},
  });
  const Tab = exports.GameCustomizationSettingsTab as React.ElementType;
  const props = {
    gameTitle: "Game",
    updatingGameTitle: false,
    assetPickerFilters: [],
    onChangeGameTitle: () => {},
    onBlurGameTitle: async () => {},
    onProcessAssetPath: async () => null,
    onClearAsset: async (type: string, clearSelection: boolean) => {
      calls.push(["clear", type, clearSelection]);
      selections.delete(game.shop + ":" + game.objectId);
      return true;
    },
    onArtworkChanged: () => {
      calls.push(["refresh-page"]);
    },
  };
  function Component() {
    return React.createElement(Tab, { ...props, game });
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  await React.act(async () => root.render(React.createElement(Component)));
  return {
    calls,
    get imageSource() {
      return dom.window.document
        .querySelector(
          ".game-customization-settings-tab__asset-preview-frame img"
        )
        ?.getAttribute("src");
    },
    get pickerGame() {
      return pickerProps.game;
    },
    async selectArtwork(url: string) {
      selections.set(game.shop + ":" + game.objectId, selectionFor(game, url));
      await React.act(async () => pickerProps.onChanged());
    },
    async clearArtwork() {
      const button = dom.window.document.querySelector(
        ".game-customization-settings-tab__asset-preview-frame"
      );
      assert.ok(button);
      await React.act(async () => {
        button.dispatchEvent(
          new dom.window.MouseEvent("click", { bubbles: true })
        );
      });
    },
    async changeGame(nextGame: LibraryGame) {
      game = nextGame;
      await React.act(async () => root.render(React.createElement(Component)));
    },
    async resolveDeferred() {
      assert.ok(resolveDeferred);
      await React.act(async () => resolveDeferred!());
    },
  };
}

describe("Big Picture customization artwork", () => {
  it("uses canonical defaults with the owned selection when selecting and clearing artwork", async (t) => {
    const initial = selectionFor(epic, "https://artwork.test/epic-icon.png");
    const state = await fixture(t, epic, [initial]);
    assert.equal(state.imageSource, initial.selected.icon!.url);
    assert.equal(state.pickerGame, epic);
    assert.deepEqual(state.calls[0], [
      "assets",
      "steam",
      "123",
      { artworkIdentity: { shop: "epic", objectId: epic.objectId } },
    ]);
    assert.deepEqual(state.calls[1], ["selection", "epic", epic.objectId]);

    await state.clearArtwork();
    assert.equal(state.imageSource, catalogueAssets.iconUrl);
    assert.ok(
      state.calls.some(
        ([action, type, clear]) =>
          action === "clear" && type === "icon" && clear === true
      )
    );

    await state.selectArtwork("https://artwork.test/new-icon.png");
    assert.equal(state.imageSource, "https://artwork.test/new-icon.png");
    assert.ok(state.calls.some(([action]) => action === "refresh-page"));
  });

  it("ignores the previous owned copy's pending preview after changing games", async (t) => {
    const next = {
      ...epic,
      id: "epic:other:executable",
      objectId: "other:executable",
    };
    const oldSelection = selectionFor(
      epic,
      "https://artwork.test/old-icon.png"
    );
    const newSelection = selectionFor(
      next,
      "https://artwork.test/new-icon.png"
    );
    const state = await fixture(t, epic, [oldSelection, newSelection], epic.id);
    await state.changeGame(next);
    assert.equal(state.imageSource, newSelection.selected.icon!.url);
    await state.resolveDeferred();
    assert.equal(state.imageSource, newSelection.selected.icon!.url);
    assert.equal(state.pickerGame, next);
  });
});
