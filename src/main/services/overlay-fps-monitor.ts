import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { Game, HydraOverlayPerformance } from "@types";
import { logger } from "./logger";
import {
  getOverlayInputBrokerDirectory,
  getOverlayInputDirectory,
  requestElevatedPerformanceCapture,
} from "./overlay-input-broker";
import { findOverlayGameProcess } from "./overlay-game-process";
import {
  calculateOverlayPerformance,
  parsePresentMonFrameTime,
  resolvePresentMonFrameTimeColumns,
} from "./overlay-performance-metrics";

const UPDATE_INTERVAL = 500;
const PROCESS_RETRY_INTERVAL = 1_000;
const PROCESS_RESOLVE_TIMEOUT = 45_000;
const FILTERED_CAPTURE_TIMEOUT = 5_000;
const MAX_CAPTURE_FILE_BYTES = 16 * 1024 * 1024;

export class OverlayFpsMonitor {
  private process: ChildProcessWithoutNullStreams | null = null;
  private lastUpdate = 0;
  private samples: number[] = [];
  private generation = 0;
  private windowsPoll: NodeJS.Timeout | null = null;
  private windowsPollPending = false;
  private windowsFile: string | null = null;
  private windowsOffset = 0;
  private windowsPending = "";
  private windowsFrameTimeColumns: ReturnType<
    typeof resolvePresentMonFrameTimeColumns
  > | null = null;
  private brokerCapture = false;
  private reportedCapture = false;
  private windowsTargetPid = 0;
  private windowsCaptureStartedAt = 0;
  private windowsLastFrameAt = 0;
  private windowsFallbackCapture = false;
  private onUpdate: (metrics: HydraOverlayPerformance) => void = () =>
    undefined;

  public setUpdateHandler(handler: (metrics: HydraOverlayPerformance) => void) {
    this.onUpdate = handler;
  }

