import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

/** End offsets are exclusive. Only bytes already written belong in this map. */
export type SavedByteRange = [start: number, end: number];

export interface RangeDownloadState {
  version: 1;
  total: number;
  validator: string;
  resourceId: string | null;
  ranges: SavedByteRange[];
}

const MAX_RANGE_STATE_SIZE_BYTES = 1024 * 1024;
let rangeStateDirectory: string | undefined;

export function configureRangeStateDirectory(directory: string): void {
  rangeStateDirectory = path.resolve(directory);
}

export function rangeStatePath(filePath: string): string {
  if (!rangeStateDirectory)
    throw new Error("Range metadata directory is not configured");
  const absolutePath = path.resolve(filePath);
  const identity =
    process.platform === "win32" ? absolutePath.toLowerCase() : absolutePath;
  const key = createHash("sha256").update(identity).digest("hex");
  return path.join(rangeStateDirectory, `${key}.json`);
}

export function rangeResourceId(resourceId?: string): string | null {
  return resourceId
    ? createHash("sha256").update(resourceId).digest("hex")
    : null;
}

export function readRangeState(filePath: string): RangeDownloadState | null {
  const statePath = rangeStatePath(filePath);
  try {
    const stat = fs.lstatSync(statePath);
    if (!stat.isFile() || stat.size > MAX_RANGE_STATE_SIZE_BYTES)
      throw new Error("Invalid byte-range state file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      "The saved byte ranges are invalid. Keeping the partial file."
    );
  }
  try {
    const state: RangeDownloadState = JSON.parse(
      fs.readFileSync(statePath, "utf8")
    );
    const stat = fs.lstatSync(filePath);
    if (
      state.version !== 1 ||
      !Number.isSafeInteger(state.total) ||
      state.total <= 0 ||
      typeof state.validator !== "string" ||
      !state.validator ||
      !(
        state.resourceId === null ||
        (typeof state.resourceId === "string" &&
          /^[a-f0-9]{64}$/.test(state.resourceId))
      ) ||
      !Array.isArray(state.ranges) ||
      !stat.isFile() ||
      stat.size > state.total
    )
      throw new Error("Invalid byte-range state metadata");
    let previousEnd = -1;
    for (const range of state.ranges) {
      if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        !range.every(Number.isSafeInteger) ||
        range[0] < 0 ||
        range[0] <= previousEnd ||
        range[1] <= range[0] ||
        range[1] > state.total ||
        range[1] > stat.size
      )
        throw new Error("Invalid saved byte range");
      previousEnd = range[1];
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      removeRangeState(filePath);
      return null;
    }
    throw new Error(
      "The saved byte ranges are invalid. Keeping the partial file."
    );
  }
}

export function markSavedRange(
  state: RangeDownloadState,
  start: number,
  end: number
): void {
  const ranges = state.ranges;
  let index = 0;
  while (index < ranges.length && ranges[index][1] < start) index++;
  const first = index;
  while (index < ranges.length && ranges[index][0] <= end) {
    start = Math.min(start, ranges[index][0]);
    end = Math.max(end, ranges[index][1]);
    index++;
  }
  ranges.splice(first, index - first, [start, end]);
}

export function missingRanges(state: RangeDownloadState): SavedByteRange[] {
  const missing: SavedByteRange[] = [];
  let next = 0;
  for (const [start, end] of state.ranges) {
    if (start > next) missing.push([next, start]);
    next = end;
  }
  if (next < state.total) missing.push([next, state.total]);
  return missing;
}

export function savedRangeBytes(state: RangeDownloadState): number {
  return state.ranges.reduce((sum, [start, end]) => sum + end - start, 0);
}

export function getRangeDownloadedBytes(filePath: string): number {
  const state = readRangeState(filePath);
  if (state) return savedRangeBytes(state);
  try {
    return fs.statSync(filePath).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export async function saveRangeState(
  filePath: string,
  state: RangeDownloadState
): Promise<void> {
  const target = rangeStatePath(filePath);
  await fs.promises.mkdir(path.dirname(target), {
    recursive: true,
    mode: 0o700,
  });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const file = await fs.promises.open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(state));
      await file.sync();
    } finally {
      await file.close();
    }
    await fs.promises.rename(temporary, target);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
}

export function removeRangeState(filePath: string): void {
  fs.rmSync(rangeStatePath(filePath), { force: true });
}
