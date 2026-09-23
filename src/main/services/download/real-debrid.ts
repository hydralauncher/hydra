import axios, { AxiosInstance } from "axios";
import https from "node:https";
import parseTorrent from "parse-torrent";
import { DownloadError } from "@shared";
import type {
  RealDebridAddMagnet,
  RealDebridTorrentInfo,
  RealDebridUnrestrictLink,
  RealDebridUser,
} from "@types";
import {
  assertRealDebridFileLink,
  selectDebridFiles,
  stableDebridFileIndex,
  toTorrentFilesResponse,
} from "./debrid-files";
import {
  canUseRealDebridArchiveLink,
  isRealDebridArchiveCandidate,
  waitForRealDebridLinks,
} from "./real-debrid-links";

interface RealDebridDownloadEntry {
  index: number;
  path: string;
  size: number;
  url: string;
  isLocked: boolean;
}

export class RealDebridClient {
  private static instance: AxiosInstance;
  private static readonly baseURL = "https://api.real-debrid.com/rest/1.0";

  static authorize(apiToken: string) {
    this.instance = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      httpsAgent: new https.Agent({ family: 4 }),
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

  private static async selectFiles(id: string, fileIds: number[]) {
    const searchParams = new URLSearchParams({
      files: fileIds.join(","),
    });
    await this.instance.post(
      `/torrents/selectFiles/${id}`,
      searchParams.toString()
    );
  }

  private static async getTorrentWithFiles(uri: string) {
    const id = await this.getTorrentId(uri);
    for (let attempt = 0; attempt < 15; attempt++) {
      const info = await this.getTorrentInfo(id);
      if (info.files?.length) return info;
      if (attempt < 14) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error(DownloadError.RealDebridTorrentNotReady);
  }

  static async getDownloadFiles(uri: string) {
    const info = await this.getTorrentWithFiles(uri);
    const available =
      info.status === "downloaded"
        ? info.files.filter((file) => file.selected)
        : info.files;
    return toTorrentFilesResponse(
      info.filename,
      available.map((file) => ({
        index: file.id,
        path: file.path,
        size: file.bytes,
      }))
    );
  }

  static async getDownloadEntries(
    uri: string,
    selectedIndices?: number[]
  ): Promise<RealDebridDownloadEntry[] | null> {
    if (!uri.startsWith("magnet:")) {
      const unlocked = await this.unrestrictLink(uri);
      return [
        {
          index: 0,
          path: unlocked.filename,
          size: unlocked.filesize,
          url: decodeURIComponent(unlocked.download),
          isLocked: false,
        },
      ];
    }

    const info = await this.getTorrentWithFiles(uri);
    const files = info.files.map((file) => ({
      index: file.id,
      path: file.path,
      size: file.bytes,
      selected: Boolean(file.selected),
    }));
    const requested = selectDebridFiles(files, selectedIndices);

    if (info.status === "waiting_files_selection") {
      await this.selectFiles(
        info.id,
        requested.map((file) => file.index)
      );
    }

    let ready;
    try {
      ready = await waitForRealDebridLinks(() => this.getTorrentInfo(info.id));
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== DownloadError.RealDebridLinksNotReady
      ) {
        throw error;
      }

      const current = await this.getTorrentInfo(info.id);
      if (!isRealDebridArchiveCandidate(current, selectedIndices)) {
        throw error;
      }

      const unlocked = await this.unrestrictLink(current.links[0]);
      if (
        !unlocked.download ||
        !canUseRealDebridArchiveLink(
          current,
          unlocked.filename,
          selectedIndices
        )
      ) {
        throw error;
      }

      return [
        {
          index: stableDebridFileIndex(unlocked.filename, unlocked.filesize),
          path: unlocked.filename,
          size: unlocked.filesize,
          url: decodeURIComponent(unlocked.download),
          isLocked: false,
        },
      ];
    }
    if (!ready) return null;

    const entries = ready.selectedFiles.map((file, index) => ({
      index: file.id,
      path: file.path,
      size: file.bytes,
      url: ready.info.links[index],
      isLocked: true,
    }));
    return selectDebridFiles(entries, selectedIndices);
  }

  static async unrestrictLink(link: string) {
    const searchParams = new URLSearchParams({ link });

    const response = await this.instance.post<RealDebridUnrestrictLink>(
      "/unrestrict/link",
      searchParams.toString()
    );

    return response.data;
  }

  static async unlockFile(
    link: string,
    expectedPath: string,
    expectedSize: number
  ) {
    const file = await this.unrestrictLink(link);
    assertRealDebridFileLink(
      expectedPath,
      expectedSize,
      file.filename,
      file.filesize
    );
    return decodeURIComponent(file.download);
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
    const entries = await this.getDownloadEntries(uri);
    const first = entries?.[0];
    if (!first) return null;
    if (!first.isLocked) return first.url;
    return this.unlockFile(first.url, first.path, first.size);
  }
}