  public async start(game: Game, brokerAvailable = false) {
    this.stop();
    const generation = this.generation;
    if (process.platform !== "win32") return;

    const presentMonPath = path.join(
      app.isPackaged ? process.resourcesPath : app.getAppPath(),
      app.isPackaged ? "hydra-native" : "presentmon",
      "PresentMon.exe"
    );
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

    if (
      brokerAvailable &&
      (await this.startBrokerCapture(match.pid, generation))
    ) {
      return;
    }

    const capture = spawn(
      presentMonPath,
      [
        "--process_id",
        String(match.pid),
        "--output_stdout",
        "--no_console_stats",
        "--no_track_display",
        "--no_track_gpu",
        "--no_track_input",
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
          const resolved = resolvePresentMonFrameTimeColumns(columns);
          if (resolved.displayChange < 0 && resolved.presents < 0) continue;
          frameTimeColumns = resolved;
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

  private async startBrokerCapture(pid: number, generation: number) {
    const directory = getOverlayInputDirectory();
    if (
      !fs.existsSync(
        path.join(getOverlayInputBrokerDirectory(), "PresentMon.exe")
      )
    ) {
      return false;
    }
    fs.mkdirSync(directory, { recursive: true });

    if (!(await requestElevatedPerformanceCapture(pid))) return false;
    if (generation !== this.generation) {
      await requestElevatedPerformanceCapture(0);
      return false;
    }

    this.brokerCapture = true;
    this.windowsFile = path.join(directory, "performance.csv");
    this.windowsOffset = 0;
    this.windowsPending = "";
    this.windowsFrameTimeColumns = null;
    this.reportedCapture = false;
    this.windowsTargetPid = pid;
    this.windowsCaptureStartedAt = Date.now();
    this.windowsLastFrameAt = 0;
    this.windowsFallbackCapture = false;
    const poll = async () => {
      if (generation !== this.generation) return;
      try {
        const captureSize = this.readWindowsMetrics();
        if (captureSize >= MAX_CAPTURE_FILE_BYTES) {
          await this.restartBrokerCapture(pid, generation);
          return;
        }
        if (
          !this.windowsFallbackCapture &&
          Date.now() - this.windowsCaptureStartedAt >=
            FILTERED_CAPTURE_TIMEOUT &&
          (!this.windowsLastFrameAt ||
            Date.now() - this.windowsLastFrameAt >= FILTERED_CAPTURE_TIMEOUT)
        ) {
          this.windowsFallbackCapture = true;
          this.samples = [];
          this.lastUpdate = 0;
          this.windowsOffset = 0;
          this.windowsPending = "";
          this.windowsFrameTimeColumns = null;
          this.reportedCapture = false;
          const fallbackStarted = await requestElevatedPerformanceCapture(
            pid,
            true
          );
          if (fallbackStarted && generation !== this.generation) {
            await requestElevatedPerformanceCapture(0);
          }
        } else if (
          this.windowsFallbackCapture &&
          Date.now() - this.windowsCaptureStartedAt >=
            FILTERED_CAPTURE_TIMEOUT &&
          (!this.windowsLastFrameAt ||
            Date.now() - this.windowsLastFrameAt >= FILTERED_CAPTURE_TIMEOUT)
        ) {
          await this.restartBrokerCapture(pid, generation);
        }
      } catch (error) {
        logger.debug("Waiting for PresentMon performance output", error);
      }
    };
    const schedulePoll = () => {
      if (this.windowsPollPending) return;
      this.windowsPollPending = true;
      void poll().finally(() => {
        this.windowsPollPending = false;
      });
    };
    schedulePoll();
    this.windowsPoll = setInterval(schedulePoll, UPDATE_INTERVAL);
    return true;
  }

  private async restartBrokerCapture(pid: number, generation: number) {
    this.windowsCaptureStartedAt = Date.now();
    const restarted = await requestElevatedPerformanceCapture(
      pid,
      this.windowsFallbackCapture,
      true
    );
    if (restarted && generation === this.generation) {
      this.resetWindowsReadState();
      this.windowsLastFrameAt = 0;
    } else if (restarted) {
      await requestElevatedPerformanceCapture(0);
    }
  }

  private readWindowsMetrics() {
    const file = this.windowsFile;
    if (!file || !fs.existsSync(file)) return 0;

    const size = fs.statSync(file).size;
    if (size >= MAX_CAPTURE_FILE_BYTES) return size;
    if (size < this.windowsOffset) this.resetWindowsReadState();
    if (size === this.windowsOffset) return size;

    for (const line of this.readWindowsMetricLines(file, size)) {
      this.processWindowsMetricLine(line);
    }
    this.reportWindowsCapture();
    this.publishSamples();
    return size;
  }

  private resetWindowsReadState() {
    this.samples = [];
    this.lastUpdate = 0;
    this.windowsOffset = 0;
    this.windowsPending = "";
    this.windowsFrameTimeColumns = null;
    this.reportedCapture = false;
  }

  private readWindowsMetricLines(file: string, size: number) {
    const length = size - this.windowsOffset;
    const buffer = Buffer.alloc(length);
    const descriptor = fs.openSync(file, "r");
    try {
      fs.readSync(descriptor, buffer, 0, length, this.windowsOffset);
    } finally {
      fs.closeSync(descriptor);
    }
    this.windowsOffset = size;

    const lines = `${this.windowsPending}${buffer.toString("utf8")}`.split(
      /\r?\n/u
    );
    this.windowsPending = lines.pop() ?? "";
    return lines.filter(Boolean);
  }

  private processWindowsMetricLine(line: string) {
    const columns = line.split(",");
    if (!this.windowsFrameTimeColumns) {
      const resolved = resolvePresentMonFrameTimeColumns(columns);
      if (resolved.displayChange >= 0 || resolved.presents >= 0) {
        this.windowsFrameTimeColumns = resolved;
      }
      return;
    }

    const processIdIndex = this.windowsFrameTimeColumns.processId;
    const belongsToTarget =
      processIdIndex < 0 ||
      Number(columns[processIdIndex]) === this.windowsTargetPid;
    if (!belongsToTarget) return;

    const frameTime = parsePresentMonFrameTime(
      columns,
      this.windowsFrameTimeColumns
    );
    if (frameTime === null) return;
    this.samples.push(frameTime);
    this.windowsLastFrameAt = Date.now();
    if (this.samples.length > 120) this.samples.shift();
  }

  private reportWindowsCapture() {
    if (!this.samples.length || this.reportedCapture) return;
    this.reportedCapture = true;
    logger.info(
      this.windowsFallbackCapture
        ? "Windows Graphics Capture FPS fallback is reporting frames"
        : "PresentMon performance capture is reporting frames"
    );
  }

  public stop() {
    this.generation += 1;
    const capture = this.process;
    this.process = null;
    this.samples = [];
    this.lastUpdate = 0;
    if (this.windowsPoll) clearInterval(this.windowsPoll);
    this.windowsPoll = null;
    this.windowsPollPending = false;
    this.windowsFile = null;
    this.windowsOffset = 0;
    this.windowsPending = "";
    this.windowsFrameTimeColumns = null;
    this.reportedCapture = false;
    this.windowsTargetPid = 0;
    this.windowsCaptureStartedAt = 0;
    this.windowsLastFrameAt = 0;
    this.windowsFallbackCapture = false;
    if (this.brokerCapture && process.platform === "win32") {
      void requestElevatedPerformanceCapture(0).catch((error) =>
        logger.debug("Could not stop the optional PresentMon broker", error)
      );
    }
    this.brokerCapture = false;
    if (capture && !capture.killed) capture.kill();
    this.onUpdate(this.emptyMetrics());
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
