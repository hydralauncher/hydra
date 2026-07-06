export interface StackOrigin {
  functionName: string | null;
  file: string;
  line: number;
  column: number;
}

const FRAME_RE = /at\s+(?:(.*?)\s+)?\(?([^\s()]+):(\d+):(\d+)\)?\s*$/;

const IGNORED_FILE_HINTS = [
  "/node_modules/",
  "/@fs/",
  "/@vite/",
  "/@react-refresh",
  "chunk-",
  "react-dom",
  "react-jsx",
];

const cleanFile = (raw: string) => {
  let file = raw;

  try {
    if (file.includes("://")) file = new URL(file).pathname;
  } catch {
    /* keep raw value */
  }

  file = file.split("?")[0];

  const srcIndex = file.indexOf("/src/");
  if (srcIndex >= 0) return file.slice(srcIndex + 1);

  return file.replace(/^.*\//, "");
};

export const getErrorOrigin = (stack?: string): StackOrigin | null => {
  if (!stack) return null;

  for (const line of stack.split("\n")) {
    const match = FRAME_RE.exec(line.trim());
    if (!match) continue;

    const [, functionName, rawFile, lineNo, columnNo] = match;

    if (IGNORED_FILE_HINTS.some((hint) => rawFile.includes(hint))) continue;

    return {
      functionName: functionName || null,
      file: cleanFile(rawFile),
      line: Number(lineNo),
      column: Number(columnNo),
    };
  }

  return null;
};

export const formatOrigin = (origin: StackOrigin) => {
  const location = `${origin.file}:${origin.line}:${origin.column}`;
  return origin.functionName
    ? `${location} (${origin.functionName})`
    : location;
};
