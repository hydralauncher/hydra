import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import type { BrowserWindowConstructorOptions } from "electron";
import {
  openEpicAuthWindow,
  type EpicAuthWindowCallbacks,
} from "./auth-window.ts";
import { EPIC_OAUTH_CLIENT_ID, getEpicLoginUrl } from "./auth-protocol.ts";

const code = "testAuthorizationCode123456789";
const callbackUrl = `https://www.epicgames.com/id/api/redirect?clientId=${EPIC_OAUTH_CLIENT_ID}&responseType=code`;

class FakeContents extends EventEmitter {
  url = "";
  destroyed = false;
  reads = 0;
  response: () => Promise<unknown> = async () =>
    JSON.stringify({ authorizationCode: code });
  openHandler!: (details: { url: string }) => {
    action: "allow" | "deny";
    overrideBrowserWindowOptions?: BrowserWindowConstructorOptions;
  };
  getURL() {
    return this.url;
  }
  isDestroyed() {
    return this.destroyed;
  }
  setWindowOpenHandler(handler: FakeContents["openHandler"]) {
    this.openHandler = handler;
  }
  executeJavaScript(script: string) {
    assert.equal(script, "document.body.innerText.slice(0, 4097)");
    this.reads++;
    return this.response();
  }
}

function fixture(loadError?: { errno?: number; code?: string }) {
  const nativeWindows: FakeWindow[] = [];
  const partitions: string[] = [];
  const calls = {
    codes: [] as string[],
    errors: [] as string[],
    cancel: 0,
    cleanup: 0,
  };
  class FakeWindow extends EventEmitter {
    webContents = new FakeContents();
    destroyed = false;
    visible: boolean;
    constructor(readonly options: BrowserWindowConstructorOptions) {
      super();
      this.visible = options.show !== false;
      nativeWindows.push(this);
    }
    hide() {
      this.visible = false;
    }
    isDestroyed() {
      return this.destroyed;
    }
    setMenu(menu: null) {
      assert.equal(menu, null);
    }
    async loadURL(url: string) {
      this.webContents.url = url;
      if (loadError) throw loadError;
    }
    close() {
      this.destroyed = true;
      this.webContents.destroyed = true;
      this.emit("closed");
    }
  }
  const callbacks: EpicAuthWindowCallbacks = {
    onCode: async (value) => {
      calls.codes.push(value);
      return { ok: true };
    },
    onCancel: async () => {
      calls.cancel++;
      return { ok: true };
    },
    onError: async (error) => {
      calls.errors.push(error);
      return { ok: false, error };
    },
  };
  const runtime = {
    BrowserWindow: FakeWindow,
    session: {
      fromPartition: (partition: string) => {
        partitions.push(partition);
        return {
          setPermissionRequestHandler() {
            return undefined;
          },
          setPermissionCheckHandler() {
            return undefined;
          },
          on() {
            return undefined;
          },
          async clearStorageData() {
            calls.cleanup++;
          },
          async clearAuthCache() {
            calls.cleanup++;
          },
          async clearCache() {
            calls.cleanup++;
          },
        };
      },
    },
  } as unknown as NonNullable<Parameters<typeof openEpicAuthWindow>[1]>;
  const auth = openEpicAuthWindow(callbacks, runtime);
  const root = nativeWindows[0];
  const popup = (url: string) => {
    const result = root.webContents.openHandler({ url });
    assert.equal(result.action, "allow");
    const child = new FakeWindow(result.overrideBrowserWindowOptions!);
    child.webContents.url = url;
    root.webContents.emit("did-create-window", child, { url });
    return child;
  };
  const navigate = (window: FakeWindow, url = callbackUrl) => {
    window.webContents.emit("did-start-navigation", {}, url, false, true);
    window.webContents.url = url;
    window.webContents.emit("did-finish-load");
  };
  return { auth, root, popup, navigate, calls, partitions, nativeWindows };
}

test("isolates Epic login with sandbox and no preload or persistent browser partition", async () => {
  const f = fixture();
  assert.equal(f.root.webContents.url, getEpicLoginUrl());
  assert.match(f.partitions[0], /^epic-auth-/);
  const prefs = f.root.options.webPreferences!;
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.preload, undefined);
  assert.equal(
    f.root.webContents.openHandler({ url: "file:///tmp/secret" }).action,
    "deny"
  );
  await f.auth.cleanup();
  assert.equal(f.calls.cleanup, 3);
  assert.equal(f.calls.cancel, 0);
});

