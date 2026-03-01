import axios, { AxiosInstance } from "axios";
import parseTorrent from "parse-torrent";
import type {
  RealDebridAddMagnet,
  RealDebridTorrentInfo,
  RealDebridUnrestrictLink,
  RealDebridUser,
} from "@types";

export class RealDebridClient {
  private static instance: AxiosInstance;
  private static readonly baseURL = "https://api.real-debrid.com/rest/1.0";

  static authorize(apiToken: string) {
    this.instance = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    });
  }

  static async addMagnet(magnet: string) {
    const searchParams = new URLSearchParams({ magnet });

    const response = await this.instance.post<RealDebridAddMagnet>(
      "/torrents/addMagnet",
      searchParams.toString()
    );

    return response.data;
  }

  static async getTorrentInfo(id: string) {
    const response = await this.instance.get<RealDebridTorrentInfo>(
      `/torrents/info/${id}`
    );
    return response.data;
  }

  static async getUser() {
    const response = await this.instance.get<RealDebridUser>(`/user`);
    return response.data;
  }

  static async selectAllFiles(id: string) {
    const searchParams = new URLSearchParams({ files: "all" });

    return this.instance.post(
      `/torrents/selectFiles/${id}`,
      searchParams.toString()
    );
  }

  static async unrestrictLink(link: string) {
    const searchParams = new URLSearchParams({ link });

    const response = await this.instance.post<RealDebridUnrestrictLink>(
      "/unrestrict/link",
      searchParams.toString()
    );

    return response.data;
  }

  private static async getAllTorrentsFromUser() {
    const response =
      await this.instance.get<RealDebridTorrentInfo[]>("/torrents");

    return response.data;
  }

  static async getTorrentId(magnetUri: string) {
    const userTorrents = await RealDebridClient.getAllTorrentsFromUser();

    const { infoHash } = await parseTorrent(magnetUri);
    const userTorrent = userTorrents.find(
      (userTorrent) => userTorrent.hash === infoHash
    );

    if (userTorrent) return userTorrent.id;

    const torrent = await RealDebridClient.addMagnet(magnetUri);
    return torrent.id;
  }

  public static async getDownloadUrl(uri: string) {
    let realDebridTorrentId: string | null = null;

    if (uri.startsWith("magnet:")) {
      realDebridTorrentId = await this.getTorrentId(uri);
    }

    if (realDebridTorrentId) {
      let torrentInfo = await this.getTorrentInfo(realDebridTorrentId);

      if (torrentInfo.status === "waiting_files_selection") {
        await this.selectAllFiles(realDebridTorrentId);

        torrentInfo = await this.getTorrentInfo(realDebridTorrentId);
      }

      const { links, status } = torrentInfo;

      if (status === "downloaded") {
        const [link] = links;

        const { download } = await this.unrestrictLink(link);
        return decodeURIComponent(download);
      }

      return null;
    }

    const { download } = await this.unrestrictLink(uri);

    return decodeURIComponent(download);
  }

  /** Add to Real-Debrid and wait until the torrent is ready, then return the download URL. */
  public static async getDownloadUrlWaitingForReady(
    uri: string,
    options: {
      pollIntervalMs?: number;
      timeoutMs?: number;
      onProgress?: (progress: number, status: string) => void;
    } = {}
  ): Promise<string> {
    const { pollIntervalMs = 5000, timeoutMs = 3600_000, onProgress } = options;

    if (!uri.startsWith("magnet:")) {
      const url = await this.getDownloadUrl(uri);
      if (!url) throw new Error("Failed to unrestrict link");
      return url;
    }

    const realDebridTorrentId = await this.getTorrentId(uri);
    let torrentInfo = await this.getTorrentInfo(realDebridTorrentId);

    if (torrentInfo.status === "waiting_files_selection") {
      await this.selectAllFiles(realDebridTorrentId);
      torrentInfo = await this.getTorrentInfo(realDebridTorrentId);
    }

    const start = Date.now();
    const polling = true;
    while (polling) {
      if (torrentInfo.status === "downloaded") {
        const [link] = torrentInfo.links;
        const { download } = await this.unrestrictLink(link);
        return decodeURIComponent(download);
      }
      if (
        torrentInfo.status === "error" ||
        torrentInfo.status === "dead" ||
        torrentInfo.status === "virus"
      ) {
        throw new Error(`Real-Debrid: torrent ${torrentInfo.status}`);
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error("Real-Debrid: timeout waiting for torrent to be ready");
      }

      onProgress?.(torrentInfo.progress, torrentInfo.status);
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      torrentInfo = await this.getTorrentInfo(realDebridTorrentId);
    }
    throw new Error("Real-Debrid: unreachable");
  }
}
