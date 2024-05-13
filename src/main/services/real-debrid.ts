import { Game } from "@main/entity";
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
    const searchParams = new URLSearchParams({ magnet });

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

  static async getAllTorrentsFromUser() {
    const response =
      await this.instance.get<RealDebridTorrentInfo[]>("/torrents");

    return response.data;
  }

  static extractSHA1FromMagnet(magnet: string) {
    return magnet.match(/btih:([0-9a-fA-F]*)/)?.[1].toLowerCase();
  }

  static async getDownloadUrl(game: Game) {
    const torrents = await RealDebridClient.getAllTorrentsFromUser();
    const hash = RealDebridClient.extractSHA1FromMagnet(game!.repack.magnet);
    let torrent = torrents.find((t) => t.hash === hash);

    if (!torrent) {
      const magnet = await RealDebridClient.addMagnet(game!.repack.magnet);

      if (magnet && magnet.id) {
        await RealDebridClient.selectAllFiles(magnet.id);
        torrent = await RealDebridClient.getInfo(magnet.id);
      }
    }

    if (torrent) {
      const { links } = torrent;
      const { download } = await RealDebridClient.unrestrictLink(links[0]);

      if (!download) {
        throw new Error("Torrent not cached on Real Debrid");
      }

      return download;
    }

    throw new Error();
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
