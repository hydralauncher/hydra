import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import ts from "typescript";
import type { UserPreferences } from "@types";
import {
  DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  MAX_CONFIGURABLE_CONCURRENT_DOWNLOADS,
  MIN_CONFIGURABLE_CONCURRENT_DOWNLOADS,
} from "../../../../shared/constants.js";

const require = createRequire(import.meta.url);

test("concurrency slider commits once on release, keyboard completion, or blur", async (t) => {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    electron: { getNetworkInterfaces: async () => [] },
  };
  Object.defineProperty(dom.window, "electron", {
    value: { platform: "linux" },
  });
  const previous = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const writes: Partial<UserPreferences>[] = [];
  const settingsContext = React.createContext({
    updateUserPreferences: (value: Partial<UserPreferences>) => {
      writes.push(value);
    },
  });
  const preferences = { maxConcurrentDownloads: 4 };
  const stubs: Record<string, unknown> = {
    "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
    "@renderer/components": {
      CheckboxField: () => null,
      SelectField: () => null,
      TextField: () => null,
    },
    "@renderer/context": { settingsContext },
    "@renderer/hooks": { useAppSelector: () => preferences },
    "@shared": {
      DEFAULT_MAX_CONCURRENT_DOWNLOADS,
      MAX_CONFIGURABLE_CONCURRENT_DOWNLOADS,
      MIN_CONFIGURABLE_CONCURRENT_DOWNLOADS,
    },
    "./settings-global-trackers": { SettingsGlobalTrackers: () => null },
    "./settings-general.scss": {},
  };
  const { outputText } = ts.transpileModule(
    fs.readFileSync(
      new URL("./settings-context-downloads.tsx", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }
  );
  const exports: Record<string, React.ComponentType> = {};
  new Function("exports", "require", outputText)(exports, (name: string) =>
    Object.hasOwn(stubs, name) ? stubs[name] : require(name)
  );
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  await React.act(async () =>
    root.render(React.createElement(exports.SettingsContextDownloads))
  );
  const slider = dom.window.document.querySelector(
    "input[type=range]"
  ) as HTMLInputElement;
  const change = async (value: number) => {
    await React.act(async () => {
      slider.value = String(value);
      Simulate.change(slider);
    });
  };
  await change(3);
  await change(1);
  await change(3);
  assert.equal(writes.length, 0);
  await React.act(async () => Simulate.pointerUp(slider));
  await React.act(async () => Simulate.blur(slider));
  assert.deepEqual(writes, [{ maxConcurrentDownloads: 3 }]);
  await change(2);
  await React.act(async () => Simulate.keyUp(slider));
  assert.deepEqual(writes.at(-1), { maxConcurrentDownloads: 2 });
  await change(1);
  await React.act(async () => Simulate.blur(slider));
  assert.deepEqual(writes.at(-1), { maxConcurrentDownloads: 1 });
  assert.equal(writes.length, 3);
});
