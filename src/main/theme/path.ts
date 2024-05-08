import { Theme } from "@types";
import fs from 'fs';
import path from 'path';
import defaultThemes from "./default-themes";
import { app } from "electron";
import { readJSONFiles } from ".";

function writeTheme(path: string, theme: Theme) {
  try {
    fs.writeFileSync(`${path}/${theme.name}.json`, JSON.stringify(theme))
  } catch (err) {
    console.error(err)
  }
}

const mountPath = (operatingSystem: string): string => operatingSystem === "win32"
  ? path.join(app.getPath("documents"), "hydra", "themes")
  : path.join(app.getPath("home"), ".hydra", "themes")

function verifyFolderTheme(path: string) {
  try {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true });
      defaultThemes.forEach((theme) => writeTheme(path, theme))
    }
  } catch (err) {
    console.error(err);
  }
}

export function loadthemesPath(): void {
  const themePath = mountPath(process.platform)
  verifyFolderTheme(themePath)
}

export async function loadThemes(): Promise<Theme[]> {
  const themePath = mountPath(process.platform)
  return await readJSONFiles(themePath)
}
