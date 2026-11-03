import fs from "node:fs";
import path from "node:path";

import type { RecompilationRef } from "@types";
import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";
import { SystemPath } from "@main/services/system-path";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const OBJECT_ID_PATTERN = /^\d{1,20}$/;
const INSTALL_DIRECTORIES_FILE = "recompilation-installs.json";

export const parseRecompilationRef = (
  ref: unknown
): RecompilationRef | null => {
  if (!ref || typeof ref !== "object") return null;
  const { objectId, slug } = ref as Record<string, unknown>;
  if (typeof objectId !== "string" || !OBJECT_ID_PATTERN.test(objectId)) {
    return null;
  }
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) return null;
  return { objectId, slug };
};

const getInstallDirectoriesFilePath = () =>
  path.join(SystemPath.getPath("userData"), INSTALL_DIRECTORIES_FILE);

const readInstallDirectories = async (): Promise<Record<string, string>> => {
  try {
    const parsed: unknown = JSON.parse(
      await fs.promises.readFile(getInstallDirectoriesFilePath(), "utf-8")
    );
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([slug, directory]) =>
          SLUG_PATTERN.test(slug) &&
          typeof directory === "string" &&
          path.isAbsolute(directory)
      )
    );
  } catch {
    return {};
  }
};

const writeInstallDirectories = (directories: Record<string, string>) =>
  fs.promises.writeFile(
    getInstallDirectoriesFilePath(),
    JSON.stringify(directories, null, 2)
  );

export const getRecompilationInstallDirectory = async (slug: string) => {
  const directories = await readInstallDirectories();
  return (
    directories[slug] ??
    path.join(await getDownloadsPath(), "recompilations", slug)
  );
};

export const saveRecompilationInstallDirectory = async (
  slug: string,
  directory: string
) => {
  const directories = await readInstallDirectories();
  if (directories[slug] === directory) return;
  await writeInstallDirectories({ ...directories, [slug]: directory });
};

export const forgetRecompilationInstallDirectory = async (slug: string) => {
  const directories = await readInstallDirectories();
  if (!Object.hasOwn(directories, slug)) return;
  const { [slug]: _removed, ...rest } = directories;
  await writeInstallDirectories(rest);
};
