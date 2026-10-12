import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";

export type UmuOutputEvent =
  | { type: "progress"; message: string }
  | { type: "error"; message: string }
  | { type: "fatal"; message: string };

const ANSI_ESCAPE_PATTERN = new RegExp(
  String.raw`${String.fromCodePoint(27)}\[[0-9;]*m`,
  "g"
);
const LOG_LINE_PATTERN = /^(INFO|WARNING|ERROR|CRITICAL):\s*(\S.*)$/;
const EXCEPTION_LINE_PATTERN = /^([A-Z]\w*):\s*(\S.*)$/;
const EXCEPTION_NAME_SUFFIXES = ["Error", "Exception"];
const PRESSURE_VESSEL_ERROR_PATTERN = /^pv-[\w-]+\[\d+\]:\s+E:\s*(\S.*)$/;
const PROGRESS_WAIT_SUFFIX = "please wait";
const PROGRESS_PREFIXES = [
  "Setting up Unified Launcher",
  "Downloading ",
  "Extracting ",
  "Verifying integrity of ",
  "Updating ",
  "Restoring Runtime Platform",
  "Found '",
];

const cleanProgressMessage = (message: string) => {
  let cleaned = message;
  while (cleaned.endsWith(".")) cleaned = cleaned.slice(0, -1);
  if (cleaned.toLowerCase().endsWith(PROGRESS_WAIT_SUFFIX)) {
    cleaned = cleaned.slice(0, -PROGRESS_WAIT_SUFFIX.length).trimEnd();
    if (cleaned.endsWith(",")) cleaned = cleaned.slice(0, -1);
  }
  return cleaned.trimEnd();
};

export const parseUmuOutputLine = (rawLine: string): UmuOutputEvent | null => {
  const line = rawLine.replace(ANSI_ESCAPE_PATTERN, "").trim();
  if (!line) return null;

  const pressureVesselError = PRESSURE_VESSEL_ERROR_PATTERN.exec(line);
  if (pressureVesselError) {
    return { type: "fatal", message: pressureVesselError[1] };
  }

  const exception = EXCEPTION_LINE_PATTERN.exec(line);
  if (
    exception &&
    EXCEPTION_NAME_SUFFIXES.some((suffix) => exception[1].endsWith(suffix))
  ) {
    return { type: "fatal", message: `${exception[1]}: ${exception[2]}` };
  }

  const logLine = LOG_LINE_PATTERN.exec(line);
  if (!logLine) return null;

  const [, level, message] = logLine;
  if (level === "ERROR" || level === "CRITICAL") {
    return { type: "error", message };
  }
  if (
    level === "INFO" &&
    PROGRESS_PREFIXES.some((prefix) => message.startsWith(prefix))
  ) {
    return { type: "progress", message: cleanProgressMessage(message) };
  }

  return null;
};

export const getUmuSetupFailureMessage = ({
  exitCode,
  signal,
  failureMessage,
  hasFatalError,
  gameDetected,
}: {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  failureMessage: string | null;
  hasFatalError: boolean;
  gameDetected: boolean;
}): string | null => {
  if (gameDetected) {
    return exitCode !== 0 && hasFatalError ? failureMessage : null;
  }
  if (hasFatalError && failureMessage) return failureMessage;
  if (exitCode === 0) return null;
  if (failureMessage) return failureMessage;
  return signal
    ? `umu-run was terminated by ${signal}`
    : `umu-run exited with code ${exitCode ?? "null"}`;
};

export class UmuOutputMonitor {
  private buffer = "";
  private lastErrorMessage: string | null = null;
  private fatalErrorMessage: string | null = null;

  public feed(chunk: string): UmuOutputEvent[] {
    const lines = (this.buffer + chunk).split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    return this.parseLines(lines);
  }

  public flush(): UmuOutputEvent[] {
    const remaining = this.buffer;
    this.buffer = "";
    return this.parseLines([remaining]);
  }

  public get failureMessage(): string | null {
    return this.fatalErrorMessage ?? this.lastErrorMessage;
  }

  public get hasFatalError(): boolean {
    return this.fatalErrorMessage !== null;
  }

  private parseLines(lines: string[]): UmuOutputEvent[] {
    const events: UmuOutputEvent[] = [];
    for (const line of lines) {
      const event = parseUmuOutputLine(line);
      if (!event) continue;
      if (event.type === "error") this.lastErrorMessage = event.message;
      if (event.type === "fatal") this.fatalErrorMessage = event.message;
      events.push(event);
    }
    return events;
  }
}

const UMU_LOG_POLL_INTERVAL_MS = 500;
const UMU_LOG_MAX_READ_BYTES = 256 * 1024;

export const getFileSize = (filePath: string) => {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
};

export const tailUmuLog = (
  filePath: string,
  startOffset: number,
  onChunk: (chunk: string) => void
) => {
  let offset = startOffset;
  let reading = false;
  let stopped = false;
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.alloc(UMU_LOG_MAX_READ_BYTES);

  const readNewContent = () => {
    if (reading) return;
    reading = true;
    let descriptor: number | null = null;
    try {
      while (getFileSize(filePath) > offset) {
        descriptor ??= fs.openSync(filePath, "r");
        const bytesRead = fs.readSync(
          descriptor,
          buffer,
          0,
          UMU_LOG_MAX_READ_BYTES,
          offset
        );
        if (bytesRead <= 0) break;
        offset += bytesRead;
        onChunk(decoder.write(buffer.subarray(0, bytesRead)));
      }
    } catch {
      return;
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
      reading = false;
    }
  };

  const interval = setInterval(readNewContent, UMU_LOG_POLL_INTERVAL_MS);
  interval.unref?.();

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    readNewContent();
  };
};
