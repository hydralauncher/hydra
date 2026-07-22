import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

import type { GameShop } from "@types";
import { getHydraExecutablePath } from "./hydra-executable-path";

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

const escapeVbsString = (value: string) => value.replaceAll('"', '""');

export const refreshPortableShortcutLauncher = () => {
  const portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (process.platform !== "win32" || !portableExecutable) return null;

  const launcherDirectory = path.join(
    app.getPath("userData"),
    "shortcut-assets"
  );
  const launcherPath = path.join(launcherDirectory, "launch-portable.vbs");
  const script = [
    'Set shell = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    `innerExecutable = "${escapeVbsString(process.execPath)}"`,
    `portableExecutable = "${escapeVbsString(portableExecutable)}"`,
    "If fso.FileExists(innerExecutable) Then",
    "  executable = innerExecutable",
    "Else",
    "  executable = portableExecutable",
    "End If",
    'arguments = ""',
    "For Each argument In WScript.Arguments",
    '  arguments = arguments & " """ & argument & """"',
    "Next",
    'shell.Run """" & executable & """" & arguments, 0, False',
  ].join("\r\n");

  fs.mkdirSync(launcherDirectory, { recursive: true });
  fs.writeFileSync(launcherPath, script, "utf8");

  return launcherPath;
};

export const getHydraShortcutTarget = (deepLink: string) => {
  const portableLauncherPath = refreshPortableShortcutLauncher();
  if (!portableLauncherPath) {
    return {
      executablePath: getHydraExecutablePath(),
      arguments: getShortcutArguments(deepLink),
    };
  }

  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return {
    executablePath: path.join(systemRoot, "System32", "wscript.exe"),
    arguments: `"${portableLauncherPath}" "${deepLink}"`,
  };
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
