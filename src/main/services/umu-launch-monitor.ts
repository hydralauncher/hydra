import type { ChildProcess } from "node:child_process";

import {
  UmuOutputMonitor,
  getFileSize,
  getUmuSetupFailureMessage,
  tailUmuLog,
  type UmuOutputEvent,
} from "./umu-output-monitor.js";

export type UmuStatus =
  | { type: "progress"; message: string | null }
  | { type: "ready" }
  | { type: "failed"; message: string };

export type UmuStatusListener = (status: UmuStatus) => void;

export interface UmuLateFailure {
  code: number | null;
  signal: NodeJS.Signals | null;
  gameDetected: boolean;
  message: string;
}

export class UmuEarlyExitError extends Error {
  constructor(
    public readonly code: number | null,
    public readonly signal: NodeJS.Signals | null,
    failureMessage: string | null
  ) {
    super(
      `umu-run exited early with code=${code ?? "null"} signal=${signal ?? "null"}${
        failureMessage ? `: ${failureMessage}` : ""
      }`
    );
    this.name = "UmuEarlyExitError";
  }
}

export const watchUmuSetup = (
  umuLogPath: string | null,
  onStatus?: UmuStatusListener,
  logStartOffset = umuLogPath ? getFileSize(umuLogPath) : 0
) => {
  const monitor = new UmuOutputMonitor();
  let preparing = true;
  onStatus?.({ type: "progress", message: null });

  const handleEvents = (events: UmuOutputEvent[]) => {
    for (const event of events) {
      if (event.type !== "progress") continue;
      preparing = true;
      onStatus?.({ type: "progress", message: event.message });
    }
  };

  const stopTail = umuLogPath
    ? tailUmuLog(umuLogPath, logStartOffset, (chunk) =>
        handleEvents(monitor.feed(chunk))
      )
    : null;

  return {
    complete: () => {
      stopTail?.();
      handleEvents(monitor.flush());
      return {
        failureMessage: monitor.failureMessage,
        hasFatalError: monitor.hasFatalError,
      };
    },
    markReady: () => {
      if (!preparing) return;
      preparing = false;
      onStatus?.({ type: "ready" });
    },
  };
};

export const observeUmuLaunch = ({
  child,
  umuLogPath,
  logStartOffset,
  quickExitThresholdMs,
  onStatus,
  wasGameDetected,
  onLateFailure,
}: {
  child: ChildProcess;
  umuLogPath: string | null;
  logStartOffset?: number;
  quickExitThresholdMs: number;
  onStatus?: UmuStatusListener;
  wasGameDetected?: () => boolean;
  onLateFailure?: (failure: UmuLateFailure) => void;
}) =>
  new Promise<void>((resolve, reject) => {
    const setupWatcher = watchUmuSetup(umuLogPath, onStatus, logStartOffset);
    let settled = false;
    let quickExitTimer: NodeJS.Timeout | null = null;

    const clearQuickExitTimer = () => {
      if (quickExitTimer) clearTimeout(quickExitTimer);
      quickExitTimer = null;
    };

    child.once("spawn", () => {
      quickExitTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve();
      }, quickExitThresholdMs);
    });

    child.once("exit", (code, signal) => {
      clearQuickExitTimer();
      const setup = setupWatcher.complete();

      if (!settled) {
        settled = true;
        reject(new UmuEarlyExitError(code, signal, setup.failureMessage));
        return;
      }

      const gameDetected = wasGameDetected?.() ?? false;
      const message = getUmuSetupFailureMessage({
        exitCode: code,
        signal,
        failureMessage: setup.failureMessage,
        hasFatalError: setup.hasFatalError,
        gameDetected,
      });

      if (message) {
        onLateFailure?.({ code, signal, gameDetected, message });
        onStatus?.({ type: "failed", message });
        return;
      }

      setupWatcher.markReady();
    });

    child.once("error", (error) => {
      clearQuickExitTimer();
      setupWatcher.complete();
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
