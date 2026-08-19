import type { QbittorrentServer } from "@types";

const REQUEST_TIMEOUT_MS = 10_000;

export interface QbittorrentTorrentInfo {
  hash: string;
  name: string;
  progress: number;
  downloaded: number;
  size: number;
  dlspeed: number;
  upspeed: number;
  num_leechs: number;
  num_seeds: number;
  eta: number;
  state: string;
  save_path: string;
  content_path: string;
}

interface QbittorrentTorrentFile {
  index: number;
  name: string;
  size: number;
  priority: number;
  progress: number;
}

export interface AddQbittorrentTorrentOptions {
  magnetUri: string;
  infoHash: string;
  savePath?: string | null;
  fileIndices?: number[];
  trackers?: string[];
  canResume?: () => boolean;
}

export class QbittorrentClient {
  private cookie: string | null = null;
  private authenticated = false;
  private readonly baseUrl: string;
  private readonly origin: string;

  constructor(private readonly server: QbittorrentServer) {
    const url = new URL(server.url);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("qBittorrent URL must use HTTP or HTTPS");
    }

    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    this.baseUrl = url.toString().replace(/\/$/, "");
    this.origin = url.origin;
  }

  private endpoint(path: string) {
    return `${this.baseUrl}/api/v2/${path}`;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("qBittorrent server did not respond in time");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async login() {
    const body = new URLSearchParams({
      username: this.server.username,
      password: this.server.password,
    });
    const response = await this.fetchWithTimeout(this.endpoint("auth/login"), {
      method: "POST",
      body,
      headers: {
        Origin: this.origin,
        Referer: `${this.origin}/`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
    });
    const responseText = await response.text();

    if (!response.ok || responseText.trim().toLowerCase() !== "ok.") {
      throw new Error(
        response.status === 403
          ? "qBittorrent rejected the credentials or temporarily banned this client"
          : "qBittorrent authentication failed"
      );
    }

    const sessionCookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .find((value) => value.startsWith("SID="));

    this.cookie = sessionCookie ?? null;
    this.authenticated = true;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    retryAuthentication = true
  ): Promise<Response> {
    if (!this.authenticated) await this.login();

    const headers = new Headers(init.headers);
    headers.set("Origin", this.origin);
    headers.set("Referer", `${this.origin}/`);
    if (this.cookie) headers.set("Cookie", this.cookie);

    const response = await this.fetchWithTimeout(this.endpoint(path), {
      ...init,
      headers,
    });

    if (response.status === 403 && retryAuthentication) {
      this.cookie = null;
      this.authenticated = false;
      return this.request(path, init, false);
    }

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      throw new Error(
        `qBittorrent request failed (${response.status})${
          responseText ? `: ${responseText}` : ""
        }`
      );
    }

    return response;
  }

  private async post(path: string, values: Record<string, string>) {
    await this.request(path, {
      method: "POST",
      body: new URLSearchParams(values),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
    });
  }

  async getVersion() {
    const response = await this.request("app/version");
    return response.text();
  }

  async getTorrent(infoHash: string) {
    const response = await this.request(
      `torrents/info?hashes=${encodeURIComponent(infoHash)}`
    );
    const torrents = (await response.json()) as QbittorrentTorrentInfo[];
    return torrents[0] ?? null;
  }

  private async getTorrentFiles(infoHash: string) {
    const response = await this.request(
      `torrents/files?hash=${encodeURIComponent(infoHash)}`
    );
    return (await response.json()) as QbittorrentTorrentFile[];
  }

  private async waitForMetadata(infoHash: string) {
    const deadline = Date.now() + 60_000;

    while (Date.now() < deadline) {
      const files = await this.getTorrentFiles(infoHash).catch(() => []);
      if (files.length > 0) return files;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error("qBittorrent timed out while fetching torrent metadata");
  }

  async addTorrent(options: AddQbittorrentTorrentOptions) {
    const existing = await this.getTorrent(options.infoHash);
    if (existing) {
      if (options.canResume?.() !== false) {
        await this.resumeTorrent(options.infoHash);
      }
      return existing;
    }

    const hasFileSelection = Boolean(options.fileIndices?.length);
    const form = new FormData();
    form.set("urls", options.magnetUri);
    form.set("tags", "hydra");
    form.set("autoTMM", "false");
    if (options.savePath) form.set("savepath", options.savePath);
    if (hasFileSelection) {
      // qBittorrent 5 uses `stopped`; older releases accept `paused`.
      form.set("stopped", "true");
      form.set("paused", "true");
    }

    const response = await this.request("torrents/add", {
      method: "POST",
      body: form,
    });
    const responseText = await response.text();
    if (responseText.trim().toLowerCase() !== "ok.") {
      throw new Error(`qBittorrent could not add the torrent: ${responseText}`);
    }

    if (options.trackers?.length) {
      await this.post("torrents/addTrackers", {
        hash: options.infoHash,
        urls: options.trackers.join("\n"),
      });
    }

    if (hasFileSelection) {
      const files = await this.waitForMetadata(options.infoHash);
      const selectedIndices = new Set(options.fileIndices);
      const skipped = files
        .filter((file) => !selectedIndices.has(file.index))
        .map((file) => file.index);

      if (skipped.length) {
        await this.post("torrents/filePrio", {
          hash: options.infoHash,
          id: skipped.join("|"),
          priority: "0",
        });
      }

      await this.post("torrents/filePrio", {
        hash: options.infoHash,
        id: options.fileIndices!.join("|"),
        priority: "1",
      });
      if (options.canResume?.() !== false) {
        await this.resumeTorrent(options.infoHash);
      }
    }

    return this.getTorrent(options.infoHash);
  }

  private async postWithLegacyFallback(
    path: string,
    legacyPath: string,
    values: Record<string, string>
  ) {
    try {
      await this.post(path, values);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("(404)")) {
        throw error;
      }
      await this.post(legacyPath, values);
    }
  }

  async pauseTorrent(infoHash: string) {
    await this.postWithLegacyFallback("torrents/stop", "torrents/pause", {
      hashes: infoHash,
    });
  }

  async resumeTorrent(infoHash: string) {
    await this.postWithLegacyFallback("torrents/start", "torrents/resume", {
      hashes: infoHash,
    });
  }

  async deleteTorrent(infoHash: string, deleteFiles = false) {
    await this.post("torrents/delete", {
      hashes: infoHash,
      deleteFiles: String(deleteFiles),
    });
  }
}
