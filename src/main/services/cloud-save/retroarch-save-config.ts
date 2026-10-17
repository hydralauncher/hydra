import { promises as fs } from "node:fs";
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

const enabled = (value?: string, defaultValue = false) =>
  value === undefined ? defaultValue : value.toLowerCase() === "true";

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
    : path.basename(path.dirname(configPath)).toLowerCase() === "config"
      ? path.dirname(configPath)
      : path.join(path.dirname(configPath), "config");

export const shouldLoadRetroArchOverrides = (values: RetroArchSaveConfig) =>
  values.auto_overrides_enable?.toLowerCase() !== "false";

export const resolveRetroArchSaveDirectory = ({
  values,
  configPath,
  homeDir,
  romPath,
  coreName,
  kind = "save",
}: {
  values: RetroArchSaveConfig;
  configPath: string;
  homeDir: string;
  romPath: string;
  coreName: string;
  kind?: "save" | "state";
}) => {
  const contentDir = path.dirname(romPath);
  const configured =
    kind === "save" ? values.savefile_directory : values.savestate_directory;
  const inContentDir = enabled(
    kind === "save"
      ? values.savefiles_in_content_dir
      : values.savestates_in_content_dir
  );
  if (!inContentDir && (!configured || configured === "default")) {
    return null;
  }
  let base = inContentDir
    ? contentDir
    : resolveRetroArchConfiguredPath(configured, configPath, homeDir);
  if (
    enabled(
      kind === "save"
        ? values.sort_savefiles_by_content_enable
        : values.sort_savestates_by_content_enable
    )
  ) {
    base = path.join(base, path.basename(contentDir));
  }
  if (
    enabled(
      kind === "save"
        ? values.sort_savefiles_enable
        : values.sort_savestates_enable,
      true
    )
  ) {
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

export const RETROARCH_LEGACY_EXTRA_SUFFIXES = [
  ".eep",
  ".sra",
  ".fla",
  ".mpk",
] as const;

export const retroArchBatterySuffixes = (platform: string) =>
  platform === "snes" || platform === "gb" || platform === "gbc"
    ? [".srm", ".rtc"]
    : [".srm"];

export const retroArchStateSuffix = (fileName: string, stem: string) => {
  if (!fileName.startsWith(stem)) return null;
  const suffix = fileName.slice(stem.length);
  return /^\.state(?:\d+|\.auto)?$/.test(suffix) ? suffix : null;
};

export const retroArchLogicalStateName = (suffix: string) =>
  /^\.state(?:\d+|\.auto)?(?:\.png)?$/.test(suffix) ? `state${suffix}` : null;

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
  const battery = /^battery(\.[a-z0-9]+)$/.exec(logicalName);
  if (battery && retroArchLogicalSaveName(battery[1])) {
    return `${path.parse(romPath).name}${battery[1]}`;
  }
  const state = /^state(\.state(?:\d+|\.auto)?(?:\.png)?)$/.exec(logicalName);
  return state ? `${path.parse(romPath).name}${state[1]}` : null;
};

export const retroArchTransferPakSaveName = (romPath: string) =>
  `${path.basename(romPath)}.sav`;

export const retroArchLogicalNameForPhysicalFile = (
  romPath: string,
  fileName: string,
  platform: string,
  statePartnerExists = false,
  transferPakCompanionExists = false
): string | null => {
  const stem = path.parse(romPath).name;
  for (const suffix of retroArchBatterySuffixes(platform)) {
    if (fileName === `${stem}${suffix}`) {
      return retroArchLogicalSaveName(suffix);
    }
  }
  const stateSuffix = retroArchStateSuffix(fileName, stem);
  if (stateSuffix) return retroArchLogicalStateName(stateSuffix);
  if (fileName.endsWith(".png") && statePartnerExists) {
    const imageSuffix = retroArchStateSuffix(
      fileName.slice(0, -".png".length),
      stem
    );
    if (imageSuffix) return retroArchLogicalStateName(`${imageSuffix}.png`);
  }
  if (
    platform === "n64" &&
    transferPakCompanionExists &&
    fileName === retroArchTransferPakSaveName(romPath)
  ) {
    return "transfer-pak.sav";
  }
  return null;
};

export const createRetroArchGameSaveFileFilter = (
  romPaths: string[],
  platform: string
) => {
  const stemCounts = new Map<string, number>();
  for (const romPath of romPaths) {
    const stem = retroArchSaveStem(romPath);
    stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
  }
  return async (filePath: string): Promise<boolean> => {
    const fileStat = await fs.lstat(filePath).catch(() => null);
    if (!fileStat?.isFile() || fileStat.isSymbolicLink()) return false;
    const fileName = path.basename(filePath);
    for (const romPath of romPaths) {
      if (stemCounts.get(retroArchSaveStem(romPath)) !== 1) continue;
      const statePartner = fileName.endsWith(".png")
        ? await fs.lstat(filePath.slice(0, -".png".length)).catch(() => null)
        : null;
      const transferPakCompanion =
        platform === "n64" && path.dirname(filePath) === path.dirname(romPath)
          ? await fs
              .lstat(
                path.join(path.dirname(romPath), `${path.basename(romPath)}.gb`)
              )
              .catch(() => null)
          : null;
      if (
        retroArchLogicalNameForPhysicalFile(
          romPath,
          fileName,
          platform,
          Boolean(statePartner?.isFile() && !statePartner.isSymbolicLink()),
          Boolean(
            transferPakCompanion?.isFile() &&
              !transferPakCompanion.isSymbolicLink()
          )
        )
      ) {
        return true;
      }
    }
    return false;
  };
};
