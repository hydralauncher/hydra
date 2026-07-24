import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { Game, HydraOverlayPerformance } from "@types";
import { logger } from "./logger";
import { getLinuxOverlayMetricsDirectory } from "./linux-overlay-launch";
import { getOverlayInputDirectory } from "./overlay-input-broker";
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
const FILTERED_CAPTURE_TIMEOUT = 5_000;

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
  private windowsPoll: NodeJS.Timeout | null = null;
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

    if (this.startBrokerCapture(match.pid, generation)) return;

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

  private startBrokerCapture(pid: number, generation: number) {
    const directory = getOverlayInputDirectory();
    if (!fs.existsSync(path.join(directory, "PresentMon.exe"))) return false;

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
    fs.writeFileSync(path.join(directory, "capture.pid"), String(pid));

    const poll = () => {
      if (generation !== this.generation) return;
      try {
        this.readWindowsMetrics();
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
          fs.writeFileSync(
            path.join(directory, "capture.pid"),
            `${pid} fallback`
          );
        }
      } catch (error) {
        logger.debug("Waiting for PresentMon performance output", error);
      }
    };
    poll();
    this.windowsPoll = setInterval(poll, UPDATE_INTERVAL);
    return true;
  }

  private readWindowsMetrics() {
    const file = this.windowsFile;
    if (!file || !fs.existsSync(file)) return;

    const size = fs.statSync(file).size;
    if (size < this.windowsOffset) this.resetWindowsReadState();
    if (size === this.windowsOffset) return;

    for (const line of this.readWindowsMetricLines(file, size)) {
      this.processWindowsMetricLine(line);
    }
    this.reportWindowsCapture();
    this.publishSamples();
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
    if (this.linuxPoll) clearInterval(this.linuxPoll);
    if (this.windowsPoll) clearInterval(this.windowsPoll);
    this.linuxPoll = null;
    this.linuxDirectory = null;
    this.linuxFile = null;
    this.linuxOffset = 0;
    this.linuxPending = "";
    this.windowsPoll = null;
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
      const request = path.join(getOverlayInputDirectory(), "capture.pid");
      try {
        fs.writeFileSync(request, "0");
      } catch (error) {
        logger.debug("Could not stop the optional PresentMon broker", error);
      }
    }
    this.brokerCapture = false;
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
