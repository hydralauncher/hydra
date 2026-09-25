import path from "node:path";

export type RetroArchSaveConfig = Record<string, string>;

export const parseRetroArchSaveConfig = (
  content: string
): RetroArchSaveConfig => {
  const values: RetroArchSaveConfig = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([a-zA-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const raw = match[2];
    const value =
      raw.startsWith('"') && raw.endsWith('"')
        ? raw.slice(1, -1)
        : raw.split(/\s+#/, 1)[0].trim();
    values[match[1]] = value;
  }
  return values;
};

const enabled = (value?: string) => value?.toLowerCase() === "true";

export const resolveRetroArchConfiguredPath = (
  value: string,
  configPath: string,
  homeDir: string
) => {
  if (value.startsWith(":/") || value.startsWith(":\\")) {
    return path.resolve(path.dirname(configPath), value.slice(2));
  }
  if (value === "~") return homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(homeDir, value.slice(2));
  }
  return path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(path.dirname(configPath), value);
};

export const resolveRetroArchOverrideDirectory = (
  values: RetroArchSaveConfig,
  configPath: string,
  homeDir: string
) =>
  values.rgui_config_directory && values.rgui_config_directory !== "default"
    ? resolveRetroArchConfiguredPath(
        values.rgui_config_directory,
        configPath,
        homeDir
      )
    : path.join(path.dirname(configPath), "config");

export const shouldLoadRetroArchOverrides = (values: RetroArchSaveConfig) =>
  values.auto_overrides_enable?.toLowerCase() !== "false";

export const resolveRetroArchSaveDirectory = ({
  values,
  configPath,
  homeDir,
  romPath,
  coreName,
}: {
  values: RetroArchSaveConfig;
  configPath: string;
  homeDir: string;
  romPath: string;
  coreName: string;
}) => {
  const contentDir = path.dirname(romPath);
  const configured = values.savefile_directory;
  if (
    !enabled(values.savefiles_in_content_dir) &&
    (!configured || configured === "default")
  ) {
    return null;
  }
  let base = enabled(values.savefiles_in_content_dir)
    ? contentDir
    : resolveRetroArchConfiguredPath(configured, configPath, homeDir);
  if (enabled(values.sort_savefiles_by_content_enable)) {
    base = path.join(base, path.basename(contentDir));
  }
  if (enabled(values.sort_savefiles_enable)) {
    base = path.join(base, coreName);
  }
  return base;
};

export const RETROARCH_SAVE_SUFFIXES = [
  ".srm",
  ".rtc",
  ".sav",
  ".eep",
  ".sra",
  ".fla",
  ".mpk",
] as const;

export const retroArchLogicalSaveName = (suffix: string) =>
  RETROARCH_SAVE_SUFFIXES.includes(
    suffix as (typeof RETROARCH_SAVE_SUFFIXES)[number]
  )
    ? `battery${suffix}`
    : null;

export const retroArchSaveStem = (romPath: string) =>
  path.parse(romPath).name.toLowerCase();

export const retroArchPhysicalSaveName = (
  romPath: string,
  logicalName: string
) => {
  const match = /^battery(\.[a-z0-9]+)$/.exec(logicalName);
  if (!match || !retroArchLogicalSaveName(match[1])) return null;
  return `${path.parse(romPath).name}${match[1]}`;
};
