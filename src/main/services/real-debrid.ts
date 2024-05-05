import type {
  RealDebridAddMagnet,
  RealDebridTorrentInfo,
  RealDebridUnrestrictLink,
} from "./real-debrid.types";
import axios, { AxiosInstance } from "axios";

const base = "https://api.real-debrid.com/rest/1.0";

export class RealDebridClient {
  private static instance: AxiosInstance;

  static async addMagnet(magnet: string) {
    const searchParams = new URLSearchParams();
    searchParams.append("magnet", magnet);

    const response = await this.instance.post<RealDebridAddMagnet>(
      "/torrents/addMagnet",
      searchParams.toString()
    );

    return response.data;
  }

  static async getInfo(id: string) {
    const response = await this.instance.get<RealDebridTorrentInfo>(
      `/torrents/info/${id}`
    );
    return response.data;
  }

  static async selectAllFiles(id: string) {
    const searchParams = new URLSearchParams();
    searchParams.append("files", "all");

    await this.instance.post(
      `/torrents/selectFiles/${id}`,
      searchParams.toString()
    );
  }

  static async unrestrictLink(link: string) {
    const searchParams = new URLSearchParams();
    searchParams.append("link", link);

    const response = await this.instance.post<RealDebridUnrestrictLink>(
      "/unrestrict/link",
      searchParams.toString()
    );

    return response.data;
  }

  static async getAllTorrentsFromUser() {
    const response =
      await this.instance.get<RealDebridTorrentInfo[]>("/torrents");

    return response.data;
  }

  static extractSHA1FromMagnet(magnet: string) {
    return magnet.match(/btih:([0-9a-fA-F]*)/)?.[1].toLowerCase();
  }

  static async authorize(apiToken: string) {
    this.instance = axios.create({
      baseURL: base,
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    });
  }
}
