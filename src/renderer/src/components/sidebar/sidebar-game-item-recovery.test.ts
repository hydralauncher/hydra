import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import type { LibraryGame } from "@types";

const requireModule = createRequire(import.meta.url);
const noop = () => {};

async function setup(t: TestContext) {
  const dom = new JSDOM("<div id='root'></div>");
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  dom.window.setTimeout = ((callback: () => void, delay: number) => {
    assert.equal(delay, 60_000);
    timers.set(++nextTimer, callback);
    return nextTimer;
  }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = (id?: number) => {
    timers.delete(id ?? 0);
  };
  const fallback = () =>
    React.createElement("span", { "data-fallback": "true" });
  const stubs: Record<string, unknown> = {
    "@renderer/assets/steam-logo.svg?react": fallback,
    "@renderer/assets/epic-integration-logo.svg?react": fallback,
    "@shared": {
      getGameCatalogueIdentity: (game: LibraryGame) => game,
      getLibraryOperationalGame: (game: LibraryGame) => game,
    },
    "react-router-dom": { useLocation: () => ({ pathname: "" }) },
    "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
    "..": {
      ConfirmationModal: () => null,
      GameContextMenu: () => null,
      SteamLibraryBadge: () => null,
      useGameActions: () => ({ rpcs3ConfirmPending: null }),
    },
    "@primer/octicons-react": { HeartFillIcon: () => null },
    "@renderer/hooks": { useAppSelector: () => ({}), useToast: () => ({}) },
    "@renderer/context": { useCollectionContextMenu: () => ({}) },
    "@renderer/pages/library/library-category": {
      getLibraryPresentationBadgeSource: () => null,
    },
  };
  const filename = new URL("./sidebar-game-item.tsx", import.meta.url);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename.pathname,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", source)(exports, (name: string) =>
    Object.hasOwn(stubs, name) ? stubs[name] : requireModule(name)
  );
  const Component = exports.SidebarGameItem as React.ComponentType<{
    game: LibraryGame;
    handleSidebarGameClick: () => void;
    getGameTitle: (game: LibraryGame) => string;
  }>;
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => {
    await React.act(async () => root.unmount());
    assert.equal(timers.size, 0);
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const render = async (iconUrl: string) => {
    await React.act(async () =>
      root.render(
        React.createElement(Component, {
          game: {
            id: "epic:game",
            shop: "epic",
            objectId: "game",
            title: "Game",
            iconUrl,
          } as LibraryGame,
          handleSidebarGameClick: noop,
          getGameTitle: (game) => game.title,
        })
      )
    );
  };
  const fail = async () => {
    await React.act(async () =>
      dom.window.document
        .querySelector("img")!
        .dispatchEvent(new dom.window.Event("error"))
    );
    assert.equal(dom.window.document.querySelector("img"), null);
    assert.ok(dom.window.document.querySelector("[data-fallback]"));
  };
  return { document: dom.window.document, render, fail, timers };
}

it("retries a repaired icon at the same URL after a temporary failure", async (t) => {
  const ui = await setup(t);
  await ui.render("local:icon.png");
  await ui.fail();
  assert.equal(ui.timers.size, 1);
  await React.act(async () => {
    const [id, retry] = ui.timers.entries().next().value!;
    ui.timers.delete(id);
    retry();
  });
  assert.equal(
    ui.document.querySelector("img")?.getAttribute("src"),
    "local:icon.png"
  );
  await ui.fail();
});

it("clears the failed URL when choosing another icon and switching back", async (t) => {
  const ui = await setup(t);
  await ui.render("local:first.png");
  await ui.fail();
  await ui.render("local:second.png");
  assert.equal(ui.timers.size, 0);
  await ui.render("local:first.png");
  assert.equal(
    ui.document.querySelector("img")?.getAttribute("src"),
    "local:first.png"
  );
});
