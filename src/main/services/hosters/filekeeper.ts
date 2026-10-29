import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "../logger";

const FILEKEEPER_ORIGIN = "https://filekeeper.net";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";
const MAX_REDIRECTS = 5;
const MAX_COUNTDOWN_SECONDS = 30;

interface FileKeeperResponse {
  response: Response;
  url: string;
  /** True when FileKeeper redirected to another host, which serves the file. */
  leftSite: boolean;
}

/**
 * FileKeeper runs XFileSharing: the file page shows a short countdown, then a
 * form post redirects to the file on its download host.
 */
export class FileKeeperApi {
  private static async request(
    url: string,
    cookies: Map<string, string>,
    init: RequestInit = {}
  ): Promise<FileKeeperResponse> {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      const response = await fetch(url, {
        ...init,
        redirect: "manual",
        headers: {
          ...init.headers,
          "User-Agent": USER_AGENT,
          Cookie: [...cookies]
            .map(([name, value]) => `${name}=${value}`)
            .join("; "),
        },
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";");
        const separator = pair.indexOf("=");
        if (separator > 0)
          cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }

      const location = response.headers.get("location");
      if (!location) return { response, url, leftSite: false };
      await response.body?.cancel();
      url = new URL(location, url).href;
      if (new URL(url).origin !== FILEKEEPER_ORIGIN)
        return { response, url, leftSite: true };
      // The site moves the file code into a cookie and redirects with a GET.
      init = {};
    }
    throw new Error("FileKeeper redirected too many times");
  }

  public static async getDownloadUrl(uri: string): Promise<string> {
    if (new URL(uri).origin !== FILEKEEPER_ORIGIN) {
      throw new Error("Invalid FileKeeper URL");
    }

    const cookies = new Map<string, string>();
    const page = await this.request(uri, cookies);
    if (page.response.status === 404) {
      throw new Error("File not found or deleted");
    }
    if (!page.response.ok || page.leftSite) {
      throw new Error(`FileKeeper returned HTTP ${page.response.status}`);
    }

    const html = await page.response.text();
    const read = (name: string) =>
      new RegExp(`data-${name}="([^"]*)"`).exec(html)?.[1];
    const code = read("code");
    if (!code) throw new Error("Could not find the FileKeeper download form");
    if (read("has-password") === "true") {
      throw new Error("FileKeeper file is password protected");
    }
    if (read("has-captcha") === "true") {
      throw new Error("FileKeeper requires a captcha for this file");
    }

    // Honor the page's countdown in case the server starts enforcing it.
    const countdown = Math.min(
      Number(read("countdown")) || 0,
      MAX_COUNTDOWN_SECONDS
    );
    await sleep(countdown * 1000);

    const result = await this.request(page.url, cookies, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: page.url,
      },
      body: new URLSearchParams({
        op: "download2",
        id: code,
        rand: read("rand") ?? "",
        referer: read("referer") ?? "",
        method_free: read("method") || "Free download",
        down_direct: "1",
      }),
    });
    if (!result.leftSite) {
      logger.error(
        `[FileKeeper] Download form returned HTTP ${result.response.status} without a file link`
      );
      throw new Error("FileKeeper did not return a download link");
    }

    logger.log(`[FileKeeper] Resolved download link for ${code}`);
    return result.url;
  }
}
