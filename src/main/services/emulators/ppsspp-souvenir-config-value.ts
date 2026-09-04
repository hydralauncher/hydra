import { setIniValue } from "./duckstation-souvenir-config-value.js";

const SECTION = "Log";
const ENABLED_KEY = "AchievementsEnabled";
const LEVEL_KEY = "AchievementsLevel";

export const enablePPSSPPAchievementLog = (content: string) => {
  const withChannelEnabled = setIniValue(content, SECTION, ENABLED_KEY, "true");

  return setIniValue(withChannelEnabled, SECTION, LEVEL_KEY, "4");
};

export const buildPPSSPPSouvenirLaunchArguments = (
  configName: string,
  logPath: string
) => [`--config=${configName}`, "--loglevel=4", `--log=${logPath}`];
