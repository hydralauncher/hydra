import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import type { UserPreferences } from "@types";

const requireModule = createRequire(import.meta.url);

test("download settings preserve a speed draft, save concurrency, and convert units without changing the cap", async () => {
  const dom = new JSDOM("<div id='root'></div>");
  const keys = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = keys.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key)
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let preferences: UserPreferences = {
    maxConcurrentDownloads: 2,
    maxDownloadSpeedBytesPerSecond: null,
  };
  const writes: Array<Partial<UserPreferences>> = [];
  Object.assign(dom.window, {
    electron: {
      platform: "linux",
      updateUserPreferences: async (values: Partial<UserPreferences>) => {
        writes.push(values);
      },
    },
  });
  type InputProps = {
    value: string;
    onChange: (event: { target: { value: string } }) => void;
    onBlur: () => void;
  };
  type SelectProps = { value: string; onValueChange: (value: string) => void };
  type CheckboxProps = { id: string; onChange: (value: boolean) => void };
  let input!: InputProps;
  let select!: SelectProps;
  const checkboxes = new Map<string, CheckboxProps>();
  const children = ({ children }: { children: React.ReactNode }) => children;
  const stubs: Record<string, unknown> = {
    "./downloads-behavior-section.scss": {},
    "./settings-navigation": {
      DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS: Object.fromEntries(
        [
          "maxConcurrentDownloads",
          "maxDownloadSpeed",
          "seedAfterDownloadComplete",
          "showDownloadSpeedInMegabytes",
          "extractFilesByDefault",
          "deleteArchiveFilesAfterExtractionByDefault",
          "createStartMenuShortcut",
        ].map((key) => [key, key])
      ),
      DOWNLOADS_BEHAVIOR_SECTION_REGION_ID: "downloads-behavior",
      SETTINGS_HEADER_RETURN_TARGET: { type: "region", regionId: "header" },
    },
    "./settings-section": { SettingsSection: children },
    "../../hooks": { useUserPreferences: () => preferences },
    "../../components": {
      VerticalFocusGroup: children,
      Input: (props: InputProps) => {
        input = props;
        return null;
      },
      DropdownSelect: (props: SelectProps) => {
        select = props;
        return null;
      },
      Checkbox: (props: CheckboxProps) => {
        checkboxes.set(props.id, props);
        return null;
      },
    },
  };
  const exports: Record<string, unknown> = {};
  const source = fs.readFileSync(
    new URL("./downloads-behavior-section.tsx", import.meta.url),
    "utf8"
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  new Function("exports", "require", outputText)(
    exports,
    (name: string) => stubs[name] ?? requireModule(name)
  );
  const Section = exports.DownloadsBehaviorSection as React.ComponentType;
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await React.act(async () => root.render(React.createElement(Section)));
    await React.act(async () => select.onValueChange("3"));
    assert.equal(select.value, "3");
    assert.deepEqual(writes.shift(), { maxConcurrentDownloads: 3 });
    await React.act(async () => input.onChange({ target: { value: "8" } }));
    preferences = {
      ...preferences,
      maxConcurrentDownloads: 3,
      seedAfterDownloadComplete: true,
    };
    await React.act(async () => root.render(React.createElement(Section)));
    assert.equal(
      input.value,
      "8",
      "unrelated preference updates preserve an unfinished speed edit"
    );
    await React.act(async () => input.onBlur());
    assert.deepEqual(writes.shift(), {
      maxDownloadSpeedBytesPerSecond: 1000000,
    });
    // A click on the units checkbox can follow blur before the IPC echo arrives.
    await React.act(async () =>
      checkboxes.get("show-download-speed-in-megabytes")!.onChange(true)
    );
    assert.deepEqual(writes.shift(), {
      showDownloadSpeedInMegabytes: true,
      maxDownloadSpeedBytesPerSecond: 1000000,
    });
    assert.equal(input.value, "0.953674");
    await React.act(async () =>
      checkboxes.get("show-download-speed-in-megabytes")!.onChange(false)
    );
    assert.deepEqual(writes.shift(), {
      showDownloadSpeedInMegabytes: false,
      maxDownloadSpeedBytesPerSecond: 1000000,
    });
    assert.equal(input.value, "8");
    await React.act(async () => input.onChange({ target: { value: "" } }));
    await React.act(async () => input.onBlur());
    assert.deepEqual(writes.shift(), { maxDownloadSpeedBytesPerSecond: null });
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    keys.forEach((key, index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
