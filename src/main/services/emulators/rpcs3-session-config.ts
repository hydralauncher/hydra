import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import YAML from "yaml";

import { resolveRpcs3ConfigRootStatus } from "../cloud-save/rpcs3-config-root.js";
import { normalizeRpcs3TitleId } from "../cloud-save/rpcs3-title-ids.js";

const VIDEO_SECTION = "Video";
const VULKAN_SECTION = "Vulkan";
const EXCLUSIVE_FULLSCREEN_KEY = "Exclusive Fullscreen Mode";
const EXCLUSIVE_FULLSCREEN_DISABLED = "Disable";

type YamlRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is YamlRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readYamlRecord = async (
  filePath: string
): Promise<YamlRecord | null | undefined> => {
  const contents = await fs.readFile(filePath, "utf8").catch(() => null);
  if (contents === null) return undefined;

  try {
    const parsed: unknown = YAML.parse(contents);
    if (parsed === null) return {};
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const readExclusiveFullscreenMode = (config: YamlRecord | undefined) => {
  const video = config?.[VIDEO_SECTION];
  const vulkan = isRecord(video) ? video[VULKAN_SECTION] : undefined;
  const mode = isRecord(vulkan) ? vulkan[EXCLUSIVE_FULLSCREEN_KEY] : undefined;
  return typeof mode === "string" ? mode : undefined;
};

export const disableRpcs3ExclusiveFullscreen = (
  config: YamlRecord
): YamlRecord => {
  const video = isRecord(config[VIDEO_SECTION]) ? config[VIDEO_SECTION] : {};
  const vulkan = isRecord(video[VULKAN_SECTION]) ? video[VULKAN_SECTION] : {};

  return {
    ...config,
    [VIDEO_SECTION]: {
      ...video,
      [VULKAN_SECTION]: {
        ...vulkan,
        [EXCLUSIVE_FULLSCREEN_KEY]: EXCLUSIVE_FULLSCREEN_DISABLED,
      },
    },
  };
};

const resolveRpcs3ConfigDirectory = async (configRoot: string) => {
  const nested = path.join(configRoot, "config");
  const hasNestedConfig = await fs
    .stat(path.join(nested, "config.yml"))
    .then((stats) => stats.isFile())
    .catch(() => false);
  return hasNestedConfig ? nested : configRoot;
};

export interface Rpcs3SessionConfig {
  launchArguments: string[];
  cleanupFilePaths: string[];
}

export const createRpcs3SessionConfig = async (
  executablePath: string | null,
  selectedRoot: string | null | undefined,
  titleId: string | null | undefined
): Promise<Rpcs3SessionConfig | null> => {
  if (process.platform !== "win32") return null;

  const { location } = await resolveRpcs3ConfigRootStatus(
    executablePath,
    selectedRoot
  );
  if (!location) return null;

  const configDirectory = await resolveRpcs3ConfigDirectory(
    location.configRoot
  );
  const globalConfig = await readYamlRecord(
    path.join(configDirectory, "config.yml")
  );
  const normalizedTitleId = normalizeRpcs3TitleId(titleId);
  const customConfig = normalizedTitleId
    ? await readYamlRecord(
        path.join(
          configDirectory,
          "custom_configs",
          `config_${normalizedTitleId}.yml`
        )
      )
    : undefined;
  if (globalConfig === null || customConfig === null) return null;

  const effectiveMode =
    readExclusiveFullscreenMode(customConfig) ??
    readExclusiveFullscreenMode(globalConfig);
  if (effectiveMode === EXCLUSIVE_FULLSCREEN_DISABLED) return null;

  const sessionConfigPath = path.join(
    configDirectory,
    `hydra-session-${randomUUID()}.yml`
  );
  await fs.writeFile(
    sessionConfigPath,
    YAML.stringify(disableRpcs3ExclusiveFullscreen(customConfig ?? {})),
    "utf8"
  );

  return {
    launchArguments: ["--config", sessionConfigPath],
    cleanupFilePaths: [sessionConfigPath],
  };
};
