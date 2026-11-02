import { setIniValue } from "./duckstation-souvenir-config-value.js";

const SECTION = "Log";
const ENABLED_KEY = "AchievementsEnabled";
const LEVEL_KEY = "AchievementsLevel";
const INFO_LOG_LEVEL = "4";

export const enablePPSSPPAchievementLog = (content: string) => {
  const withChannelEnabled = setIniValue(content, SECTION, ENABLED_KEY, "true");

  return setIniValue(withChannelEnabled, SECTION, LEVEL_KEY, INFO_LOG_LEVEL);
};

export const buildPPSSPPSouvenirLaunchArguments = (
  configName: string,
  logPath: string
) => [
  `--config=${configName}`,
  `--loglevel=${INFO_LOG_LEVEL}`,
  `--log=${logPath}`,
];
