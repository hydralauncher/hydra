import electron, { type BrowserWindow, type Session } from "electron";
import { randomUUID } from "node:crypto";
import type { EpicOperationResult } from "../../../types/epic-integration.types";
import {
  EPIC_AUTH_CODE_MAX_LENGTH,
  getEpicLoginUrl,
  isEpicAuthorizationReturn,
  isHttpsNavigation,
  parseEpicAuthorizationResponse,
} from "./auth-protocol.js";

export interface EpicAuthWindow {
  close(): void;
  cleanup(): Promise<void>;
}

export interface EpicAuthWindowCallbacks {
  onCode(code: string): Promise<EpicOperationResult>;
  onCancel(): Promise<EpicOperationResult>;
  onError(
    error: "auth-failed" | "invalid-response"
  ): Promise<EpicOperationResult>;
}

type EpicWindowRuntime = Pick<typeof electron, "BrowserWindow" | "session">;
const ERR_ABORTED = -3;

export function openEpicAuthWindow(
  options: EpicAuthWindowCallbacks,
  runtime: EpicWindowRuntime = electron
): EpicAuthWindow {
  const { BrowserWindow, session } = runtime;
  const isolatedSession = session.fromPartition(`epic-auth-${randomUUID()}`);
  const windows = new Set<BrowserWindow>();
  let closing = false;
  let completed = false;
  let reading = false;
  let returnWindow: BrowserWindow | null = null;
  const active = () => !closing && !completed;
  const fail = (error: "auth-failed" | "invalid-response") => {
    if (!active()) return;
    completed = true;
    void options.onError(error).catch(() => undefined);
  };
  const hideReturn = (window: BrowserWindow, url: string) => {
    if (!active() || !isEpicAuthorizationReturn(url)) return;
    returnWindow = window;
    for (const authWindow of windows) {
      if (!authWindow.isDestroyed()) authWindow.hide();
    }
  };

  isolatedSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false)
  );
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.on("will-download", (event) => event.preventDefault());

  const webPreferences = {
    session: isolatedSession,
    sandbox: true,
    nodeIntegration: false,
    contextIsolation: true,
    webSecurity: true,
  };

  const secureWindow = (window: BrowserWindow, isRoot: boolean) => {
    windows.add(window);
    const contents = window.webContents;
    contents.on("will-navigate", (event, target) => {
      if (!isHttpsNavigation(target)) event.preventDefault();
      else hideReturn(window, target);
    });
    contents.on("will-redirect", (event, target, _inPlace, isMainFrame) => {
      if (!isHttpsNavigation(target)) event.preventDefault();
      else if (isMainFrame) hideReturn(window, target);
    });
    contents.on(
      "did-start-navigation",
      (_event, target, _inPlace, isMainFrame) => {
        if (isMainFrame) hideReturn(window, target);
      }
    );
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (!active() || !isHttpsNavigation(url)) return { action: "deny" };
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 720,
          height: 800,
          autoHideMenuBar: true,
          show: !isEpicAuthorizationReturn(url),
          webPreferences,
        },
      };
    });
    contents.on("did-create-window", (child, details) => {
      secureWindow(child, false);
      hideReturn(child, details.url);
    });
    contents.on(
      "did-fail-load",
      (_event, code, _description, _url, isMainFrame) => {
        if (isMainFrame && code !== ERR_ABORTED) fail("auth-failed");
      }
    );
    contents.on("render-process-gone", () => fail("auth-failed"));
    contents.on("did-finish-load", () => {
      if (!active() || reading) return;
      const expectedUrl = contents.getURL();
      if (!isEpicAuthorizationReturn(expectedUrl)) return;
      hideReturn(window, expectedUrl);
      reading = true;
      // Read only the validated main frame. Provider data never crosses renderer IPC.
      void contents
        .executeJavaScript(
          `document.body.innerText.slice(0, ${EPIC_AUTH_CODE_MAX_LENGTH + 1})`
        )
        .then((body: unknown) => {
          if (!active()) return;
          if (contents.isDestroyed() || contents.getURL() !== expectedUrl) {
            fail("auth-failed");
            return;
          }
          let code: string;
          try {
            code = parseEpicAuthorizationResponse(body);
          } catch {
            fail("invalid-response");
            return;
          }
          completed = true;
          return options.onCode(code);
        })
        .catch(() => fail("auth-failed"));
    });
    window.on("closed", () => {
      windows.delete(window);
      if (!active()) return;
      if (isRoot) {
        completed = true;
        void options.onCancel().catch(() => undefined);
      } else if (returnWindow === window) {
        fail("auth-failed");
      }
    });
    window.setMenu(null);
  };

  const root = new BrowserWindow({
    title: "Epic Games",
    width: 800,
    height: 860,
    autoHideMenuBar: true,
    webPreferences,
  });
  secureWindow(root, true);
  void root.loadURL(getEpicLoginUrl()).catch((error: unknown) => {
    const loadError = error as { errno?: number; code?: string } | null;
    if (loadError?.errno === ERR_ABORTED || loadError?.code === "ERR_ABORTED")
      return;
    fail("auth-failed");
  });

  return {
    close() {
      closing = true;
      for (const window of windows) {
        if (!window.isDestroyed()) window.close();
      }
      windows.clear();
    },
    async cleanup() {
      this.close();
      await clearEpicAuthSession(isolatedSession);
    },
  };
}

async function clearEpicAuthSession(epicSession: Session) {
  await epicSession.clearStorageData();
  await epicSession.clearAuthCache();
  await epicSession.clearCache();
}
