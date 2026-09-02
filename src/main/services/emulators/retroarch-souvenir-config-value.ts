const isCfgKeyLine = (line: string, key: string) => {
  const separator = line.indexOf("=");
  return separator !== -1 && line.slice(0, separator).trim() === key;
};

export const getCfgLine = (content: string, key: string) =>
  content.split(/\r?\n/).find((line) => isCfgKeyLine(line, key)) ?? null;

export const getCfgValue = (content: string, key: string) => {
  const line = getCfgLine(content, key);
  if (!line) return null;

  return line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^"|"$/g, "");
};

export const setCfgValue = (content: string, key: string, value: string) => {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => isCfgKeyLine(line, key));

  if (index !== -1) {
    lines[index] = `${key} = "${value}"`;
    return lines.join("\n");
  }

  return `${content.trimEnd()}\n${key} = "${value}"\n`;
};

export const restoreCfgLine = (
  content: string,
  key: string,
  originalLine: string | null
) => {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => isCfgKeyLine(line, key));

  if (originalLine === null) {
    if (index !== -1) lines.splice(index, 1);
  } else if (index === -1) {
    lines.push(originalLine);
  } else {
    lines[index] = originalLine;
  }

  return lines.join("\n");
};

const AUTO_SCREENSHOT_KEY = "cheevos_auto_screenshot";
const SCREENSHOT_DIRECTORY_KEY = "screenshot_directory";
const CONFIG_SAVE_ON_EXIT_KEY = "config_save_on_exit";

export const usesRetroArchContentScreenshotDirectory = (
  screenshotDirectory: string | null
) => !screenshotDirectory || screenshotDirectory === "default";

export const setRetroArchSouvenirConfigValues = (
  content: string,
  screenshotDirectory: string
) =>
  setCfgValue(
    setCfgValue(content, AUTO_SCREENSHOT_KEY, "true"),
    SCREENSHOT_DIRECTORY_KEY,
    screenshotDirectory
  );

export const buildRetroArchSouvenirAppendConfig = (
  screenshotDirectory: string
) =>
  [
    `${AUTO_SCREENSHOT_KEY} = "true"`,
    `${SCREENSHOT_DIRECTORY_KEY} = "${screenshotDirectory}"`,
    `${CONFIG_SAVE_ON_EXIT_KEY} = "false"`,
  ].join("\n") + "\n";

export const restoreRetroArchSouvenirConfigValues = (
  content: string,
  originalAutoScreenshotLine: string | null,
  originalScreenshotDirectoryLine?: string | null
) => {
  const restored = restoreCfgLine(
    content,
    AUTO_SCREENSHOT_KEY,
    originalAutoScreenshotLine
  );

  if (originalScreenshotDirectoryLine === undefined) return restored;

  return restoreCfgLine(
    restored,
    SCREENSHOT_DIRECTORY_KEY,
    originalScreenshotDirectoryLine
  );
};
