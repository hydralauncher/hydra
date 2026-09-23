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
  toTorrentFilesResponse,
} from "./debrid-files";
import {
  canUseRealDebridArchiveLink,
  hasRealDebridSelection,
  isRealDebridArchiveCandidate,
  waitForRealDebridLinks,
} from "./real-debrid-links";

interface RealDebridDownloadEntry {
  index: number;
  path: string;
  size: number;
  url: string;
  isLocked: boolean;
  chunks?: number;
}

export class RealDebridClient {
  private static instance: AxiosInstance;
  private static readonly baseURL = "https://api.real-debrid.com/rest/1.0";
  private static readonly torrentIdsByHash = new Map<string, string>();

  static authorize(apiToken: string) {
    this.torrentIdsByHash.clear();
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

  private static async getTorrentWithFiles(uri: string, preferredId?: string) {
    const id = preferredId ?? (await this.getTorrentId(uri));
    for (let attempt = 0; attempt < 15; attempt++) {
      let info: RealDebridTorrentInfo;
      try {
        info = await this.getTorrentInfo(id);
      } catch (error) {
        if (
          preferredId &&
          axios.isAxiosError(error) &&
          error.response?.status === 404
        ) {
          const { infoHash } = await parseTorrent(uri);
          if (infoHash) this.torrentIdsByHash.delete(infoHash);
          return this.getTorrentWithFiles(uri);
        }
        throw error;
      }
      if (info.files?.length) return info;
      if (attempt < 14) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error(DownloadError.RealDebridTorrentNotReady);
  }

  static async getDownloadFiles(uri: string) {
    const info = await this.getTorrentWithFiles(uri);
    return toTorrentFilesResponse(
      info.filename,
      info.files.map((file) => ({
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
    return (await this.getDownloadEntriesWithTorrent(uri, selectedIndices))
      .entries;
  }

  static async getDownloadEntriesWithTorrent(
    uri: string,
    selectedIndices?: number[],
    preferredId?: string
  ): Promise<{
    torrentId: string | null;
    entries: RealDebridDownloadEntry[] | null;
  }> {
    if (!uri.startsWith("magnet:")) {
      const unlocked = await this.unrestrictLink(uri);
      return {
        torrentId: null,
        entries: [
          {
            index: 0,
            path: unlocked.filename,
            size: unlocked.filesize,
            url: decodeURIComponent(unlocked.download),
            isLocked: false,
            chunks: unlocked.chunks,
          },
        ],
      };
    }

    let info: RealDebridTorrentInfo;
    try {
      info = await this.getTorrentWithFiles(uri, preferredId);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === DownloadError.RealDebridTorrentNotReady
      ) {
        return {
          torrentId: await this.getTorrentId(uri),
          entries: null,
        };
      }
      throw error;
    }
    if (selectedIndices && info.status !== "waiting_files_selection") {
      if (!hasRealDebridSelection(info, selectedIndices)) {
        const { infoHash } = await parseTorrent(uri);
        const torrent = await this.addMagnet(uri);
        if (infoHash) this.torrentIdsByHash.set(infoHash, torrent.id);
        try {
          info = await this.getTorrentWithFiles(uri, torrent.id);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === DownloadError.RealDebridTorrentNotReady
          ) {
            return { torrentId: torrent.id, entries: null };
          }
          throw error;
        }
      }
    }

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

    const resolveArchive = async (current: RealDebridTorrentInfo) => {
      if (!isRealDebridArchiveCandidate(current, selectedIndices)) return null;
      const unlocked = await this.unrestrictLink(current.links[0]);
      if (
        !unlocked.download ||
        !canUseRealDebridArchiveLink(
          current,
          unlocked.filename,
          selectedIndices
        )
      ) {
        return null;
      }
      return [
        {
          index: 0,
          path: unlocked.filename,
          size: unlocked.filesize,
          url: decodeURIComponent(unlocked.download),
          isLocked: false,
          chunks: unlocked.chunks,
        },
      ];
    };

    // A settled archive will never grow per-file links. Avoid polling it on
    // every start and resume before using the already verified archive link.
    const archive = await resolveArchive(info);
    if (archive) return { torrentId: info.id, entries: archive };

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
      const settledArchive = await resolveArchive(current);
      if (!settledArchive) throw error;
      return { torrentId: info.id, entries: settledArchive };
    }
    if (!ready) return { torrentId: info.id, entries: null };

    const entries = ready.selectedFiles.map((file, index) => ({
      index: file.id,
      path: file.path,
      size: file.bytes,
      url: ready.info.links[index],
      isLocked: true,
    }));
    return {
      torrentId: info.id,
      entries: selectDebridFiles(entries, selectedIndices),
    };
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
    return (await this.unlockFileWithDetails(link, expectedPath, expectedSize))
      .url;
  }

  static async unlockFileWithDetails(
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
    return { url: decodeURIComponent(file.download), chunks: file.chunks };
  }

  private static async getAllTorrentsFromUser() {
    const response =
      await this.instance.get<RealDebridTorrentInfo[]>("/torrents");

    return response.data;
  }

  static async getTorrentId(magnetUri: string) {
    const { infoHash } = await parseTorrent(magnetUri);
    if (!infoHash) throw new Error("The magnet link has no torrent hash.");
    const cachedId = this.torrentIdsByHash.get(infoHash);
    if (cachedId) return cachedId;

    const userTorrents = await RealDebridClient.getAllTorrentsFromUser();
    const userTorrent = userTorrents.find(
      (userTorrent) => userTorrent.hash === infoHash
    );

    if (userTorrent) {
      this.torrentIdsByHash.set(infoHash, userTorrent.id);
      return userTorrent.id;
    }

    const torrent = await RealDebridClient.addMagnet(magnetUri);
    this.torrentIdsByHash.set(infoHash, torrent.id);
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
