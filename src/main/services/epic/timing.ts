import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface EpicTimingDetails {
  queue?: "session" | "workspace";
  command?: "list" | "info" | "install" | "other";
  cache?: "hit" | "miss" | "shared";
  count?: number;
  bytes?: number;
  active?: boolean;
  streaming?: boolean;
  first?: boolean;
}
export interface EpicTimingEntry extends EpicTimingDetails {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  stage: string;
  event: "start" | "end" | "mark";
  atMs?: number;
  durationMs?: number;
  outcome?: "ok" | "error" | "cancelled";
}
const context = new AsyncLocalStorage<{
  traceId: string;
  spanId: string;
}>();
let sink: ((entry: EpicTimingEntry) => void) | undefined;
let sequence = 0;

export function configureEpicTiming(
  write: (entry: EpicTimingEntry) => void,
  enabled = process.env.HYDRA_EPIC_TIMING === "1"
) {
  sink = enabled ? write : undefined;
}

function safeDetails(details: EpicTimingDetails): EpicTimingDetails {
  const result: EpicTimingDetails = {};
  if (["session", "workspace"].includes(details.queue ?? ""))
    result.queue = details.queue;
  if (["list", "info", "install", "other"].includes(details.command ?? ""))
    result.command = details.command;
  if (["hit", "miss", "shared"].includes(details.cache ?? ""))
    result.cache = details.cache;
  for (const key of ["count", "bytes"] as const)
    if (Number.isSafeInteger(details[key]) && Number(details[key]) >= 0)
      result[key] = details[key];
  for (const key of ["active", "streaming", "first"] as const)
    if (typeof details[key] === "boolean") result[key] = details[key];
  return result;
}
function emit(entry: EpicTimingEntry) {
  try {
    sink?.({ ...entry, atMs: Math.round(performance.now() * 100) / 100 });
  } catch {
    // Diagnostic output must never change an operation's result or cleanup.
  }
}

export function startEpicTiming(
  stage: string,
  details: EpicTimingDetails = {}
) {
  const parent = context.getStore();
  const identity = {
    traceId: parent?.traceId ?? randomUUID(),
    spanId: String(++sequence),
    ...(parent ? { parentSpanId: parent.spanId } : {}),
  };
  const started = performance.now();
  let ended = false;
  if (sink)
    emit({ ...safeDetails(details), ...identity, stage, event: "start" });
  return {
    identity,
    end(outcome: EpicTimingEntry["outcome"] = "ok") {
      if (ended || !sink) return;
      ended = true;
      emit({
        ...safeDetails(details),
        ...identity,
        stage,
        event: "end",
        outcome,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      });
    },
    mark(markStage: string, markDetails: EpicTimingDetails = {}) {
      if (sink)
        emit({
          ...safeDetails(markDetails),
          ...identity,
          stage: markStage,
          event: "mark",
          durationMs: Math.round((performance.now() - started) * 100) / 100,
        });
    },
  };
}

export function markEpicTiming(stage: string, details: EpicTimingDetails = {}) {
  if (!sink) return;
  const current = context.getStore();
  if (current)
    emit({ ...safeDetails(details), ...current, stage, event: "mark" });
}

export async function withEpicTiming<T>(
  stage: string,
  task: () => Promise<T>,
  details: EpicTimingDetails = {}
): Promise<T> {
  if (!sink) return task();
  const span = startEpicTiming(stage, details);
  return context.run(span.identity, async () => {
    try {
      const value = await task();
      span.end();
      return value;
    } catch (error) {
      span.end(
        error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "operation-cancelled"
          ? "cancelled"
          : "error"
      );
      throw error;
    }
  });
}
