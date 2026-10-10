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
  hasRealDebridSelection,
  isRealDebridArchiveCandidate,
  throwIfRealDebridTorrentFailed,
  waitForRealDebridLinks,
} from "./real-debrid-links.js";

import { getRealDebridFiles } from "./real-debrid-files.js";

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
}

export class RealDebridClient {
  private static instance: AxiosInstance;
  private static readonly baseURL = "https://api.real-debrid.com/rest/1.0";
  private static readonly torrentIdsByHash = new Map<string, string>();
  private static readonly fileTorrentIds = new Map<string, string>();

  static authorize(apiToken: string) {
    this.torrentIdsByHash.clear();
    this.fileTorrentIds.clear();
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
  ): Promise<RealDebridTorrentInfo> {
    signal?.throwIfAborted();
    const id = preferredId ?? (await this.getTorrentId(uri, signal));
    return this.pollTorrentFiles(uri, id, new Set(), signal);
  }

  private static async pollTorrentFiles(
    uri: string,
    id: string,
    unavailableIds: Set<string>,
    signal?: AbortSignal,
    attempt = 0
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
        attempt + 1
      );
    }
    signal?.throwIfAborted();
    throwIfRealDebridTorrentFailed(info);
    if (info.files?.length) return info;
    this.assertTorrentFilePollRemaining(attempt);
    await sleep(TORRENT_FILE_POLL_DELAY_MS, undefined, { signal });
    return this.pollTorrentFiles(uri, id, unavailableIds, signal, attempt + 1);
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

  private static async getTorrentInfoOrMissing(
    id: string,
    signal?: AbortSignal
  ) {
    try {
      return await this.getTorrentInfo(id, signal);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404)
        return undefined;
      throw error;
    }
  }

  private static async findFileTorrent(
    candidates: RealDebridTorrentInfo[],
    candidateInfos: Map<string, RealDebridTorrentInfo>,
    fileIndex: number,
    signal?: AbortSignal,
    index = 0
  ): Promise<RealDebridTorrentInfo | undefined> {
    signal?.throwIfAborted();
    const candidate = candidates[index];
    if (!candidate) return undefined;
    const info =
      candidateInfos.get(candidate.id) ??
      (await this.getTorrentInfoOrMissing(candidate.id, signal));
    if (info) {
      candidateInfos.set(candidate.id, info);
      if (
        !["error", "dead", "virus", "magnet_error"].includes(info.status) &&
        hasRealDebridSelection(info, [fileIndex])
      )
        return info;
    }
    return this.findFileTorrent(
      candidates,
      candidateInfos,
      fileIndex,
      signal,
      index + 1
    );
  }

  private static async getFileTorrent(
    uri: string,
    hash: string,
    fileIndex: number,
    candidates: RealDebridTorrentInfo[],
    candidateInfos: Map<string, RealDebridTorrentInfo>,
    signal?: AbortSignal
  ) {
    const key = `${hash.toLowerCase()}:${fileIndex}`;
    const cachedId = this.fileTorrentIds.get(key);
    let info = cachedId
      ? await this.getTorrentInfoOrMissing(cachedId, signal)
      : undefined;
    if (cachedId && !info) this.fileTorrentIds.delete(key);
    info ??= await this.findFileTorrent(
      candidates,
      candidateInfos,
      fileIndex,
      signal
    );
    if (!info) {
      const created = await this.addMagnet(uri, signal);
      this.fileTorrentIds.set(key, created.id);
      info = await this.getTorrentWithFiles(uri, created.id, signal);
    }
    this.fileTorrentIds.set(key, info.id);
    throwIfRealDebridTorrentFailed(info);
    if (info.status === "waiting_files_selection") {
      await this.selectFiles(info.id, [fileIndex], signal);
      info = await this.getTorrentInfo(info.id, signal);
    }
    return info;
  }

  private static async getIndividualFileEntry(
    uri: string,
    current: RealDebridTorrentInfo,
    file: ReturnType<typeof getRealDebridFiles>[number],
    candidates: RealDebridTorrentInfo[],
    candidateInfos: Map<string, RealDebridTorrentInfo>,
    signal?: AbortSignal
  ): Promise<RealDebridDownloadEntry | null> {
    signal?.throwIfAborted();
    if (file.size === 0)
      return { ...file, url: "about:blank", isLocked: false };
    const info = await this.getFileTorrent(
      uri,
      current.hash,
      file.index,
      candidates,
      candidateInfos,
      signal
    );
    if (info.status === "waiting_files_selection") return null;
    if (
      !hasRealDebridSelection(info, [file.index]) ||
      info.hash.toLowerCase() !== current.hash.toLowerCase()
    ) {
      throw new Error("Real-Debrid returned a different file selection.");
    }
    const ready = await waitForRealDebridLinks(
      () => this.getTorrentInfo(info.id, signal),
      undefined,
      info,
      signal
    );
    if (!ready) return null;
    const resolved = ready.selectedFiles[0];
    if (
      resolved.id !== file.index ||
      resolved.bytes !== file.size ||
      resolved.path !== file.sourcePath
    ) {
      throw new Error("Real-Debrid returned a different torrent file.");
    }
    return { ...file, url: ready.info.links[0], isLocked: true };
  }

  private static async getIndividualFileEntries(
    uri: string,
    current: RealDebridTorrentInfo,
    selectedIndices?: number[],
    signal?: AbortSignal
  ): Promise<RealDebridDownloadEntry[] | null> {
    const requested = selectDebridFiles(
      getRealDebridFiles(current),
      selectedIndices
    );
    const candidates = (await this.getAllTorrentsFromUser(signal)).filter(
      (torrent) => torrent.hash?.toLowerCase() === current.hash.toLowerCase()
    );
    const candidateInfos = new Map<string, RealDebridTorrentInfo>();
    // Keep selection requests sequential so later files reuse the cached torrent
    // metadata and never compete to select files on the same provider torrent.
    const results = await requested.reduce(async (previous, file) => {
      const entries = await previous;
      const entry = await this.getIndividualFileEntry(
        uri,
        current,
        file,
        candidates,
        candidateInfos,
        signal
      );
      entries.push(entry);
      return entries;
    }, Promise.resolve<(RealDebridDownloadEntry | null)[]>([]));
    if (results.some((entry) => entry === null)) return null;
    return results as RealDebridDownloadEntry[];
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

    const initial = await this.getTorrentOrPending(uri, preferredId, signal);
    if (!initial.info) return { torrentId: initial.torrentId, entries: null };
    selectDebridFiles(getRealDebridFiles(initial.info), selectedIndices);
    if (isRealDebridArchiveCandidate(initial.info)) {
      return {
        torrentId: initial.info.id,
        entries: await this.getIndividualFileEntries(
          uri,
          initial.info,
          selectedIndices,
          signal
        ),
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
        requested.map((file) => file.index),
        signal
      );
    }

    const ready = await waitForRealDebridLinks(
      () => this.getTorrentInfo(info.id, signal),
      undefined,
      info.status === "downloaded" ? info : undefined,
      signal
    );
    if (!ready) return { torrentId: info.id, entries: null };

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
      { signal, params: { limit: 5000 } }
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
    if (!first.isLocked) return first.url;
    return this.unlockFile(
      first.url,
      first.sourcePath ?? first.path,
      first.size,
      signal
    );
  }
}
