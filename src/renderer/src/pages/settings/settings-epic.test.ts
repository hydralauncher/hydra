import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import type { EpicConnectionState } from "@types";
import * as presentation from "./settings-epic-state.js";

const requireModule = createRequire(import.meta.url);

it("shows Epic disconnect progress immediately, blocks repeat actions and recovers after failure", async (t) => {
  const dom = new JSDOM("<div id='root'></div>");
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }
  const state: EpicConnectionState = {
    hydraLoggedIn: true,
    hydraUserId: "owner",
    availability: { available: true },
    verification: "confirmed",
    sessionState: "ready",
    operation: null,
    connection: {
      connected: true,
      connectionId: "HashId",
      epicAccountId: "a".repeat(32),
      displayName: "Epic",
      connectedAt: "2026-10-15T00:00:00Z",
    },
  };
  let finish!: (result: { ok: boolean; error?: "network" }) => void;
  let calls = 0;
  let connectionChanged: (value: EpicConnectionState) => void = () => {};
  const bridge = {
    getEpicConnection: async () => state,
    onEpicConnectionChanged: (listener: typeof connectionChanged) => {
      connectionChanged = listener;
      return () => {};
    },
    onSignIn: () => () => {},
    onSignOut: () => () => {},
    disconnectEpic: () => {
      calls++;
      return new Promise<{ ok: boolean; error?: "network" }>((resolve) => {
        finish = resolve;
      });
    },
  };
  Object.assign(dom.window, { electron: bridge });
  const translate = (key: string) => key;
  const noop = () => {};
  const icon = () => null;
  const stubs: Record<string, unknown> = {
    "@shared": { AuthPage: { SignIn: "signin" } },
    "react-i18next": { useTranslation: () => ({ t: translate }) },
    "@primer/octicons-react": {
      LinkExternalIcon: icon,
      PersonIcon: icon,
      SyncIcon: icon,
    },
    "@renderer/assets/epic-integration-logo.svg?react": icon,
    "@renderer/hooks": {
      useUserDetails: () => ({ userDetails: { id: "owner" } }),
      useToast: () => ({ showSuccessToast: noop, showErrorToast: noop }),
    },
    "./settings-epic-state": presentation,
    "./settings-integration-card": {
      SettingsIntegrationCard: ({
        children,
        actions,
        status,
      }: {
        children: React.ReactNode;
        actions: React.ReactNode;
        status: string;
      }) =>
        React.createElement(
          "section",
          null,
          React.createElement("span", { "data-status": true }, status),
          actions,
          children
        ),
      SettingsIntegrationLastSynced: icon,
    },
    "@renderer/components": {
      Button: ({
        theme: _theme,
        ...props
      }: React.ButtonHTMLAttributes<HTMLButtonElement> & { theme: string }) =>
        React.createElement("button", props),
      ConfirmationModal: ({
        visible,
        onConfirm,
      }: {
        visible: boolean;
        onConfirm: () => void;
      }) =>
        visible
          ? React.createElement("button", { onClick: onConfirm }, "confirm")
          : null,
    },
  };
  const filename = "src/renderer/src/pages/settings/settings-epic.tsx";
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const exports: Record<string, React.ElementType> = {};
  new Function("exports", "require", outputText)(
    exports,
    (name: string) => stubs[name] ?? requireModule(name)
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
  const button = (label: string) =>
    [...dom.window.document.querySelectorAll("button")].find(
      (item) => item.textContent === label
    );
  await React.act(async () =>
    root.render(React.createElement(exports.SettingsEpic))
  );
  await React.act(async () => button("integration_disconnect")!.click());
  await React.act(async () => button("confirm")!.click());
  assert.equal(calls, 1);
  assert.equal(button("integration_disconnect"), undefined);
  assert.ok(
    dom.window.document.querySelector(
      "output .settings-integration-card__progress-fill--indeterminate"
    )
  );
  assert.equal(
    dom.window.document.querySelector("[data-status]")?.textContent,
    "epic_status_disconnecting"
  );
  await React.act(async () => finish({ ok: false, error: "network" }));
  assert.equal(dom.window.document.querySelector("output"), null);
  assert.ok(button("integration_disconnect"));
  await React.act(async () =>
    connectionChanged({
      ...state,
      operation: { id: "remote-disconnect", status: "disconnecting" },
    })
  );
  assert.ok(dom.window.document.querySelector("output"));
  assert.equal(button("integration_disconnect"), undefined);
});
