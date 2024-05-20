import { Theme } from "@types";
import fs from "fs";
import path from "path";
import defaultThemes from "./default-themes";
import { app } from "electron";
import { logger } from "@main/services";

const writeTheme = (pathName: string, theme: Theme): void => {
  try {
    const filePath = path.join(pathName, `${theme.name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(theme));
  } catch (err) {
    logger.log("error", `Error parsing ${err}`);
  }
};

export const mountPath = (operatingSystem: string): string =>
  operatingSystem === "win32"
    ? path.join(app.getPath("documents"), "hydra", "themes")
    : path.join(app.getPath("home"), ".hydra", "themes");

export const verifyFolderTheme = (path: string) => {
  try {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true });
      defaultThemes.forEach((theme) => writeTheme(path, theme));
    }
  } catch (err) {
    logger.log("error", `Error parsing ${err}`);
  }
};

export const loadThemesPath = (): void => {
  const themePath = mountPath(process.platform);
  verifyFolderTheme(themePath);
};
