import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/**
 * UniverseLAN only finishes the Galaxy sign-in (and therefore only lets games
 * report achievements) after its server accepted the client, even for single
 * player games. Hydra runs one hidden server while at least one game that uses
 * UniverseLAN is open.
 */

type SpawnServer = (executablePath: string, cwd: string) => ChildProcess;

const defaultSpawnServer: SpawnServer = (executablePath, cwd) =>
  spawn(executablePath, [], {
    cwd,
    windowsHide: true,
    stdio: "ignore",
  });

export interface UniverseLanServerManagerOptions {
  spawnServer?: SpawnServer;
  onError?: (error: unknown) => void;
  /**
   * Whether the game holding the server is running. Holders that never show up
   * as running within `launchGraceMs` (failed launch, cancelled UAC prompt, a
   * game that exits before the process watcher sees it) or that stopped running
   * are released, so the server never outlives every game.
   */
  isHolderRunning?: (holderKey: string) => boolean;
  launchGraceMs?: number;
  checkIntervalMs?: number;
}

interface RunningServer {
  executablePath: string;
  process: ChildProcess;
}

export class UniverseLanServerManager {
  private running: RunningServer | null = null;
  private readonly holders = new Map<string, number>();
  private watchdog: ReturnType<typeof setInterval> | null = null;

  private readonly spawnServer: SpawnServer;
  private readonly onError: (error: unknown) => void;
  private readonly isHolderRunning?: (holderKey: string) => boolean;
  private readonly launchGraceMs: number;
  private readonly checkIntervalMs: number;

  constructor({
    spawnServer = defaultSpawnServer,
    onError = () => {},
    isHolderRunning,
    launchGraceMs = 3 * 60_000,
    checkIntervalMs = 60_000,
  }: UniverseLanServerManagerOptions = {}) {
    this.spawnServer = spawnServer;
    this.onError = onError;
    this.isHolderRunning = isHolderRunning;
    this.launchGraceMs = launchGraceMs;
    this.checkIntervalMs = checkIntervalMs;
  }

  public get isRunning() {
    return this.running !== null;
  }

  public get runningExecutablePath() {
    return this.running?.executablePath ?? null;
  }

  public get holderKeys() {
    return [...this.holders.keys()];
  }

  /**
   * Keeps the server alive for `holderKey` (a game). UniverseLAN servers are
   * not compatible across SDK versions and all of them use the same port, so a
   * server that another running game depends on is never replaced: in that
   * case this returns false and the new game is not tracked.
   */
  public acquire(holderKey: string, executablePath: string) {
    const isOtherServer =
      this.running !== null && this.running.executablePath !== executablePath;

    if (isOtherServer) {
      const usedByAnotherGame = this.holderKeys.some(
        (key) => key !== holderKey
      );

      if (usedByAnotherGame) return false;

      this.stopProcess();
    }

    this.holders.set(holderKey, Date.now());

    if (!this.running) this.startProcess(executablePath);

    this.startWatchdog();

    return true;
  }

  public release(holderKey: string) {
    if (!this.holders.delete(holderKey)) return;

    if (this.holders.size === 0) {
      this.stopWatchdog();
      this.stopProcess();
    }
  }

  public stopAll() {
    this.holders.clear();
    this.stopWatchdog();
    this.stopProcess();
  }

  /** Releases holders whose game is not running. Exposed for tests. */
  public releaseStaleHolders(now = Date.now()) {
    if (!this.isHolderRunning) return;

    for (const [holderKey, acquiredAt] of this.holders) {
      if (now - acquiredAt < this.launchGraceMs) continue;
      if (this.isHolderRunning(holderKey)) continue;

      this.release(holderKey);
    }
  }

  private startWatchdog() {
    if (this.watchdog || !this.isHolderRunning) return;

    this.watchdog = setInterval(
      () => this.releaseStaleHolders(),
      this.checkIntervalMs
    );
    this.watchdog.unref?.();
  }

  private stopWatchdog() {
    if (!this.watchdog) return;

    clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private startProcess(executablePath: string) {
    try {
      const child = this.spawnServer(
        executablePath,
        path.dirname(executablePath)
      );
      const running = { executablePath, process: child };

      child.once("error", (error) => {
        this.onError(error);
        if (this.running === running) this.running = null;
      });
      child.once("exit", () => {
        if (this.running === running) this.running = null;
      });

      this.running = running;
    } catch (error) {
      this.onError(error);
    }
  }

  private stopProcess() {
    const running = this.running;
    this.running = null;

    if (running?.process.exitCode === null) {
      running.process.kill();
    }
  }
}
