import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const requireModule = createRequire(import.meta.url);

it("renders play and stop states from the running prop and the library", () => {
  let runningGameId: string | null = null;
  let canPlay = true;

  const stubs: Record<string, unknown> = {
    "@shared": {
      getLibraryOperationalGame: (game: unknown) => game,
    },
    "@renderer/hooks": {
      useAppSelector: () => runningGameId,
      useGameLaunchActions: () => ({
        canPlay,
        rpcs3ConfirmPending: null,
        handlePlayGame: async () => {},
        handleCloseGame: async () => {},
        handleConfirmRpcs3Launch: async () => {},
        handleCancelRpcs3Launch: () => {},
      }),
    },
    "../confirmation-modal/confirmation-modal": {
      ConfirmationModal: () => null,
    },
    "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
  };

  const filename = new URL("./quick-launch-button.tsx", import.meta.url);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename.pathname,
  }).outputText;
  const exported: Record<string, React.ElementType> = {};
  new Function("exports", "require", output)(exported, (name: string) =>
    name.endsWith(".scss") ? {} : (stubs[name] ?? requireModule(name))
  );

  const game = {
    id: "game",
    objectId: "game",
    shop: "steam",
    title: "Game",
    executablePath: "C:\\game.exe",
  } as never;
  const render = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      React.createElement(exported.QuickLaunchButton, { game, ...props })
    );

  runningGameId = null;
  canPlay = true;
  const playable = render();
  assert.match(playable, /aria-label="play"/);
  assert.match(playable, /quick-launch-button--playable/);
  assert.match(playable, /quick-launch-button__label/);

  runningGameId = "game";
  const runningFromLibrary = render();
  assert.match(runningFromLibrary, /aria-label="stop"/);
  assert.match(runningFromLibrary, /quick-launch-button--running/);

  runningGameId = null;
  const runningFromSidebar = render({ variant: "sidebar", running: true });
  assert.match(runningFromSidebar, /aria-label="stop"/);
  assert.doesNotMatch(runningFromSidebar, /quick-launch-button__label/);

  canPlay = false;
  assert.equal(render(), "");
});
