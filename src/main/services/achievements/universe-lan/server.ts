import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/**
 * UniverseLAN only finishes the Galaxy sign-in (and therefore only lets games
 * report achievements) after its server accepted the client, even for single
 * player games. Hydra runs one hidden server while at least one game that uses
 * UniverseLAN is open.
 */

type SpawnServer = (executablePath: string, cwd: string) => ChildProcess;

/** How long a game may take to show up as running after it was launched. */
export const DEFAULT_LAUNCH_GRACE_IN_MS = 3 * 60_000;
/** How often holders are checked for games that are no longer running. */
export const DEFAULT_HOLDER_CHECK_INTERVAL_IN_MS = 60_000;

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
   * Whether the game holding the server is running. It should err on the side
   * of `true`: a holder is only released once this returns false after the
   * launch grace period (failed launch, cancelled UAC prompt) or after the game
   * was seen running, so the server never outlives every game.
   */
  isHolderRunning?: (holderKey: string) => boolean | Promise<boolean>;
  launchGraceMs?: number;
  checkIntervalMs?: number;
}

interface RunningServer {
  executablePath: string;
  process: ChildProcess;
}

interface Holder {
  acquiredAt: number;
  seenRunning: boolean;
}

export class UniverseLanServerManager {
  private running: RunningServer | null = null;
  private readonly holders = new Map<string, Holder>();
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private isCheckingHolders = false;

  private readonly spawnServer: SpawnServer;
  private readonly onError: (error: unknown) => void;
  private readonly isHolderRunning?: (
    holderKey: string
  ) => boolean | Promise<boolean>;
  private readonly launchGraceMs: number;
  private readonly checkIntervalMs: number;

  constructor({
    spawnServer = defaultSpawnServer,
    onError = () => {},
    isHolderRunning,
    launchGraceMs = DEFAULT_LAUNCH_GRACE_IN_MS,
    checkIntervalMs = DEFAULT_HOLDER_CHECK_INTERVAL_IN_MS,
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

    this.holders.set(holderKey, { acquiredAt: Date.now(), seenRunning: false });

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
  public async releaseStaleHolders(now = Date.now()) {
    if (!this.isHolderRunning || this.isCheckingHolders) return;

    this.isCheckingHolders = true;

    const isHolderRunning = this.isHolderRunning;

    try {
      const checks = await Promise.all(
        Array.from(this.holders, async ([holderKey, holder]) => ({
          holderKey,
          holder,
          isRunning: await Promise.resolve(isHolderRunning(holderKey)).catch(
            () => true
          ),
        }))
      );

      for (const { holderKey, holder, isRunning } of checks) {
        // The holder may have been released or re-acquired meanwhile.
        if (this.holders.get(holderKey) !== holder) continue;

        if (isRunning) {
          holder.seenRunning = true;
          continue;
        }

        const isWithinLaunchGrace =
          now - holder.acquiredAt < this.launchGraceMs;

        if (!holder.seenRunning && isWithinLaunchGrace) continue;

        this.release(holderKey);
      }
    } finally {
      this.isCheckingHolders = false;
    }
  }

  private startWatchdog() {
    if (this.watchdog || !this.isHolderRunning) return;

    this.watchdog = setInterval(() => {
      this.releaseStaleHolders().catch(this.onError);
    }, this.checkIntervalMs);
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
