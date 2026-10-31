import { createHash } from "node:crypto";
import {
  constants,
  createReadStream,
  promises as fs,
  type Stats,
} from "node:fs";
import path from "node:path";

export const hashRetroArchFile = async (filePath: string) => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
};

export const copyRetroArchFileVerified = async (
  source: string,
  target: string
) => {
  if (source === target) return;
  const sourceHash = await hashRetroArchFile(source);
  const targetStat = await fs.lstat(target).catch(() => null);
  if (targetStat) {
    if (
      !targetStat.isFile() ||
      targetStat.isSymbolicLink() ||
      (await hashRetroArchFile(target)) !== sourceHash
    ) {
      throw new Error("cloud_save_retroarch_target_occupied");
    }
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target, constants.COPYFILE_EXCL);
    if ((await hashRetroArchFile(target)) !== sourceHash) {
      await fs.unlink(target).catch(() => undefined);
      throw new Error("cloud_save_retroarch_copy_failed");
    }
  }
};

export const moveRetroArchFileVerified = async (
  source: string,
  target: string
) => {
  if (source === target) return;
  await copyRetroArchFileVerified(source, target);
  if ((await hashRetroArchFile(source)) !== (await hashRetroArchFile(target))) {
    throw new Error("cloud_save_retroarch_source_changed");
  }
  await fs.unlink(source);
};

interface RetroArchBatteryFile {
  path: string;
  hash: string;
}

interface RetroArchBatteryReplacement {
  source: string;
  target: string;
  hash: string;
}

interface RetroArchBatterySwapOptions {
  replacements: RetroArchBatteryReplacement[];
  archiveFiles: RetroArchBatteryFile[];
  activePathsToClear: string[];
  archiveRoot: string;
  commit: () => Promise<void>;
}

const batteryFileStat = async (filePath: string) => {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("cloud_save_retroarch_target_occupied");
    }
    return stat;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

const assertBatteryDirectorySafe = async (directory: string) => {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("cloud_save_retroarch_target_occupied");
  }
};

const assertBatteryFileUnchanged = async (
  file: RetroArchBatteryFile,
  expectedStat: Stats
) => {
  await assertBatteryDirectorySafe(path.dirname(file.path));
  const current = await batteryFileStat(file.path);
  if (
    !current ||
    current.dev !== expectedStat.dev ||
    current.ino !== expectedStat.ino ||
    (await hashRetroArchFile(file.path)) !== file.hash
  ) {
    throw new Error("cloud_save_retroarch_source_changed");
  }
};

