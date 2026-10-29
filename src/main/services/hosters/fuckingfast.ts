import axios from "axios";
import { BrowserWindow } from "electron";
import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "@main/services";
import { isMultipartHosterDownloadsEnabled } from "../download/multipart-hoster-feature";

export const HOSTER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

export async function extractHosterFilename(
  url: string,
  directUrl?: string
): Promise<string> {
  if (url.includes("#")) {
    const fragment = url.split("#")[1];
    if (fragment && !fragment.startsWith("http")) {
      return fragment;
    }
  }

  if (directUrl) {
    try {
      const response = await axios.head(directUrl, {
        timeout: 10000,
        headers: { "User-Agent": HOSTER_USER_AGENT },
      });

      const contentDisposition = response.headers["content-disposition"];
      if (contentDisposition) {
        const filenameMatch = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
          contentDisposition
        );
        if (filenameMatch && filenameMatch[1]) {
          return filenameMatch[1].replace(/['"]/g, "");
        }
      }
    } catch {
      // Ignore errors
    }

    const urlPath = new URL(directUrl).pathname;
    const filename = urlPath.split("/").pop()?.split("?")[0];
    if (filename) {
      return filename;
    }
  }

  return "downloaded_file";
}

export function handleHosterError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 404) {
      throw new Error("File not found");
    }
    if (error.response?.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    if (error.response?.status === 403) {
      throw new Error("Access denied. File may be private or deleted.");
    }
    throw new Error(`Network error: ${error.response?.status || "Unknown"}`);
  }
  throw error;
}

// ============================================
// FuckingFast API Class
// ============================================
const FUCKINGFAST_PARTITION = "persist:hydra-fuckingfast";
const PAGE_TIMEOUT_MS = 45_000;
const PAGE_POLL_INTERVAL_MS = 500;
const WINDOW_IDLE_CLOSE_MS = 60_000;

type PageState = "ready" | "pending" | "not-found" | "rate-limited";

/** Settles with `fallback` once `deadline` passes, without leaving a timer behind. */
const withDeadline = async <T>(
  promise: Promise<T>,
  deadline: number,
  fallback: T
): Promise<T> => {
  const timer = new AbortController();
  try {
    return await Promise.race([
      promise,
      sleep(Math.max(0, deadline - Date.now()), fallback, {
        signal: timer.signal,
      }),
    ]);
  } finally {
    timer.abort();
  }
};

// Matching the button's file ID keeps a slow navigation from reading the previous page.
const readPageState = (goPath: string) => `(() => {
  if (document.querySelector('[hx-post="' + ${JSON.stringify(goPath)} + '"]')) return "ready";
  const text = document.body ? document.body.innerText : "";
  if (text.includes("File Not Found Or Deleted")) return "not-found";
  if (/rate limit/i.test(text)) return "rate-limited";
  return "pending";
})()`;

// The download button posts here; the response names the file link in HX-Redirect.
const requestDownloadLink = (goPath: string) => `(async () => {
  const response = await fetch(${JSON.stringify(goPath)}, {
    method: "POST",
    headers: { "HX-Request": "true", "HX-Current-URL": location.href },
  });
  return { status: response.status, redirect: response.headers.get("HX-Redirect") };
})()`;

/**
 * FuckingFast pages sit behind a Cloudflare check that only a browser passes.
 * A hidden window resolves each link; the file itself downloads without it.
 */
export class FuckingFastApi {
  private static readonly FUCKINGFAST_DOMAINS = [
    "fuckingfast.co",
    "fuckingfast.net",
  ];

  private static window: BrowserWindow | null = null;
  private static idleCloseTimer: NodeJS.Timeout | null = null;
  private static pending: Promise<unknown> = Promise.resolve();

