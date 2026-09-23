import fs from "node:fs";
import path from "node:path";

import type { Game, GameShop, UserPreferences } from "@types";

import {
  db,
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { launchGame } from "@main/helpers";
import { setRunningGamesListener } from "@main/services/process-watcher";
import { closeRunningGame } from "@main/events/library/close-game";
import { getCoverPosterPath } from "@main/events/catalogue/get-cover-poster";
import { composeAssetsWithArtwork } from "@shared";
import { streamSidecarLogger } from "../logger";
import { StreamSidecar, type StreamSidecarEvent } from "../stream-sidecar";
import { SystemPath } from "../system-path";
import { WindowManager } from "../window-manager";
import { StreamCoverCache } from "./cover-cache";

interface StreamAppEntry {
  shop: GameShop;
  objectId: string;
}

/** Debounce before a burst of LevelDB library changes is pushed to the sidecar. */
const LIBRARY_SYNC_DEBOUNCE_MS = 500;
/** Respawn budget and linear backoff for a sidecar that exited unexpectedly. */
const MAX_SIDECAR_RESPAWN_ATTEMPTS = 3;
const SIDECAR_RESPAWN_BACKOFF_MS = 1_000;

/**
 * Owns the lifecycle of the Moonlight-compatible streaming sidecar:
 * spawns it while the `streamingEnabled` preference is on, forwards its
 * events to the renderer, syncs the Hydra game library as the streamable
 * app list, launches games on client request, and opens/closes the
 * big-picture window as streaming clients come and go.
 */
export class StreamingManager {
  private static enabled = false;
  private static unsubscribeEvents: (() => void) | null = null;
  private static unsubscribeExit: (() => void) | null = null;
  private static bigPictureOpenedForStreaming = false;
  private static respawnAttempts = 0;
  private static respawnTimer: NodeJS.Timeout | null = null;

  /** appid -> game, mirroring the catalog pushed to the sidecar. */
  private static apps = new Map<number, StreamAppEntry>();
  /** Non-Desktop appid whose game is running for the current stream. */
  private static activeGameAppid: number | null = null;
  private static libraryUnsubscribe: (() => void) | null = null;
  private static syncTimer: NodeJS.Timeout | null = null;
  private static coverCache: StreamCoverCache | null = null;
  /** Running games last reported by the process watcher, oldest first. */
  private static runningGames: StreamAppEntry[] = [];
  /** Last appid pushed over setRunningGame; null forces a re-send. */
  private static pushedRunningAppid: number | null = null;

  public static async start() {
    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (userPreferences?.streamingEnabled) {
      await this.enable();
    }
  }

  public static syncPreferences(preferences: Partial<UserPreferences>) {
    if (!Object.hasOwn(preferences, "streamingEnabled")) return;

    if (preferences.streamingEnabled) {
      this.enable().catch((error) => {
        streamSidecarLogger.error("Failed to start stream sidecar", error);
      });
    } else {
      this.disable();
    }
  }

  private static async enable() {
    if (this.enabled) return;
    this.enabled = true;

    this.unsubscribeEvents = StreamSidecar.onEvent((event) =>
      this.handleSidecarEvent(event)
    );
    this.unsubscribeExit = StreamSidecar.onExit((reason) =>
      this.handleSidecarExit(reason)
    );
    this.watchLibrary();
    // The process watcher reports its open/close decisions through this
    // callback instead of importing StreamingManager, which would close an
    // import cycle (streaming -> @main/helpers -> @main/services).
    setRunningGamesListener((games) => this.setRunningGames(games));
    this.coverCache = new StreamCoverCache(
      path.join(SystemPath.getPath("userData"), "stream-covers")
    );

    try {
      await StreamSidecar.spawn();
      await this.syncAppList();
      // a fresh process has no running-game state: report it again
      this.pushedRunningAppid = null;
      this.pushRunningGame();
    } catch (error) {
      streamSidecarLogger.error("Failed to spawn stream sidecar", error);
    }
  }

  private static disable() {
    if (!this.enabled) return;
    this.enabled = false;

    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.unsubscribeExit?.();
    this.unsubscribeExit = null;
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.respawnTimer = null;
    this.respawnAttempts = 0;

    this.libraryUnsubscribe?.();
    this.libraryUnsubscribe = null;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    this.coverCache = null;
    this.apps.clear();
    this.activeGameAppid = null;
    setRunningGamesListener(null);
    this.runningGames = [];
    this.pushedRunningAppid = null;

    StreamSidecar.kill();
    this.closeStreamingBigPicture();
  }

  /**
   * Stable appid for a game: FNV-1a of `shop:objectId`, mapped into
   * [2, 0x7ffffffe]. Desktop stays reserved at 1. Electron computes the
   * ids so they survive sidecar restarts.
   */
  private static appIdFor(shop: GameShop, objectId: string): number {
    let hash = 0x811c9dc5;
    const key = `${shop}:${objectId}`;
    for (let index = 0; index < key.length; index++) {
      hash ^= key.codePointAt(index) ?? 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return (hash % 0x7ffffffd) + 2;
  }

  /**
   * Mirrors the renderer's installed semantics (isGameInstalled /
   * isGameReadyToPlay in src/renderer/src/helpers.ts) with one extra
   * requirement: an executable must be present so every advertised app
   * is actually launchable through the stream.
   */
  private static isStreamable(game: Game): boolean {
    if (game.isDeleted) return false;

    const installed =
      Boolean(game.executablePath) ||
      game.installedSizeInBytes != null ||
      (game.shop === "launchbox" && (game.discs?.length ?? 0) > 0);
    if (!installed) return false;

    if (game.shop === "launchbox") {
      return Boolean(game.selectedDiscPath) && Boolean(game.executablePath);
    }
    return Boolean(game.executablePath);
  }

  /**
   * Resolves the cover source for a game using the existing asset
   * schemes: user-picked custom covers (local: paths copied into
   * Assets/custom-games by copyCustomGameAsset) and the composed cover
   * URL (Assets/cover-posters poster when the animated cache exists).
   */
  private static async resolveCoverSource(
    gameKey: string,
    game: Game
  ): Promise<
    { kind: "local"; path: string } | { kind: "remote"; url: string } | null
  > {
    try {
      const [assets, selection] = await Promise.all([
        gamesShopAssetsSublevel.get(gameKey),
        gamesArtworkSelectionSublevel.get(gameKey),
      ]);
      const composed = composeAssetsWithArtwork(assets ?? null, selection);
      const coverUrl = game.customCoverImageUrl ?? composed?.coverImageUrl;

      if (!coverUrl) return null;

      if (coverUrl.startsWith("local:")) {
        const filePath = coverUrl.slice("local:".length);
        return fs.existsSync(filePath)
          ? { kind: "local", path: filePath }
          : null;
      }

      if (/^https?:\/\//.test(coverUrl)) {
        const posterPath = getCoverPosterPath(coverUrl);
        if (fs.existsSync(posterPath)) {
          return { kind: "local", path: posterPath };
        }
        return { kind: "remote", url: coverUrl };
      }

      return null;
    } catch {
      return null;
    }
  }

  private static async syncAppList() {
    if (!this.enabled) return;

    try {
      const entries = await gamesSublevel.iterator().all();
      const mapped = new Map<number, StreamAppEntry>();
      const pending: {
        appid: number;
        title: string;
        coverPath?: string;
        remoteCover?: string;
      }[] = [];

      for (const [key, game] of entries) {
        if (!this.isStreamable(game)) continue;
        const appid = this.appIdFor(game.shop, game.objectId);
        if (mapped.has(appid)) continue; // hash collision: keep the first
        mapped.set(appid, { shop: game.shop, objectId: game.objectId });

        const source = await this.resolveCoverSource(key, game);
        const item: {
          appid: number;
          title: string;
          coverPath?: string;
          remoteCover?: string;
        } = {
          appid,
          title: game.title,
        };
        if (source?.kind === "local") item.coverPath = source.path;
        else if (source?.kind === "remote") item.remoteCover = source.url;
        pending.push(item);
      }

      // Remote covers are downloaded into the streaming cover cache
      // (bounded concurrency); cached files make re-pushes instant.
      const remote = pending
        .filter((app) => app.remoteCover)
        .map((app) => ({ appid: app.appid, url: app.remoteCover! }));
      const cached = this.coverCache
        ? await this.coverCache.resolveAll(remote)
        : new Map<number, string>();

      const apps: { appid: number; title: string; coverPath?: string }[] =
        pending.map(({ appid, title, remoteCover, coverPath }) => {
          const app: { appid: number; title: string; coverPath?: string } = {
            appid,
            title,
          };
          const resolved =
            coverPath ?? (remoteCover ? cached.get(appid) : undefined);
          if (resolved) app.coverPath = resolved;
          return app;
        });

      await StreamSidecar.request("setAppList", { apps });
      this.apps = mapped;
      streamSidecarLogger.log(`Synced ${apps.length} streamable apps`);
    } catch (error) {
      streamSidecarLogger.error("Failed to sync stream app list", error);
    }
  }

  private static watchLibrary() {
    if (this.libraryUnsubscribe) return;

    const onChange = () => {
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        this.syncTimer = null;
        void this.syncAppList();
      }, LIBRARY_SYNC_DEBOUNCE_MS);
    };

    gamesSublevel.on("put", onChange);
    gamesSublevel.on("del", onChange);
    gamesSublevel.on("batch", onChange);
    this.libraryUnsubscribe = () => {
      gamesSublevel.off("put", onChange);
      gamesSublevel.off("del", onChange);
      gamesSublevel.off("batch", onChange);
    };
  }

  private static handleSidecarEvent(event: StreamSidecarEvent) {
    switch (event.event) {
      case "pairing-requested":
        // The client shows the PIN; the renderer prompts the user to
        // enter it. Re-requests while the prompt is open keep it open.
        // The window that can show the prompt has to be the visible one
        // (Big Picture hides the main window), so it is revealed first.
        WindowManager.revealStreamPairingPrompt();
        WindowManager.sendToAppWindows("on-stream-pairing-requested");
        break;
      case "pairing-finished":
        WindowManager.sendToAppWindows("on-stream-pairing-finished", {
          success: event.success,
        });
        break;
      case "launch-requested":
        this.handleLaunchRequested(event.appid);
        break;
      case "client-connected":
        this.openStreamingBigPicture();
        break;
      case "client-disconnected":
        this.activeGameAppid = null;
        this.closeStreamingBigPicture();
        break;
      case "stream-ended":
        this.handleStreamEnded(event.appid, event.reason);
        break;
      case "session-state":
        break;
    }

    // Pairing events have dedicated channels; forwarding them as generic
    // session events would instantly auto-dismiss the PIN prompt.
    if (
      event.event !== "pairing-requested" &&
      event.event !== "pairing-finished"
    ) {
      WindowManager.sendToAppWindows(
        "on-stream-session-event",
        this.withGameEntry(event)
      );
    }
  }

  /**
   * The renderer matches a stream event to a library game, not to an appid:
   * attach the catalog entry for the events that carry one.
   */
  private static withGameEntry(event: StreamSidecarEvent) {
    if (!("appid" in event)) return event;

    const entry = this.apps.get(event.appid);
    return entry
      ? { ...event, shop: entry.shop, objectId: entry.objectId }
      : event;
  }

  /**
   * Reports the games the process watcher sees running, "most recently
   * opened last". Moonlight carries a single `currentgame`, so the last one
   * wins; an empty list clears it. This is how a game started from Hydra's
   * own UI becomes visible to a client.
   */
  public static setRunningGames(games: { shop: GameShop; objectId: string }[]) {
    this.runningGames = games;
    this.pushRunningGame();
  }

  private static pushRunningGame() {
    const lastGame = this.runningGames.at(-1);
    this.pushRunningAppid(
      lastGame ? this.appIdFor(lastGame.shop, lastGame.objectId) : 0
    );
  }

  /**
   * Pushes the running appid over setRunningGame, skipping identical values
   * (`pushedRunningAppid` is cleared when the sidecar respawns, so the value
   * is re-sent to a fresh process) and logging failures instead of throwing:
   * reporting the running game must never break the process watcher.
   */
  private static pushRunningAppid(appid: number) {
    if (!this.enabled || !StreamSidecar.isRunning()) return;
    if (this.pushedRunningAppid === appid) return;

    this.pushedRunningAppid = appid;
    StreamSidecar.request("setRunningGame", { appid }).catch((error) => {
      streamSidecarLogger.error(
        `Failed to report running appid ${appid}`,
        error
      );
    });
  }

  private static handleLaunchRequested(appid: number) {
    const entry = this.apps.get(appid);
    if (!entry) {
      streamSidecarLogger.error(`launch-requested for unknown appid ${appid}`);
      return;
    }

    // A game becomes the content: no big-picture dashboard for it.
    this.activeGameAppid = appid;

    const gameKey = levelKeys.game(entry.shop, entry.objectId);
    gamesSublevel
      .get(gameKey)
      .then((game) => {
        if (!game?.executablePath) {
          streamSidecarLogger.error(
            `Cannot launch ${gameKey}: game is not installed`
          );
          return;
        }
        return launchGame({
          shop: entry.shop,
          objectId: entry.objectId,
          executablePath: game.executablePath,
          launchOptions: game.launchOptions ?? null,
        });
      })
      .catch((error) => {
        streamSidecarLogger.error(`Failed to launch ${gameKey}`, error);
      });
  }

  private static handleStreamEnded(appid: number, reason: string) {
    if (this.activeGameAppid === appid) this.activeGameAppid = null;

    const entry = this.apps.get(appid);
    if (!entry) return;

    // Only an explicit client /cancel stops the game (Sunshine-exact,
    // nvhttp.cpp:1546-1569). Every other teardown — enet disconnect,
    // control-channel silence, RTSP TEARDOWN, pre-RTSP expiry, client
    // TERMINATION — leaves it running so reopening Moonlight finds it
    // (and /resume works).
    if (reason !== "cancel") {
      streamSidecarLogger.log(
        `Stream ended for appid ${appid} (reason: ${reason}); leaving the game running`
      );
      return;
    }

    closeRunningGame(entry.shop, entry.objectId).catch((error) => {
      streamSidecarLogger.error(
        `Failed to stop game for appid ${appid}`,
        error
      );
    });
  }

  /**
   * M6: the sidecar died unexpectedly — treat the stream as down (the
   * client is gone), then respawn with backoff (max 3 attempts) while
   * streaming stays enabled.
   */
  private static handleSidecarExit(reason: string) {
    streamSidecarLogger.error(`Stream sidecar exited: ${reason}`);

    // synthetic client-disconnected: reset session state and big picture
    this.activeGameAppid = null;
    this.closeStreamingBigPicture();
    WindowManager.sendToAppWindows("on-stream-session-event", {
      event: "client-disconnected",
      reason: `sidecar-exit: ${reason}`,
    } as StreamSidecarEvent);

    if (!this.enabled) return;
    if (this.respawnAttempts >= MAX_SIDECAR_RESPAWN_ATTEMPTS) {
      streamSidecarLogger.error(
        "Stream sidecar kept exiting; giving up until streaming is toggled or the library changes"
      );
      return;
    }

    this.respawnAttempts += 1;
    const delayMs = SIDECAR_RESPAWN_BACKOFF_MS * this.respawnAttempts;
    streamSidecarLogger.log(
      `Respawning stream sidecar in ${delayMs}ms (attempt ${this.respawnAttempts}/${MAX_SIDECAR_RESPAWN_ATTEMPTS})`
    );
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null;
      if (!this.enabled) return;
      StreamSidecar.spawn()
        .then(() => {
          // a fresh process has no running-game state: report it again
          this.pushedRunningAppid = null;
          return this.syncAppList();
        })
        .then(() => {
          this.pushRunningGame();
          // healthy again: reset the backoff
          this.respawnAttempts = 0;
        })
        .catch((error) => {
          streamSidecarLogger.error("Failed to respawn stream sidecar", error);
          // spawn failures surface through onExit/onEvent retries
        });
    }, delayMs);
  }

  private static openStreamingBigPicture() {
    if (this.activeGameAppid !== null) return;
    if (this.bigPictureOpenedForStreaming) return;
    if (WindowManager.hasBigPictureWindow()) return;

    WindowManager.openBigPictureWindow();
    this.bigPictureOpenedForStreaming = true;
  }

  private static closeStreamingBigPicture() {
    if (!this.bigPictureOpenedForStreaming) return;
    this.bigPictureOpenedForStreaming = false;

    WindowManager.closeBigPictureWindow();
  }
}
