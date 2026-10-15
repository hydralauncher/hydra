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

import { getRealDebridFiles } from "./real-debrid-files.js";

const REQUEST_TIMEOUT_MS = 15_000;
const TORRENT_LIST_PAGE_LIMIT = 5000;
const TORRENT_FILE_POLL_ATTEMPTS = 15;
const TORRENT_FILE_POLL_DELAY_MS = 1000;

interface RealDebridDownloadEntry {
  index: number;
  path: string;
  size: number;
  url: string;
  isLocked: boolean;
  sourcePath?: string;
  chunks?: number;
  isArchive?: boolean;
  resourceId?: string;
  preparedLink?: { url: string; resolvedAt: number };
}

export class RealDebridClient {
  private static instance: AxiosInstance;
  private static readonly baseURL = "https://api.real-debrid.com/rest/1.0";
  private static readonly torrentIdsByHash = new Map<string, string>();

  static authorize(apiToken: string) {
    this.torrentIdsByHash.clear();
    this.instance = axios.create({
      baseURL: this.baseURL,
      timeout: REQUEST_TIMEOUT_MS,
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
    fileIds: number[] | undefined,
    signal?: AbortSignal
  ) {
    const searchParams = new URLSearchParams({
      files: fileIds === undefined ? "all" : fileIds.join(","),
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
    signal?: AbortSignal,
    allowEmptyFileSelection = false
  ): Promise<RealDebridTorrentInfo> {
    signal?.throwIfAborted();
    const id = preferredId ?? (await this.getTorrentId(uri, signal));
    return this.pollTorrentFiles(
      uri,
      id,
      new Set(),
      signal,
      0,
      allowEmptyFileSelection
    );
  }

  private static async pollTorrentFiles(
    uri: string,
    id: string,
    unavailableIds: Set<string>,
    signal?: AbortSignal,
    attempt = 0,
    allowEmptyFileSelection = false
  ): Promise<RealDebridTorrentInfo> {
    let info: RealDebridTorrentInfo;
    try {
      info = await this.getTorrentInfo(id, signal);
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 404)
        throw error;
      const { infoHash } = await parseTorrent(uri);
      if (infoHash) this.torrentIdsByHash.delete(infoHash);
      unavailableIds.add(id);
      this.assertTorrentFilePollRemaining(attempt);
      const nextId = await this.getTorrentId(uri, signal, unavailableIds);
      return this.pollTorrentFiles(
        uri,
        nextId,
        unavailableIds,
        signal,
        attempt + 1,
        allowEmptyFileSelection
      );
    }
    signal?.throwIfAborted();
    throwIfRealDebridTorrentFailed(info);
    if (
      info.files?.length ||
      (allowEmptyFileSelection && info.status === "waiting_files_selection")
    )
      return info;
    this.assertTorrentFilePollRemaining(attempt);
    await sleep(TORRENT_FILE_POLL_DELAY_MS, undefined, { signal });
    return this.pollTorrentFiles(
      uri,
      id,
      unavailableIds,
      signal,
      attempt + 1,
      allowEmptyFileSelection
    );
  }

  private static assertTorrentFilePollRemaining(attempt: number) {
    if (attempt >= TORRENT_FILE_POLL_ATTEMPTS - 1)
      throw new Error(DownloadError.RealDebridTorrentNotReady);
  }

  static async getDownloadFiles(uri: string, signal?: AbortSignal) {
    const info = await this.getTorrentWithFiles(uri, undefined, signal);
    return toTorrentFilesResponse(info.filename, getRealDebridFiles(info));
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
    signal?: AbortSignal,
    allowEmptyFileSelection = false
  ) {
    try {
      const info = await this.getTorrentWithFiles(
        uri,
        preferredId,
        signal,
        allowEmptyFileSelection
      );
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
      info.files.some((file) => file.selected);
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

  private static async getArchiveEntry(
    info: RealDebridTorrentInfo,
    selectedIndices?: number[],
    signal?: AbortSignal
  ): Promise<RealDebridDownloadEntry> {
    const unlocked = await this.unrestrictLink(info.links[0], signal);
    if (
      !canUseRealDebridArchiveLink(info, unlocked.filename, selectedIndices)
    ) {
      throw new Error("Real-Debrid returned an invalid torrent archive.");
    }
    const [file] = getRealDebridFiles({
      ...info,
      files: [
        {
          id: 0,
          path: `/${unlocked.filename}`,
          bytes: unlocked.filesize,
          selected: 1,
        },
      ],
    });
    const selection = info.files
      .filter((file) => file.selected)
      .map((file) => file.id)
      .sort((a, b) => a - b)
      .join(",");
    return {
      ...file,
      url: info.links[0],
      isLocked: true,
      isArchive: true,
      chunks: unlocked.chunks,
      preparedLink: { url: unlocked.download, resolvedAt: Date.now() },
      resourceId: `realDebrid:${info.hash.toLowerCase()}:archive:${selection}`,
    };
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
            url: unlocked.download,
            isLocked: false,
            chunks: unlocked.chunks,
          },
        ],
      };
    }

    const initial = await this.getTorrentOrPending(
      uri,
      preferredId,
      signal,
      selectedIndices === undefined
    );
    if (!initial.info) return { torrentId: initial.torrentId, entries: null };
    if (!initial.info.files?.length) {
      await this.selectFiles(initial.info.id, undefined, signal);
      return { torrentId: initial.info.id, entries: null };
    }
    const requestedFiles = selectDebridFiles(
      getRealDebridFiles(initial.info),
      selectedIndices
    );
    if (requestedFiles.every((file) => file.size === 0)) {
      return {
        torrentId: initial.info.id,
        entries: requestedFiles.map((file) => ({
          ...file,
          url: "about:blank",
          isLocked: false,
        })),
      };
    }
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

    const files = getRealDebridFiles(info).map((file, index) => ({
      ...file,
      selected: Boolean(info.files[index].selected),
    }));
    const requested = selectDebridFiles(files, selectedIndices);

    if (info.status === "waiting_files_selection") {
      await this.selectFiles(
        info.id,
        selectedIndices === undefined
          ? undefined
          : requested.map((file) => file.index),
        signal
      );
    }

    const ready = await waitForRealDebridLinks(
      () => this.getTorrentInfo(info.id, signal),
      undefined,
      info.status === "downloaded" ? info : undefined,
      signal,
      true
    );
    if (
      !ready ||
      !hasRealDebridSelection(
        ready.info,
        requested.map((file) => file.index)
      )
    ) {
      return { torrentId: info.id, entries: null };
    }
    if (isRealDebridArchiveCandidate(ready.info)) {
      return {
        torrentId: info.id,
        entries: [
          await this.getArchiveEntry(ready.info, selectedIndices, signal),
        ],
      };
    }

    const normalized = getRealDebridFiles(ready.info);
    const entries = ready.selectedFiles.map((file, index) => ({
      ...normalized.find((entry) => entry.index === file.id)!,
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
    return { url: file.download, chunks: file.chunks };
  }

  private static async getAllTorrentsFromUser(signal?: AbortSignal) {
    const response = await this.instance.get<RealDebridTorrentInfo[]>(
      "/torrents",
      { signal, params: { limit: TORRENT_LIST_PAGE_LIMIT } }
    );

    return response.data;
  }

  static async getTorrentId(
    magnetUri: string,
    signal?: AbortSignal,
    unavailableIds?: ReadonlySet<string>
  ) {
    signal?.throwIfAborted();
    const { infoHash } = await parseTorrent(magnetUri);
    if (!infoHash) throw new Error("The magnet link has no torrent hash.");
    const cachedId = this.torrentIdsByHash.get(infoHash);
    if (cachedId && !unavailableIds?.has(cachedId)) return cachedId;

    const userTorrents = await RealDebridClient.getAllTorrentsFromUser(signal);
    const matches = userTorrents.filter(
      (torrent) =>
        torrent.hash?.toLowerCase() === infoHash.toLowerCase() &&
        !unavailableIds?.has(torrent.id) &&
        !["error", "dead", "virus", "magnet_error"].includes(torrent.status)
    );
    matches.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
    const userTorrent =
      matches.find((torrent) => torrent.status === "downloaded") ?? matches[0];

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
    if (first.preparedLink) return first.preparedLink.url;
    if (!first.isLocked) return first.url;
    return this.unlockFile(
      first.url,
      first.sourcePath ?? first.path,
      first.isArchive ? 0 : first.size,
      signal
    );
  }
}
