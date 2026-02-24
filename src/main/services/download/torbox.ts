import axios, { AxiosInstance } from "axios";
import parseTorrent from "parse-torrent";
import type {
  TorBoxUserRequest,
  TorBoxTorrentInfoRequest,
  TorBoxAddTorrentRequest,
  TorBoxRequestLinkRequest,
} from "@types";
import { appVersion } from "@main/constants";

export class TorBoxClient {
  private static instance: AxiosInstance;
  private static readonly baseURL = "https://api.torbox.app/v1/api";
  private static apiToken: string;

  static authorize(apiToken: string) {
    this.apiToken = apiToken;
    this.instance = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "User-Agent": `Hydra/${appVersion}`,
      },
    });
  }

  private static async addMagnet(magnet: string) {
    const form = new FormData();
    form.append("magnet", magnet);

    const response = await this.instance.post<TorBoxAddTorrentRequest>(
      "/torrents/createtorrent",
      form
    );

    if (!response.data.success) {
      throw new Error(response.data.detail);
    }

    return response.data.data;
  }

  static async getTorrentInfo(id: number) {
    const response =
      await this.instance.get<TorBoxTorrentInfoRequest>("/torrents/mylist");
    const data = response.data.data;

    const info = data.find((item) => item.id === id);

    if (!info) {
      return null;
    }

    return info;
  }

  static async getUser() {
    const response = await this.instance.get<TorBoxUserRequest>(`/user/me`);
    return response.data.data;
  }

  static async requestLink(id: number) {
    const searchParams = new URLSearchParams({
      token: this.apiToken,
      torrent_id: id.toString(),
      zip_link: "true",
    });

    const response = await this.instance.get<TorBoxRequestLinkRequest>(
      "/torrents/requestdl?" + searchParams.toString()
    );

    return response.data.data;
  }

  private static async getAllTorrentsFromUser() {
    const response =
      await this.instance.get<TorBoxTorrentInfoRequest>("/torrents/mylist");

    return response.data.data;
  }

  private static async getTorrentIdAndName(magnetUri: string) {
    const userTorrents = await this.getAllTorrentsFromUser();

    const { infoHash } = await parseTorrent(magnetUri);
    const userTorrent = userTorrents.find(
      (userTorrent) => userTorrent.hash === infoHash
    );

    if (userTorrent) return { id: userTorrent.id, name: userTorrent.name };

    const torrent = await this.addMagnet(magnetUri);
    return { id: torrent.torrent_id, name: torrent.name };
  }

  static async getDownloadInfo(uri: string) {
    const torrentData = await this.getTorrentIdAndName(uri);
    const url = await this.requestLink(torrentData.id);

    const name = torrentData.name ? `${torrentData.name}.zip` : undefined;

    return { url, name };
  }

  /** Add to TorBox and wait until the torrent is cached/ready, then return download info. */
  static async getDownloadInfoWaitingForReady(
    uri: string,
    options: {
      pollIntervalMs?: number;
      timeoutMs?: number;
      onProgress?: (progress: number, state: string) => void;
    } = {}
  ): Promise<{ url: string; name: string }> {
    const { pollIntervalMs = 5000, timeoutMs = 3600_000, onProgress } = options;

    const torrentData = await this.getTorrentIdAndName(uri);
    const start = Date.now();

    let polling = true;
    while (polling) {
      const info = await this.getTorrentInfo(torrentData.id);
      if (!info) throw new Error("TorBox: torrent not found");

      const { download_state, progress } = info;
      if (download_state === "cached" || download_state === "completed") {
        const url = await this.requestLink(torrentData.id);
        const name = torrentData.name
          ? `${torrentData.name}.zip`
          : "download.zip";
        return { url, name };
      }
      if (
        download_state === "stalled (no seeds)" ||
        download_state === "paused"
      ) {
        onProgress?.(progress, download_state);
      }

      if (Date.now() - start > timeoutMs) {
        throw new Error("TorBox: timeout waiting for torrent to be ready");
      }

      onProgress?.(progress, download_state);
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }
}
