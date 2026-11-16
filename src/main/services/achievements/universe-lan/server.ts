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

interface RunningServer {
  executablePath: string;
  process: ChildProcess;
}

export class UniverseLanServerManager {
  private running: RunningServer | null = null;
  private readonly holders = new Set<string>();

  constructor(
    private readonly spawnServer: SpawnServer = defaultSpawnServer,
    private readonly onError: (error: unknown) => void = () => {}
  ) {}

  public get isRunning() {
    return this.running !== null;
  }

  public get runningExecutablePath() {
    return this.running?.executablePath ?? null;
  }

  /**
   * Keeps the server alive for `holderKey` (a game). UniverseLAN servers are
   * not compatible across SDK versions, so asking for another executable
   * replaces the running one.
   */
  public acquire(holderKey: string, executablePath: string) {
    this.holders.add(holderKey);

    if (this.running?.executablePath === executablePath) return;

    this.stopProcess();
    this.startProcess(executablePath);
  }

  public release(holderKey: string) {
    if (!this.holders.delete(holderKey)) return;
    if (this.holders.size === 0) this.stopProcess();
  }

  public stopAll() {
    this.holders.clear();
    this.stopProcess();
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

    if (running && running.process.exitCode === null) {
      running.process.kill();
    }
  }
}
