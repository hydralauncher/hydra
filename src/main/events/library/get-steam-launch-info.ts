import { resolveSteamLaunchInfo } from "@main/services";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import { registerEvent } from "../register-event";

registerEvent(
  "getSteamLaunchInfo",
  async (_event, executablePath: string | null) => {
    if (process.platform !== "linux" || !executablePath) return null;

    return resolveSteamLaunchInfo(parseExecutablePath(executablePath));
  }
);
