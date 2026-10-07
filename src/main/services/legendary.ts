import { app } from "electron";
import path from "node:path";
import manifest from "../../shared/legendary-manifest.json" with { type: "json" };
import {
  getLegendaryAvailability,
  resolveLegendaryBinaryPath,
  type LegendaryEnvironment,
} from "./legendary-core";

const getEnvironment = (): LegendaryEnvironment => ({
  platform: process.platform,
  arch: process.arch,
  isPackaged: app.isPackaged,
  developmentRoot: path.join(__dirname, "..", ".."),
  resourcesPath: process.resourcesPath,
});

export class Legendary {
  public static getBinaryPath() {
    return resolveLegendaryBinaryPath(getEnvironment());
  }

  public static checkVersion() {
    return getLegendaryAvailability(getEnvironment(), manifest.version);
  }
}
