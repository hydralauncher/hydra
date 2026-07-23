import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { Game, HydraOverlayPerformance } from "@types";
import { logger } from "./logger";
import { findOverlayGameProcess } from "./overlay-game-process";

const UPDATE_INTERVAL = 500;

export class OverlayFpsMonitor {
  private process: ChildProcessWithoutNullStreams | null = null;
  private lastUpdate = 0;
  private samples: number[] = [];
  private generation = 0;
  private onUpdate: (metrics: HydraOverlayPerformance) => void = () =>
    undefined;

  public setUpdateHandler(handler: (metrics: HydraOverlayPerformance) => void) {
    this.onUpdate = handler;
  }

  public async start(game: Game) {
    this.stop();
    const generation = this.generation;
    if (process.platform !== "win32") return;

    const presentMonPath = app.isPackaged
      ? path.join(process.resourcesPath, "presentmon", "PresentMon.exe")
      : path.join(app.getAppPath(), "presentmon", "PresentMon.exe");
    if (!fs.existsSync(presentMonPath)) {
      logger.warn("PresentMon is unavailable; FPS overlay disabled");
      return;
    }

    const match = await findOverlayGameProcess(game);
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
        "--stop_existing_session",
      ],
      { windowsHide: true }
    );
    this.process = capture;

    let pending = "";
    let displayedFrameTimeIndex = -1;
    capture.stdout.setEncoding("utf8");
    capture.stdout.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";

      for (const line of lines) {
        if (!line) continue;
        const columns = line.split(",");
        if (displayedFrameTimeIndex < 0) {
          displayedFrameTimeIndex = columns.indexOf("MsBetweenDisplayChange");
          continue;
        }

        const frameTime = Number(columns[displayedFrameTimeIndex]);
        if (!Number.isFinite(frameTime) || frameTime < 1) continue;
        this.samples.push(frameTime);
        if (this.samples.length > 120) this.samples.shift();

        const now = Date.now();
        if (now - this.lastUpdate >= UPDATE_INTERVAL) {
          this.lastUpdate = now;
          const recent = this.samples.slice(-30);
          const recentFrameTime =
            recent.reduce((sum, sample) => sum + sample, 0) / recent.length;
          const averageFrameTime =
            this.samples.reduce((sum, sample) => sum + sample, 0) /
            this.samples.length;
          const slowest = [...this.samples]
            .sort((left, right) => right - left)
            .slice(0, Math.max(1, Math.ceil(this.samples.length * 0.01)));
          const slowFrameTime =
            slowest.reduce((sum, sample) => sum + sample, 0) / slowest.length;
          const fps = Math.min(500, Math.round(1000 / recentFrameTime));

          this.onUpdate({
            fps,
            averageFps: Math.min(500, Math.round(1000 / averageFrameTime)),
            onePercentLow: Math.min(500, Math.round(1000 / slowFrameTime)),
            frameTimeMs: Number(recentFrameTime.toFixed(1)),
            updatedAt: now,
          });
        }
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
    if (capture && !capture.killed) capture.kill();
    this.onUpdate(this.emptyMetrics());
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
