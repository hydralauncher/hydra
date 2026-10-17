import os from "node:os";
import path from "node:path";

export const retroArchConfigRoots = (
  executablePath: string,
  platform = process.platform,
  homeDir = os.homedir(),
  appData = process.env.APPDATA
): string[] => {
  if (executablePath.includes("org.libretro.RetroArch")) {
    return [
      path.join(
        homeDir,
        ".var",
        "app",
        "org.libretro.RetroArch",
        "config",
        "retroarch"
      ),
    ];
  }

  const roots = [path.dirname(executablePath)];
  if (platform === "win32") {
    if (appData) roots.push(path.join(appData, "RetroArch"));
  } else if (platform === "darwin") {
    roots.push(
      path.join(homeDir, "Library", "Application Support", "RetroArch")
    );
  } else {
    roots.push(path.join(homeDir, ".config", "retroarch"));
  }
  return roots;
};

export const retroArchConfigCandidates = (
  executablePath: string,
  platform = process.platform,
  homeDir = os.homedir(),
  appData = process.env.APPDATA
) =>
  retroArchConfigRoots(executablePath, platform, homeDir, appData).flatMap(
    (root) => [
      path.join(root, "retroarch.cfg"),
      path.join(root, "config", "retroarch.cfg"),
    ]
  );
