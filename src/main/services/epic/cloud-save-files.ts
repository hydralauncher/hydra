import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { isPathInside } from "./session-attribution.js";
import {
  EpicSaveFailure,
  isEpicSaveFile,
  type EpicSaveMetadata,
} from "./cloud-save-protocol.js";

export interface EpicSaveFile {
  name: string;
  digest: string;
  size: number;
  modifiedAt: number;
}
export interface EpicSaveSnapshot {
  digest: string;
  files: EpicSaveFile[];
}
export function getEpicSaveSnapshotModifiedAt(
  snapshot: EpicSaveSnapshot
): string | null {
  const modifiedAt = snapshot.files.reduce(
    (latest, file) => Math.max(latest, file.modifiedAt),
    Number.NEGATIVE_INFINITY
  );
  return Number.isFinite(modifiedAt)
    ? new Date(modifiedAt).toISOString()
    : null;
}
export class EpicSaveRollbackFailure extends EpicSaveFailure {
  readonly preserveBackup = true;
  constructor() {
    super("save-verification-failed");
  }
}

const fileDigest = async (file: string, signal?: AbortSignal) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal }))
    hash.update(chunk);
  return hash.digest("hex");
};

export async function inspectEpicSaveFiles(
  root: string,
  metadata: EpicSaveMetadata,
  signal?: AbortSignal
): Promise<EpicSaveSnapshot> {
  const files: EpicSaveFile[] = [];
  const rootStat = await fs
    .lstat(root)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink()))
    throw new EpicSaveFailure("invalid-path");
  const realRoot = rootStat ? await fs.realpath(root) : root;
  const walk = async (directory: string) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const filename = path.join(directory, entry.name);
      const relative = path.relative(root, filename).replace(/\\/g, "/");
      if (entry.isSymbolicLink()) throw new EpicSaveFailure("invalid-path");
      if (entry.isDirectory()) {
        await walk(filename);
        continue;
      }
      if (!entry.isFile() || !isEpicSaveFile(relative, metadata)) continue;
      if (!isPathInside(realRoot, await fs.realpath(filename)))
        throw new EpicSaveFailure("invalid-path");
      const before = await fs.stat(filename);
      const digest = await fileDigest(filename, signal);
      const after = await fs.stat(filename);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
        throw new EpicSaveFailure("save-operation-active");
      files.push({
        name: relative,
        digest,
        size: after.size,
        modifiedAt: after.mtimeMs,
      });
    }
  };
  if (rootStat) await walk(root);
  files.sort((left, right) => left.name.localeCompare(right.name, "en"));
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        files.map(({ name, digest, size }) => [name, digest, size])
      )
    )
    .digest("hex");
  return { digest, files };
}

export async function copyEpicSaveSnapshot(
  source: string,
  destination: string,
  snapshot: EpicSaveSnapshot
) {
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  for (const file of snapshot.files) {
    const target = path.resolve(destination, file.name);
    if (!isPathInside(destination, target))
      throw new EpicSaveFailure("invalid-path");
    await fs.mkdir(path.dirname(target), { recursive: true });
    const [realDestination, realParent] = await Promise.all([
      fs.realpath(destination),
      fs.realpath(path.dirname(target)),
    ]);
    if (
      realParent !== realDestination &&
      !isPathInside(realDestination, realParent)
    )
      throw new EpicSaveFailure("invalid-path");
    const existing = await fs
      .lstat(target)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (existing && (!existing.isFile() || existing.isSymbolicLink()))
      throw new EpicSaveFailure("invalid-path");
    await fs.copyFile(path.join(source, file.name), target);
    const timestamp = new Date(file.modifiedAt);
    await fs.utimes(target, timestamp, timestamp);
  }
}

/** Replace only the declared save files; leave other game files untouched and roll back failures. */
export async function applyEpicSaveSnapshot(
  staging: string,
  destination: string,
  backup: string,
  metadata: EpicSaveMetadata,
  expectedLocalDigest: string,
  assertCurrent: () => void
) {
  const previous = await inspectEpicSaveFiles(destination, metadata);
  const incoming = await inspectEpicSaveFiles(staging, metadata);
  if (previous.digest !== expectedLocalDigest)
    throw new EpicSaveFailure("save-conflict");
  if (!incoming.files.length)
    throw new EpicSaveFailure("save-verification-failed");
  await copyEpicSaveSnapshot(destination, backup, previous);
  if ((await inspectEpicSaveFiles(backup, metadata)).digest !== previous.digest)
    throw new EpicSaveFailure("save-verification-failed");
  // Backup copying can take time; reject an edit before replacing any live file.
  if (
    (await inspectEpicSaveFiles(destination, metadata)).digest !==
    expectedLocalDigest
  )
    throw new EpicSaveFailure("save-conflict");
  const remove = async (snapshot: EpicSaveSnapshot) => {
    for (const file of snapshot.files)
      await fs.rm(path.join(destination, file.name), { force: true });
  };
  try {
    assertCurrent();
    await remove(previous);
    await copyEpicSaveSnapshot(staging, destination, incoming);
    assertCurrent();
    const restored = await inspectEpicSaveFiles(destination, metadata);
    if (restored.digest !== incoming.digest)
      throw new EpicSaveFailure("save-verification-failed");
    return restored;
  } catch (error) {
    try {
      await remove(incoming);
      await copyEpicSaveSnapshot(backup, destination, previous);
      if (
        (await inspectEpicSaveFiles(destination, metadata)).digest !==
        previous.digest
      )
        throw new EpicSaveRollbackFailure();
    } catch {
      throw new EpicSaveRollbackFailure();
    }
    throw error;
  }
}
