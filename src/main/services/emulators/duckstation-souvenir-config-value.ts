const findIniSection = (lines: string[], section: string) =>
  lines.findIndex(
    (line) => line.trim().toLowerCase() === `[${section.toLowerCase()}]`
  );

const isIniKey = (line: string, key: string) => {
  const separator = line.indexOf("=");
  return (
    separator !== -1 &&
    line.slice(0, separator).trim().toLowerCase() === key.toLowerCase()
  );
};

export const setIniValue = (
  content: string,
  section: string,
  key: string,
  value: string
) => {
  const lines = content.split(/\r?\n/);
  const sectionIndex = findIniSection(lines, section);

  if (sectionIndex === -1) {
    return `${content.trimEnd()}\n\n[${section}]\n${key} = ${value}\n`;
  }

  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("[")) {
      lines.splice(index, 0, `${key} = ${value}`);
      return lines.join("\n");
    }

    if (isIniKey(lines[index], key)) {
      lines[index] = `${key} = ${value}`;
      return lines.join("\n");
    }
  }

  lines.push(`${key} = ${value}`);
  return lines.join("\n");
};

export const getIniLine = (content: string, section: string, key: string) => {
  const lines = content.split(/\r?\n/);
  const sectionIndex = findIniSection(lines, section);
  if (sectionIndex === -1) return null;

  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith("[")) break;
    if (isIniKey(line, key)) return line;
  }

  return null;
};

export const restoreIniValue = (
  content: string,
  section: string,
  key: string,
  originalLine: string | null
) => {
  const lines = content.split(/\r?\n/);
  const sectionIndex = findIniSection(lines, section);
  if (sectionIndex === -1) return content;

  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith("[")) break;
    if (!isIniKey(line, key)) continue;

    if (originalLine === null) lines.splice(index, 1);
    else lines[index] = originalLine;
    return lines.join("\n");
  }

  if (originalLine !== null) lines.splice(sectionIndex + 1, 0, originalLine);
  return lines.join("\n");
};
