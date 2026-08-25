import path from "node:path";

import {
  duckstationConfigCandidates,
  findExistingConfig,
  pcsx2ConfigCandidates,
} from "./emulator-config";

export const duckstationLogPath = () => {
  const configPath = findExistingConfig(duckstationConfigCandidates());

  if (!configPath) return null;

  return path.join(path.dirname(configPath), "duckstation.log");
};

export const pcsx2LogPath = (executablePath: string | null) => {
  const configPath = findExistingConfig(pcsx2ConfigCandidates(executablePath));

  if (!configPath) return null;

  return path.join(
    path.dirname(path.dirname(configPath)),
    "logs",
    "emulog.txt"
  );
};
