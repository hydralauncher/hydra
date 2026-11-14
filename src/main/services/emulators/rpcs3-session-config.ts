import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import { resolveRpcs3ConfigRootStatus } from "../cloud-save/rpcs3-config-root.js";
import { normalizeRpcs3TitleId } from "../cloud-save/rpcs3-title-ids.js";

const EXCLUSIVE_FULLSCREEN_PATH = [
  "Video",
  "Vulkan",
  "Exclusive Fullscreen Mode",
];
const EXCLUSIVE_FULLSCREEN_DISABLED = "Disable";

const parseRpcs3Config = (contents: string): YAML.Document | null => {
  const document = YAML.parseDocument(contents, { schema: "failsafe" });
  if (document.errors.length > 0) return null;
  if (document.contents !== null && !YAML.isMap(document.contents)) {
    return null;
  }
  return document;
};

const applyConfigNode = (
  document: YAML.Document,
  keyPath: unknown[],
  node: unknown
) => {
  const target = keyPath.length
    ? document.getIn(keyPath, true)
    : document.contents;

  if (YAML.isMap(node) && YAML.isMap(target)) {
    for (const pair of node.items) {
      const key = YAML.isScalar(pair.key) ? pair.key.value : pair.key;
      applyConfigNode(document, [...keyPath, key], pair.value);
    }
    return;
  }

  document.setIn(keyPath, YAML.isNode(node) ? node.clone() : node);
};

export const buildRpcs3SessionConfig = (
  globalConfig: string | null,
  customConfig: string | null
): string | null => {
  const sources = [globalConfig, customConfig].map((contents) =>
    contents === null ? undefined : parseRpcs3Config(contents)
  );
  if (sources.includes(null)) return null;

  const merged = new YAML.Document({}, { schema: "failsafe" });
  for (const source of sources) {
    if (source?.contents) applyConfigNode(merged, [], source.contents);
  }

  if (
    merged.getIn(EXCLUSIVE_FULLSCREEN_PATH) === EXCLUSIVE_FULLSCREEN_DISABLED
  ) {
    return null;
  }

  merged.setIn(EXCLUSIVE_FULLSCREEN_PATH, EXCLUSIVE_FULLSCREEN_DISABLED);
  return merged.toString();
};

const readOptionalFile = (filePath: string) =>
  fs.readFile(filePath, "utf8").catch(() => null);

const resolveRpcs3ConfigDirectory = async (configRoot: string) => {
  const nested = path.join(configRoot, "config");
  const hasNestedConfig = await fs
    .stat(path.join(nested, "config.yml"))
    .then((stats) => stats.isFile())
    .catch(() => false);
  return hasNestedConfig ? nested : configRoot;
};

const readCustomConfig = async (
  configDirectory: string,
  titleIds: string[]
): Promise<string | null> => {
  const normalizedTitleIds = [
    ...new Set(
      titleIds
        .map(normalizeRpcs3TitleId)
        .filter((titleId): titleId is string => titleId !== null)
    ),
  ];

  const customConfigs = await Promise.all(
    normalizedTitleIds.map((titleId) =>
      readOptionalFile(
        path.join(configDirectory, "custom_configs", `config_${titleId}.yml`)
      )
    )
  );
  return customConfigs.find((contents) => contents !== null) ?? null;
};

export interface Rpcs3SessionConfig {
  launchArguments: string[];
  sessionDirectory: string;
}

export const createRpcs3SessionConfig = async (
  executablePath: string | null,
  selectedRoot: string | null | undefined,
  titleIds: string[]
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
  const [globalConfig, customConfig] = await Promise.all([
    readOptionalFile(path.join(configDirectory, "config.yml")),
    readCustomConfig(configDirectory, titleIds),
  ]);

  const sessionConfig = buildRpcs3SessionConfig(globalConfig, customConfig);
  if (!sessionConfig) return null;

  const sessionDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-rpcs3-session-")
  );
  const sessionConfigPath = path.join(sessionDirectory, "config.yml");
  try {
    await fs.writeFile(sessionConfigPath, sessionConfig, "utf8");
  } catch (error) {
    await fs.rm(sessionDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    launchArguments: ["--config", sessionConfigPath],
    sessionDirectory,
  };
};
