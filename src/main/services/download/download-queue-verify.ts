import fs from "node:fs";

export const QUEUE_VERIFY_TTL_MS = 600_000;
export const QUEUE_VERIFY_MAX_ENTRIES = 100;

export interface QueueVerifyAttempt {
  at: number;
  sig: string;
}

export const getQueueVerifySig = async (
  targetPath: string
): Promise<string | null> => {
  try {
    const stat = await fs.promises.stat(targetPath);
    if (!stat.isDirectory()) {
      if (stat.size <= 0) return null;
      return `${stat.mtimeMs}:${stat.size}`;
    }
    const entries = await fs.promises.readdir(targetPath);
    if (entries.length === 0) return null;
    return `${stat.mtimeMs}:${entries.length}`;
  } catch {
    return null;
  }
};

export const isVerifyAttemptFresh = (
  prev: QueueVerifyAttempt | undefined,
  sig: string,
  now: number,
  ttl: number = QUEUE_VERIFY_TTL_MS
): boolean => {
  return !!prev && prev.sig === sig && now - prev.at < ttl;
};

export const recordVerifyAttempt = (
  attempts: Map<string, QueueVerifyAttempt>,
  key: string,
  sig: string,
  now: number,
  maxEntries: number = QUEUE_VERIFY_MAX_ENTRIES
): void => {
  attempts.set(key, { at: now, sig });
  if (attempts.size > maxEntries) {
    for (const [entryKey, entry] of attempts) {
      if (now - entry.at >= QUEUE_VERIFY_TTL_MS) {
        attempts.delete(entryKey);
      }
    }
  }
};

export const clearVerifyAttempt = (
  attempts: Map<string, QueueVerifyAttempt>,
  key: string
): void => {
  attempts.delete(key);
};
