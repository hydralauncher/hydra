import axios, { AxiosInstance } from "axios";
import https from "node:https";
import { setTimeout as sleep } from "node:timers/promises";
import parseTorrent from "parse-torrent";
import { DownloadError } from "../../../shared/constants.js";
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
} from "./debrid-files.js";
import {
  canUseRealDebridArchiveLink,
  hasRealDebridSelection,
  isRealDebridArchiveCandidate,
  throwIfRealDebridTorrentFailed,
  waitForRealDebridLinks,
} from "./real-debrid-links.js";

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
      timeout: 15_000,
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      httpsAgent: new https.Agent({ family: 4 }),
    });
  }

  static async addMagnet(magnet: string, signal?: AbortSignal) {
    const searchParams = new URLSearchParams({ magnet });

    const response = await this.instance.post<RealDebridAddMagnet>(
      "/torrents/addMagnet",
      searchParams.toString(),
      { signal }
    );

    return response.data;
  }

  static async getTorrentInfo(id: string, signal?: AbortSignal) {
    const response = await this.instance.get<RealDebridTorrentInfo>(
      `/torrents/info/${id}`,
      { signal }
    );
    return response.data;
  }

  static async getUser() {
    const response = await this.instance.get<RealDebridUser>(`/user`);
    return response.data;
  }

  private static async selectFiles(
    id: string,
    fileIds: number[],
    signal?: AbortSignal
  ) {
    const searchParams = new URLSearchParams({
      files: fileIds.join(","),
    });
    await this.instance.post(
      `/torrents/selectFiles/${id}`,
      searchParams.toString(),
      { signal }
    );
  }

  private static async getTorrentWithFiles(
    uri: string,
    preferredId?: string,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const id = preferredId ?? (await this.getTorrentId(uri, signal));
    for (let attempt = 0; attempt < 15; attempt++) {
      let info: RealDebridTorrentInfo;
      try {
        info = await this.getTorrentInfo(id, signal);
      } catch (error) {
        if (
          preferredId &&
          axios.isAxiosError(error) &&
          error.response?.status === 404
        ) {
          const { infoHash } = await parseTorrent(uri);
          if (infoHash) this.torrentIdsByHash.delete(infoHash);
          return this.getTorrentWithFiles(uri, undefined, signal);
        }
        throw error;
      }
      signal?.throwIfAborted();
      throwIfRealDebridTorrentFailed(info);
      if (info.files?.length) return info;
      if (attempt < 14) {
        await sleep(1000, undefined, { signal });
      }
    }
    throw new Error(DownloadError.RealDebridTorrentNotReady);
  }

  static async getDownloadFiles(uri: string, signal?: AbortSignal) {
    const info = await this.getTorrentWithFiles(uri, undefined, signal);
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
    selectedIndices?: number[],
    signal?: AbortSignal
  ): Promise<RealDebridDownloadEntry[] | null> {
    return (
      await this.getDownloadEntriesWithTorrent(
        uri,
        selectedIndices,
        undefined,
        signal
      )
    ).entries;
  }

  private static async getTorrentOrPending(
    uri: string,
    preferredId?: string,
    signal?: AbortSignal
  ) {
    try {
      const info = await this.getTorrentWithFiles(uri, preferredId, signal);
      return { torrentId: info.id, info };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === DownloadError.RealDebridTorrentNotReady
      ) {
        return { torrentId: await this.getTorrentId(uri, signal), info: null };
      }
      throw error;
    }
  }

  private static async restartTorrentForSelection(
    uri: string,
    info: RealDebridTorrentInfo,
    selectedIndices?: number[],
    signal?: AbortSignal
  ) {
    const canChangeSelection =
      info.status !== "waiting_files_selection" &&
      (selectedIndices !== undefined || info.status === "downloaded");
    if (!canChangeSelection || hasRealDebridSelection(info, selectedIndices)) {
      return { torrentId: info.id, info };
    }

    const { infoHash } = await parseTorrent(uri);
    const torrent = await this.addMagnet(uri, signal);
    if (infoHash) this.torrentIdsByHash.set(infoHash, torrent.id);
    try {
      const nextInfo = await this.getTorrentWithFiles(uri, torrent.id, signal);
      return { torrentId: nextInfo.id, info: nextInfo };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === DownloadError.RealDebridTorrentNotReady
      ) {
        return { torrentId: torrent.id, info: null };
      }
      throw error;
    }
  }

  private static async getArchiveEntries(
    current: RealDebridTorrentInfo,
    selectedIndices?: number[],
    signal?: AbortSignal
  ): Promise<RealDebridDownloadEntry[] | null> {
    throwIfRealDebridTorrentFailed(current);
    if (!isRealDebridArchiveCandidate(current, selectedIndices)) return null;
    const unlocked = await this.unrestrictLink(current.links[0], signal);
    if (
      !unlocked.download ||
      !canUseRealDebridArchiveLink(current, unlocked.filename, selectedIndices)
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
  }

  static async getDownloadEntriesWithTorrent(
    uri: string,
    selectedIndices?: number[],
    preferredId?: string,
    signal?: AbortSignal
  ): Promise<{
    torrentId: string | null;
    entries: RealDebridDownloadEntry[] | null;
  }> {
    signal?.throwIfAborted();
    if (!uri.startsWith("magnet:")) {
      const unlocked = await this.unrestrictLink(uri, signal);
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

    const initial = await this.getTorrentOrPending(uri, preferredId, signal);
    if (!initial.info) return { torrentId: initial.torrentId, entries: null };
    const selectedTorrent = await this.restartTorrentForSelection(
      uri,
      initial.info,
      selectedIndices,
      signal
    );
    if (!selectedTorrent.info) {
      return { torrentId: selectedTorrent.torrentId, entries: null };
    }
    const info = selectedTorrent.info;

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
        requested.map((file) => file.index),
        signal
      );
    }

    // A verified provider archive can start immediately, even if its torrent
    // only just finished and its file/link counts differ.
    const archive = await this.getArchiveEntries(info, selectedIndices, signal);
    if (archive) return { torrentId: info.id, entries: archive };

    let ready;
    try {
      ready = await waitForRealDebridLinks(
        () => this.getTorrentInfo(info.id, signal),
        undefined,
        info.status === "downloaded" ? info : undefined,
        signal
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== DownloadError.RealDebridLinksNotReady
      ) {
        throw error;
      }

      const current = await this.getTorrentInfo(info.id, signal);
      const settledArchive = await this.getArchiveEntries(
        current,
        selectedIndices,
        signal
      );
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

  static async unrestrictLink(link: string, signal?: AbortSignal) {
    const searchParams = new URLSearchParams({ link });

    const response = await this.instance.post<RealDebridUnrestrictLink>(
      "/unrestrict/link",
      searchParams.toString(),
      { signal }
    );

    return response.data;
  }

  static async unlockFile(
    link: string,
    expectedPath: string,
    expectedSize: number,
    signal?: AbortSignal
  ) {
    return (
      await this.unlockFileWithDetails(link, expectedPath, expectedSize, signal)
    ).url;
  }

  static async unlockFileWithDetails(
    link: string,
    expectedPath: string,
    expectedSize: number,
    signal?: AbortSignal
  ) {
    const file = await this.unrestrictLink(link, signal);
    assertRealDebridFileLink(
      expectedPath,
      expectedSize,
      file.filename,
      file.filesize
    );
    return { url: decodeURIComponent(file.download), chunks: file.chunks };
  }

  private static async getAllTorrentsFromUser(signal?: AbortSignal) {
    const response = await this.instance.get<RealDebridTorrentInfo[]>(
      "/torrents",
      { signal }
    );

    return response.data;
  }

  static async getTorrentId(magnetUri: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const { infoHash } = await parseTorrent(magnetUri);
    if (!infoHash) throw new Error("The magnet link has no torrent hash.");
    const cachedId = this.torrentIdsByHash.get(infoHash);
    if (cachedId) return cachedId;

    const userTorrents = await RealDebridClient.getAllTorrentsFromUser(signal);
    const userTorrent = userTorrents.find(
      (userTorrent) => userTorrent.hash === infoHash
    );

    if (userTorrent) {
      this.torrentIdsByHash.set(infoHash, userTorrent.id);
      return userTorrent.id;
    }

    const torrent = await RealDebridClient.addMagnet(magnetUri, signal);
    this.torrentIdsByHash.set(infoHash, torrent.id);
    return torrent.id;
  }

  public static async getDownloadUrl(uri: string, signal?: AbortSignal) {
    const entries = await this.getDownloadEntries(uri, undefined, signal);
    const first = entries?.[0];
    if (!first) return null;
    if (!first.isLocked) return first.url;
    return this.unlockFile(first.url, first.path, first.size, signal);
  }
}
