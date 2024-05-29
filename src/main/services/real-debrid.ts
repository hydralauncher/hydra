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
  private static baseURL = "https://api.real-debrid.com/rest/1.0";

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

    await this.instance.post(
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
}