export const replaceRetroArchBatteryFilesSafely = async ({
  replacements,
  archiveFiles,
  activePathsToClear,
  archiveRoot,
  commit,
}: RetroArchBatterySwapOptions) => {
  const cleanupFailures: Array<{ path: string; error: unknown }> = [];
  const finalTargets = new Set(replacements.map((file) => file.target));
  const knownFiles = new Map<string, { hash: string; stat: Stats }>();
  for (const file of [
    ...archiveFiles,
    ...replacements.map(({ source, hash }) => ({ path: source, hash })),
  ]) {
    if (!path.isAbsolute(file.path)) {
      throw new Error("cloud_save_retroarch_target_occupied");
    }
    await assertBatteryDirectorySafe(path.dirname(file.path));
    const stat = await batteryFileStat(file.path);
    if (!stat || (await hashRetroArchFile(file.path)) !== file.hash) {
      throw new Error("cloud_save_retroarch_source_changed");
    }
    knownFiles.set(file.path, { hash: file.hash, stat });
  }
  if (
    finalTargets.size !== replacements.length ||
    activePathsToClear.some(
      (filePath) => !archiveFiles.some((file) => file.path === filePath)
    )
  ) {
    throw new Error("cloud_save_retroarch_target_occupied");
  }

  const changes: RetroArchBatteryReplacement[] = [];
  const originals = new Map<string, { hash: string; stat: Stats }>();
  for (const file of replacements) {
    if (!path.isAbsolute(file.target)) {
      throw new Error("cloud_save_retroarch_target_occupied");
    }
    await fs.mkdir(path.dirname(file.target), { recursive: true });
    await assertBatteryDirectorySafe(path.dirname(file.target));
    const stat = await batteryFileStat(file.target);
    const targetHash = stat ? await hashRetroArchFile(file.target) : null;
    if (targetHash === file.hash) continue;
    if (stat) {
      if (knownFiles.get(file.target)?.hash !== targetHash) {
        throw new Error("cloud_save_retroarch_target_occupied");
      }
      originals.set(file.target, { hash: targetHash!, stat });
    }
    changes.push(file);
  }
  for (const filePath of activePathsToClear) {
    if (
      finalTargets.has(filePath) &&
      !changes.some((file) => file.target === filePath)
    ) {
      continue;
    }
    originals.set(filePath, knownFiles.get(filePath)!);
  }
  if (changes.length === 0 && archiveFiles.length === 0) {
    await commit();
    return { cleanupFailures };
  }

  if (!path.isAbsolute(archiveRoot)) {
    throw new Error("cloud_save_retroarch_archive_unavailable");
  }
  await fs.mkdir(archiveRoot, { recursive: true });
  await assertBatteryDirectorySafe(archiveRoot);
  const operationRoot = await fs.mkdtemp(
    path.join(archiveRoot, "battery-swap-")
  );
  const stagingRoot = path.join(operationRoot, "staging");
  const backupRoot = path.join(operationRoot, "backup");
  const stagedFiles = new Map<string, string>();
  const backups = new Map<string, string>();
  const createdFiles: Array<{
    path: string;
    stat: Stats;
    hash: string;
    complete: boolean;
  }> = [];

  const cleanupStaging = async () => {
    const cleanupPath = backups.size ? stagingRoot : operationRoot;
    await fs
      .rm(cleanupPath, { recursive: true, force: true })
      .catch((error) => {
        cleanupFailures.push({ path: cleanupPath, error });
      });
  };

  try {
    await fs.mkdir(stagingRoot);
    for (const [index, file] of changes.entries()) {
      const stagedPath = path.join(
        stagingRoot,
        `${index}-${path.basename(file.source)}`
      );
      await copyRetroArchFileVerified(file.source, stagedPath);
      if ((await hashRetroArchFile(stagedPath)) !== file.hash) {
        throw new Error("cloud_save_retroarch_source_changed");
      }
      stagedFiles.set(file.target, stagedPath);
    }
    const filesToBackUp = new Map([
      ...archiveFiles.map(
        (file) => [file.path, knownFiles.get(file.path)!] as const
      ),
      ...originals,
    ]);
    await fs.mkdir(backupRoot);
    for (const [index, [filePath, original]] of [...filesToBackUp].entries()) {
      const backupPath = path.join(
        backupRoot,
        `${index}-${path.basename(filePath)}`
      );
      await assertBatteryFileUnchanged(
        { path: filePath, hash: original.hash },
        original.stat
      );
      await copyRetroArchFileVerified(filePath, backupPath);
      if ((await hashRetroArchFile(backupPath)) !== original.hash) {
        throw new Error("cloud_save_retroarch_source_changed");
      }
      await fs.utimes(backupPath, original.stat.atime, original.stat.mtime);
      backups.set(filePath, backupPath);
    }
    await fs.writeFile(
      path.join(operationRoot, "manifest.json"),
      JSON.stringify({
        version: 1,
        replacements,
        backups: [...backups].map(([originalPath, backupPath]) => ({
          originalPath,
          backupPath,
        })),
      }),
      { flag: "wx" }
    );
    for (const [filePath, original] of knownFiles) {
      await assertBatteryFileUnchanged(
        { path: filePath, hash: original.hash },
        original.stat
      );
    }
    for (const [filePath, original] of originals) {
      await assertBatteryFileUnchanged(
        { path: filePath, hash: original.hash },
        original.stat
      );
      await fs.unlink(filePath);
    }
    for (const file of changes) {
      await assertBatteryDirectorySafe(path.dirname(file.target));
      const sourceStat = knownFiles.get(file.source)!.stat;
      const handle = await fs.open(file.target, "wx", sourceStat.mode);
      try {
        const created = {
          path: file.target,
          stat: await handle.stat(),
          hash: file.hash,
          complete: false,
        };
        createdFiles.push(created);
        for await (const chunk of createReadStream(
          stagedFiles.get(file.target)!
        )) {
          await handle.writeFile(chunk);
        }
        await handle.utimes(sourceStat.atime, sourceStat.mtime);
        await handle.sync();
        if ((await hashRetroArchFile(file.target)) !== file.hash) {
          throw new Error("cloud_save_retroarch_copy_failed");
        }
        created.complete = true;
      } finally {
        await handle.close();
      }
    }
    await commit();
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const created of [...createdFiles].reverse()) {
      try {
        const current = await batteryFileStat(created.path);
        if (!current) continue;
        if (
          current.dev !== created.stat.dev ||
          current.ino !== created.stat.ino ||
          (created.complete &&
            (await hashRetroArchFile(created.path)) !== created.hash)
        ) {
          throw new Error("cloud_save_retroarch_source_changed");
        }
        await fs.unlink(created.path);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const [filePath, original] of originals) {
      try {
        const current = await batteryFileStat(filePath);
        if (current) {
          await assertBatteryFileUnchanged(
            { path: filePath, hash: original.hash },
            original.stat
          );
          continue;
        }
        await assertBatteryDirectorySafe(path.dirname(filePath));
        await copyRetroArchFileVerified(backups.get(filePath)!, filePath);
        await fs.utimes(filePath, original.stat.atime, original.stat.mtime);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "cloud_save_retroarch_battery_rollback_failed"
      );
    }
    await cleanupStaging();
    throw error;
  }

  for (const [filePath, original] of knownFiles) {
    if (finalTargets.has(filePath) || activePathsToClear.includes(filePath))
      continue;
    try {
      const current = await batteryFileStat(filePath);
      if (!current) continue;
      await assertBatteryFileUnchanged(
        { path: filePath, hash: original.hash },
        original.stat
      );
      await fs.unlink(filePath);
    } catch (error) {
      cleanupFailures.push({ path: filePath, error });
    }
  }
  await cleanupStaging();
  return { cleanupFailures };
};
