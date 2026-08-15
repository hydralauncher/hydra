const isCfgKeyLine = (line: string, key: string) => {
  const separator = line.indexOf("=");
  return separator !== -1 && line.slice(0, separator).trim() === key;
};

export const getCfgLine = (content: string, key: string) =>
  content.split(/\r?\n/).find((line) => isCfgKeyLine(line, key)) ?? null;

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
