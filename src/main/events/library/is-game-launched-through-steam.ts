import { resolveSteamAppId } from "@main/services";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import { registerEvent } from "../register-event";

registerEvent(
  "isGameLaunchedThroughSteam",
  async (_event, executablePath: string | null) => {
    if (process.platform !== "linux" || !executablePath) return false;

    return resolveSteamAppId(parseExecutablePath(executablePath)) !== null;
  }
);
