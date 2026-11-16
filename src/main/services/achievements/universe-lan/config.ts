import { randomBytes } from "node:crypto";

/**
 * Helpers to derive UniverseLAN configuration files from the templates that
 * ship inside every UniverseLAN release zip. Only the values Hydra cares about
 * are touched; everything else keeps the upstream defaults.
 */

const escapeRegExp = (value: string) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const keyLinePattern = (key: string) =>
  new RegExp(String.raw`^([ \t]*${escapeRegExp(key)}[ \t]*=)[^\r\n]*`, "m");

export const readIniValue = (content: string, key: string) => {
  const match = keyLinePattern(key).exec(content);

  if (!match) return null;

  const value = match[0].slice(match[1].length).trim();

  return value || null;
};

/** Replaces the first `key = value` line, or appends one if it is missing. */
export const setIniValue = (content: string, key: string, value: string) => {
  const pattern = keyLinePattern(key);

  if (pattern.test(content)) {
    return content.replace(pattern, (_line, prefix: string) => {
      return `${prefix} ${value}`;
    });
  }

  const separator = content.length && !content.endsWith("\n") ? "\n" : "";

  return `${content}${separator}${key} = ${value}\n`;
};

export const AUTHENTICATION_KEY_NAME = "Key";

export const generateAuthenticationKey = () =>
  randomBytes(64).toString("base64");

/** `UniverseLAN.ini`, shared by the game DLL and the server. */
export const buildBootFile = (template: string, authenticationKey: string) =>
  setIniValue(template, AUTHENTICATION_KEY_NAME, authenticationKey);

/** `UniverseLANData/Config.ini` used by the game DLL. */
export const buildClientConfig = (template: string) => {
  let config = setIniValue(template, "EnableConsole", "0");
  config = setIniValue(config, "SaveAchievementsAndStats", "1");
  config = setIniValue(config, "SignedIn", "1");
  config = setIniValue(config, "ServerAddress", "127.0.0.1");

  return config;
};

/** `UniverseLANServerData/Config.ini`, only reachable from this machine. */
export const buildServerConfig = (template: string) =>
  setIniValue(template, "BindAddress", "127.0.0.1");