  private static isSupportedHost(url: string): boolean {
    try {
      const { protocol, hostname } = new URL(url);
      return (
        protocol === "https:" &&
        this.FUCKINGFAST_DOMAINS.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
        )
      );
    } catch {
      return false;
    }
  }

  private static getWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: FUCKINGFAST_PARTITION,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    window.webContents.setAudioMuted(true);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window = window;
    return window;
  }

  private static closeWindow() {
    if (this.idleCloseTimer) clearTimeout(this.idleCloseTimer);
    this.idleCloseTimer = null;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  private static getGoPath(url: string): string {
    const fileId = new URL(url).pathname.split("/").find(Boolean);
    if (!fileId) throw new Error("Invalid FuckingFast URL");
    return `/f/${encodeURIComponent(fileId)}/go`;
  }

  private static async waitForPage(
    window: BrowserWindow,
    goPath: string,
    deadline: number
  ): Promise<PageState> {
    while (Date.now() < deadline) {
      const state = await withDeadline<PageState>(
        window.webContents.executeJavaScript(readPageState(goPath)),
        deadline,
        "pending"
      ).catch((): PageState => "pending");
      if (state !== "pending") return state;
      await sleep(PAGE_POLL_INTERVAL_MS);
    }
    return "pending";
  }

  private static async resolveDirectLink(url: string): Promise<string> {
    const goPath = this.getGoPath(url);
    if (this.idleCloseTimer) clearTimeout(this.idleCloseTimer);
    const window = this.getWindow();
    const deadline = Date.now() + PAGE_TIMEOUT_MS;
    let failed = true;

    try {
      logger.log(`[FuckingFast] Starting download link extraction for: ${url}`);
      await withDeadline(
        window.loadURL(url.split("#")[0]).catch(() => undefined),
        deadline,
        undefined
      );

      const state = await this.waitForPage(window, goPath, deadline);
      if (state === "not-found") throw new Error("File not found or deleted");
      if (state === "rate-limited") {
        throw new Error(
          "Rate limit exceeded. Please wait a few minutes and try again."
        );
      }
      if (state === "pending") {
        throw new Error("The FuckingFast page did not finish loading.");
      }

      const response = await withDeadline<{
        status: number;
        redirect: string | null;
      } | null>(
        window.webContents.executeJavaScript(requestDownloadLink(goPath)),
        deadline,
        null
      );
      if (!response) {
        throw new Error("FuckingFast did not return a download link in time.");
      }
      const { status, redirect } = response;
      if (status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a few minutes and try again."
        );
      }
      if (!redirect || !this.isSupportedHost(redirect)) {
        throw new Error(
          `Could not extract download link from page (HTTP ${status})`
        );
      }

      failed = false;
      logger.log(`[FuckingFast] Successfully extracted direct link`);
      return redirect;
    } catch (error) {
      logger.error(`[FuckingFast] Error:`, error);
      throw error;
    } finally {
      // A failed page may hold a stale challenge; start fresh next time.
      if (failed) {
        this.closeWindow();
      } else {
        this.idleCloseTimer = setTimeout(
          () => this.closeWindow(),
          WINDOW_IDLE_CLOSE_MS
        );
      }
    }
  }

  private static readonly LEGACY_DOMAIN = "fuckingfast.co";

  private static readonly LEGACY_DIRECT_LINK_REGEX =
    /window\.open\("(https:\/\/fuckingfast\.co\/dl\/[^"]*)"\)/;

  /** Reads the link from the page HTML, as Hydra did before multi-part hoster downloads. */
  private static async getLegacyDirectLink(url: string): Promise<string> {
    if (!url.toLowerCase().includes(this.LEGACY_DOMAIN)) {
      throw new Error(
        `Unsupported domain. Supported domains: ${this.LEGACY_DOMAIN}`
      );
    }
    try {
      logger.log(`[FuckingFast] Starting download link extraction for: ${url}`);
      const response = await axios.get(url, {
        headers: { "User-Agent": HOSTER_USER_AGENT },
        timeout: 30000,
      });

      const html = response.data;

      if (html.toLowerCase().includes("rate limit")) {
        logger.error(`[FuckingFast] Rate limit detected`);
        throw new Error(
          "Rate limit exceeded. Please wait a few minutes and try again."
        );
      }

      if (html.includes("File Not Found Or Deleted")) {
        logger.error(`[FuckingFast] File not found or deleted`);
        throw new Error("File not found or deleted");
      }

      const match = this.LEGACY_DIRECT_LINK_REGEX.exec(html);
      if (!match || !match[1]) {
        logger.error(`[FuckingFast] Could not extract download link`);
        throw new Error("Could not extract download link from page");
      }

      logger.log(`[FuckingFast] Successfully extracted direct link`);
      return match[1];
    } catch (error) {
      logger.error(`[FuckingFast] Error:`, error);
      handleHosterError(error);
    }
  }

  public static async getDirectLink(url: string): Promise<string> {
    if (!(await isMultipartHosterDownloadsEnabled())) {
      return this.getLegacyDirectLink(url);
    }
    if (!this.isSupportedHost(url)) {
      throw new Error(
        `Unsupported domain. Supported domains: ${this.FUCKINGFAST_DOMAINS.join(", ")}`
      );
    }
    // One hidden window serves every link, so requests run one at a time.
    const result = this.pending.then(() => this.resolveDirectLink(url));
    this.pending = result.catch(() => undefined);
    return result;
  }

  public static async getFilename(
    url: string,
    directUrl?: string
  ): Promise<string> {
    return extractHosterFilename(url, directUrl);
  }
}
