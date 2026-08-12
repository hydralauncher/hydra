import { net, session } from "electron";
import { logger } from "../logger";

export class BzzhrApi {
  private static readonly BZZHR_BASE_URL = "https://bzzhr.to";
  private static readonly STEAMRIP_REFERER = "https://steamrip.com/";
  private static readonly USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  private static readonly RESOLUTION_TIMEOUT_MS = 30_000;

  private static isTsDownloadUrl(uri: string): boolean {
    return /^https?:\/\/ts\.bzzhr\.(to|io)\/d\//.test(uri);
  }

  private static extractId(uri: string): string {
    try {
      const pathParts = new URL(uri).pathname.split("/").filter(Boolean);
      const id = pathParts[0];
      if (!id) throw new Error();
      return id;
    } catch {
      throw new Error(`Invalid Bzzhr URL: ${uri}`);
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
      html.match(/copyDownloadLink\('([^']+?download\?t=[^']+)'/) ||
      html.match(/(\/[A-Za-z0-9]+\/download\?t=[^\s'"]+)/);

    if (!match?.[1]) {
      throw new Error(
        "Could not obtain a download token from bzzhr (link may be expired)"
      );
    }

    return match[1].replace(/\\\//g, "/");
  }

  private static resolveDownloadUrl(tokenPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const defaultSession = session.defaultSession;
      const filter = {
        urls: [
          "https://bzzhr.to/*",
          "https://ts.bzzhr.to/*",
          "https://ts.bzzhr.io/*",
        ],
      };

      let req: Electron.ClientRequest | null = null;
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        defaultSession.webRequest.onBeforeRedirect(null);
        req?.abort();
      };

      const resolveOnce = (value: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const timeout = setTimeout(
        () =>
          rejectOnce(
            new Error(
              "Bzzhr download resolution timed out (link may be expired)"
            )
          ),
        this.RESOLUTION_TIMEOUT_MS
      );

      defaultSession.webRequest.onBeforeRedirect(filter, (details) => {
        if (details.redirectURL) resolveOnce(details.redirectURL);
      });

      req = net.request(`${this.BZZHR_BASE_URL}${tokenPath}`);
      req.setHeader("User-Agent", this.USER_AGENT);
      req.setHeader("Referer", this.STEAMRIP_REFERER);
      req.on("response", (res) => {
        res.on("data", () => {});
        res.on("error", (error) => rejectOnce(error));
      });
      req.on("error", (error) => rejectOnce(error));
      req.end();
    });
  }

  public static async getDownloadUrl(uri: string): Promise<string> {
    logger.log(`[Bzzhr] Resolving download URL for: ${uri}`);

    if (this.isTsDownloadUrl(uri)) {
      return uri;
    }

    const id = this.extractId(uri);
    const tokenPath = await this.getTokenPath(id);
    const directUrl = await this.resolveDownloadUrl(tokenPath);

    if (!directUrl) {
      throw new Error("Failed to resolve Bzzhr download URL");
    }

    return directUrl;
  }
}
