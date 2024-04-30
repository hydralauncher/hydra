import { userPreferencesRepository } from "@main/repository";
import {
  RealDebridAddMagnet,
  RealDebridTorrentInfo,
  RealDebridUnrestrictLink,
} from "./real-debrid-types";

const base = "https://api.real-debrid.com/rest/1.0";

export class RealDebridClient {
  static async addMagnet(magnet: string) {
    const response = await fetch(`${base}/torrents/addMagnet`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.getApiToken()}`,
      },
      body: `magnet=${encodeURIComponent(magnet)}`,
    });

    return response.json() as Promise<RealDebridAddMagnet>;
  }

  static async getInfo(id: string) {
    const response = await fetch(`${base}/torrents/info/${id}`, {
      headers: {
        Authorization: `Bearer ${await this.getApiToken()}`,
      },
    });

    return response.json() as Promise<RealDebridTorrentInfo>;
  }

  static async selectAllFiles(id: string) {
    await fetch(`${base}/torrents/selectFiles/${id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.getApiToken()}`,
      },
      body: "files=all",
    });
  }

  static async unrestrictLink(link: string) {
    const response = await fetch(`${base}/unrestrict/link`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.getApiToken()}`,
      },
      body: `link=${link}`,
    });

    return response.json() as Promise<RealDebridUnrestrictLink>;
  }

  static getApiToken() {
    return userPreferencesRepository
      .findOne({ where: { id: 1 } })
      .then((userPreferences) => userPreferences!.realDebridApiToken);
  }
}
