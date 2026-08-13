import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { logger } from "../logger";
import {
  duckstationConfigCandidates,
  findExistingConfig,
} from "./emulator-config";

const setIniValue = (
  content: string,
  section: string,
  key: string,
  value: string
) => {
  const lines = content.split(/\r?\n/);
  const sectionIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === `[${section.toLowerCase()}]`
  );

  if (sectionIndex === -1) {
    return `${content.trimEnd()}\n\n[${section}]\n${key} = ${value}\n`;
  }

  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("[")) {
      lines.splice(index, 0, `${key} = ${value}`);
      return lines.join("\n");
    }

    const separator = lines[index].indexOf("=");
    if (separator === -1) continue;

    if (lines[index].slice(0, separator).trim() === key) {
      lines[index] = `${key} = ${value}`;
      return lines.join("\n");
    }
  }

  lines.push(`${key} = ${value}`);
  return lines.join("\n");
};

const setCfgValue = (content: string, key: string, value: string) => {
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const separator = lines[index].indexOf("=");
    if (separator === -1) continue;

    if (lines[index].slice(0, separator).trim() === key) {
      lines[index] = `${key} = "${value}"`;
      return lines.join("\n");
    }
  }

  return `${content.trimEnd()}\n${key} = "${value}"\n`;
};

export const retroArchConfigRoots = (executablePath: string): string[] => {
  const home = os.homedir();

  if (executablePath.includes("org.libretro.RetroArch")) {
    return [
      path.join(
        home,
        ".var",
        "app",
        "org.libretro.RetroArch",
        "config",
        "retroarch"
      ),
    ];
  }

  const roots = [path.dirname(executablePath)];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) roots.push(path.join(appData, "RetroArch"));
  } else {
    roots.push(path.join(home, ".config", "retroarch"));
  }

  return roots;
};

export const findRetroArchConfig = (executablePath: string) =>
  findExistingConfig(
    retroArchConfigRoots(executablePath).map((root) =>
      path.join(root, "retroarch.cfg")
    )
  );

export const readRetroArchScreenshotDirectory = (configPath: string) => {
  try {
    const content = fs.readFileSync(configPath, "utf8");

    for (const line of content.split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      if (line.slice(0, separator).trim() !== "screenshot_directory") continue;

      const raw = line
        .slice(separator + 1)
        .trim()
        .replace(/^"|"$/g, "");

      if (!raw || raw === "default") break;

      if (raw.startsWith("~")) return path.join(os.homedir(), raw.slice(1));

      return path.isAbsolute(raw)
        ? raw
        : path.join(path.dirname(configPath), raw);
    }
  } catch (error) {
    logger.error("Failed to read RetroArch screenshot directory", error);
  }

  return path.join(path.dirname(configPath), "screenshots");
};

export const enableRetroArchAchievementScreenshots = (
  executablePath: string
) => {
  const configPath = findRetroArchConfig(executablePath);

  if (!configPath) return;

  try {
    const content = fs.readFileSync(configPath, "utf8");
    const updated = setCfgValue(content, "cheevos_auto_screenshot", "true");

    if (updated !== content) fs.writeFileSync(configPath, updated, "utf8");
  } catch (error) {
    logger.error("Failed to enable RetroArch achievement screenshots", error);
  }
};

export const enableDuckStationFileLogging = () => {
  const configPath = findExistingConfig(duckstationConfigCandidates());

  if (!configPath) return;

  try {
    const content = fs.readFileSync(configPath, "utf8");
    const updated = setIniValue(content, "Logging", "LogToFile", "true");

    if (updated !== content) fs.writeFileSync(configPath, updated, "utf8");
  } catch (error) {
    logger.error("Failed to enable DuckStation file logging", error);
  }
};
