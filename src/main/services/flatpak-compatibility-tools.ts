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

export const findFlatpakCompatibilityTools = async (
  installationRoots: string[],
  isValidTool: (toolPath: string) => boolean
): Promise<FlatpakCompatibilityTool[]> => {
  const tools: FlatpakCompatibilityTool[] = [];

  for (const installationRoot of installationRoots) {
    const runtimeRoot = path.join(installationRoot, "runtime");
    const extensions = (await readDirectoryNames(runtimeRoot)).filter((name) =>
      name.startsWith(COMPATIBILITY_TOOL_PREFIX)
    );

    for (const extension of extensions) {
      const extensionRoot = path.join(runtimeRoot, extension);

      for (const arch of await readDirectoryNames(extensionRoot)) {
        for (const branch of await readDirectoryNames(
          path.join(extensionRoot, arch)
        )) {
          const toolPath = path.join(
            extensionRoot,
            arch,
            branch,
            "active",
            "files"
          );
          if (!isValidTool(toolPath)) continue;

          const realPath = await fs.promises
            .realpath(toolPath)
            .catch(() => null);
          if (!realPath) continue;

          const fallbackName = `${extension.slice(COMPATIBILITY_TOOL_PREFIX.length)} (Flatpak${
            branch === "stable" ? "" : ` ${branch}`
          })`;

          tools.push({
            name: (await readDisplayName(realPath)) ?? fallbackName,
            path: realPath,
          });
        }
      }
    }
  }

  return tools;
};
