import fs from "node:fs";

export type UmuOutputEvent =
  | { type: "progress"; message: string }
  | { type: "error"; message: string }
  | { type: "fatal"; message: string };

const ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  "g"
);
const LOG_LINE_PATTERN = /^(INFO|WARNING|ERROR|CRITICAL):\s+(.+)$/;
const EXCEPTION_LINE_PATTERN = /^([A-Z]\w*(?:Error|Exception)):\s+(.+)$/;
const PRESSURE_VESSEL_ERROR_PATTERN = /^pv-[\w-]+\[\d+\]:\s+E:\s+(.+)$/;
const PROGRESS_PREFIXES = [
  "Setting up Unified Launcher",
  "Downloading ",
  "Extracting ",
  "Verifying integrity of ",
  "Updating ",
  "Restoring Runtime Platform",
  "Found '",
];

const cleanProgressMessage = (message: string) =>
  message.replace(/,?\s*please wait\.{0,3}$/i, "").replace(/\.{3}$/, "");

export const parseUmuOutputLine = (rawLine: string): UmuOutputEvent | null => {
  const line = rawLine.replace(ANSI_ESCAPE_PATTERN, "").trim();
  if (!line) return null;

  const pressureVesselError = PRESSURE_VESSEL_ERROR_PATTERN.exec(line);
  if (pressureVesselError) {
    return { type: "fatal", message: pressureVesselError[1] };
  }

  const exception = EXCEPTION_LINE_PATTERN.exec(line);
  if (exception) {
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

  const readNewContent = () => {
    if (reading) return;
    reading = true;
    try {
      const size = getFileSize(filePath);
      if (size <= offset) return;
      const length = size - offset;
      const buffer = Buffer.alloc(length);
      const descriptor = fs.openSync(filePath, "r");
      try {
        const bytesRead = fs.readSync(descriptor, buffer, 0, length, offset);
        offset += bytesRead;
        if (bytesRead > 0) {
          onChunk(buffer.subarray(0, bytesRead).toString("utf8"));
        }
      } finally {
        fs.closeSync(descriptor);
      }
    } catch {
      return;
    } finally {
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
