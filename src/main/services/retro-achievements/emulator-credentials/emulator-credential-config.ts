import {
  getCfgValue,
  setCfgValue,
} from "../../emulators/retroarch-souvenir-config-value.js";
import {
  getIniLine,
  setIniValue,
} from "../../emulators/duckstation-souvenir-config-value.js";

export interface EmulatorAccountState {
  username: string | null;
  hasToken: boolean;
}

export const getIniValue = (content: string, section: string, key: string) => {
  const line = getIniLine(content, section, key);
  if (!line) return null;

  const value = line.slice(line.indexOf("=") + 1).trim();
  return value || null;
};

export const setIniValues = (
  content: string,
  section: string,
  values: Record<string, string>
) =>
  Object.entries(values).reduce(
    (updated, [key, value]) => setIniValue(updated, section, key, value),
    content
  );

export const shouldWriteEmulatorAccount = (
  state: EmulatorAccountState,
  username: string
) => {
  if (!state.username) return true;

  return (
    state.username.toLowerCase() === username.toLowerCase() && !state.hasToken
  );
};

const RETROARCH_USERNAME_KEY = "cheevos_username";
const RETROARCH_TOKEN_KEY = "cheevos_token";
const RETROARCH_PASSWORD_KEY = "cheevos_password";

export const readRetroArchAccount = (
  content: string
): EmulatorAccountState => ({
  username: getCfgValue(content, RETROARCH_USERNAME_KEY) || null,
  hasToken: Boolean(getCfgValue(content, RETROARCH_TOKEN_KEY)),
});

export const writeRetroArchAccount = (
  content: string,
  username: string,
  token: string
) =>
  setCfgValue(
    setCfgValue(
      setCfgValue(content, RETROARCH_USERNAME_KEY, username),
      RETROARCH_TOKEN_KEY,
      token
    ),
    RETROARCH_PASSWORD_KEY,
    ""
  );

export const PCSX2_SECTION = "Achievements";
export const PPSSPP_SECTION = "Achievements";
export const DOLPHIN_SECTION = "Achievements";

export const readPcsx2Account = (
  content: string,
  secretsContent: string | null
) => ({
  username: getIniValue(content, PCSX2_SECTION, "Username"),
  hasToken: Boolean(
    getIniValue(content, PCSX2_SECTION, "Token") ||
      (secretsContent && getIniValue(secretsContent, PCSX2_SECTION, "Token"))
  ),
});

export const writePcsx2Account = (
  content: string,
  username: string,
  loginTimestamp: number
) =>
  setIniValues(content, PCSX2_SECTION, {
    Username: username,
    LoginTimestamp: String(loginTimestamp),
  });

export const writePcsx2Token = (content: string, token: string) =>
  setIniValue(content, PCSX2_SECTION, "Token", token);

export const readPpssppUsername = (content: string) =>
  getIniValue(content, PPSSPP_SECTION, "AchievementsUserName");

export const writePpssppUsername = (content: string, username: string) =>
  setIniValue(content, PPSSPP_SECTION, "AchievementsUserName", username);

export const readDolphinAccount = (content: string) => ({
  username: getIniValue(content, DOLPHIN_SECTION, "Username"),
  hasToken: Boolean(getIniValue(content, DOLPHIN_SECTION, "ApiToken")),
});

export const writeDolphinAccount = (
  content: string,
  username: string,
  token: string
) =>
  setIniValues(content, DOLPHIN_SECTION, {
    Username: username,
    ApiToken: token,
  });
