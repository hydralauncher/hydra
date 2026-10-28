import fs from "node:fs";
import path from "node:path";

const COMPATIBILITY_TOOL_PREFIX = "com.valvesoftware.Steam.CompatibilityTool.";

export interface FlatpakCompatibilityTool {
  name: string;
  path: string;
}

export const getFlatpakInstallationRoots = (homePath: string) => [
  path.join("/var", "lib", "flatpak"),
  path.join(homePath, ".local", "share", "flatpak"),
];

const readDirectoryNames = async (directoryPath: string) =>
  (
    await fs.promises
      .readdir(directoryPath, { withFileTypes: true })
      .catch(() => [] as fs.Dirent[])
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

const readDisplayName = async (toolPath: string) => {
  const content = await fs.promises
    .readFile(path.join(toolPath, "compatibilitytool.vdf"), "utf8")
    .catch(() => null);
  return content
    ? (/"display_name"\s+"([^"]+)"/.exec(content)?.[1]?.trim() ?? null)
    : null;
};

const readTool = async (
  extensionRoot: string,
  extension: string,
  arch: string,
  branch: string,
  isValidTool: (toolPath: string) => boolean
): Promise<FlatpakCompatibilityTool | null> => {
  const toolPath = path.join(extensionRoot, arch, branch, "active", "files");
  if (!isValidTool(toolPath)) return null;

  const realPath = await fs.promises.realpath(toolPath).catch(() => null);
  if (!realPath) return null;

  const branchLabel = branch === "stable" ? "" : ` ${branch}`;
  const fallbackName = `${extension.slice(COMPATIBILITY_TOOL_PREFIX.length)} (Flatpak${branchLabel})`;

  return {
    name: (await readDisplayName(realPath)) ?? fallbackName,
    path: realPath,
  };
};

const findToolsInExtension = async (
  runtimeRoot: string,
  extension: string,
  isValidTool: (toolPath: string) => boolean
) => {
  const extensionRoot = path.join(runtimeRoot, extension);
  const arches = await readDirectoryNames(extensionRoot);
  const branchesByArch = await Promise.all(
    arches.map(async (arch) =>
      (await readDirectoryNames(path.join(extensionRoot, arch))).map(
        (branch) => ({ arch, branch })
      )
    )
  );

  return Promise.all(
    branchesByArch
      .flat()
      .map(({ arch, branch }) =>
        readTool(extensionRoot, extension, arch, branch, isValidTool)
      )
  );
};

const findToolsInInstallation = async (
  installationRoot: string,
  isValidTool: (toolPath: string) => boolean
) => {
  const runtimeRoot = path.join(installationRoot, "runtime");
  const extensions = (await readDirectoryNames(runtimeRoot)).filter((name) =>
    name.startsWith(COMPATIBILITY_TOOL_PREFIX)
  );
  const toolsByExtension = await Promise.all(
    extensions.map((extension) =>
      findToolsInExtension(runtimeRoot, extension, isValidTool)
    )
  );

  return toolsByExtension.flat();
};

export const findFlatpakCompatibilityTools = async (
  installationRoots: string[],
  isValidTool: (toolPath: string) => boolean
): Promise<FlatpakCompatibilityTool[]> => {
  const toolsByInstallation = await Promise.all(
    installationRoots.map((installationRoot) =>
      findToolsInInstallation(installationRoot, isValidTool)
    )
  );

  return toolsByInstallation
    .flat()
    .filter((tool): tool is FlatpakCompatibilityTool => tool !== null);
};
