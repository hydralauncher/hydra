import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

import type { GameShop } from "@types";

export { getHydraExecutablePath } from "./hydra-executable-path";

export const buildRunDeepLink = (shop: GameShop, objectId: string) => {
  const query = new URLSearchParams({
    shop,
    objectId,
  });

  return `hydralauncher://run?${query.toString()}`;
};

const quoteLinuxExecArg = (value: string) => {
  const escapedQuote = String.raw`\"`;
  const escapedValue = value.replaceAll('"', escapedQuote);

  return `"${escapedValue}"`;
};

export const getShortcutArguments = (deepLink: string) => {
  const deepLinkArgument =
    process.platform === "linux" ? quoteLinuxExecArg(deepLink) : deepLink;

  if (process.defaultApp && process.argv.length >= 2) {
    const appEntry = path.resolve(process.argv[1]);
    const appEntryArgument =
      process.platform === "linux" ? quoteLinuxExecArg(appEntry) : appEntry;

    return `${appEntryArgument} ${deepLinkArgument}`;
  }

  return deepLinkArgument;
};

export const getWindowsVbsPath = () => {
  if (!app.isPackaged || process.platform !== "win32") return undefined;

  const bundledPath = path.join(process.resourcesPath, "windows.vbs");
  const stableDirectory = path.join(app.getPath("userData"), "shortcut-assets");
  const stablePath = path.join(
    stableDirectory,
    `windows-${app.getVersion()}.vbs`
  );

  fs.mkdirSync(stableDirectory, { recursive: true });
  if (!fs.existsSync(stablePath)) {
    fs.copyFileSync(bundledPath, stablePath);
  }

  return stablePath;
};
