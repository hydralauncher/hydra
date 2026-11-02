import fs from "node:fs/promises";
import path from "node:path";
import { EpicSaveFailure } from "./cloud-save-protocol.js";
import type { EpicLaunchParameters } from "./launch-protocol.js";

export interface EpicOwnershipToken {
  translate(parameters: EpicLaunchParameters): Promise<EpicLaunchParameters>;
  dispose(): Promise<void>;
}

function ownershipTokenBasename(objectId: string) {
  const parts = objectId.split(":");
  if (
    parts.length !== 2 ||
    parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part))
  )
    throw new EpicSaveFailure("invalid-path");
  return `${parts[0]}${parts[1]}.ovt`;
}

/** Caller must hold an idle-prefix mutation lease. Never sweeps the directory. */
export async function disposeEpicOwnershipTokenIfStopped(
  workspace: string,
  objectId: string
) {
  const basename = ownershipTokenBasename(objectId);
  const directory = path.join(await fs.realpath(workspace), "tmp");
  const directoryStat = await fs
    .lstat(directory)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  if (!directoryStat) return false;
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    path.relative(directory, await fs.realpath(directory)) !== ""
  )
    throw new EpicSaveFailure("invalid-path");
  const token = path.join(directory, basename);
  const info = await fs.lstat(token).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return false;
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new EpicSaveFailure("invalid-path");
  await fs.unlink(token);
  return true;
}

/** Reserve the deterministic Legendary token before its open('wb') call. */
export async function prepareEpicOwnershipToken(
  workspace: string,
  objectId: string,
  required: boolean,
  mapDirectory: (directory: string) => Promise<string>
): Promise<EpicOwnershipToken> {
  const directory = path.join(await fs.realpath(workspace), "tmp");
  const basename = ownershipTokenBasename(objectId);
  const token = path.join(directory, basename);
  let windowsDirectory: string | null = null;
  if (required) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.getuid && stat.uid !== process.getuid()) ||
      path.relative(directory, await fs.realpath(directory)) !== ""
    )
      throw new EpicSaveFailure("invalid-path");
    await fs.chmod(directory, 0o700);
    const previous = await fs
      .lstat(token)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (previous) {
      if (
        !previous.isFile() ||
        previous.isSymbolicLink() ||
        previous.nlink !== 1
      )
        throw new EpicSaveFailure("invalid-path");
      await fs.unlink(token);
    }
    windowsDirectory = await mapDirectory(directory);
  }
  return {
    async translate(parameters) {
      const indexes = parameters.args.flatMap((arg, index) =>
        /^-epicovt=/i.test(arg) ? [index] : []
      );
      if (indexes.length !== (required ? 1 : 0))
        throw new EpicSaveFailure("invalid-response");
      if (!required) return parameters;
      const index = indexes[0];
      const actual = parameters.args[index].slice(
        parameters.args[index].indexOf("=") + 1
      );
      if (path.relative(token, actual) !== "" || !path.isAbsolute(actual))
        throw new EpicSaveFailure("invalid-path");
      const stat = await fs.lstat(token);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        (process.getuid && stat.uid !== process.getuid()) ||
        path.relative(token, await fs.realpath(token)) !== ""
      )
        throw new EpicSaveFailure("invalid-path");
      await fs.chmod(token, 0o600);
      const args = [...parameters.args];
      args[index] = `-epicovt=${path.win32.join(windowsDirectory!, basename)}`;
      return { ...parameters, args };
    },
    async dispose() {
      if (required) await fs.rm(token, { force: true });
    },
  };
}
