export interface StackOrigin {
  functionName: string | null;
  file: string;
  line: number;
  column: number;
}

const LINE_COL_RE = /:(\d+):(\d+)\)?\s*$/;

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

const parseFrame = (line: string): StackOrigin | null => {
  if (!line.startsWith("at ")) return null;

  const match = LINE_COL_RE.exec(line);
  if (!match) return null;

  const head = line.slice(3, match.index).trim();
  const parenIndex = head.indexOf("(");

  const functionName =
    parenIndex >= 0 ? head.slice(0, parenIndex).trim() || null : null;
  const location = parenIndex >= 0 ? head.slice(parenIndex + 1).trim() : head;

  if (!location) return null;
  if (IGNORED_FILE_HINTS.some((hint) => location.includes(hint))) return null;

  return {
    functionName,
    file: cleanFile(location),
    line: Number(match[1]),
    column: Number(match[2]),
  };
};

export const getErrorOrigin = (stack?: string): StackOrigin | null => {
  if (!stack) return null;

  for (const line of stack.split("\n")) {
    const origin = parseFrame(line.trim());
    if (origin) return origin;
  }

  return null;
};

export const formatOrigin = (origin: StackOrigin) => {
  const location = `${origin.file}:${origin.line}:${origin.column}`;
  return origin.functionName
    ? `${location} (${origin.functionName})`
    : location;
};
