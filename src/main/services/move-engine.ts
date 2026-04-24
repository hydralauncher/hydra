import { EventEmitter } from "node:events";

interface ProgressData {
  transferred: number;
  total: number;
  speed: number;
  eta: number;
  progress: number;
}

let MoveEngineNative: any = null;

try {
  MoveEngineNative = require("../../../hydra-native/build/Release/move_engine.node");
  console.log("✅ Native move engine loaded successfully ");
} catch (err) {
  console.warn("Native move engine not available, using fallback");
}

export class GameMover extends EventEmitter {
  private engine: any = null;
  private isNative: boolean = false;

  constructor() {
    super();
    if (MoveEngineNative?.MoveEngine) {
      try {
        this.engine = new MoveEngineNative.MoveEngine();
        this.isNative = true;
        console.log("🚀 Native move engine instance created");
      } catch (err) {
        console.warn("Failed to create native engine:", err);
      }
    }
  }

  async moveFolder(src: string, dest: string): Promise<void> {
    if (this.isNative && this.engine) {
      console.log("🚀 Using NATIVE C++ move engine");
      return this.nativeMove(src, dest);
    }
    console.log("🐢 Using JAVASCRIPT fallback move");
    return this.jsFallbackMove(src, dest);
  }

  private nativeMove(src: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.engine.moveFolder(src, dest, (progress: ProgressData) => {
          this.emit("progress", progress);
          if (progress.progress >= 1.0) {
            resolve();
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private async jsFallbackMove(src: string, dest: string): Promise<void> {
    const fs = await import("node:fs/promises");

    this.emit("progress", {
      transferred: 0, total: 0, speed: 0, eta: 0, progress: 0,
    });

    await fs.cp(src, dest, { recursive: true });
    await fs.rm(src, { recursive: true, force: true });

    this.emit("progress", {
      transferred: 1, total: 1, speed: 0, eta: 0, progress: 1.0,
    });
  }

  cancel(): void {
    this.engine?.cancel();
  }

  destroy(): void {
    this.engine?.cleanup();
    this.removeAllListeners();
  }
}