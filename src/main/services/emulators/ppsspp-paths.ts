import os from "node:os";
import path from "node:path";

export const ppssppConfigCandidates = (executablePath: string): string[] => {
  const home = os.homedir();
  const executableDirectory = path.dirname(executablePath);
  const portableCandidates = [
    path.join(executableDirectory, "memstick", "PSP", "SYSTEM", "ppsspp.ini"),
    path.join(executableDirectory, "PSP", "SYSTEM", "ppsspp.ini"),
  ];

  if (process.platform === "win32") {
    const documentDirectories = [
      path.join(home, "Documents"),
      ...["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
        .map((key) => process.env[key])
        .filter((root): root is string => !!root)
        .map((root) => path.join(root, "Documents")),
    ];

    return [
      ...portableCandidates,
      ...Array.from(new Set(documentDirectories)).map((directory) =>
        path.join(directory, "PPSSPP", "PSP", "SYSTEM", "ppsspp.ini")
      ),
    ];
  }

  if (process.platform === "darwin") {
    return [
      ...portableCandidates,
      path.join(home, ".config", "ppsspp", "PSP", "SYSTEM", "ppsspp.ini"),
      path.join(
        home,
        "Library",
        "Application Support",
        "PPSSPP",
        "PSP",
        "SYSTEM",
        "ppsspp.ini"
      ),
    ];
  }

  const flatpakConfig = path.join(
    home,
    ".var",
    "app",
    "org.ppsspp.PPSSPP",
    "config",
    "ppsspp",
    "PSP",
    "SYSTEM",
    "ppsspp.ini"
  );
  const standardConfig = path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"),
    "ppsspp",
    "PSP",
    "SYSTEM",
    "ppsspp.ini"
  );

  return [
    ...portableCandidates,
    ...(executablePath.includes("org.ppsspp.PPSSPP")
      ? [flatpakConfig, standardConfig]
      : [standardConfig, flatpakConfig]),
  ];
};
