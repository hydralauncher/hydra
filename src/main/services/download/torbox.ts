import axios, { AxiosInstance } from "axios";
import parseTorrent from "parse-torrent";
import type {
  TorBoxUserRequest,
  TorBoxTorrentInfoRequest,
  TorBoxAddTorrentRequest,
  TorBoxAddWebDownloadRequest,
  TorBoxWebDownloadInfo,
  TorBoxWebDownloadInfoRequest,
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

  private static async addWebDownload(link: string) {
    const form = new FormData();
    form.append("link", link);

    const response = await this.instance.post<TorBoxAddWebDownloadRequest>(
      "/webdl/createwebdownload",
      form
    );

    if (!response.data.success) {
      throw new Error(response.data.detail);
    }

    const webDownloadId =
      response.data.data.webdownload_id ??
      response.data.data.web_id ??
      response.data.data.id;

    if (!webDownloadId) {
      throw new Error("TorBox did not return a web download id");
    }

    return {
      id: webDownloadId,
      name: response.data.data.name,
    };
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

  private static async requestWebDownloadLink(
    id: number,
    fileId?: number,
    zipLink = false
  ) {
    const searchParams = new URLSearchParams({
      token: this.apiToken,
      web_id: id.toString(),
      zip_link: zipLink.toString(),
      append_name: "true",
    });

    if (fileId !== undefined) {
      searchParams.set("file_id", fileId.toString());
    }

    const response = await this.instance.get<TorBoxRequestLinkRequest>(
      "/webdl/requestdl?" + searchParams.toString()
    );

    return response.data.data;
  }

  private static async getWebDownloadInfo(id: number) {
    const searchParams = new URLSearchParams({
      id: id.toString(),
      bypass_cache: "true",
    });

    const response = await this.instance.get<TorBoxWebDownloadInfoRequest>(
      "/webdl/mylist?" + searchParams.toString()
    );

    const data = response.data.data;
    const webDownloads = Array.isArray(data) ? data : [data];

    return webDownloads.find((item) => item.id === id) ?? null;
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

  private static getWebDownloadName(
    webDownload: TorBoxWebDownloadInfo | null,
    fallbackName?: string
  ) {
    const files = webDownload?.files ?? [];

    if (files.length === 1) {
      return files[0].name;
    }

    const name = webDownload?.name ?? fallbackName;
    return files.length > 1 && name ? `${name}.zip` : name;
  }

  private static async getWebDownloadData(uri: string) {
    const webDownload = await this.addWebDownload(uri);
    const webDownloadInfo = await this.getWebDownloadInfo(webDownload.id);
    const files = webDownloadInfo?.files ?? [];
    const singleFile = files.length === 1 ? files[0] : undefined;
    const zipLink = files.length > 1;
    const url = await this.requestWebDownloadLink(
      webDownload.id,
      singleFile?.id,
      zipLink
    );
    const name = this.getWebDownloadName(webDownloadInfo, webDownload.name);

    return { url, name };
  }

  static async getDownloadInfo(uri: string) {
    if (!uri.startsWith("magnet:")) {
      return this.getWebDownloadData(uri);
    }

    const torrentData = await this.getTorrentIdAndName(uri);
    const url = await this.requestLink(torrentData.id);

    const name = torrentData.name ? `${torrentData.name}.zip` : undefined;

    return { url, name };
  }
}