for (const surface of ["root", "popup"] as const) {
  test(`captures ${surface} return once while keeping technical response hidden`, async () => {
    const f = fixture();
    const window = surface === "popup" ? f.popup(callbackUrl) : f.root;
    f.navigate(window);
    assert.equal(window.visible, false);
    assert.equal(f.root.visible, false);
    window.webContents.emit("did-finish-load");
    await setImmediate();
    assert.deepEqual(f.calls.codes, [code]);
    assert.equal(window.webContents.reads, 1);
    assert.deepEqual(f.calls.errors, []);
    window.webContents.emit(
      "did-fail-load",
      {},
      -2,
      "secret",
      callbackUrl,
      true
    );
    assert.deepEqual(f.calls.errors, []);
    await f.auth.cleanup();
  });
}

test("hides expected main-frame redirects before provider response loads", async () => {
  const f = fixture();
  f.root.webContents.emit(
    "will-redirect",
    {
      preventDefault() {
        return undefined;
      },
    },
    callbackUrl,
    false,
    true
  );
  assert.equal(f.root.visible, false);
  assert.equal(f.root.webContents.reads, 0);
  await f.auth.cleanup();
});

test("ignores false returns, wrong clients and iframe redirects", async () => {
  const f = fixture();
  f.root.webContents.emit("will-redirect", {}, callbackUrl, false, false);
  assert.equal(f.root.visible, true);
  for (const url of [
    callbackUrl.replace("www.epicgames.com", "evil.test"),
    callbackUrl.replace(EPIC_OAUTH_CLIENT_ID, "wrong-client"),
  ]) {
    f.navigate(f.root, url);
  }
  await setImmediate();
  assert.deepEqual(f.calls.codes, []);
  assert.equal(f.root.webContents.reads, 0);
  await f.auth.cleanup();
});

test("reports invalid provider JSON without exposing credentials", async () => {
  const f = fixture();
  f.root.webContents.response = async () =>
    '{"authorizationCode":null,"secret":"do-not-log"}';
  f.navigate(f.root);
  await setImmediate();
  assert.deepEqual(f.calls.errors, ["invalid-response"]);
  assert.deepEqual(f.calls.codes, []);
  await f.auth.cleanup();
});

test("reports failed response reads and discards navigation races", async () => {
  for (const scenario of ["read-error", "changed-url"]) {
    const f = fixture();
    f.root.webContents.response = async () => {
      if (scenario === "read-error")
        throw new Error("authorizationCode=secret");
      f.root.webContents.url = "https://www.epicgames.com/id/login";
      return JSON.stringify({ authorizationCode: code });
    };
    f.navigate(f.root);
    await setImmediate();
    assert.deepEqual(f.calls.errors, ["auth-failed"]);
    assert.deepEqual(f.calls.codes, []);
    await f.auth.cleanup();
  }
});

test("ignores ordinary aborted navigation and subframe load failures", async () => {
  const f = fixture({ errno: -3 });
  f.root.webContents.emit(
    "did-fail-load",
    {},
    -3,
    "ERR_ABORTED",
    callbackUrl,
    true
  );
  f.root.webContents.emit(
    "did-fail-load",
    {},
    -2,
    "secret",
    callbackUrl,
    false
  );
  await setImmediate();
  assert.deepEqual(f.calls.errors, []);
  f.root.webContents.emit("did-fail-load", {}, -2, "secret", callbackUrl, true);
  assert.deepEqual(f.calls.errors, ["auth-failed"]);
  await f.auth.cleanup();
});

test("reports initial load failures once", async () => {
  const f = fixture({ errno: -2 });
  await setImmediate();
  assert.deepEqual(f.calls.errors, ["auth-failed"]);
  f.root.webContents.emit("did-fail-load", {}, -2, "secret", callbackUrl, true);
  assert.deepEqual(f.calls.errors, ["auth-failed"]);
  await f.auth.cleanup();
});

test("closing window during response capture cancels without late completion", async () => {
  const f = fixture();
  let resolve!: (body: unknown) => void;
  f.root.webContents.response = () =>
    new Promise((done) => {
      resolve = done;
    });
  f.navigate(f.root);
  f.root.close();
  resolve(JSON.stringify({ authorizationCode: code }));
  await setImmediate();
  assert.equal(f.calls.cancel, 1);
  assert.deepEqual(f.calls.codes, []);
  assert.deepEqual(f.calls.errors, []);
  await f.auth.cleanup();
});

test("cleanup while capturing closes all windows and ignores late native events", async () => {
  const f = fixture();
  const child = f.popup("https://accounts.google.com/");
  let resolve!: (body: unknown) => void;
  child.webContents.response = () =>
    new Promise((done) => {
      resolve = done;
    });
  f.navigate(child);
  await f.auth.cleanup();
  resolve(JSON.stringify({ authorizationCode: code }));
  f.root.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  await setImmediate();
  assert.ok(f.nativeWindows.every((window) => window.destroyed));
  assert.deepEqual(f.calls.codes, []);
  assert.deepEqual(f.calls.errors, []);
  assert.equal(f.calls.cancel, 0);
});
