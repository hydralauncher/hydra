import { net, session } from "electron";
import { logger } from "../logger";

interface PendingResolution {
  resolve: (url: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class BzzhrApi {
  private static readonly BZZHR_BASE_URL = "https://bzzhr.to";
  private static readonly STEAMRIP_REFERER = "https://steamrip.com/";
  private static readonly USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  private static readonly RESOLUTION_TIMEOUT_MS = 30_000;
  private static readonly COPY_DOWNLOAD_LINK_TOKEN =
    /copyDownloadLink\('([^']+?download\?t=[^']+)'/;
  private static readonly DOWNLOAD_TOKEN =
    /(\/[A-Za-z0-9]+\/download\?t=[^\s'"]+)/;
  private static readonly pendingResolutions = new Map<
    string,
    PendingResolution[]
  >();
  private static redirectListenerRegistered = false;

  private static isTsDownloadUrl(uri: string): boolean {
    return /^https?:\/\/ts\.bzzhr\.(to|io)\/d\//.test(uri);
  }

  private static extractId(uri: string): string {
    try {
      const id = new URL(uri).pathname.split("/").find(Boolean);
      if (!id) throw new Error("Invalid Bzzhr URL");
      return id;
    } catch {
      throw new Error(`Invalid Bzzhr URL: ${uri}`);
    }
  }

  private static extractIdFromRequest(url: string): string | null {
    try {
      const pathParts = new URL(url).pathname.split("/").filter(Boolean);
      if (pathParts[0] === "d") return pathParts[1] ?? null;
      return pathParts[0] ?? null;
    } catch {
      return null;
    }
  }

  private static request(
    url: string,
    headers: Record<string, string>
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = net.request(url);
      for (const [name, value] of Object.entries(headers)) {
        req.setHeader(name, value);
      }

      let body = "";
      const timeout = setTimeout(() => {
        req.abort();
        reject(new Error("Bzzhr request timed out"));
      }, this.RESOLUTION_TIMEOUT_MS);

      req.on("response", (res) => {
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          clearTimeout(timeout);
          resolve(body);
        });
        res.on("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      req.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      req.end();
    });
  }

  private static async getTokenPath(id: string): Promise<string> {
    const html = await this.request(`${this.BZZHR_BASE_URL}/${id}`, {
      "User-Agent": this.USER_AGENT,
      Referer: this.STEAMRIP_REFERER,
    });

    const match =
      this.COPY_DOWNLOAD_LINK_TOKEN.exec(html) ||
      this.DOWNLOAD_TOKEN.exec(html);

    if (!match?.[1]) {
      throw new Error(
        "Could not obtain a download token from bzzhr (link may be expired)"
      );
    }

    return match[1].replaceAll("\\/", "/");
  }

  private static registerRedirectListener(): void {
    if (this.redirectListenerRegistered) return;
    this.redirectListenerRegistered = true;

    session.defaultSession.webRequest.onBeforeRedirect(
      {
        urls: [
          "https://bzzhr.to/*",
          "https://ts.bzzhr.to/*",
          "https://ts.bzzhr.io/*",
        ],
      },
      (details) => {
        if (!this.isTsDownloadUrl(details.redirectURL)) return;
        const id = this.extractIdFromRequest(details.url);
        if (!id) return;
        const pending = this.pendingResolutions.get(id);
        if (!pending) return;

        this.pendingResolutions.delete(id);
        for (const entry of pending) {
          clearTimeout(entry.timer);
          entry.resolve(details.redirectURL);
        }
      }
    );
  }

  private static upsertPending(id: string, entry: PendingResolution): void {
    const pending = this.pendingResolutions.get(id) ?? [];
    pending.push(entry);
    this.pendingResolutions.set(id, pending);
  }

  private static removePending(
    id: string,
    resolve: (url: string) => void
  ): void {
    const pending = this.pendingResolutions.get(id);
    if (!pending) return;
    const next = pending.filter((entry) => entry.resolve !== resolve);
    if (next.length > 0) {
      this.pendingResolutions.set(id, next);
    } else {
      this.pendingResolutions.delete(id);
    }
  }

  private static resolveDownloadUrl(
    id: string,
    tokenPath: string
  ): Promise<string> {
    this.registerRedirectListener();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.failPending(
            id,
            resolve,
            new Error(
              "Bzzhr download resolution timed out (link may be expired)"
            )
          ),
        this.RESOLUTION_TIMEOUT_MS
      );

      this.upsertPending(id, { resolve, reject, timer });

      const req = net.request(`${this.BZZHR_BASE_URL}${tokenPath}`);
      req.setHeader("User-Agent", this.USER_AGENT);
      req.setHeader("Referer", this.STEAMRIP_REFERER);
      req.on("response", (res) => {
        res.on("data", () => {});
        res.on("error", (error) => this.failPending(id, resolve, error));
      });
      req.on("error", (error) =>
        this.failPending(id, resolve, new Error(error.message))
      );
      req.end();
    });
  }

  private static failPending(
    id: string,
    resolve: (url: string) => void,
    error: Error
  ): void {
    const pending = this.pendingResolutions.get(id) ?? [];
    const entry = pending.find((entry) => entry.resolve === resolve);
    if (entry) clearTimeout(entry.timer);
    this.removePending(id, resolve);
    entry?.reject(error);
  }

  public static async getDownloadUrl(uri: string): Promise<string> {
    logger.log(`[Bzzhr] Resolving download URL for: ${uri}`);

    if (this.isTsDownloadUrl(uri)) {
      return uri;
    }

    const id = this.extractId(uri);
    const tokenPath = await this.getTokenPath(id);
    const directUrl = await this.resolveDownloadUrl(id, tokenPath);

    if (!directUrl) {
      throw new Error("Failed to resolve Bzzhr download URL");
    }

    return directUrl;
  }
}
