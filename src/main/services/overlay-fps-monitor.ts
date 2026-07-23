import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { Game, HydraOverlayPerformance } from "@types";
import { logger } from "./logger";
import { getLinuxOverlayMetricsDirectory } from "./linux-overlay-launch";
import { findOverlayGameProcess } from "./overlay-game-process";
import {
  calculateOverlayPerformance,
  parseMangoHudFrameTimes,
  parsePresentMonFrameTime,
  resolvePresentMonFrameTimeColumns,
} from "./overlay-performance-metrics";

const UPDATE_INTERVAL = 500;
const PROCESS_RETRY_INTERVAL = 1_000;
const PROCESS_RESOLVE_TIMEOUT = 45_000;

export class OverlayFpsMonitor {
  private process: ChildProcessWithoutNullStreams | null = null;
  private lastUpdate = 0;
  private samples: number[] = [];
  private generation = 0;
  private linuxPoll: NodeJS.Timeout | null = null;
  private linuxDirectory: string | null = null;
  private linuxFile: string | null = null;
  private linuxOffset = 0;
  private linuxPending = "";
  private onUpdate: (metrics: HydraOverlayPerformance) => void = () =>
    undefined;

  public setUpdateHandler(handler: (metrics: HydraOverlayPerformance) => void) {
    this.onUpdate = handler;
  }

  public async start(game: Game) {
    this.stop();
    const generation = this.generation;
    if (process.platform === "linux") {
      this.startLinux(game, generation);
      return;
    }
    if (process.platform !== "win32") return;

    const presentMonPath = app.isPackaged
      ? path.join(process.resourcesPath, "presentmon", "PresentMon.exe")
      : path.join(app.getAppPath(), "presentmon", "PresentMon.exe");
    if (!fs.existsSync(presentMonPath)) {
      logger.warn("PresentMon is unavailable; FPS overlay disabled");
      return;
    }

    const resolveStartedAt = Date.now();
    let match = await findOverlayGameProcess(game);
    while (
      !match &&
      generation === this.generation &&
      Date.now() - resolveStartedAt < PROCESS_RESOLVE_TIMEOUT
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, PROCESS_RETRY_INTERVAL)
      );
      match = await findOverlayGameProcess(game);
    }
    if (generation !== this.generation) return;

    if (!match) {
      logger.warn("Could not resolve game process for FPS capture", game.title);
      return;
    }

    const capture = spawn(
      presentMonPath,
      [
        "--process_id",
        String(match.pid),
        "--output_stdout",
        "--no_console_stats",
        "--exclude_dropped",
        "--terminate_on_proc_exit",
        "--session_name",
        `HydraOverlay-${match.pid}`,
        "--stop_existing_session",
      ],
      { windowsHide: true }
    );
    this.process = capture;

    let pending = "";
    let frameTimeColumns: ReturnType<
      typeof resolvePresentMonFrameTimeColumns
    > | null = null;
    capture.stdout.setEncoding("utf8");
    capture.stdout.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";

      for (const line of lines) {
        if (!line) continue;
        const columns = line.split(",");
        if (!frameTimeColumns) {
          frameTimeColumns = resolvePresentMonFrameTimeColumns(columns);
          continue;
        }

        const frameTime = parsePresentMonFrameTime(columns, frameTimeColumns);
        if (frameTime === null) continue;
        this.samples.push(frameTime);
        if (this.samples.length > 120) this.samples.shift();
        this.publishSamples();
      }
    });

    capture.stderr.on("data", (message) => {
      const text = String(message).trim();
      if (text) logger.warn("PresentMon", text);
    });
    capture.on("exit", () => {
      if (this.process === capture) {
        this.process = null;
        this.samples = [];
        this.onUpdate(this.emptyMetrics());
      }
    });
  }

  public stop() {
    this.generation += 1;
    const capture = this.process;
    this.process = null;
    this.samples = [];
    this.lastUpdate = 0;
    if (this.linuxPoll) clearInterval(this.linuxPoll);
    this.linuxPoll = null;
    this.linuxDirectory = null;
    this.linuxFile = null;
    this.linuxOffset = 0;
    this.linuxPending = "";
    if (capture && !capture.killed) capture.kill();
    this.onUpdate(this.emptyMetrics());
  }

  private startLinux(game: Game, generation: number) {
    this.linuxDirectory = getLinuxOverlayMetricsDirectory(game);
    if (!this.linuxDirectory) {
      logger.warn(
        "MangoHud was not active when this game launched; Linux FPS capture is unavailable"
      );
      return;
    }

    const poll = () => {
      if (generation !== this.generation) return;
      try {
        this.readLinuxMetrics();
      } catch (error) {
        if (generation !== this.generation) return;
        this.linuxFile = null;
        this.linuxOffset = 0;
        this.linuxPending = "";
        logger.debug("Waiting for MangoHud performance output", error);
      }
    };
    poll();
    this.linuxPoll = setInterval(poll, UPDATE_INTERVAL);
  }

  private readLinuxMetrics() {
    const directory = this.linuxDirectory;
    if (!directory) return;

    if (!this.linuxFile) {
      const files = fs
        .readdirSync(directory, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.endsWith(".csv") &&
            !entry.name.endsWith("_summary.csv")
        )
        .map((entry) => path.join(directory, entry.name))
        .sort(
          (left, right) =>
            fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs
        );
      this.linuxFile = files[0] ?? null;
      if (!this.linuxFile) return;
    }

    const size = fs.statSync(this.linuxFile).size;
    if (size < this.linuxOffset) {
      this.linuxOffset = 0;
      this.linuxPending = "";
    }
    if (size === this.linuxOffset) return;

    const length = size - this.linuxOffset;
    const buffer = Buffer.alloc(length);
    const descriptor = fs.openSync(this.linuxFile, "r");
    try {
      fs.readSync(descriptor, buffer, 0, length, this.linuxOffset);
    } finally {
      fs.closeSync(descriptor);
    }
    this.linuxOffset = size;

    const lines = `${this.linuxPending}${buffer.toString("utf8")}`.split(
      /\r?\n/u
    );
    this.linuxPending = lines.pop() ?? "";
    for (const frameTime of parseMangoHudFrameTimes(lines)) {
      this.samples.push(frameTime);
      if (this.samples.length > 120) this.samples.shift();
    }

    this.publishSamples();
  }

  private publishSamples() {
    if (!this.samples.length) return;
    const now = Date.now();
    if (now - this.lastUpdate < UPDATE_INTERVAL) return;
    this.lastUpdate = now;
    const metrics = calculateOverlayPerformance(this.samples, now);
    if (metrics) this.onUpdate(metrics);
  }

  private emptyMetrics(): HydraOverlayPerformance {
    return {
      fps: null,
      averageFps: null,
      onePercentLow: null,
      frameTimeMs: null,
      updatedAt: Date.now(),
    };
  }
}

export const overlayFpsMonitor = new OverlayFpsMonitor();
