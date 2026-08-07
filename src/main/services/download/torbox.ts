import axios, { AxiosInstance } from "axios";
import parseTorrent from "parse-torrent";
import type {
  TorBoxUserRequest,
  TorBoxTorrentInfo,
  TorBoxTorrentInfoRequest,
  TorBoxAddTorrentRequest,
  TorBoxRequestLinkRequest,
} from "@types";
import { appVersion } from "@main/constants";
import { DownloadError } from "@shared";
import { logger } from "../logger";

const READINESS_POLL_ATTEMPTS = 6;
const READINESS_POLL_DELAY_MS = 1000;
const MY_LIST_PAGE_SIZE = 1000;
const MY_LIST_MAX_PAGES = 10;

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
    const searchParams = new URLSearchParams({
      id: id.toString(),
      bypass_cache: "true",
    });

    const response = await this.instance.get<
      Omit<TorBoxTorrentInfoRequest, "data"> & {
        data: TorBoxTorrentInfo | TorBoxTorrentInfo[] | null;
      }
    >("/torrents/mylist?" + searchParams.toString());

    const { data } = response.data;

    if (!data) return null;

    if (Array.isArray(data)) {
      return data.find((item) => item.id === id) ?? null;
    }

    return data;
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

    const { success, detail, data } = response.data;

    if (!success || typeof data !== "string" || !data) {
      logger.error(
        `[TorBox] requestdl did not return a link for torrent ${id}: ${detail}`
      );

      throw new Error(DownloadError.TorBoxLinkUnavailable);
    }

    return data;
  }

  private static async getAllTorrentsFromUser() {
    const torrents: TorBoxTorrentInfo[] = [];

    for (let page = 0; page < MY_LIST_MAX_PAGES; page++) {
      const searchParams = new URLSearchParams({
        bypass_cache: "true",
        offset: (page * MY_LIST_PAGE_SIZE).toString(),
        limit: MY_LIST_PAGE_SIZE.toString(),
      });

      const response = await this.instance.get<TorBoxTorrentInfoRequest>(
        "/torrents/mylist?" + searchParams.toString()
      );

      const entries = response.data.data ?? [];
      torrents.push(...entries);

      if (entries.length < MY_LIST_PAGE_SIZE) break;
    }

    return torrents;
  }

  private static isReady(torrent: TorBoxTorrentInfo) {
    return Boolean(torrent.download_finished && torrent.download_present);
  }

  private static async waitForTorrentReady(id: number) {
    for (let attempt = 1; attempt <= READINESS_POLL_ATTEMPTS; attempt++) {
      const torrent = await this.getTorrentInfo(id);

      if (torrent && this.isReady(torrent)) return torrent;

      logger.log(
        `[TorBox] Torrent ${id} not downloadable yet (state=${torrent?.download_state ?? "unknown"}, finished=${torrent?.download_finished}, present=${torrent?.download_present}, attempt ${attempt}/${READINESS_POLL_ATTEMPTS})`
      );

      if (attempt < READINESS_POLL_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, READINESS_POLL_DELAY_MS)
        );
      }
    }

    throw new Error(DownloadError.TorBoxTorrentNotReady);
  }

  private static async getTorrentIdAndName(magnetUri: string) {
    const { infoHash } = await parseTorrent(magnetUri);

    if (!infoHash) throw new Error(DownloadError.InvalidMagnet);

    const normalizedInfoHash = infoHash.toLowerCase();
    const userTorrents = await this.getAllTorrentsFromUser();

    const userTorrent = userTorrents.find(
      (userTorrent) => userTorrent.hash?.toLowerCase() === normalizedInfoHash
    );

    if (userTorrent) {
      if (this.isReady(userTorrent)) {
        return { id: userTorrent.id, name: userTorrent.name };
      }

      const readyTorrent = await this.waitForTorrentReady(userTorrent.id);
      return { id: readyTorrent.id, name: readyTorrent.name };
    }

    const torrent = await this.addMagnet(magnetUri);
    const readyTorrent = await this.waitForTorrentReady(torrent.torrent_id);

    return { id: readyTorrent.id, name: readyTorrent.name || torrent.name };
  }

  static async getDownloadInfo(uri: string) {
    const torrentData = await this.getTorrentIdAndName(uri);
    const url = await this.requestLink(torrentData.id);

    const name = torrentData.name ? `${torrentData.name}.zip` : undefined;

    return { url, name };
  }
}
